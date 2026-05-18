// ─────────────────────────────────────────────────────────────────
//  supabase/functions/stripe-connect-webhook/index.ts
//
//  Listens for Stripe Connect lifecycle events and keeps the
//  profiles + transactions tables in sync.
//
//  NX-STRIPE-002 strike (claim-then-process):
//    Replaces the legacy "insert-then-do" idempotency ledger pattern
//    with the claim_stripe_webhook_event lifecycle introduced in
//    migration 20260517120000. A handler failure now RELEASES the row
//    so Stripe's retry actually re-runs the handler instead of
//    short-circuiting on a 23505 unique_violation.
//
//  NX-STRIPE-005 strike (silent-failure plug):
//    The legacy payout.failed / payout.paid handlers ignored errors
//    from the supabase UPDATE on transactions and from the
//    restore_wallet_balance RPC. If either failed, the handler still
//    returned 200 — the inspector's wallet was never restored and the
//    audit trail showed nothing. Both calls now check the error and
//    surface failure via release-for-retry.
//
//  Configure in Stripe Dashboard → Developers → Webhooks (Connect):
//    Endpoint URL:
//      https://<project-ref>.supabase.co/functions/v1/stripe-connect-webhook
//    Events to listen for:
//      - account.updated
//      - account.application.deauthorized
//      - payout.paid
//      - payout.failed
//    Then copy the signing secret into the Edge Function env var
//      STRIPE_CONNECT_WEBHOOK_SECRET
// ─────────────────────────────────────────────────────────────────

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});
const webhookSecret = Deno.env.get('STRIPE_CONNECT_WEBHOOK_SECRET')!;
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

function computeStatus(account: Stripe.Account):
  | 'pending'
  | 'verified'
  | 'restricted' {
  if (account.requirements?.disabled_reason) return 'restricted';
  if (
    account.charges_enabled &&
    account.payouts_enabled &&
    account.details_submitted
  ) {
    return 'verified';
  }
  return 'pending';
}

/** NX-STRIPE-002: release the claim and return 500 so Stripe retries. */
async function releaseAnd500(eventId: string, reason: string): Promise<Response> {
  const { error } = await supabase.rpc('release_stripe_webhook_event', {
    p_event_id: eventId,
    p_error: reason,
  });
  if (error) {
    console.error(
      '[stripe-connect-webhook] FAILED to release event for retry:',
      error.message,
    );
  }
  return new Response(reason, { status: 500 });
}

/** NX-STRIPE-002: mark the claim done and return 200. */
async function completeAnd200(eventId: string, body = 'ok'): Promise<Response> {
  const { error } = await supabase.rpc('complete_stripe_webhook_event', {
    p_event_id: eventId,
  });
  if (error) {
    console.error(
      '[stripe-connect-webhook] FAILED to complete event:',
      error.message,
    );
    return new Response('completion write failed', { status: 500 });
  }
  return new Response(body, { status: 200 });
}

Deno.serve(async (req) => {
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
    console.error('[stripe-connect-webhook] signature verification failed:', err.message);
    return new Response(`Bad signature: ${err.message}`, { status: 400 });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  NX-STRIPE-002: Claim the event BEFORE running the handler.
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
      '[stripe-connect-webhook] claim RPC failed:',
      claimErr.message,
    );
    return new Response('Claim RPC failed', { status: 500 });
  }

  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim) {
    return new Response('Claim returned no row', { status: 500 });
  }

  if (!claim.claimed) {
    console.log(
      `[stripe-connect-webhook] skipping event ${event.id} (${event.type}): ${claim.reason}`,
    );
    return new Response(`skipped: ${claim.reason}`, { status: 200 });
  }

  try {
    switch (event.type) {
      // ── Onboarding state changes ───────────────────────────────
      case 'account.updated': {
        const account = event.data.object as Stripe.Account;
        const status = computeStatus(account);

        const updates: Record<string, unknown> = {
          stripe_connect_status: status,
          stripe_connect_payouts_enabled: !!account.payouts_enabled,
        };
        if (status === 'verified') {
          updates.stripe_connect_onboarded_at = new Date().toISOString();
        }

        const { error } = await supabase
          .from('profiles')
          .update(updates)
          .eq('stripe_connect_id', account.id);

        if (error) {
          console.error('[stripe-connect-webhook] account.updated DB sync failed:', error);
          return releaseAnd500(event.id, `account.updated DB sync failed: ${error.message}`);
        }
        return completeAnd200(event.id);
      }

      // ── User revoked the platform's access ─────────────────────
      case 'account.application.deauthorized': {
        const account = event.data.object as Stripe.Account;
        // NX-STRIPE-005: capture error from the update.
        const { error } = await supabase
          .from('profiles')
          .update({
            stripe_connect_status: 'disabled',
            stripe_connect_payouts_enabled: false,
          })
          .eq('stripe_connect_id', account.id);
        if (error) {
          console.error(
            '[stripe-connect-webhook] deauthorized profile update failed:',
            error.message,
          );
          return releaseAnd500(event.id, `deauthorized update failed: ${error.message}`);
        }
        return completeAnd200(event.id);
      }

      // ── Payout settled (or failed) — close the transaction ─────
      case 'payout.paid':
      case 'payout.failed': {
        const payout = event.data.object as Stripe.Payout;
        const transactionId = payout.metadata?.transaction_id;
        const userId = payout.metadata?.user_id;
        if (!transactionId) {
          // No metadata → orphan. Complete and 200 (Stripe stops retrying).
          console.warn(
            `[stripe-connect-webhook] ${event.type} payout=${payout.id} has no transaction_id metadata — completing as orphan`,
          );
          return completeAnd200(event.id, 'orphan: no transaction_id');
        }

        const newStatus = event.type === 'payout.paid' ? 'completed' : 'failed';

        // NX-STRIPE-005: capture the update error. The legacy code
        // discarded this; a transient DB error would silently leave the
        // transaction stale.
        const { error: txnErr } = await supabase
          .from('transactions')
          .update({ status: newStatus })
          .eq('id', transactionId);

        if (txnErr) {
          console.error(
            '[stripe-connect-webhook] transaction status update failed:',
            txnErr.message,
          );
          return releaseAnd500(event.id, `transaction update failed: ${txnErr.message}`);
        }

        // If the payout failed AFTER we debited the wallet, restore the
        // funds so the inspector isn't left short.
        if (event.type === 'payout.failed' && userId) {
          // NX-STRIPE-005: capture the RPC error. Inspector loses real
          // money if this fails silently — release the claim so the
          // retry can re-credit them.
          const { error: restoreErr } = await supabase.rpc('restore_wallet_balance', {
            p_user_id: userId,
            p_amount_cents: payout.amount,
          });
          if (restoreErr) {
            console.error(
              '[stripe-connect-webhook] restore_wallet_balance RPC failed:',
              restoreErr.message,
            );
            // Critical: money was debited from wallet, payout failed at
            // Stripe, and now we couldn't credit the wallet back. The
            // release-and-retry path is the inspector's recovery.
            return releaseAnd500(
              event.id,
              `restore_wallet_balance failed for user ${userId}: ${restoreErr.message}`,
            );
          }
        }
        return completeAnd200(event.id);
      }

      default:
        // Unhandled event types are fine — Stripe sends many.
        return completeAnd200(event.id, 'ignored event type');
    }
  } catch (err: any) {
    console.error('[stripe-connect-webhook] handler error:', err);
    return releaseAnd500(event.id, `handler exception: ${err?.message ?? 'unknown'}`);
  }
});
