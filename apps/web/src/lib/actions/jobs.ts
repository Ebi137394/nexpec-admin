// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/jobs.ts — server actions for client-owned jobs
//
//  createJob: validates the form payload with Zod, ensures the caller is
//  authenticated, and INSERTs a row into public.jobs with client_id set
//  to auth.uid(). Owner XOR is satisfied (agency_id left NULL).
//
//  Status pinned to 'open' on creation because the production schema's
//  DEFAULT 'pending_approval' would fail jobs_status_check (known bug).
//  moderation_status falls through to the column default 'pending_review'
//  so admin moderation gates visibility to inspectors.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const URGENCY_VALUES = ['low', 'normal', 'high', 'critical'] as const;
const JOB_TYPES = ['on_site', 'remote'] as const;

const CreateJobSchema = z.object({
  title: z
    .string()
    .trim()
    .min(5, { message: 'Title needs at least 5 characters.' })
    .max(140, { message: 'Title is too long.' }),
  description: z
    .string()
    .trim()
    .min(20, { message: 'Add at least a couple sentences of scope.' })
    .max(8000, { message: 'Description is too long — attach a file instead.' }),
  locationCity: z
    .string()
    .trim()
    .min(2, { message: 'City is required.' })
    .max(120),
  budgetDollars: z
    .coerce.number({ message: 'Budget must be a number.' })
    .int({ message: 'Whole dollars only.' })
    .min(100, { message: 'Minimum budget is $100.' })
    .max(10_000_000, { message: 'Budget exceeds the cap — contact sales.' }),
  urgency: z.enum(URGENCY_VALUES).default('normal'),
  jobType: z.enum(JOB_TYPES).default('on_site'),
  // Specialties arrive as an array of slugs via repeated form fields.
  // Cap raised to 300 because the new SPECIALTY_GROUPS taxonomy alone is 200+.
  specialties: z.array(z.string().trim().min(1).max(120)).max(300).default([]),
  // Free-form overflow (comma-separated). Parsed + merged into specialty_slugs.
  customSpecialties: z.string().trim().max(4000).optional().or(z.literal('')),
  // Idempotency token — UUID generated client-side at form render. The DB
  // has a unique partial index on jobs.client_op_id so a re-post becomes
  // a no-op at the storage layer.
  clientOpId: z
    .string()
    .uuid({ message: 'Invalid op id' })
    .optional()
    .or(z.literal('')),

  // ── CCI flag (Sprint 12 hotfix) ─────────────────────────────────────
  // Single boolean — when true, this job needs a CCI-certified inspector.
  // Admin can override during moderation. Replaces the heavier
  // inspection_type / scope_template_id contract that proved too much
  // for the current schema.
  requiresCci: z
    .preprocess(
      (v) => v === 'on' || v === 'true' || v === true,
      z.boolean(),
    )
    .default(false),
});

function buildErrorRedirect(
  base: string,
  message: string,
  echo?: Partial<Record<string, string>>,
): string {
  const params = new URLSearchParams({ error: message });
  if (echo) {
    for (const [k, v] of Object.entries(echo)) {
      if (v) params.set(k, v);
    }
  }
  return `${base}?${params.toString()}`;
}

export async function createJob(formData: FormData): Promise<void> {
  // Specialties come through as multiple "specialties" entries (checkbox
  // group). getAll preserves the list shape Zod expects.
  const rawSpecialties = formData.getAll('specialties').map(String);

  const parsed = CreateJobSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description'),
    locationCity: formData.get('locationCity'),
    budgetDollars: formData.get('budgetDollars'),
    urgency: formData.get('urgency') ?? 'normal',
    jobType: formData.get('jobType') ?? 'on_site',
    specialties: rawSpecialties,
    customSpecialties: formData.get('customSpecialties') ?? '',
    clientOpId: formData.get('clientOpId') ?? '',
    // Checkbox: present in formData as "on" when checked, absent when not.
    requiresCci: formData.get('requiresCci'),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not post — check the form.';
    redirect(buildErrorRedirect('/client/jobs/new', msg));
  }
  // TS doesn't model redirect()'s throw — re-bind so .input is non-optional below.
  const input = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: maybeUser },
  } = await supabase.auth.getUser();
  if (!maybeUser) {
    redirect('/sign-in?next=' + encodeURIComponent('/client/jobs/new'));
  }
  const user = maybeUser;

  // Slugify free-form custom specialties and merge with the curated checkbox slugs
  function toSlug(s: string): string {
    return s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120);
  }
  const customSlugs = (input.customSpecialties ?? '')
    .split(',')
    .map(toSlug)
    .filter((v) => v.length > 0);
  const mergedSpecialties = Array.from(
    new Set([...input.specialties, ...customSlugs]),
  ).slice(0, 300);

  // Deterministic op_id derived from content + a 60-second bucket. If the
  // form is submitted twice (React Strict Mode dev double-fire, browser
  // retry, double-click), both submissions hash to the SAME op_id and the
  // DB's unique partial index on jobs.client_op_id rejects the second.
  // The client-supplied UUID (if any) wins; we fall back to the deterministic
  // hash so we always have an idempotency key.
  async function deterministicOpId(): Promise<string> {
    const minuteBucket = Math.floor(Date.now() / 60_000);
    const seed =
      user.id +
      '|' +
      input.title.trim().toLowerCase() +
      '|' +
      input.description.trim().toLowerCase().slice(0, 200) +
      '|' +
      input.locationCity.trim().toLowerCase() +
      '|' +
      String(input.budgetDollars) +
      '|' +
      String(minuteBucket);
    const buf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(seed),
    );
    const hex = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    // Format the first 32 hex chars as a UUID
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  const clientOpId =
    input.clientOpId && input.clientOpId.length > 0
      ? input.clientOpId
      : await deterministicOpId();

  // ── DEDUP A: idempotency token (cross-deploy guarantee) ────────────────
  // If a job with this client_op_id already exists for this user, redirect
  // to it instead of inserting a duplicate.
  if (clientOpId) {
    try {
      const { data: existing } = await supabase
        .from('jobs')
        .select('id')
        .eq('client_op_id', clientOpId)
        .eq('client_id', user.id)
        .maybeSingle();
      if (existing && (existing as { id?: string }).id) {
        revalidatePath('/client/jobs');
        redirect(
          '/client/jobs?created=' +
            encodeURIComponent((existing as { id: string }).id),
        );
      }
    } catch {
      /* ignore — column may not exist yet, fall through to content-hash check */
    }
  }

  // ── DEDUP B: content-hash + time window ────────────────────────────────
  // Belt-and-suspenders. If the user navigated back and resubmitted the
  // same form (different op_id, same content), this catches it. Window is
  // 90 seconds because a user resubmitting on purpose >1m later is fine.
  try {
    const windowStart = new Date(Date.now() - 90_000).toISOString();
    const { data: recent } = await supabase
      .from('jobs')
      .select('id, title, description, location_city, created_at')
      .eq('client_id', user.id)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(10);
    const dup = (recent ?? []).find(
      (r) =>
        String((r as { title?: unknown }).title ?? '').trim() ===
          input.title.trim() &&
        String((r as { description?: unknown }).description ?? '').trim() ===
          input.description.trim() &&
        String((r as { location_city?: unknown }).location_city ?? '').trim() ===
          input.locationCity.trim(),
    );
    if (dup && (dup as { id?: string }).id) {
      revalidatePath('/client/jobs');
      redirect(
        '/client/jobs?created=' +
          encodeURIComponent((dup as { id: string }).id),
      );
    }
  } catch {
    /* ignore — proceed to insert */
  }

  const insert: Record<string, unknown> = {
    client_id: user.id,
    title: input.title,
    description: input.description,
    location_city: input.locationCity,
    budget_cents: input.budgetDollars * 100,
    urgency: input.urgency,
    job_type: input.jobType,
    specialty_slugs: mergedSpecialties,
    // Explicit so we don't trip the jobs_status_check vs DEFAULT mismatch.
    status: 'open' as const,
    // ── CCI flag (Sprint 12 hotfix) ────────────────────────────────────
    requires_cci: input.requiresCci,
    // ── Idempotency (Sprint 13) ─────────────────────────────────────────
    // jobs.client_op_id has a unique partial index from
    // 20260518310000_admin_pricing_and_dedup.sql. A second insert with the
    // same id is rejected; we treat 23505 as "already posted" → redirect.
    client_op_id: clientOpId,
  };

  const { data, error } = await supabase
    .from('jobs')
    .insert(insert)
    .select('id')
    .single();

  if (error || !data) {
    // Postgres unique_violation → treat as already-posted. Look up the
    // existing row and redirect to it instead of bouncing the user back.
    if (error?.code === '23505' && clientOpId) {
      const { data: existing } = await supabase
        .from('jobs')
        .select('id')
        .eq('client_op_id', clientOpId)
        .eq('client_id', user.id)
        .maybeSingle();
      if (existing && (existing as { id?: string }).id) {
        revalidatePath('/client/jobs');
        redirect('/client/jobs?created=' + encodeURIComponent((existing as { id: string }).id));
      }
    }
    if (typeof console !== 'undefined') {
      console.error('[createJob] insert failed', {
        code: error?.code,
        message: error?.message,
      });
    }
    redirect(
      buildErrorRedirect(
        '/client/jobs/new',
        'Could not post the job. Try again, or contact support if this persists.',
      ),
    );
  }

  // ── NOTIFICATION FALLBACK ──────────────────────────────────────────────
  // The notify_on_job_change DB trigger (migration 20260518280000) should
  // fire admin notifications automatically. But if that migration hasn't
  // been applied to this tenant yet, the bell stays dark. We belt-and-
  // suspender call notify_admins() directly here so admins get pinged
  // regardless. Safe to call: notify_safe / notify_admins both swallow
  // their own errors and never block the user response.
  try {
    await supabase.rpc('notify_admins', {
      p_kind: 'job_moderated',
      p_title: 'New job posted',
      p_body: input.title.slice(0, 140),
      p_link: '/admin/jobs?inspect=' + data.id,
      p_job_id: data.id,
    });
  } catch {
    /* ignore — RPC may not exist on this tenant; the SQL trigger covers it */
  }

  // Revalidate the list so the new row appears without a hard reload.
  revalidatePath('/client/jobs');
  revalidatePath('/admin/jobs');
  revalidatePath('/notifications');
  redirect('/client/jobs?created=' + encodeURIComponent(data.id));
}
