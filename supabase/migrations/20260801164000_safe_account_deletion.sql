-- ════════════════════════════════════════════════════════════════════════════
--  20260801164000_safe_account_deletion.sql
--
--  Replaces the dangerous self-service account deletion with a GUARDED
--  soft-delete + anonymize flow.
--
--  The old delete_user() did:  delete from public.profiles ...; delete from
--  auth.users ...;  — a hard delete with NO guards and NO search_path. On a real
--  account that either FK-fails or cascade-wipes financial / contract / audit
--  records a B2B platform is legally required to RETAIN. This migration:
--
--    1. Adds soft-delete markers to profiles (deleted_at / anonymized_at).
--    2. Adds request_account_deletion() — guarded (no active jobs, no unsettled
--       wallet money), then ANONYMIZES PII in place and marks the row
--       deleted/suspended. It does NOT delete the row or auth.users, so every
--       linked job / deal / contract / invoice / audit row stays intact, now
--       pointing at an anonymized profile.
--    3. Neutralizes the legacy delete_user() → safe alias of the above (so any
--       caller still hitting it can no longer hard-delete anything).
--
--  Blocking the auth LOGIN (so the anonymized user can't sign back in) is done
--  by the `delete-account` Edge Function via auth.admin ban — it cannot and
--  must not be done from SQL, and we deliberately BAN rather than delete the
--  auth user to preserve referential integrity of retained records.
--
--  profiles.status CHECK only allows ('active','suspended') → we use 'suspended'
--  + deleted_at as the deletion flag (no enum change). Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Soft-delete markers ────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

-- ── 2. Guarded soft-delete + anonymize ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_uid         uuid := auth.uid();
  v_active_jobs int;
  v_wallet      public.wallets;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: already anonymized.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  -- ── GUARD 1: no active engagements ──
  SELECT count(*) INTO v_active_jobs
    FROM public.jobs j
   WHERE (j.client_id = v_uid OR j.contractor_id = v_uid OR j.agency_id = v_uid)
     AND j.status IN ('pending_approval','open','assigned','in_progress','disputed');
  IF v_active_jobs > 0 THEN
    RAISE EXCEPTION 'ACTIVE_JOBS: You have % active job(s). Please close, complete, or cancel them before deleting your account.', v_active_jobs
      USING ERRCODE = 'P0001';
  END IF;

  -- ── GUARD 2: no unsettled money ──
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid;
  IF FOUND AND (
        COALESCE(v_wallet.available_balance, 0) > 0
     OR COALESCE(v_wallet.pending_amount,    0) > 0
     OR COALESCE(v_wallet.escrow_amount,     0) > 0
     OR COALESCE(v_wallet.pending_payouts,   0) > 0
  ) THEN
    RAISE EXCEPTION 'WALLET_NOT_EMPTY: Your wallet still holds funds or pending payouts. Please withdraw or settle them before deleting your account.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── ANONYMIZE PII in place (row + all linked records RETAINED) ──
  UPDATE public.profiles
     SET full_name          = 'Deleted user',
         first_name         = NULL,
         last_name          = NULL,
         email              = 'deleted+' || v_uid::text || '@deleted.nexpec.invalid',
         phone              = NULL,
         avatar_url         = NULL,
         bio                = NULL,
         headline           = NULL,
         company_name       = NULL,
         company_logo_url   = NULL,
         professional_title = NULL,
         title              = NULL,
         location           = NULL,
         current_project    = NULL,
         resume_url         = NULL,
         cv_url             = NULL,
         push_token         = NULL,
         report_header_text = NULL,
         report_footer_text = NULL,
         use_custom_branding= false,
         status             = 'suspended',
         deleted_at         = now(),
         anonymized_at      = now(),
         updated_at         = now()
   WHERE id = v_uid;

  -- ── Audit (retained) ──
  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_role, actor_label,
                                   subject_table, subject_id, job_id, summary, delta, metadata)
  VALUES ('account.deletion_requested', 'warning', v_uid, 'system', 'Self-service account deletion',
          'profiles', v_uid, NULL,
          'Account anonymized + soft-deleted on user request; PII scrubbed, financial/contract/audit records retained.',
          '{}'::jsonb, jsonb_build_object('anonymized', true));

  RETURN jsonb_build_object('ok', true, 'user_id', v_uid, 'anonymized', true);
END $fn$;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM public;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated, service_role;

-- ── 3. Neutralize the legacy hard-delete: safe alias (no DELETE, no auth.users) ─
CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $fn$
BEGIN
  -- Legacy entry point. Previously hard-deleted profiles + auth.users; now a
  -- thin, safe alias for the guarded anonymize flow. Login-ban is handled by
  -- the delete-account Edge Function.
  PERFORM public.request_account_deletion();
END $fn$;
REVOKE ALL ON FUNCTION public.delete_user() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_user() TO authenticated, service_role;

-- ── 4. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='profiles' AND column_name='deleted_at') THEN
    RAISE EXCEPTION 'SELFTEST: profiles.deleted_at missing';
  END IF;
  IF to_regprocedure('public.request_account_deletion()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: request_account_deletion missing';
  END IF;
  -- the legacy hard-delete must be gone
  IF pg_get_functiondef('public.delete_user()'::regprocedure) ~* 'delete\s+from\s+(public\.)?profiles'
     OR pg_get_functiondef('public.delete_user()'::regprocedure) ~* 'delete\s+from\s+auth\.users' THEN
    RAISE EXCEPTION 'SELFTEST: delete_user still performs a hard delete';
  END IF;
  RAISE NOTICE 'Safe account deletion OK: guarded anonymize; legacy delete_user neutralized.';
END $$;

COMMIT;
