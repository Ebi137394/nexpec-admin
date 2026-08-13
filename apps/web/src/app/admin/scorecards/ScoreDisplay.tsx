'use client';

// ════════════════════════════════════════════════════════════════════════════
//  ScoreDisplay — the anti-fake-precision rendering primitives.
//
//  Shared by the supplier list and the drill-down so there is exactly ONE way a
//  score reaches a screen in this route. The rules these components enforce:
//
//   • A score is an INTEGER that came from the database. Nothing here calls
//     toFixed, and nothing divides — the migration rounds to a whole multiple
//     of the band's integer step precisely so a 2-decimal figure is
//     unrepresentable. Re-deriving a decimal in the UI would defeat that.
//
//   • A score NEVER appears without its sample size. ScoreFigure renders the
//     number; SampleChip renders what it was computed from, in the metric's own
//     unit ("3 inspected jobs", not "n = 3"). They are used together at every
//     site, and a null score renders "Not scored" plus the server's reason —
//     never a 0.
//
//   • Thin evidence is VISUALLY distinct, not merely annotated. A low-confidence
//     figure is amber with a dashed ring and a plain-English hedge; a
//     high-confidence one is emerald and solid. You can tell them apart without
//     reading a word.
//
//   • The Wilson interval is drawn as a WIDTH. A wide bar is the honest picture
//     of a small sample, and it is drawn from the interval the server computed,
//     not from any statistics recomputed here.
// ════════════════════════════════════════════════════════════════════════════

import { bandRank, sampleLabel } from './types';

interface BandStyle {
  chip: string;
  figure: string;
  bar: string;
  /** Short plain-English hedge shown under a thin figure. */
  hedge: string | null;
}

// The `& { none: BandStyle }` is load-bearing: under this project's
// noUncheckedIndexedAccess, a bare Record<string, BandStyle> makes even
// BAND_STYLE.none `BandStyle | undefined`, so the `??` fallback below could not
// itself be a total value. Pinning `none` as a required key makes bandStyle()
// total for any band string the ladder data can produce.
const BAND_STYLE: Record<string, BandStyle> & { none: BandStyle } = {
  high: {
    chip: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
    figure: 'text-emerald-300 ring-1 ring-emerald-400/30',
    bar: 'bg-emerald-400/70',
    hedge: null,
  },
  moderate: {
    chip: 'border-sky-400/40 bg-sky-400/10 text-sky-300',
    figure: 'text-sky-300 ring-1 ring-sky-400/30',
    bar: 'bg-sky-400/70',
    hedge: 'Moderate evidence — read this to the nearest 5 points, not exactly.',
  },
  low: {
    chip: 'border-amber-400/50 bg-amber-400/10 text-amber-300 border-dashed',
    figure: 'text-amber-300 ring-1 ring-dashed ring-amber-400/40',
    bar: 'bg-amber-400/70',
    hedge:
      'Indicative only — the sample is small, so this is rounded to the nearest 10 and could move a long way with one more observation.',
  },
  insufficient: {
    chip: 'border-zinc-500/40 bg-white/[0.03] text-zinc-400 border-dashed',
    figure: 'text-zinc-500 ring-1 ring-white/10',
    bar: 'bg-zinc-600',
    hedge: null,
  },
  none: {
    chip: 'border-zinc-600/40 bg-white/[0.02] text-zinc-500 border-dashed',
    figure: 'text-zinc-600 ring-1 ring-white/[0.06]',
    bar: 'bg-zinc-700',
    hedge: null,
  },
};

export function bandStyle(band: string): BandStyle {
  return BAND_STYLE[band] ?? BAND_STYLE.none;
}

/**
 * The confidence band, as a chip. `label` should be the band's own label from
 * supplier_scorecard_confidence_bands — the ladder is DATA, and an Admin who
 * retunes it must see their own wording here rather than a hard-coded copy.
 */
export function ConfidenceChip({
  band,
  label,
}: {
  band: string;
  label?: string;
}) {
  const s = bandStyle(band);
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${s.chip}`}
      title={label ?? band}
    >
      {band} confidence
    </span>
  );
}

/**
 * The score itself. `null` renders "Not scored" — the database returns NULL
 * rather than 0 when evidence is thin, and collapsing that to a 0 here would
 * turn "we do not know" into "they performed badly".
 */
export function ScoreFigure({
  score,
  band,
  roundingStep,
  size = 'md',
}: {
  score: number | null;
  band: string;
  roundingStep: number;
  size?: 'md' | 'lg';
}) {
  const s = bandStyle(band);
  const big = size === 'lg';

  if (score === null) {
    return (
      <span
        className={`inline-flex items-center rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-3 ${
          big ? 'py-2 text-base' : 'py-1 text-sm'
        } font-semibold text-zinc-500`}
      >
        Not scored
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start">
      <span
        className={`inline-flex items-baseline gap-1 rounded-xl bg-white/[0.03] px-3 ${
          big ? 'py-2' : 'py-1'
        } font-mono font-semibold ${s.figure}`}
      >
        {/* Integer, exactly as the server rounded it. No toFixed anywhere. */}
        <span className={big ? 'text-3xl' : 'text-lg'}>{score}</span>
        <span className={big ? 'text-sm opacity-60' : 'text-[10px] opacity-60'}>
          /100
        </span>
      </span>
      {roundingStep > 1 && (
        <span className="mt-1 text-[10px] text-zinc-500">
          rounded to the nearest {roundingStep}
        </span>
      )}
    </span>
  );
}

/**
 * The evidence base, in the metric's own unit. This is the component the brief
 * demands sit next to every figure: "3 inspected jobs", not a bare n.
 */
export function SampleChip({
  metricKey,
  sampleSize,
  numerator,
  minSampleSize,
}: {
  metricKey: string;
  sampleSize: number;
  numerator: number;
  minSampleSize?: number;
}) {
  const short =
    minSampleSize !== undefined && sampleSize < minSampleSize && sampleSize >= 0;

  return (
    <span
      className={`inline-flex flex-wrap items-center gap-x-1.5 text-[11px] ${
        short ? 'text-amber-300' : 'text-zinc-400'
      }`}
    >
      <span className="font-medium">{sampleLabel(metricKey, sampleSize)}</span>
      {sampleSize > 0 && (
        <span className="text-zinc-500">
          · {numerator} counted
        </span>
      )}
      {short && minSampleSize !== undefined && (
        <span className="text-amber-300/80">
          · below this metric&apos;s minimum of {minSampleSize}
        </span>
      )}
    </span>
  );
}

/**
 * The Wilson interval, drawn as a width on a 0–100 track. This is where a small
 * sample becomes visible without reading anything: the bar is simply wide.
 */
export function IntervalBar({
  low,
  high,
  band,
}: {
  low: number | null;
  high: number | null;
  band: string;
}) {
  if (low === null || high === null) return null;

  const lo = Math.max(0, Math.min(100, low));
  const hi = Math.max(0, Math.min(100, high));
  const width = Math.max(1, hi - lo);
  const s = bandStyle(band);

  return (
    <div className="mt-2 max-w-xs">
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
        role="img"
        aria-label={`95% confidence interval, ${lo} to ${hi} out of 100, a width of ${hi - lo} points`}
      >
        <div
          className={`absolute inset-y-0 rounded-full ${s.bar}`}
          style={{ left: `${lo}%`, width: `${width}%` }}
        />
      </div>
      <p className="mt-1 text-[10px] text-zinc-500">
        95% interval {lo}–{hi}
        <span className="ml-1 text-zinc-600">
          ({hi - lo} points wide{hi - lo >= 25 ? ' — very uncertain' : ''})
        </span>
      </p>
    </div>
  );
}

/** The plain-English hedge for a thin band, if the band has one. */
export function BandHedge({ band }: { band: string }) {
  const hedge = bandStyle(band).hedge;
  if (!hedge) return null;
  return (
    <p
      role="note"
      className={`mt-2 text-[11px] ${
        bandRank(band) <= 2 ? 'text-amber-300/90' : 'text-zinc-500'
      }`}
    >
      {hedge}
    </p>
  );
}

/** The server's own explanation of why nothing was scored. Rendered verbatim. */
export function NotScoredReason({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return (
    <p className="mt-2 text-[11px] text-zinc-400">{reason}</p>
  );
}
