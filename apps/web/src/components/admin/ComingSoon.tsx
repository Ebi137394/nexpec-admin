// ════════════════════════════════════════════════════════════════════════════
//  components/admin/ComingSoon.tsx
//
//  Reusable placeholder for every admin route that is routed + RLS-gated
//  but not yet implemented. Designed to look like an intentional "what's
//  next" page rather than an unfinished stub:
//
//    - Hero with the surface's icon, title, and a one-line value prop.
//    - A timestamped "Shipping next" badge so anyone demoing the console
//      can answer "when?" without checking with engineering.
//    - A bulleted feature list — exactly what the surface will do.
//    - A small "data sources" panel listing the tables + RPCs the surface
//      will read from, so anyone auditing the platform can verify the
//      backend already exists.
//    - Back-to-Dashboard CTA.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { ArrowLeft, Clock3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ComingSoonProps {
  /** Page hero title (e.g. "Jobs Moderation"). */
  title: string;
  /** One-line value prop directly under the title. */
  subtitle: string;
  /** Lucide icon for the hero badge. */
  icon: LucideIcon;
  /** Tone of the icon badge. */
  tone?: 'violet' | 'cyan' | 'amber' | 'red';
  /** When this surface ships ("Sprint 3", "Sprint 4", etc.). */
  shippingIn: string;
  /** What the surface will actually do, bulleted. 3–6 items. */
  features: string[];
  /** Backend dependencies the surface reads from. */
  dataSources: string[];
}

export function ComingSoon({
  title,
  subtitle,
  icon: Icon,
  tone = 'violet',
  shippingIn,
  features,
  dataSources,
}: ComingSoonProps) {
  const iconClasses =
    tone === 'cyan'
      ? 'bg-cyan-glow/10 text-cyan-glow ring-cyan-glow/30'
      : tone === 'amber'
        ? 'bg-accent-amber/10 text-accent-amber ring-accent-amber/30'
        : tone === 'red'
          ? 'bg-accent-red/10 text-accent-red ring-accent-red/30'
          : 'bg-violet/15 text-violet-glow ring-violet/30';

  return (
    <div className="space-y-10">
      {/* Hero */}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
        <span
          className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ${iconClasses}`}
        >
          <Icon className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Command Console · Placeholder
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-industrial text-zinc-300">
              <Clock3 className="h-3 w-3 text-violet-glow" />
              Shipping · {shippingIn}
            </span>
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400 sm:text-base">
            {subtitle}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Features — what this surface does */}
        <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-6 backdrop-blur-xl lg:col-span-2">
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            What this surface will do
          </p>
          <ul className="mt-4 space-y-3">
            {features.map((f, i) => (
              <li key={i} className="flex gap-3 text-sm text-zinc-300">
                <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-violet-glow" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Data sources — backend dependencies */}
        <aside className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Reads from
          </p>
          <ul className="mt-4 space-y-2">
            {dataSources.map((src) => (
              <li
                key={src}
                className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-xs text-zinc-300"
              >
                {src}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
            These tables and RPCs are already live in the database. RLS gates
            access to super_admin. The remaining work is the UI wiring.
          </p>
        </aside>
      </div>

      {/* Back link */}
      <div className="pt-2">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
