// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/admin/domains/page.tsx — Inspection Domains (admin)
//
//  Surfaces the four inspection_domains config rows for the Platform
//  Owner / super_admin. Lets them flip is_launched and is_active without
//  touching SQL.
//
//  No nav entry yet — accessed by typing /admin/domains. Once domains
//  are actually being launched, we'll wire a sidebar entry in a future
//  micro-iteration.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Globe2,
  ShieldCheck,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react';
import {
  fetchInspectionDomains,
  fetchJobCountsByDomain,
  type InspectionDomainRow,
} from '@/lib/data/inspectionDomains';
import { InspectionDomainBadge } from '@/components/inspection-domain/InspectionDomainBadge';
import { DomainToggles } from './DomainToggles';

export const metadata: Metadata = {
  title: 'Inspection Domains, NEXPEC Admin',
  description: 'Configure inspection-domain launch state and visibility.',
};

export const dynamic = 'force-dynamic';

export default async function AdminDomainsPage() {
  const [domains, jobCounts] = await Promise.all([
    fetchInspectionDomains(),
    fetchJobCountsByDomain(),
  ]);
  const countBySlug = new Map(jobCounts.map((c) => [c.slug, c.count]));

  return (
    <div className="space-y-8">
      {/* Page header */}
      <header className="space-y-3">
        <p className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">
          <Globe2 className="h-3 w-3" strokeWidth={2} />
          PLATFORM CONFIGURATION
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Inspection Domains
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
          One row per inspection vertical NEXPEC supports. <strong className="text-zinc-200">is_launched</strong> controls
          whether a domain is publicly surfaced. <strong className="text-zinc-200">is_active</strong> is the kill-switch,
          flip it off to immediately hide a domain from every surface,
          including for users mid-flow. Both toggles are super_admin
          only, defended at the RLS layer.
        </p>
      </header>

      {/* Domain rows */}
      <section className="space-y-4">
        {domains.length === 0 ? (
          <EmptyState />
        ) : (
          domains.map((d) => (
            <DomainCard
              key={d.slug}
              domain={d}
              activeJobs={countBySlug.get(d.slug) ?? 0}
            />
          ))
        )}
      </section>

      <Footnote />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function DomainCard({
  domain,
  activeJobs,
}: {
  domain: InspectionDomainRow;
  activeJobs: number;
}) {
  return (
    <article className="rounded-2xl border border-white/[0.08] bg-ink-900/40 p-6 transition-colors hover:border-violet-500/20">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        {/* Left — metadata */}
        <div className="space-y-3 sm:flex-1">
          <div className="flex items-center gap-3">
            <InspectionDomainBadge domain={domain.slug} showAlways size="md" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              {domain.slug}
            </span>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-white">
              {domain.display_name}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              <span className="font-medium text-zinc-300">Persona:</span>{' '}
              {domain.persona_label}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {domain.short_pitch}
            </p>
          </div>

          {/* Regulatory bodies */}
          {domain.regulatory_bodies.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {domain.regulatory_bodies.map((body) => (
                <span
                  key={body}
                  className="rounded border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300"
                >
                  {body}
                </span>
              ))}
            </div>
          )}

          {/* Default specialty groups */}
          {domain.default_specialty_groups.length > 0 && (
            <div className="space-y-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Default specialty groups
              </p>
              <div className="flex flex-wrap gap-1.5">
                {domain.default_specialty_groups.map((g) => (
                  <span
                    key={g}
                    className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[11px] text-zinc-400"
                  >
                    {g}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right — toggles + stats */}
        <div className="space-y-4 sm:w-72 sm:shrink-0">
          <DomainToggles
            slug={domain.slug}
            isLaunched={domain.is_launched}
            isActive={domain.is_active}
          />

          <dl className="grid grid-cols-2 gap-3 rounded-xl border border-white/[0.06] bg-ink-950/40 p-3">
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Jobs
              </dt>
              <dd className="mt-1 font-display text-xl font-semibold text-white">
                {activeJobs}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
                Order
              </dt>
              <dd className="mt-1 font-display text-xl font-semibold text-zinc-400">
                {domain.display_order}
              </dd>
            </div>
          </dl>

          {/* Launch readiness drill-in, live dashboard for content +
              inspector-pool checks. The actual is_launched toggle stays
              above so there's one canonical flip surface. */}
          <Link
            href={`/admin/domains/${domain.slug}/readiness`}
            className="group inline-flex w-full items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400 transition-colors hover:border-violet-500/30 hover:bg-violet-500/[0.08] hover:text-violet-300"
          >
            <span>Launch readiness</span>
            <ArrowUpRight
              className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              strokeWidth={2}
            />
          </Link>
        </div>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-6 text-center">
      <AlertTriangle
        className="mx-auto h-6 w-6 text-amber-400"
        strokeWidth={2}
      />
      <h2 className="mt-3 font-display text-lg font-semibold text-white">
        No domains configured
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        Apply migration{' '}
        <code className="font-mono text-zinc-300">
          20260616120000_inspection_domain_primitive.sql
        </code>{' '}
        and the four seed rows will appear here.
      </p>
    </div>
  );
}

function Footnote() {
  return (
    <footer className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
        <ShieldCheck
          className="mt-0.5 h-3 w-3 shrink-0 text-violet-glow"
          strokeWidth={2}
        />
        <span>
          Domain visibility is enforced by the{' '}
          <code className="font-mono text-zinc-400">
            inspection_domains_admin_write
          </code>{' '}
          RLS policy. Toggle attempts by non-super-admin accounts are
          rejected at the database layer.
        </span>
      </p>
    </footer>
  );
}
