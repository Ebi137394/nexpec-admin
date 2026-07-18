-- ════════════════════════════════════════════════════════════════════════════
--  Migration — account-deletion hardening (20260801278000)
--
--  Applied via the normal release runbook (LAST, with the pending batch).
--  Requires a one-time post-apply step to designate the Platform Owner:
--     SELECT public.seed_platform_owner('<owner-profiles-uuid>');
--
--  Scope (all additive / idempotent; no destructive DDL, no data deletion):
--    1. Platform Owner singleton + role helpers (non-email anchor).
--    2. profiles guard trigger: owner un-deletable/un-demotable; last active
--       super_admin protected; admins never anonymized by the self-serve path.
--    3. Hardened request_account_deletion() — role/owner gate, role-aware
--       tombstone label ("Former Inspector" …), expanded supplier + money +
--       dispute + org guards, stable machine-readable error codes.
--    4. AI dataset provenance table (smallest safe extension) — retention /
--       de-identification / legal-basis tracking. Additive only.
--    5. Self-tests (RAISE on regression).
--
--  Conventions honored: SECURITY DEFINER + explicit search_path; auth.uid()
--  only (no caller-supplied id); no dynamic SQL; least privilege GRANTs;
--  atomic (single function, single txn); immutable audit via audit_events.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PLATFORM OWNER — stable, non-email anchor
--    A singleton table (one row, enforced by a boolean PK) pins the Platform
--    Owner to a profiles.id (UUID), NOT an email. Email can change; the UUID
--    is immutable. Seeding is a deliberate, separate, admin-only step so the
--    identity is explicit and auditable.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_owner (
  only_one     boolean     PRIMARY KEY DEFAULT true CHECK (only_one),   -- singleton
  owner_uid    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  established_at timestamptz NOT NULL DEFAULT now(),
  note         text
);
COMMENT ON TABLE public.platform_owner IS
  'Singleton (max one row): the Platform Owner profiles.id. Non-email anchor for owner protection. Seed once via seed_platform_owner().';

ALTER TABLE public.platform_owner ENABLE ROW LEVEL SECURITY;
-- No policies for authenticated/anon ⇒ table is invisible to clients; only
-- SECURITY DEFINER helpers (owner-check) and service_role can read it.
REVOKE ALL ON TABLE public.platform_owner FROM anon, authenticated;

-- Table immutability: once seeded, the row cannot be UPDATEd or DELETEd by any
-- ordinary path (RPC, admin tool, direct SQL). The ONLY legitimate change is
-- via transfer_platform_owner(), which sets a transaction-local GUC to pass.
-- This raises the bar well above accidental/RPC changes. (A full superuser with
-- direct schema access could still drop the trigger — no in-DB guard is
-- tamper-proof against the schema owner; this is documented, not hidden.)
CREATE OR REPLACE FUNCTION public.nx_platform_owner_immutable()
RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF current_setting('nexpec.allow_owner_transfer', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);   -- controlled transfer_platform_owner() path
  END IF;
  RAISE EXCEPTION 'PLATFORM_OWNER_TABLE_IMMUTABLE: platform_owner may only be changed via transfer_platform_owner()' USING ERRCODE = 'P0001';
END $fn$;
ALTER FUNCTION public.nx_platform_owner_immutable() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_platform_owner_immutable ON public.platform_owner;
CREATE TRIGGER trg_platform_owner_immutable
  BEFORE UPDATE OR DELETE ON public.platform_owner
  FOR EACH ROW EXECUTE FUNCTION public.nx_platform_owner_immutable();

-- Owner check — SECURITY DEFINER so the RLS-locked table is readable here only.
CREATE OR REPLACE FUNCTION public.nx_is_platform_owner(p_uid uuid DEFAULT auth.uid())
RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_owner WHERE owner_uid = p_uid);
$$;
ALTER FUNCTION public.nx_is_platform_owner(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_platform_owner(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.nx_is_platform_owner(uuid) TO authenticated, service_role;

-- Count of active (non-deleted, non-suspended) super_admins — for last-admin guard.
CREATE OR REPLACE FUNCTION public.nx_active_super_admin_count()
RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int
    FROM public.profiles
   WHERE role = 'super_admin'
     AND deleted_at IS NULL
     AND COALESCE(status, 'active') <> 'suspended';
$$;
ALTER FUNCTION public.nx_active_super_admin_count() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_active_super_admin_count() FROM public;
GRANT EXECUTE ON FUNCTION public.nx_active_super_admin_count() TO authenticated, service_role;

-- Seeder — ONE-TIME bootstrap. Refuses to run if an owner already exists (no
-- silent replace). Authorization: an in-app admin OR a trusted server context
-- (auth.uid() IS NULL ⇒ service_role / SQL editor / migration); never a normal
-- authenticated non-admin. Validates the target is a real super_admin profile
-- with a matching auth.users identity. EXECUTE is service_role-only.
--   SELECT public.seed_platform_owner('<owner-profiles-uuid>');
CREATE OR REPLACE FUNCTION public.seed_platform_owner(p_uid uuid)
RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
BEGIN
  -- Authorization (in-app admin, or trusted server/superuser context).
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only an admin or server context may seed the Platform Owner' USING ERRCODE = '42501';
  END IF;
  -- One-time only: never replace an existing owner via the seeder.
  IF EXISTS (SELECT 1 FROM public.platform_owner) THEN
    RAISE EXCEPTION 'PLATFORM_OWNER_ALREADY_SET: an owner is already seeded; use transfer_platform_owner() to change it' USING ERRCODE = 'P0001';
  END IF;
  -- Identity validation: real super_admin profile + existing auth identity.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_uid AND role = 'super_admin') THEN
    RAISE EXCEPTION 'owner_must_be_super_admin: % is not a super_admin profile', p_uid USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_uid) THEN
    RAISE EXCEPTION 'owner_auth_identity_missing: no auth.users row for %', p_uid USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.platform_owner (only_one, owner_uid, note)
  VALUES (true, p_uid, 'seeded via seed_platform_owner');

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_role, actor_label,
                                   subject_table, subject_id, summary, delta, metadata)
  VALUES ('platform_owner.seeded', 'critical', auth.uid(), 'system', 'Platform Owner designation',
          'platform_owner', p_uid, 'Platform Owner seeded (one-time).', '{}'::jsonb,
          jsonb_build_object('owner_uid', p_uid));
END $fn$;
ALTER FUNCTION public.seed_platform_owner(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.seed_platform_owner(uuid) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.seed_platform_owner(uuid) TO service_role;

-- Controlled, audited ownership TRANSFER — the ONLY sanctioned way to change an
-- existing owner. Requires a reason, validates the new identity, sets the
-- txn-local GUC that lets the immutability trigger pass, and audits old→new.
-- EXECUTE is service_role-only.
CREATE OR REPLACE FUNCTION public.transfer_platform_owner(p_new_uid uuid, p_reason text)
RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_old uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.nx_is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only an admin or server context may transfer ownership' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 8 THEN
    RAISE EXCEPTION 'transfer_reason_required: provide a reason (>= 8 chars)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_new_uid AND role = 'super_admin') THEN
    RAISE EXCEPTION 'owner_must_be_super_admin: % is not a super_admin profile', p_new_uid USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_new_uid) THEN
    RAISE EXCEPTION 'owner_auth_identity_missing: no auth.users row for %', p_new_uid USING ERRCODE = 'P0001';
  END IF;
  SELECT owner_uid INTO v_old FROM public.platform_owner;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'no_owner_to_transfer: seed the owner first' USING ERRCODE = 'P0001';
  END IF;
  IF v_old = p_new_uid THEN
    RAISE EXCEPTION 'owner_unchanged: target is already the Platform Owner' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('nexpec.allow_owner_transfer', 'on', true);   -- txn-local; auto-resets on commit/abort
  UPDATE public.platform_owner
     SET owner_uid = p_new_uid, established_at = now(), note = 'transferred: ' || p_reason;
  PERFORM set_config('nexpec.allow_owner_transfer', 'off', true);

  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_role, actor_label,
                                   subject_table, subject_id, summary, delta, metadata)
  VALUES ('platform_owner.transferred', 'critical', auth.uid(), 'system', 'Platform Owner transfer',
          'platform_owner', p_new_uid, 'Platform Owner transferred.', '{}'::jsonb,
          jsonb_build_object('old_owner_uid', v_old, 'new_owner_uid', p_new_uid, 'reason', p_reason));
END $fn$;
ALTER FUNCTION public.transfer_platform_owner(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_platform_owner(uuid, text) FROM public, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.transfer_platform_owner(uuid, text) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PROFILES GUARD TRIGGER — database-level owner / admin / last-super-admin
--    protection. Fires on ANY UPDATE or DELETE regardless of caller (RPC,
--    direct SQL from authenticated, admin tools, bulk ops). This is the
--    non-UI, non-bypassable layer.
--
--    Blocks, for the Platform Owner row:
--      • hard DELETE
--      • demotion (role change away from super_admin)
--      • disable/lock (status → suspended)
--      • soft-delete / anonymize (deleted_at / anonymized_at set)
--    Blocks, for the LAST active super_admin (owner or not):
--      • demotion, suspension, soft-delete
--    Blocks, for ANY admin/super_admin:
--      • self-serve anonymize (deleted_at set while role is admin/super_admin)
--        — deletion of privileged accounts must go through an explicit,
--          separately-audited operational path, never the self-serve RPC.
--
--    NOTE: auth.users ban is applied by the delete-account Edge Function via
--    service_role (auth schema, not public). The Edge Function draft adds the
--    matching owner/admin refusal so the login-ban vector is closed too.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_protect_privileged_profiles()
RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_is_owner        boolean := public.nx_is_platform_owner(OLD.id);
  v_was_super       boolean := (OLD.role = 'super_admin');
  v_active_supers   int;
BEGIN
  -- Hard DELETE protection.
  IF (TG_OP = 'DELETE') THEN
    IF v_is_owner THEN
      RAISE EXCEPTION 'PLATFORM_OWNER_PROTECTED: the Platform Owner account cannot be deleted' USING ERRCODE = 'P0001';
    END IF;
    IF v_was_super THEN
      v_active_supers := public.nx_active_super_admin_count();
      IF v_active_supers <= 1 THEN
        RAISE EXCEPTION 'LAST_SUPER_ADMIN: cannot delete the last active super_admin' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE protection.
  IF (TG_OP = 'UPDATE') THEN
    -- 2a. Platform Owner is immutable in the dimensions that would disable it.
    IF v_is_owner THEN
      IF NEW.role IS DISTINCT FROM OLD.role THEN
        RAISE EXCEPTION 'PLATFORM_OWNER_PROTECTED: the Platform Owner role cannot be changed' USING ERRCODE = 'P0001';
      END IF;
      IF (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
         OR (NEW.anonymized_at IS NOT NULL AND OLD.anonymized_at IS NULL)
         OR (COALESCE(NEW.status,'active') = 'suspended' AND COALESCE(OLD.status,'active') <> 'suspended') THEN
        RAISE EXCEPTION 'PLATFORM_OWNER_PROTECTED: the Platform Owner account cannot be deleted, anonymized, suspended, or disabled' USING ERRCODE = 'P0001';
      END IF;
    END IF;

    -- 2b. Last active super_admin cannot be demoted / suspended / soft-deleted.
    IF v_was_super THEN
      IF (NEW.role IS DISTINCT FROM 'super_admin')
         OR (COALESCE(NEW.status,'active') = 'suspended' AND COALESCE(OLD.status,'active') <> 'suspended')
         OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
        v_active_supers := public.nx_active_super_admin_count();
        IF v_active_supers <= 1 THEN
          RAISE EXCEPTION 'LAST_SUPER_ADMIN: cannot demote, suspend, or delete the last active super_admin' USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;

    -- 2c. No privileged account may be anonymized via the self-serve path.
    --     (The self-serve RPC also refuses this; the trigger is the backstop
    --      against direct writes / admin tools / bulk ops.)
    IF OLD.role IN ('admin','super_admin')
       AND (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
      RAISE EXCEPTION 'ADMIN_NOT_SELF_DELETABLE: admin / super_admin accounts cannot be self-deleted or anonymized' USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END $fn$;
ALTER FUNCTION public.nx_protect_privileged_profiles() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_nx_protect_privileged_profiles ON public.profiles;
CREATE TRIGGER trg_nx_protect_privileged_profiles
  BEFORE UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.nx_protect_privileged_profiles();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. HARDENED request_account_deletion()
--    Replaces migration 20260801164000's version. Same contract (self-only,
--    auth.uid(), anonymize-in-place so all FKs stay valid), plus:
--      • role/owner gate up front (defense in depth with the trigger)
--      • role-aware tombstone label ("Former Inspector" / "Former Client" …)
--      • expanded supplier guards (contract / quote / earnings)
--      • money guards (invoices / withdrawals / payout requests / wallet)
--      • dispute guards (open disputes / job disputes)
--      • org guards (ownership / owner-membership requiring transfer)
--    Every rejection: RAISE with a stable UPPER_SNAKE code as the first token
--    (matches the existing UI/edge parser: 'CODE: human message').
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_account_deletion()
RETURNS jsonb
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $fn$
DECLARE
  v_uid          uuid := auth.uid();
  v_role         text;
  v_active_jobs  int;
  v_wallet       public.wallets;
  v_n            int;
  v_label        text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid;

  -- Idempotent: already anonymized.
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  -- ── GUARD 0: privileged accounts are never self-deletable ──
  IF public.nx_is_platform_owner(v_uid) THEN
    RAISE EXCEPTION 'PLATFORM_OWNER_PROTECTED: the Platform Owner account cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF v_role IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'ADMIN_NOT_SELF_DELETABLE: admin / super_admin accounts cannot be self-deleted. Contact NEXPEC operations.' USING ERRCODE = 'P0001';
  END IF;

  -- ── GUARD 1: no active engagements (client / inspector / agency) ──
  SELECT count(*) INTO v_active_jobs
    FROM public.jobs j
   WHERE (j.client_id = v_uid OR j.contractor_id = v_uid OR j.agency_id = v_uid)
     AND j.status IN ('pending_approval','open','assigned','in_progress','disputed');
  IF v_active_jobs > 0 THEN
    RAISE EXCEPTION 'ACTIVE_JOBS: You have % active job(s). Close, complete, or cancel them first.', v_active_jobs USING ERRCODE = 'P0001';
  END IF;

  -- ── GUARD 2: no unsettled wallet money ──
  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_uid;
  IF FOUND AND (
        COALESCE(v_wallet.available_balance, 0) > 0
     OR COALESCE(v_wallet.pending_amount,    0) > 0
     OR COALESCE(v_wallet.escrow_amount,     0) > 0
     OR COALESCE(v_wallet.pending_payouts,   0) > 0
  ) THEN
    RAISE EXCEPTION 'WALLET_NOT_EMPTY: Your wallet still holds funds or pending payouts. Withdraw or settle them first.' USING ERRCODE = 'P0001';
  END IF;

  -- ── GUARD 3: pending / failed withdrawals (inspector, supplier, agency) ──
  SELECT count(*) INTO v_n FROM public.withdrawal_requests
   WHERE requester_id = v_uid AND status IN ('requested','approved');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PENDING_PAYOUT: You have % pending withdrawal request(s). Wait for settlement first.', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.withdrawals
   WHERE user_id = v_uid AND status IN ('pending','processing','failed');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'FAILED_PAYOUT: You have % unresolved withdrawal(s) (pending/processing/failed). Resolve them first.', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.payout_requests
   WHERE inspector_id = v_uid AND status IN ('requested','processing');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'PENDING_PAYOUT: You have % pending payout request(s).', v_n USING ERRCODE = 'P0001';
  END IF;

  -- ── GUARD 4: open invoices (as client or inspector) ──
  SELECT count(*) INTO v_n FROM public.invoices
   WHERE (client_id = v_uid OR inspector_id = v_uid)
     AND status IN ('pending_review','approved','disputed');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'OPEN_INVOICE: You have % unsettled invoice(s). Settle or void them first.', v_n USING ERRCODE = 'P0001';
  END IF;

  -- ── GUARD 5: open disputes ──
  SELECT count(*) INTO v_n FROM public.disputes
   WHERE raised_by = v_uid AND status IN ('open','under_review','escalated');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'OPEN_DISPUTE: You have % open dispute(s). They must be resolved first.', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.job_disputes
   WHERE raised_by = v_uid AND status IN ('open','under_review','escalated') AND deleted_at IS NULL;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'OPEN_DISPUTE: You have % open job dispute(s). They must be resolved first.', v_n USING ERRCODE = 'P0001';
  END IF;

  -- ── GUARD 6: SUPPLIER obligations ──
  --   active supplier contract (anything not voided)
  SELECT count(*) INTO v_n FROM public.supplier_contracts
   WHERE supplier_id = v_uid
     AND status IN ('draft','pending_supplier_signature','pending_admin_countersignature','executed');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SUPPLIER_ACTIVE_CONTRACT: You have % active supplier contract(s). They must be voided or completed first.', v_n USING ERRCODE = 'P0001';
  END IF;
  --   open procurement quote / engagement
  SELECT count(*) INTO v_n FROM public.supplier_quotes
   WHERE supplier_id = v_uid
     AND status IN ('submitted','shortlisted','presented','accepted');
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SUPPLIER_OPEN_QUOTE: You have % open quotation(s)/procurement engagement(s).', v_n USING ERRCODE = 'P0001';
  END IF;
  --   unsettled supplier earnings (halalas == cents)
  SELECT count(*) INTO v_n FROM public.supplier_earnings
   WHERE supplier_id = v_uid
     AND (COALESCE(available_balance_halalas,0) > 0 OR COALESCE(pending_halalas,0) > 0);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'SUPPLIER_EARNINGS_UNSETTLED: Your supplier earnings ledger still holds funds. Withdraw or settle first.' USING ERRCODE = 'P0001';
  END IF;

  -- ── GUARD 7: organization ownership / owner-membership requiring transfer ──
  SELECT count(*) INTO v_n FROM public.organizations
   WHERE owner_id = v_uid AND COALESCE(is_active, true) = true;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ORG_OWNERSHIP_TRANSFER_REQUIRED: You own % active organization(s). Transfer ownership before deleting.', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.org_members
   WHERE user_id = v_uid AND role = 'owner';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'ORG_MEMBERSHIP_TRANSFER_REQUIRED: You are the owner-member of % organization(s). Reassign the owner role first.', v_n USING ERRCODE = 'P0001';
  END IF;

  -- ── Role-aware tombstone label ──
  v_label := CASE v_role
    WHEN 'inspector'  THEN 'Former Inspector'
    WHEN 'client'     THEN 'Former Client'
    WHEN 'agency'     THEN 'Former Agency'
    WHEN 'enterprise' THEN 'Former Enterprise User'
    WHEN 'supplier'   THEN 'Former Supplier'
    ELSE 'Former User'
  END;

  -- ── ANONYMIZE PII in place (row + all linked records RETAINED; FKs stay valid) ──
  UPDATE public.profiles
     SET full_name          = v_label,
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

  -- ── Immutable audit (retained) ──
  INSERT INTO public.audit_events (event_type, severity, actor_id, actor_role, actor_label,
                                   subject_table, subject_id, job_id, summary, delta, metadata)
  VALUES ('account.deletion_requested', 'warning', v_uid, 'system', 'Self-service account deletion',
          'profiles', v_uid, NULL,
          'Account anonymized + soft-deleted on user request; PII scrubbed, business/financial/contract/audit records retained under legal basis.',
          '{}'::jsonb, jsonb_build_object('anonymized', true, 'tombstone_label', v_label, 'role', v_role));

  RETURN jsonb_build_object('ok', true, 'user_id', v_uid, 'anonymized', true, 'tombstone', v_label);
END $fn$;
ALTER FUNCTION public.request_account_deletion() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.request_account_deletion() FROM public;
GRANT EXECUTE ON FUNCTION public.request_account_deletion() TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. AI DATASET PROVENANCE — smallest safe extension (additive, empty)
--    Tracks, per retained technical record, the facts a defensible AI/ML
--    retention program needs: source, subject linkage (nullable after de-id),
--    de-identification state, the legal basis (which agreement + version
--    granted the license), dataset version, and retention status. No data is
--    migrated/backfilled here — provenance is written going forward by the
--    AI pipeline. Kept deliberately minimal.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_dataset_provenance (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind        text        NOT NULL CHECK (source_kind IN ('ai_detection','inspection_capture','asset_defect_observation','finding','report')),
  source_id          uuid        NOT NULL,
  subject_uid        uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,   -- nulled on de-id / owner-delete-restrict-safe
  deidentified       boolean     NOT NULL DEFAULT false,
  deidentified_at    timestamptz,
  legal_basis_doc    text,                                            -- e.g. 'INSP-AGR-001'
  legal_basis_version text,                                           -- e.g. '1.1'
  dataset_version    text,                                            -- e.g. 'corrosion-v3'
  retention_status   text        NOT NULL DEFAULT 'eligible'
                                  CHECK (retention_status IN ('eligible','retained','purged','withheld')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);
COMMENT ON TABLE public.ai_dataset_provenance IS
  'Provenance + legal-basis + de-identification + retention state for technical records eligible for AI/ML retention. Additive; written by the AI pipeline going forward.';

ALTER TABLE public.ai_dataset_provenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_dataset_provenance FROM anon, authenticated;
-- Admin read-only policy (service_role bypasses RLS for the pipeline writes).
DROP POLICY IF EXISTS ai_prov_admin_read ON public.ai_dataset_provenance;
CREATE POLICY ai_prov_admin_read ON public.ai_dataset_provenance
  FOR SELECT TO authenticated
  USING (public.nx_is_admin(auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. SELF-TESTS
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.request_account_deletion()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: request_account_deletion missing';
  END IF;
  IF to_regprocedure('public.nx_is_platform_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: nx_is_platform_owner missing';
  END IF;
  IF to_regprocedure('public.nx_active_super_admin_count()') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: nx_active_super_admin_count missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_nx_protect_privileged_profiles') THEN
    RAISE EXCEPTION 'SELFTEST: profiles guard trigger missing';
  END IF;
  IF to_regclass('public.platform_owner') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: platform_owner table missing';
  END IF;
  IF to_regclass('public.ai_dataset_provenance') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: ai_dataset_provenance table missing';
  END IF;
  IF to_regprocedure('public.seed_platform_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: seed_platform_owner missing';
  END IF;
  IF to_regprocedure('public.transfer_platform_owner(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: transfer_platform_owner missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_platform_owner_immutable') THEN
    RAISE EXCEPTION 'SELFTEST: platform_owner immutability trigger missing';
  END IF;
  -- least-privilege: seeder/transfer must NOT be executable by authenticated.
  IF has_function_privilege('authenticated', 'public.seed_platform_owner(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: seed_platform_owner must not be EXECUTE-able by authenticated';
  END IF;
  IF has_function_privilege('authenticated', 'public.transfer_platform_owner(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST: transfer_platform_owner must not be EXECUTE-able by authenticated';
  END IF;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
--  POST-APPLY MANUAL STEP (once, after review) — run as service_role:
--    SELECT public.seed_platform_owner('<the-owner-profiles-uuid>');
--  Verify:
--    SELECT public.nx_is_platform_owner('<uuid>');            -- expect true
--    SELECT public.nx_active_super_admin_count();             -- expect >= 1
--  A SECOND seed call is rejected (PLATFORM_OWNER_ALREADY_SET). To change the
--  owner later, use the audited transfer (service_role only):
--    SELECT public.transfer_platform_owner('<new-uuid>', 'reason >= 8 chars');
-- ════════════════════════════════════════════════════════════════════════════
