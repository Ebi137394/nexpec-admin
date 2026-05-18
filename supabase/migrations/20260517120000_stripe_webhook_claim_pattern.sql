-- ============================================================================
--  20260517120000_stripe_webhook_claim_pattern.sql
--
--  STRIKE: NX-STRIPE-002 — close the silent partial-failure window in both
--                         webhook handlers.
--
--  WHY (root cause):
--    The legacy flow was "insert-then-do":
--        INSERT stripe_webhook_events ON CONFLICT 23505 → return 200
--        run handler …
--    If the handler failed mid-execution, the ledger row was still in place.
--    Stripe's retry would land on the conflict, short-circuit to 200, and
--    the handler would NEVER re-execute. Money lands in the platform Stripe
--    balance, jobs stay in 'in_progress', wallets never get credited on
--    failed-payout reversal.
--
--  WHAT THIS DOES:
--    Adopts a "claim-then-process" lifecycle with three states on each
--    ledger row:
--        pending           — initial (legacy rows backfilled to 'completed')
--        processing        — a handler has claimed this event
--        completed         — handler finished successfully
--        failed_retryable  — handler raised; the next delivery can re-claim
--
--    Three SECURITY DEFINER RPCs, service_role-only:
--      public.claim_stripe_webhook_event(event_id, type, payload)
--        Atomic. If the row doesn't exist → INSERT with status='processing'
--        and return claimed=true. If it exists in {'pending','failed_retryable'}
--        → UPDATE to 'processing' and return claimed=true (reclaim path).
--        If it exists in 'processing' → return claimed=false 'in_flight_elsewhere'
--        (another worker has it). If it exists in 'completed' → return
--        claimed=false 'already_completed'. Uses FOR UPDATE so concurrent
--        claims serialise; exactly one wins.
--
--      public.complete_stripe_webhook_event(event_id)
--        Mark the row done. Called after the handler body succeeds.
--
--      public.release_stripe_webhook_event(event_id, error)
--        Mark the row 'failed_retryable' and clear claimed_at so Stripe's
--        retry can re-claim. Called on handler failure paths.
--
--  BACKWARD COMPATIBILITY:
--    Existing rows (created under the legacy code path) are backfilled to
--    status='completed' so the new claim flow doesn't re-process them.
--    If any of those were actually orphaned (handler died, money stranded),
--    they remain orphaned — manual reconciliation via the audit_events
--    'stripe.webhook_orphan' rows is the recovery path. From this strike
--    forward, no NEW orphan accrues.
--
--  UP   path: this file.
--  DOWN path: enumerated at the foot. The down path leaves the columns
--             in place (cheap; not worth dropping) and just drops the
--             three RPCs — restoring the legacy path requires the two
--             webhook Edge Function files to be reverted in lockstep.
--
--  Idempotent: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS,
--             CREATE OR REPLACE FUNCTION. Safe to re-run.
-- ============================================================================

BEGIN;

-- ─── Schema additions ───────────────────────────────────────────────────
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS claimed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

-- Lock the status vocabulary.
ALTER TABLE public.stripe_webhook_events
  DROP CONSTRAINT IF EXISTS stripe_webhook_events_status_check;

ALTER TABLE public.stripe_webhook_events
  ADD CONSTRAINT stripe_webhook_events_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed_retryable'));

-- Backfill: every row that existed before this migration was processed
-- under the legacy "insert-then-do" pattern. Mark them 'completed' so
-- the claim flow does not re-run them. The DO block guards against
-- partial re-runs where the ADD COLUMN above wasn't applied first
-- (the live schema of stripe_webhook_events did not have a `status`
-- column prior to this migration). processed_at is stamped to now()
-- because the live schema does not include a created_at column either.
-- Past orphans stay past orphans; recovery via
-- audit_events.stripe.webhook_orphan is unchanged.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'stripe_webhook_events'
       AND column_name  = 'status'
  ) THEN
    UPDATE public.stripe_webhook_events
       SET status = 'completed',
           processed_at = COALESCE(processed_at, now())
     WHERE status = 'pending';
  END IF;
END $$;

-- Operational index: surface stuck claims for the ops dashboard.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_stuck
  ON public.stripe_webhook_events (claimed_at)
  WHERE status = 'processing';

-- ─── RPC 1: claim_stripe_webhook_event ───────────────────────────────────
DROP FUNCTION IF EXISTS public.claim_stripe_webhook_event(text, text, jsonb);

CREATE OR REPLACE FUNCTION public.claim_stripe_webhook_event(
  p_event_id text,
  p_type     text,
  p_payload  jsonb
) RETURNS TABLE (
  claimed boolean,
  reason  text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row_status text;
BEGIN
  -- Fast path: fresh event. INSERT ON CONFLICT DO NOTHING is atomic.
  INSERT INTO public.stripe_webhook_events
    (event_id, type, payload, status, claimed_at)
  VALUES
    (p_event_id, p_type, p_payload, 'processing', now())
  ON CONFLICT (event_id) DO NOTHING;

  IF FOUND THEN
    RETURN QUERY SELECT true, 'newly_claimed'::text;
    RETURN;
  END IF;

  -- Conflict path: row already exists. Lock it before deciding.
  SELECT status
    INTO v_row_status
    FROM public.stripe_webhook_events
   WHERE event_id = p_event_id
   FOR UPDATE;

  IF v_row_status IN ('pending', 'failed_retryable') THEN
    -- Reclaim from a prior failed handler or stale pending.
    UPDATE public.stripe_webhook_events
       SET status     = 'processing',
           claimed_at = now()
     WHERE event_id  = p_event_id;
    RETURN QUERY SELECT true, 'reclaimed'::text;
    RETURN;
  END IF;

  IF v_row_status = 'processing' THEN
    RETURN QUERY SELECT false, 'in_flight_elsewhere'::text;
    RETURN;
  END IF;

  IF v_row_status = 'completed' THEN
    RETURN QUERY SELECT false, 'already_completed'::text;
    RETURN;
  END IF;

  -- Unknown status (should be impossible given the CHECK constraint).
  RETURN QUERY SELECT false, 'unknown_status'::text;
END;
$$;

COMMENT ON FUNCTION public.claim_stripe_webhook_event(text, text, jsonb) IS
  'NX-STRIPE-002: atomic claim for a Stripe webhook event. Returns '
  '(claimed, reason). True means caller may run the handler. False means '
  'another worker has it OR it is already done. The FOR UPDATE serialises '
  'concurrent callers so exactly one wins on a retry race.';

REVOKE EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text, jsonb)
  FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.claim_stripe_webhook_event(text, text, jsonb)
  TO service_role;

-- ─── RPC 2: complete_stripe_webhook_event ────────────────────────────────
DROP FUNCTION IF EXISTS public.complete_stripe_webhook_event(text);

CREATE OR REPLACE FUNCTION public.complete_stripe_webhook_event(p_event_id text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.stripe_webhook_events
     SET status       = 'completed',
         processed_at = now()
   WHERE event_id     = p_event_id;
$$;

COMMENT ON FUNCTION public.complete_stripe_webhook_event(text) IS
  'NX-STRIPE-002: mark a Stripe webhook event row done. Called by the '
  'handler after successful processing.';

REVOKE EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text)
  FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.complete_stripe_webhook_event(text)
  TO service_role;

-- ─── RPC 3: release_stripe_webhook_event ─────────────────────────────────
DROP FUNCTION IF EXISTS public.release_stripe_webhook_event(text, text);

CREATE OR REPLACE FUNCTION public.release_stripe_webhook_event(
  p_event_id text,
  p_error    text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.stripe_webhook_events
     SET status     = 'failed_retryable',
         claimed_at = NULL
   WHERE event_id   = p_event_id;

  -- Best-effort: surface the failure in audit_events for ops visibility.
  -- We DO NOT block on this — if audit_events doesn't exist yet, the
  -- main release still happens.
  BEGIN
    INSERT INTO public.audit_events (
      event_type, severity, actor_id, actor_role, actor_label,
      subject_table, subject_id, summary, delta, metadata
    ) VALUES (
      'stripe.webhook_handler_failed',
      'warning',
      NULL,
      'system',
      'Stripe webhook',
      'stripe_webhook_events',
      '00000000-0000-0000-0000-000000000000',
      'Handler released event for retry: ' || COALESCE(p_error, 'unspecified'),
      '{}'::jsonb,
      jsonb_build_object(
        'stripe_event_id', p_event_id,
        'error', p_error
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- audit_events may not exist or may have shifted shape; do not fail
    -- the release path.
    NULL;
  END;
END;
$$;

COMMENT ON FUNCTION public.release_stripe_webhook_event(text, text) IS
  'NX-STRIPE-002: release a previously claimed event back to '
  'failed_retryable status so Stripe-side retries can re-claim. Called '
  'by the handler when processing raises. Logs a warning audit_event.';

REVOKE EXECUTE ON FUNCTION public.release_stripe_webhook_event(text, text)
  FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.release_stripe_webhook_event(text, text)
  TO service_role;

COMMIT;

-- ============================================================================
-- POST-MIGRATION VERIFICATION
-- ============================================================================
--  -- 1. Schema state.
--  SELECT column_name, data_type, is_nullable, column_default
--    FROM information_schema.columns
--   WHERE table_schema = 'public'
--     AND table_name   = 'stripe_webhook_events'
--     AND column_name IN ('status', 'claimed_at', 'processed_at');
--
--  -- 2. CHECK constraint.
--  SELECT conname, pg_get_constraintdef(oid)
--    FROM pg_constraint
--   WHERE conrelid = 'public.stripe_webhook_events'::regclass
--     AND contype = 'c';
--
--  -- 3. Function privileges (service_role only).
--  SELECT proname, proacl
--    FROM pg_proc
--   WHERE pronamespace = 'public'::regnamespace
--     AND proname IN ('claim_stripe_webhook_event',
--                     'complete_stripe_webhook_event',
--                     'release_stripe_webhook_event');
--
--  -- 4. Fresh-claim functional test (use a fake event_id):
--  SELECT * FROM public.claim_stripe_webhook_event(
--    'evt_test_001', 'test.event', '{"hello":"world"}'::jsonb
--  );
--  -- expect: (claimed=true, reason='newly_claimed')
--
--  -- 5. Re-claim race (same event_id again):
--  SELECT * FROM public.claim_stripe_webhook_event(
--    'evt_test_001', 'test.event', '{}'::jsonb
--  );
--  -- expect: (claimed=false, reason='in_flight_elsewhere')
--
--  -- 6. Complete then re-claim:
--  SELECT public.complete_stripe_webhook_event('evt_test_001');
--  SELECT * FROM public.claim_stripe_webhook_event(
--    'evt_test_001', 'test.event', '{}'::jsonb
--  );
--  -- expect: (claimed=false, reason='already_completed')
--
--  -- 7. Release-and-reclaim:
--  --   Reset to failed_retryable then attempt claim again.
--  SELECT public.release_stripe_webhook_event('evt_test_001', 'forced for test');
--  SELECT * FROM public.claim_stripe_webhook_event(
--    'evt_test_001', 'test.event', '{}'::jsonb
--  );
--  -- expect: (claimed=true, reason='reclaimed')
--
--  -- 8. Clean up:
--  DELETE FROM public.stripe_webhook_events WHERE event_id = 'evt_test_001';
-- ============================================================================

-- ============================================================================
-- DOWN PATH (do not run unless rolling back; both webhook Edge Functions
--            must be reverted to legacy shape in the same deploy)
-- ============================================================================
--  BEGIN;
--    DROP FUNCTION IF EXISTS public.release_stripe_webhook_event(text, text);
--    DROP FUNCTION IF EXISTS public.complete_stripe_webhook_event(text);
--    DROP FUNCTION IF EXISTS public.claim_stripe_webhook_event(text, text, jsonb);
--  COMMIT;
--  -- Columns (status, claimed_at, processed_at) are intentionally LEFT in place.
--  -- They are nullable-equivalent (status has a default) and dropping them
--  -- would force a costly rewrite that is rarely worth it during a rollback.
-- ============================================================================
