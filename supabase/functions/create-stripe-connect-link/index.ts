// ════════════════════════════════════════════════════════════════════════════
//  create-stripe-connect-link — DISABLED THIS RELEASE (NX-STRIPE-005)
//
//  Owner decision 2026-08-21: Stripe is NEXPEC's inbound merchant account
//  ONLY. No Stripe Connect, no connected inspector/supplier accounts, no
//  automatic transfers or payouts, no split payments. Provider payouts are
//  settled manually by the NEXPEC team (bank/Wise) through the existing
//  admin Mark-as-Paid workflow (admin_mark_withdrawal_paid).
//
//  This endpoint used to mint Stripe Connect Express onboarding links. It now
//  refuses exactly like the rest of the payout family (NX-STRIPE-004 pattern
//  in process-payout / create-stripe-payout / create-supplier-payout): the
//  call is audit-logged and answered 403, so any stale client build that
//  still reaches for Connect gets an honest, safe refusal.
//
//  Re-enabling Connect later is a deliberate engineering task, not a flag.
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data: { user } } = await admin.auth.getUser(token);

    if (user) {
      const { data: profile } = await admin
        .from('profiles').select('role, email').eq('id', user.id).single();
      await admin.from('audit_events').insert({
        event_type: 'admin_tool.disabled_endpoint_hit',
        severity: 'warning',
        actor_id: user.id,
        actor_role: profile?.role ?? null,
        actor_label: profile?.email ?? user.id,
        subject_table: 'profiles',
        subject_id: user.id,
        summary:
          'create-stripe-connect-link invoked; Stripe Connect is DISABLED this release (NX-STRIPE-005). Payouts are settled manually via admin_mark_withdrawal_paid.',
        delta: {},
        metadata: { endpoint: 'create-stripe-connect-link', reason: 'manual_payout_model' },
      }).then(() => {}, () => {});
    }

    return json({
      error: 'CONNECT_DISABLED',
      message:
        'Stripe Connect onboarding is not available in this release. Payouts are settled manually by the NEXPEC team after approval — no setup is required.',
    }, 403);
  } catch {
    return json({ error: 'CONNECT_DISABLED' }, 403);
  }
});
