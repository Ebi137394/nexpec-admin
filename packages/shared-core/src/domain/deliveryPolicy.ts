// ════════════════════════════════════════════════════════════════════════════
//  domain/deliveryPolicy.ts — delivery-policy presentation, shared by Web and
//  Mobile so the two surfaces structurally cannot drift.
//
//  Backs 20260801500000_delivery_policy_credit_release.sql. The 20/80 split is
//  fixed and is NOT modelled here — only whether the final tranche gates
//  delivery, and when its invoice falls due.
//
//  ── THE WORDING RULE THIS MODULE EXISTS TO ENFORCE ─────────────────────────
//  "Final delivery blocked" must be shown ONLY when an outstanding tranche
//  actually gates delivery. A valid post-delivery Net-15/30/60 invoice — even
//  an overdue one — must never produce that sentence, because the report has
//  already been released and is not being withheld. Getting this wrong tells a
//  paying client their report is hostage when it is not.
//
//  Every surface must call deliveryStatusCopy() rather than composing its own
//  sentence from the raw flags.
// ════════════════════════════════════════════════════════════════════════════

//  Money formatting is NOT redefined here. domain/money.ts already owns it and
//  handles null/non-finite input, which this module's callers rely on.
import { formatCents } from './money';

/** Mirrors client_delivery_policy.mode. */
export type DeliveryPolicyMode = 'STRICT_PREPAY' | 'CREDIT_RELEASE';

/** Mirrors nx_funding_invoice_status(). */
export type InvoiceStatus = 'open' | 'due_soon' | 'overdue' | 'paid' | 'waived';

/** The only Net terms the database accepts. Net-45 is deliberately absent. */
export const NET_TERM_DAYS = [15, 30, 60] as const;
export type NetTermDays = (typeof NET_TERM_DAYS)[number];

export interface DeliveryPolicyView {
  /** job_funding_stages.gates_delivery for the final tranche. */
  gatesDelivery: boolean;
  /** Outstanding balance in cents. Client-safe: this is what the CLIENT owes. */
  remainingCents: number;
  netTermDays: NetTermDays | null;
  /** ISO timestamp from job_funding_stages.invoice_due_at. */
  invoiceDueAt: string | null;
  invoiceStatus: InvoiceStatus | null;
}

export interface DeliveryStatusCopy {
  /** Machine-readable state, for styling and tests. */
  tone: 'blocked' | 'released' | 'settled';
  headline: string;
  detail: string | null;
}

const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  open: 'Open',
  due_soon: 'Due Soon',
  overdue: 'Overdue',
  paid: 'Paid',
  waived: 'Waived',
};

export function invoiceStatusLabel(status: InvoiceStatus): string {
  return INVOICE_STATUS_LABEL[status];
}

export function formatDueDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * The single source of delivery wording for every surface.
 *
 * Note what is deliberately absent: overdue does NOT change `tone` away from
 * 'released'. An overdue invoice is a collections matter, not a delivery
 * block — the report was already released and must stay accessible. Returning
 * 'blocked' here would be the exact defect this module exists to prevent.
 */
export function deliveryStatusCopy(view: DeliveryPolicyView): DeliveryStatusCopy {
  if (view.invoiceStatus === 'paid' || view.invoiceStatus === 'waived') {
    return {
      tone: 'settled',
      headline:
        view.invoiceStatus === 'paid'
          ? 'Final balance paid in full.'
          : 'Final balance waived by the platform.',
      detail: null,
    };
  }

  if (view.gatesDelivery) {
    return {
      tone: 'blocked',
      headline: 'Final delivery blocked until remaining funding is received.',
      detail: `Outstanding balance ${formatCents(view.remainingCents)}.`,
    };
  }

  const due = formatDueDate(view.invoiceDueAt);
  const term = view.netTermDays ? `Net-${view.netTermDays}` : 'approved credit terms';

  return {
    tone: 'released',
    headline: 'Final report released on approved credit terms.',
    detail:
      `Remaining ${formatCents(view.remainingCents)} due` +
      (due ? ` by ${due}` : ` on ${term}`) +
      (view.invoiceStatus === 'overdue'
        ? ' — this invoice is overdue. Your report remains available.'
        : '.'),
  };
}
