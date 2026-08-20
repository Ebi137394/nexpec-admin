// ════════════════════════════════════════════════════════════════════════════
//  _shared/paymentMode.ts — the release payment posture, read from the DB.
//
//  This release is MANUAL PAYMENT ONLY: NEXPEC settles after the required
//  approvals and no online card payment is created. The Stripe integration
//  stays in the tree for a future release, so the switch must live in data
//  rather than in deleted code:
//
//      platform_settings.online_payments_enabled   (DEFAULT false)
//
//  Every function that could create a Checkout Session, PaymentIntent,
//  SetupIntent or Transfer calls assertOnlinePaymentsEnabled() first and
//  returns 403 while the flag is false. The payout/transfer family is already
//  disabled separately (NX-STRIPE-004); this closes the inbound side.
//
//  Fail CLOSED: any error reading the flag is treated as "disabled". A release
//  that cannot prove payments are enabled must not charge anyone.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const ONLINE_PAYMENTS_DISABLED_CODE = 'ONLINE_PAYMENTS_DISABLED';

export async function onlinePaymentsEnabled(): Promise<boolean> {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return false;
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb.rpc('nx_online_payments_enabled');
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

/** Throws a 403-shaped Response when online payments are off. */
export async function assertOnlinePaymentsEnabled(
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  if (await onlinePaymentsEnabled()) return null;
  return new Response(
    JSON.stringify({
      error: ONLINE_PAYMENTS_DISABLED_CODE,
      message:
        'Online card payments are not enabled in this release. NEXPEC settles this engagement manually after the required approvals.',
    }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
