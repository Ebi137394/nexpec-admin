'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/invoices/InvoiceDepartmentBlock.tsx
//
//  The "Department" block rendered on both invoice detail surfaces
//  (admin + client). Read-only display of the current attribution + an
//  optional Reassign button that opens ReassignInvoiceDepartmentDialog.
//
//  This is the only client-component the server pages mount for the
//  feature — keeps the page-level server components static and focused
//  on data fetching.
//
//  Auth: the parent passes `orgPicker.canManageStructure`; we show the
//  Reassign button only when it's true. The RPC enforces auth again, but
//  hiding the button when it would always fail keeps the UI honest.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { FolderTree, Hash, Pencil, Building2 } from 'lucide-react';

import type { OrgPickerContext } from '@/lib/data/orgStructure.types';
import { ReassignInvoiceDepartmentDialog } from './ReassignInvoiceDepartmentDialog';
import { cn } from '@/lib/cn';

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  /**
   * Current department id on the invoice. Null = unattributed (rolls up
   * under the synthetic "Unattributed" bucket in the budget view).
   */
  departmentId: string | null;
  /** Hydrated department name (server-side join), if attributed. */
  departmentName: string | null;
  /** Cost-center snapshot frozen at attribution. */
  costCenterSnapshot: string | null;
  /**
   * Picker context for the destination org. When `orgId === ''` (the
   * EMPTY_ORG_PICKER_CONTEXT default) we render the read-only block
   * with no Reassign button — there's no org to reassign within.
   */
  orgPicker: OrgPickerContext;
}

export function InvoiceDepartmentBlock({
  invoiceId,
  invoiceNumber,
  departmentId,
  departmentName,
  costCenterSnapshot,
  orgPicker,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Show Reassign only if (a) we resolved an org context and (b) the
  // viewer has permission to manage that org's structure.
  const canReassign =
    orgPicker.orgId.length > 0 && orgPicker.canManageStructure;

  const attributed = departmentId !== null;

  return (
    <>
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight text-white">
            <FolderTree
              className="h-4 w-4 text-violet-glow"
              strokeWidth={1.75}
            />
            Department
          </h2>
          {canReassign && (
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold uppercase tracking-industrial transition-colors',
                'bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30 hover:bg-violet/25',
              )}
            >
              <Pencil className="h-3 w-3" strokeWidth={2} />
              Reassign
            </button>
          )}
        </header>

        <p className="mt-1 text-xs text-zinc-500">
          Cost-center attribution drives the by-department budget roll-up.
          {attributed
            ? ' Snapshots freeze the cost-center text at attribution time, so renames don’t rewrite history.'
            : ' This invoice is currently unattributed, it rolls up under the synthetic Unattributed bucket.'}
        </p>

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Current department tile */}
          <div
            className={cn(
              'rounded-2xl border p-4',
              attributed
                ? 'border-violet/25 bg-violet/[0.04]'
                : 'border-dashed border-amber-400/25 bg-amber-400/[0.04]',
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Charged to
            </p>
            <p
              className={cn(
                'mt-1.5 truncate font-display text-base font-semibold',
                attributed ? 'text-white' : 'text-amber-100',
              )}
            >
              {attributed
                ? departmentName ?? 'Unknown department'
                : 'Unattributed'}
            </p>
            {orgPicker.orgName && (
              <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-zinc-500">
                <Building2 className="h-3 w-3" strokeWidth={1.75} />
                {orgPicker.orgName}
              </p>
            )}
          </div>

          {/* Cost-center snapshot tile */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Cost-center snapshot
            </p>
            {costCenterSnapshot ? (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded border border-white/[0.08] bg-white/[0.03] px-2 py-1 font-mono text-sm text-zinc-200">
                <Hash className="h-3 w-3" strokeWidth={2} />
                {costCenterSnapshot}
              </p>
            ) : (
              <p className="mt-1.5 text-sm text-zinc-500">—</p>
            )}
            <p className="mt-2 text-[11px] text-zinc-500">
              {costCenterSnapshot
                ? 'Captured at the moment of attribution.'
                : 'No cost-center value to snapshot yet.'}
            </p>
          </div>
        </div>

        {!canReassign && orgPicker.orgId.length > 0 && (
          <p className="mt-4 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-zinc-500">
            Reassignment is reserved for org{' '}
            <span className="font-mono text-zinc-300">owner</span> /
            <span className="font-mono text-zinc-300"> procurement_admin</span>{' '}
            and platform admins.
          </p>
        )}
      </section>

      {canReassign && (
        <ReassignInvoiceDepartmentDialog
          invoiceId={invoiceId}
          invoiceNumber={invoiceNumber}
          orgPicker={orgPicker}
          currentDepartmentId={departmentId}
          currentCostCenter={costCenterSnapshot}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}
