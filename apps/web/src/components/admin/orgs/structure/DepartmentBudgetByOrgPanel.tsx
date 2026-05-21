// ════════════════════════════════════════════════════════════════════════════
//  components/admin/orgs/structure/DepartmentBudgetByOrgPanel.tsx
//
//  Full-width "By department" panel for the Budget Overview pages
//  (/admin/budget and /client/budget). Renders the flat list of
//  DepartmentSpendRow entries from fetch_department_budget_rollup() as a
//  depth-indented tree-table:
//
//    Department                Committed     Paid     Invoices  Last
//    ────────────────────────  ──────────  ───────    ────────  ─────
//    ▸ Operations              $1.2M         $980K       42      3d ago
//      ▸ North-East             $420K         $390K       18      6d ago
//        Refineries              $200K         $200K        9      8d ago
//    …
//    Unattributed              $42K          $0           5     12d ago
//
//  Server component — receives the pre-fetched rollup (the page does the
//  RPC call, this just renders). The Unattributed row is always pinned at
//  the bottom with a dotted border for visual emphasis.
//
//  No interactivity beyond a window-selector that re-navigates via a
//  client-side button row. The page reloads with the new ?window= param.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  Folder,
  FolderOpen,
  Hash,
  HelpCircle,
  Receipt,
} from 'lucide-react';

import {
  type DepartmentBudgetRollup,
  type DepartmentSpendRow,
  type SpendWindow,
  SPEND_WINDOW_LABELS,
} from '@/lib/data/orgStructure.budget.types';
import { cn } from '@/lib/cn';

interface Props {
  orgId: string;
  orgName: string;
  rollup: DepartmentBudgetRollup;
  /** Currently-selected window. Used by the selector to highlight the active tab. */
  activeWindow: SpendWindow;
  /** Base path for the window-selector links, e.g. '/admin/budget' or '/client/budget'. */
  basePath: string;
  /**
   * Optional CTA target for "drill into a department" — usually the org's
   * structure page. Clicking a row navigates there with the dept id in the
   * hash (the structure workspace can read it via window.location.hash).
   */
  structureHref?: string;
}

export function DepartmentBudgetByOrgPanel({
  orgId,
  orgName,
  rollup,
  activeWindow,
  basePath,
  structureHref,
}: Props) {
  if (rollup.invoicesMissing) {
    return (
      <FoldedShell title="By department" orgName={orgName}>
        <p className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-6 text-center text-xs text-zinc-500">
          The financial suite isn&apos;t installed in this environment, so
          per-department roll-ups aren&apos;t available yet.
        </p>
      </FoldedShell>
    );
  }

  // Departments only — synthetic row is rendered separately at the bottom.
  const realRows = rollup.rows.filter((r) => r.department_id !== null);
  const unattributed = rollup.rows.filter((r) => r.department_id === null);

  if (realRows.length === 0 && unattributed.length === 0) {
    return (
      <FoldedShell title="By department" orgName={orgName}>
        <p className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-6 text-center text-xs text-zinc-500">
          No departments or attributed invoices yet for this organization.
          {structureHref && (
            <>
              {' '}
              <Link
                href={structureHref}
                className="text-violet-glow hover:text-white"
              >
                Build your org chart →
              </Link>
            </>
          )}
        </p>
      </FoldedShell>
    );
  }

  // Sort real rows by depth (already from RPC) then alphabetical so the
  // visual tree reads top-to-bottom.
  const sortedReal = [...realRows].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.name.localeCompare(b.name);
  });

  return (
    <FoldedShell
      title="By department"
      orgName={orgName}
      headerRight={
        <WindowSelector activeWindow={activeWindow} basePath={basePath} />
      }
      subtitle={
        rollup.mixedCurrencies
          ? `Predominant currency: ${rollup.predominantCurrency} · other currencies are summed in their own rows`
          : `Currency: ${rollup.predominantCurrency}`
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead>
            <tr className="border-b border-white/[0.06] text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              <th className="py-2 pl-2 pr-3 text-left">Department</th>
              <th className="py-2 px-3 text-right">Committed</th>
              <th className="py-2 px-3 text-right">Paid</th>
              <th className="py-2 px-3 text-right">Invoices</th>
              <th className="py-2 px-3 text-right">Last</th>
            </tr>
          </thead>
          <tbody>
            {sortedReal.map((row) => (
              <Row
                key={`${row.department_id}-${row.currency}`}
                row={row}
                structureHref={structureHref}
              />
            ))}
            {unattributed.map((row) => (
              <UnattributedRow
                key={`unattributed-${row.currency}`}
                row={row}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        <HelpCircle className="h-3 w-3" strokeWidth={1.75} />
        Roll-up columns include every descendant&apos;s spend. Hover a row
        to see the direct (own-only) amount.
      </p>
    </FoldedShell>
  );
}

/* ─── header shell ───────────────────────────────────────────────────── */

function FoldedShell({
  title,
  orgName,
  subtitle,
  headerRight,
  children,
}: {
  title: string;
  orgName: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            {orgName}
          </p>
          <h2 className="mt-1 font-display text-base font-semibold tracking-tight text-white">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-[11px] text-zinc-500">{subtitle}</p>
          )}
        </div>
        {headerRight}
      </header>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ─── window selector ────────────────────────────────────────────────── */

function WindowSelector({
  activeWindow,
  basePath,
}: {
  activeWindow: SpendWindow;
  basePath: string;
}) {
  const windows: SpendWindow[] = ['mtd', 'qtd', 'ytd', 'l90', 'l365', 'all_time'];
  return (
    <div className="flex flex-wrap gap-1">
      {windows.map((w) => {
        const active = w === activeWindow;
        return (
          <Link
            key={w}
            href={`${basePath}?window=${w}`}
            scroll={false}
            className={cn(
              'rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-industrial transition-colors',
              active
                ? 'bg-violet/20 text-violet-glow ring-1 ring-inset ring-violet/40'
                : 'border border-white/[0.06] text-zinc-400 hover:border-violet/30 hover:text-violet-glow',
            )}
          >
            {SPEND_WINDOW_LABELS[w]}
          </Link>
        );
      })}
    </div>
  );
}

/* ─── rows ───────────────────────────────────────────────────────────── */

function Row({
  row,
  structureHref,
}: {
  row: DepartmentSpendRow;
  structureHref?: string;
}) {
  const depthIndent = Math.max(0, row.depth) * 16;
  const Icon = row.depth === 0 ? FolderOpen : Folder;
  const iconTone = row.depth === 0 ? 'text-violet-glow' : 'text-zinc-500';

  const rollupTitle = `Direct: ${formatMoney(row.direct_committed_cents, row.currency)} · ${row.direct_invoice_count} invoice${row.direct_invoice_count === 1 ? '' : 's'}`;

  const NameCell = (
    <span className="inline-flex min-w-0 items-center gap-2" style={{ paddingLeft: depthIndent }}>
      <Icon className={cn('h-3.5 w-3.5 shrink-0', iconTone)} strokeWidth={1.75} />
      <span className="truncate text-zinc-200">{row.name}</span>
      {row.cost_center && (
        <span className="inline-flex items-center gap-0.5 rounded border border-white/[0.08] bg-white/[0.03] px-1 py-px font-mono text-[9px] text-zinc-400">
          <Hash className="h-2.5 w-2.5" strokeWidth={2} />
          {row.cost_center}
        </span>
      )}
    </span>
  );

  return (
    <tr
      className="border-b border-white/[0.03] transition-colors hover:bg-white/[0.02]"
      title={rollupTitle}
    >
      <td className="py-2 pl-2 pr-3">
        {structureHref && row.department_id ? (
          <Link
            href={`${structureHref}#dept-${row.department_id}`}
            className="block hover:text-white"
          >
            {NameCell}
          </Link>
        ) : (
          NameCell
        )}
      </td>
      <td className="py-2 px-3 text-right font-mono">
        <span className="text-white">
          {formatMoney(row.rollup_committed_cents, row.currency)}
        </span>
      </td>
      <td className="py-2 px-3 text-right font-mono text-zinc-300">
        {formatMoney(row.rollup_paid_cents, row.currency)}
      </td>
      <td className="py-2 px-3 text-right font-mono text-zinc-400">
        {row.rollup_invoice_count}
      </td>
      <td className="py-2 px-3 text-right font-mono text-[10px] text-zinc-500">
        {row.last_invoice_at ? formatRelative(row.last_invoice_at) : '—'}
      </td>
    </tr>
  );
}

function UnattributedRow({ row }: { row: DepartmentSpendRow }) {
  return (
    <tr className="border-t-2 border-dashed border-amber-400/20 bg-amber-400/[0.02]">
      <td className="py-2 pl-2 pr-3">
        <span className="inline-flex items-center gap-2">
          <Receipt className="h-3.5 w-3.5 text-amber-400/70" strokeWidth={1.75} />
          <span className="text-amber-100/90">Unattributed</span>
          <span className="rounded border border-amber-400/30 bg-amber-400/[0.06] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-amber-200">
            no dept
          </span>
        </span>
      </td>
      <td className="py-2 px-3 text-right font-mono text-amber-100/90">
        {formatMoney(row.rollup_committed_cents, row.currency)}
      </td>
      <td className="py-2 px-3 text-right font-mono text-amber-100/80">
        {formatMoney(row.rollup_paid_cents, row.currency)}
      </td>
      <td className="py-2 px-3 text-right font-mono text-amber-100/70">
        {row.rollup_invoice_count}
      </td>
      <td className="py-2 px-3 text-right font-mono text-[10px] text-amber-200/60">
        {row.last_invoice_at ? formatRelative(row.last_invoice_at) : '—'}
      </td>
    </tr>
  );
}

/* ─── formatters ─────────────────────────────────────────────────────── */

function formatMoney(cents: number, currency: string): string {
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    });
    return formatter.format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toLocaleString()}`;
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.round(diffSec / 86400)}d ago`;
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
