// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/create-disclosure-fee-intent/index.ts
//  NEXPEC — Named-Disclosure VIP premium fee → real Stripe card charge.
//
//  Surfaces the existing Layer-E Named-Disclosure flow's premium fee as an
//  actual Stripe PaymentIntent (web-only card surface — see decision log),
//  replacing the placeholder ledger-only collection. Mirrors the hardened
//  create-payment-intent contract (STRIPE-003/004): authenticated, amount
//  STRICTLY server-trusted, Stripe-idempotent.
//
//  Contract:
//    Input  : { agreement_id: uuid }   // the signed disclosure_amendment
//    Output : { clientSecret, paymentIntentId, amount, currency,
//               agreementId, dealId, transactionRefId }
//
//  Hard guarantees:
//    1. Authenticated Bearer JWT required.
//    2. Authorization — caller must be the amendment's counterparty, i.e. the
//       deal's buyer (deals.client_id). This is account-type AGNOSTIC: Client,
//       Agency, and Enterprise buyers are ALL authorized here by deal ownership,
//       never by profile role — do NOT narrow this to role === 'client'. No one
//       else can pay to lift another deal's identity escrow.
//    3. Contract-before-money — the sealed rider must already be SIGNED
//       (agreements.status = 'executed'). We never mint a PaymentIntent for an
//       unsigned amendment.
//    4. amount is read STRICTLY from agreements.amount_cents — never the body.
//    5. Already-paid guard — if the vip_disclosure_fee leg is already 'held'
//       (settled), return 409 instead of a duplicate charge.
//    6. metadata.kind = 'named_disclosure_fee' + agreement_id/deal_id/
//       transaction_ref_id — consumed by stripe-payments-webhook →
//       stripe_settle_named_disclosure to lift identity escrow.
//    7. Stripe idempotency_key keyed on the amendment.
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

// ─── Helpers ───────────────────────────────────────────────────────────────
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isValidUUID(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s,
    )
  );
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

    const {
      data: { user },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(token);

    if (authErr || !user) {
      return jsonResponse({ error: 'Invalid or expired token', code: 'AUTH_INVALID' }, 401);
    }

    // ── Step 2: Parse + validate body ───────────────────────────────
    let body: { agreement_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
    }

    const agreementId = body.agreement_id;
    if (!isValidUUID(agreementId)) {
      return jsonResponse(
        { error: 'agreement_id is required and must be a UUID', code: 'INVALID_AGREEMENT_ID' },
        400,
      );
    }

    // ── Step 3: Server-side amendment lookup (amount source of truth) ─
    const { data: agreement, error: agrErr } = await supabaseAdmin
      .from('agreements')
      .select('id, kind, status, deal_id, counterparty_id, amount_cents, currency')
      .eq('id', agreementId)
      .maybeSingle();

    if (agrErr) {
      console.error('[create-disclosure-fee-intent] agreement lookup error:', agrErr.message);
      return jsonResponse({ error: 'Lookup failed', code: 'DB_ERROR' }, 500);
    }
    if (!agreement) {
      return jsonResponse({ error: 'Amendment not found', code: 'AGREEMENT_NOT_FOUND' }, 404);
    }
    if (agreement.kind !== 'disclosure_amendment') {
      return jsonResponse(
        { error: 'Agreement is not a disclosure amendment', code: 'WRONG_KIND' },
        409,
      );
    }

    // ── Step 4: Authorization — caller must be the buyer counterparty ─
    //   deals.client_id == counterparty_id; any buyer account type
    //   (client / agency / enterprise) is authorized by ownership, not role.
    if (agreement.counterparty_id !== user.id) {
      console.warn(
        `[create-disclosure-fee-intent][SECURITY] Non-party unlock attempt — user=${user.id} agreement=${agreement.id}`,
      );
      return jsonResponse(
        { error: 'You are not authorized to pay for this disclosure', code: 'NOT_PARTY' },
        403,
      );
    }

    // ── Step 5: Contract-before-money — rider must be signed/executed ─
    if (agreement.status !== 'executed') {
      return jsonResponse(
        {
          error: 'Sign the disclosure amendment before paying',
          code: 'NOT_SIGNED',
        },
        409,
      );
    }

    // ── Step 6: Already-paid guard ──────────────────────────────────
    const { data: leg, error: legErr } = await supabaseAdmin
      .from('deal_money_legs')
      .select('status')
      .eq('deal_id', agreement.deal_id)
      .eq('kind', 'vip_disclosure_fee')
      .maybeSingle();
    if (legErr) {
      console.error('[create-disclosure-fee-intent] leg lookup error:', legErr.message);
      return jsonResponse({ error: 'Lookup failed', code: 'DB_ERROR' }, 500);
    }
    if (leg?.status === 'held') {
      return jsonResponse(
        { error: 'This disclosure has already been paid', code: 'ALREADY_PAID' },
        409,
      );
    }

    // ── Step 7: Amount — strictly server-trusted ────────────────────
    const amountCents = Number(agreement.amount_cents);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      console.error(
        `[create-disclosure-fee-intent] amendment ${agreement.id} has invalid amount_cents:`,
        agreement.amount_cents,
      );
      return jsonResponse({ error: 'Amendment has no valid fee. Contact admin.', code: 'NO_FEE' }, 409);
    }
    if (amountCents < 50) {
      return jsonResponse(
        { error: 'Fee is below Stripe minimum (0.50)', code: 'AMOUNT_TOO_SMALL' },
        409,
      );
    }
    const currency = String(agreement.currency || 'usd').toLowerCase();

    // ── Step 8: Create the PaymentIntent ────────────────────────────
    const transactionRefId = crypto.randomUUID();
    const idempotencyKey = `nexpec_nd_${agreement.id}`;

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency,
          automatic_payment_methods: { enabled: true },
          metadata: {
            kind: 'named_disclosure_fee',
            agreement_id: agreement.id,
            deal_id: agreement.deal_id ?? '',
            client_id: user.id,
            user_id: user.id,
            transaction_ref_id: transactionRefId,
            platform: 'NEXPEC',
          },
        },
        { idempotencyKey },
      );
    } catch (stripeErr: any) {
      console.error(
        '[create-disclosure-fee-intent] Stripe API error:',
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

    console.log(
      `[create-disclosure-fee-intent] PI ${paymentIntent.id} created — user=${user.id} agreement=${agreement.id} amount=${amountCents} ${currency}`,
    );

    return jsonResponse(
      {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: amountCents,
        currency,
        agreementId: agreement.id,
        dealId: agreement.deal_id,
        transactionRefId,
      },
      200,
    );
  } catch (err: any) {
    console.error('[create-disclosure-fee-intent] fatal:', err);
    return jsonResponse({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
});
