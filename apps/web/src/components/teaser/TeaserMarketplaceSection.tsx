// ════════════════════════════════════════════════════════════════════════════
//  components/teaser/TeaserMarketplaceSection.tsx — the public feed section (RSC)
//
//  Async Server Component. Fetches the two privacy-isolated feeds + counts and
//  renders a premium, dark/violet B2B surface: eyebrow + gradient headline,
//  a live stat strip, two columns (Open Demand · Vetted Talent), and two-sided
//  CTAs. Degrades gracefully to a lean CTA block when the feeds are still empty.
//
//  `variant="section"` → compact (3/side) + "Explore" link, for the landing.
//  `variant="full"`    → 12/side, for the dedicated ISR /discover page.
//
//  Pure server component (no client boundary) → prerender- and ISR-safe.
// ════════════════════════════════════════════════════════════════════════════
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Radio, Sparkles } from 'lucide-react';
import {
  fetchDemandTeasers,
  fetchSupplyTeasers,
  fetchTeaserStats,
} from '@/lib/data/teaser';
import { JobTeaserCard } from './JobTeaserCard';
import { TalentSpotlightCard } from './TalentSpotlightCard';

export async function TeaserMarketplaceSection({
  variant = 'section',
}: {
  variant?: 'section' | 'full';
}) {
  const perSide = variant === 'full' ? 12 : 3;
  const [demand, supply, stats] = await Promise.all([
    fetchDemandTeasers(perSide),
    fetchSupplyTeasers(perSide),
    fetchTeaserStats(),
  ]);

  const isEmpty = demand.length === 0 && supply.length === 0;
  const hasStats = stats.openDemand > 0 || stats.vettedTalent > 0;

  return (
    <section id="marketplace" className="relative py-24 sm:py-32">
      <div className="container-narrow">
        {/* Header */}
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow inline-flex items-center gap-2">
              <Radio className="h-3.5 w-3.5" aria-hidden />
              Live Marketplace
            </p>
            <h2 className="mt-3 max-w-2xl text-balance font-display text-4xl font-semibold tracking-tight sm:text-5xl">
              <span className="headline-gradient">A working marketplace,</span> in the open.
            </h2>
            <p className="mt-4 max-w-xl text-pretty text-zinc-400">
              Real inspection demand and vetted specialists — identities protected, every
              engagement brokered and escrowed through NEXPEC.
            </p>
          </div>
          {variant === 'section' && (
            <Link href="/discover" className="btn-secondary shrink-0">
              Explore the marketplace
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
        </div>

        {/* Stat strip */}
        {hasStats && (
          <div className="mt-10 flex flex-wrap gap-3">
            {stats.openDemand > 0 && (
              <StatPill value={stats.openDemand} label="open inspections" />
            )}
            {stats.vettedTalent > 0 && (
              <StatPill value={stats.vettedTalent} label="vetted specialists" />
            )}
          </div>
        )}

        {/* Body */}
        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="mt-12 grid gap-x-8 gap-y-10 lg:grid-cols-2">
            <Column eyebrow="Open demand" title="Inspections seeking specialists">
              {demand.length ? (
                demand.map((j, i) => <JobTeaserCard key={`${j.source_kind}-${i}`} job={j} />)
              ) : (
                <Placeholder text="New inspections are posting soon." />
              )}
            </Column>
            <Column eyebrow="Vetted talent" title="Specialists available for dispatch">
              {supply.length ? (
                supply.map((p) => <TalentSpotlightCard key={p.handle} pro={p} />)
              ) : (
                <Placeholder text="Featured specialists are coming online." />
              )}
            </Column>
          </div>
        )}

        {/* CTAs */}
        <div className="mt-14 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/sign-up" className="btn-primary">
            Post an inspection
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/sign-up" className="btn-secondary">
            Join as an inspector
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Local presentational helpers (server components) ──
function StatPill({ value, label }: { value: number; label: string }) {
  return (
    <div className="inline-flex items-baseline gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 backdrop-blur-sm">
      <span className="font-display text-lg font-semibold text-white">
        {value.toLocaleString('en-US')}
      </span>
      <span className="text-sm text-zinc-400">{label}</span>
    </div>
  );
}

function Column({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="border-b border-white/[0.06] pb-3">
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="mt-1 text-sm text-zinc-400">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.02] p-6 text-sm text-zinc-500">
      {text}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-12 flex flex-col items-center gap-4 rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-12 text-center backdrop-blur-xl">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet to-cyan-glow shadow-glow">
        <Sparkles className="h-6 w-6 text-white" aria-hidden />
      </div>
      <h3 className="font-display text-xl font-semibold text-white">The marketplace is coming online</h3>
      <p className="max-w-md text-pretty text-sm text-zinc-400">
        Vetted specialists and open inspections will surface here as they go live — identities
        protected, every engagement brokered through NEXPEC.
      </p>
    </div>
  );
}
