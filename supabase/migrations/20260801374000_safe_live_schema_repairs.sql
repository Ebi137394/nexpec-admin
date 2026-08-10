-- ════════════════════════════════════════════════════════════════════════════
--  20260801374000_safe_live_schema_repairs.sql
--
--  The three GENUINELY LIVE, GENUINELY SAFE schema defects. Each repairs an
--  existing function; none changes a business rule; none automates payment.
--
--  ── A CORRECTION FIRST ─────────────────────────────────────────────────────
--  I previously reported that writes to the GENERATED column
--  transactions.net_amount_halalas break live Treasury early-payout funding.
--  THAT WAS WRONG. Migration 20260801140000_fix_generated_net_halalas_insert
--  already repaired all four sites (admin_fund_advance,
--  admin_mark_withdrawal_paid x2, credit_inspector_earning_on_approval); the
--  baseline bodies I found are dead code superseded by it. Treasury is NOT
--  broken. I had inspected the baseline rather than each function's LATEST
--  definition. Liveness is now determined by comparing against the last
--  CREATE OR REPLACE, which is the only correct method in a repo with 120
--  migrations.
--
--  ── 1) create_organization — 23502 on every call ───────────────────────────
--  Omits organizations.slug, which is NOT NULL with UNIQUE constraint
--  organizations_slug_key. No slug generator existed anywhere, so one canonical
--  helper is added: nx_org_slug(). Deterministic base (lowercase,
--  non-alphanumerics collapsed to a single hyphen, trimmed), collision-safe by
--  numeric suffix against the live unique index. Existing organizations are
--  untouched — there is NO backfill, destructive or otherwise.
--
--  ── 2) request_milestone_release — 42703 on every call ─────────────────────
--  Wrote audit_events(event_kind, payload); the real columns are event_type /
--  metadata, and subject_table, subject_id and summary are NOT NULL. Its own
--  duplicate-request guard read the same phantom columns, so the guard never
--  worked either. REQUEST -> ADMIN REVIEW -> MANUAL ACTION is preserved
--  exactly: this records a request, moves no money, and still does not.
--
--  ── 3) wallet_credit_topup — 23502 on every call ───────────────────────────
--  Its transactions INSERT omitted amount and type, both NOT NULL with no
--  default. The unit convention was read off admin_fund_advance, which pairs a
--  numeric(12,2) MAJOR-unit `amount` with minor-unit halalas columns:
--      amount = (p_amount_halalas / 100.0)::numeric(12,2)
--      type   = 'deposit'    (permitted by transactions_type_check)
--  net_amount_halalas is deliberately omitted — it is GENERATED and computes
--  itself. This is a BUYER-INITIATED Stripe deposit; the repair connects it to
--  nothing. Self-tested against coupling to completion/payout paths.
--
--  All three bodies are otherwise reproduced verbatim from their latest
--  definitions (extracted programmatically, substitutions asserted).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Canonical slug helper (new; nothing equivalent existed) ─────────────────
CREATE OR REPLACE FUNCTION public.nx_org_slug(p_name text)
RETURNS text
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'pg_temp'
    AS $slug$
DECLARE
  v_base text;
  v_try  text;
  v_n    int := 1;
BEGIN
  v_base := lower(btrim(coalesce(p_name, '')));
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := regexp_replace(v_base, '(^-+|-+$)', '', 'g');
  v_base := left(NULLIF(v_base, ''), 60);
  IF v_base IS NULL THEN
    v_base := 'org';
  END IF;

  v_try := v_base;
  WHILE EXISTS (SELECT 1 FROM public.organizations o WHERE o.slug = v_try) LOOP
    v_n := v_n + 1;
    v_try := left(v_base, 55) || '-' || v_n::text;
    IF v_n > 10000 THEN
      v_try := left(v_base, 46) || '-' || replace(gen_random_uuid()::text, '-', '');
      EXIT;
    END IF;
  END LOOP;

  RETURN v_try;
END $slug$;

ALTER FUNCTION public.nx_org_slug(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_org_slug(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_org_slug(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_org_slug(text) IS
  'Canonical organization slug: deterministic normalised base, collision-safe against organizations_slug_key by numeric suffix. Added 20260801374000 because create_organization omitted the NOT NULL slug and no generator existed. Performs no backfill.';

-- ── 1) create_organization, repaired ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text, p_kind text DEFAULT 'enterprise'::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $co$
DECLARE
  v_uid  uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := lower(btrim(coalesce(p_kind, 'enterprise')));
  v_slug text;
  v_org  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'Organization name must be 2-120 characters' USING ERRCODE = '22000';
  END IF;
  IF v_kind NOT IN ('enterprise', 'agency') THEN
    v_kind := 'enterprise';
  END IF;

  -- REPAIRED: slug is NOT NULL and UNIQUE; it was never supplied.
  v_slug := public.nx_org_slug(v_name);

  INSERT INTO public.organizations (name, kind, owner_id, is_active, slug)
       VALUES (v_name, v_kind, v_uid, true, v_slug)
    RETURNING id INTO v_org;

  INSERT INTO public.org_members (org_id, user_id, role)
       VALUES (v_org, v_uid, 'owner')
  ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'owner';

  RETURN jsonb_build_object('ok', true, 'org_id', v_org, 'name', v_name,
                            'kind', v_kind, 'slug', v_slug);
END $co$;

ALTER FUNCTION public.create_organization(text, text) OWNER TO postgres;

-- ── 2) request_milestone_release, repaired ──────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."request_milestone_release"("p_job_id" "uuid", "p_amount_cents" bigint DEFAULT NULL::bigint, "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_job       RECORD;
  v_recent    timestamptz;
  v_event_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'request_milestone_release: not authenticated';
  END IF;

  SELECT id, contractor_id, status, title
    INTO v_job
    FROM public.jobs
   WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'request_milestone_release: job not found';
  END IF;
  IF v_job.contractor_id IS NULL OR v_job.contractor_id <> v_uid THEN
    RAISE EXCEPTION 'request_milestone_release: only the assigned inspector may request';
  END IF;
  IF v_job.status NOT IN ('in_progress', 'completed') THEN
    RAISE EXCEPTION 'request_milestone_release: job must be in_progress or completed (got %)', v_job.status;
  END IF;
  IF p_amount_cents IS NOT NULL AND p_amount_cents < 0 THEN
    RAISE EXCEPTION 'request_milestone_release: amount must be non-negative';
  END IF;

  IF to_regclass('public.audit_events') IS NOT NULL THEN
    SELECT MAX(created_at) INTO v_recent
      FROM public.audit_events
     WHERE event_type = 'milestone_release_requested'
       AND metadata->>'job_id'       = p_job_id::text
       AND metadata->>'requested_by' = v_uid::text;
    IF v_recent IS NOT NULL AND v_recent > NOW() - INTERVAL '10 minutes' THEN
      RAISE EXCEPTION 'request_milestone_release: a request is already pending — please wait before retrying';
    END IF;

    INSERT INTO public.audit_events(event_type, actor_id, subject_table,
                                    subject_id, job_id, summary, metadata)
    VALUES (
      'milestone_release_requested',
      v_uid,
      'jobs',
      p_job_id,
      p_job_id,
      'Milestone release requested (awaiting manual admin action)',
      jsonb_build_object(
        'job_id',       p_job_id,
        'job_title',    v_job.title,
        'requested_by', v_uid,
        'amount_cents', p_amount_cents,
        'note',         NULLIF(trim(coalesce(p_note, '')), ''),
        'requested_at', NOW()
      )
    )
    RETURNING id INTO v_event_id;
  END IF;

  BEGIN
    IF to_regprocedure('public.nx_notify_admins(text, text, text, text, uuid)') IS NOT NULL THEN
      PERFORM public.nx_notify_admins(
        'Milestone release requested',
        'An inspector has requested a milestone payout on "' || COALESCE(v_job.title, 'a job') || '". Open the job to review.',
        'milestone_release_requested',
        '/admin/jobs?inspect=' || p_job_id::text,
        p_job_id
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'request_milestone_release: notify_admins failed (non-fatal): %', SQLERRM;
  END;

  RETURN jsonb_build_object(
    'ok',           true,
    'request_id',   v_event_id,
    'job_id',       p_job_id,
    'amount_cents', p_amount_cents,
    'requested_at', NOW()
  );
END
$$;
-- ── 3) wallet_credit_topup, repaired ────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."wallet_credit_topup"("p_user_id" "uuid", "p_amount_halalas" bigint, "p_stripe_payment_intent_id" "text", "p_transaction_ref_id" "uuid", "p_correlation_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_correlation        uuid := COALESCE(p_correlation_id, gen_random_uuid());
  v_already_credited   boolean := false;
  v_new_balance        bigint;
  v_row_exists         boolean;
BEGIN
  -- ── 1. Input validation ─────────────────────────────────────────
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_amount_halalas IS NULL OR p_amount_halalas <= 0 THEN
    RAISE EXCEPTION 'amount_halalas must be positive' USING ERRCODE = '22000';
  END IF;
  IF p_amount_halalas > 1000000 THEN
    RAISE EXCEPTION 'amount_halalas exceeds per-topup cap (1,000,000)'
      USING ERRCODE = '22000';
  END IF;
  IF p_stripe_payment_intent_id IS NULL
     OR length(trim(p_stripe_payment_intent_id)) = 0 THEN
    RAISE EXCEPTION 'stripe_payment_intent_id is required' USING ERRCODE = '22000';
  END IF;
  IF p_transaction_ref_id IS NULL THEN
    RAISE EXCEPTION 'transaction_ref_id is required' USING ERRCODE = '22000';
  END IF;

  -- ── 2. Idempotency check ────────────────────────────────────────
  IF EXISTS (
    SELECT 1 FROM public.transactions
    WHERE description = ('wallet_topup:' || p_stripe_payment_intent_id)
  ) THEN
    v_already_credited := true;

    -- ★ DRIFT FIX: read by user_id, not inspector_id.
    SELECT available_balance_halalas
      INTO v_new_balance
      FROM public.inspector_earnings
     WHERE user_id = p_user_id;

    PERFORM public.audit_set_correlation(v_correlation);
    PERFORM public.audit_set_intent(
      'Wallet top-up duplicate (pi=' || p_stripe_payment_intent_id || ')'
    );
    INSERT INTO public.audit_events (
      event_type, severity,
      actor_id, actor_role, actor_label,
      subject_table, subject_id, job_id,
      summary, delta, metadata, correlation_id
    ) VALUES (
      'wallet.topup_duplicate',
      'info',
      NULL, 'system', 'Stripe webhook (wallet topup)',
      'profiles', p_user_id, NULL,
      'Wallet top-up duplicate event received — no double credit',
      '{}'::jsonb,
      jsonb_build_object(
        'user_id', p_user_id,
        'payment_intent_id', p_stripe_payment_intent_id,
        'transaction_ref_id', p_transaction_ref_id,
        'amount_halalas', p_amount_halalas
      ),
      v_correlation
    );

    RETURN jsonb_build_object(
      'ok', true,
      'user_id', p_user_id,
      'amount_halalas', p_amount_halalas,
      'already_credited', true,
      'new_balance_halalas', v_new_balance,
      'correlation_id', v_correlation
    );
  END IF;

  -- ── 3. Ensure the inspector_earnings row exists ─────────────────
  -- ★ DRIFT FIX: replaced the ON CONFLICT (inspector_id) UPSERT with a
  --   defensive NOT-EXISTS pattern. ON CONFLICT requires a unique
  --   constraint on the target column; we don't have a confirmed
  --   UNIQUE on user_id in the live schema (the on-disk migration only
  --   declares a non-unique index). The NOT EXISTS pattern works
  --   regardless and is safe under the SECURITY DEFINER scope.
  SELECT EXISTS (
    SELECT 1 FROM public.inspector_earnings WHERE user_id = p_user_id
  ) INTO v_row_exists;

  IF NOT v_row_exists THEN
    INSERT INTO public.inspector_earnings (
      user_id, available_balance_halalas, total_earned_halalas
    )
    VALUES (p_user_id, 0, 0);
  END IF;

  -- ── 4. Credit the wallet ────────────────────────────────────────
  PERFORM public.audit_set_correlation(v_correlation);
  PERFORM public.audit_set_intent(
    'Wallet top-up credited (pi=' || p_stripe_payment_intent_id || ')'
  );

  UPDATE public.inspector_earnings
     SET available_balance_halalas = available_balance_halalas + p_amount_halalas,
         updated_at = now()
   WHERE user_id = p_user_id
  RETURNING available_balance_halalas INTO v_new_balance;

  -- Note: deliberately NOT bumping total_earned_halalas — that tracks
  -- money earned FROM jobs, not money pre-loaded by the inspector. Same
  -- rationale as the original migration.

  -- ── 5. Record the transaction ──────────────────────────────────
  -- ★ DRIFT FIX: insert into BOTH user_id (canonical) and inspector_id
  --   (legacy NOT NULL) with the same value. The information_schema
  --   probe confirmed both columns exist on transactions in the live
  --   schema; the original CREATE TABLE migration declared inspector_id
  --   as NOT NULL, so we must populate it or the INSERT fails.
  INSERT INTO public.transactions (
    user_id,
    inspector_id,
    job_id,
    description,
    type,
    amount,
    gross_amount_halalas,
    platform_fee_halalas,
    status
  ) VALUES (
    p_user_id,
    p_user_id,
    NULL,
    'wallet_topup:' || p_stripe_payment_intent_id,
    'deposit',
    (p_amount_halalas / 100.0)::numeric(12,2),
    p_amount_halalas,
    0,
    'paid'
  );

  -- ── 6. Audit event ──────────────────────────────────────────────
  INSERT INTO public.audit_events (
    event_type, severity,
    actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id,
    summary, delta, metadata, correlation_id
  ) VALUES (
    'wallet.topup_credited',
    'info',
    NULL, 'system', 'Stripe webhook (wallet topup)',
    'profiles', p_user_id, NULL,
    'Wallet credited: ' ||
      to_char(p_amount_halalas::numeric / 100, 'FM999G999G990D00') ||
      ' SAR',
    jsonb_build_object(
      'after', jsonb_build_object(
        'available_balance_halalas', v_new_balance
      )
    ),
    jsonb_build_object(
      'user_id', p_user_id,
      'amount_halalas', p_amount_halalas,
      'payment_intent_id', p_stripe_payment_intent_id,
      'transaction_ref_id', p_transaction_ref_id
    ),
    v_correlation
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'amount_halalas', p_amount_halalas,
    'already_credited', false,
    'new_balance_halalas', v_new_balance,
    'correlation_id', v_correlation
  );
END;
$$;
-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $test$
DECLARE
  dco  text := pg_get_functiondef('public.create_organization(text,text)'::regprocedure);
  drms text;
  dwct text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO drms FROM pg_proc WHERE proname='request_milestone_release' LIMIT 1;
  SELECT pg_get_functiondef(oid) INTO dwct FROM pg_proc WHERE proname='wallet_credit_topup' LIMIT 1;

  -- 1) slug is supplied, helper exists
  IF position('slug' IN dco) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: create_organization still does not supply slug';
  END IF;
  IF to_regprocedure('public.nx_org_slug(text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the canonical slug helper is missing';
  END IF;

  -- 2) audit drift gone, and the request stays a REQUEST
  IF drms IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: request_milestone_release is missing';
  END IF;
  IF drms ~* '\mevent_kind\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: request_milestone_release still writes audit_events.event_kind';
  END IF;
  IF drms ~* '\mbalance\s*=' OR drms ~* '\mavailable_balance\M' OR drms ~* '\mtotal_earned\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: request_milestone_release now moves money — it must only RECORD a request';
  END IF;

  -- 3) top-up supplies NOT NULL columns, avoids the GENERATED column, stays decoupled
  IF dwct IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: wallet_credit_topup is missing';
  END IF;
  IF position('deposit' IN dwct) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: wallet_credit_topup does not set transactions.type';
  END IF;
  IF dwct ~* '\mnet_amount_halalas\s*,' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: wallet_credit_topup writes the GENERATED column net_amount_halalas';
  END IF;
  IF dwct ~* '\madmin_confirmed_at\M' OR dwct ~* '\minspector_payout_cents\M' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: wallet_credit_topup is now coupled to a completion/payout path';
  END IF;

  -- 4) the settlement freeze still holds
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
              WHERE p.proname IN ('handle_job_completion','handle_job_cancellation')
                AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an automatic-settlement trigger appeared';
  END IF;

  RAISE NOTICE 'safe live repairs applied: org slug, milestone-request audit, top-up bookkeeping. Settlement still manual.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
