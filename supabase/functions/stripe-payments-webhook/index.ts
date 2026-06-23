// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/stripe-payments-webhook/index.ts
//  NEXPEC — STRIPE-005 strike: payment_intent.* webhook handler.
//
//  NX-STRIPE-002 strike (claim-then-process):
//    The legacy flow inserted the event row into stripe_webhook_events
//    BEFORE running the handler. If the handler failed, the row was
//    already there — Stripe's retry short-circuited on the 23505 unique
//    violation, the handler NEVER re-executed, and the event stayed
//    silently orphaned.
//
//    The new flow uses three SECURITY DEFINER RPCs (migration
//    20260517120000):
//        claim_stripe_webhook_event(event_id, type, payload)
//           Atomic INSERT OR reclaim. Returns claimed=true when this
//           worker may execute the handler.
//        complete_stripe_webhook_event(event_id)
//           Mark the row 'completed' after the handler body finishes.
//        release_stripe_webhook_event(event_id, error)
//           Mark 'failed_retryable' and clear the claim so Stripe-side
//           retries can re-claim.
//
//  Background
//  ──────────
//  create-payment-intent (STRIPE-003/004) now mints PaymentIntents with
//  metadata.job_id and a server-trusted amount. This webhook closes the
//  loop: payment_intent.succeeded advances the job to completed via the
//  stripe_complete_job RPC; payment_intent.payment_failed and
//  charge.dispute.created write audit_events.
//
//  Configure in Stripe Dashboard → Developers → Webhooks (account-level,
//  NOT Connect — this is the platform's own payments):
//    Endpoint URL:
//      https://<project-ref>.supabase.co/functions/v1/stripe-payments-webhook
//    Events to listen for:
//      - payment_intent.succeeded
//      - payment_intent.payment_failed
//      - charge.dispute.created
//    Signing secret → set as env var:
//      STRIPE_PAYMENTS_WEBHOOK_SECRET
//    (Distinct from STRIPE_CONNECT_WEBHOOK_SECRET; do NOT reuse.)
//
//  Guarantees
//  ──────────
//    1. Stripe signature verified before any work (constructEventAsync).
//    2. Idempotency + retry-safety via the claim_stripe_webhook_event
//       lifecycle (NX-STRIPE-002). A failed handler RELEASES the row so
//       Stripe's next retry can re-claim and re-execute.
//    3. Business-level completion goes through the
//       `stripe_complete_job` RPC — SECURITY DEFINER, FOR UPDATE lock,
//       audit-correlated. The webhook is dumb glue; the RPC owns state.
//    4. Failures/disputes raise critical audit_events. No silent drops.
// ════════════════════════════════════════════════════════════════════════════

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// ─── Clients ───────────────────────────────────────────────────────────────
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get('STRIPE_PAYMENTS_WEBHOOK_SECRET')!;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ─── Helpers ───────────────────────────────────────────────────────────────
function isValidUUID(s: unknown): s is string {
  return (
    typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s,
    )
  );
}

interface PaymentIntentMetadata {
  kind?: string;
  job_id?: string;
  agreement_id?: string;
  deal_id?: string;
  client_id?: string;
  agency_id?: string;
  contractor_id?: string;
  user_id?: string;
  transaction_ref_id?: string;
  platform?: string;
}

/**
 * Writes a critical audit_event when a webhook can't follow through to
 * the RPC (missing/invalid metadata, RPC failure, etc.).
 */
async function logOrphanAuditEvent(
  eventId: string,
  eventType: string,
  summary: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from('audit_events').insert({
    event_type: 'stripe.webhook_orphan',
    severity: 'critical',
    actor_id: null,
    actor_role: 'system',
    actor_label: 'Stripe payments webhook',
    subject_table: 'jobs',
    subject_id: '00000000-0000-0000-0000-000000000000',
    job_id: null,
    summary,
    delta: {},
    metadata: {
      stripe_event_id: eventId,
      stripe_event_type: eventType,
      ...metadata,
    },
  });
  if (error) {
    console.error(
      '[stripe-payments-webhook] FAILED to write orphan audit event:',
      error.message,
    );
  }
}

/** NX-STRIPE-002: helper that releases the claim and returns a 500. */
async function releaseAnd500(eventId: string, reason: string): Promise<Response> {
  const { error } = await supabase.rpc('release_stripe_webhook_event', {
    p_event_id: eventId,
    p_error: reason,
  });
  if (error) {
    console.error(
      '[stripe-payments-webhook] FAILED to release event for retry:',
      error.message,
    );
  }
  return new Response(reason, { status: 500 });
}

/** NX-STRIPE-002: helper that completes the claim and returns a 200. */
async function completeAnd200(eventId: string, body = 'ok'): Promise<Response> {
  const { error } = await supabase.rpc('complete_stripe_webhook_event', {
    p_event_id: eventId,
  });
  if (error) {
    console.error(
      '[stripe-payments-webhook] FAILED to complete event:',
      error.message,
    );
    // Best-effort: if we can't write the completion stamp, return 500 so
    // Stripe retries; the next claim will reclaim or short-circuit on
    // 'already_completed' depending on whether this race finishes first.
    return new Response('completion write failed', { status: 500 });
  }
  return new Response(body, { status: 200 });
}

// ─── Handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
    );
  } catch (err: any) {
    console.error(
      '[stripe-payments-webhook] signature verification failed:',
      err.message,
    );
    return new Response(`Bad signature: ${err.message}`, { status: 400 });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  NX-STRIPE-002: Claim the event BEFORE running the handler.
  //  - newly_claimed   → fresh delivery, this worker handles it.
  //  - reclaimed       → previous handler failed; this is the retry.
  //  - in_flight_elsewhere → another worker has it; return 200 (it'll finish).
  //  - already_completed   → done in a prior delivery; return 200.
  // ════════════════════════════════════════════════════════════════════════
  const { data: claimRows, error: claimErr } = await supabase.rpc(
    'claim_stripe_webhook_event',
    {
      p_event_id: event.id,
      p_type:     event.type,
      p_payload:  event as unknown as Record<string, unknown>,
    },
  );

  if (claimErr) {
    console.error(
      '[stripe-payments-webhook] claim RPC failed:',
      claimErr.message,
    );
    return new Response('Claim RPC failed', { status: 500 });
  }

  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim) {
    return new Response('Claim returned no row', { status: 500 });
  }

  if (!claim.claimed) {
    // Reason in {'in_flight_elsewhere','already_completed','unknown_status'}.
    // Both 'in_flight_elsewhere' and 'already_completed' are "Stripe, stop
    // retrying" — return 200.
    console.log(
      `[stripe-payments-webhook] skipping event ${event.id} (${event.type}): ${claim.reason}`,
    );
    return new Response(`skipped: ${claim.reason}`, { status: 200 });
  }

  // We hold the claim. From here on, every exit path MUST either
  // complete (success) or release (failure / retry).
  try {
    switch (event.type) {
      // ── Successful capture ─────────────────────────────────────────
      case 'payment_intent.succeeded': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const md = (pi.metadata ?? {}) as PaymentIntentMetadata;

        // ── WALLET-DEPOSIT-001 branch ───────────────────────────────
        if (md.kind === 'wallet_topup') {
          if (!isValidUUID(md.user_id)) {
            await logOrphanAuditEvent(
              event.id, event.type,
              `wallet_topup payment_intent.succeeded with missing/invalid user_id (pi=${pi.id})`,
              { payment_intent_id: pi.id, amount_received: pi.amount_received, metadata: md },
            );
            return completeAnd200(event.id, 'orphan logged');
          }
          if (!isValidUUID(md.transaction_ref_id)) {
            await logOrphanAuditEvent(
              event.id, event.type,
              `wallet_topup payment_intent.succeeded with missing/invalid transaction_ref_id (pi=${pi.id} user=${md.user_id})`,
              { payment_intent_id: pi.id, user_id: md.user_id, amount_received: pi.amount_received, metadata: md },
            );
            return completeAnd200(event.id, 'orphan logged');
          }

          const amountHalalas = Number(pi.amount_received ?? pi.amount);
          if (!Number.isFinite(amountHalalas) || amountHalalas <= 0) {
            await logOrphanAuditEvent(
              event.id, event.type,
              `wallet_topup with non-positive amount (pi=${pi.id})`,
              { payment_intent_id: pi.id, user_id: md.user_id, amount: pi.amount, amount_received: pi.amount_received },
            );
            return completeAnd200(event.id, 'orphan logged');
          }

          const { data: rpcResult, error: rpcErr } = await supabase.rpc(
            'wallet_credit_topup',
            {
              p_user_id: md.user_id,
              p_amount_halalas: amountHalalas,
              p_stripe_payment_intent_id: pi.id,
              p_transaction_ref_id: md.transaction_ref_id,
              p_correlation_id: null,
            },
          );

          if (rpcErr) {
            console.error(
              '[stripe-payments-webhook] wallet_credit_topup RPC error:',
              rpcErr.message,
            );
            await logOrphanAuditEvent(
              event.id, event.type,
              `wallet_credit_topup RPC failed for user ${md.user_id}: ${rpcErr.message}`,
              {
                payment_intent_id: pi.id,
                user_id: md.user_id,
                amount_halalas: amountHalalas,
                rpc_error: rpcErr.message,
                rpc_code: (rpcErr as any).code ?? null,
              },
            );
            // NX-STRIPE-002: release the claim so Stripe's retry re-claims.
            return releaseAnd500(event.id, `wallet_credit_topup RPC failed: ${rpcErr.message}`);
          }

          console.log(
            `[stripe-payments-webhook] wallet_credit_topup ok — pi=${pi.id} user=${md.user_id} amount_halalas=${amountHalalas} result=${JSON.stringify(rpcResult)}`,
          );
          return completeAnd200(event.id);
        }

        // ── NAMED-DISCLOSURE branch (named-disclosure-stripe) ───────
        // Premium fee for early inspector-identity disclosure. Settling it
        // flips the vip_disclosure_fee leg to 'held', upgrades the deal to the
        // 'named' tier, and lifts identity escrow — money-before-benefit.
        if (md.kind === 'named_disclosure_fee') {
          if (!isValidUUID(md.agreement_id)) {
            await logOrphanAuditEvent(
              event.id, event.type,
              `named_disclosure_fee payment_intent.succeeded with missing/invalid agreement_id (pi=${pi.id})`,
              { payment_intent_id: pi.id, amount_received: pi.amount_received, metadata: md },
            );
            return completeAnd200(event.id, 'orphan logged');
          }
          if (!isValidUUID(md.transaction_ref_id)) {
            await logOrphanAuditEvent(
              event.id, event.type,
              `named_disclosure_fee payment_intent.succeeded with missing/invalid transaction_ref_id (pi=${pi.id} agreement=${md.agreement_id})`,
              { payment_intent_id: pi.id, agreement_id: md.agreement_id, amount_received: pi.amount_received, metadata: md },
            );
            return completeAnd200(event.id, 'orphan logged');
          }

          const amountCents = Number(pi.amount_received ?? pi.amount);
          if (!Number.isFinite(amountCents) || amountCents <= 0) {
            await logOrphanAuditEvent(
              event.id, event.type,
              `named_disclosure_fee with non-positive amount (pi=${pi.id})`,
              { payment_intent_id: pi.id, agreement_id: md.agreement_id, amount: pi.amount, amount_received: pi.amount_received },
            );
            return completeAnd200(event.id, 'orphan logged');
          }

          const { data: rpcResult, error: rpcErr } = await supabase.rpc(
            'stripe_settle_named_disclosure',
            {
              p_agreement_id:       md.agreement_id,
              p_payment_intent_id:  pi.id,
              p_amount_cents:       amountCents,
              p_transaction_ref_id: md.transaction_ref_id,
            },
          );

          if (rpcErr) {
            console.error(
              '[stripe-payments-webhook] stripe_settle_named_disclosure RPC error:',
              rpcErr.message,
            );
            await logOrphanAuditEvent(
              event.id, event.type,
              `stripe_settle_named_disclosure RPC failed for agreement ${md.agreement_id}: ${rpcErr.message}`,
              {
                payment_intent_id: pi.id,
                agreement_id: md.agreement_id,
                amount_cents: amountCents,
                rpc_error: rpcErr.message,
                rpc_code: (rpcErr as any).code ?? null,
              },
            );
            return releaseAnd500(event.id, `stripe_settle_named_disclosure RPC failed: ${rpcErr.message}`);
          }

          console.log(
            `[stripe-payments-webhook] stripe_settle_named_disclosure ok — pi=${pi.id} agreement=${md.agreement_id} result=${JSON.stringify(rpcResult)}`,
          );
          return completeAnd200(event.id);
        }

        // ── Default: job-payment branch (STRIPE-005) ────────────────
        if (!isValidUUID(md.job_id)) {
          await logOrphanAuditEvent(
            event.id, event.type,
            `payment_intent.succeeded with missing/invalid job_id (pi=${pi.id})`,
            { payment_intent_id: pi.id, amount_received: pi.amount_received, metadata: md },
          );
          return completeAnd200(event.id, 'orphan logged');
        }

        if (!isValidUUID(md.transaction_ref_id)) {
          await logOrphanAuditEvent(
            event.id, event.type,
            `payment_intent.succeeded with missing/invalid transaction_ref_id (pi=${pi.id} job=${md.job_id})`,
            { payment_intent_id: pi.id, job_id: md.job_id, amount_received: pi.amount_received, metadata: md },
          );
          return completeAnd200(event.id, 'orphan logged');
        }

        const amountCents = Number(pi.amount_received ?? pi.amount);
        if (!Number.isFinite(amountCents) || amountCents <= 0) {
          await logOrphanAuditEvent(
            event.id, event.type,
            `payment_intent.succeeded with non-positive amount (pi=${pi.id})`,
            { payment_intent_id: pi.id, job_id: md.job_id, amount: pi.amount, amount_received: pi.amount_received },
          );
          return completeAnd200(event.id, 'orphan logged');
        }

        const { data: rpcResult, error: rpcErr } = await supabase.rpc(
          'stripe_complete_job',
          {
            p_job_id:             md.job_id,
            p_payment_intent_id:  pi.id,
            p_amount_cents:       amountCents,
            p_transaction_ref_id: md.transaction_ref_id,
            p_correlation_id:     null,
          },
        );

        if (rpcErr) {
          console.error(
            '[stripe-payments-webhook] stripe_complete_job RPC error:',
            rpcErr.message,
          );
          await logOrphanAuditEvent(
            event.id, event.type,
            `stripe_complete_job RPC failed for job ${md.job_id}: ${rpcErr.message}`,
            {
              payment_intent_id: pi.id,
              job_id: md.job_id,
              amount_cents: amountCents,
              rpc_error: rpcErr.message,
              rpc_code: (rpcErr as any).code ?? null,
            },
          );
          // NX-STRIPE-002: release the claim so Stripe's retry re-claims.
          return releaseAnd500(event.id, `stripe_complete_job RPC failed: ${rpcErr.message}`);
        }

        console.log(
          `[stripe-payments-webhook] stripe_complete_job ok — pi=${pi.id} job=${md.job_id} result=${JSON.stringify(rpcResult)}`,
        );
        return completeAnd200(event.id);
      }

      // ── Failed capture: record it, no state change required ────────
      case 'payment_intent.payment_failed': {
        const pi = event.data.object as Stripe.PaymentIntent;
        const md = (pi.metadata ?? {}) as PaymentIntentMetadata;

        if (!isValidUUID(md.job_id)) {
          await logOrphanAuditEvent(
            event.id, event.type,
            `payment_intent.payment_failed with missing/invalid job_id (pi=${pi.id})`,
            { payment_intent_id: pi.id, last_payment_error: pi.last_payment_error ?? null, metadata: md },
          );
          return completeAnd200(event.id, 'orphan logged');
        }

        const { error } = await supabase.from('audit_events').insert({
          event_type: 'job.payment_failed',
          severity: 'warning',
          actor_id: null,
          actor_role: 'system',
          actor_label: 'Stripe payments webhook',
          subject_table: 'jobs',
          subject_id: md.job_id,
          job_id: md.job_id,
          summary: 'Payment attempt failed: ' + (pi.last_payment_error?.message ?? 'unknown reason'),
          delta: {},
          metadata: {
            intent: 'Stripe payment failed (pi=' + pi.id + ')',
            payment_intent_id: pi.id,
            transaction_ref_id: md.transaction_ref_id ?? null,
            amount_cents: Number(pi.amount ?? 0),
            stripe_decline_code: pi.last_payment_error?.decline_code ?? null,
            stripe_error_code: pi.last_payment_error?.code ?? null,
          },
        });
        if (error) {
          console.error(
            '[stripe-payments-webhook] payment_failed audit insert failed:',
            error.message,
          );
          // NX-STRIPE-002: release the claim so Stripe's retry re-claims.
          return releaseAnd500(event.id, `audit insert failed: ${error.message}`);
        }
        return completeAnd200(event.id);
      }

      // ── Dispute opened ─────────────────────────────────────────────
      case 'charge.dispute.created': {
        const dispute = event.data.object as Stripe.Dispute;
        const paymentIntentId =
          typeof dispute.payment_intent === 'string'
            ? dispute.payment_intent
            : dispute.payment_intent?.id ?? null;

        let jobId: string | null = null;
        let txnRef: string | null = null;
        if (paymentIntentId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
            const md = (pi.metadata ?? {}) as PaymentIntentMetadata;
            jobId = isValidUUID(md.job_id) ? md.job_id : null;
            txnRef = isValidUUID(md.transaction_ref_id) ? md.transaction_ref_id : null;
          } catch (e: any) {
            console.error(
              '[stripe-payments-webhook] dispute PI lookup failed:',
              e?.message,
            );
          }
        }

        if (!jobId) {
          await logOrphanAuditEvent(
            event.id, event.type,
            `Dispute opened but no job_id resolvable (dispute=${dispute.id}, pi=${paymentIntentId ?? 'none'})`,
            {
              dispute_id: dispute.id,
              payment_intent_id: paymentIntentId,
              amount: dispute.amount,
              reason: dispute.reason,
              status: dispute.status,
            },
          );
          return completeAnd200(event.id, 'orphan logged');
        }

        const { error } = await supabase.from('audit_events').insert({
          event_type: 'job.payment_disputed',
          severity: 'critical',
          actor_id: null,
          actor_role: 'system',
          actor_label: 'Stripe payments webhook',
          subject_table: 'jobs',
          subject_id: jobId,
          job_id: jobId,
          summary: 'Charge dispute opened: ' + (dispute.reason ?? 'unspecified') + ' (status=' + dispute.status + ')',
          delta: {},
          metadata: {
            intent: 'Stripe dispute opened (dispute=' + dispute.id + ')',
            dispute_id: dispute.id,
            payment_intent_id: paymentIntentId,
            transaction_ref_id: txnRef,
            amount_cents: Number(dispute.amount ?? 0),
            reason: dispute.reason ?? null,
            status: dispute.status ?? null,
            evidence_due_by: dispute.evidence_details?.due_by ?? null,
          },
        });
        if (error) {
          console.error(
            '[stripe-payments-webhook] dispute audit insert failed:',
            error.message,
          );
          // NX-STRIPE-002: release the claim so Stripe's retry re-claims.
          return releaseAnd500(event.id, `audit insert failed: ${error.message}`);
        }
        return completeAnd200(event.id);
      }

      default:
        // Unhandled types: complete with no-op so we don't re-claim.
        console.log(
          `[stripe-payments-webhook] ignoring event type ${event.type} (id=${event.id})`,
        );
        return completeAnd200(event.id, 'ignored event type');
    }
  } catch (err: any) {
    // Any uncaught exception → release the claim so Stripe retries.
    console.error('[stripe-payments-webhook] handler error:', err);
    return releaseAnd500(event.id, `handler exception: ${err?.message ?? 'unknown'}`);
  }
});
