// ─────────────────────────────────────────────────────────────────
//  supabase/functions/create-stripe-connect-link/index.ts
//
//  Creates (or reuses) a Stripe Connect Express account for an
//  inspector and returns a short-lived onboarding URL the client
//  opens via expo-web-browser.
//
//  Account country: 'CA' (platform jurisdiction)
//  Currency:        'USD' (all platform money flows in USD)
//  Capability:      transfers (we move money TO them, they don't
//                   process payments themselves)
//
//  First call → creates Express account, persists ID, returns link.
//  Subsequent calls → reuses existing account, returns fresh link
//                     (AccountLinks expire in a few minutes).
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ★ Auth (Phase 2): verify the caller's JWT and force the action onto the
    //   authenticated user. Previously body.user_id was trusted with NO auth →
    //   any caller could mint a Connect onboarding link for ANY user (IDOR).
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

    // ★ Stripe's SDK rejects non-HTTP(S) URLs (e.g. `nexpec://...`) at
    //   the validator BEFORE the API call goes out. So we point Stripe
    //   at our own HTTPS bridge Edge Function, which then JS-redirects
    //   to the deep link the device understands. Constructed server-
    //   side so the client can't spoof these to redirect Stripe traffic
    //   anywhere it pleases.
    const bridgeBase = `${Deno.env.get('SUPABASE_URL')!.replace(/\/$/, '')}/functions/v1/stripe-connect-redirect`;
    const return_url = `${bridgeBase}?to=connect-return`;
    const refresh_url = `${bridgeBase}?to=connect-refresh`;

    // Look up the inspector
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, email, role, stripe_connect_id')
      .eq('id', user_id)
      .single();

    if (profileErr || !profile) {
      return json({ error: 'Profile not found' }, 404);
    }
    // Stripe Connect Express onboarding is identical for inspectors and
    // suppliers — both are paid out from the platform balance to their own
    // connected account. The downstream payout EFs (create-stripe-payout /
    // create-supplier-payout) enforce the role-specific wallet.
    if (profile.role !== 'inspector' && profile.role !== 'supplier') {
      return json({ error: 'Stripe Connect onboarding is for inspectors and suppliers only' }, 403);
    }

    // Step 1 — create the Express account if not already present
    let accountId = profile.stripe_connect_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'CA',
        email: profile.email ?? undefined,
        default_currency: 'usd',
        capabilities: {
          transfers: { requested: true },
        },
        metadata: { user_id },
      });
      accountId = account.id;

      const { error: updateErr } = await supabase
        .from('profiles')
        .update({
          stripe_connect_id: accountId,
          stripe_connect_status: 'pending',
        })
        .eq('id', user_id);

      if (updateErr) {
        console.error('[create-stripe-connect-link] Failed to persist stripe_connect_id', updateErr);
        // Don't fail the whole request — the account exists in Stripe and
        // the next call can still find it via metadata.user_id if needed.
      }
    }

    // Step 2 — generate a fresh AccountLink
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url,
      return_url,
      type: 'account_onboarding',
    });

    return json({ url: accountLink.url, account_id: accountId });
  } catch (err: any) {
    console.error('[create-stripe-connect-link] error:', err);
    return json({ error: err?.message ?? 'Unknown error' }, 500);
  }
});
