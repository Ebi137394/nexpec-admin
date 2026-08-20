// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/create-wallet-deposit-intent/index.ts
//  NEXPEC — WALLET-DEPOSIT-001
//
//  Mints a Stripe PaymentIntent for an INSPECTOR's wallet top-up. Mirrors
//  the security posture of create-payment-intent (STRIPE-003/004) but
//  with a different semantic:
//    • Amount IS client-supplied (because no job_id anchors it), BUT
//    • Bounded: caller-side floor of 1 SAR (100 halalas), ceiling of
//      10,000 SAR (1,000,000 halalas) — same ceiling enforced server-
//      side in wallet_credit_topup.
//    • Caller must be an inspector. The wallet schema is inspector-only
//      (inspector_earnings keyed on user_id — confirmed against live
//      schema in WALLET-SCHEMA-DRIFT-001); allowing clients / agencies
//      to call this would mint orphan PaymentIntents we can't credit
//      anywhere.
//    • Stripe metadata identifies the PI as kind='wallet_topup' so the
//      existing stripe-payments-webhook routes the success event to
//      wallet_credit_topup() instead of stripe_complete_job().
//
//  Contract
//  ────────
//    Input  : { amount_halalas: integer (positive, ≤ 1,000,000) }
//    Output : { clientSecret, paymentIntentId, amount_halalas, currency,
//               transactionRefId, kind: 'wallet_topup' }
//
//  Hard guarantees
//  ───────────────
//    1. Authenticated Bearer JWT required.
//    2. Authorization — caller's profiles.role must be a buyer
//       (client / agency / enterprise; admin/super_admin = god-mode).
//    3. Amount is integer halalas only. Floats are rejected.
//    4. Stripe idempotency_key keyed on (user_id, amount, daily slot)
//       — replaying within the same day with the same amount returns
//       the same PI (no double-charge if the client retries).
//    5. Stripe metadata: kind, user_id, transaction_ref_id, platform.
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { assertOnlinePaymentsEnabled } from '../_shared/paymentMode.ts';

// ─── Stripe client ─────────────────────────────────────────────────────────
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

// ─── CORS ──────────────────────────────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── Constants ─────────────────────────────────────────────────────────────
const MIN_HALALAS = 100;        // $1.00 (100 cents)
const MAX_HALALAS = 1_000_000;  // $10,000.00 (cents)
const CURRENCY = 'usd';          // #QA — platform is USD-only; PaymentIntent in USD cents
                                 //       (the wallet minor unit is now cents, not halalas)

// ─── Helpers ───────────────────────────────────────────────────────────────
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Handler ───────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // RELEASE POSTURE (manual payment only): refuse before any Stripe call.
  const paymentModeBlock = await assertOnlinePaymentsEnabled(corsHeaders);
  if (paymentModeBlock) return paymentModeBlock;
  if (req.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      405,
    );
  }

  try {
    // ── Step 1: Authenticate ────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse(
        { error: 'Missing or malformed Authorization header', code: 'AUTH_MISSING' },
        401,
      );
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return jsonResponse({ error: 'Empty Bearer token', code: 'AUTH_MISSING' }, 401);
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return jsonResponse(
        { error: 'Invalid or expired token', code: 'AUTH_INVALID' },
        401,
      );
    }

    // ── Step 2: Authorize — caller must be a buyer (client/agency/enterprise) ──
    const { data: profile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profErr) {
      console.error('[create-wallet-deposit-intent] profile lookup failed:', profErr.message);
      return jsonResponse({ error: 'Profile lookup failed', code: 'DB_ERROR' }, 500);
    }
    // Wallet top-ups are a BUYER action — clients/agencies/enterprises prefund
    // their balance to pay for inspections. (admin/super_admin = god-mode.)
    // Inspectors/suppliers EARN and withdraw; they never top up.
    const DEPOSIT_ROLES = ['client', 'agency', 'enterprise', 'admin', 'super_admin'];
    if (!profile || !DEPOSIT_ROLES.includes(profile.role as string)) {
      console.warn(
        `[create-wallet-deposit-intent][SECURITY] unauthorized topup attempt — user=${user.id} role=${profile?.role ?? 'unknown'}`,
      );
      return jsonResponse(
        {
          error: 'Wallet top-ups are available to buyer accounts (client, agency, enterprise).',
          code: 'NOT_AUTHORIZED',
        },
        403,
      );
    }

    // ── Step 3: Parse + validate body ───────────────────────────────
    let body: { amount_halalas?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { error: 'Invalid JSON body', code: 'INVALID_JSON' },
        400,
      );
    }

    const rawAmount = Number(body.amount_halalas);
    if (
      !Number.isFinite(rawAmount) ||
      !Number.isInteger(rawAmount) ||
      rawAmount < MIN_HALALAS ||
      rawAmount > MAX_HALALAS
    ) {
      return jsonResponse(
        {
          error: `amount_halalas must be an integer between ${MIN_HALALAS} and ${MAX_HALALAS}`,
          code: 'INVALID_AMOUNT',
        },
        400,
      );
    }
    const amountHalalas = rawAmount;

    // ── Step 4: Create the PaymentIntent ────────────────────────────
    //
    //  Idempotency key keyed on (user_id, amount, daily slot). A user
    //  retrying within the same day with the same amount gets the same
    //  PI back — protects against double-charge if the client double-
    //  submits. Different days OR different amounts mint distinct PIs.
    //
    //  transaction_ref_id is a fresh UUID for every (non-retried) call;
    //  the webhook uses it to correlate the Stripe event back to the
    //  audit trail.
    const transactionRefId = crypto.randomUUID();
    const daySlot = new Date().toISOString().slice(0, 10);
    const idempotencyKey = `nexpec_topup_${user.id}_${amountHalalas}_${daySlot}`;

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountHalalas,
          currency: CURRENCY,
          automatic_payment_methods: { enabled: true },
          metadata: {
            kind: 'wallet_topup',
            user_id: user.id,
            transaction_ref_id: transactionRefId,
            platform: 'NEXPEC',
          },
        },
        { idempotencyKey },
      );
    } catch (stripeErr: any) {
      console.error(
        '[create-wallet-deposit-intent] Stripe API error:',
        stripeErr?.message,
        stripeErr?.code,
      );
      return jsonResponse(
        {
          error: 'Payment provider error. Please try again.',
          code: 'STRIPE_ERROR',
          stripe_code: stripeErr?.code ?? null,
        },
        502,
      );
    }

    // ── Step 5: Success ─────────────────────────────────────────────
    console.log(
      `[create-wallet-deposit-intent] PI ${paymentIntent.id} minted — user=${user.id} amount_halalas=${amountHalalas}`,
    );

    return jsonResponse(
      {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount_halalas: amountHalalas,
        currency: CURRENCY,
        transactionRefId,
        kind: 'wallet_topup',
      },
      200,
    );
  } catch (err: any) {
    console.error('[create-wallet-deposit-intent] fatal:', err);
    return jsonResponse(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      500,
    );
  }
});
