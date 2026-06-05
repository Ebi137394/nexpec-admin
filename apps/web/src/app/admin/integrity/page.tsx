// ════════════════════════════════════════════════════════════════════════════
//  app/admin/integrity/page.tsx — Predictive-Integrity Dashboard (super_admin)
//
//  Executive oversight of inspector seal-integrity across jobs. Server component:
//    1. inspector_integrity_analytics RPC (P2.1) — admin → platform scope.
//    2. computeIntegrityRisk scorer (P2.2, shared-core) — z-scores vs cohort.
//    3. Ranked risk list + per-inspector anomaly breakdown.
//
//  The whole point is "who do I look at first": the watchlist surfaces broken
//  evidence chains and rubber-stamping (rushed / thin-evidence sealing) before
//  they become disputes. Reads run as super_admin (RLS-gated by the RPC).
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronDown,
  Gauge,
  Link2Off,
  ShieldAlert,
  Stamp,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  computeIntegrityRisk,
  inspectorMetricsFromRpc,
  cohortFromRpc,
  type IntegrityRiskScore,
  type InspectorIntegrityMetrics,
  type RiskBand,
} from '@nexpec/shared-core';
import { cn } from '@/lib/cn';

export const metadata: Metadata = { title: 'Predictive Integrity' };
export const dynamic = 'force-dynamic';

const WINDOWS = [30, 90, 180, 365];

const BAND: Record<RiskBand, { ring: string; text: string; chip: string; label: string }> = {
  low: { ring: 'ring-emerald-400/30', text: 'text-emerald-300', chip: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/30', label: 'Low' },
  elevated: { ring: 'ring-amber-400/30', text: 'text-amber-300', chip: 'bg-amber-500/10 text-amber-300 ring-amber-400/30', label: 'Elevated' },
  high: { ring: 'ring-orange-400/40', text: 'text-orange-300', chip: 'bg-orange-500/12 text-orange-300 ring-orange-400/40', label: 'High' },
  critical: { ring: 'ring-rose-400/50', text: 'text-rose-300', chip: 'bg-rose-500/12 text-rose-300 ring-rose-400/50', label: 'Critical' },
};

interface ScoredRow {
  m: InspectorIntegrityMetrics;
  score: IntegrityRiskScore;
}

export default async function IntegrityDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const sp = await searchParams;
  const windowDays = WINDOWS.includes(Number(sp.days)) ? Number(sp.days) : 90;

  const supabase = await createSupabaseServerClient();
  // `inspector_integrity_analytics` ships in migration 20260712120000. The casts
  // keep this compiling before the Supabase types are regenerated; the runtime
  // call is unaffected.
  const { data, error } = await supabase.rpc(
    'inspector_integrity_analytics' as never,
    { p_window_days: windowDays } as never,
  );

  const payload = (data ?? {}) as {
    ok?: boolean;
    scope?: string;
    summary?: Record<string, unknown>;
    cohort?: Record<string, unknown>;
    inspectors?: Record<string, unknown>[];
    timeseries?: { week: string; seals: number; chain_breaks: number; ai_findings: number }[];
  };

  const cohort = cohortFromRpc(payload.cohort ?? {});
  const rows: ScoredRow[] = (payload.inspectors ?? [])
    .map((raw) => {
      const m = inspectorMetricsFromRpc(raw);
      return { m, score: computeIntegrityRisk(m, cohort) };
    })
    .sort((a, b) => b.score.score - a.score.score);

  const summary = payload.summary ?? {};
  const brokenChains = rows.filter((r) => r.m.chainBreakRate > 0).length;
  const rubberStamping = rows.filter((r) => {
    const ft = r.score.components.find((c) => c.key === 'fast_turnaround');
    const le = r.score.components.find((c) => c.key === 'low_evidence');
    return (ft?.risk ?? 0) >= 0.6 || (le?.risk ?? 0) >= 0.6;
  }).length;
  const elevatedPlus = rows.filter((r) => r.score.band === 'high' || r.score.band === 'critical').length;

  return (
    <div className="space-y-8">
      {/* Heading */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            <Gauge className="h-3.5 w-3.5" strokeWidth={2} />
            Predictive Integrity
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Inspector risk forecast
          </h1>
          <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
            Every inspector scored against the cohort on the signals that precede
            disputes, broken evidence chains, thin evidence, and rushed
            (rubber-stamped) seals. Computed from the cryptographic seal history;
            no inspector self-reports.
          </p>
        </div>
        {/* Window selector */}
        <nav className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
          {WINDOWS.map((d) => (
            <Link
              key={d}
              href={`/admin/integrity?days=${d}`}
              className={cn(
                'rounded-lg px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-industrial transition-colors',
                d === windowDays ? 'bg-violet/20 text-violet-glow' : 'text-zinc-500 hover:text-zinc-200',
              )}
            >
              {d}d
            </Link>
          ))}
        </nav>
      </header>

      {error ? (
        <EmptyState
          title="Could not load analytics"
          body={error.message}
          tone="error"
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No sealed inspections in this window"
          body="The predictive engine activates as inspectors seal reports. Once the AI Co-Inspector + sealing flow are live, risk forecasts populate here automatically."
          tone="neutral"
        />
      ) : (
        <>
          {/* Watchlist — what to look at first */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Watch
              icon={Link2Off}
              tone={brokenChains > 0 ? 'critical' : 'ok'}
              n={brokenChains}
              label="Broken evidence chains"
              sub="inspectors with ≥1 tamper-flagged seal"
            />
            <Watch
              icon={Stamp}
              tone={rubberStamping > 0 ? 'warn' : 'ok'}
              n={rubberStamping}
              label="Possible rubber-stamping"
              sub="rushed turnaround or thin evidence vs cohort"
            />
            <Watch
              icon={ShieldAlert}
              tone={elevatedPlus > 0 ? 'warn' : 'ok'}
              n={elevatedPlus}
              label="High / critical risk"
              sub={`of ${rows.length} active inspectors`}
            />
          </section>

          {/* Platform summary strip */}
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.04] sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Inspectors" value={fmt(summary['inspectors'])} />
            <Stat label="Seals" value={fmt(summary['seals'])} />
            <Stat label="Chain-break rate" value={pct(summary['chain_break_rate'])} accent={Number(summary['chain_break_rate']) > 0} />
            <Stat label="Avg captures/seal" value={fmt(summary['avg_captures_per_seal'])} />
            <Stat label="Avg turnaround" value={hrs(summary['avg_turnaround_hours'])} />
            <Stat label="Disputes" value={fmt(summary['disputes'])} accent={Number(summary['disputes']) > 0} />
          </section>

          {/* Ranked risk list */}
          <section>
            <header className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
                <TrendingUp className="h-3 w-3" strokeWidth={2} />
                Ranked by integrity risk
              </p>
              <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                {rows.length} inspectors, {windowDays}d
              </p>
            </header>
            <ul className="space-y-2">
              {rows.map((r) => (
                <RiskRow key={r.m.inspectorId} row={r} />
              ))}
            </ul>
          </section>

          <p className="text-pretty font-mono text-[10px] leading-relaxed text-zinc-600">
            Risk = weighted, cohort-relative z-scores on chain-break incidence
            (35%), evidence thoroughness (25%), capture→seal turnaround (20%), and
            downstream disputes/revisions (20%). A broken chain floors that axis at
            50%. Inspectors with &lt; 3 seals are marked provisional and capped at
            “elevated”. AI assists draft; humans verify &amp; seal.
          </p>
        </>
      )}
    </div>
  );
}

/* ─── Ranked row with expandable breakdown (native <details>, no client JS) ── */

function RiskRow({ row }: { row: ScoredRow }) {
  const { m, score } = row;
  const band = BAND[score.band];
  const chips = flagChips(row);

  return (
    <li className={cn('overflow-hidden rounded-2xl border bg-white/[0.02]', score.band === 'critical' ? 'border-rose-400/30' : score.band === 'high' ? 'border-orange-400/25' : 'border-white/[0.08]')}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-4 p-4 [&::-webkit-details-marker]:hidden">
          {/* Score dial */}
          <div className={cn('flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl ring-1 ring-inset', band.chip)}>
            <span className="font-display text-lg font-bold leading-none">{Math.round(score.score)}</span>
            <span className="mt-0.5 font-mono text-[8px] uppercase tracking-industrial opacity-80">{band.label}</span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-sm">
              <span className="truncate font-semibold text-white">{m.inspectorLabel || m.inspectorId.slice(0, 8)}</span>
              {score.insufficientData && (
                <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-px font-mono text-[9px] uppercase text-zinc-400">
                  provisional
                </span>
              )}
            </p>
            <p className="mt-1 truncate text-xs text-zinc-500">{score.rationale}</p>
            {chips.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span key={c.label} className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-industrial', c.cls)}>
                    {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Quick metrics + expand affordance */}
          <div className="hidden shrink-0 items-center gap-5 sm:flex">
            <Mini label="seals" value={String(m.seals)} />
            <Mini label="cap/seal" value={m.avgCapturesPerSeal.toFixed(1)} />
            <Mini label="turnaround" value={m.avgTurnaroundHours == null ? '—' : `${m.avgTurnaroundHours.toFixed(1)}h`} />
          </div>
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" strokeWidth={2} />
        </summary>

        {/* Component breakdown */}
        <div className="border-t border-white/[0.06] px-4 py-4">
          <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Risk decomposition
          </p>
          <div className="space-y-2.5">
            {score.components.map((c) => (
              <div key={c.key} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-xs text-zinc-300">{c.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className={cn('h-full rounded-full', c.risk >= 0.66 ? 'bg-rose-400/80' : c.risk >= 0.33 ? 'bg-amber-400/80' : 'bg-emerald-400/70')}
                    style={{ width: `${Math.max(2, Math.round(c.risk * 100))}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-zinc-400">
                  {Math.round(c.risk * 100)}%
                </span>
                <span className="hidden w-56 shrink-0 truncate font-mono text-[10px] text-zinc-500 lg:block" title={c.note}>
                  {c.note}
                </span>
              </div>
            ))}
          </div>
        </div>
      </details>
    </li>
  );
}

/* ─── small presentational helpers ─────────────────────────────────────────── */

function Watch({
  icon: Icon,
  n,
  label,
  sub,
  tone,
}: {
  icon: LucideIcon;
  n: number;
  label: string;
  sub: string;
  tone: 'ok' | 'warn' | 'critical';
}) {
  const c =
    tone === 'critical'
      ? 'border-rose-400/40 bg-rose-500/[0.06] text-rose-300'
      : tone === 'warn'
        ? 'border-amber-400/35 bg-amber-500/[0.05] text-amber-300'
        : 'border-emerald-400/25 bg-emerald-500/[0.04] text-emerald-300';
  return (
    <div className={cn('rounded-2xl border p-4', c)}>
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
        <span className="font-display text-3xl font-bold tabular-nums text-white">{n}</span>
      </div>
      <p className="mt-3 text-sm font-semibold text-white">{label}</p>
      <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-ink-950/40 p-4">
      <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">{label}</p>
      <p className={cn('mt-1.5 font-display text-xl font-semibold tabular-nums', accent ? 'text-amber-300' : 'text-white')}>
        {value}
      </p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="font-mono text-sm font-semibold tabular-nums text-zinc-200">{value}</p>
      <p className="font-mono text-[9px] uppercase tracking-industrial text-zinc-600">{label}</p>
    </div>
  );
}

function EmptyState({ title, body, tone }: { title: string; body: string; tone: 'neutral' | 'error' }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-3xl border-2 border-dashed px-8 py-16 text-center',
        tone === 'error' ? 'border-rose-400/30 bg-rose-500/[0.03]' : 'border-white/10 bg-white/[0.02]',
      )}
    >
      <AlertTriangle className={cn('h-8 w-8', tone === 'error' ? 'text-rose-300' : 'text-zinc-500')} strokeWidth={1.5} />
      <p className="mt-4 font-display text-lg font-semibold text-white">{title}</p>
      <p className="mt-1 max-w-md text-pretty text-sm text-zinc-400">{body}</p>
    </div>
  );
}

/* ─── formatting + flag derivation ──────────────────────────────────────────── */

function fmt(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString() : '—';
}
function pct(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
}
function hrs(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(1)}h` : '—';
}

function flagChips(row: ScoredRow): { label: string; cls: string }[] {
  const { m, score } = row;
  const out: { label: string; cls: string }[] = [];
  if (m.chainBreakRate > 0) out.push({ label: 'Broken chains', cls: 'border-rose-400/40 bg-rose-500/10 text-rose-300' });
  if (m.disputes > 0) out.push({ label: `${m.disputes} dispute${m.disputes === 1 ? '' : 's'}`, cls: 'border-rose-400/30 bg-rose-500/[0.08] text-rose-200' });
  const ft = score.components.find((c) => c.key === 'fast_turnaround');
  if ((ft?.risk ?? 0) >= 0.6) out.push({ label: 'Rushed seals', cls: 'border-amber-400/35 bg-amber-500/10 text-amber-300' });
  const le = score.components.find((c) => c.key === 'low_evidence');
  if ((le?.risk ?? 0) >= 0.6) out.push({ label: 'Thin evidence', cls: 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200' });
  if (m.revisions > 0) out.push({ label: `${m.revisions} revision${m.revisions === 1 ? '' : 's'}`, cls: 'border-white/15 bg-white/[0.04] text-zinc-300' });
  return out;
}
