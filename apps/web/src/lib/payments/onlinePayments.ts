// ════════════════════════════════════════════════════════════════════════════
//  lib/payments/onlinePayments.ts — the single source of truth for whether
//  online card payment is offered to users, on the web.
//
//  Reads platform_settings.online_payments_enabled through the
//  nx_online_payments_enabled() RPC. While it is false, NEXPEC settles
//  engagements manually and NO Stripe-dependent control may be rendered.
//
//  Fail CLOSED: any error is treated as "not offered". A release that cannot
//  prove payments are enabled must not show a payment button — the edge
//  functions refuse those calls anyway (ONLINE_PAYMENTS_DISABLED), and a
//  button whose only outcome is a refusal is a dead end.
//
//  The Stripe integration itself is untouched and stays deployed: flipping the
//  flag re-enables every gated surface with no code change and no store
//  rebuild.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function onlinePaymentsEnabled(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_online_payments_enabled');
    return !error && data === true;
  } catch {
    return false;
  }
}
