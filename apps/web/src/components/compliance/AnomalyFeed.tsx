// ════════════════════════════════════════════════════════════════════════════
//  components/compliance/AnomalyFeed.tsx
//
//  The "what auditors actually look for" feed. Renders the output of
//  all six detectors as a single ordered stream — critical first.
//
//  Server component. No state, no actions — projection only.
// ════════════════════════════════════════════════════════════════════════════

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Activity,
  ShieldCheck,
  TrendingDown,
  CalendarClock,
  Moon,
  Eye,
  Users,
} from 'lucide-react';

import {
  COMPLIANCE_DETECTOR_META,
  type ComplianceAnomaly,
  type ComplianceDetectorId,
} from '@nexpec/shared-core';
import type { ComplianceAnomalySet } from '@/lib/data/compliancePosture';
import { cn } from '@/lib/cn';

interface Props {
  anomalies: ComplianceAnomalySet;
}

export function AnomalyFeed({ anomalies }: Props) {
  return (
    <section className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
            ACTIVE ANOMALY FEED, 6 DETECTORS
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-white">
            What auditors look for
          </h2>
          <p className="mt-1 max-w-3xl text-pretty text-xs text-zinc-400">
            Six continuously-evaluated detectors hunt for the patterns SOX
            404 reviewers care about. Findings appear here automatically;
            absence of findings is itself the signal you want.
          </p>
        </div>
        <DetectorStrip byDetector={anomalies.byDetector} />
      </header>

      {anomalies.findings.length === 0 ? (
        <EmptyFeed />
      ) : (
        <ul className="space-y-2.5">
          {anomalies.findings.map((a, i) => (
            <li key={`${a.detector}-${i}`}>
              <AnomalyCard anomaly={a} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─── per-detector mini-strip ─────────────────────────────────────── */

const DETECTOR_ICONS: Record<ComplianceDetectorId, React.ElementType> = {
  band_evasion: TrendingDown,
  rubber_stamping: ShieldCheck,
  concentration_risk: Users,
  quarter_end_clustering: CalendarClock,
  off_hours_decisions: Moon,
  silent_overrides: Eye,
};

function DetectorStrip({
  byDetector,
}: {
  byDetector: ComplianceAnomalySet['byDetector'];
}) {
  const entries = Object.entries(byDetector) as [
    ComplianceDetectorId,
    number,
  ][];

  return (
    <div className="hidden gap-1.5 lg:flex">
      {entries.map(([id, count]) => {
        const Icon = DETECTOR_ICONS[id];
        const meta = COMPLIANCE_DETECTOR_META[id];
        const active = count > 0;
        return (
          <div
            key={id}
            title={`${meta.title}: ${count} finding${count === 1 ? '' : 's'}`}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[10px]',
              active
                ? 'border-amber-400/30 bg-amber-400/[0.06] text-amber-200'
                : 'border-emerald-400/20 bg-emerald-500/[0.04] text-emerald-200',
            )}
          >
            <Icon className="h-3 w-3" strokeWidth={1.75} />
            {count}
          </div>
        );
      })}
    </div>
  );
}

/* ─── empty + populated states ────────────────────────────────────── */

function EmptyFeed() {
  return (
    <div className="rounded-2xl border border-emerald-400/25 bg-gradient-to-br from-emerald-500/[0.08] to-violet/[0.04] p-8 text-center">
      <CheckCircle2
        className="mx-auto h-7 w-7 text-emerald-300"
        strokeWidth={1.75}
      />
      <p className="mt-4 font-display text-base font-semibold text-white">
        All six detectors clear.
      </p>
      <p className="mt-1 mx-auto max-w-md text-pretty text-xs text-emerald-100/80">
        No band-evasion, no rubber-stamping, no concentration risk, no
        quarter-end clustering, no off-hours patterns, no silent overrides
        observed across the trailing window. This is the signal auditors
        most want to see, recorded continuously, not just at year-end.
      </p>
    </div>
  );
}

/* ─── card ────────────────────────────────────────────────────────── */

function AnomalyCard({ anomaly }: { anomaly: ComplianceAnomaly }) {
  const detectorId = (anomaly.detector ?? 'band_evasion') as ComplianceDetectorId;
  const meta = COMPLIANCE_DETECTOR_META[detectorId];
  const sevMeta = SEVERITY_META[anomaly.severity];
  const Icon = sevMeta.icon;
  const DetectorIcon = DETECTOR_ICONS[detectorId];

  return (
    <article
      className={cn(
        'rounded-2xl border bg-gradient-to-r p-5',
        sevMeta.border,
        sevMeta.gradient,
      )}
    >
      <header className="flex items-start gap-4">
        <span
          className={cn(
            'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset',
            sevMeta.iconWrap,
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial">
            <span className={sevMeta.label}>{anomaly.severity.toUpperCase()}</span>
            <span className="text-zinc-600">·</span>
            <span className="inline-flex items-center gap-1 text-zinc-400">
              <DetectorIcon className="h-3 w-3" strokeWidth={1.75} />
              {meta.title}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="font-mono text-zinc-500">
              {formatRelative(anomaly.detected_at)}
            </span>
          </p>
          <p className="mt-2 text-sm text-zinc-100">{anomaly.finding}</p>
          <p className="mt-1.5 text-[11px] text-zinc-500">{meta.subtitle}</p>

          {/* Metadata chips — render IDs as truncated mono pills */}
          <MetadataChips metadata={anomaly.metadata} />
        </div>
      </header>
    </article>
  );
}

function MetadataChips({ metadata }: { metadata: Record<string, unknown> }) {
  const labelKeys = Object.keys(metadata).filter((k) =>
    k.endsWith('_label'),
  );
  const numericKeys = Object.keys(metadata).filter(
    (k) =>
      k.endsWith('_count') ||
      k.endsWith('_cents') ||
      k === 'ratio' ||
      k === 'hire_count',
  );

  if (labelKeys.length === 0 && numericKeys.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {labelKeys.map((k) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
        >
          {String(metadata[k] ?? '—')}
        </span>
      ))}
      {numericKeys.map((k) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
        >
          <span className="text-zinc-600">{k}</span>
          <span className="text-zinc-200">
            {formatMetadataValue(k, metadata[k])}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ─── styling tables ──────────────────────────────────────────────── */

const SEVERITY_META = {
  critical: {
    icon: AlertCircle,
    border: 'border-rose-400/30',
    gradient: 'from-rose-500/[0.10] to-rose-500/[0.02]',
    iconWrap: 'bg-rose-500/15 text-rose-200 ring-rose-400/30',
    label: 'text-rose-200',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-amber-400/30',
    gradient: 'from-amber-400/[0.08] to-amber-400/[0.02]',
    iconWrap: 'bg-amber-400/15 text-amber-200 ring-amber-400/30',
    label: 'text-amber-200',
  },
  info: {
    icon: Info,
    border: 'border-white/[0.06]',
    gradient: 'from-white/[0.04] to-white/[0.01]',
    iconWrap: 'bg-violet/15 text-violet-glow ring-violet/30',
    label: 'text-violet-glow',
  },
} as const;

/* ─── formatters ──────────────────────────────────────────────────── */

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
    return `${Math.round(sec / 86400)}d ago`;
  } catch {
    return iso;
  }
}

function formatMetadataValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    if (key.endsWith('_cents')) {
      return `$${(value / 100).toLocaleString()}`;
    }
    return value.toLocaleString();
  }
  return String(value);
}
