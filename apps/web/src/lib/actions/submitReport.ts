// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/submitReport.ts — inspector submits the inspection report
//
//  GOLDEN_RULE_6 — Inspector → Admin → Client. This action:
//    1. Verifies the inspector is hired on this job (applications row).
//    2. Verifies the job is in an active state (assigned / in_progress).
//    3. Uploads evidence photos to the inspection-photos bucket under
//       {jobId}/{userId}/{timestamp}-{i}.{ext}.
//    4. INSERTs a row into inspection_reports with status='pending'.
//       NEVER sets technical_approved / financial_approved / is_published /
//       is_client_approved — those are admin/client domain.
//    5. Writes audit_events signal (event_type='job.report_submitted') so
//       admin's queue lights up.
//
//  Idempotency: unique_report_per_job_inspector constraint on the table
//  prevents duplicate submissions. 23505 is handled as a friendly
//  "already submitted" redirect.
//
//  Photo storage: bucket is private. Paths only are persisted in the
//  doc; signed URLs are minted on read by admin/client surfaces.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { FinalReportDoc, InspectionResult } from '@/lib/data/inspectorReport.types';

const MAX_PHOTOS = 6;
const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB — matches inspection-photos bucket cap.
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);
const PHOTO_BUCKET = 'inspection-photos';

const SubmitSchema = z.object({
  jobId: z.string().uuid({ message: 'Invalid job id.' }),
  result: z.enum(['pass', 'fail', 'partial'], {
    message: 'Pick a result.',
  }),
  summary: z
    .string()
    .trim()
    .min(50, { message: 'Summary needs at least 50 characters.' })
    .max(8000, { message: 'Keep the summary under 8000 characters.' }),
  attestInspectorName: z
    .string()
    .trim()
    .min(2, { message: 'Type your name to attest.' })
    .max(80),
  attestation: z.literal('on', {
    message: 'You must check the attestation box.',
  }),
});

function buildFormUrl(jobId: string, params: Record<string, string>): string {
  const base = `/inspector/jobs/${encodeURIComponent(jobId)}/submit-report`;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

function buildJobUrl(jobId: string, params: Record<string, string>): string {
  const base = `/inspector/jobs/${encodeURIComponent(jobId)}`;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

export async function submitInspectionReport(formData: FormData): Promise<void> {
  // 1. Field validation.
  const parsed = SubmitSchema.safeParse({
    jobId: formData.get('jobId'),
    result: formData.get('result'),
    summary: formData.get('summary'),
    attestInspectorName: formData.get('attestInspectorName'),
    attestation: formData.get('attestation'),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not submit — check the form.';
    redirect(
      buildFormUrl(String(formData.get('jobId') ?? ''), { error: msg }),
    );
  }
  const { jobId, result, summary, attestInspectorName } = parsed.data;

  // 2. Auth.
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(buildFormUrl(jobId, {})));
  }

  // 3. Authorisation — inspector must be hired on this job.
  const { data: app } = await supabase
    .from('applications')
    .select('id, status')
    .eq('job_id', jobId)
    .eq('applicant_id', user.id)
    .in('status', ['hired', 'accepted'])
    .is('deleted_at', null)
    .maybeSingle();
  if (!app) {
    redirect(
      buildJobUrl(jobId, {
        error:
          'You can only submit a report for a job you have been hired on.',
      }),
    );
  }

  // 4. Job must be in an active state.
  const { data: jobRow } = await supabase
    .from('jobs')
    .select('id, status, title')
    .eq('id', jobId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!jobRow) {
    redirect('/inspector/assignments');
  }
  const j = jobRow as unknown as Record<string, unknown>;
  if (j.status !== 'assigned' && j.status !== 'in_progress') {
    redirect(
      buildJobUrl(jobId, {
        error: 'Reports can only be submitted on assigned or in-progress jobs.',
      }),
    );
  }

  // 5. Upload evidence photos to inspection-photos bucket.
  //    Storage paths: {jobId}/{userId}/{timestamp}-{index}.{ext}
  //    Bucket is private; signed URLs are minted on read.
  const rawPhotos = formData.getAll('photos');
  type EvidenceEntry = FinalReportDoc['evidence'][number];
  const evidence: EvidenceEntry[] = [];

  for (let i = 0; i < rawPhotos.length && evidence.length < MAX_PHOTOS; i++) {
    const photo = rawPhotos[i];
    // FormData entries that aren't files come through as strings; skip them.
    if (!(photo instanceof File) || photo.size === 0) continue;

    if (photo.size > MAX_PHOTO_SIZE_BYTES) {
      redirect(
        buildFormUrl(jobId, {
          error: `Photo ${i + 1} exceeds 5MB. Compress and retry.`,
        }),
      );
    }
    if (!ALLOWED_MIME.has(photo.type)) {
      redirect(
        buildFormUrl(jobId, {
          error: `Photo ${i + 1} isn't an accepted image type.`,
        }),
      );
    }

    const ext =
      (photo.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') ||
      'jpg';
    const path = `${jobId}/${user.id}/${Date.now()}-${i}.${ext}`;
    const buf = await photo.arrayBuffer();

    const { data: uploaded, error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, buf, {
        contentType: photo.type,
        upsert: false,
      });

    if (upErr || !uploaded) {
      if (typeof console !== 'undefined') {
        console.error('[submitInspectionReport] photo upload failed', {
          path,
          message: upErr?.message,
        });
      }
      redirect(
        buildFormUrl(jobId, {
          error:
            'A photo failed to upload. Try again, or reduce file count / size.',
        }),
      );
    }

    evidence.push({
      path: uploaded.path,
      caption: null,
      sizeBytes: photo.size,
    });
  }

  // 6. Compose the structured report doc.
  const doc: FinalReportDoc = {
    version: 1,
    result: result as InspectionResult,
    summary,
    evidence,
    attestation: {
      inspectorName: attestInspectorName,
      attestedAt: new Date().toISOString(),
    },
  };

  // 7. INSERT the inspection_reports row. Inspector writes ONLY the
  //    columns admin/client will later mutate — never sets technical_approved
  //    / financial_approved / is_published / is_client_approved.
  const insert = {
    job_id: jobId,
    inspector_id: user.id,
    status: 'pending',
    photo_url: evidence[0]?.path ?? null, // first photo path, for backwards-compat
    notes: summary,
    final_report_doc: JSON.stringify(doc),
  };

  const { data: insertedReport, error: insertErr } = await supabase
    .from('inspection_reports')
    .insert(insert)
    .select('id')
    .single();

  if (insertErr) {
    // unique_report_per_job_inspector — already submitted.
    if (insertErr.code === '23505') {
      redirect(buildJobUrl(jobId, { already_reported: '1' }));
    }
    if (typeof console !== 'undefined') {
      console.error('[submitInspectionReport] insert failed', {
        code: insertErr.code,
        message: insertErr.message,
      });
    }
    redirect(
      buildFormUrl(jobId, {
        error: 'Could not save your report. Try again or contact support.',
      }),
    );
  }

  // 8. Audit signal — admin queue picks this up.
  //    GOLDEN_RULE_6 — same audit pattern as Sprint 4B client approval.
  //    actor_role looked up from profile; never hardcoded.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name, email')
    .eq('id', user.id)
    .maybeSingle();
  const p = (profile ?? {}) as Record<string, unknown>;
  const actorRole = ((p.role as string | null) ?? 'inspector')
    .toString()
    .toLowerCase();
  const actorLabel =
    ((p.full_name as string | null)?.trim() ||
      ((p.email as string | null) ?? '').split('@')[0] ||
      (user.email ?? '').split('@')[0] ||
      attestInspectorName) as string;

  await supabase.from('audit_events').insert({
    event_type: 'job.report_submitted',
    severity: 'info',
    actor_id: user.id,
    actor_role: actorRole,
    actor_label: actorLabel,
    subject_table: 'inspection_reports',
    subject_id: insertedReport.id,
    job_id: jobId,
    summary: `Inspector submitted report for "${String(j.title ?? '(untitled)')}". Awaiting admin technical + financial review.`,
    delta: {},
    metadata: {
      source: 'web/inspector_portal',
      surface: 'submit_report',
      photo_count: evidence.length,
      result,
    },
  });

  revalidatePath(`/inspector/jobs/${jobId}`);
  revalidatePath('/inspector/assignments');
  redirect(buildJobUrl(jobId, { report_submitted: '1' }));
}
