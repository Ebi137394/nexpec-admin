// ════════════════════════════════════════════════════════════════════════════
//  reconcile-ledger — Treasury reconciliation (layer 2: Stripe ↔ ledger).
//
//  Pulls the REAL Stripe balance (available + pending, in cents) and records a
//  reconciliation run comparing it to NEXPEC's internal custodial liabilities
//  (wallets + supplier_earnings + platform_wallet) via record_reconciliation_run.
//  A shortfall (Stripe < liabilities) is the alarm; it also writes an
//  audit_events row.
//
//  Auth — two paths:
//    • scheduled cron: header  x-cron-secret: <RECON_CRON_SECRET>  → source=scheduled
//    • admin "Run now": Authorization: Bearer <admin JWT>          → source=manual
//  Either way the DB write goes through service_role; record_reconciliation_run
//  permits service_role (auth.uid() NULL) + admin users, and denies everyone else.
//
//  Env: STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//       SUPABASE_ANON_KEY (for requireUser), RECON_CRON_SECRET (optional).
// ════════════════════════════════════════════════════════════════════════════

import { corsHeaders, json, requireUser, getStripe, serviceClient } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const svc = serviceClient();

  // ── Authorize: cron secret OR admin user ───────────────────────────────────
  let source: 'scheduled' | 'manual';
  const cronSecret = Deno.env.get('RECON_CRON_SECRET');
  const providedSecret = req.headers.get('x-cron-secret');

  if (cronSecret && providedSecret && providedSecret === cronSecret) {
    source = 'scheduled';
  } else {
    let caller: { userId: string };
    try {
      caller = await requireUser(req); // throws a 401 Response if no/invalid token
    } catch (resp) {
      return resp instanceof Response ? resp : json(401, { error: 'unauthorized' });
    }
    const { data: prof } = await svc
      .from('profiles').select('role').eq('id', caller.userId).maybeSingle();
    const role = (prof as { role?: string } | null)?.role;
    if (role !== 'admin' && role !== 'super_admin') {
      return json(403, { error: 'admin_only' });
    }
    source = 'manual';
  }

  // ── 1. Real Stripe balance (available + pending), in minor units (cents) ────
  let stripeBalanceCents: number | null = null;
  let stripeError: string | null = null;
  try {
    const stripe = getStripe();
    const bal = await stripe.balance.retrieve();
    const sum = (arr: Array<{ amount: number }> | undefined) =>
      (arr ?? []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    stripeBalanceCents = sum(bal.available) + sum(bal.pending);
  } catch (e) {
    stripeError = e instanceof Error ? e.message : String(e);
    // Fall through: record a snapshot-only run so the failure is itself logged.
  }

  // ── 2. Record the run (snapshot + drift) via the SECURITY DEFINER RPC ───────
  const { data: run, error } = await svc.rpc('record_reconciliation_run', {
    p_source: source,
    p_stripe_balance_cents: stripeBalanceCents,
  });
  if (error) return json(500, { error: error.message, stripe_error: stripeError });

  // ── 3. Alarm on shortfall ───────────────────────────────────────────────────
  if (run?.status === 'shortfall') {
    await svc.from('audit_events').insert({
      event_type: 'treasury.reconciliation_shortfall',
      severity: 'critical',
      actor_id: null,
      actor_role: 'system',
      actor_label: 'reconcile-ledger',
      subject_table: 'reconciliation_runs',
      subject_id: run.run_id,
      summary: `Treasury shortfall: Stripe holds ${run.drift_cents}c less than liabilities (${run.liabilities_cents}c owed).`,
      delta: {},
      metadata: {
        drift_cents: run.drift_cents,
        liabilities_cents: run.liabilities_cents,
        stripe_balance_cents: stripeBalanceCents,
        source,
      },
    });
  }

  return json(200, { ...run, stripe_balance_cents: stripeBalanceCents, stripe_error: stripeError });
});
