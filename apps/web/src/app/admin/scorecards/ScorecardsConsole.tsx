'use client';

// ════════════════════════════════════════════════════════════════════════════
//  ScorecardsConsole — the supplier list, with honest overall scores.
//
//  Three separations this component exists to keep visible:
//
//   1. NOT SCORED ≠ ZERO. A supplier whose evidence has not reached the policy
//      minimum renders "Not scored" plus the server's reason. Sorting treats
//      those as unknown and parks them at the end rather than at 0, because
//      ordering them below a genuine 12 would be an assertion we cannot make.
//
//   2. DERIVED SCORECARD ≠ BUYER RATING. supplier_profiles.rating_avg is
//      subjective buyer sentiment and answers a different question. It is shown
//      only when rating_count > 0 — a supplier with no reviews shows "no
//      reviews", never a confident-looking 0.0. (The migration flags three
//      other web surfaces that do render that fake 0.0; they belong to other
//      lanes and are untouched here.)
//
//   3. THE PAGE IS A PAGE. Filtering and sorting act on the suppliers loaded
//      for this page only, and the control says so, so a filtered view is never
//      mistaken for a platform-wide answer.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Gauge,
  ArrowRight,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  BadgeCheck,
} from 'lucide-react';
import {
  ConfidenceChip,
  ScoreFigure,
  bandStyle,
} from './ScoreDisplay';
import {
  bandRank,
  toNumberOrNull,
  type ConfidenceBandRow,
  type ScorecardMetricConfig,
  type ScorecardPolicy,
  type ScorecardResult,
  type SupplierRow,
} from './types';

type SortKey = 'name' | 'score' | 'confidence';

export function ScorecardsConsole({
  suppliers,
  cards,
  bands,
  policy,
  registry,
  configError,
  page,
  pageSize,
  total,
}: {
  suppliers: SupplierRow[];
  cards: Record<string, ScorecardResult>;
  bands: ConfidenceBandRow[];
  policy: ScorecardPolicy | null;
  registry: ScorecardMetricConfig[];
  configError: string | null;
  page: number;
  pageSize: number;
  total: number;
}) {
  const [sort, setSort] = useState<SortKey>('name');
  const [bandFilter, setBandFilter] = useState<string>('all');

  const bandLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bands) m.set(b.band, b.label);
    return m;
  }, [bands]);

  const rows = useMemo(() => {
    const list = suppliers.map((s) => {
      const result = cards[s.id];
      const card = result?.state === 'ok' ? result.card : null;
      return {
        supplier: s,
        result,
        score: card?.overall_score ?? null,
        confidence: card?.overall_confidence ?? 'none',
      };
    });

    const filtered =
      bandFilter === 'all'
        ? list
        : list.filter((r) => r.confidence === bandFilter);

    const sorted = [...filtered];
    if (sort === 'name') {
      sorted.sort((a, b) =>
        a.supplier.legal_name.localeCompare(b.supplier.legal_name),
      );
    } else if (sort === 'score') {
      // Unscored suppliers sort LAST, not as zero. "We do not know" is not the
      // bottom of the scale.
      sorted.sort((a, b) => {
        if (a.score === null && b.score === null) return 0;
        if (a.score === null) return 1;
        if (b.score === null) return -1;
        return b.score - a.score;
      });
    } else {
      sorted.sort((a, b) => bandRank(b.confidence) - bandRank(a.confidence));
    }
    return sorted;
  }, [suppliers, cards, sort, bandFilter]);

  const start = (page - 1) * pageSize;
  const shownFrom = total === 0 ? 0 : start + 1;
  const shownTo = start + suppliers.length;
  const hasPrev = page > 1;
  const hasNext = shownTo < total;

  return (
    <main>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Supplier Scorecards</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Objective, derived supplier performance — computed at read time from
          quotes, ITP points, NCRs, vendor documents and job schedules. Nothing
          here is stored, and nothing here is money: a scorecard measures
          performance and touches no price, payout or margin.
        </p>
      </header>

      {configError && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
        >
          The scorecard configuration (confidence ladder, policy or metric
          registry) could not be read, so the precision guidance below may be
          incomplete. Scores themselves are still computed by the database.
          <span className="mt-1 block text-xs opacity-70">{configError}</span>
        </div>
      )}

      {/* ── The ladder, as data ─────────────────────────────────────────── */}
      <section
        aria-label="Confidence ladder"
        className="mb-6 rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
      >
        <h2 className="text-sm font-semibold text-white">
          How precise a score is allowed to be
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-zinc-500">
          Precision is a function of sample size, and it lives in the database as
          data rather than as a rule in this page. A score is rounded to a whole
          multiple of its band&apos;s step, so a two-decimal score from a handful
          of observations is not merely discouraged — it cannot be represented.
          {policy && (
            <>
              {' '}An overall score is withheld entirely unless at least{' '}
              {policy.min_metrics_for_composite} metric
              {policy.min_metrics_for_composite === 1 ? '' : 's'} reach their own
              evidence minimum.
            </>
          )}
        </p>

        {bands.length === 0 ? (
          <p role="status" className="mt-3 text-xs text-amber-200">
            The confidence ladder could not be read, so band thresholds are not
            shown. They are still enforced by the database.
          </p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {bands.map((b) => (
              <li
                key={b.band}
                className={`rounded-xl border px-3 py-2 text-[11px] ${bandStyle(b.band).chip}`}
              >
                <span className="block font-semibold">{b.band}</span>
                <span className="mt-0.5 block opacity-80">
                  {b.min_sample}+ observations ·{' '}
                  {b.rounding_step === 0
                    ? 'no score emitted'
                    : `nearest ${b.rounding_step}`}
                </span>
                <span className="mt-0.5 block opacity-60">{b.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Controls ────────────────────────────────────────────────────── */}
      {suppliers.length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label
              htmlFor="sort-by"
              className="block text-[11px] font-medium text-zinc-400"
            >
              Sort
            </label>
            <select
              id="sort-by"
              aria-label="Sort the suppliers on this page"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="mt-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
            >
              <option value="name">Name</option>
              <option value="score">Overall score (unscored last)</option>
              <option value="confidence">Confidence</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="band-filter"
              className="block text-[11px] font-medium text-zinc-400"
            >
              Confidence
            </label>
            <select
              id="band-filter"
              aria-label="Filter the suppliers on this page by confidence band"
              value={bandFilter}
              onChange={(e) => setBandFilter(e.target.value)}
              className="mt-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white"
            >
              <option value="all">All bands</option>
              {bands.map((b) => (
                <option key={b.band} value={b.band}>
                  {b.band}
                </option>
              ))}
            </select>
          </div>

          <p className="pb-1 text-[11px] text-zinc-600">
            Sorting and filtering act on the {suppliers.length} supplier
            {suppliers.length === 1 ? '' : 's'} loaded for this page, not on the
            whole directory.
          </p>
        </div>
      )}

      {/* ── The list ────────────────────────────────────────────────────── */}
      {suppliers.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-10 text-center">
          <Gauge
            className="mx-auto h-8 w-8 text-zinc-600"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="mt-3 text-sm text-zinc-300">
            {page > 1
              ? 'No suppliers on this page.'
              : 'No active suppliers in the directory.'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
            This is an empty directory, not a failed read. Scorecards appear as
            soon as a supplier is onboarded and starts producing operational
            rows to derive from.
          </p>
          {page > 1 && (
            <Link
              href="/admin/scorecards?page=1"
              className="mt-4 inline-block rounded-lg border border-white/10 px-4 py-2 text-xs font-semibold text-zinc-200 hover:text-white"
            >
              Back to the first page
            </Link>
          )}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-8 text-center text-sm text-zinc-400">
          No supplier on this page is in the{' '}
          <span className="font-semibold text-zinc-200">{bandFilter}</span>{' '}
          confidence band. This is a filter result, not an empty directory.
        </div>
      ) : (
        <ul aria-label="Suppliers" className="space-y-3">
          {rows.map(({ supplier: s, result }) => {
            const reviews = toNumberOrNull(s.rating_count) ?? 0;
            return (
              <li
                key={s.id}
                className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-white">
                        {s.legal_name}
                      </h2>
                      {s.verified && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300"
                          title="Directory verification"
                        >
                          <BadgeCheck className="h-3 w-3" strokeWidth={2} />
                          verified
                        </span>
                      )}
                      {s.country_code && (
                        <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {s.country_code}
                        </span>
                      )}
                    </div>
                    {s.headline && (
                      <p className="mt-1 max-w-2xl text-xs text-zinc-500">
                        {s.headline}
                      </p>
                    )}
                    {/*
                      Buyer sentiment is a DIFFERENT instrument from the derived
                      scorecard and is labelled as such. With zero reviews we say
                      "no reviews" rather than printing a confident 0.0.
                    */}
                    <p className="mt-1 text-[11px] text-zinc-600">
                      Buyer sentiment (subjective):{' '}
                      {reviews > 0
                        ? `${toNumberOrNull(s.rating_avg) ?? '—'} from ${reviews} review${reviews === 1 ? '' : 's'}`
                        : 'no reviews yet'}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <OverallCell result={result} bandLabel={bandLabel} />
                    <Link
                      href={`/admin/scorecards/${s.id}`}
                      aria-label={`Open the full scorecard for ${s.legal_name}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-violet-400/40 hover:text-white"
                    >
                      Breakdown
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Pager ───────────────────────────────────────────────────────── */}
      <nav
        aria-label="Supplier pages"
        className="mt-6 flex items-center justify-between gap-4"
      >
        <p className="text-[11px] text-zinc-500">
          {total === 0
            ? 'No suppliers'
            : `Showing ${shownFrom}–${shownTo} of ${total} supplier${total === 1 ? '' : 's'}`}
        </p>
        <div className="flex gap-2">
          {hasPrev ? (
            <Link
              href={`/admin/scorecards?page=${page - 1}`}
              aria-label="Previous page of suppliers"
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:text-white"
            >
              <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
              Previous
            </Link>
          ) : null}
          {hasNext ? (
            <Link
              href={`/admin/scorecards?page=${page + 1}`}
              aria-label="Next page of suppliers"
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:text-white"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          ) : null}
        </div>
      </nav>

      {/* ── What is actually measured ───────────────────────────────────── */}
      {registry.length > 0 && (
        <section
          aria-label="Metric registry"
          className="mt-8 rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
        >
          <h2 className="text-sm font-semibold text-white">
            What these scores measure
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Every metric must declare the rows it reads and what its ratio means
            before it can exist. This is that declaration, verbatim.
          </p>
          <ul className="mt-4 space-y-3">
            {registry.map((m) => (
              <li key={m.metric_key} className="border-l-2 border-white/[0.08] pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{m.label}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400">
                    {m.dimension}
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    weight {(m.weight_bps / 100).toFixed(0)}% · minimum{' '}
                    {m.min_sample_size} observations
                  </span>
                </div>
                <p className="mt-1 max-w-3xl text-xs text-zinc-400">{m.measures}</p>
                <p className="mt-0.5 font-mono text-[10px] text-zinc-600">
                  source: {m.evidence_source}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** The overall figure for one supplier, with its three non-interchangeable states. */
function OverallCell({
  result,
  bandLabel,
}: {
  result: ScorecardResult | undefined;
  bandLabel: Map<string, string>;
}) {
  if (!result || result.state === 'failed') {
    return (
      <div
        role="status"
        className="max-w-[15rem] rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-[11px] text-red-200"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Scorecard unavailable
        </span>
        <span className="mt-0.5 block opacity-75">
          The read failed. This is not a score of zero.
        </span>
      </div>
    );
  }

  if (result.state === 'forbidden') {
    return (
      <div
        role="status"
        className="max-w-[15rem] rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200"
      >
        Withheld — you have no commercial relationship with this supplier.
      </div>
    );
  }

  const c = result.card;
  return (
    <div className="text-right">
      <ScoreFigure
        score={c.overall_score}
        band={c.overall_confidence}
        roundingStep={0}
      />
      <div className="mt-1.5 flex flex-col items-end gap-1">
        <ConfidenceChip
          band={c.overall_confidence}
          label={bandLabel.get(c.overall_confidence)}
        />
        <span className="text-[10px] text-zinc-500">
          {c.metrics_scored} of {c.metrics_total} metrics have enough evidence
        </span>
      </div>
    </div>
  );
}
