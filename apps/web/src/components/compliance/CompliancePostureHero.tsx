// ════════════════════════════════════════════════════════════════════════════
//  components/compliance/CompliancePostureHero.tsx
//
//  Headline of /client/compliance. Bloomberg-terminal-meets-SOX-audit
//  energy — dense without clutter. Three deliberate sections:
//
//    · Posture score (the one number the CFO emails her board)
//    · Coverage tiles (the three percentages that drive the score)
//    · Control telemetry (the binary "your controls held" indicators)
//
//  Server component — pure projection over the fetched posture summary.
// ════════════════════════════════════════════════════════════════════════════

import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Activity,
  Clock,
  FileCheck,
  CheckCircle2,
  TrendingUp,
  Sparkles,
  Hourglass,
} from 'lucide-react';

import type {
  CompliancePostureScore,
  CompliancePostureSummary,
} from '@/lib/data/compliancePosture';
import { cn } from '@/lib/cn';

interface Props {
  posture: CompliancePostureSummary;
  score: CompliancePostureScore;
  orgName: string;
}

export function CompliancePostureHero({ posture, score, orgName }: Props) {
  const bandMeta = BAND_META[score.band];

  return (
    <section className="space-y-4">
      {/* ── Top — posture score + headline copy ──────────────────── */}
      <div
        className={cn(
          'relative overflow-hidden rounded-3xl border bg-gradient-to-br p-6 sm:p-8',
          bandMeta.gradient,
          bandMeta.border,
        )}
      >
        {/* atmospheric overlay */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 20%, rgba(124,58,237,0.12), transparent 45%), radial-gradient(circle at 80% 80%, rgba(34,211,238,0.10), transparent 50%)',
          }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
              <Shield className="h-3 w-3" strokeWidth={2} />
              COMPLIANCE COMMAND CENTER, {orgName.toUpperCase()}
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {bandMeta.headline}
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-300">
              {bandMeta.subline}
            </p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
              GENERATED, {formatTimestamp(posture.generated_at)},
              WINDOW {posture.window_days}D
            </p>
          </div>

          {/* Score ring */}
          <div className="relative shrink-0">
            <ScoreRing score={score.score} band={score.band} />
          </div>
        </div>
      </div>

      {/* ── Coverage tiles ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CoverageTile
          icon={<TrendingUp className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Cost-center attribution"
          percentage={posture.attribution_coverage.percentage}
          numerator={posture.attribution_coverage.attributed}
          denominator={posture.attribution_coverage.total}
          unit="invoices"
          targetText="100% attribution = every invoice rolls up by department"
        />
        <CoverageTile
          icon={<FileCheck className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Substantive review"
          percentage={posture.decision_substantiveness.percentage}
          numerator={posture.decision_substantiveness.substantive}
          denominator={posture.decision_substantiveness.total}
          unit="approval decisions"
          targetText="Comments ≥ 12 chars indicate non-rubber-stamp review"
        />
        <CoverageTile
          icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="High-value gating"
          percentage={posture.high_value_gating.percentage}
          numerator={posture.high_value_gating.gated}
          denominator={posture.high_value_gating.total}
          unit="jobs ≥ $50K"
          targetText="Every six-figure job should route through an approval policy"
        />
      </div>

      {/* ── Control telemetry strip ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ControlTile
          icon={<ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="SoD violations"
          value={posture.sod_violations_90d}
          tone={posture.sod_violations_90d === 0 ? 'positive' : 'critical'}
          subtitle={
            posture.sod_violations_90d === 0
              ? 'Schema-enforced, cannot be bypassed'
              : 'Investigate immediately'
          }
        />
        <ControlTile
          icon={<ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Policy overlaps"
          value={posture.band_overlap_attempts_90d}
          tone={posture.band_overlap_attempts_90d === 0 ? 'positive' : 'warning'}
          subtitle={
            posture.band_overlap_attempts_90d === 0
              ? 'Constraint trigger held'
              : 'Misconfigurations rejected'
          }
        />
        <ControlTile
          icon={<Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Evidence packs"
          value={posture.evidence_packs_90d}
          tone={posture.evidence_packs_90d > 0 ? 'positive' : 'neutral'}
          subtitle={
            posture.evidence_packs_90d > 0
              ? 'SOX-grade exports assembled (90d)'
              : 'No exports requested yet (90d)'
          }
        />
        <ControlTile
          icon={<Hourglass className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Approval p95 latency"
          value={formatDuration(posture.approval_latency.p95_seconds)}
          tone={latencyTone(posture.approval_latency.p95_seconds)}
          subtitle={
            posture.approval_latency.pending_count > 0
              ? `${posture.approval_latency.pending_count} pending, oldest ${formatDuration(posture.approval_latency.oldest_pending_seconds)}`
              : 'No approvals pending'
          }
        />
      </div>
    </section>
  );
}

/* ─── score ring ──────────────────────────────────────────────────── */

function ScoreRing({
  score,
  band,
}: {
  score: number;
  band: CompliancePostureScore['band'];
}) {
  const radius = 56;
  const stroke = 9;
  const c = 2 * Math.PI * radius;
  const dash = (score / 100) * c;
  const meta = BAND_META[band];

  return (
    <div className="relative inline-flex h-[136px] w-[136px] items-center justify-center">
      <svg
        viewBox="0 0 140 140"
        className="absolute inset-0"
        aria-hidden
      >
        {/* track */}
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        {/* fill */}
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={meta.ringStroke}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform="rotate(-90 70 70)"
        />
      </svg>
      <div className="relative text-center">
        <p className={cn('font-mono text-3xl font-semibold', meta.scoreText)}>
          {score}
        </p>
        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-industrial text-zinc-500">
          POSTURE / 100
        </p>
      </div>
    </div>
  );
}

/* ─── tiles ───────────────────────────────────────────────────────── */

function CoverageTile({
  icon,
  label,
  percentage,
  numerator,
  denominator,
  unit,
  targetText,
}: {
  icon: React.ReactNode;
  label: string;
  percentage: number | null;
  numerator: number;
  denominator: number;
  unit: string;
  targetText: string;
}) {
  const tone =
    percentage === null
      ? 'neutral'
      : percentage >= 95
        ? 'positive'
        : percentage >= 80
          ? 'good'
          : percentage >= 60
            ? 'warning'
            : 'critical';
  const barTone = COVERAGE_BAR[tone];

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5">
      <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
        <span className="text-violet-glow">{icon}</span>
        {label}
      </p>
      <p className="mt-3 flex items-baseline gap-2">
        <span
          className={cn('font-mono text-3xl font-semibold', COVERAGE_TEXT[tone])}
        >
          {percentage === null ? '—' : `${percentage.toFixed(1)}%`}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">
          {numerator}/{denominator} {unit}
        </span>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
        {percentage !== null && (
          <div
            className={cn('h-full transition-all', barTone)}
            style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
          />
        )}
      </div>
      <p className="mt-3 text-[10px] text-zinc-500">{targetText}</p>
    </div>
  );
}

function ControlTile({
  icon,
  label,
  value,
  tone,
  subtitle,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  tone: 'positive' | 'warning' | 'critical' | 'neutral';
  subtitle: string;
}) {
  const ring =
    tone === 'positive'
      ? 'ring-emerald-400/30 text-emerald-200 bg-emerald-500/[0.04]'
      : tone === 'warning'
        ? 'ring-amber-400/30 text-amber-200 bg-amber-400/[0.04]'
        : tone === 'critical'
          ? 'ring-rose-400/30 text-rose-200 bg-rose-500/[0.04]'
          : 'ring-white/[0.08] text-white bg-white/[0.02]';
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.06] p-4 ring-1 ring-inset',
        ring,
      )}
    >
      <p className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial opacity-90">
        {icon}
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-[10px] opacity-70">{subtitle}</p>
    </div>
  );
}

/* ─── helpers ─────────────────────────────────────────────────────── */

const BAND_META: Record<
  CompliancePostureScore['band'],
  {
    headline: string;
    subline: string;
    gradient: string;
    border: string;
    ringStroke: string;
    scoreText: string;
  }
> = {
  excellent: {
    headline: 'Compliance posture is excellent.',
    subline:
      'Every primary control is engaged and no anomaly detector is firing. Ready for an external SOX 404 review without preparation.',
    gradient: 'from-emerald-500/[0.10] via-violet/[0.06] to-cyan-glow/[0.06]',
    border: 'border-emerald-400/25',
    ringStroke: '#34D399',
    scoreText: 'text-emerald-200',
  },
  strong: {
    headline: 'Compliance posture is strong.',
    subline:
      'Primary controls are engaged. A handful of low-severity findings are below, review at your convenience.',
    gradient: 'from-violet/[0.10] via-cyan-glow/[0.04] to-ink-900/0',
    border: 'border-violet/30',
    ringStroke: '#A78BFA',
    scoreText: 'text-violet-glow',
  },
  fair: {
    headline: 'Compliance posture is fair.',
    subline:
      'Most controls are engaged but some coverage gaps remain. Address the warnings below before the next audit cycle.',
    gradient: 'from-amber-400/[0.10] via-violet/[0.04] to-ink-900/0',
    border: 'border-amber-400/25',
    ringStroke: '#FBBF24',
    scoreText: 'text-amber-200',
  },
  attention: {
    headline: 'Compliance posture needs attention.',
    subline:
      'Coverage gaps and anomalies have accumulated. Recommended: review the findings below this week.',
    gradient: 'from-amber-400/[0.15] via-rose-500/[0.04] to-ink-900/0',
    border: 'border-amber-400/40',
    ringStroke: '#F59E0B',
    scoreText: 'text-amber-200',
  },
  critical: {
    headline: 'Compliance posture requires immediate review.',
    subline:
      'Critical anomalies are firing. Escalate findings to your Audit Committee. Until cleared, treat new spend with extra scrutiny.',
    gradient: 'from-rose-500/[0.15] via-amber-400/[0.04] to-ink-900/0',
    border: 'border-rose-400/40',
    ringStroke: '#F43F5E',
    scoreText: 'text-rose-200',
  },
};

const COVERAGE_TEXT: Record<string, string> = {
  positive: 'text-emerald-200',
  good: 'text-violet-glow',
  warning: 'text-amber-200',
  critical: 'text-rose-200',
  neutral: 'text-zinc-300',
};
const COVERAGE_BAR: Record<string, string> = {
  positive: 'bg-emerald-400/70',
  good: 'bg-violet/70',
  warning: 'bg-amber-400/70',
  critical: 'bg-rose-400/70',
  neutral: 'bg-white/20',
};

function latencyTone(secs: number): 'positive' | 'warning' | 'critical' | 'neutral' {
  if (!secs) return 'neutral';
  if (secs < 4 * 3600) return 'positive';
  if (secs < 24 * 3600) return 'warning';
  return 'critical';
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
