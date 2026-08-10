-- ════════════════════════════════════════════════════════════════════════════
--  supabase/tests/certification_expiry_test.sql
--
--  Behavioural proof of 20260801362000 — credential expiry reminders fire once
--  per threshold, expiry is DERIVED (never stamped), and the legacy path is
--  preserved.
--
--  RUN (LOCAL only):
--    psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
--      -f supabase/tests/certification_expiry_test.sql
--
--  One transaction, ends in ROLLBACK. auth.users FIRST (profiles.id FK).
--
--  E1  a credential 30 days out produces exactly one reminder
--  E2  re-running the scan the same day sends NOTHING (idempotent)
--  E3  a credential far from any threshold is not touched
--  E4  a PENDING credential is not reminded (only verified ones count)
--  E5  the scan mutates no credential state — expiry stays derived
--  E6  renewing a credential re-arms the ladder
--  E7  nx_my_certification_status derives the right state and is self-scoped
--  E8  an expired credential stops counting towards matching
--  E9  the legacy contractor_certifications path still exists AND now works
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;
SET LOCAL client_min_messages TO NOTICE;

DO $suite$
DECLARE
  v_insp   uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_client uuid := gen_random_uuid();
  v_c30    uuid;
  v_far    uuid;
  v_pend   uuid;
  v_job    uuid;
  v_res    jsonb;
  v_n      int;
  v_state  text;
  v_status text;
  v_cert_pts_before int;
  v_cert_pts_after  int;
  v_legacy uuid;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  VALUES
    (v_insp,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ce.insp@test.nx',  now(),now()),
    (v_other, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','ce.other@test.nx', now(),now()),
    (v_client,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ce.client@test.nx',now(),now());

  INSERT INTO public.profiles (id, role, full_name, email, is_verified, is_available, specialty_slugs)
  VALUES
    (v_insp, 'inspector','CE Inspector','ce.insp@test.nx', true,true, ARRAY['ndt']),
    (v_other,'inspector','CE Other',    'ce.other@test.nx',true,true, ARRAY['ndt']),
    (v_client,'client',  'CE Client',   'ce.client@test.nx',true,true,'{}');

  INSERT INTO public.certifications (user_id, name, issuing_organization, status, expiry_date)
  VALUES (v_insp,'API-570','API','verified', current_date + 30) RETURNING id INTO v_c30;
  INSERT INTO public.certifications (user_id, name, issuing_organization, status, expiry_date)
  VALUES (v_insp,'CSWIP','TWI','verified', current_date + 200) RETURNING id INTO v_far;
  INSERT INTO public.certifications (user_id, name, issuing_organization, status, expiry_date)
  VALUES (v_insp,'PENDING-CERT','X','pending', current_date + 30) RETURNING id INTO v_pend;

  -- ── E1 — 30-day reminder fires once ─────────────────────────────────────
  v_res := public.nx_certification_expiry_scan();
  SELECT count(*) INTO v_n FROM public.certification_expiry_reminders
   WHERE certification_id = v_c30 AND threshold_days = 30;
  IF v_n <> 1 THEN RAISE EXCEPTION 'E1 FAILED: expected 1 reminder for the 30-day credential, got %', v_n; END IF;
  IF (v_res->>'sent')::int < 1 THEN RAISE EXCEPTION 'E1 FAILED: scan reported sent=%', v_res->>'sent'; END IF;
  RAISE NOTICE 'E1 ok — 30-day reminder sent (%)', v_res;

  -- ── E2 — idempotent within the same day ─────────────────────────────────
  v_res := public.nx_certification_expiry_scan();
  IF (v_res->>'sent')::int <> 0 THEN
    RAISE EXCEPTION 'E2 FAILED: re-running the scan sent % more reminder(s)', v_res->>'sent';
  END IF;
  SELECT count(*) INTO v_n FROM public.certification_expiry_reminders WHERE certification_id = v_c30;
  IF v_n <> 1 THEN RAISE EXCEPTION 'E2 FAILED: ledger now has % rows for one credential', v_n; END IF;
  RAISE NOTICE 'E2 ok — second run sent nothing';

  -- ── E3 — a credential far from any threshold is untouched ───────────────
  SELECT count(*) INTO v_n FROM public.certification_expiry_reminders WHERE certification_id = v_far;
  IF v_n <> 0 THEN RAISE EXCEPTION 'E3 FAILED: a credential 200 days out was reminded'; END IF;
  RAISE NOTICE 'E3 ok — distant credential ignored';

  -- ── E4 — pending credentials are not reminded ───────────────────────────
  SELECT count(*) INTO v_n FROM public.certification_expiry_reminders WHERE certification_id = v_pend;
  IF v_n <> 0 THEN RAISE EXCEPTION 'E4 FAILED: a pending credential was reminded'; END IF;
  RAISE NOTICE 'E4 ok — pending credential ignored';

  -- ── E5 — no credential state was mutated ────────────────────────────────
  SELECT status INTO v_status FROM public.certifications WHERE id = v_c30;
  IF v_status <> 'verified' THEN
    RAISE EXCEPTION 'E5 FAILED: the scan changed credential status to % — expiry must stay derived', v_status;
  END IF;
  RAISE NOTICE 'E5 ok — credential state untouched';

  -- ── E6 — renewal re-arms the ladder ─────────────────────────────────────
  UPDATE public.certifications SET expiry_date = current_date + 30 + 365 WHERE id = v_c30;
  UPDATE public.certifications SET expiry_date = current_date + 30       WHERE id = v_c30;
  -- same expiry_date as before → still suppressed
  v_res := public.nx_certification_expiry_scan();
  IF (v_res->>'sent')::int <> 0 THEN
    RAISE EXCEPTION 'E6 FAILED: an unchanged expiry re-sent a reminder';
  END IF;
  -- a genuinely NEW expiry date re-arms it
  UPDATE public.certifications SET expiry_date = current_date + 7 WHERE id = v_c30;
  v_res := public.nx_certification_expiry_scan();
  SELECT count(*) INTO v_n FROM public.certification_expiry_reminders
   WHERE certification_id = v_c30 AND threshold_days = 7;
  IF v_n <> 1 THEN RAISE EXCEPTION 'E6 FAILED: renewal did not re-arm the ladder (7-day rows=%)', v_n; END IF;
  RAISE NOTICE 'E6 ok — renewal re-arms the reminder ladder';

  -- ── E7 — derived state, self-scoped ─────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_insp::text)::text, true);
  SELECT expiry_state INTO v_state FROM public.nx_my_certification_status() WHERE id = v_c30;
  IF v_state <> 'critical' THEN
    RAISE EXCEPTION 'E7 FAILED: a credential 7 days out reported state % (expected critical)', v_state;
  END IF;
  -- the OTHER user must see none of these
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other::text)::text, true);
  SELECT count(*) INTO v_n FROM public.nx_my_certification_status();
  IF v_n <> 0 THEN RAISE EXCEPTION 'E7 FAILED: another user saw % credential(s)', v_n; END IF;
  RAISE NOTICE 'E7 ok — state derived correctly and scoped to the owner';

  -- ── E8 — an expired credential stops counting for matching ──────────────
  INSERT INTO public.jobs (id, client_id, title, description, status, moderation_status,
                           specialty_slugs, required_certifications)
  VALUES (gen_random_uuid(), v_client, 'CE MATCH', 'suite', 'open', 'approved',
          ARRAY['ndt'], ARRAY['API-570'])
  RETURNING id INTO v_job;

  UPDATE public.certifications SET expiry_date = current_date + 90 WHERE id = v_c30;
  SELECT cert_pts INTO v_cert_pts_before FROM public.nx_inspector_job_match_core(v_job, v_insp);
  UPDATE public.certifications SET expiry_date = current_date - 1  WHERE id = v_c30;
  SELECT cert_pts INTO v_cert_pts_after  FROM public.nx_inspector_job_match_core(v_job, v_insp);
  IF NOT (v_cert_pts_before > v_cert_pts_after) THEN
    RAISE EXCEPTION 'E8 FAILED: an expired credential still counts (before=% after=%)',
      v_cert_pts_before, v_cert_pts_after;
  END IF;
  RAISE NOTICE 'E8 ok — expired credential stops counting (% → %)', v_cert_pts_before, v_cert_pts_after;

  -- ── E9 — the LEGACY path is preserved and now actually works ────────────
  IF to_regprocedure('public.get_expiring_certifications(integer[])') IS NULL
     OR to_regprocedure('public.auto_expire_certifications()') IS NULL THEN
    RAISE EXCEPTION 'E9 FAILED: a legacy certification function was removed';
  END IF;
  INSERT INTO public.contractor_certifications (contractor_id, title, expiry_date, status)
  VALUES (v_insp, 'LEGACY CERT', current_date - 5, 'valid') RETURNING id INTO v_legacy;
  PERFORM public.expire_old_certifications();
  SELECT status INTO v_status FROM public.contractor_certifications WHERE id = v_legacy;
  IF v_status <> 'expired' THEN
    RAISE EXCEPTION 'E9 FAILED: the legacy expiry still cannot expire a ''valid'' row (status=%)', v_status;
  END IF;
  RAISE NOTICE 'E9 ok — legacy path preserved and its status bug is fixed';

  RAISE NOTICE '───────────────────────────────────────────';
  RAISE NOTICE 'CERTIFICATION EXPIRY: ALL ASSERTIONS PASSED';
END
$suite$;

ROLLBACK;
