// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/marketing/PlatformScale.tsx
//
//  Sprint 13 homepage showcase. A premium dark/violet section that surfaces
//  the platform's structural breadth in numbers that mean something to
//  industrial-inspection buyers:
//    • 5 inspection domains, each with its own scope catalogue
//    • 57 scope templates indexed across all domains
//    • 389 structured evidence requirements
//    • Public inspector directory
//    • Cmd+K global search
//
//  Strictly additive: drops in between the existing TrustPillars and
//  Industries sections without changing either.
//
//  Token-faithful to the existing platform palette:
//    ink-900 (#020420 — the brand background)
//    violet-glow / violet (the #7C3AED purple)
//    cyan-glow accent
//    tracking-industrial mono kicker pattern
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  ShieldCheck,
  Building2,
  Wrench,
  HardHat,
  Sparkles,
  ArrowUpRight,
  Search,
  Star,
  Users,
  CheckCircle2,
} from 'lucide-react';

const DOMAINS = [
  {
    slug: 'industrial_ndt',
    label: 'Industrial & NDT',
    persona: 'Asset Integrity Manager',
    blurb: 'Pipeline, refinery, asset-integrity inspection with full NDT method coverage.',
    icon: ShieldCheck,
    accent: 'from-violet/40 to-violet/0',
    href: '/inspectors?specialties=ndt-ut,ndt-paut,api-510,api-570',
  },
  {
    slug: 'civil_construction',
    label: 'Civil & Construction',
    persona: 'Construction Project Manager',
    blurb: 'Quality assurance for concrete, rebar, structural steel, and field testing.',
    icon: Building2,
    accent: 'from-cyan-glow/40 to-cyan-glow/0',
    href: '/inspectors?specialties=concrete-inspection,structural-steel,bridge-inspection',
  },
  {
    slug: 'electrical',
    label: 'Electrical',
    persona: 'Facility / Reliability Manager',
    blurb: 'NETA testing, thermography, switchgear, arc-flash compliance.',
    icon: HardHat,
    accent: 'from-amber-400/40 to-amber-400/0',
    href: '/inspectors?specialties=electrical-inspection,ndt-irt,plc-scada',
  },
  {
    slug: 'mechanical_field',
    label: 'Mechanical Field',
    persona: 'Turnaround / Construction Manager',
    blurb: 'Welding, piping, rotating equipment, pressure testing.',
    icon: Wrench,
    accent: 'from-rose-400/40 to-rose-400/0',
    href: '/inspectors?specialties=aws-cwi,api-510,vibration-analysis',
  },
  {
    slug: 'chemical_process',
    label: 'Chemical & Process',
    persona: 'HSE / Process Safety Manager',
    blurb: 'PSM compliance, hazardous-material handling, batch chemistry validation.',
    icon: Sparkles,
    accent: 'from-emerald-400/40 to-emerald-400/0',
    href: '/inspectors?specialties=psm,pha-hazop,mechanical-integrity',
  },
];

const PROOF_POINTS = [
  {
    value: '5',
    label: 'Inspection domains',
    sub: 'NDT, Civil, Electrical, Mechanical, Chemical',
  },
  {
    value: '57',
    label: 'Scope templates indexed',
    sub: 'Across every active domain',
  },
  {
    value: '389',
    label: 'Evidence requirements',
    sub: 'Structured per scope',
  },
  {
    value: '300+',
    label: 'Canonical specialties',
    sub: 'One taxonomy across web + mobile',
  },
];

export function PlatformScale() {
  return (
    <section
      id="platform-scale"
      className="relative isolate overflow-hidden border-y border-white/[0.06] bg-gradient-to-b from-ink-900 via-ink-900 to-ink-950 py-20 sm:py-28"
    >
      {/* Decorative violet gradient blobs — pure CSS, no images. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute -top-32 left-1/2 h-[40rem] w-[40rem] -translate-x-1/2 rounded-full bg-violet/20 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-[28rem] w-[28rem] rounded-full bg-cyan-glow/10 blur-3xl" />
      </div>

      <div className="container-narrow space-y-12 px-4 sm:px-6">
        {/* Header */}
        <div className="max-w-3xl space-y-4">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-300">
            <Sparkles className="h-3 w-3" strokeWidth={2} />
            The platform, at a glance
          </p>
          <h2 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
            One platform.{' '}
            <span className="bg-gradient-to-r from-violet-glow via-violet to-cyan-glow bg-clip-text text-transparent">
              Five disciplines.
            </span>{' '}
            Audit-grade by design.
          </h2>
          <p className="text-pretty text-base leading-relaxed text-zinc-400 sm:text-lg">
            NEXPEC indexes the entire industrial inspection surface —
            from API 653 storage tank reads to PSM compliance audits —
            with structured scope templates, signed reports, and inspectors
            verified against named credentials.
          </p>
        </div>

        {/* Proof points — 4-stat strip */}
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          {PROOF_POINTS.map((p) => (
            <div
              key={p.label}
              className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5 backdrop-blur-xl transition-colors hover:border-violet-500/30"
            >
              <dd className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                {p.value}
              </dd>
              <dt className="mt-2 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                {p.label}
              </dt>
              <p className="mt-1 text-[11px] text-zinc-500">{p.sub}</p>
            </div>
          ))}
        </dl>

        {/* Domain showcase */}
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="font-display text-xl font-semibold tracking-tight text-white sm:text-2xl">
              Find the right inspector by domain
            </h3>
            <Link
              href="/inspectors"
              className="group inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-industrial text-violet-300 transition-colors hover:text-violet-200"
            >
              Browse the full directory
              <ArrowUpRight
                className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                strokeWidth={2}
              />
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {DOMAINS.map((d) => (
              <DomainCard key={d.slug} domain={d} />
            ))}
          </div>
        </div>

        {/* Capability strip */}
        <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-r from-ink-800/60 via-ink-900/30 to-ink-900/60 p-6 backdrop-blur-xl sm:p-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <CapabilityCell
              icon={Search}
              title="Cmd + K search"
              body="One overlay searches inspectors, your jobs, and scope templates. Permission-aware, sub-second."
            />
            <CapabilityCell
              icon={Users}
              title="Public directory"
              body="Filterable, SEO-indexed inspector pages with ratings, reviews, and verification badges."
              href="/inspectors"
            />
            <CapabilityCell
              icon={CheckCircle2}
              title="Verified credentials"
              body="Every inspector ships with a structured certification set. API 510, AWS CWI, NACE CIP — all canonical."
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function DomainCard({
  domain,
}: {
  domain: (typeof DOMAINS)[number];
}) {
  const Icon = domain.icon;
  return (
    <Link
      href={domain.href}
      className="group relative isolate flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-5 transition-all hover:border-violet-500/40 hover:shadow-[0_0_0_1px_rgba(124,58,237,0.25)]"
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -top-12 right-0 h-32 w-32 rounded-full bg-gradient-to-br ${domain.accent} blur-2xl transition-opacity group-hover:opacity-100 opacity-70`}
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/[0.10] text-violet-200">
          <Icon className="h-4 w-4" strokeWidth={2} />
        </div>
        <ArrowUpRight
          className="h-4 w-4 text-zinc-600 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-violet-300"
          strokeWidth={2}
        />
      </div>
      <div className="relative space-y-1.5">
        <h4 className="font-display text-base font-semibold tracking-tight text-white">
          {domain.label}
        </h4>
        <p className="font-mono text-[10px] uppercase tracking-industrial text-violet-glow/80">
          {domain.persona}
        </p>
      </div>
      <p className="relative mt-auto text-[12px] leading-relaxed text-zinc-400">
        {domain.blurb}
      </p>
    </Link>
  );
}

function CapabilityCell({
  icon: Icon,
  title,
  body,
  href,
}: {
  icon: typeof Search;
  title: string;
  body: string;
  href?: string;
}) {
  const inner = (
    <div className="space-y-2.5">
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-glow/30 bg-cyan-glow/[0.06] text-cyan-glow">
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>
      <h4 className="font-display text-base font-semibold tracking-tight text-white">
        {title}
        {href && (
          <Star
            className="ml-1 inline-block h-3 w-3 text-violet-glow"
            strokeWidth={2}
            aria-hidden
          />
        )}
      </h4>
      <p className="text-[13px] leading-relaxed text-zinc-400">{body}</p>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="group block transition-colors">
        {inner}
      </Link>
    );
  }
  return <div>{inner}</div>;
}
