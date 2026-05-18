// ════════════════════════════════════════════════════════════════════════════
//  src/lib/flashReports.ts
//  NEXPEC — Flash Reports / NCR client library.
//
//  All writes go through SECURITY DEFINER RPCs (flash_report_create,
//  flash_report_transition, flash_report_add_attachment). Reads use direct
//  SELECTs gated by RLS.
//
//  Attachments require a two-step dance:
//    1. uploadAttachmentBlob(reportId, ...)  → uploads to the
//       flash-report-attachments storage bucket at the canonical path.
//    2. addAttachment(reportId, ...)         → records the metadata row
//       via the RPC.
//
//  Render-time fetching of attachments uses createSignedUrl (15 min TTL)
//  because the bucket is NOT public — evidence is privileged.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────

export type FlashReportCategory =
  | 'calibration'
  | 'documentation'
  | 'safety'
  | 'procedure'
  | 'defect'
  | 'client_interference'
  | 'other';

export type FlashReportSeverity =
  | 'observation'
  | 'minor'
  | 'major'
  | 'critical';

export type FlashReportStatus =
  | 'open'
  | 'acknowledged'
  | 'in_remediation'
  | 'resolved'
  | 'closed'
  | 'disputed';

export type FlashReportReporterRole =
  | 'inspector'
  | 'client'
  | 'agency'
  | 'super_admin';

export type FlashReportAttachmentKind =
  | 'photo'
  | 'pdf'
  | 'document'
  | 'other';

export interface FlashReport {
  id: string;
  job_id: string;
  reporter_id: string;
  reporter_role: FlashReportReporterRole;

  category: FlashReportCategory;
  severity: FlashReportSeverity;
  title: string;
  description: string;

  location_text: string | null;
  occurred_at: string | null;

  status: FlashReportStatus;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;

  correlation_id: string;
  created_at: string;
  updated_at: string;
}

export interface FlashReportAttachment {
  id: string;
  flash_report_id: string;
  uploader_id: string;
  kind: FlashReportAttachmentKind;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  caption: string | null;
  created_at: string;
}

// ─── UI metadata ──────────────────────────────────────────────────────────

interface CategoryMeta { label: string; }
export const CATEGORY_META: Record<FlashReportCategory, CategoryMeta> = {
  calibration:          { label: 'Calibration' },
  documentation:        { label: 'Documentation' },
  safety:               { label: 'Safety' },
  procedure:            { label: 'Procedure' },
  defect:               { label: 'Defect' },
  client_interference:  { label: 'Client interference' },
  other:                { label: 'Other' },
};

interface SeverityMeta {
  label: string;
  color: string;
  bg: string;
}
export const SEVERITY_META: Record<FlashReportSeverity, SeverityMeta> = {
  observation: { label: 'Observation', color: '#3B82F6', bg: 'rgba(59,130,246,0.14)' },
  minor:       { label: 'Minor',       color: '#22D3EE', bg: 'rgba(34,211,238,0.14)' },
  major:       { label: 'Major',       color: '#F59E0B', bg: 'rgba(245,158,11,0.18)' },
  critical:    { label: 'Critical',    color: '#EF4444', bg: 'rgba(239,68,68,0.20)' },
};

interface StatusMeta {
  label: string;
  color: string;
  bg: string;
}
export const STATUS_META: Record<FlashReportStatus, StatusMeta> = {
  open:           { label: 'Open',            color: '#EF4444', bg: 'rgba(239,68,68,0.18)' },
  acknowledged:   { label: 'Acknowledged',    color: '#F59E0B', bg: 'rgba(245,158,11,0.18)' },
  in_remediation: { label: 'In remediation',  color: '#22D3EE', bg: 'rgba(34,211,238,0.16)' },
  resolved:       { label: 'Resolved',        color: '#10B981', bg: 'rgba(16,185,129,0.16)' },
  closed:         { label: 'Closed',          color: '#94A3B8', bg: 'rgba(148,163,184,0.16)' },
  disputed:       { label: 'Disputed',        color: '#EF4444', bg: 'rgba(239,68,68,0.18)' },
};

// ─── Reads ────────────────────────────────────────────────────────────────

export async function listFlashReportsForJob(jobId: string): Promise<FlashReport[]> {
  const { data, error } = await supabase
    .from('flash_reports')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as FlashReport[];
}

export async function getFlashReport(id: string): Promise<FlashReport | null> {
  const { data, error } = await supabase
    .from('flash_reports')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as FlashReport | null) ?? null;
}

export async function listAttachments(reportId: string): Promise<FlashReportAttachment[]> {
  const { data, error } = await supabase
    .from('flash_report_attachments')
    .select('*')
    .eq('flash_report_id', reportId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as FlashReportAttachment[];
}

/** 15-min signed URL for an evidence file. Bucket is NOT public. */
export async function signedAttachmentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase
    .storage
    .from('flash-report-attachments')
    .createSignedUrl(storagePath, 60 * 15);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error('No signed URL returned');
  return data.signedUrl;
}

// ─── Writes (RPCs) ────────────────────────────────────────────────────────

export interface CreateFlashReportInput {
  jobId: string;
  category: FlashReportCategory;
  severity: FlashReportSeverity;
  title: string;
  description: string;
  locationText?: string | null;
  occurredAt?: string | null;
}

export interface CreateFlashReportResult {
  id: string;
  correlation_id: string;
  reporter_role: FlashReportReporterRole;
}

export async function createFlashReport(
  input: CreateFlashReportInput,
): Promise<CreateFlashReportResult> {
  const { data, error } = await supabase.rpc('flash_report_create', {
    p_job_id:        input.jobId,
    p_category:      input.category,
    p_severity:      input.severity,
    p_title:         input.title,
    p_description:   input.description,
    p_location_text: input.locationText ?? null,
    p_occurred_at:   input.occurredAt ?? null,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error('flash_report_create returned non-ok response');
  return {
    id: data.id,
    correlation_id: data.correlation_id,
    reporter_role: data.reporter_role,
  };
}

export async function transitionFlashReport(
  id: string,
  toStatus: FlashReportStatus,
  notes?: string | null,
): Promise<{ from: FlashReportStatus; to: FlashReportStatus }> {
  const { data, error } = await supabase.rpc('flash_report_transition', {
    p_id: id,
    p_to_status: toStatus,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error('flash_report_transition returned non-ok response');
  return { from: data.from, to: data.to };
}

// ─── Attachments ──────────────────────────────────────────────────────────

/**
 * Two-step upload: (1) push the blob into Supabase Storage at the
 * canonical {report_id}/{uploader_id}/{filename} path; (2) record the
 * metadata via flash_report_add_attachment RPC.
 *
 * Callers pass the local file URI from expo-image-picker or
 * expo-document-picker plus a derived filename. Mime + size are
 * propagated through so the metadata row is self-describing.
 */
export interface UploadAttachmentInput {
  reportId: string;
  kind: FlashReportAttachmentKind;
  /** Local URI (file://...) on iOS/Android. */
  localUri: string;
  /** Filename to use in storage (extension matters for content-type). */
  filename: string;
  mimeType?: string | null;
  caption?: string | null;
}

export async function uploadAndAttach(
  input: UploadAttachmentInput,
): Promise<{ attachmentId: string; storagePath: string }> {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) throw new Error('Not authenticated');

  // Read the file as ArrayBuffer. Use FileSystem on RN.
  const FileSystem = await import('expo-file-system');
  const base64 = await FileSystem.readAsStringAsync(input.localUri, {
    encoding: 'base64' as any,
  });
  // base64 → ArrayBuffer (we lean on base64-arraybuffer like the existing helper).
  const arrayBuffer = await import('base64-arraybuffer').then((m) => m.decode(base64));

  // Canonical path: {report_id}/{uploader_id}/{timestamp-filename}
  const safeName = input.filename.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'evidence';
  const storagePath = `${input.reportId}/${user.id}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase
    .storage
    .from('flash-report-attachments')
    .upload(storagePath, arrayBuffer, {
      contentType: input.mimeType ?? 'application/octet-stream',
      upsert: false,
    });
  if (upErr) throw upErr;

  // Compute size by re-stating the base64 length / 0.75 (each 4 b64 chars = 3 bytes).
  const sizeBytes = Math.floor((base64.length * 3) / 4);

  const { data: attData, error: rpcErr } = await supabase.rpc('flash_report_add_attachment', {
    p_flash_report_id: input.reportId,
    p_kind: input.kind,
    p_storage_path: storagePath,
    p_mime_type: input.mimeType ?? null,
    p_size_bytes: sizeBytes,
    p_caption: input.caption ?? null,
  });
  if (rpcErr) {
    // Best-effort cleanup of the orphaned blob — non-fatal if it fails.
    await supabase.storage.from('flash-report-attachments').remove([storagePath]).catch(() => {});
    throw rpcErr;
  }
  if (!attData?.ok) throw new Error('flash_report_add_attachment returned non-ok');
  return { attachmentId: attData.attachment_id, storagePath };
}

// ─── State-machine introspection (for the UI) ─────────────────────────────

export interface TransitionOption {
  to: FlashReportStatus;
  label: string;
  destructive?: boolean;
}

/**
 * Returns the legal transitions a given caller can perform on a report.
 * Pure function over (reporter, current status, caller role on this job).
 * The server still enforces the rules — this is for hiding affordances.
 */
export function legalTransitions(opts: {
  current: FlashReportStatus;
  callerRoleOnJob: 'inspector' | 'client' | 'agency' | 'super_admin' | 'other';
  callerIsReporter: boolean;
}): TransitionOption[] {
  const { current, callerRoleOnJob, callerIsReporter } = opts;
  const isAdmin = callerRoleOnJob === 'super_admin';
  const isParty = ['inspector','client','agency','super_admin'].includes(callerRoleOnJob);
  if (!isParty) return [];

  const out: TransitionOption[] = [];

  if (current === 'open') {
    if (!callerIsReporter || isAdmin) {
      out.push({ to: 'acknowledged', label: 'Acknowledge' });
    }
    if (!isAdmin) {
      out.push({ to: 'disputed', label: 'Dispute', destructive: true });
    }
  }
  if (current === 'acknowledged') {
    if (callerRoleOnJob === 'inspector' || isAdmin) {
      out.push({ to: 'in_remediation', label: 'Move to remediation' });
    }
    if (!isAdmin) {
      out.push({ to: 'disputed', label: 'Dispute', destructive: true });
    }
  }
  if (current === 'in_remediation') {
    if (callerRoleOnJob === 'inspector' || isAdmin) {
      out.push({ to: 'resolved', label: 'Mark resolved' });
    }
    if (!isAdmin) {
      out.push({ to: 'disputed', label: 'Dispute', destructive: true });
    }
  }
  if (current === 'resolved' && isAdmin) {
    out.push({ to: 'closed', label: 'Close (admin)' });
  }
  if (current === 'disputed' && isAdmin) {
    out.push({ to: 'acknowledged', label: 'Resolve dispute → acknowledge' });
  }

  return out;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
