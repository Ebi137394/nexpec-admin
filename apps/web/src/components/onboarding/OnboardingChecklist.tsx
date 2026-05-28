// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/onboarding/OnboardingChecklist.tsx
//
//  Post-signup onboarding checklist widget. Renders above the existing
//  dashboard content (does NOT modify any existing dashboard element).
//
//  Three render states:
//    1. Hidden — admin role, unauthenticated, or already dismissed.
//    2. Active — checklist card with per-step completion + CTAs.
//    3. Complete + auto-collapsed — once all steps are satisfied AND
//       the user has dismissed, hidden permanently. Until dismissed
//       a "100% complete · dismiss" mini-banner renders.
//
//  Layout is additive: a single rounded-2xl card slot above the page's
//  existing top section. No existing element is moved or modified.
//
//  Aesthetic locked to the dashboard token language (ink-800/ink-900
//  gradient cards, violet-glow chip, accent-green for completed,
//  zinc-* for muted) so it reads as part of the existing surface.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { ArrowRight, CheckCircle2, Circle, Sparkles } from 'lucide-react';
import { fetchOnboardingChecklist } from '@/lib/data/onboardingChecklist';
import { ChecklistDismissButton } from './ChecklistDismissButton';
import { ChecklistRestoreButton } from './ChecklistRestoreButton';

interface Props {
  /**
   * Variant overrides for context-specific copy. Defaults to a neutral
   * "Get started" tone; the dashboard pages pass their own kicker if
   * they want it role-aware.
   */
  kicker?: string;
  title?: string;
}

export async function OnboardingChecklist({
  kicker = 'Get started',
  title = 'Finish setting up your account',
}: Props) {
  const data = await fetchOnboardingChecklist();
  if (!data) return null; // admin or unauthenticated
  if (data.total === 0) return null;

  const allComplete = data.completed === data.total;

  // Already dismissed AND not yet 100% complete — render the tiny
  // "Show checklist" restore link so the user can bring it back.
  if (data.dismissed && !allComplete) {
    return (
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] px-4 py-2 text-[11px] text-zinc-500">
        Onboarding checklist hidden ({data.completed}/{data.total}{' '}
        complete).{' '}
        <ChecklistRestoreButton />
      </div>
    );
  }

  // Already dismissed AND all complete — render nothing (clean dashboard).
  if (data.dismissed && allComplete) return null;

  return (
    <section
      aria-labelledby="onboarding-checklist-heading"
      className="rounded-2xl border border-white/[0.08] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-6 backdrop-blur-xl"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            <Sparkles className="h-3 w-3" strokeWidth={2} />
            {kicker}
          </p>
          <h2
            id="onboarding-checklist-heading"
            className="font-display text-xl font-semibold tracking-tight text-white"
          >
            {allComplete ? 'You are all set!' : title}
          </h2>
          {!allComplete && (
            <p className="text-sm leading-relaxed text-zinc-400">
              A short, role-specific checklist to make sure you get the
              most from the platform. Steps auto-tick as you complete
              them — no need to come back here.
            </p>
          )}
          {allComplete && (
            <p className="text-sm leading-relaxed text-zinc-400">
              Every onboarding step is complete. Dismiss this card to
              clear it from the dashboard.
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <ProgressPill
            percent={data.percent}
            completed={data.completed}
            total={data.total}
          />
          <ChecklistDismissButton />
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          aria-hidden
          className="h-full rounded-full bg-gradient-to-r from-violet-glow to-cyan-glow transition-[width] duration-500"
          style={{ width: `${data.percent}%` }}
        />
      </div>

      {/* Steps */}
      <ol className="mt-5 space-y-2">
        {data.steps.map((s, idx) => (
          <StepRow key={s.key} index={idx + 1} step={s} />
        ))}
      </ol>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function ProgressPill({
  percent,
  completed,
  total,
}: {
  percent: number;
  completed: number;
  total: number;
}) {
  const allDone = completed === total;
  const classes = allDone
    ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300'
    : 'border-white/[0.10] bg-white/[0.04] text-zinc-300';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-industrial ${classes}`}
    >
      <span className="font-display text-[11px] font-semibold">
        {completed}/{total}
      </span>
      <span className="text-zinc-500">·</span>
      <span>{percent}%</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function StepRow({
  index,
  step,
}: {
  index: number;
  step: {
    key: string;
    title: string;
    description?: string;
    completed: boolean;
    actionHref?: string;
    actionLabel?: string;
  };
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-white/[0.04] bg-white/[0.01] p-3.5 transition-colors">
      <div className="mt-0.5 shrink-0">
        {step.completed ? (
          <CheckCircle2
            className="h-5 w-5 text-emerald-300"
            strokeWidth={2}
            aria-label="Completed"
          />
        ) : (
          <Circle
            className="h-5 w-5 text-zinc-500"
            strokeWidth={1.75}
            aria-label="Not yet completed"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p
          className={`text-sm font-medium ${step.completed ? 'text-zinc-300' : 'text-zinc-100'}`}
        >
          <span className="mr-2 font-mono text-[10px] text-zinc-500">
            {String(index).padStart(2, '0')}
          </span>
          {step.title}
        </p>
        {step.description && (
          <p className="text-[12px] leading-relaxed text-zinc-500">
            {step.description}
          </p>
        )}
      </div>
      {!step.completed && step.actionHref && (
        <Link
          href={step.actionHref}
          className="group inline-flex shrink-0 items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/[0.08] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-200 transition-colors hover:border-violet-500/60 hover:bg-violet-500/[0.16] hover:text-violet-100"
        >
          {step.actionLabel ?? 'Open'}
          <ArrowRight
            className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
            strokeWidth={2}
          />
        </Link>
      )}
    </li>
  );
}
