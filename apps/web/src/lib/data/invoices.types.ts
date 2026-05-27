// ════════════════════════════════════════════════════════════════════════════
//  lib/data/invoices.types.ts — Invoice Approver shapes
//
//  Reads the public.invoices table (created in
//  20260521120000_financial_suite_foundation.sql). Every invoice auto-
//  issues when a job_contract transitions to fully_executed.
//
//  State machine:
//    pending_review → approved   (client marks reviewed)
//                   ↘ disputed   (client raises an issue)
//    approved       → paid       (admin records payment cleared)
//                   ↘ voided     (admin voids; only pre-paid)
//    disputed       → approved | voided  (admin adjudicates)
//
//  GR2 discipline: client-visible projections never include
//  inspector_amount_cents. Inspector-visible projections never include
//  client_amount_cents. Admin sees both.
// ════════════════════════════════════════════════════════════════════════════

export type InvoiceStatus =
  | 'pending_review'
  | 'approved'
  | 'disputed'
  | 'paid'
  | 'voided';

export interface InvoiceLineItem {
  kind: string;
  description: string;
  amount_cents: number;
  contract_id?: string;
}

// Client-side projection. Hides inspector_amount_cents per GR2.
export interface InvoiceClientView {
  id: string;
  invoiceNumber: string;
  jobId: string;
  jobTitle: string | null;
  contractId: string | null;
  clientAmountCents: number;
  platformFeeCents: number;
  totalCents: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string;
  dueDate: string | null;
  approvedAt: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
  paidAt: string | null;
  notes: string | null;
  lineItems: InvoiceLineItem[];
  inspectorName: string | null;
  // ── Sprint 14: cost-center attribution ──────────────────────────────
  /** Department attribution. Null = "Unattributed" in the by-dept rollup. */
  departmentId: string | null;
  /** Department name at fetch time. Hydrated by joining `departments`. */
  departmentName: string | null;
  /** Cost-center snapshot frozen at attribution; independent of renames. */
  costCenterSnapshot: string | null;
}

// Admin-side projection. Includes both money columns.
export interface InvoiceAdminView extends InvoiceClientView {
  inspectorAmountCents: number;
  clientId: string;
  clientName: string;
  inspectorId: string | null;
  approvedBy: string | null;
  disputedBy: string | null;
  paidReference: string | null;
  voidedAt: string | null;
  voidedBy: string | null;
  voidedReason: string | null;
}

export interface InvoiceCounts {
  total: number;
  pendingReview: number;
  approved: number;
  disputed: number;
  paid: number;
  voided: number;
  outstandingCents: number; // sum of pending_review + approved (not yet paid)
}

export const EMPTY_INVOICE_COUNTS: InvoiceCounts = {
  total: 0,
  pendingReview: 0,
  approved: 0,
  disputed: 0,
  paid: 0,
  voided: 0,
  outstandingCents: 0,
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  disputed: 'Disputed',
  paid: 'Paid',
  voided: 'Voided',
};
