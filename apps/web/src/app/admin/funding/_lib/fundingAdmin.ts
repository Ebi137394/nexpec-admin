// ════════════════════════════════════════════════════════════════════════════
//  app/admin/funding/_lib/fundingAdmin.ts — server reads for the Admin
//  funding schedule surface.
//
//  The funding schedule itself is read ONLY through
//  @nexpec/shared-core/net → fetchAdminFunding(). There is deliberately no
//  `.from('job_funding_stages')` anywhere in this route: that shared accessor
//  is the single place stage rows become an audience-scoped projection, and
//  reaching around it is exactly how a payout ends up in a client bundle.
//
//  Job metadata (title, status, payout state) comes from `jobs_secure_view`,
//  which NULLs every margin column for non-admins. RLS remains the authority;
//  the projection types are defence in depth on top of it.
//
//  NOTHING IN THIS FILE MOVES MONEY. It reads. The only write in this route is
//  the terms override in ../_actions/setFundingTerms.ts, and that write
//  touches job_funding_stages only.
// ════════════════════════════════════════════════════════════════════════════

import { isAdminProjection } from '@nexpec/shared-core/domain';
import { fetchAdminFunding } from '@nexpec/shared-core/net';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import { withFundingCore } from './core';
import type {
  AdminFundingRecord,
  FundingAuditEntry,
  FundingJobRow,
  FundingRosterEntry,
} from './fundingAdmin.types';

/**
 * Roster cap. Each entry costs one indexed read of job_funding_stages
 * (job_funding_stages_job_idx) through fetchAdminFunding. Kept deliberately
 * small: the alternative — a bulk `select` on the stage table — would bypass
 * the one accessor that enforces the audience projection.
 */
const ROSTER_LIMIT = 40;

const JOB_COLUMNS = [
  'id',
  'title',
  'location',
  'status',
  'payment_mode',
  'created_at',
  'updated_at',
  'client_id',
  'contractor_id',
  'client_price_cents',
  'payout_amount_cents',
  'client_settled_at',
  'admin_confirmed_at',
  'payout_status',
  'payout_paid_at',
  'payout_reference',
].join(', ');

const AUDIT_COLUMNS =
  'id, created_at, event_type, severity, summary, actor_label, actor_role, correlation_id';

type RawRow = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function int(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
}

function toJobRow(
  raw: RawRow,
  profiles: Map<string, { full_name: string | null; email: string | null }>,
): FundingJobRow {
  const clientId = str(raw.client_id);
  const contractorId = str(raw.contractor_id);
  const client = clientId ? profiles.get(clientId) : undefined;
  const contractor = contractorId ? profiles.get(contractorId) : undefined;

  return {
    id: String(raw.id),
    title: str(raw.title),
    location: str(raw.location),
    status: str(raw.status),
    paymentMode: str(raw.payment_mode),
    createdAt: str(raw.created_at),
    updatedAt: str(raw.updated_at),
    clientId,
    clientName: client?.full_name ?? null,
    clientEmail: client?.email ?? null,
    contractorId,
    contractorName: contractor?.full_name ?? null,
    contractorEmail: contractor?.email ?? null,
    clientPriceCents: int(raw.client_price_cents),
    inspectorPayoutCents: int(raw.payout_amount_cents),
    legacyClientSettledAt: str(raw.client_settled_at),
    adminConfirmedAt: str(raw.admin_confirmed_at),
    payoutStatus: str(raw.payout_status),
    payoutPaidAt: str(raw.payout_paid_at),
    payoutReference: str(raw.payout_reference),
  };
}

/** One query hydrating every client + inspector name on the page. */
async function hydrateProfiles(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  rows: RawRow[],
): Promise<Map<string, { full_name: string | null; email: string | null }>> {
  const ids = new Set<string>();
  for (const r of rows) {
    const c = str(r.client_id);
    const k = str(r.contractor_id);
    if (c) ids.add(c);
    if (k) ids.add(k);
  }

  const map = new Map<string, { full_name: string | null; email: string | null }>();
  if (ids.size === 0) return map;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', Array.from(ids));

  if (error) {
    console.warn('[admin/funding] profiles query failed:', error.message);
    return map;
  }
  for (const p of data ?? []) {
    map.set(String(p.id), {
      full_name: str(p.full_name),
      email: str(p.email),
    });
  }
  return map;
}

/* ── roster ───────────────────────────────────────────────────────────────── */

export interface FundingRosterResult {
  entries: FundingRosterEntry[];
  /** True when the underlying job query failed, as opposed to returning none. */
  unavailable: boolean;
}

/**
 * Jobs whose funding an admin may need to look at: everything priced and not
 * cancelled, newest activity first.
 */
export async function fetchFundingRoster(): Promise<FundingRosterResult> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('jobs_secure_view')
    .select(JOB_COLUMNS)
    .neq('status', 'cancelled')
    .not('client_price_cents', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(ROSTER_LIMIT);

  if (error) {
    console.warn('[admin/funding] roster query failed:', error.message);
    return { entries: [], unavailable: true };
  }

  // `jobs_secure_view` is not in the generated Supabase types, so the client
  // widens `data` to GenericStringError[] and a direct cast has no overlap
  // (TS2352). Going through `unknown` is what the compiler itself suggests.
  // Safe here: the view's column set mirrors public.jobs (318000:141) and
  // JOB_COLUMNS is an explicit list, never select('*').
  const rows = (data ?? []) as unknown as RawRow[];
  if (rows.length === 0) return { entries: [], unavailable: false };

  const profiles = await hydrateProfiles(supabase, rows);
  const jobs = rows.map((r) => toJobRow(r, profiles));

  // ── one bind, then every reader entered synchronously ────────────────────
  // `jobs.map(...)` runs to completion in this tick, and fetchAdminFunding
  // captures the bound client synchronously (see _lib/core.ts). No await can
  // slip between the bind and any of these captures.
  const projections = await withFundingCore(() =>
    Promise.all(
      jobs.map((job) =>
        fetchAdminFunding({
          jobId: job.id,
          clientPriceCents: job.clientPriceCents ?? 0,
          inspectorPayoutCents: job.inspectorPayoutCents ?? 0,
        }),
      ),
    ),
  );

  const entries: FundingRosterEntry[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const funding = projections[i];
    const job = jobs[i];
    if (!job || !funding || !isAdminProjection(funding)) continue;
    entries.push({ job, funding });
  }

  return { entries, unavailable: false };
}

/* ── one job ──────────────────────────────────────────────────────────────── */

/** Audit rows an admin cares about on a funding screen, newest first. */
async function fetchFundingAudit(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  jobId: string,
): Promise<{ audit: FundingAuditEntry[]; unavailable: boolean }> {
  const { data, error } = await supabase
    .from('audit_events')
    .select(AUDIT_COLUMNS)
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.warn('[admin/funding] audit query failed:', error.message);
    return { audit: [], unavailable: true };
  }

  const audit = ((data ?? []) as RawRow[]).map((r) => {
    const severity = str(r.severity);
    return {
      id: String(r.id),
      createdAt: str(r.created_at) ?? '',
      eventType: str(r.event_type) ?? 'unknown',
      severity:
        severity === 'critical' || severity === 'warning' ? severity : 'info',
      summary: str(r.summary) ?? '',
      actorLabel: str(r.actor_label),
      actorRole: str(r.actor_role),
      correlationId: str(r.correlation_id),
    } satisfies FundingAuditEntry;
  });

  return { audit, unavailable: false };
}

export async function fetchFundingRecord(
  jobId: string,
): Promise<AdminFundingRecord | null> {
  if (!jobId) return null;

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('jobs_secure_view')
    .select(JOB_COLUMNS)
    .eq('id', jobId)
    .maybeSingle();

  if (error) {
    console.warn('[admin/funding] job query failed:', error.message);
    return null;
  }
  if (!data) return null;

  // Same TS2352 as fetchFundingRoster — see the note there.
  const raw = data as unknown as RawRow;
  const profiles = await hydrateProfiles(supabase, [raw]);
  const job = toJobRow(raw, profiles);

  const funding = await withFundingCore(() =>
    fetchAdminFunding({
      jobId: job.id,
      clientPriceCents: job.clientPriceCents ?? 0,
      inspectorPayoutCents: job.inspectorPayoutCents ?? 0,
    }),
  );

  // Narrowing at the boundary, per the contract's own instruction: if a future
  // refactor ever swapped this reader for a client- or inspector-scoped one,
  // this screen must fail loudly rather than render half a projection.
  if (!isAdminProjection(funding)) {
    throw new Error(
      '[admin/funding] expected an admin funding projection; refusing to render both-sides money from anything else.',
    );
  }

  const { audit, unavailable } = await fetchFundingAudit(supabase, job.id);

  return { job, funding, audit, auditUnavailable: unavailable };
}

/**
 * Stage statuses only, re-read server-side before a terms rewrite. The action
 * must never trust a hidden form field about whether money is already in.
 */
export async function fetchFundingForRewrite(jobId: string) {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('jobs_secure_view')
    .select('id, status, client_price_cents, payout_amount_cents')
    .eq('id', jobId)
    .maybeSingle();

  if (error || !data) return null;

  const raw = data as RawRow;
  const clientPriceCents = int(raw.client_price_cents) ?? 0;
  const inspectorPayoutCents = int(raw.payout_amount_cents) ?? 0;

  const funding = await withFundingCore(() =>
    fetchAdminFunding({ jobId, clientPriceCents, inspectorPayoutCents }),
  );

  if (!isAdminProjection(funding)) return null;
  return { status: str(raw.status), funding };
}
