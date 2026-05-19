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

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Middleware should already have caught this, but defence in depth.
    redirect('/sign-in?next=' + encodeURIComponent('/client/jobs/new'));
  }

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
  const customSlugs = (parsed.data.customSpecialties ?? '')
    .split(',')
    .map(toSlug)
    .filter((v) => v.length > 0);
  const mergedSpecialties = Array.from(
    new Set([...parsed.data.specialties, ...customSlugs]),
  ).slice(0, 300);

  const clientOpId = parsed.data.clientOpId && parsed.data.clientOpId.length > 0
    ? parsed.data.clientOpId
    : null;

  // Idempotency: if a job with this client_op_id already exists for this
  // user, redirect to it instead of inserting a duplicate. This stops the
  // "submitted once, got 3 rows" bug at its source.
  if (clientOpId) {
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

  const insert: Record<string, unknown> = {
    client_id: user.id,
    title: parsed.data.title,
    description: parsed.data.description,
    location_city: parsed.data.locationCity,
    budget_cents: parsed.data.budgetDollars * 100,
    urgency: parsed.data.urgency,
    job_type: parsed.data.jobType,
    specialty_slugs: mergedSpecialties,
    // Explicit so we don't trip the jobs_status_check vs DEFAULT mismatch.
    status: 'open' as const,
    // ── CCI flag (Sprint 12 hotfix) ────────────────────────────────────
    requires_cci: parsed.data.requiresCci,
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

  // Revalidate the list so the new row appears without a hard reload.
  revalidatePath('/client/jobs');
  redirect('/client/jobs?created=' + encodeURIComponent(data.id));
}
