// ─────────────────────────────────────────────────────────────────
//  supabase/functions/sync-stripe-connect-status/index.ts
//
//  On-demand status sync. Pulls the live account state from Stripe
//  and writes it into profiles. Used as a belt-and-braces companion
//  to the webhook — useful in three scenarios:
//
//    1. Webhook isn't yet configured (dev / first deploy)
//    2. Webhook is configured but a specific event was missed
//       (Stripe retries failed deliveries but they aren't guaranteed
//       to arrive in any specific order or timeframe)
//    3. The app wants synchronous confirmation right after the user
//       finishes Stripe onboarding, instead of polling for the
//       webhook to land
//
//  Called by the frontend right after WebBrowser.openAuthSessionAsync
//  returns from Stripe onboarding.
// ─────────────────────────────────────────────────────────────────

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
});

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ★ Auth (Phase 2): verify the caller's JWT and force self. Was open → any
    //   caller could read/update ANY user's Connect status via their user_id.
    let user_id: string;
    {
      let callerId: string;
      try {
        callerId = (await requireUser(req)).userId;
      } catch (e) {
        if (e instanceof Response) return e;
        return json({ error: 'auth_failed' }, 401);
      }
      const body = await req.json().catch(() => ({} as Record<string, unknown>));
      if (typeof body?.user_id === 'string' && body.user_id !== callerId) {
        return json({ error: 'forbidden_not_self' }, 403);
      }
      user_id = callerId;
    }

    // Look up the connect id for this user
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('stripe_connect_id')
      .eq('id', user_id)
      .single();

    if (profileErr || !profile?.stripe_connect_id) {
      return json({ error: 'No Stripe Connect account on file' }, 404);
    }

    // Pull fresh account state from Stripe
    const account = await stripe.accounts.retrieve(profile.stripe_connect_id);
    const status = computeStatus(account);
    const payoutsEnabled = !!account.payouts_enabled;

    const updates: Record<string, unknown> = {
      stripe_connect_status: status,
      stripe_connect_payouts_enabled: payoutsEnabled,
    };
    if (status === 'verified') {
      updates.stripe_connect_onboarded_at = new Date().toISOString();
    }

    const { error: updateErr } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user_id);

    if (updateErr) {
      console.error('[sync-stripe-connect-status] update failed:', updateErr);
      return json({ error: 'Failed to persist status' }, 500);
    }

    return json({
      status,
      payouts_enabled: payoutsEnabled,
      charges_enabled: !!account.charges_enabled,
      details_submitted: !!account.details_submitted,
      requirements_disabled_reason:
        account.requirements?.disabled_reason ?? null,
    });
  } catch (err: any) {
    console.error('[sync-stripe-connect-status] error:', err);
    return json({ error: err?.message ?? 'Unknown error' }, 500);
  }
});
