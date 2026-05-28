// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/admin/domains/[slug]/readiness/page.tsx
//
//  Live readiness dashboard for one inspection domain. Renders Steps 1
//  (content readiness) and Step 2 (inspector pool) from
//  DOMAIN_LAUNCH_PLAYBOOK.md against the production database, plus a
//  verdict pill so the admin can see at a glance whether the domain is
//  ready to launch.
//
//  Route: /admin/domains/[slug]/readiness
//
//  Admin gating handled by the parent app/admin/layout.tsx (super_admin only).
//  No state mutation here — the actual is_launched flip stays on the
//  /admin/domains card so there is exactly one toggle surface for the team.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  Users,
  ClipboardList,
  ListChecks,
  Globe2,
  ExternalLink,
  Star,
} from 'lucide-react';
import {
  fetchDomainReadiness,
  type DomainReadinessReport,
  type InspectorMatch,
  type ReadinessVerdict,
  READINESS_THRESHOLD,
} from '@/lib/data/domainReadiness';
import { InspectionDomainBadge } from '@/components/inspection-domain/InspectionDomainBadge';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `Launch readiness · ${slug} · NEXPEC Admin`,
    description:
      'Pre-launch readiness dashboard — content seeding + inspector pool.',
  };
}

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function DomainReadinessPage({ params }: PageProps) {
  const { slug } = await params;
  const report = await fetchDomainReadiness(slug);

  if (!report.domain) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <Header report={report} />
      <VerdictBanner verdict={report.verdict} />
      <ContentReadinessCard report={report} />
      <InspectorPoolCard report={report} />
      <PreLaunchChecklistCard slug={slug} />
      <Footnote />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Header({ report }: { report: DomainReadinessReport }) {
  const d = report.domain!;
  return (
    <header className="space-y-3">
      <Link
        href="/admin/domains"
        className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={2} />
        Back to Inspection Domains
      </Link>

      <p className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">
        <Globe2 className="h-3 w-3" strokeWidth={2} />
        Domain Launch Readiness
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {d.display_name}
        </h1>
        <InspectionDomainBadge domain={d.slug} showAlways size="md" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
          {d.slug}
        </span>
      </div>

      <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">
        Live verification of every prerequisite before flipping{' '}
        <strong className="text-zinc-200">is_launched</strong>. Mirrors
        Steps 1 and 2 of{' '}
        <code className="font-mono text-zinc-300">
          DOMAIN_LAUNCH_PLAYBOOK.md
        </code>{' '}
        — content seeding and inspector-pool count — and renders the
        verdict below. The actual launch toggle stays on the{' '}
        <Link
          href="/admin/domains"
          className="text-violet-300 underline decoration-violet-500/50 underline-offset-4 transition-colors hover:text-violet-200"
        >
          /admin/domains
        </Link>{' '}
        page so there's exactly one place the team flips switches.
      </p>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function VerdictBanner({ verdict }: { verdict: ReadinessVerdict }) {
  const v = verdictStyle(verdict.kind);
  const Icon = v.icon;
  return (
    <article
      className={`rounded-2xl border ${v.border} ${v.bg} p-6 transition-colors`}
    >
      <div className="flex items-start gap-4">
        <div className={`mt-0.5 shrink-0 ${v.iconWrap}`}>
          <Icon className={`h-6 w-6 ${v.iconColor}`} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p
            className={`font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${v.kicker}`}
          >
            Launch verdict
          </p>
          <h2 className={`font-display text-xl font-semibold ${v.title}`}>
            {v.label}
          </h2>
          <p className="text-sm leading-relaxed text-zinc-400">
            {verdict.reason}
          </p>
        </div>
      </div>
    </article>
  );
}

function verdictStyle(kind: ReadinessVerdict['kind']) {
  switch (kind) {
    case 'live':
      return {
        label: 'Already live',
        border: 'border-violet-500/30',
        bg: 'bg-violet-500/[0.06]',
        kicker: 'text-violet-300',
        title: 'text-white',
        icon: Sparkles,
        iconColor: 'text-violet-300',
        iconWrap: '',
      };
    case 'ready':
      return {
        label: 'Ready to launch',
        border: 'border-emerald-500/30',
        bg: 'bg-emerald-500/[0.06]',
        kicker: 'text-emerald-300',
        title: 'text-white',
        icon: CheckCircle2,
        iconColor: 'text-emerald-300',
        iconWrap: '',
      };
    case 'caution':
      return {
        label: 'Caution',
        border: 'border-amber-500/30',
        bg: 'bg-amber-500/[0.05]',
        kicker: 'text-amber-300',
        title: 'text-white',
        icon: AlertTriangle,
        iconColor: 'text-amber-300',
        iconWrap: '',
      };
    case 'blocked':
    default:
      return {
        label: 'Blocked',
        border: 'border-rose-500/30',
        bg: 'bg-rose-500/[0.05]',
        kicker: 'text-rose-300',
        title: 'text-white',
        icon: AlertCircle,
        iconColor: 'text-rose-300',
        iconWrap: '',
      };
  }
}

/* ─────────────────────────────────────────────────────────────────── */

function ContentReadinessCard({ report }: { report: DomainReadinessReport }) {
  const d = report.domain!;
  const c = report.contentReadiness;

  return (
    <article className="rounded-2xl border border-white/[0.08] bg-ink-900/40 p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <ClipboardList
          className="h-4 w-4 text-violet-300"
          strokeWidth={2}
        />
        <h3 className="font-display text-lg font-semibold text-white">
          Content readiness
        </h3>
      </div>

      <p className="mb-5 text-sm leading-relaxed text-zinc-400">
        Confirms the database has the content the launch depends on. Any
        zero is a blocker — the relevant Phase migration didn't apply or
        rolled back.
      </p>

      <dl className="grid grid-cols-1 gap-3 rounded-xl border border-white/[0.06] bg-ink-950/40 p-4 sm:grid-cols-3">
        <Stat
          label="Default specialty groups"
          value={c.groupCount}
          ok={c.groupCount > 0}
          hint="≥1 required"
        />
        <Stat
          label="Active scope templates"
          value={c.scopeTemplateCount}
          ok={c.scopeTemplateCount > 0}
          hint="≥1 required"
        />
        <Stat
          label="Evidence requirements"
          value={c.evidenceRequirementCount}
          ok={c.evidenceRequirementCount > 0}
          hint="≥1 expected"
        />
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <StatusPill
          on={d.is_active}
          label="is_active"
          truthLabel="active"
          falseLabel="inactive (kill-switch)"
        />
        <StatusPill
          on={d.is_launched}
          label="is_launched"
          truthLabel="live"
          falseLabel="dark"
        />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">
          display order {d.display_order}
        </span>
      </div>

      {d.default_specialty_groups.length > 0 && (
        <div className="mt-5 space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Groups in scope
          </p>
          <div className="flex flex-wrap gap-1.5">
            {d.default_specialty_groups.map((g) => (
              <span
                key={g}
                className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[11px] text-zinc-300"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function Stat({
  label,
  value,
  ok,
  hint,
}: {
  label: string;
  value: number;
  ok: boolean;
  hint: string;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span
          className={`font-display text-xl font-semibold ${ok ? 'text-white' : 'text-rose-300'}`}
        >
          {value}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {hint}
        </span>
      </dd>
    </div>
  );
}

function StatusPill({
  on,
  label,
  truthLabel,
  falseLabel,
}: {
  on: boolean;
  label: string;
  truthLabel: string;
  falseLabel: string;
}) {
  const classes = on
    ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300'
    : 'border-white/[0.08] bg-white/[0.02] text-zinc-400';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] ${classes}`}
    >
      <code className="font-mono normal-case text-[10px] text-current/80">
        {label}
      </code>
      <span>{on ? truthLabel : falseLabel}</span>
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function InspectorPoolCard({ report }: { report: DomainReadinessReport }) {
  const p = report.inspectorPool;
  const meetsTarget = p.eligibleCount >= READINESS_THRESHOLD;

  return (
    <article className="rounded-2xl border border-white/[0.08] bg-ink-900/40 p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <Users className="h-4 w-4 text-violet-300" strokeWidth={2} />
        <h3 className="font-display text-lg font-semibold text-white">
          Inspector pool
        </h3>
      </div>

      <p className="mb-5 text-sm leading-relaxed text-zinc-400">
        Inspectors whose <code className="font-mono text-zinc-300">specialty_slugs</code>{' '}
        overlap with at least one of the{' '}
        <span className="font-semibold text-zinc-200">
          {p.disciplineSlugs.length}
        </span>{' '}
        canonical kebab disciplines mapped to this domain's groups.
        Launch target is{' '}
        <span className="font-semibold text-zinc-200">
          ≥ {READINESS_THRESHOLD}
        </span>{' '}
        eligible inspectors — below that, the first job will see thin
        matches.
      </p>

      <dl className="grid grid-cols-1 gap-3 rounded-xl border border-white/[0.06] bg-ink-950/40 p-4 sm:grid-cols-3">
        <Stat
          label="Eligible inspectors"
          value={p.eligibleCount}
          ok={meetsTarget}
          hint={`≥ ${READINESS_THRESHOLD} target`}
        />
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Disciplines in scope
          </dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold text-white">
              {p.disciplineSlugs.length}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              canonical kebab slugs
            </span>
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Top matches surfaced
          </dt>
          <dd className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold text-white">
              {p.topMatches.length}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
              ranked by overlap
            </span>
          </dd>
        </div>
      </dl>

      {p.topMatches.length > 0 && (
        <div className="mt-5">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Strongest matches
          </p>
          <div className="overflow-hidden rounded-xl border border-white/[0.06]">
            <table className="w-full text-left">
              <thead className="bg-white/[0.02] text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Inspector</th>
                  <th className="px-3 py-2 text-right font-medium">Overlap</th>
                  <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                    Specialties
                  </th>
                  <th className="hidden px-3 py-2 text-right font-medium md:table-cell">
                    Rating
                  </th>
                  <th className="hidden px-3 py-2 text-right font-medium lg:table-cell">
                    Completed jobs
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {p.topMatches.map((m) => (
                  <InspectorRow key={m.id} match={m} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {p.topMatches.length === 0 && (
        <div className="mt-5 rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
          <p className="text-[11px] leading-relaxed text-zinc-500">
            No inspectors with overlapping kebab specialties yet. Run an
            inspector-outreach pass against the disciplines below, or
            seed a few test profiles, before flipping the launch toggle.
          </p>
        </div>
      )}
    </article>
  );
}

function InspectorRow({ match }: { match: InspectorMatch }) {
  const label = match.full_name?.trim() || match.email || match.id.slice(0, 8);
  return (
    <tr className="text-sm">
      <td className="px-3 py-2.5">
        <Link
          href={`/admin/users/${match.id}`}
          className="inline-flex items-center gap-1.5 font-medium text-zinc-100 transition-colors hover:text-violet-300"
        >
          {label}
          <ExternalLink className="h-3 w-3 text-zinc-500" strokeWidth={2} />
        </Link>
        {match.email && match.full_name && (
          <p className="font-mono text-[10px] text-zinc-500">{match.email}</p>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="font-display text-base font-semibold text-white">
          {match.specialty_overlap}
        </span>
      </td>
      <td className="hidden px-3 py-2.5 text-right font-mono text-[11px] text-zinc-400 sm:table-cell">
        {match.total_specialties}
      </td>
      <td className="hidden px-3 py-2.5 text-right md:table-cell">
        {match.rating_average == null ? (
          <span className="font-mono text-[11px] text-zinc-600">—</span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-300">
            <Star className="h-3 w-3 text-amber-300" strokeWidth={2} />
            {match.rating_average.toFixed(2)}
            <span className="text-zinc-500">
              ({match.rating_count ?? 0})
            </span>
          </span>
        )}
      </td>
      <td className="hidden px-3 py-2.5 text-right font-mono text-[11px] text-zinc-400 lg:table-cell">
        {match.completed_jobs_count ?? 0}
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function PreLaunchChecklistCard({ slug }: { slug: string }) {
  return (
    <article className="rounded-2xl border border-white/[0.08] bg-ink-900/40 p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <ListChecks className="h-4 w-4 text-violet-300" strokeWidth={2} />
        <h3 className="font-display text-lg font-semibold text-white">
          Pre-launch manual checks
        </h3>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-zinc-400">
        Steps 3 and 4 of the playbook are operational — they don't have
        a dashboard surface. Run through them before flipping the launch
        switch from{' '}
        <Link
          href="/admin/domains"
          className="text-violet-300 underline decoration-violet-500/50 underline-offset-4 transition-colors hover:text-violet-200"
        >
          /admin/domains
        </Link>
        .
      </p>

      <ul className="space-y-2.5">
        <ChecklistItem n={3} title="Identify a candidate inspector">
          Pick the strongest match from the table above. Reach out
          to confirm they'd accept the first job posted in this domain
          before you go live.
        </ChecklistItem>
        <ChecklistItem n={4} title="Smoke-test the consumer flow">
          With <code className="font-mono text-zinc-300">is_launched</code>{' '}
          still false: post a sample job from <code className="font-mono text-zinc-300">/client/jobs/new</code>
          {' '}with this domain, approve from{' '}
          <code className="font-mono text-zinc-300">/admin/jobs</code>,
          sign in as the candidate inspector to confirm the job appears
          on <code className="font-mono text-zinc-300">/inspector/jobs</code>,
          then cancel the test job.
        </ChecklistItem>
        <ChecklistItem n={5} title="Flip the launch toggle" terminal>
          Once Steps 3 and 4 pass, head to{' '}
          <code className="font-mono text-zinc-300">/admin/domains</code>{' '}
          and toggle <strong className="text-zinc-200">Launched</strong>{' '}
          on for{' '}
          <code className="font-mono text-zinc-300">{slug}</code>.
          Effective immediately on the next page load.
        </ChecklistItem>
      </ul>
    </article>
  );
}

function ChecklistItem({
  n,
  title,
  children,
  terminal,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
  terminal?: boolean;
}) {
  return (
    <li className="flex gap-3 rounded-xl border border-white/[0.04] bg-white/[0.01] p-3">
      <span
        className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
          terminal
            ? 'border-violet-500/40 bg-violet-500/[0.12] text-violet-300'
            : 'border-white/[0.10] bg-white/[0.04] text-zinc-300'
        } font-mono text-[11px] font-semibold`}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-zinc-100">{title}</p>
        <p className="text-[12px] leading-relaxed text-zinc-400">
          {children}
        </p>
      </div>
    </li>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Footnote() {
  return (
    <footer className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
        <ShieldCheck
          className="mt-0.5 h-3 w-3 shrink-0 text-violet-glow"
          strokeWidth={2}
        />
        <span>
          All counts read live against the production database on every
          request (page is{' '}
          <code className="font-mono text-zinc-400">
            dynamic = &apos;force-dynamic&apos;
          </code>
          ). No cache layer to invalidate after an inspector updates
          their specialties or a new scope template lands. The actual
          launch toggle stays on{' '}
          <code className="font-mono text-zinc-400">/admin/domains</code>{' '}
          so there's exactly one place the team flips switches.
        </span>
      </p>
    </footer>
  );
}
