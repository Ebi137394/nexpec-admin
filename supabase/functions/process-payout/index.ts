// ============================================================================
// NEXPEC · process-payout Edge Function
// supabase/functions/process-payout/index.ts
// ============================================================================

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import Stripe from 'https://esm.sh/stripe@14.14.0?target=deno';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

interface BankMetadata {
  bank_name?: string;
  account_number: string;
  transit_number: string;
  institution_number: string;
  account_holder_name: string;
  email?: string;
}

interface PayoutRow {
  id: string;
  inspector_id: string;
  amount: number;
  status: string;
  stripe_transfer_id: string | null;
  bank_metadata: BankMetadata | null;
  notes: string | null;
  profiles: {
    id: string;
    full_name: string | null;
    email: string;
    stripe_connect_id: string | null;
  } | null;
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function fail(status: number, message: string, code?: string): Response {
  return json(status, { error: message, code: code ?? 'error' });
}

function buildRoutingNumber(transit: string, institution: string): string {
  const t = transit.replace(/\D/g, '').padStart(5, '0');
  const i = institution.replace(/\D/g, '').padStart(3, '0');
  if (t.length !== 5) throw new Error(`Invalid transit number: "${transit}" (must be 5 digits)`);
  if (i.length !== 3) throw new Error(`Invalid institution number: "${institution}" (must be 3 digits)`);
  return `${t}${i}`;
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return { first: 'N/A', last: 'N/A' };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

async function ensureConnectedAccount(stripe: Stripe, supabaseAdmin: SupabaseClient, payout: PayoutRow, clientIp: string): Promise<string> {
  const profile = payout.profiles;
  const bank = payout.bank_metadata!;
  const existingId = profile?.stripe_connect_id;

  if (existingId) {
    try {
      const acct = await stripe.accounts.retrieve(existingId);
      if (!acct.deleted) return existingId;
    } catch {
      console.warn(`[process-payout] Stale Stripe account ${existingId}, recreating.`);
    }
  }

  const holderName = bank.account_holder_name || profile?.full_name || 'Account Holder';
  const { first, last } = splitName(holderName);
  const email = profile?.email || bank.email || '';
  const routingNumber = buildRoutingNumber(bank.transit_number, bank.institution_number);

  const account = await stripe.accounts.create({
    type: 'custom',
    country: 'CA',
    email,
    business_type: 'individual',
    individual: { first_name: first, last_name: last, email },
    capabilities: { transfers: { requested: true } },
    tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: clientIp },
    external_account: {
      object: 'bank_account',
      country: 'CA',
      currency: 'cad',
      routing_number: routingNumber,
      account_number: bank.account_number,
      account_holder_name: holderName,
      account_holder_type: 'individual',
    },
    metadata: { platform: 'nexpec', inspector_id: payout.inspector_id },
  });

  await supabaseAdmin.from('profiles').update({ stripe_connect_id: account.id }).eq('id', payout.inspector_id);
  return account.id;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let payoutId: string | undefined;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return fail(401, 'Missing or malformed Authorization header', 'auth_missing');
    const jwt = authHeader.slice(7);
    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(jwt);
    if (authErr || !user) return fail(401, 'Invalid or expired token', 'auth_invalid');

    const { data: callerProfile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
    if (callerProfile?.role !== 'super_admin') return fail(403, 'Forbidden — super_admin role required', 'auth_forbidden');

    const body = await req.json().catch(() => ({}));
    payoutId = body?.payout_id;
    if (!payoutId || typeof payoutId !== 'string') return fail(400, 'Request body must include a valid payout_id string', 'input_invalid');

    const { data: payout, error: fetchErr } = await supabaseAdmin.from('payout_requests')
      .select(`*, profiles:inspector_id (id, full_name, email, stripe_connect_id)`).eq('id', payoutId).single();
    if (fetchErr || !payout) return fail(404, `Payout request ${payoutId} not found`, 'not_found');

    const typedPayout = payout as unknown as PayoutRow;

    if (typedPayout.status === 'paid') return json(200, { success: true, message: 'Payout already completed', transfer_id: typedPayout.stripe_transfer_id, idempotent: true });
    if (typedPayout.status === 'rejected') return fail(409, 'Cannot process a rejected payout.', 'state_conflict');
    if (!['pending', 'processing'].includes(typedPayout.status)) return fail(400, `Unexpected payout status: ${typedPayout.status}`, 'state_invalid');

    const bank = typedPayout.bank_metadata;
    if (!bank || !bank.account_number?.trim() || !bank.transit_number?.trim() || !bank.institution_number?.trim() || !bank.account_holder_name?.trim()) {
      await supabaseAdmin.from('payout_requests').update({ status: 'rejected', notes: 'Auto-rejected: Incomplete bank details.' }).eq('id', payoutId);
      return fail(400, 'Payout rejected — incomplete bank metadata', 'bank_incomplete');
    }

    const { error: lockErr } = await supabaseAdmin.from('payout_requests').update({ status: 'processing' }).eq('id', payoutId).in('status', ['pending', 'processing']);
    if (lockErr) return fail(500, 'Failed to acquire processing lock', 'lock_failed');

    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
    if (!stripeKey) throw Object.assign(new Error('STRIPE_SECRET_KEY is not configured'), { code: 'config_missing' });

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-06-20', httpClient: Stripe.createFetchHttpClient() });
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('cf-connecting-ip') || '0.0.0.0';

    const connectedAccountId = await ensureConnectedAccount(stripe, supabaseAdmin, typedPayout, clientIp);
    const amountCents = Math.round(Number(typedPayout.amount) * 100);

    if (amountCents <= 0) throw Object.assign(new Error('Transfer amount must be positive'), { code: 'amount_invalid' });

    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: 'cad',
      destination: connectedAccountId,
      description: `NEXPEC payout · ${payoutId.slice(0, 8)}`,
      metadata: { payout_request_id: payoutId, inspector_id: typedPayout.inspector_id, platform: 'nexpec' },
    });

    const { error: finalizeErr } = await supabaseAdmin.from('payout_requests').update({ status: 'paid', stripe_transfer_id: transfer.id }).eq('id', payoutId);
    if (finalizeErr) console.error('[process-payout] CRITICAL: DB update failed!', { payoutId, transferId: transfer.id, error: finalizeErr });

    return json(200, { success: true, transfer_id: transfer.id, connected_account_id: connectedAccountId, amount: typedPayout.amount, currency: 'cad' });

  } catch (err: unknown) {
    const error = err as Record<string, unknown>;
    const message = (error?.message as string) || 'Internal server error';
    const code = (error?.code as string) || 'internal_error';
    const type = (error?.type as string) || '';

    if (payoutId) {
      const isStripeError = typeof type === 'string' && type.startsWith('Stripe');
      await supabaseAdmin.from('payout_requests').update({
        status: 'pending',
        notes: isStripeError ? `Stripe error [${code}]: ${message}` : `Processing error: ${message}`,
      }).eq('id', payoutId).eq('status', 'processing');
    }

    const httpStatus = (typeof error?.status === 'number' && error.status) || (type.startsWith?.('Stripe') ? 402 : 500);
    return fail(httpStatus, message, code);
  }
});