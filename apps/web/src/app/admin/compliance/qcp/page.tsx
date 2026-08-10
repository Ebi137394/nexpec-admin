// ════════════════════════════════════════════════════════════════════════════
//  app/admin/compliance/qcp/page.tsx — Quality Control Plans
//
//  The governing quality document, listed. A QCP binds a project (and where
//  relevant an organization and a supplier) to a set of scope templates,
//  stages, responsibilities, required documents and approvals, under an
//  append-preserving revision.
//
//  ── WHY IT LIVES UNDER /admin/compliance ───────────────────────────────────
//  Because that is where the Scope Template Library it orchestrates already
//  lives. QCP is not a second application: it selects existing
//  inspection_scope_templates rows, the ITP points arrive with them through
//  itp_points.template_id, and putting the plan anywhere else would imply a
//  parallel template spine that the frozen contract exists to forbid.
//
//  ── STATUS IS THE REVISION'S ───────────────────────────────────────────────
//  A plan has no status column — it is an identity. Every state shown here is
//  the state of one of its revisions, and "effective" means the single approved
//  one the partial unique index guarantees.
//
//  ── NO MONEY, STRUCTURALLY ─────────────────────────────────────────────────
//  Nothing on this page selects, joins or renders base_price_cents, and
//  QcpScopeTemplateOption has no price field for one to land in. A QCP is a
//  quality document; creating, approving or superseding one moves nothing and
//  settlement stays manual.
//
//  Admin gating is enforced by app/admin/layout.tsx and re-checked here via
//  nx_is_admin (fail closed on any future routing slip); the RPCs and RLS check
//  again server-side.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft, PlusCircle, ChevronRight, ClipboardCheck, FolderKanban, Building2,
  Factory, GitBranch, ShieldCheck,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchAdminQcpList, formatQcpDateTime,
  QCP_REVISION_STATUSES, QCP_STATUS_LABELS,
  type QcpListItem, type QcpRevisionStatus,
} from '@/lib/data/qcp';
import { QcpStatusBadge } from '@/components/qcp/QcpStatusBadge';

export const metadata: Metadata = {
  title: 'Admin, Quality Control Plans',
  description:
    'The governing quality document binding a project to scope templates, stages, responsibilities, required documents and approvals.',
};
export const dynamic = 'force-dynamic';

function isStatus(v: string | undefined): v is QcpRevisionStatus {
  return (
    typeof v === 'string' && (QCP_REVISION_STATUSES as readonly string[]).includes(v)
  );
}

export default async function AdminQcpListPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; created?: string; error?: string }>;
}) {
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/admin/compliance/qcp'));
  const { data: isAdminData } = await supabase.rpc('nx_is_admin');
  if (!isAdminData) redirect('/');

  const status = isStatus(sp.status) ? sp.status : undefined;
  // The filter is applied over the LATEST revision of each plan, which is what
  // a reader means by "show me the drafts" — not "show me plans that have ever
  // had a draft", which would be every plan that exists.
  const plans = await fetchAdminQcpList({ status });
  const all = status ? await fetchAdminQcpList({}) : plans;

  const counts = QCP_REVISION_STATUSES.reduce<Record<QcpRevisionStatus, number>>(
    (acc, s) => {
      acc[s] = all.filter((p) => p.latestStatus === s).length;
      return acc;
    },
    { draft: 0, under_review: 0, approved: 0, superseded: 0 },
  );
  const effectiveCount = all.filter((p) => p.effectiveRevisionNo !== null).length;

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/admin/compliance"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Compliance overview
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Command Console, Compliance
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Quality Control Plans
            </h1>
            <p className="mt-2 max-w-3xl text-pretty text-sm text-zinc-400">
              The governing quality document. A plan binds a project — and where
              relevant an organization and a supplier — to a set of scope
              templates, stages, responsibilities, required documents and
              approvals, under a revision that is never rewritten.
            </p>
          </div>
          <Link
            href="/admin/compliance/qcp/new"
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-white/[0.08] sm:self-end"
          >
            <PlusCircle className="h-4 w-4" strokeWidth={2} />
            New plan
          </Link>
        </div>

        <p className="mt-4 max-w-3xl rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs leading-relaxed text-zinc-500">
          A plan <span className="text-zinc-300">orchestrates</span>, it does not
          own points. Selecting a template into a stage brings that
          template&apos;s ITP points with it — there is one template spine,
          shared with the{' '}
          <Link href="/admin/compliance/templates" className="text-zinc-300 underline">
            Scope Template Library
          </Link>{' '}
          and with{' '}
          <span className="font-mono text-zinc-400">jobs.scope_template_id</span>.
          Nothing here is commercial: no price, payout or margin is read, and
          approving a plan moves no money.
        </p>
      </header>

      {sp.created && (
        <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-2 text-xs text-emerald-200/90">
          Plan created with revision 1 in draft.
        </p>
      )}
      {sp.error && (
        <p className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-2 text-xs text-rose-200">
          {sp.error}
        </p>
      )}

      {/* ── Aggregates ─────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Plans" value={all.length} />
        <Stat label="Effective" value={effectiveCount} />
        {QCP_REVISION_STATUSES.map((s) => (
          <Stat key={s} label={QCP_STATUS_LABELS[s]} value={counts[s]} />
        ))}
      </section>

      {/* ── Filter by the state of the newest revision ─────────────────── */}
      <nav
        aria-label="Filter plans by the state of their newest revision"
        className="flex flex-wrap gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-1.5"
      >
        <FilterLink href="/admin/compliance/qcp" label="All" count={all.length} active={!status} />
        {QCP_REVISION_STATUSES.map((s) => (
          <FilterLink
            key={s}
            href={`/admin/compliance/qcp?status=${s}`}
            label={QCP_STATUS_LABELS[s]}
            count={counts[s]}
            active={status === s}
          />
        ))}
      </nav>

      {/* ── The plans ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        {plans.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
            <ClipboardCheck className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-zinc-400">
              {status
                ? `No plan's newest revision is ${QCP_STATUS_LABELS[status].toLowerCase()}.`
                : 'No quality control plans yet.'}
            </p>
            <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-zinc-500">
              Creating a plan writes the plan and revision 1 together, through
              nx_qcp_create. Opening this page wrote nothing.
            </p>
            {!status && (
              <Link
                href="/admin/compliance/qcp/new"
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-100 hover:bg-white/[0.08]"
              >
                <PlusCircle className="h-3.5 w-3.5" strokeWidth={2} />
                New plan
              </Link>
            )}
          </div>
        ) : (
          plans.map((p) => <PlanCard key={p.id} plan={p} />)
        )}
      </section>

      <p className="text-[11px] leading-relaxed text-zinc-600">
        Source: <span className="font-mono">public.quality_control_plans</span> and{' '}
        <span className="font-mono">public.qcp_revisions</span>, read-only. The
        frozen contract defines no list RPC, so this page SELECTs the two tables
        — which grant SELECT to authenticated and no write grant at all — and
        every mutation on the detail page goes through a canonical function.
      </p>
    </div>
  );
}

function PlanCard({ plan: p }: { plan: QcpListItem }) {
  return (
    <article className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              {p.title || 'Untitled plan'}
            </h2>
            {p.latestStatus && (
              <QcpStatusBadge status={p.latestStatus} revisionNo={p.latestRevisionNo} />
            )}
            {p.effectiveRevisionNo !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-0.5 text-[11px] text-violet-300 ring-1 ring-inset ring-violet-500/20">
                <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
                Rev {p.effectiveRevisionNo} effective
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-zinc-600">
            Created {formatQcpDateTime(p.createdAt)}
          </p>
        </div>
        <Link
          href={`/admin/compliance/qcp/${p.id}`}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/[0.06] hover:text-white"
        >
          Open
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Meta
          icon={<FolderKanban className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Project"
          value={p.projectName ?? `project ${p.projectId.slice(0, 8)}`}
        />
        <Meta
          icon={<Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Organization"
          value={p.organizationName ?? `org ${p.organizationId.slice(0, 8)}`}
        />
        <Meta
          icon={<Factory className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Supplier"
          value={p.supplierId ? `supplier ${p.supplierId.slice(0, 8)}` : 'None named'}
        />
        <Meta
          icon={<GitBranch className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Revisions"
          value={`${p.revisionCount} (append-preserved)`}
        />
      </div>
    </article>
  );
}

function FilterLink({
  href, label, count, active,
}: {
  href: string; label: string; count: number; active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
        active
          ? 'bg-white/[0.08] text-white ring-1 ring-inset ring-white/[0.12]'
          : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
      }`}
    >
      {label}
      <span className="ml-0.5 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
        {count}
      </span>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function Meta({
  icon, label, value,
}: {
  icon: React.ReactNode; label: string; value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        <span className="text-zinc-400">{icon}</span>
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
