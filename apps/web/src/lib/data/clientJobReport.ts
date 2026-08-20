// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientJobReport.ts — fetcher for the report-approval surface
//
//  Four reads:
//    1. The job row (ownership-gated by client_id = auth.uid()).
//    2. The inspector's profile (display only).
//    3. The most recent client-originated event for this job in
//       audit_events — used to render an idempotent UI ("you already
//       approved this report on May 17 14:00") instead of re-firing the
//       signal on every click.
//    4. The report's id, so the approval surface can show WHAT is being
//       approved (its per-visit record and contributor attribution) rather
//       than only its price and status. Id only — no report content is read
//       here, and the id is null when no report row exists yet.
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
        // identity_mode is the admin-set disclosure policy (…284000); it lives
        // on jobs and therefore on jobs_secure_view (SELECT j.*).
        'id, title, status, client_price_cents, budget_cents, payout_status, admin_confirmed_at, hired_inspector_id, contractor_id, identity_mode',
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

    // ── AUTHORITATIVE CLIENT PRICE ──────────────────────────────────────────
    //  OWNER-REVIEW BUG: this tile rendered "$0" on a job whose price had not
    //  been set yet (jobs.client_price_cents defaults to 0 until an admin
    //  generates the contract), while the job page showed the real budget.
    //  "$0" tells the client they owe nothing — a materially wrong statement
    //  about their own money. Resolution order, no hardcoded amount:
    //    1. the live (non-voided) job contract — the committed, signed figure
    //    2. jobs.client_price_cents when it is actually set (> 0)
    //    3. null → the surface renders an honest "not set yet", never 0
    //  GOLDEN_RULE_2 is untouched: only client_price_cents is selected, never
    //  a payout or spread column.
    let resolvedClientPriceCents: number | null = null;
    let resolvedClientPriceSource: 'contract' | 'job' | 'budget' | null = null;
    {
      const rawJobPrice =
        typeof j.client_price_cents === 'string'
          ? Number(j.client_price_cents)
          : (j.client_price_cents as number | null) ?? null;

      const { data: contractRow } = await supabase
        .from('client_job_contracts_view')
        .select('client_price_cents')
        .eq('job_id', jobId)
        .neq('status', 'voided')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const contractPrice = contractRow
        ? Number((contractRow as Record<string, unknown>).client_price_cents ?? 0)
        : 0;

      const budget = Number(j.budget_cents ?? 0);

      if (contractPrice > 0) {
        resolvedClientPriceCents = contractPrice;
        resolvedClientPriceSource = 'contract';
      } else if (rawJobPrice && rawJobPrice > 0) {
        resolvedClientPriceCents = rawJobPrice;
        resolvedClientPriceSource = 'job';
      } else if (Number.isFinite(budget) && budget > 0) {
        // Same fallback the mobile approve screen already used; labelled as a
        // budget so it is never mistaken for an agreed contract price.
        resolvedClientPriceCents = budget;
        resolvedClientPriceSource = 'budget';
      }
    }

    // 2. Inspector identity — IDENTITY ESCROW.
    //
    //    FIX: the reveal boundary used to be "admin forwarded the report OR the
    //    job is completed" alone. That is NOT the disclosure rule. The
    //    authoritative policy is jobs.identity_mode (…284000), which
    //    client_job_contracts_view enforces for every other buyer surface:
    //    'protected' (the DEFAULT on every legacy job) means the client NEVER
    //    sees the real name. Because profiles RLS permits a job-sharing client
    //    to read the inspector's row (nx_can_read_profile, …248000), the old
    //    condition succeeded and printed the real name + company on the
    //    "Inspector on file" tile the moment admin confirmed — bypassing the
    //    policy. Disclosure now requires professional/full AND the existing
    //    workflow boundary (fail-closed: stricter than the DB rule, never
    //    looser).
    const inspectorId =
      ((j.hired_inspector_id as string | null) ?? null) ||
      ((j.contractor_id as string | null) ?? null);

    const identityMode = String(j.identity_mode ?? 'protected');
    const policyPermitsName =
      identityMode === 'professional' || identityMode === 'full';

    const identityRevealed =
      policyPermitsName &&
      (!!(j.admin_confirmed_at as string | null) ||
        String(j.status ?? '') === 'completed');

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

    // 4. The report id for this job. RLS ("Clients can view reports for their
    //    jobs") already scopes this to the caller's own jobs; the job lookup
    //    above has additionally proved ownership. A job can carry more than one
    //    report row (one per inspector), and approve_inspection_report acts on
    //    the whole job, so the oldest row is used as the job's report of
    //    record — the same row the admin queue lists first.
    let reportId: string | null = null;
    let reportSummary: string | null = null;
    let reportResult: string | null = null;
    let reportStatus: string | null = null;
    {
      // D22: this used to select ONLY `id`, so the client was asked to approve a
      // report whose findings were never fetched, let alone rendered. The
      // delivered content lives in `final_report_doc`. RLS already scopes this
      // read to the owning client ("Buyers and inspectors can view reports":
      // auth.uid() = j.client_id), so authorisation is enforced by the database
      // and this select cannot widen it.
      const { data: rep } = await supabase
        .from('inspection_reports')
        .select('id, status, final_report_doc, notes')
        .eq('job_id', jobId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      const r = rep as Record<string, unknown> | null;
      reportId = (r?.id as string) ?? null;
      reportStatus = (r?.status as string | null) ?? null;

      // Only a DELIVERED report is readable by the client. Without this an
      // in-flight draft or a report still in senior review would be exposed to
      // anyone who guessed the release URL.
      if (reportStatus === 'delivered') {
        // `final_report_doc` is a TEXT column holding JSON, not jsonb — casting
        // it straight to an object yields undefined for every field and the
        // page silently renders nothing, which is the very failure D22 is about.
        // Parse defensively and fall back to `notes` so a malformed document
        // degrades to the raw findings rather than to a blank page.
        let doc: Record<string, unknown> | null = null;
        const raw = r?.final_report_doc;
        if (typeof raw === 'string') {
          try {
            doc = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            doc = null;
          }
        } else if (raw && typeof raw === 'object') {
          doc = raw as Record<string, unknown>;
        }
        const summary =
          (doc?.summary as string | undefined) ?? (r?.notes as string | undefined);
        reportSummary = summary ? String(summary) : null;
        reportResult = doc?.result ? String(doc.result) : null;
      }
    }

    return {
      jobId: String(j.id),
      jobTitle: String(j.title ?? '(untitled)'),
      reportId,
      reportSummary,
      reportResult,
      reportStatus,
      adminConfirmedAt: (j.admin_confirmed_at as string | null) ?? null,
      clientPriceCents: resolvedClientPriceCents,
      clientPriceSource: resolvedClientPriceSource,
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
