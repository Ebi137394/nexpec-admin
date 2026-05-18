-- ============================================================================
--  20260517130000_release_milestone_payment_rpc.sql  —  INTENTIONALLY NO-OP
--
--  STATUS: DEFERRED until business intent is clarified.
--
--  WHY:
--    The original plan for this migration was a SECURITY DEFINER RPC
--    release_milestone_payment() that the release-payment Edge Function
--    would call. Authoring required mapping milestone fields into the
--    `payments` table.
--
--    A live-schema diagnostic (information_schema.columns) revealed:
--
--      public.payments columns:
--        id, project_id, client_id, description, amount, status,
--        due_date, created_at, paid_at
--
--    Six of the columns the legacy release-payment Edge Function writes
--    to do NOT exist on this table:
--        milestone_id, payment_method, reference_number, paid_by,
--        notes, currency
--
--    Conversely, the live table has three NOT NULL columns the legacy
--    code never populates:
--        client_id, description, due_date
--
--    Net: the legacy release-payment Edge Function has been erroring out
--    on its first DB write on every call. NX-STRIPE-003 was not a
--    "ledger says paid, money didn't move" hazard — it was a feature
--    that has never reached production functionality. There is no money
--    at risk and no double-pay surface here.
--
--    The `payments` schema (client_id + description + due_date) does not
--    look like the inspector-payout schema we'd want for a milestone
--    payout RPC; it reads more like an invoice / accounts-receivable
--    model from a different feature track. Authoring an RPC against it
--    without knowing the business intent would invent semantics — which
--    is exactly what Mandate Rule 5 forbids.
--
--  WHAT THE PAIRED EDGE FUNCTION DOES INSTEAD:
--    The release-payment Edge Function now returns 501 NOT_IMPLEMENTED
--    with a clear message pointing at process-payout (the working
--    Stripe-Connect payout flow). NX-STRIPE-003 is closed by REMOVING
--    the unreachable code path rather than wiring it.
--
--  WHEN THIS MIGRATION GETS WRITTEN:
--    Bring the following decisions back, and this migration becomes a
--    proper SECURITY DEFINER RPC:
--      1. What is the milestone-payout business flow? (Inspector? Vendor?)
--      2. Is the `payments` table the correct target, or should milestone
--         payouts flow through transactions / inspector_earnings / a new
--         dedicated table?
--      3. What does `payments.client_id` semantically reference? The
--         payer? The payee? An organization client?
--      4. Should automated Stripe payouts be plumbed through this RPC, or
--         should milestone-payouts always go through process-payout?
--
--  This file is intentionally a no-op so the migration sequence is
--  contiguous and the deferral is documented in source control. Running
--  it is safe and changes nothing.
-- ============================================================================

BEGIN;

-- Document the deferral in a comment on the schema so future operators
-- find it via \d in psql or the Supabase Database UI.
COMMENT ON SCHEMA public IS
  COALESCE(
    pg_catalog.obj_description('public'::regnamespace, 'pg_namespace'),
    ''
  );  -- no-op; placeholder so the BEGIN/COMMIT has at least one statement

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================
--  No verification required — this migration is a documented no-op.
-- ============================================================================
