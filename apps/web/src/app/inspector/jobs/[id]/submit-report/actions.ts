// ════════════════════════════════════════════════════════════════════════════
//  submit-report/actions.ts — the Inspector corrects a returned report and
//  resubmits it for Senior Inspector review
//
//  ── THIS ACTION MOVES NO MONEY ─────────────────────────────────────────────
//  It writes inspection_reports only. No wallet, no transaction, no payout, no
//  funding stage, no Stripe call, and no funding figure is read on the way. The
//  senior-review workflow has zero payment side effects by construction
//  (REVIEW_HAS_NO_PAYMENT_SIDE_EFFECTS, 20260801450000 §7) and this surface
//  keeps that true.
//
//  ── AUTHORITY IS RE-DERIVED HERE, NEVER READ OFF THE FORM ──────────────────
//  The page decides what to RENDER; this action decides what may LAND. Both
//  the report's authorship and the actor's live-contract status are re-read
//  from the database on every submission, in the same order the database
//  itself checks them:
//
//    1. authenticated                     — no session, no write
//    2. authorship                        — inspector_id = auth.uid()
//    3. LIVE CONTRACT                     — is_active_contract_inspector()
//    4. the report is actually returned   — status = 'returned_to_inspector'
//    5. optimistic lock on updated_at     — the row has not moved on
//
//  Step 3 is the replacement rule. A replaced or superseded inspector keeps
//  READ access to the report they authored (that history is theirs) but must
//  never write to a report that moved on. The RESTRICTIVE policy
//  reports_update_requires_active_inspector (20260801288000) already refuses
//  such a write at the database — this check exists so the actor gets an honest
//  explanation instead of a silent zero-row update, and it FAILS CLOSED: an
//  unreadable contract state blocks the write rather than allowing it.
//
//  Step 5 closes the stale-tab window. Between rendering and submitting, a
//  Senior Inspector may have been reassigned (status → 'in_senior_review') or
//  the report delivered. Guarding on the exact updated_at the form was built
//  from means a resubmission that would clobber a newer state matches zero rows
//  and is reported as a conflict — the same lesson the offline outbox learned
//  in handleReportUpdate (#56): a PostgREST update matching no row returns
//  `{ error: null, data: [] }`, so success must be proven by .select(), never
//  assumed from the absence of an error.
//
//  The inspector writes status = 'submitted' and nothing else about the review.
//  Opening the next round is the Admin's act (nx_admin_assign_senior_reviewer),
//  and the author can never approve their own work — trg_report_no_self_approval
//  (20260801430000 §5) refuses any transition into approval by the author, while
//  explicitly permitting submit / revise / resubmit.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { REPORT_REVIEW_STATUS } from '@nexpec/shared-core/domain';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { FinalReportDoc } from '@/lib/data/inspectorReport.types';

const MAX_NEW_PHOTOS = 6;
const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024; // matches the inspection-photos bucket cap
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);
const PHOTO_BUCKET = 'inspection-photos';

const ResubmitSchema = z.object({
  jobId: z.string().uuid({ message: 'Invalid job id.' }),
  reportId: z.string().uuid({ message: 'Invalid report id.' }),
  expectedUpdatedAt: z
    .string()
    .min(1, { message: 'Stale form, reload the page and try again.' }),
  summary: z
    .string()
    .trim()
    .min(50, { message: 'Revised summary needs at least 50 characters.' })
    .max(8000, { message: 'Keep the summary under 8000 characters.' }),
  responseToReviewer: z.string().trim().max(2000).optional().or(z.literal('')),
  signedDocsUrl: z
    .string()
    .trim()
    .max(2048)
    .url({ message: 'Signed-docs link must be a valid URL.' })
    .optional()
    .or(z.literal('')),
  signedDocsNotes: z.string().trim().max(1000).optional().or(z.literal('')),
});

function formUrl(jobId: string, params: Record<string, string>): string {
  const base = `/inspector/jobs/${encodeURIComponent(jobId)}/submit-report`;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * A correction round on a report a Senior Inspector returned. Progressive
 * enhancement: this is a plain <form action={…}> post, so it works with no
 * client-side JavaScript, exactly like the first-submission form beside it.
 */
export async function resubmitInspectionReport(
  formData: FormData,
): Promise<void> {
  const rawJobId = String(formData.get('jobId') ?? '');

  const parsed = ResubmitSchema.safeParse({
    jobId: rawJobId,
    reportId: formData.get('reportId'),
    expectedUpdatedAt: formData.get('expectedUpdatedAt'),
    summary: formData.get('summary'),
    responseToReviewer: formData.get('responseToReviewer') ?? '',
    signedDocsUrl: formData.get('signedDocsUrl') ?? '',
    signedDocsNotes: formData.get('signedDocsNotes') ?? '',
  });
  if (!parsed.success) {
    const msg =
      parsed.error.issues[0]?.message ?? 'Could not resubmit, check the form.';
    redirect(formUrl(rawJobId, { error: msg }));
  }
  const {
    jobId,
    reportId,
    expectedUpdatedAt,
    summary,
    responseToReviewer,
    signedDocsUrl,
    signedDocsNotes,
  } = parsed.data;

  // ── 1. Authenticated ─────────────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(formUrl(jobId, {})));
  }

  // ── 2. Authorship — the row must be this inspector's own report ──────────
  const { data: reportRow, error: readErr } = await supabase
    .from('inspection_reports')
    .select(
      'id, job_id, inspector_id, status, notes, final_report_doc, updated_at',
    )
    .eq('id', reportId)
    .eq('job_id', jobId)
    .eq('inspector_id', user.id)
    .is('deleted_at', null)
    .maybeSingle();

  if (readErr) {
    console.error('[resubmitInspectionReport] report read failed', readErr.message);
    redirect(
      formUrl(jobId, {
        error: 'Could not read your report just now. Try again.',
      }),
    );
  }
  if (!reportRow) {
    redirect(
      formUrl(jobId, {
        error: 'That report is not yours, or it no longer exists.',
      }),
    );
  }
  const report = reportRow as unknown as Record<string, unknown>;

  // ── 3. LIVE CONTRACT — the replacement rule. Fails closed. ───────────────
  const { data: isActive, error: activeErr } = await supabase.rpc(
    'is_active_contract_inspector',
    { p_job_id: jobId, p_user_id: user.id },
  );
  if (activeErr || isActive !== true) {
    if (activeErr) {
      console.error(
        '[resubmitInspectionReport] active-contract check failed',
        activeErr.message,
      );
    }
    redirect(
      formUrl(jobId, {
        error:
          activeErr
            ? 'Could not confirm you are still the assigned inspector on this job. Nothing was changed.'
            : 'You are no longer the assigned inspector on this job, so this report can no longer be resubmitted by you. Your review history stays readable.',
      }),
    );
  }

  // ── 4. The report must actually be back with its author ──────────────────
  if (report.status !== REPORT_REVIEW_STATUS.RETURNED_TO_INSPECTOR) {
    redirect(
      formUrl(jobId, {
        error:
          'This report is not awaiting corrections right now, so it was not resubmitted.',
      }),
    );
  }

  // ── 5. New evidence, appended — a correction may need the missing photo ──
  const existingDoc = parseDoc(report.final_report_doc);
  const evidence: FinalReportDoc['evidence'] = [
    ...(existingDoc?.evidence ?? []),
  ];

  const rawPhotos = formData.getAll('photos');
  let added = 0;
  for (let i = 0; i < rawPhotos.length && added < MAX_NEW_PHOTOS; i++) {
    const photo = rawPhotos[i];
    if (!(photo instanceof File) || photo.size === 0) continue;

    if (photo.size > MAX_PHOTO_SIZE_BYTES) {
      redirect(
        formUrl(jobId, {
          error: `Photo ${i + 1} exceeds 5MB. Compress and retry.`,
        }),
      );
    }
    if (!ALLOWED_MIME.has(photo.type)) {
      redirect(
        formUrl(jobId, {
          error: `Photo ${i + 1} isn't an accepted image type.`,
        }),
      );
    }

    const ext =
      (photo.name.split('.').pop() ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${jobId}/${user.id}/${Date.now()}-r${i}.${ext}`;
    const buf = await photo.arrayBuffer();

    const { data: uploaded, error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, buf, { contentType: photo.type, upsert: false });

    if (upErr || !uploaded) {
      console.error(
        '[resubmitInspectionReport] photo upload failed',
        upErr?.message,
      );
      redirect(
        formUrl(jobId, {
          error:
            'A photo failed to upload, so nothing was resubmitted. Try again.',
        }),
      );
    }

    evidence.push({ path: uploaded.path, caption: null, sizeBytes: photo.size });
    added += 1;
  }

  // ── 6. Compose the revised doc ───────────────────────────────────────────
  //  The revision trail is kept INSIDE the doc rather than in a new column:
  //  the contract is frozen and this lane adds no migration. The authoritative
  //  status trail is elsewhere and immutable — Lane B's report_review_history
  //  captures every status change automatically, and report_senior_reviews
  //  holds each round's verdict.
  const now = new Date().toISOString();
  const previousRevisions = readRevisions(existingDoc);
  const doc = {
    version: 1,
    result: existingDoc?.result ?? 'partial',
    summary,
    evidence,
    attestation: existingDoc?.attestation ?? {
      inspectorName: '',
      attestedAt: now,
    },
    signedDocs:
      signedDocsUrl || signedDocsNotes
        ? { url: signedDocsUrl || null, notes: signedDocsNotes || null }
        : readSignedDocs(existingDoc),
    revisions: [
      ...previousRevisions,
      {
        at: now,
        response: responseToReviewer || null,
        photosAdded: added,
      },
    ],
  } as unknown as FinalReportDoc;

  // ── 7. The write. Optimistic-locked; success proven by .select() ─────────
  const update: Record<string, unknown> = {
    status: REPORT_REVIEW_STATUS.SUBMITTED,
    notes: summary,
    final_report_doc: JSON.stringify(doc),
    // Advance the lock column explicitly so the guard is meaningful whether or
    // not a touch trigger is attached to this table.
    updated_at: now,
  };
  if (signedDocsUrl) update.signed_docs_url = signedDocsUrl;
  if (signedDocsNotes) update.signed_docs_notes = signedDocsNotes;
  if (evidence.length > 0 && evidence[0]) update.photo_url = evidence[0].path;

  const { data: updated, error: updErr } = await supabase
    .from('inspection_reports')
    .update(update)
    .eq('id', reportId)
    .eq('inspector_id', user.id)
    .eq('status', REPORT_REVIEW_STATUS.RETURNED_TO_INSPECTOR)
    .eq('updated_at', expectedUpdatedAt)
    .select('id');

  if (updErr) {
    console.error(
      '[resubmitInspectionReport] update failed',
      updErr.code,
      updErr.message,
    );
    redirect(
      formUrl(jobId, {
        error: 'Could not resubmit your report. Try again or contact support.',
      }),
    );
  }
  if (!updated || updated.length === 0) {
    // Zero rows with no error: the row moved on, was reassigned, or RLS no
    // longer admits this writer. Never report that as success.
    redirect(
      formUrl(jobId, {
        error:
          'This report changed while you were editing — it may have been reassigned or already resubmitted. Reload to see its current state; nothing was overwritten.',
      }),
    );
  }

  // ── 8. Audit signal. Best effort; never blocks the resubmission. ─────────
  //  Same shape as the first-submission signal in lib/actions/submitReport.ts,
  //  so the admin queue reads one event vocabulary for this report.
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
    (p.full_name as string | null)?.trim() ||
    ((p.email as string | null) ?? '').split('@')[0] ||
    (user.email ?? '').split('@')[0] ||
    'inspector';

  const { error: auditErr } = await supabase.from('audit_events').insert({
    event_type: 'job.report_resubmitted',
    severity: 'info',
    actor_id: user.id,
    actor_role: actorRole,
    actor_label: actorLabel,
    subject_table: 'inspection_reports',
    subject_id: reportId,
    job_id: jobId,
    summary:
      'Inspector resubmitted a returned report. Awaiting Senior Inspector reassignment.',
    delta: {},
    metadata: {
      source: 'web/inspector_portal',
      surface: 'resubmit_report',
      photos_added: added,
    },
  });
  if (auditErr) {
    console.warn(
      '[resubmitInspectionReport] audit signal failed',
      auditErr.message,
    );
  }

  revalidatePath(`/inspector/jobs/${jobId}/submit-report`);
  revalidatePath(`/inspector/jobs/${jobId}`);
  redirect(formUrl(jobId, { resubmitted: '1' }));
}

/* ─── doc helpers ─────────────────────────────────────────────────────── */

function parseDoc(raw: unknown): FinalReportDoc | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const candidate = JSON.parse(raw);
    if (candidate && typeof candidate === 'object' && 'version' in candidate) {
      return candidate as FinalReportDoc;
    }
  } catch {
    /* legacy plain-text doc — the notes column carries the body */
  }
  return null;
}

function readRevisions(doc: FinalReportDoc | null): unknown[] {
  const r = (doc as unknown as { revisions?: unknown } | null)?.revisions;
  return Array.isArray(r) ? r : [];
}

function readSignedDocs(doc: FinalReportDoc | null): unknown {
  return (doc as unknown as { signedDocs?: unknown } | null)?.signedDocs;
}
