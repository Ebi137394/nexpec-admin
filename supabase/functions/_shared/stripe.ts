// ============================================================================
//  supabase/functions/_shared/stripe.ts
//
//  Stripe-specific shared plumbing. Auth/CORS/JSON live in ./auth.ts (no Stripe
//  dependency) and are re-exported here for convenience.
//
//    • getStripe()     — one pinned client + validated secret-key read.
//    • serviceClient() — service-role Supabase client.
//    • re-exports: corsHeaders, json, requireUser, requireSelf.
// ============================================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=denonext';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export { corsHeaders, json, requireUser, requireSelf } from './auth.ts';
import { json } from './auth.ts';

export function getStripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw json(503, { error: 'payment_service_unconfigured', code: 'NO_STRIPE_KEY' });
  if (!key.startsWith('sk_live_') && !key.startsWith('sk_test_')) {
    throw json(503, { error: 'payment_service_misconfigured', code: 'BAD_STRIPE_KEY' });
  }
  return new Stripe(key, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
