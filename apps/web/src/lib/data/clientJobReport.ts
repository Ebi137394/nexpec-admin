// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientJobReport.ts — fetcher for the report-approval surface
//
//  Three reads:
//    1. The job row (ownership-gated by client_id = auth.uid()).
//    2. The inspector's profile (display only).
//    3. The most recent client-originated event for this job in
//       audit_events — used to render an idempotent UI ("you already
//       approved this report on May 17 14:00") instead of re-firing the
//       signal on every click.
//
//  GOLDEN_RULE_2 — Selects only client_price_cents, never inspector
//  payout columns. The inspector identity is displayed; their bid /
//  payout is not.
//  GOLDEN_RULE_6 — adminConfirmedAt determines whether the surface even
//  renders the approval CTAs. Until admin has handed off, the page
//  shows a "report still with admin" empty state.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { nxHandle } from '@/lib/identity/inspectorHandle';
import type {
  ClientReportSignal,
  ClientReportState,
} from './clientJobReport.types';

export type { ClientReportSignal, ClientReportState };

const APPROVAL_EVENT_TYPES = [
  'job.client_approved_report',
  'job.client_requested_revision',
] as const;

export async function fetchClientJobReport(
  jobId: string,
): Promise<ClientReportState | null> {
  if (!jobId) return null;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // 1. Job row, ownership-gated.
    //    GOLDEN_RULE_2 — explicit projection, no inspector payout columns.
    const { data: rawJob, error: jobErr } = await supabase
      .from('jobs_secure_view')
      .select(
        'id, title, status, client_price_cents, payout_status, admin_confirmed_at, hired_inspector_id, contractor_id',
      )
      .eq('id', jobId)
      .eq('client_id', user.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (jobErr || !rawJob) {
      if (jobErr && typeof console !== 'undefined') {
        console.warn('[fetchClientJobReport] job lookup failed:', jobErr.message);
      }
      return null;
    }

    const j = rawJob as unknown as Record<string, unknown>;

    // 2. Inspector identity — IDENTITY ESCROW. Resolve the real name ONLY
    //    after the reveal boundary (admin forwarded the report, or the job is
    //    completed). Pre-reveal the client sees the pseudonymous NX- handle.
    const inspectorId =
      ((j.hired_inspector_id as string | null) ?? null) ||
      ((j.contractor_id as string | null) ?? null);

    const identityRevealed =
      !!(j.admin_confirmed_at as string | null) ||
      String(j.status ?? '') === 'completed';

    let inspectorFullName: string | null = null;
    let inspectorCompanyName: string | null = null;
    if (inspectorId && identityRevealed) {
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, company_name')
        .eq('id', inspectorId)
        .maybeSingle();
      if (prof) {
        const p = prof as unknown as Record<string, unknown>;
        inspectorFullName = (p.full_name as string | null) ?? null;
        inspectorCompanyName = (p.company_name as string | null) ?? null;
      }
    }
    const inspectorHandle = inspectorId ? nxHandle(inspectorId) : null;

    // 3. Latest client-originated signal in audit_events for this job.
    const { data: rawEvents } = await supabase
      // Price-blind + identity-blind redacted view (non-admin readers must use
      // this; the raw audit_events table is admin-only after 20260801230000).
      .from('audit_events_public')
      .select('event_type, created_at, summary, metadata')
      .eq('subject_table', 'jobs')
      .eq('subject_id', jobId)
      .eq('actor_id', user.id)
      .in('event_type', APPROVAL_EVENT_TYPES as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(1);

    let latest: ClientReportSignal = { kind: 'none' };
    const ev = rawEvents?.[0] as unknown as Record<string, unknown> | undefined;
    if (ev) {
      const t = String(ev.event_type);
      const at = String(ev.created_at);
      if (t === 'job.client_approved_report') {
        latest = { kind: 'approved', at };
      } else if (t === 'job.client_requested_revision') {
        const meta = (ev.metadata as Record<string, unknown> | null) ?? null;
        const reason = (meta?.reason as string | null) ?? null;
        latest = { kind: 'revision_requested', at, reason };
      }
    }

    return {
      jobId: String(j.id),
      jobTitle: String(j.title ?? '(untitled)'),
      adminConfirmedAt: (j.admin_confirmed_at as string | null) ?? null,
      clientPriceCents:
        typeof j.client_price_cents === 'string'
          ? Number(j.client_price_cents)
          : (j.client_price_cents as number | null) ?? null,
      inspectorFullName,
      inspectorCompanyName,
      inspectorHandle,
      payoutStatus: (j.payout_status as string | null) ?? null,
      status: String(j.status ?? ''),
      latestClientSignal: latest,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchClientJobReport] threw:', e);
    }
    return null;
  }
}
