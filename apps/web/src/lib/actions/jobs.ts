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
  specialties: z.array(z.string().trim().min(1)).default([]),

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

  const insert: Record<string, unknown> = {
    client_id: user.id,
    title: parsed.data.title,
    description: parsed.data.description,
    location_city: parsed.data.locationCity,
    budget_cents: parsed.data.budgetDollars * 100,
    urgency: parsed.data.urgency,
    job_type: parsed.data.jobType,
    specialty_slugs: parsed.data.specialties,
    // Explicit so we don't trip the jobs_status_check vs DEFAULT mismatch.
    status: 'open' as const,
    // ── CCI flag (Sprint 12 hotfix) ────────────────────────────────────
    // Backed by jobs.requires_cci BOOLEAN NOT NULL DEFAULT false
    // (20260518150000_add_requires_cci_to_jobs.sql).
    requires_cci: parsed.data.requiresCci,
    // moderation_status, sponsorship_offered, accepts_remote_inspectors,
    // is_senior_review, applications_count — all fall through to their
    // schema defaults.
  };

  const { data, error } = await supabase
    .from('jobs')
    .insert(insert)
    .select('id')
    .single();

  if (error || !data) {
    if (typeof console !== 'undefined') {
      console.error('[createJob] insert failed', {
        code: error?.code,
        message: error?.message,
      });
    }
    redirect(
      buildErrorRedirect(
        '/client/jobs/new',
        // Don't echo raw DB errors to the form. Common cases that
        // actually do matter to the user (e.g. RLS denial) surface as
        // either 401 from middleware before the action runs, OR as the
        // generic message below.
        'Could not post the job. Try again, or contact support if this persists.',
      ),
    );
  }

  // Revalidate the list so the new row appears without a hard reload.
  revalidatePath('/client/jobs');
  redirect('/client/jobs?created=' + encodeURIComponent(data.id));
}
