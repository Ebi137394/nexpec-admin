-- ════════════════════════════════════════════════════════════════════════════
--  Account quality: stop spending Resend quota and owner attention on accounts
--  we can PROVE are synthetic — without deleting anyone.
--
--  Three states, and the boundary between them is the strength of the evidence:
--    known_test_or_fake — deterministic proof (QA domain, e2e fixture prefix,
--                         Apple reviewer account, or an explicit test token in
--                         the address CONFIRMED by a hard bounce).
--    suspicious         — concerning but not conclusive. Flagged for a human.
--                         Never auto-blocked, never deleted.
--    normal             — everything else.
--
--  DELIBERATELY NOT EVIDENCE on their own, because each one describes real
--  users far more often than fake ones: a Gmail address, an unusual spelling,
--  a missing photo, an incomplete profile, a numeric username, or a
--  non-Western name. None of these appear in any rule below.
--
--  A HARD BOUNCE IS NOT PROOF OF FAKENESS. A real client who mistypes their
--  address bounces too. So a bounce alone suppresses EMAIL (they cannot be
--  reached) but leaves the account 'suspicious', still visible to the owner,
--  because that person may need contacting another way. A bounce only proves
--  fakeness when the address ALSO carries an explicit test token.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.account_quality (
  user_id       uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  state         text NOT NULL DEFAULT 'normal'
                CHECK (state IN ('normal','suspicious','known_test_or_fake')),
  reasons       text[] NOT NULL DEFAULT '{}',
  email_suppressed boolean NOT NULL DEFAULT false,
  suppress_reason  text,
  classified_at timestamptz NOT NULL DEFAULT NOW(),
  classified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_manual     boolean NOT NULL DEFAULT false,   -- a human decision wins over the rules
  notes         text
);
ALTER TABLE public.account_quality ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS account_quality_admin_only ON public.account_quality;
CREATE POLICY account_quality_admin_only ON public.account_quality
  FOR ALL TO authenticated USING (public.nx_is_admin()) WITH CHECK (public.nx_is_admin());
REVOKE ALL ON public.account_quality FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.account_quality TO service_role;

COMMENT ON TABLE public.account_quality IS
  'Delivery-eligibility and account-authenticity state. Never deletes a user: it only decides whether NEXPEC spends email, reminders and owner attention on them. A manual classification (is_manual) is never overwritten by the automatic rules.';

-- ── Deterministic evaluation ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_evaluate_account_quality(p_user_id uuid)
RETURNS TABLE (state text, reasons text[], suppress boolean, suppress_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE
  v_email    text;
  v_local    text;
  v_domain   text;
  r          text[] := '{}';
  v_state    text := 'normal';
  v_sup      boolean := false;
  v_supr     text;
  v_bounced  boolean;
  v_token    boolean;
BEGIN
  SELECT lower(btrim(COALESCE(p.email,''))) INTO v_email FROM public.profiles p WHERE p.id = p_user_id;
  IF v_email IS NULL OR v_email = '' THEN
    RETURN QUERY SELECT 'suspicious'::text, ARRAY['no_email_address']::text[], true, 'no email address'::text;
    RETURN;
  END IF;
  v_local  := split_part(v_email,'@',1);
  v_domain := split_part(v_email,'@',2);

  -- ── deterministic: QA / fixture / disposable domains ──
  IF v_domain IN ('test.com','example.com','example.org','example.net','acme.com',
                  'nexpec.test','synthetic.invalid','mailinator.com','yopmail.com',
                  'guerrillamail.com','sharklasers.com','trashmail.com','10minutemail.com') THEN
    r := array_append(r, 'qa_or_disposable_domain:'||v_domain); v_state := 'known_test_or_fake';
  END IF;
  IF v_local LIKE 'e2e.%' THEN
    r := array_append(r, 'e2e_fixture_prefix'); v_state := 'known_test_or_fake';
  END IF;
  IF v_local = 'apple_tester' OR v_local LIKE 'apple_tester%' THEN
    r := array_append(r, 'apple_review_account'); v_state := 'known_test_or_fake';
  END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    r := array_append(r, 'malformed_address'); v_state := 'known_test_or_fake';
    v_sup := true; v_supr := 'malformed address';
  END IF;

  -- ── evidence from actual delivery outcomes ──
  SELECT EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.recipient_id = p_user_id AND n.email_send_error IS NOT NULL
       AND n.email_send_error ~* '(bounce|invalid|does not exist|not found|suppress|blocked|complaint|unsubscrib)'
  ) INTO v_bounced;

  -- ── explicit test tokens in the LOCAL PART only ──
  --  Matched on token boundaries so a real name that merely contains these
  --  letters (e.g. "roberto", "protest") is not caught.
  v_token := v_local ~ '(^|[._+-])(test|tests|testing|qa|fixture|dummy|sample|demo|bot|crawler|robo|selenium|cypress|playwright|automation)([._+-]|[0-9]|$)'
          OR v_local ~ '(test|qa)(inspection|inspector|client|user|account)'
          OR v_local ~ '(crawler|robo)[a-z]*$';

  IF v_token THEN
    r := array_append(r, 'test_token_in_address');
    -- A test-looking name is only PROOF when the address also does not exist.
    IF v_bounced THEN
      r := array_append(r, 'hard_bounce_confirms_synthetic');
      v_state := 'known_test_or_fake';
    ELSIF v_state = 'normal' THEN
      v_state := 'suspicious';
    END IF;
  END IF;

  IF v_bounced THEN
    v_sup := true;
    v_supr := COALESCE(v_supr, 'hard bounce or complaint reported by the email provider');
    IF NOT v_token AND v_state = 'normal' THEN
      -- Undeliverable, but possibly a real person who mistyped. Human decides.
      r := array_append(r, 'hard_bounce_address_undeliverable');
      v_state := 'suspicious';
    END IF;
  END IF;

  IF v_state = 'known_test_or_fake' THEN
    v_sup := true;
    v_supr := COALESCE(v_supr, 'known test or synthetic account');
  END IF;

  RETURN QUERY SELECT v_state, r, v_sup, v_supr;
END $$;
REVOKE ALL ON FUNCTION public.nx_evaluate_account_quality(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_evaluate_account_quality(uuid) TO authenticated, service_role;

-- ── Apply the rules, never overriding a human ─────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_refresh_account_quality(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
DECLARE e RECORD; v_manual boolean;
BEGIN
  SELECT is_manual INTO v_manual FROM public.account_quality WHERE user_id = p_user_id;
  IF COALESCE(v_manual,false) THEN
    RETURN (SELECT state FROM public.account_quality WHERE user_id = p_user_id);
  END IF;
  SELECT * INTO e FROM public.nx_evaluate_account_quality(p_user_id);
  INSERT INTO public.account_quality (user_id, state, reasons, email_suppressed, suppress_reason)
  VALUES (p_user_id, e.state, e.reasons, e.suppress, e.suppress_reason)
  ON CONFLICT (user_id) DO UPDATE
    SET state = EXCLUDED.state, reasons = EXCLUDED.reasons,
        email_suppressed = EXCLUDED.email_suppressed,
        suppress_reason = EXCLUDED.suppress_reason,
        classified_at = NOW()
   WHERE public.account_quality.is_manual IS NOT TRUE;
  RETURN e.state;
END $$;
REVOKE ALL ON FUNCTION public.nx_refresh_account_quality(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_refresh_account_quality(uuid) TO service_role;

-- ── One predicate the whole platform agrees on ────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_is_synthetic_account(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  SELECT COALESCE(
    (SELECT q.state = 'known_test_or_fake' FROM public.account_quality q WHERE q.user_id = p_user_id),
    (SELECT public.nx_is_test_account(p.email) FROM public.profiles p WHERE p.id = p_user_id),
    false);
$$;
REVOKE ALL ON FUNCTION public.nx_is_synthetic_account(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_synthetic_account(uuid) TO authenticated, service_role;

-- Suppression now consults the canonical state FIRST, so a bad address is
-- never rediscovered and retried: it is a stored fact, not a re-derivation.
CREATE OR REPLACE FUNCTION public.nx_email_suppressed(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
  SELECT COALESCE((SELECT q.email_suppressed FROM public.account_quality q WHERE q.user_id = p_user_id), false)
      OR EXISTS (
        SELECT 1 FROM public.notifications n
         WHERE n.recipient_id = p_user_id AND n.email_send_error IS NOT NULL
           AND (n.email_send_error ~* '(bounce|invalid|does not exist|not found|suppress|blocked|complaint|unsubscrib)'
                OR COALESCE(n.email_attempts,0) >= 5))
      OR NOT EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.id = p_user_id AND COALESCE(btrim(p.email),'') <> ''
           AND p.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
$$;
REVOKE ALL ON FUNCTION public.nx_email_suppressed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_email_suppressed(uuid) TO authenticated, service_role;

-- Classify every new account at signup (never blocks signup).
CREATE OR REPLACE FUNCTION public.tg_classify_new_account()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  BEGIN PERFORM public.nx_refresh_account_quality(NEW.id);
  EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_classify_new_account ON public.profiles;
CREATE TRIGGER trg_classify_new_account
  AFTER INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_classify_new_account();
REVOKE ALL ON FUNCTION public.tg_classify_new_account() FROM PUBLIC, anon, authenticated;
