-- ════════════════════════════════════════════════════════════════════════════
--  REVIEWED ROLLBACK — reverses migration 20260801278000_account_deletion_hardening
--
--  ⚠️ REHEARSE ON STAGING FIRST. Run as service_role / postgres.
--  ⚠️ THIS IS NOT ZERO-DATA-LOSS: it DROPs `platform_owner` and
--     `ai_dataset_provenance`. Any rows in those tables are lost unless you run
--     the EXPORT step (§0) first. `platform_owner` holds the owner designation;
--     `ai_dataset_provenance` may hold provenance rows if the AI pipeline wrote
--     any. Business tables, profiles, audit_events are untouched by this
--     rollback (the hardening was additive; anonymized profiles STAY anonymized
--     — deletion is not "undone", only the guards are removed).
--
--  Dependency-safe drop order: triggers → their functions → dependent helpers →
--  restore prior RPC → drop tables (after export).
--
--  Legal-version rollback, Edge Function rollback, and web/mobile rollback are
--  CODE/DEPLOY steps, NOT SQL — see §6.
-- ════════════════════════════════════════════════════════════════════════════

-- ── §0. EXPORT DATA BEFORE DROP (prevents data loss) ────────────────────────
-- Run these and keep the output; skip only if you accept losing the rows.
--   \copy (SELECT * FROM public.platform_owner)        TO 'platform_owner_backup.csv'        CSV HEADER
--   \copy (SELECT * FROM public.ai_dataset_provenance) TO 'ai_dataset_provenance_backup.csv' CSV HEADER
-- (Or: CREATE TABLE public._bak_platform_owner AS SELECT * FROM public.platform_owner; etc.)

BEGIN;

-- ── §1. profiles guard trigger + its function ───────────────────────────────
DROP TRIGGER IF EXISTS trg_nx_protect_privileged_profiles ON public.profiles;
DROP FUNCTION IF EXISTS public.nx_protect_privileged_profiles();

-- ── §2. platform_owner immutability trigger + its function ──────────────────
DROP TRIGGER IF EXISTS trg_platform_owner_immutable ON public.platform_owner;
DROP FUNCTION IF EXISTS public.nx_platform_owner_immutable();

-- ── §3. owner seed/transfer procedures (exact signatures) ───────────────────
DROP FUNCTION IF EXISTS public.transfer_platform_owner(uuid, text);
DROP FUNCTION IF EXISTS public.seed_platform_owner(uuid);

-- ── §4. owner helpers (dropped AFTER the profiles trigger that used them) ────
DROP FUNCTION IF EXISTS public.nx_is_platform_owner(uuid);
DROP FUNCTION IF EXISTS public.nx_active_super_admin_count();

-- ── §5. RESTORE the prior request_account_deletion() body (from 164000) ─────
--   Same signature ⇒ CREATE OR REPLACE. delete_user() alias (unchanged) keeps
--   pointing at this restored body. Grants are preserved by CREATE OR REPLACE.
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
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;
  SELECT count(*) INTO v_active_jobs
    FROM public.jobs j
   WHERE (j.client_id = v_uid OR j.contractor_id = v_uid OR j.agency_id = v_uid)
     AND j.status IN ('pending_approval','open','assigned','in_progress','disputed');
  IF v_active_jobs > 0 THEN
    RAISE EXCEPTION 'ACTIVE_JOBS: You have % active job(s). Please close, complete, or cancel them before deleting your account.', v_active_jobs USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid;
  IF FOUND AND (
        COALESCE(v_wallet.available_balance, 0) > 0
     OR COALESCE(v_wallet.pending_amount,    0) > 0
     OR COALESCE(v_wallet.escrow_amount,     0) > 0
     OR COALESCE(v_wallet.pending_payouts,   0) > 0
  ) THEN
    RAISE EXCEPTION 'WALLET_NOT_EMPTY: Your wallet still holds funds or pending payouts. Please withdraw or settle them before deleting your account.' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.profiles
     SET full_name='Deleted user', first_name=NULL, last_name=NULL,
         email='deleted+'||v_uid::text||'@deleted.nexpec.invalid', phone=NULL,
         avatar_url=NULL, bio=NULL, headline=NULL, company_name=NULL,
         company_logo_url=NULL, professional_title=NULL, title=NULL, location=NULL,
         current_project=NULL, resume_url=NULL, cv_url=NULL, push_token=NULL,
         report_header_text=NULL, report_footer_text=NULL, use_custom_branding=false,
         status='suspended', deleted_at=now(), anonymized_at=now(), updated_at=now()
   WHERE id = v_uid;
  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_role, actor_label,
                                   subject_table, subject_id, job_id, summary, delta, metadata)
  VALUES ('account.deletion_requested','warning', v_uid,'system','Self-service account deletion',
          'profiles', v_uid, NULL,
          'Account anonymized + soft-deleted on user request; PII scrubbed, financial/contract/audit records retained.',
          '{}'::jsonb, jsonb_build_object('anonymized', true));
  RETURN jsonb_build_object('ok', true, 'user_id', v_uid, 'anonymized', true);
END $fn$;

-- ── §6. DROP the new tables (AFTER export in §0) ────────────────────────────
--   Order: ai_dataset_provenance has an RLS policy (dropped with the table).
--   platform_owner is referenced by NOTHING now (helpers dropped in §4).
DROP TABLE IF EXISTS public.ai_dataset_provenance;
DROP TABLE IF EXISTS public.platform_owner;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
--  NON-SQL ROLLBACK STEPS (do these too, in this order):
--   1. Edge Function: redeploy the PREVIOUS delete-account/index.ts
--        supabase functions deploy delete-account   (from the prior commit)
--   2. Web: Vercel → promote the previous deployment (reverts middleware,
--        DangerZone, DeleteAccountFlow, Header env badge).
--   3. Mobile: `eas update --channel production` with the prior JS bundle
--        (native cannot be un-released; roll forward).
--   4. Legal: `git revert` the registry/bodies/types/resolver changes and
--        redeploy web+mobile — this restores v1.0 docs and removes SUP-AGR-001
--        from the resolver. (No DB rollback needed: acceptances are append-only
--        and keyed by (id,version); v1.1 rows simply stop being referenced.)
--
--  POST-ROLLBACK VERIFICATION:
--   - qa:db-refs green · request_account_deletion resolves · no orphaned refs.
--   - Deletion reverts to pre-hardening behavior (active-jobs + wallet guards
--     only; no owner/admin/supplier guards; owner NOT protected — re-plan).
-- ════════════════════════════════════════════════════════════════════════════
