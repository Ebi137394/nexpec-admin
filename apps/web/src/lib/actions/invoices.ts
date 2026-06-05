// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/invoices.ts — Server Actions for invoice state transitions
//
//  Five actions covering the full state machine + admin overrides:
//    • approveInvoiceAction     (client) — pending_review → approved
//    • disputeInvoiceAction     (client) — pending_review|approved → disputed
//    • markInvoicePaidAction    (admin)  — approved → paid
//    • voidInvoiceAction        (admin)  — any non-paid → voided
//    • adminAdjudicateDispute   (admin)  — disputed → approved or voided
//
//  Every action validates input with Zod, checks auth via getUser, mutates
//  via supabase.from('invoices').update (RLS gates writes — see
//  invoices_write_admin_only policy), revalidates the relevant paths,
//  and returns ActionState for useActionState consumers.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { InvoiceActionState } from './invoices.types';

// ─── Auth helpers ─────────────────────────────────────────────────────
async function getAuthedUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

async function isAdmin(): Promise<boolean> {
  const { supabase, user } = await getAuthedUser();
  if (!user) return false;
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = (data as { role?: string | null } | null)?.role ?? '';
  return role === 'admin' || role === 'super_admin';
}

function revalidateInvoicePaths(invoiceId?: string) {
  revalidatePath('/client/invoices');
  revalidatePath('/admin/invoices');
  if (invoiceId) {
    revalidatePath(`/client/invoices/${invoiceId}`);
    revalidatePath(`/admin/invoices/${invoiceId}`);
  }
}

// ─── Schemas ──────────────────────────────────────────────────────────
const IdSchema = z.object({
  invoiceId: z.string().uuid({ message: 'Invalid invoice id.' }),
});

const DisputeSchema = IdSchema.extend({
  reason: z
    .string()
    .trim()
    .min(10, { message: 'Reason must be at least 10 characters.' })
    .max(1000, { message: 'Reason is capped at 1000 characters.' }),
});

const PaidSchema = IdSchema.extend({
  reference: z
    .string()
    .trim()
    .max(120, { message: 'Reference is capped at 120 characters.' })
    .optional()
    .or(z.literal('')),
});

const VoidSchema = IdSchema.extend({
  reason: z
    .string()
    .trim()
    .min(5, { message: 'Reason must be at least 5 characters.' })
    .max(500, { message: 'Reason is capped at 500 characters.' }),
});

const AdjudicateSchema = IdSchema.extend({
  decision: z.enum(['approve', 'void'], { message: 'Pick a valid decision.' }),
  notes: z
    .string()
    .trim()
    .max(1000, { message: 'Notes capped at 1000 characters.' })
    .optional()
    .or(z.literal('')),
});

// ─── 1. Approve (client) ──────────────────────────────────────────────
export async function approveInvoiceAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const parsed = IdSchema.safeParse({ invoiceId: formData.get('invoiceId') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid invoice id.' };
  }
  const { supabase, user } = await getAuthedUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  // Verify ownership + current status before update (defensive — RLS protects
  // too but a friendly message beats a raw RLS rejection)
  const { data: row } = await supabase
    .from('invoices')
    .select('id, status, client_id')
    .eq('id', parsed.data.invoiceId)
    .maybeSingle();
  const inv = row as { id?: string; status?: string; client_id?: string } | null;
  if (!inv) return { ok: false, error: 'Invoice not found.' };
  if (inv.client_id !== user.id) {
    const admin = await isAdmin();
    if (!admin) return { ok: false, error: 'You are not the billed party on this invoice.' };
  }
  if (inv.status !== 'pending_review') {
    return { ok: false, error: `Invoice is ${inv.status}, not awaiting review.` };
  }

  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: user.id,
    })
    .eq('id', parsed.data.invoiceId);

  if (error) {
    console.error('[approveInvoiceAction] failed:', error.message);
    return { ok: false, error: friendlyError(error.message) };
  }

  revalidateInvoicePaths(parsed.data.invoiceId);
  return { ok: true, error: null, message: 'Invoice approved.' };
}

// ─── 2. Dispute (client) ──────────────────────────────────────────────
export async function disputeInvoiceAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const parsed = DisputeSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { supabase, user } = await getAuthedUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  const { data: row } = await supabase
    .from('invoices')
    .select('id, status, client_id')
    .eq('id', parsed.data.invoiceId)
    .maybeSingle();
  const inv = row as { id?: string; status?: string; client_id?: string } | null;
  if (!inv) return { ok: false, error: 'Invoice not found.' };
  if (inv.client_id !== user.id) {
    const admin = await isAdmin();
    if (!admin) return { ok: false, error: 'Only the billed party can dispute this invoice.' };
  }
  if (inv.status === 'paid' || inv.status === 'voided') {
    return { ok: false, error: `Cannot dispute a ${inv.status} invoice.` };
  }

  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'disputed',
      disputed_at: new Date().toISOString(),
      disputed_by: user.id,
      dispute_reason: parsed.data.reason,
    })
    .eq('id', parsed.data.invoiceId);

  if (error) {
    console.error('[disputeInvoiceAction] failed:', error.message);
    return { ok: false, error: friendlyError(error.message) };
  }

  revalidateInvoicePaths(parsed.data.invoiceId);
  return { ok: true, error: null, message: 'Dispute filed. Admin will adjudicate.' };
}

// ─── 3. Mark paid (admin) ─────────────────────────────────────────────
export async function markInvoicePaidAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const parsed = PaidSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    reference: formData.get('reference') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  if (!(await isAdmin())) {
    return { ok: false, error: 'Only admins can mark invoices paid.' };
  }
  const { supabase } = await getAuthedUser();

  const { data: row } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', parsed.data.invoiceId)
    .maybeSingle();
  const status = (row as { status?: string } | null)?.status ?? '';
  if (status !== 'approved') {
    return { ok: false, error: `Invoice is ${status || 'unknown'}, not approved.` };
  }

  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      paid_reference: parsed.data.reference && parsed.data.reference.length > 0
        ? parsed.data.reference
        : null,
    })
    .eq('id', parsed.data.invoiceId);

  if (error) {
    console.error('[markInvoicePaidAction] failed:', error.message);
    return { ok: false, error: friendlyError(error.message) };
  }

  revalidateInvoicePaths(parsed.data.invoiceId);
  return { ok: true, error: null, message: 'Invoice marked paid.' };
}

// ─── 4. Void (admin) ──────────────────────────────────────────────────
export async function voidInvoiceAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const parsed = VoidSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    reason: formData.get('reason') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  if (!(await isAdmin())) {
    return { ok: false, error: 'Only admins can void invoices.' };
  }
  const { supabase, user } = await getAuthedUser();

  const { data: row } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', parsed.data.invoiceId)
    .maybeSingle();
  const status = (row as { status?: string } | null)?.status ?? '';
  if (status === 'paid') {
    return { ok: false, error: 'Cannot void a paid invoice.' };
  }

  const { error } = await supabase
    .from('invoices')
    .update({
      status: 'voided',
      voided_at: new Date().toISOString(),
      voided_by: user?.id ?? null,
      voided_reason: parsed.data.reason,
    })
    .eq('id', parsed.data.invoiceId);

  if (error) {
    console.error('[voidInvoiceAction] failed:', error.message);
    return { ok: false, error: friendlyError(error.message) };
  }

  revalidateInvoicePaths(parsed.data.invoiceId);
  return { ok: true, error: null, message: 'Invoice voided.' };
}

// ─── 5. Admin adjudicate dispute ──────────────────────────────────────
export async function adjudicateDisputeAction(
  _prev: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const parsed = AdjudicateSchema.safeParse({
    invoiceId: formData.get('invoiceId'),
    decision: formData.get('decision'),
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  if (!(await isAdmin())) {
    return { ok: false, error: 'Only admins can adjudicate disputes.' };
  }
  const { supabase, user } = await getAuthedUser();

  const { data: row } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', parsed.data.invoiceId)
    .maybeSingle();
  const status = (row as { status?: string } | null)?.status ?? '';
  if (status !== 'disputed') {
    return { ok: false, error: `Invoice is ${status || 'unknown'}, not in dispute.` };
  }

  const update =
    parsed.data.decision === 'approve'
      ? {
          status: 'approved' as const,
          approved_at: new Date().toISOString(),
          approved_by: user?.id ?? null,
          notes: parsed.data.notes && parsed.data.notes.length > 0 ? parsed.data.notes : null,
        }
      : {
          status: 'voided' as const,
          voided_at: new Date().toISOString(),
          voided_by: user?.id ?? null,
          voided_reason: parsed.data.notes && parsed.data.notes.length > 0
            ? parsed.data.notes
            : 'Adjudicated by admin',
        };

  const { error } = await supabase
    .from('invoices')
    .update(update)
    .eq('id', parsed.data.invoiceId);

  if (error) {
    console.error('[adjudicateDisputeAction] failed:', error.message);
    return { ok: false, error: friendlyError(error.message) };
  }

  revalidateInvoicePaths(parsed.data.invoiceId);
  return {
    ok: true,
    error: null,
    message:
      parsed.data.decision === 'approve'
        ? 'Dispute resolved, invoice approved.'
        : 'Dispute resolved, invoice voided.',
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────
function friendlyError(msg: string): string {
  if (msg.includes('row-level security')) {
    return 'You do not have permission to perform this action.';
  }
  if (msg.includes('check constraint')) {
    return 'Invalid state transition for this invoice.';
  }
  return `Could not update invoice: ${msg}`;
}
