// ════════════════════════════════════════════════════════════════════════════
//  app/client/budget/page.tsx — Budget Overview · M1 Financial Suite
//
//  Live spend tracker for the buyer side (client / agency / enterprise) and
//  the platform side (admin). Visibility scope is automatic — every RPC
//  enforces fin_visible_client_ids() at the DB level, so this page just
//  renders what comes back. No client-side authorisation logic.
//
//  Sections (top → bottom):
//    1. Header with scope chip (Your spend / Your organisation / Platform-wide)
//    2. Hero metric strip — Committed / In payment hold / Paid out / Awaiting payout
//    3. Activity rollup — Active / Completed / Disputed / Avg job size
//    4. 12-month spend trend — pure CSS bar chart (no recharts dep)
//    5. Top inspectors by spend — table (current YTD)
//    6. Recent activity stream — last 25 jobs with status pills
//
//  Design tokens match the existing /client/finance page exactly:
//    text-violet-glow · text-cyan-glow · font-display · bg-ink-800 · border-white/[0.06]
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  TrendingUp,
  Wallet,
  CheckCircle2,
  Hourglass,
  Briefcase,
  AlertTriangle,
  Activity,
  ChevronRight,
  Calendar,
  Users,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import {
  budgetRelativeTime,
  fetchBudgetOverview,
  fetchBudgetScopeMeta,
  formatBudgetCents,
} from '@/lib/data/budget';
import type {
  BudgetActivityRow,
  BudgetInspectorTotal,
  BudgetMonthlyPoint,
  BudgetScopeMeta,
} from '@/lib/data/budget.types';
import {
  fetchDepartmentBudgetRollup,
  fetchMyOrgMemberships,
  resolveActiveOrgId,
} from '@/lib/data/orgStructure';
import type { SpendWindow } from '@/lib/data/orgStructure.budget.types';
import { DepartmentBudgetByOrgPanel } from '@/components/admin/orgs/structure/DepartmentBudgetByOrgPanel';
import { CurrencySelector } from '@/components/orgs/CurrencySelector';
import {
  isElevatedOrgRole,
  isSupportedCurrency,
} from '@nexpec/shared-core';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { nxHandle } from '@/lib/identity/inspectorHandle';

export const metadata: Metadata = {
  title: 'Budget Overview',
  description:
    'Live spend tracker, committed budget, payment holds, paid-out amounts, and a 12-month trend.',
};

export const dynamic = 'force-dynamic';

// Sprint 6: ELEVATED_ORG_ROLES is no longer used here — election logic
// moved to resolveActiveOrgId() in lib/data/orgStructure.ts.
const VALID_WINDOWS: ReadonlySet<SpendWindow> = new Set([
  'all_time',
  'mtd',
  'qtd',
  'ytd',
  'l90',
  'l365',
]);

interface BudgetPageProps {
  searchParams?: Promise<{ window?: string; display?: string }>;
}

/**
 * Surface mode — controls the route prefix used by the by-department panel
 * for both window-selector links and the "drill into structure" CTA.
 *
 * 'client' → /client/budget · /client/structure
 * 'admin'  → /admin/budget  · /admin/orgs/{org_id}/structure
 *
 * The existing platform/role-scoped budget aggregates are mode-agnostic;
 * only the by-department add-on cares about which portal we're inside.
 */
type BudgetSurfaceMode = 'client' | 'admin';

/**
 * Pick the org whose department roll-up we should display alongside the
 * platform/role budget. Sprint 6: defers to resolveActiveOrgId() so a
 * user who switches workspaces via the OrgSwitcher immediately sees the
 * new org's department roll-up here.
 */
async function resolveActiveOrgForBudget(): Promise<{
  orgId: string;
  orgName: string;
} | null> {
  const activeId = await resolveActiveOrgId();
  if (!activeId) return null;
  const memberships = await fetchMyOrgMemberships();
  const hit = memberships.find((m) => m.org_id === activeId);
  if (!hit) return null;
  return { orgId: hit.org_id, orgName: hit.org_name };
}

/**
 * The shared inner view. Called by both /client/budget and /admin/budget,
 * each passing its own `mode`. Exported so /admin/budget/page.tsx can
 * delegate to it without code duplication.
 */
export async function BudgetOverviewView(
  props: BudgetPageProps & { mode: BudgetSurfaceMode },
) {
  const mode = props.mode;
  // Window param for the per-department panel — kept entirely local, has
  // no effect on the existing platform/role-scoped budget aggregates.
  const sp = (await props.searchParams) ?? {};
  const rawWindow = (sp.window ?? 'all_time') as SpendWindow;
  const activeWindow: SpendWindow = VALID_WINDOWS.has(rawWindow)
    ? rawWindow
    : 'all_time';

  const activeOrg = await resolveActiveOrgForBudget();

  // Sprint 7 — resolve display currency. URL ?display= wins if it's a
  // supported code; otherwise fall back to the org's persisted default
  // (which the RPC also resolves server-side — we read it here for the
  // CurrencySelector's "default" label and the persist-button gate).
  const requestedDisplay = isSupportedCurrency(sp.display) ? sp.display : null;
  let orgBaseCurrency: string = 'USD';
  let viewerCanPersistDefault = false;
  if (activeOrg) {
    const supabase = await createSupabaseServerClient();
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('base_currency')
      .eq('id', activeOrg.orgId)
      .maybeSingle();
    orgBaseCurrency = String(orgRow?.base_currency ?? 'USD');

    // Permission check for the persist button: Platform Owner OR
    // elevated org role on this org.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      const isPlatformOwner =
        ['super_admin', 'admin'].includes((profile?.role ?? '').toString().trim().toLowerCase());
      if (isPlatformOwner) {
        viewerCanPersistDefault = true;
      } else {
        const { data: mem } = await supabase
          .from('org_members')
          .select('role')
          .eq('org_id', activeOrg.orgId)
          .eq('user_id', user.id)
          .maybeSingle();
        viewerCanPersistDefault = isElevatedOrgRole(
          (mem?.role as string | null) ?? null,
        );
      }
    }
  }
  const activeDisplayCurrency = requestedDisplay ?? orgBaseCurrency;

  const [data, scopeMeta, rollup] = await Promise.all([
    fetchBudgetOverview(),
    fetchBudgetScopeMeta(),
    activeOrg
      ? fetchDepartmentBudgetRollup(
          activeOrg.orgId,
          activeWindow,
          activeDisplayCurrency,
        )
      : Promise.resolve(null),
  ]);

  const { summary, monthly, byInspector, recent } = data;

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header>
        <Link
          href="/client/finance"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Finance
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              {(scopeMeta.roleLabel || 'Client')} Portal, Finance
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Budget Overview
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
              Live spend tracker, what&rsquo;s committed, what&rsquo;s
              waiting on payment hold, what&rsquo;s already paid out. Reads run
              under your account&rsquo;s visibility rules: clients see
              their own jobs, agencies and enterprises see their
              organisation&rsquo;s rollup, admins see platform-wide.
            </p>
          </div>
          <ScopeChip meta={scopeMeta} />
        </div>
      </header>

      {/* ── Hero metrics ───────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HeroTile
          icon={<TrendingUp className="h-4 w-4" strokeWidth={1.75} />}
          label="Committed"
          value={formatBudgetCents(summary.committedCents)}
          sub={`${summary.totalJobs} job${summary.totalJobs === 1 ? '' : 's'} all-time`}
          tone="violet"
        />
        <HeroTile
          icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
          label="On hold"
          value={formatBudgetCents(summary.inEscrowCents)}
          sub="Funded, awaiting completion"
          tone="cyan"
        />
        <HeroTile
          icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />}
          label="Paid out"
          value={formatBudgetCents(summary.paidOutCents)}
          sub="Released, settled with inspector"
          tone="green"
        />
        <HeroTile
          icon={<Hourglass className="h-4 w-4" strokeWidth={1.75} />}
          label="Awaiting payout"
          value={formatBudgetCents(summary.awaitingPayoutCents)}
          sub="Completed, pending release"
          tone="amber"
        />
      </section>

      {/* ── Activity rollup ────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <RollupTile
          icon={<Activity className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Active"
          value={String(summary.activeJobs)}
          tone="violet"
        />
        <RollupTile
          icon={<CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Completed"
          value={String(summary.completedJobs)}
          tone="green"
        />
        <RollupTile
          icon={<AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Disputed"
          value={String(summary.disputedJobs)}
          tone={summary.disputedJobs > 0 ? 'red' : 'default'}
        />
        <RollupTile
          icon={<Briefcase className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Avg job size"
          value={formatBudgetCents(summary.avgJobCents)}
          tone="default"
        />
      </section>

      {/* ── 12-month trend ─────────────────────────────────────────── */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-white">
              <Calendar className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
              12-month spend trend
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Committed amount per month, oldest to most recent. Months with no
              activity show as empty bars.
            </p>
          </div>
        </header>
        <MonthlyChart points={monthly} />
      </section>

      {/* ── Top inspectors ─────────────────────────────────────────── */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-white">
              <Users className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
              Top inspectors by spend (YTD)
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Calendar-year totals for hired inspectors. Cancelled jobs are
              excluded.
            </p>
          </div>
        </header>
        {/* ANTI-POACHING: get_budget_by_inspector / get_budget_recent_activity
            are SECURITY DEFINER and return COALESCE(full_name, email) with NO
            identity_mode gate, so a buyer was shown every hired inspector's
            real name (or email) here regardless of the project's disclosure
            policy. Buyers now get the pseudonymous NX- handle; the operator
            (platform scope = admin/super_admin) keeps the real names. */}
        <InspectorTable
          rows={byInspector}
          discloseNames={scopeMeta.scope === 'platform'}
        />
      </section>

      {/* ── By department (cost-center roll-up) ──────────────────────
          Same RPC source, two surfaces — basePath/structureHref vary
          so the window-selector and "drill into structure" CTA stay
          inside whichever portal the viewer is currently in.

          Sprint 7 — the CurrencySelector sits above the panel and
          drives the ?display= URL param that propagates through to
          the RPC. The default label reflects the org's persisted
          base_currency. */}
      {activeOrg && rollup && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <CurrencySelector
              activeCurrency={activeDisplayCurrency}
              defaultCurrency={orgBaseCurrency}
              orgId={activeOrg.orgId}
              orgName={activeOrg.orgName}
              canPersistDefault={viewerCanPersistDefault}
            />
          </div>
          <DepartmentBudgetByOrgPanel
            orgId={activeOrg.orgId}
            orgName={activeOrg.orgName}
            rollup={rollup}
            activeWindow={activeWindow}
            basePath={
              mode === 'admin' ? '/admin/budget' : '/client/budget'
            }
            structureHref={
              mode === 'admin'
                ? `/admin/orgs/${activeOrg.orgId}/structure`
                : '/client/structure'
            }
          />
        </div>
      )}

      {/* ── Recent activity ────────────────────────────────────────── */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-white">
              <Activity className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
              Recent activity
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Most recent 25 jobs across your scope.
            </p>
          </div>
          <Link
            href="/client/jobs"
            className="inline-flex items-center gap-1 text-xs font-semibold text-violet-glow hover:underline"
          >
            All jobs <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
          </Link>
        </header>
        <ActivityStream rows={recent} scope={scopeMeta} />
      </section>

      {/* ── Audit footnote ─────────────────────────────────────────── */}
      <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        Source,{' '}
        <span className="text-zinc-400">get_budget_summary</span>,{' '}
        <span className="text-zinc-400">get_budget_monthly</span>,{' '}
        <span className="text-zinc-400">get_budget_by_inspector</span>,{' '}
        <span className="text-zinc-400">get_budget_recent_activity</span>
        ,{' '}RLS-gated under{' '}
        <span className="text-zinc-400">fin_visible_client_ids()</span>.
      </p>
    </div>
  );
}

/**
 * Default export — the /client/budget page. Thin wrapper that delegates
 * to BudgetOverviewView with mode='client'. /admin/budget is its own page
 * that delegates the same way with mode='admin'.
 */
export default async function ClientBudgetPage(props: BudgetPageProps = {}) {
  return BudgetOverviewView({ ...props, mode: 'client' });
}

// ═════════════════════════════════════════════════════════════════════════
//  Subcomponents
// ═════════════════════════════════════════════════════════════════════════

function ScopeChip({ meta }: { meta: BudgetScopeMeta }) {
  const palette = {
    self: 'border-violet/30 bg-violet/10 text-violet-glow',
    org: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
    platform: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
    none: 'border-white/10 bg-white/[0.03] text-zinc-400',
  }[meta.scope];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-2 self-start rounded-full border px-3.5 py-2 text-xs font-semibold uppercase tracking-industrial ${palette} sm:self-end`}
    >
      {meta.scope === 'platform' ? (
        <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
      ) : (
        <Building2 className="h-3.5 w-3.5" strokeWidth={2} />
      )}
      Scope, {meta.scopeLabel}
    </span>
  );
}

function HeroTile({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: 'violet' | 'cyan' | 'green' | 'amber';
}) {
  const accentText = {
    violet: 'text-violet-glow',
    cyan: 'text-cyan-glow',
    green: 'text-accent-green',
    amber: 'text-accent-amber',
  }[tone];
  const accentBorder = {
    violet: 'border-violet/20',
    cyan: 'border-cyan-glow/20',
    green: 'border-accent-green/20',
    amber: 'border-accent-amber/20',
  }[tone];

  return (
    <div
      className={`rounded-2xl border bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5 backdrop-blur-xl ${accentBorder}`}
    >
      <div className={`flex items-center gap-2 ${accentText}`}>
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-industrial">
          {label}
        </p>
      </div>
      <p
        className={`mt-2 font-mono text-2xl font-semibold tracking-tight ${accentText}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>
    </div>
  );
}

function RollupTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: 'violet' | 'green' | 'red' | 'default';
}) {
  const accentText =
    tone === 'violet'
      ? 'text-violet-glow'
      : tone === 'green'
        ? 'text-accent-green'
        : tone === 'red'
          ? 'text-accent-red'
          : 'text-white';

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-center gap-1.5 text-zinc-500">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-industrial">
          {label}
        </p>
      </div>
      <p className={`mt-1.5 font-mono text-lg font-semibold ${accentText}`}>
        {value}
      </p>
    </div>
  );
}

function MonthlyChart({ points }: { points: BudgetMonthlyPoint[] }) {
  if (!points.length) {
    return (
      <p className="mt-6 text-center text-sm text-zinc-500">
        No activity in the last 12 months.
      </p>
    );
  }
  const max = points.reduce(
    (m, p) => Math.max(m, p.committedCents, p.completedCents),
    0,
  );
  return (
    <div className="mt-6">
      <div className="grid grid-cols-12 items-end gap-2 sm:gap-3">
        {points.map((p) => {
          const committedPct = max > 0 ? (p.committedCents / max) * 100 : 0;
          const completedPct = max > 0 ? (p.completedCents / max) * 100 : 0;
          return (
            <div key={p.monthStart} className="flex flex-col items-center gap-1.5">
              <div
                className="relative flex w-full flex-col items-stretch justify-end overflow-hidden rounded-md bg-white/[0.02]"
                style={{ height: 140 }}
                title={`${p.monthLabel}\nCommitted ${formatBudgetCents(p.committedCents)}\nCompleted ${formatBudgetCents(p.completedCents)}`}
              >
                {/* Committed (back layer, violet) */}
                <div
                  className="w-full bg-violet/50"
                  style={{ height: `${committedPct}%` }}
                />
                {/* Completed overlay (cyan, atop) */}
                <div
                  className="absolute bottom-0 w-full bg-cyan-glow/70"
                  style={{ height: `${completedPct}%` }}
                />
              </div>
              <p className="font-mono text-[9px] uppercase tracking-industrial text-zinc-500">
                {p.monthLabel.split(' ')[0]}
              </p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-zinc-500">
        <LegendDot label="Committed" cls="bg-violet/50" />
        <LegendDot label="Completed" cls="bg-cyan-glow/70" />
        <span className="ml-auto font-mono">
          12-month peak {formatBudgetCents(max)}
        </span>
      </div>
    </div>
  );
}

function LegendDot({ label, cls }: { label: string; cls: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-3 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}

function InspectorTable({
  rows,
  discloseNames,
}: {
  rows: BudgetInspectorTotal[];
  /** Only the platform operator (admin) may see real inspector names here. */
  discloseNames: boolean;
}) {
  if (!rows.length) {
    return (
      <p className="mt-6 text-center text-sm text-zinc-500">
        No inspector spend recorded this year.
      </p>
    );
  }
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-white/[0.04]">
      <table className="w-full">
        <thead className="bg-white/[0.02] text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          <tr>
            <th className="px-4 py-2.5 text-left">Inspector</th>
            <th className="px-4 py-2.5 text-right">Jobs</th>
            <th className="px-4 py-2.5 text-right">Total spend</th>
            <th className="hidden px-4 py-2.5 text-right sm:table-cell">Last hire</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04]">
          {rows.map((r) => (
            <tr key={r.inspectorId} className="hover:bg-white/[0.02]">
              <td className="px-4 py-3 text-sm">
                <Link
                  href={`/p/${r.inspectorId}`}
                  className={`font-medium text-white transition-colors hover:text-violet-glow ${discloseNames ? '' : 'font-mono'}`}
                >
                  {discloseNames ? r.inspectorName : nxHandle(r.inspectorId)}
                </Link>
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm text-zinc-300">
                {r.jobCount}
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-violet-glow">
                {formatBudgetCents(r.totalCents)}
              </td>
              <td className="hidden px-4 py-3 text-right text-xs text-zinc-500 sm:table-cell">
                {r.lastJobAt ? budgetRelativeTime(r.lastJobAt) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityStream({
  rows,
  scope,
}: {
  rows: BudgetActivityRow[];
  scope: BudgetScopeMeta;
}) {
  if (!rows.length) {
    return (
      <p className="mt-6 text-center text-sm text-zinc-500">
        No recent jobs to show.
      </p>
    );
  }
  const showClientCol = scope.scope === 'org' || scope.scope === 'platform';
  // Real inspector names are operator-only (see the gate below).
  const isOperator = scope.scope === 'platform';
  return (
    <ul className="mt-5 divide-y divide-white/[0.04]">
      {rows.map((r) => (
        <li
          key={r.jobId}
          className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
        >
          <Link
            href={`/client/jobs/${r.jobId}`}
            className="min-w-0 flex-1 truncate text-sm font-medium text-white transition-colors hover:text-violet-glow"
          >
            {r.jobTitle}
          </Link>
          <StatusPill status={r.status} />
          {showClientCol && (
            <span className="hidden truncate text-xs text-zinc-500 sm:inline-flex sm:items-center sm:gap-1">
              <Building2 className="h-3 w-3" strokeWidth={1.75} />
              {r.clientName}
            </span>
          )}
          {/* Same anti-poaching gate as the table above: the RPC hands back the
              inspector's real name with no identity_mode check, so any buyer —
              including an org-scoped agency/enterprise viewer — sees the
              pseudonymous NX- handle. Only the platform operator sees names. */}
          {r.inspectorId && (
            <span className="hidden truncate text-xs text-zinc-500 lg:inline">
              {isOperator && r.inspectorName
                ? r.inspectorName
                : nxHandle(r.inspectorId)}
            </span>
          )}
          <span className="font-mono text-xs font-semibold text-violet-glow">
            {formatBudgetCents(r.clientPriceCents)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
            {budgetRelativeTime(r.createdAt)}
          </span>
          <ChevronRight
            className="h-3.5 w-3.5 text-zinc-600"
            strokeWidth={2}
          />
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone = (() => {
    if (status === 'in_progress' || status === 'assigned') return 'cyan';
    if (status === 'completed') return 'green';
    if (status === 'disputed') return 'red';
    if (status === 'open') return 'violet';
    if (status === 'cancelled' || status === 'voided') return 'zinc';
    if (status === 'pending_approval' || status === 'pending_review') return 'amber';
    return 'zinc';
  })();
  const classes = {
    cyan: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
    violet: 'border-violet/30 bg-violet/10 text-violet-glow',
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    amber: 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
    red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    zinc: 'border-white/[0.06] bg-white/[0.04] text-zinc-400',
  }[tone];
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${classes}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
