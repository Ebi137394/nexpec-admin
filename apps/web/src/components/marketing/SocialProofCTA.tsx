// ════════════════════════════════════════════════════════════════════════════
//  components/marketing/SocialProofCTA.tsx
//
//  Conditional, data-driven social-proof CTA for the landing page. Replaces the
//  old fake-stats LiveTicker. Server Component: it fetches the REAL total job
//  count and renders NOTHING until the marketplace has genuine traction
//  (>= THRESHOLD jobs). Above the threshold it shows a single, high-intent hook
//  that pushes inspectors to create an account and bid on live work.
//
//  Brand-locked: #020420 background (ink-950) + #7C3AED primary (violet). No new
//  design tokens. Self-contained <section> with the same `container-narrow` +
//  pb-20 rhythm the surrounding marketing sections use, so it slots into the
//  page flow with zero layout impact.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { ArrowUpRight, Briefcase } from 'lucide-react';
import { fetchTotalJobCount } from '@/lib/data/publicJobCount';

// Don't claim social proof until it's real.
const THRESHOLD = 100;

/**
 * Honest, rounded-DOWN milestone so the headline never overstates the number.
 * 137 → 100, 280 → 250, 1240 → 1200.
 */
function milestone(n: number): number {
  if (n >= 1000) return Math.floor(n / 100) * 100;
  return Math.floor(n / 50) * 50;
}

function formatMilestone(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return String(n);
}

export async function SocialProofCTA() {
  const count = await fetchTotalJobCount();

  // Gate: render absolutely nothing below the traction threshold (or on any
  // fetch failure). The page flows as if this section doesn't exist.
  if (count === null || count < THRESHOLD) return null;

  const shown = formatMilestone(milestone(count));

  return (
    <section aria-label="Join the NEXPEC marketplace" className="relative pb-20">
      <div className="container-narrow">
        <div className="relative overflow-hidden rounded-3xl border border-violet/30 bg-gradient-to-b from-ink-900/80 to-ink-950 p-8 sm:p-12">
          {/* Violet glow accents — pure decoration, pointer-events-none. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-violet/20 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-violet/10 blur-3xl"
          />

          <div className="relative flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-glow opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-glow" />
                </span>
                Live marketplace
              </span>

              <h2 className="mt-5 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                <span className="text-violet-glow">{shown}+</span> inspection jobs
                dispatched, and counting.
              </h2>
              <p className="mt-3 text-pretty text-base leading-relaxed text-zinc-400">
                Vetted inspectors are getting hired and paid through escrow on
                NEXPEC. Create your free inspector profile, get verified, and
                start bidding on live, paid work, today.
              </p>
            </div>

            <div className="flex w-full shrink-0 flex-col items-stretch gap-3 sm:w-auto sm:flex-row lg:flex-col">
              <Link
                href="/sign-up"
                className="btn-primary inline-flex items-center justify-center gap-2 whitespace-nowrap"
              >
                Create your inspector account
                <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:text-white"
              >
                <Briefcase className="h-4 w-4" strokeWidth={2} />
                View open opportunities
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
