'use server';

// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/partnerEngagements.ts — the partner-agency workflow.
//
//  Every action is a thin wrapper over a SECURITY DEFINER RPC that re-checks
//  authority in the DATABASE. Nothing here is trusted as the gate: a raw
//  PostgREST call or an opened route reaches the same checks.
//
//  Amounts are integer minor units end to end. Dollar input is converted once,
//  at the edge, with Math.round — never floating-point arithmetic on money.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface Result {
  ok: boolean;
  error?: string;
  message?: string;
}

function fail(e: unknown, fallback: string): Result {
  const msg =
    typeof e === 'object' && e !== null && 'message' in e
      ? String((e as { message: unknown }).message)
      : fallback;
  return { ok: false, error: msg };
}

/** Dollars (as typed) -> integer cents. Rejects anything not finite. */
function toCents(input: unknown, field: string): number {
  const n = typeof input === 'string' ? Number(input.replace(/[, ]/g, '')) : Number(input);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${field} must be a number of zero or more.`);
  }
  return Math.round(n * 100);
}

const PriceSchema = z.object({
  jobId: z.string().uuid(),
  customerAmount: z.string().min(1),
  inspectorPayout: z.string().default('0'),
  partnerCommission: z.string().default('0'),
  partnerId: z.string().uuid().optional().or(z.literal('')),
  inspectorId: z.string().uuid().optional().or(z.literal('')),
  currency: z.string().trim().length(3).default('USD'),
  pricingBasis: z
    .enum(['fixed_engagement', 'per_day', 'per_hour', 'per_visit'])
    .default('fixed_engagement'),
  scopeUnits: z.string().optional().or(z.literal('')),
  scopeNote: z.string().max(500).optional().or(z.literal('')),
  marginOverrideReason: z.string().max(500).optional().or(z.literal('')),
});

export async function priceEngagement(formData: FormData): Promise<Result> {
  const parsed = PriceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const d = parsed.data;

  let customer: number, inspector: number, partner: number;
  try {
    customer = toCents(d.customerAmount, 'Customer amount');
    inspector = toCents(d.inspectorPayout || '0', 'Inspector payout');
    partner = toCents(d.partnerCommission || '0', 'Partner commission');
  } catch (e) {
    return fail(e, 'Invalid amount.');
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_admin_price_engagement', {
    p_job_id: d.jobId,
    p_customer_amount_cents: customer,
    p_inspector_payout_cents: inspector,
    p_partner_commission_cents: partner,
    p_partner_id: d.partnerId || null,
    p_inspector_id: d.inspectorId || null,
    p_currency: d.currency.toUpperCase(),
    p_pricing_basis: d.pricingBasis,
    p_scope_units: d.scopeUnits ? Number(d.scopeUnits) : null,
    p_scope_note: d.scopeNote || null,
    p_margin_override_reason: d.marginOverrideReason || null,
  } as never);

  if (error) return fail(error, 'Could not save the pricing.');
  revalidatePath(`/admin/engagements/${d.jobId}`);
  return { ok: true, message: `Version saved (${String(data ?? '')}).` };
}

export async function presentEngagement(formData: FormData): Promise<Result> {
  const id = String(formData.get('commercialId') ?? '');
  const jobId = String(formData.get('jobId') ?? '');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_admin_present_engagement', {
    p_commercial_id: id,
  } as never);
  if (error) return fail(error, 'Could not present these terms.');
  revalidatePath(`/admin/engagements/${jobId}`);
  return { ok: true, message: 'Presented to the parties. Each sees only their own amount.' };
}

export async function confirmEngagement(formData: FormData): Promise<Result> {
  const id = String(formData.get('commercialId') ?? '');
  const jobId = String(formData.get('jobId') ?? '');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_admin_confirm_engagement', {
    p_commercial_id: id,
  } as never);
  if (error) return fail(error, 'Could not confirm.');
  revalidatePath(`/admin/engagements/${jobId}`);
  return { ok: true, message: 'Confirmed. Settlement obligations recorded, no money moved.' };
}

export async function setPartnerPolicy(formData: FormData): Promise<Result> {
  const jobId = String(formData.get('jobId') ?? '');
  const approve = String(formData.get('approve') ?? '') === 'true';
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_admin_approve_partner_job', {
    p_job_id: jobId,
    p_approve: approve,
  } as never);
  if (error) return fail(error, 'Could not change partner distribution.');
  revalidatePath(`/admin/engagements/${jobId}`);
  return {
    ok: true,
    message: approve ? 'Partner distribution approved.' : 'Partner distribution withdrawn.',
  };
}

export async function invitePartner(formData: FormData): Promise<Result> {
  const jobId = String(formData.get('jobId') ?? '');
  const partnerId = String(formData.get('partnerId') ?? '');
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_admin_invite_partner', {
    p_job_id: jobId,
    p_partner_id: partnerId,
  } as never);
  if (error) return fail(error, 'Could not invite that partner.');
  revalidatePath(`/admin/engagements/${jobId}`);
  return { ok: true, message: 'Partner invited to this engagement only.' };
}

export async function settleObligation(formData: FormData): Promise<Result> {
  const id = String(formData.get('obligationId') ?? '');
  const jobId = String(formData.get('jobId') ?? '');
  const status = String(formData.get('status') ?? '');
  const reference = String(formData.get('reference') ?? '').trim();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_admin_settle_obligation', {
    p_obligation_id: id,
    p_status: status,
    p_reference: reference || null,
  } as never);
  if (error) return fail(error, 'Could not update the obligation.');
  revalidatePath(`/admin/engagements/${jobId}`);
  return {
    ok: true,
    message:
      status === 'paid'
        ? 'Recorded as paid. This is a record of an external transfer, not a payment.'
        : `Obligation moved to ${status}.`,
  };
}

// ── Partner-side ──────────────────────────────────────────────────────────
export async function nominateInspector(formData: FormData): Promise<Result> {
  const opportunityId = String(formData.get('opportunityId') ?? '');
  const inspectorId = String(formData.get('inspectorId') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();
  if (!inspectorId) {
    return { ok: false, error: 'Name the inspector. A nomination must identify a person.' };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_partner_nominate_inspector', {
    p_opportunity_id: opportunityId,
    p_inspector_id: inspectorId,
    p_note: note || null,
  } as never);
  if (error) return fail(error, 'Could not nominate.');
  revalidatePath('/partner/opportunities');
  return { ok: true, message: 'Nominated. NEXPEC will verify their credentials.' };
}

// ── Any party accepts THEIR OWN terms ─────────────────────────────────────
export async function acceptEngagement(formData: FormData): Promise<Result> {
  const id = String(formData.get('commercialId') ?? '');
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_accept_engagement', {
    p_commercial_id: id,
  } as never);
  if (error) return fail(error, 'Could not record your acceptance.');
  revalidatePath('/engagements');
  return { ok: true, message: `Accepted as ${String(data ?? 'party')}.` };
}

// ── Customer consent, on their own job ────────────────────────────────────
export async function setCustomerConsent(formData: FormData): Promise<Result> {
  const jobId = String(formData.get('jobId') ?? '');
  const consent = String(formData.get('consent') ?? '') === 'true';
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_job_set_partner_consent', {
    p_job_id: jobId,
    p_consent: consent,
  } as never);
  if (error) return fail(error, 'Could not record your choice.');
  revalidatePath(`/client/jobs/${jobId}`);
  return {
    ok: true,
    message: consent
      ? 'Partner agencies may now be considered for this job. NEXPEC still approves each one.'
      : 'Partner participation withdrawn for this job.',
  };
}
