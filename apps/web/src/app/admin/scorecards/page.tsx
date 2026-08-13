// ════════════════════════════════════════════════════════════════════════════
//  app/admin/scorecards/page.tsx — NEXPEC Supplier Scorecards console
//
//  20260801470000 shipped Supplier Scorecards as DATABASE ONLY: the three
//  config tables and every nx_supplier_scorecard* RPC had zero callers, and no
//  route reached any of them. A migration is not a completed product phase
//  until its workflow is reachable, so this is that surface.
//
//  ── NOTHING HERE IS STORED ─────────────────────────────────────────────────
//  There is no scorecard table to read. Every figure on this page is derived at
//  request time by nx_supplier_scorecard, which sums operational rows (quotes,
//  ITP points, flash reports, vendor documents, job schedules) and applies the
//  single rounding rule in the system. This page therefore performs NO scoring
//  arithmetic of its own — it renders what the RPC returned.
//
//  ── PERFORMANCE ONLY. NO MONEY. ────────────────────────────────────────────
//  A scorecard measures performance. This route reads no wallet, ledger,
//  payout, settlement or price column, and renders no client_price_cents, no
//  inspector_payout_cents and no platform spread or margin. The migration's
//  selftest §7h fails the build if any scorecard function so much as mentions a
//  money surface; this surface keeps the same discipline.
//
//  ── THE PAGE IS BOUNDED, AND SAYS SO ───────────────────────────────────────
//  A scorecard is one RPC per supplier and each RPC walks seven metrics, so the
//  list is genuinely paginated against supplier_directory rather than
//  pretending to show everyone. The pager is server-side, so the counts on
//  screen are the counts in the database.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ScorecardsConsole } from './ScorecardsConsole';
import type {
  ConfidenceBandRow,
  Scorecard,
  ScorecardMetricConfig,
  ScorecardPolicy,
  ScorecardResult,
  SupplierRow,
} from './types';

export const metadata: Metadata = { title: 'Supplier Scorecards · NEXPEC Admin' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

interface PageProps {
  searchParams: Promise<{ page?: string }>;
}

function isForbidden(e: { message?: string; code?: string } | null): boolean {
  if (!e) return false;
  return (
    e.code === '42501' ||
    e.code === 'PGRST301' ||
    /not[_ ]authorized|permission denied|row-level security/i.test(
      e.message ?? '',
    )
  );
}

export default async function AdminScorecardsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const parsed = Number.parseInt(sp.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createSupabaseServerClient();

  // Explicit column lists everywhere — never select('*').
  const [suppliersRes, bandsRes, policyRes, registryRes] = await Promise.all([
    supabase
      .from('supplier_directory')
      .select(
        'id, legal_name, headline, country_code, rating_avg, rating_count, verified',
        { count: 'exact' },
      )
      .order('legal_name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1),
    supabase
      .from('supplier_scorecard_confidence_bands')
      .select('band, min_sample, rounding_step, label, sort')
      .order('sort', { ascending: true }),
    supabase
      .from('supplier_scorecard_policy')
      .select('min_metrics_for_composite, confidence_z_milli')
      .eq('id', 1)
      .maybeSingle(),
    supabase
      .from('supplier_scorecard_metrics')
      .select(
        'metric_key, label, dimension, weight_bps, min_sample_size, evidence_source, measures, is_active, sort',
      )
      .eq('is_active', true)
      .order('sort', { ascending: true }),
  ]);

  // The supplier list is the spine of this page. If it failed, say so — an
  // operator must never read "no suppliers" when the truth is "the read broke".
  if (suppliersRes.error) {
    const forbidden = isForbidden(suppliersRes.error);
    return (
      <main>
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-white">
            Supplier Scorecards
          </h1>
        </header>
        <div
          role="alert"
          className={`rounded-2xl border p-5 text-sm ${
            forbidden
              ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
              : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}
        >
          {forbidden
            ? 'You do not have permission to read the supplier directory. This is an authorisation refusal, not an empty directory.'
            : 'Could not load the supplier directory. This is a read failure, not an empty directory — no scorecard has been computed.'}
          <span className="mt-2 block text-xs opacity-70">
            {suppliersRes.error.message}
          </span>
        </div>
      </main>
    );
  }

  const suppliers = (suppliersRes.data ?? []) as unknown as SupplierRow[];
  const total = suppliersRes.count ?? suppliers.length;

  // The confidence ladder is DATA, not a rule in this component. If it could
  // not be read, the console still renders but says the ladder is missing
  // rather than silently substituting hard-coded thresholds.
  const bands = (bandsRes.data ?? []) as unknown as ConfidenceBandRow[];
  const policy =
    (policyRes.data as unknown as ScorecardPolicy | null) ?? null;
  const registry =
    (registryRes.data ?? []) as unknown as ScorecardMetricConfig[];

  const configError =
    bandsRes.error?.message ??
    policyRes.error?.message ??
    registryRes.error?.message ??
    null;

  // One scorecard per supplier on this page. nx_supplier_scorecard raises
  // NOT_AUTHORIZED rather than returning an empty card, so a refusal is caught
  // here and carried as its own state — never flattened into "no score".
  const cardEntries = await Promise.all(
    suppliers.map(async (s): Promise<[string, ScorecardResult]> => {
      const { data, error } = await supabase.rpc('nx_supplier_scorecard', {
        p_supplier_id: s.id,
      });
      if (error) {
        return [
          s.id,
          isForbidden(error)
            ? { state: 'forbidden' }
            : { state: 'failed', message: error.message },
        ];
      }
      if (!data) {
        return [
          s.id,
          { state: 'failed', message: 'The scorecard returned nothing.' },
        ];
      }
      return [s.id, { state: 'ok', card: data as unknown as Scorecard }];
    }),
  );

  const cards: Record<string, ScorecardResult> =
    Object.fromEntries(cardEntries);

  return (
    <ScorecardsConsole
      suppliers={suppliers}
      cards={cards}
      bands={bands}
      policy={policy}
      registry={registry}
      configError={configError}
      page={page}
      pageSize={PAGE_SIZE}
      total={total}
    />
  );
}
