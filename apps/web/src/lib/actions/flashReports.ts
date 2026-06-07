// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/flashReports.ts — Flash Report (NCR) write layer for the web.
//
//  Mirrors the mobile raise/transition flow, minus the offline outbox (web
//  server actions are always online). All writes go through the existing shared
//  SECURITY DEFINER RPCs — NO schema changes:
//    • flash_report_create(p_job_id, p_category, p_severity, p_title,
//        p_description, p_location_text?, p_occurred_at?, p_client_id?)
//    • flash_report_add_attachment(p_flash_report_id, p_kind, p_storage_path,
//        p_mime_type?, p_size_bytes?, p_caption?)
//    • flash_report_transition(p_id, p_to_status, p_notes?)
//
//  Evidence: uploaded to the private `flash-report-attachments` bucket at
//  {reportId}/{uploaderId}/… — the report id is client-minted (p_client_id) so
//  the path satisfies the RPC's `split_part(path,'/',1) = report.id` guard, and
//  the create is idempotent on replay. Same 2-step dance as submitReport.ts.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BUCKET = 'flash-report-attachments';
const MAX_FILES = 8;
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — well under the RPC's 50 MB cap.
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'application/pdf',
]);

const CATEGORIES = [
  'calibration',
  'documentation',
  'safety',
  'procedure',
  'defect',
  'client_interference',
  'other',
] as const;
const SEVERITIES = ['observation', 'minor', 'major', 'critical'] as const;
const STATUSES = [
  'open',
  'acknowledged',
  'in_remediation',
  'resolved',
  'closed',
  'disputed',
] as const;
const PORTALS = ['inspector', 'admin', 'client'] as const;
type Portal = (typeof PORTALS)[number];

function attachmentKind(mime: string): 'photo' | 'pdf' | 'document' | 'other' {
  if (mime.startsWith('image/')) return 'photo';
  if (mime === 'application/pdf') return 'pdf';
  if (mime) return 'document';
  return 'other';
}

/** Build a safe in-app return URL from a constrained portal enum (no open redirect). */
function jobUrl(portal: Portal, jobId: string, params: Record<string, string>): string {
  const id = encodeURIComponent(jobId);
  const qs = new URLSearchParams(params);
  if (portal === 'admin') {
    qs.set('inspect', jobId);
    return `/admin/jobs?${qs.toString()}#moderation`;
  }
  const base = portal === 'client' ? `/client/jobs/${id}` : `/inspector/jobs/${id}`;
  const q = qs.toString();
  return q ? `${base}?${q}` : base;
}

function revalidateForPortal(portal: Portal, jobId: string): void {
  if (portal === 'admin') {
    revalidatePath('/admin/jobs');
  } else if (portal === 'client') {
    revalidatePath(`/client/jobs/${jobId}`);
  } else {
    revalidatePath(`/inspector/jobs/${jobId}`);
  }
}

function newReportUrl(
  portal: 'inspector' | 'admin',
  jobId: string,
  params: Record<string, string>,
): string {
  const id = encodeURIComponent(jobId);
  const base =
    portal === 'admin'
      ? `/admin/jobs/${id}/flash-reports/new`
      : `/inspector/jobs/${id}/flash-reports/new`;
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

// ─── Raise (inspector) ──────────────────────────────────────────────────────

const RaiseSchema = z.object({
  jobId: z.string().uuid({ message: 'Invalid job id.' }),
  category: z.enum(CATEGORIES, { message: 'Pick a category.' }),
  severity: z.enum(SEVERITIES, { message: 'Pick a severity.' }),
  title: z
    .string()
    .trim()
    .min(8, { message: 'Title needs at least 8 characters.' })
    .max(160, { message: 'Keep the title under 160 characters.' }),
  description: z
    .string()
    .trim()
    .min(20, { message: 'Description needs at least 20 characters.' })
    .max(5000, { message: 'Keep the description under 5000 characters.' }),
  locationText: z.string().trim().max(200).optional().or(z.literal('')),
  // Which surface raised it — inspector (field) or admin (broker). Drives the
  // return URL only; the RPC still authorises (party or super_admin).
  portal: z.enum(['inspector', 'admin']).default('inspector'),
});

export async function raiseFlashReport(formData: FormData): Promise<void> {
  const parsed = RaiseSchema.safeParse({
    jobId: formData.get('jobId'),
    category: formData.get('category'),
    severity: formData.get('severity'),
    title: formData.get('title'),
    description: formData.get('description'),
    locationText: formData.get('locationText') ?? '',
    portal: formData.get('portal') ?? 'inspector',
  });
  const jobIdRaw = String(formData.get('jobId') ?? '');
  const portalRaw: 'inspector' | 'admin' =
    formData.get('portal') === 'admin' ? 'admin' : 'inspector';
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Check the form and retry.';
    redirect(newReportUrl(portalRaw, jobIdRaw, { error: msg }));
  }
  const { jobId, category, severity, title, description, locationText, portal } =
    parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(newReportUrl(portal, jobId, {})));
  }

  // Client-minted id → lets us upload evidence under {reportId}/… BEFORE the
  // row is committed, satisfying the RPC's storage-path guard. Idempotent create.
  const reportId = globalThis.crypto.randomUUID();

  const { error: createErr } = await supabase.rpc('flash_report_create', {
    p_job_id: jobId,
    p_category: category,
    p_severity: severity,
    p_title: title,
    p_description: description,
    p_location_text: locationText ? locationText : null,
    p_occurred_at: null,
    p_client_id: reportId,
  });

  if (createErr) {
    const friendly =
      createErr.code === '42501'
        ? 'Only parties to this job can raise a flash report.'
        : 'Could not raise the flash report. Try again.';
    if (typeof console !== 'undefined') {
      console.error('[raiseFlashReport] create failed', {
        code: createErr.code,
        message: createErr.message,
      });
    }
    redirect(newReportUrl(portal, jobId, { error: friendly }));
  }

  // Evidence — best-effort. The report already exists; an attachment failure
  // must not discard the NCR. (Matches the mobile outbox's per-file resilience.)
  const rawFiles = formData.getAll('evidence');
  let uploaded = 0;
  for (let i = 0; i < rawFiles.length && uploaded < MAX_FILES; i++) {
    const file = rawFiles[i];
    if (!(file instanceof File) || file.size === 0) continue;
    if (file.size > MAX_FILE_BYTES) continue;
    if (!ALLOWED_MIME.has(file.type)) continue;

    const safeName =
      (file.name || 'evidence').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) ||
      'evidence';
    const path = `${reportId}/${user.id}/${Date.now()}-${i}-${safeName}`;

    try {
      const buf = await file.arrayBuffer();
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, buf, { contentType: file.type, upsert: true });
      if (upErr) {
        if (typeof console !== 'undefined') {
          console.warn('[raiseFlashReport] upload failed', upErr.message);
        }
        continue;
      }
      const { error: addErr } = await supabase.rpc(
        'flash_report_add_attachment',
        {
          p_flash_report_id: reportId,
          p_kind: attachmentKind(file.type),
          p_storage_path: path,
          p_mime_type: file.type || null,
          p_size_bytes: file.size,
          p_caption: null,
        },
      );
      if (addErr) {
        if (typeof console !== 'undefined') {
          console.warn('[raiseFlashReport] add_attachment failed', addErr.message);
        }
        continue;
      }
      uploaded += 1;
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.warn('[raiseFlashReport] attachment threw', e);
      }
    }
  }

  revalidateForPortal(portal, jobId);
  redirect(jobUrl(portal, jobId, { flash_raised: '1' }));
}

// ─── Transition (any party, gated server-side) ───────────────────────────────

const TransitionSchema = z.object({
  reportId: z.string().uuid({ message: 'Invalid report id.' }),
  toStatus: z.enum(STATUSES, { message: 'Invalid status.' }),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  portal: z.enum(PORTALS),
  jobId: z.string().uuid(),
});

export async function transitionFlashReport(formData: FormData): Promise<void> {
  const parsed = TransitionSchema.safeParse({
    reportId: formData.get('reportId'),
    toStatus: formData.get('toStatus'),
    notes: formData.get('notes') ?? '',
    portal: formData.get('portal'),
    jobId: formData.get('jobId'),
  });
  if (!parsed.success) {
    // Fall back to the inspector job surface if we can't trust the inputs.
    const fallbackJob = String(formData.get('jobId') ?? '');
    redirect(jobUrl('inspector', fallbackJob, { flash_error: 'Invalid request.' }));
  }
  const { reportId, toStatus, notes, portal, jobId } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(jobUrl(portal, jobId, {})));
  }

  const { error } = await supabase.rpc('flash_report_transition', {
    p_id: reportId,
    p_to_status: toStatus,
    p_notes: notes ? notes : null,
  });

  if (error) {
    const friendly =
      error.code === '42501'
        ? 'You are not allowed to make that change.'
        : error.code === '22000'
          ? 'That status change is not allowed from the current state.'
          : 'Could not update the flash report. Try again.';
    if (typeof console !== 'undefined') {
      console.error('[transitionFlashReport] failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(jobUrl(portal, jobId, { flash_error: friendly }));
  }

  revalidateForPortal(portal, jobId);
  redirect(jobUrl(portal, jobId, { flash_updated: '1' }));
}
