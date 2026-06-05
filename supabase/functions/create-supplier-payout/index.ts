// ─────────────────────────────────────────────────────────────────
//  supabase/functions/create-supplier-payout/index.ts
//
//  Supplier-initiated payout — a VERBATIM mirror of create-stripe-payout
//  (the inspector flow), scoped to suppliers. A PARALLEL function is used
//  deliberately so the live inspector money-flow is never touched.
//
//  Security (identical to the inspector blueprint):
//    - Authenticated Bearer JWT (401 otherwise).
//    - body.user_id MUST equal auth.uid().
//    - profiles.role MUST be 'supplier' (supplier_earnings is supplier-only).
//    - Idempotency keys on Stripe transfer + payout, scoped on the txn id.
//
//  Money flow:
//    1. debit_supplier_wallet_for_payout() — atomic SELECT … FOR UPDATE on
//       supplier_earnings, decrement available, insert a 'processing' txn.
//    2. stripe.transfers.create() — platform balance → connected account.
//    3. stripe.payouts.create({...}, { stripeAccount }) — connected → bank.
//    4. stripe-connect-webhook (payout.paid/failed) closes the loop on the
//       shared transactions row (keyed by reference_id) — no change needed.
//
//  Currency: USD · Min withdrawal: $50.00 = 5000 cents
// ─────────────────────────────────────────────────────────────────

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const MIN_WITHDRAWAL_CENTS = 5_000; // $50 USD
const PAYOUT_CURRENCY = 'usd';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isValidUUID(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    // ── Authenticate ──
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return json({ error: 'Missing or malformed Authorization header', code: 'AUTH_MISSING' }, 401);
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) return json({ error: 'Empty Bearer token', code: 'AUTH_MISSING' }, 401);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return json({ error: 'Invalid or expired token', code: 'AUTH_INVALID' }, 401);

    // ── Parse + validate body ──
    let body: { user_id?: unknown; amount_cents?: unknown };
    try { body = await req.json(); } catch { return json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400); }

    if (!isValidUUID(body.user_id)) {
      return json({ error: 'user_id is required and must be a UUID', code: 'INVALID_USER_ID' }, 400);
    }
    if (body.user_id !== user.id) {
      console.warn(`[create-supplier-payout][SECURITY] cross-user payout — caller=${user.id} target=${body.user_id}`);
      return json({ error: 'You may only trigger your own payout', code: 'NOT_PAYOUT_OWNER' }, 403);
    }
    const userId = user.id;

    const amount_cents = body.amount_cents;
    if (typeof amount_cents !== 'number' || !Number.isFinite(amount_cents)) {
      return json({ error: 'amount_cents must be a finite number', code: 'INVALID_AMOUNT' }, 400);
    }
    if (!Number.isInteger(amount_cents)) {
      return json({ error: 'amount_cents must be an integer (cents)', code: 'INVALID_AMOUNT' }, 400);
    }
    if (amount_cents <= 0) return json({ error: 'amount_cents must be positive', code: 'INVALID_AMOUNT' }, 400);
    if (amount_cents < MIN_WITHDRAWAL_CENTS) {
      return json({ error: `Minimum withdrawal is $${(MIN_WITHDRAWAL_CENTS / 100).toFixed(2)} USD`, code: 'BELOW_MIN' }, 400);
    }

    // ── Verify Stripe Connect status + supplier role ──
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('role, stripe_connect_id, stripe_connect_status, stripe_connect_payouts_enabled')
      .eq('id', userId)
      .single();

    if (profileErr || !profile) return json({ error: 'Profile not found', code: 'PROFILE_NOT_FOUND' }, 404);

    if (profile.role !== 'supplier') {
      console.warn(`[create-supplier-payout][SECURITY] non-supplier payout — user=${userId} role=${profile.role}`);
      return json({ error: 'Supplier payouts are only available to suppliers', code: 'NOT_SUPPLIER' }, 403);
    }
    if (!profile.stripe_connect_id || profile.stripe_connect_status !== 'verified' || !profile.stripe_connect_payouts_enabled) {
      return json({ error: 'Stripe Connect onboarding incomplete or not verified.', code: 'CONNECT_NOT_VERIFIED', status: profile.stripe_connect_status }, 403);
    }

    // ── Atomic debit + processing txn (supplier_earnings) ──
    const { data: txnId, error: debitErr } = await supabase.rpc(
      'debit_supplier_wallet_for_payout',
      { p_user_id: userId, p_amount_cents: amount_cents },
    );
    if (debitErr || !txnId) {
      const msg = debitErr?.message ?? 'Insufficient balance';
      const code = msg.includes('INSUFFICIENT_BALANCE') ? 'INSUFFICIENT_BALANCE'
        : msg.includes('WALLET_NOT_FOUND') ? 'WALLET_NOT_FOUND' : 'DEBIT_FAILED';
      return json({ error: msg, code }, 400);
    }

    const transferIdempotencyKey = `nexpec_supplier_transfer_${txnId}`;
    const payoutIdempotencyKey = `nexpec_supplier_payout_${txnId}`;

    // ── Transfer: platform → connected account ──
    let transfer: Stripe.Transfer;
    try {
      transfer = await stripe.transfers.create(
        { amount: amount_cents, currency: PAYOUT_CURRENCY, destination: profile.stripe_connect_id, metadata: { user_id: userId, transaction_id: txnId } },
        { idempotencyKey: transferIdempotencyKey },
      );
    } catch (err: any) {
      await supabase.rpc('restore_supplier_wallet_balance', { p_user_id: userId, p_amount_cents: amount_cents });
      await supabase.from('transactions').update({ status: 'failed', description: `Transfer failed: ${err?.message}` }).eq('id', txnId);
      return json({ error: `Transfer failed: ${err?.message}`, code: 'TRANSFER_FAILED' }, 502);
    }

    // ── Payout: connected account → supplier's bank ──
    let payout: Stripe.Payout;
    try {
      payout = await stripe.payouts.create(
        { amount: amount_cents, currency: PAYOUT_CURRENCY, metadata: { user_id: userId, transaction_id: txnId } },
        { stripeAccount: profile.stripe_connect_id, idempotencyKey: payoutIdempotencyKey },
      );
    } catch (err: any) {
      await supabase.from('transactions').update({
        status: 'pending',
        description: `Auto-payout pending (manual create failed: ${err?.message})`,
        reference_id: transfer.id,
        metadata: { transfer_id: transfer.id },
      }).eq('id', txnId);
      return json({ transaction_id: txnId, status: 'pending', warning: 'Funds transferred but explicit payout failed; Stripe will auto-payout on its schedule.' }, 200);
    }

    await supabase.from('transactions').update({
      reference_id: payout.id,
      metadata: { transfer_id: transfer.id, payout_id: payout.id, stripe_account: profile.stripe_connect_id },
    }).eq('id', txnId);

    return json({ transaction_id: txnId, status: 'processing', payout_id: payout.id, arrival_date: payout.arrival_date });
  } catch (err: any) {
    console.error('[create-supplier-payout] error:', err);
    return json({ error: err?.message ?? 'Unknown error' }, 500);
  }
});
