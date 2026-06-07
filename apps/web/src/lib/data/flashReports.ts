// ════════════════════════════════════════════════════════════════════════════
//  lib/data/flashReports.ts — Flash Report (NCR) read layer for the web.
//
//  Web mirror of the mobile src/lib/flashReports.ts contract. The entire
//  backend is shared and platform-agnostic:
//    • Reads   — direct RLS-gated SELECT on flash_reports / flash_report_attachments
//    • Writes  — SECURITY DEFINER RPCs (see lib/actions/flashReports.ts)
//    • Evidence — private bucket `flash-report-attachments`, 15-min signed URLs
//
//  No PII: a flash report carries reporter_ROLE (inspector/client/…), never a
//  name, so this is safe for every party surface (anti-poaching unaffected).
//
//  GOLDEN_RULE — RLS scopes rows to the job's parties (+ super_admin); we never
//  widen the projection. legalTransitions() below is a verbatim port of the
//  mobile pure function; it only hides affordances — the server still enforces.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

// ─── Enums (byte-identical to mobile + the DB CHECK constraints) ────────────

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

export type FlashReportAttachmentKind = 'photo' | 'pdf' | 'document' | 'other';

/** The viewer's role on THIS job — drives which transitions render. */
export type FlashReportViewerRole =
  | 'inspector'
  | 'client'
  | 'agency'
  | 'super_admin'
  | 'other';

// ─── Display labels (ported from mobile *_META) ─────────────────────────────

export const CATEGORY_LABEL: Record<FlashReportCategory, string> = {
  calibration: 'Calibration',
  documentation: 'Documentation',
  safety: 'Safety',
  procedure: 'Procedure',
  defect: 'Defect',
  client_interference: 'Client interference',
  other: 'Other',
};

export const SEVERITY_LABEL: Record<FlashReportSeverity, string> = {
  observation: 'Observation',
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
};

export const STATUS_LABEL: Record<FlashReportStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  in_remediation: 'In remediation',
  resolved: 'Resolved',
  closed: 'Closed',
  disputed: 'Disputed',
};

export const REPORTER_ROLE_LABEL: Record<FlashReportReporterRole, string> = {
  inspector: 'Inspector',
  client: 'Client',
  agency: 'Agency',
  super_admin: 'Admin',
};

// ─── View models (camelCase) ────────────────────────────────────────────────

export interface FlashReportAttachmentView {
  id: string;
  kind: FlashReportAttachmentKind;
  caption: string | null;
  mimeType: string | null;
  /** 15-min signed URL, or null if signing failed (bucket is private). */
  signedUrl: string | null;
}

export interface FlashReportView {
  id: string;
  jobId: string;
  reporterId: string;
  reporterRole: FlashReportReporterRole;
  category: FlashReportCategory;
  severity: FlashReportSeverity;
  title: string;
  description: string;
  locationText: string | null;
  occurredAt: string | null;
  status: FlashReportStatus;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: FlashReportAttachmentView[];
}

export interface FlashReportFeed {
  /** auth.uid() — used to decide callerIsReporter for transition gating. */
  viewerId: string | null;
  reports: FlashReportView[];
}

// ─── State-machine introspection (verbatim port of mobile legalTransitions) ──

export interface TransitionOption {
  to: FlashReportStatus;
  label: string;
  destructive?: boolean;
}

/**
 * Legal transitions a given caller can perform on a report. Pure function over
 * (current status, caller role on this job, whether the caller is the reporter).
 * The server (flash_report_transition) still enforces — this only hides buttons.
 */
export function legalTransitions(opts: {
  current: FlashReportStatus;
  callerRoleOnJob: FlashReportViewerRole;
  callerIsReporter: boolean;
}): TransitionOption[] {
  const { current, callerRoleOnJob, callerIsReporter } = opts;
  const isAdmin = callerRoleOnJob === 'super_admin';
  const isParty = ['inspector', 'client', 'agency', 'super_admin'].includes(
    callerRoleOnJob,
  );
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

// ─── Read ───────────────────────────────────────────────────────────────────

const BUCKET = 'flash-report-attachments';
const SIGNED_TTL_SECONDS = 60 * 15;

function asKind(v: unknown): FlashReportAttachmentKind {
  return v === 'photo' || v === 'pdf' || v === 'document' || v === 'other'
    ? v
    : 'other';
}

/**
 * All flash reports for a job (newest first), each with its evidence attachments
 * resolved to short-lived signed URLs. RLS scopes which rows the caller sees:
 * the job's inspector / client / agency, and super_admin.
 */
export async function fetchFlashReportsForJob(
  jobId: string,
): Promise<FlashReportFeed> {
  if (!jobId) return { viewerId: null, reports: [] };

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { viewerId: null, reports: [] };

    const { data, error } = await supabase
      .from('flash_reports')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchFlashReportsForJob] failed:', error.message);
      }
      return { viewerId: user.id, reports: [] };
    }

    const rows = data as unknown as Record<string, unknown>[];
    const ids = rows.map((r) => String(r.id));

    // Pull every attachment in one query, then batch-sign in one call.
    const attByReport = new Map<string, FlashReportAttachmentView[]>();
    if (ids.length > 0) {
      const { data: attData } = await supabase
        .from('flash_report_attachments')
        .select('*')
        .in('flash_report_id', ids)
        .order('created_at', { ascending: true });

      const atts = (attData ?? []) as unknown as Record<string, unknown>[];
      const paths = atts.map((a) => String(a.storage_path));
      const signedByPath = new Map<string, string>();
      if (paths.length > 0) {
        try {
          const { data: signed } = await supabase.storage
            .from(BUCKET)
            .createSignedUrls(paths, SIGNED_TTL_SECONDS);
          for (const s of signed ?? []) {
            if (s?.path && s.signedUrl) signedByPath.set(s.path, s.signedUrl);
          }
        } catch {
          /* leave URLs null — the card renders an "unavailable" chip */
        }
      }

      for (const a of atts) {
        const reportId = String(a.flash_report_id);
        const path = String(a.storage_path);
        const view: FlashReportAttachmentView = {
          id: String(a.id),
          kind: asKind(a.kind),
          caption: (a.caption as string | null) ?? null,
          mimeType: (a.mime_type as string | null) ?? null,
          signedUrl: signedByPath.get(path) ?? null,
        };
        const list = attByReport.get(reportId) ?? [];
        list.push(view);
        attByReport.set(reportId, list);
      }
    }

    const reports: FlashReportView[] = rows.map((r) => {
      const id = String(r.id);
      return {
        id,
        jobId: String(r.job_id),
        reporterId: String(r.reporter_id),
        reporterRole: (r.reporter_role as FlashReportReporterRole) ?? 'inspector',
        category: (r.category as FlashReportCategory) ?? 'other',
        severity: (r.severity as FlashReportSeverity) ?? 'observation',
        title: String(r.title ?? '(untitled)'),
        description: String(r.description ?? ''),
        locationText: (r.location_text as string | null) ?? null,
        occurredAt: (r.occurred_at as string | null) ?? null,
        status: (r.status as FlashReportStatus) ?? 'open',
        acknowledgedAt: (r.acknowledged_at as string | null) ?? null,
        resolvedAt: (r.resolved_at as string | null) ?? null,
        resolutionNotes: (r.resolution_notes as string | null) ?? null,
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at ?? r.created_at),
        attachments: attByReport.get(id) ?? [],
      };
    });

    return { viewerId: user.id, reports };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchFlashReportsForJob] threw:', e);
    }
    return { viewerId: null, reports: [] };
  }
}
