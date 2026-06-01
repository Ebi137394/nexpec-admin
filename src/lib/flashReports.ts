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
// #QA — raises route through the offline outbox (never a direct write), so a
// Flash Report raised with no signal is queued + retried, not lost.
import {
  enqueueFlashReportRaise,
  enqueueFlashReportTransition,
  newClientId,
  isOnline,
  flushQueue,
  opStillQueued,
} from '@/lib/offline';

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

export interface RaiseAttachmentInput {
  kind: FlashReportAttachmentKind;
  /** Local URI (file://…) from expo-image-picker / expo-document-picker. */
  localUri: string;
  /** Filename; the extension drives the storage content-type. */
  filename: string;
  mimeType?: string | null;
  caption?: string | null;
}

export interface RaiseFlashReportResult {
  /** Client-known report id — navigable immediately. */
  id: string;
  /** True if the report + evidence reached the server before this resolved
   *  (online). False when queued offline; it drains on reconnect. */
  synced: boolean;
}

/**
 * Raise a Flash Report (NCR) + its evidence as a SINGLE offline-safe outbox op.
 *
 * Field screens run with no signal, so this NEVER writes directly (that was the
 * data-loss bug: an offline raise threw "Network request failed" and queued
 * nothing). It mints a client-known report id, derives each evidence file's
 * stable storage path from the LOCAL session, and enqueues one
 * `flash_report_raise` op — create → upload → add_attachment, idempotent
 * end-to-end (migration 20260718). Online, it awaits the drain so the caller can
 * open the populated report; offline it returns synced=false and drains later.
 */
export async function raiseFlashReport(
  input: CreateFlashReportInput,
  attachments: RaiseAttachmentInput[] = [],
): Promise<RaiseFlashReportResult> {
  const reportId = newClientId();

  // Uploader id from the LOCAL session — getSession() reads the cached token, so
  // it works offline — keeping the RLS-checked path {reportId}/{uploaderId}/…
  // correct and stable across retries.
  const { data: sessionData } = await supabase.auth.getSession();
  const uploaderId = sessionData?.session?.user?.id ?? 'unknown';

  const atts = attachments.map((a, idx) => {
    const safeName = a.filename.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'evidence';
    return {
      localUri: a.localUri,
      // idx disambiguates files captured within the same millisecond.
      storagePath: `${reportId}/${uploaderId}/${Date.now()}-${idx}-${safeName}`,
      kind: a.kind,
      mimeType: a.mimeType ?? null,
      caption: a.caption ?? null,
    };
  });

  const opId = await enqueueFlashReportRaise({
    createArgs: {
      p_job_id:        input.jobId,
      p_category:      input.category,
      p_severity:      input.severity,
      p_title:         input.title,
      p_description:   input.description,
      p_location_text: input.locationText ?? null,
      p_occurred_at:   input.occurredAt ?? null,
      p_client_id:     reportId,
    },
    bucket: 'flash-report-attachments',
    attachments: atts,
  });

  // Online → drain now so the report exists when we navigate to it. A flaky
  // write that fails mid-drain leaves the op queued; opStillQueued reports that
  // honestly as synced=false (the caller then confirms "saved, will sync").
  let synced = false;
  if (isOnline()) {
    try {
      await flushQueue();
    } catch {
      /* drain error → op stays queued → reported unsynced below */
    }
    synced = !(await opStillQueued(opId));
  }

  return { id: reportId, synced };
}

export async function transitionFlashReport(
  id: string,
  toStatus: FlashReportStatus,
  notes?: string | null,
): Promise<{ from: FlashReportStatus; to: FlashReportStatus }> {
  // #QA — route through the offline outbox (idempotent + retried) instead of a
  // direct RPC, so a transition on flaky/no signal queues rather than failing.
  // Online, await the drain so the caller's refresh sees the applied state.
  await enqueueFlashReportTransition({ id, toStatus, notes: notes ?? null });
  if (isOnline()) {
    try {
      await flushQueue();
    } catch {
      /* a drain error leaves the op queued — it retries on reconnect */
    }
  }
  // The caller refreshes from the server; `from` is not known client-side.
  return { from: toStatus, to: toStatus };
}

// ─── Attachments ──────────────────────────────────────────────────────────
//
// Evidence is no longer uploaded directly here. It rides with the report inside
// the single offline-safe `raiseFlashReport()` op above (upload + record happen
// in the outbox handler on drain), so raising with no signal queues everything
// instead of throwing "Network request failed" and losing the evidence.
// Render-time reads still use signedAttachmentUrl() above.

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
