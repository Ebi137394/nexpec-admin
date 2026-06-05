'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/invoices/ReassignInvoiceDepartmentDialog.tsx
//
//  Modal for reassigning an invoice's department attribution post-issuance.
//  Mounted from both /admin/invoices/[id] and /client/invoices/[id]. Auth
//  is enforced server-side by reassign_invoice_department (super_admin OR
//  owner/procurement_admin); the caller is responsible for showing the
//  trigger button only when allowed, to avoid dead-clicks.
//
//  Contract:
//    · `orgPicker` carries the destination org's department list + the
//      caller's manage capability flag.
//    · `currentDepartmentId` pre-selects the existing attribution.
//    · `reason` is mandatory — both the RPC and this dialog enforce it.
//
//  Visual: matches the in-flight aesthetics from StructureDialogs.tsx —
//  rounded-2xl panel, ink-900 backdrop, violet primary actions, rose for
//  destructive notes. The dialog never throws; errors render inline.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  AlertTriangle,
  FolderTree,
  CheckCircle2,
} from 'lucide-react';

import type { OrgPickerContext } from '@/lib/data/orgStructure.types';
import { reassignInvoiceDepartmentAction } from '@/lib/actions/orgStructure';
import { DepartmentPickerField } from '@/components/orgs/DepartmentPickerField';
import { cn } from '@/lib/cn';

interface Props {
  invoiceId: string;
  invoiceNumber: string;
  orgPicker: OrgPickerContext;
  /** Current department id on the invoice. Null = currently unattributed. */
  currentDepartmentId: string | null;
  /** Current cost-center snapshot — shown for context, not editable here. */
  currentCostCenter: string | null;
  open: boolean;
  onClose: () => void;
}

export function ReassignInvoiceDepartmentDialog({
  invoiceId,
  invoiceNumber,
  orgPicker,
  currentDepartmentId,
  currentCostCenter,
  open,
  onClose,
}: Props) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(
    currentDepartmentId,
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  // Reset form state every time the dialog opens.
  useEffect(() => {
    if (open) {
      setReason('');
      setPickedId(currentDepartmentId);
      setError(null);
      setDone(false);
      // Focus the reason field; the picker is fine left at its default.
      setTimeout(() => reasonRef.current?.focus(), 50);
    }
  }, [open, currentDepartmentId]);

  // Close on Esc + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const trimmedReason = reason.trim();
  const reasonInvalid = trimmedReason.length === 0;
  const submitDisabled =
    isPending || reasonInvalid || pickedId === currentDepartmentId;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await reassignInvoiceDepartmentAction({
        invoiceId,
        newDepartmentId: pickedId, // null is allowed = clear attribution
        reason: trimmedReason,
        orgId: orgPicker.orgId || null,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not reassign, try again.');
        return;
      }
      setDone(true);
      // Refresh the parent server component so the new dept name shows
      // through immediately.
      router.refresh();
      // Auto-close shortly after the success state animates in.
      setTimeout(onClose, 800);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Reassign invoice department"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/95 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
              Cost-center attribution
            </p>
            <h3 className="mt-1 truncate font-display text-base font-semibold text-white">
              Reassign, {invoiceNumber}
            </h3>
            <p className="mt-1 truncate text-xs text-zinc-400">
              {orgPicker.orgName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
          {/* Current state context */}
          <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
              <FolderTree className="h-3.5 w-3.5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                Current attribution
              </p>
              <p className="mt-0.5 truncate text-xs text-zinc-200">
                {currentDepartmentId
                  ? departmentLabel(orgPicker, currentDepartmentId) ?? '—'
                  : 'Unattributed'}
              </p>
              {currentCostCenter && (
                <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">
                  CC, {currentCostCenter}
                </p>
              )}
            </div>
          </div>

          {/* New attribution picker */}
          <DepartmentPickerField
            name="newDepartmentId"
            label="Reassign to"
            departments={orgPicker.departments}
            defaultDepartmentId={currentDepartmentId}
            orgName={orgPicker.orgName}
            unattributedMode="allow"
            unattributedLabel="Clear attribution (Unattributed)"
            hint="The cost-center snapshot on the invoice will refresh to match the new department."
            onValueChange={setPickedId}
            disabled={isPending || done}
          />

          {/* Reason — required */}
          <div>
            <label
              htmlFor="reassign-reason"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Reason <span className="text-violet-glow">*</span>
            </label>
            <textarea
              id="reassign-reason"
              ref={reasonRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              required
              placeholder="e.g. Mis-tagged at post time; this work belongs to North-East Region."
              disabled={isPending || done}
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30 disabled:opacity-50"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Audit-stamped. Visible in the org structure&apos;s Recent
              activity panel.
            </p>
          </div>

          {/* Error / success */}
          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <AlertTriangle
                className="h-3.5 w-3.5 shrink-0"
                strokeWidth={1.75}
              />
              <span>{error}</span>
            </p>
          )}
          {done && (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              <CheckCircle2
                className="h-3.5 w-3.5 shrink-0"
                strokeWidth={1.75}
              />
              Reassigned. Refreshing…
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-300 transition-colors hover:bg-white/[0.04] hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className={cn(
                'inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-industrial transition-colors',
                'bg-violet/25 text-violet-glow ring-1 ring-inset ring-violet/40 hover:bg-violet/35',
                'disabled:opacity-50 disabled:hover:bg-violet/25',
              )}
            >
              {isPending ? 'Saving…' : done ? 'Done' : 'Reassign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function departmentLabel(
  ctx: OrgPickerContext,
  id: string | null,
): string | null {
  if (!id) return null;
  const dept = ctx.departments.find((d) => d.id === id);
  if (!dept) return null;
  return dept.cost_center
    ? `${dept.name}, ${dept.cost_center}`
    : dept.name;
}
