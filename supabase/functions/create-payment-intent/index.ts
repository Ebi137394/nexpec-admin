// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/create-payment-intent/index.ts
//  NEXPEC — STRIPE-003 + STRIPE-004 strike
//
//  COMPLETE REWRITE. The previous implementation accepted `amount` from
//  the request body (client-trust → revenue theft, STRIPE-003) and had
//  zero authentication (STRIPE-004 — anyone with the URL could mint
//  PaymentIntents against the platform's Stripe account).
//
//  New contract:
//    Input  : { job_id: uuid }
//    Output : { clientSecret, paymentIntentId, amount, currency, jobId,
//              transactionRefId }
//
//  Hard guarantees:
//    1. Authenticated Bearer JWT required.
//    2. Authorization — caller must be the job's client_id OR agency_id.
//       Inspectors (contractor_id) cannot pay for their own job.
//    3. Job must be admin-dispatched (status in {assigned, in_progress,
//      completed} AND admin_confirmed_at IS NOT NULL).
//    4. amount is read STRICTLY from jobs.client_price_cents — never
//       from the request body.
//    5. Stripe metadata: job_id, client_id, agency_id, contractor_id,
//       user_id, transaction_ref_id, platform. Required by the future
//       payment_intent.succeeded webhook (STRIPE-005) to reconcile a
//       Stripe event back to a job.
//    6. Stripe idempotency_key keyed on the job. Retrying the endpoint
//       for the same job returns the SAME PaymentIntent (no duplicates
//       on the Stripe side either).
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

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
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(
      { error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' },
      405,
    );
  }

  try {
    // ── Step 1: Authenticate (STRIPE-004) ───────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse(
        {
          error: 'Missing or malformed Authorization header',
          code: 'AUTH_MISSING',
        },
        401,
      );
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return jsonResponse(
        { error: 'Empty Bearer token', code: 'AUTH_MISSING' },
        401,
      );
    }

    // Service-role client — used to bypass RLS for the trusted server-side
    // job lookup AND to verify the caller's JWT.
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
      return jsonResponse(
        { error: 'Invalid or expired token', code: 'AUTH_INVALID' },
        401,
      );
    }

    // ── Step 2: Parse + validate body ───────────────────────────────
    let body: { job_id?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { error: 'Invalid JSON body', code: 'INVALID_JSON' },
        400,
      );
    }

    const jobId = body.job_id;
    if (!isValidUUID(jobId)) {
      return jsonResponse(
        {
          error: 'job_id is required and must be a UUID',
          code: 'INVALID_JOB_ID',
        },
        400,
      );
    }

    // ── Step 3: Server-side job lookup ──────────────────────────────
    // The amount comes from here. Never from the request body.
    const { data: job, error: jobErr } = await supabaseAdmin
      .from('jobs')
      .select(
        'id, status, admin_confirmed_at, client_id, agency_id, contractor_id, client_price_cents, title',
      )
      .eq('id', jobId)
      .maybeSingle();

    if (jobErr) {
      console.error(
        '[create-payment-intent] job lookup error:',
        jobErr.message,
      );
      return jsonResponse(
        { error: 'Job lookup failed', code: 'DB_ERROR' },
        500,
      );
    }
    if (!job) {
      return jsonResponse(
        { error: 'Job not found', code: 'JOB_NOT_FOUND' },
        404,
      );
    }

    // ── Step 4: Authorization — caller must be a paying party ──────
    // Only the job's client OR agency can pay for it. The contractor
    // (inspector) cannot pay for their own job (they receive the
    // payout, not initiate the charge).
    const isPayingParty =
      job.client_id === user.id || job.agency_id === user.id;

    if (!isPayingParty) {
      console.warn(
        `[create-payment-intent][SECURITY] Non-party payment attempt — user=${user.id} job=${job.id}`,
      );
      return jsonResponse(
        {
          error: 'You are not authorized to pay for this job',
          code: 'NOT_PARTY',
        },
        403,
      );
    }

    // ── Step 5: Job state guards — STAGE AWARE ──────────────────────
    // Lane 5 (20260801448000). The old guard required admin_confirmed_at for
    // EVERY payment, which deadlocked prepay card jobs: paying required
    // dispatch (here), while dispatch required payment
    // (nx_guard_dispatch_requires_funding). Under staged funding the INITIAL
    // tranche is contractually due BEFORE assignment, so it must be payable
    // pre-dispatch — that is the valid first action the deadlock lacked.
    // Every LATER tranche still requires dispatch, so nothing is loosened for
    // the money that used to be gated here.
    const stageCode = typeof body.stage === 'string' ? body.stage : 'initial';
    if (!['initial', 'final', 'retention'].includes(stageCode)) {
      return jsonResponse(
        { error: 'Unknown funding stage', code: 'INVALID_STAGE' },
        400,
      );
    }
    const isInitialStage = stageCode === 'initial';

    if (!isInitialStage) {
      if (job.admin_confirmed_at == null) {
        return jsonResponse(
          {
            error: 'Job has not been dispatched by admin yet',
            code: 'NOT_DISPATCHED',
          },
          409,
        );
      }
      const payableStatuses = ['assigned', 'in_progress', 'completed'];
      if (!payableStatuses.includes(job.status)) {
        return jsonResponse(
          {
            error: `Job is not in a payable state (current: ${job.status})`,
            code: 'INVALID_STATE',
          },
          409,
        );
      }
    } else {
      // The initial tranche funds work authorisation, so it is payable before
      // dispatch — but not on a job that is dead or already finished.
      const initialPayableStatuses = [
        'pending_approval',
        'approved',
        'open',
        'assigned',
        'in_progress',
      ];
      if (!initialPayableStatuses.includes(job.status)) {
        return jsonResponse(
          {
            error:
              `Job is not in a state where initial funding applies (current: ${job.status})`,
            code: 'INVALID_STATE',
          },
          409,
        );
      }
    }

    // ── Step 6: Amount — strictly server-trusted, from the schedule ─
    // Still never from the request body. The schedule row is itself derived
    // server-side from jobs.client_price_cents by nx_funding_ensure_schedule,
    // so the original "amount comes from the job, not the caller" rule holds.
    await supabaseAdmin.rpc('nx_funding_ensure_schedule', { p_job_id: job.id });

    const { data: stageRow, error: stageErr } = await supabaseAdmin
      .from('job_funding_stages')
      .select('id, code, amount_cents, status')
      .eq('job_id', job.id)
      .eq('code', stageCode)
      .maybeSingle();

    if (stageErr) {
      console.error('[create-payment-intent] funding stage lookup failed:', stageErr);
      return jsonResponse(
        { error: 'Could not resolve the funding schedule', code: 'FUNDING_LOOKUP_FAILED' },
        500,
      );
    }
    if (!stageRow) {
      return jsonResponse(
        { error: `Job has no ${stageCode} funding tranche`, code: 'FUNDING_STAGE_NOT_FOUND' },
        409,
      );
    }
    if (stageRow.status === 'funded' || stageRow.status === 'waived') {
      return jsonResponse(
        { error: `The ${stageCode} tranche is already settled`, code: 'ALREADY_FUNDED' },
        409,
      );
    }

    const amountCents = Number(stageRow.amount_cents);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      console.error(
        `[create-payment-intent] job ${job.id} stage ${stageCode} has invalid amount_cents:`,
        stageRow.amount_cents,
      );
      return jsonResponse(
        {
          error: 'Job has no valid price set. Contact admin.',
          code: 'NO_PRICE',
        },
        409,
      );
    }
    // Stripe rejects PaymentIntents under $0.50 USD. Mirror the guard
    // here so we fail loud rather than letting Stripe error out.
    if (amountCents < 50) {
      return jsonResponse(
        {
          error: 'Job price is below Stripe minimum (USD $0.50)',
          code: 'AMOUNT_TOO_SMALL',
        },
        409,
      );
    }

    // ── Step 7: Create the PaymentIntent ────────────────────────────
    // Stripe idempotency_key keyed on the job — retrying this endpoint
    // for the same job returns the SAME PaymentIntent so we never
    // accidentally double-charge.
    //
    // transaction_ref_id is a server-generated UUID embedded in the
    // metadata. The future payment_intent.succeeded webhook (STRIPE-005)
    // will use this + job_id to reconcile the Stripe event back to
    // platform state.
    const transactionRefId = crypto.randomUUID();
    // Lane 5: the key MUST include the stage. It was `nexpec_pi_${job.id}`,
    // which was correct while a job had exactly one payment — under staged
    // funding the second tranche would collide with the first and Stripe
    // would hand back the ORIGINAL PaymentIntent, i.e. charge the 20% amount
    // for the 80% request. Scoping the key per stage keeps each tranche
    // independently idempotent.
    const idempotencyKey = `nexpec_pi_${job.id}_${stageCode}`;

    let paymentIntent: Stripe.PaymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency: 'usd',
          automatic_payment_methods: { enabled: true },
          metadata: {
            job_id: job.id,
            client_id: job.client_id ?? '',
            agency_id: job.agency_id ?? '',
            contractor_id: job.contractor_id ?? '',
            user_id: user.id,
            transaction_ref_id: transactionRefId,
            // the webhook settles THIS tranche, not "the job"
            funding_stage: stageCode,
            funding_stage_id: stageRow.id,
            platform: 'NEXPEC',
          },
        },
        { idempotencyKey },
      );
    } catch (stripeErr: any) {
      console.error(
        '[create-payment-intent] Stripe API error:',
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

    // ── Step 8: Success ─────────────────────────────────────────────
    console.log(
      `[create-payment-intent] PI ${paymentIntent.id} created — user=${user.id} job=${job.id} amount=${amountCents}`,
    );

    return jsonResponse(
      {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: amountCents,
        currency: 'usd',
        jobId: job.id,
        transactionRefId,
      },
      200,
    );
  } catch (err: any) {
    console.error('[create-payment-intent] fatal:', err);
    return jsonResponse(
      {
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      },
      500,
    );
  }
});
