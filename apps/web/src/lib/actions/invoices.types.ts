// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/invoices.types.ts — non-server companion for invoice actions
//
//  Per Next.js 15 strict `'use server'` rule: only async exports are
//  permitted in server-action files. Form state shapes + initial-state
//  constants live here so the sibling lib/actions/invoices.ts stays
//  async-only.
// ════════════════════════════════════════════════════════════════════════════

export interface InvoiceActionState {
  ok: boolean;
  error: string | null;
  message?: string;
}

export const invoiceActionInitialState: InvoiceActionState = {
  ok: false,
  error: null,
};
