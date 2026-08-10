-- ════════════════════════════════════════════════════════════════════════════
--  20260801352000_brokered_engagement_no_silent_reassign.sql
--
--  REAL DEFECT (reachable, pre-existing, found while fixing the supplier chat
--  gate). public._brokered_create_engagement() can be called a second time on a
--  deal whose inspector_engagement agreement is already EXECUTED, and it then
--  leaves three records disagreeing about who the inspector is:
--
--    SELECT id INTO v_agr_id FROM agreements
--     WHERE deal_id = … AND kind='inspector_engagement' AND status <> 'voided'
--     ORDER BY version DESC LIMIT 1;
--    …
--    UPDATE agreements SET counterparty_id = p_inspector_id, …
--     WHERE id = v_agr_id AND status <> 'executed';   -- ← NO-OP when executed
--    …
--    UPDATE jobs SET contractor_id = p_inspector_id …  -- ← ALWAYS runs
--    INSERT INTO inspector_engagement_meta … ON CONFLICT DO UPDATE
--      SET inspector_id = EXCLUDED.inspector_id;       -- ← ALWAYS runs
--
--  Result: agreement = OLD inspector, jobs.contractor_id = NEW, engagement meta
--  = NEW. The executed contract silently stops describing reality while the
--  operational records move on.
--
--  ── REACHABILITY (traced, not assumed) ─────────────────────────────────────
--  Three shipped public wrappers reach it, all in the baseline:
--    admin_assign_inspector(deal, inspector, payout, routing)   → broker path
--    the algorithmic_match wrapper                              → auto path
--    the client_selection wrapper                               → client path
--  None of them checks for an already-executed engagement first.
--
--  ── WHY THIS MATTERS BEYOND CHAT ───────────────────────────────────────────
--  release_inspector_payout() pays whoever the latest non-voided agreement
--  names. jobs.contractor_id is what most job-party authorization reads. After
--  a silent re-assign, the platform can pay inspector A while inspector B holds
--  operational access — a money/authority split, not merely a chat bug.
--
--  ── THE FIX: REJECT ATOMICALLY, BEFORE ANY WRITE ───────────────────────────
--  The repository has no post-execution brokered replacement flow (there is no
--  _brokered_void_engagement, and admin_replace_inspector is Marketplace-only —
--  it refuses source_rfq_id jobs). Inventing one here would be a large new
--  subsystem, which this change deliberately is not. So the guard fails closed:
--  a second engagement naming a DIFFERENT inspector, while an executed one
--  exists, raises before anything is written. Re-issuing the SAME inspector
--  (idempotent retry, payout correction) still works.
--
--  Replacing a brokered inspector after execution therefore remains an
--  explicitly unsupported operation that now errors loudly instead of
--  corrupting state. Building the void/supersede flow is a separate decision.
--
--  ── SCOPE ──────────────────────────────────────────────────────────────────
--  Only _brokered_create_engagement gains a precondition. No wrapper, no
--  agreement/deal lifecycle, no chat gate, no marketplace path is changed. The
--  rest of the function body is preserved verbatim from the baseline.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.nx_brokered_engagement_conflict(
  p_deal_id      uuid,
  p_inspector_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- True when this deal already has an EXECUTED inspector engagement naming a
  -- DIFFERENT inspector. Resolves "current" exactly as release_inspector_payout
  -- and nx_is_current_job_inspector do: latest non-voided version.
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT a.status, a.counterparty_id
        FROM public.agreements a
       WHERE a.deal_id = p_deal_id
         AND a.kind = 'inspector_engagement'
         AND a.status <> 'voided'
       ORDER BY a.version DESC
       LIMIT 1
    ) cur
     WHERE cur.status = 'executed'
       AND cur.counterparty_id IS DISTINCT FROM p_inspector_id
  );
$$;
ALTER FUNCTION public.nx_brokered_engagement_conflict(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_brokered_engagement_conflict(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_brokered_engagement_conflict(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_brokered_engagement_conflict(uuid, uuid) IS
  'True when a deal already has an EXECUTED inspector_engagement naming a different inspector. Guards _brokered_create_engagement against silently re-pointing jobs.contractor_id and inspector_engagement_meta while the executed agreement (and therefore release_inspector_payout) still names the previous inspector.';

-- ── The guard, as a BEFORE trigger on the records that would diverge ────────
--  Implemented as a trigger rather than by rewriting the baseline function, so
--  the precondition holds for EVERY writer — the three shipped wrappers, any
--  future one, and direct admin SQL alike. Rewriting only the function would
--  leave the invariant dependent on callers remembering to use it.
CREATE OR REPLACE FUNCTION public.tg_engagement_meta_reject_reassign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.nx_brokered_engagement_conflict(NEW.deal_id, NEW.inspector_id) THEN
    RAISE EXCEPTION
      'BROKERED_ENGAGEMENT_LOCKED: deal % already has an EXECUTED inspector engagement for a different inspector; re-assignment after execution is not supported. Void or supersede the existing agreement first.',
      NEW.deal_id
      USING ERRCODE = '42501',
            HINT = 'Replacing a brokered inspector post-execution has no shipped flow. admin_replace_inspector is Inspection Marketplace only.';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.tg_engagement_meta_reject_reassign() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_engagement_meta_reject_reassign ON public.inspector_engagement_meta;
CREATE TRIGGER trg_engagement_meta_reject_reassign
  BEFORE INSERT OR UPDATE OF inspector_id ON public.inspector_engagement_meta
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_engagement_meta_reject_reassign();

COMMENT ON TRIGGER trg_engagement_meta_reject_reassign ON public.inspector_engagement_meta IS
  'Fails a brokered engagement write that would point the meta at a different inspector than the deal''s EXECUTED agreement. _brokered_create_engagement''s agreement UPDATE carries AND status <> ''executed'' and therefore no-ops post-execution, while its jobs.contractor_id UPDATE and this meta upsert do not — producing a split-brain engagement. Raising here rejects the whole statement before any record diverges.';

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_engagement_meta_reject_reassign' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: the re-assignment guard trigger is missing';
  END IF;
  -- Everything this migration must NOT have touched.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_job_contracts_reject_brokered_job' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'REGRESSION: the brokered job_contracts guard was disturbed';
  END IF;
  IF to_regprocedure('public.nx_is_current_job_inspector(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ORDERING: 350000 must apply before 352000';
  END IF;
END
$verify$;

-- ── Behavioural proof ───────────────────────────────────────────────────────
DO $behaviour$
--  Fixture ids are GENERATED, not literal: hard-coded ids collide with rows
--  left by other migration proofs in the same reset, and make the proof
--  non-idempotent. Cleanup below follows relationships so trigger-created
--  side-effect rows are unwound too (see 350000 for the same discipline).
DECLARE
  v_pre       RECORD;
  v_pre_email text;
  v_pre_role  text;
  v_buyer uuid := gen_random_uuid();
  v_i1    uuid := gen_random_uuid();
  v_i2    uuid := gen_random_uuid();
  v_rfq   uuid := gen_random_uuid();
  v_job   uuid := gen_random_uuid();
  v_deal  uuid := gen_random_uuid();
  v_agr   uuid := gen_random_uuid();
  v_agr2  uuid := gen_random_uuid();
  v_tag   text := 'nx352-' || replace(gen_random_uuid()::text, '-', '') || '@selftest.nx';
  v_deals uuid[];
  v_left  int;
  v_ok    boolean;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
    (v_buyer,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','b.'||v_tag,now(),now()),
    (v_i1,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i1.'||v_tag,now(),now()),
    (v_i2,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i2.'||v_tag,now(),now());
  INSERT INTO public.profiles (id, email, role) VALUES
    (v_buyer,'b.'||v_tag,'client'), (v_i1,'i1.'||v_tag,'inspector'), (v_i2,'i2.'||v_tag,'inspector')
  -- ── PRODUCTION AUTH PROVISIONING ─────────────────────────────────────────
  --  Production provisions public.profiles automatically from auth.users (a
  --  handle_new_user-style trigger absent from a bare local stack). The
  --  auth.users INSERT above may therefore ALREADY have created these rows with
  --  a default role, so a bare INSERT hits profiles_pkey. DO UPDATE (never DO
  --  NOTHING) is correct and safe here for one specific reason: every id is
  --  gen_random_uuid() minted inside THIS transaction and its auth.users INSERT
  --  just succeeded, so the only row that can possibly conflict is the one the
  --  provisioning trigger just derived from our own fixture. DO NOTHING would
  --  silently leave the provisioned default role in place — which is exactly how
  --  the first Production attempt produced a false 'admin lost access' failure.
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role  = EXCLUDED.role;

  -- ── FIXTURE PRECONDITION: every generated principal, not just admin ───────
  --  Asserted BEFORE any product assertion, so a provisioning difference can
  --  never be misread as a product regression.
  FOR v_pre IN SELECT * FROM (VALUES (v_buyer,'b.'||v_tag,'client'), (v_i1,'i1.'||v_tag,'inspector'), (v_i2,'i2.'||v_tag,'inspector')) AS t(id, email, role)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_pre.id) THEN
      RAISE EXCEPTION 'SELFTEST FIXTURE: auth.users row missing for generated % principal % — fixture/provisioning failure, not a product regression', v_pre.role, v_pre.id;
    END IF;
    SELECT p.email, p.role INTO v_pre_email, v_pre_role
      FROM public.profiles p WHERE p.id = v_pre.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SELFTEST FIXTURE: public.profiles row missing for generated % principal % — fixture/provisioning failure, not a product regression', v_pre.role, v_pre.id;
    END IF;
    IF v_pre_email IS DISTINCT FROM v_pre.email OR v_pre_role IS DISTINCT FROM v_pre.role THEN
      RAISE EXCEPTION 'SELFTEST FIXTURE: generated principal % resolved to email=% role=% but the fixture requires email=% role=% — an auth-provisioning trigger overwrote the fixture identity; this is a fixture/provisioning failure, not a product regression', v_pre.id, COALESCE(v_pre_email,'<null>'), COALESCE(v_pre_role,'<null>'), v_pre.email, v_pre.role;
    END IF;
  END LOOP;

  INSERT INTO public.supplier_rfqs (id, client_id, title, status, requires_source_inspection)
  VALUES (v_rfq, v_buyer, 'reassign selftest 352000', 'awarded', true);
  INSERT INTO public.jobs (id, title, client_id, status, moderation_status, source_rfq_id, contractor_id)
  VALUES (v_job, 'reassign selftest 352000', v_buyer, 'in_progress', 'approved', v_rfq, v_i1);
  INSERT INTO public.deals (id, rfq_id, job_id, client_id, status, currency)
  VALUES (v_deal, v_rfq, v_job, v_buyer, 'dispatched', 'USD');

  -- Presented: re-pointing is still allowed (nothing is contractually settled).
  INSERT INTO public.agreements (id, deal_id, kind, status, counterparty_id, version, amount_cents, currency)
  VALUES (v_agr, v_deal, 'inspector_engagement', 'presented', v_i1, 1, 100000, 'USD');
  INSERT INTO public.inspector_engagement_meta (agreement_id, deal_id, inspector_id)
  VALUES (v_agr, v_deal, v_i1);
  UPDATE public.inspector_engagement_meta SET inspector_id = v_i2 WHERE agreement_id = v_agr;
  IF (SELECT inspector_id FROM public.inspector_engagement_meta WHERE agreement_id = v_agr) <> v_i2 THEN
    RAISE EXCEPTION 'SELFTEST: pre-execution re-pointing was blocked, which is too strict';
  END IF;
  UPDATE public.inspector_engagement_meta SET inspector_id = v_i1 WHERE agreement_id = v_agr;

  -- Execute the engagement for i1.
  UPDATE public.agreements SET status = 'executed' WHERE id = v_agr;

  -- Same inspector re-issued → still allowed (idempotent retry / payout fix).
  UPDATE public.inspector_engagement_meta SET inspector_id = v_i1 WHERE agreement_id = v_agr;

  -- ★ THE FIX: a DIFFERENT inspector post-execution must be refused.
  BEGIN
    UPDATE public.inspector_engagement_meta SET inspector_id = v_i2 WHERE agreement_id = v_agr;
    v_ok := false;
  EXCEPTION WHEN insufficient_privilege THEN
    v_ok := true;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'SELFTEST: a post-execution inspector re-assignment was accepted — split brain is still reachable';
  END IF;

  -- The records must be unchanged after the refusal.
  IF (SELECT inspector_id FROM public.inspector_engagement_meta WHERE agreement_id = v_agr) <> v_i1
     OR (SELECT counterparty_id FROM public.agreements WHERE id = v_agr) <> v_i1 THEN
    RAISE EXCEPTION 'SELFTEST: the refusal was not atomic — records diverged anyway';
  END IF;

  -- A NEW superseding agreement (the supported pattern) still works: the older
  -- row is amended, so it is no longer "current" and the guard does not fire.
  UPDATE public.agreements SET status = 'amended' WHERE id = v_agr;
  INSERT INTO public.agreements (id, deal_id, kind, status, counterparty_id, version, amount_cents, currency)
  VALUES (v_agr2, v_deal, 'inspector_engagement', 'executed', v_i2, 2, 100000, 'USD');
  INSERT INTO public.inspector_engagement_meta (agreement_id, deal_id, inspector_id)
  VALUES (v_agr2, v_deal, v_i2);

  -- Relationship-scoped, FK-safe cleanup (same discipline as 350000).
  SELECT COALESCE(array_agg(DISTINCT d.id), '{}') INTO v_deals
    FROM public.deals d
   WHERE d.job_id = v_job OR d.rfq_id = v_rfq OR d.client_id = v_buyer;

  DELETE FROM public.deal_money_legs           WHERE deal_id = ANY(v_deals);
  DELETE FROM public.inspector_engagement_meta WHERE deal_id = ANY(v_deals);
  DELETE FROM public.agreements                WHERE deal_id = ANY(v_deals)
                                                  OR counterparty_id IN (v_buyer, v_i1, v_i2);
  DELETE FROM public.supplier_contracts        WHERE rfq_id = v_rfq OR job_id = v_job;
  DELETE FROM public.deals                     WHERE id = ANY(v_deals);
  UPDATE public.supplier_rfqs SET spawned_job_id = NULL WHERE id = v_rfq;
  DELETE FROM public.conversations             WHERE job_id = v_job;
  DELETE FROM public.jobs                      WHERE id = v_job;
  DELETE FROM public.supplier_rfqs             WHERE id = v_rfq;
  DELETE FROM public.notifications             WHERE recipient_id IN (v_buyer, v_i1, v_i2);

  SELECT count(*) INTO v_left FROM public.agreements
   WHERE counterparty_id IN (v_buyer, v_i1, v_i2);
  IF v_left > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % agreement row(s) still reference fixture principals after cleanup', v_left;
  END IF;

  DELETE FROM public.profiles WHERE id IN (v_buyer, v_i1, v_i2);
  DELETE FROM auth.users      WHERE id IN (v_buyer, v_i1, v_i2);

  IF EXISTS (SELECT 1 FROM public.jobs WHERE id = v_job)
     OR EXISTS (SELECT 1 FROM public.supplier_rfqs WHERE id = v_rfq)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN (v_buyer, v_i1, v_i2))
     OR EXISTS (SELECT 1 FROM auth.users WHERE id IN (v_buyer, v_i1, v_i2))
     OR EXISTS (SELECT 1 FROM public.deals WHERE job_id = v_job)
     OR EXISTS (SELECT 1 FROM public.agreements WHERE counterparty_id IN (v_buyer, v_i1, v_i2))
     OR EXISTS (SELECT 1 FROM public.inspector_engagement_meta WHERE inspector_id IN (v_i1, v_i2)) THEN
    RAISE EXCEPTION 'SELFTEST: the behavioural proof left LIVE fixture rows behind';
  END IF;

  RAISE NOTICE 'Brokered re-assignment guard verified: pre-execution flexible, post-execution refused atomically, supersession still works.';
END
$behaviour$;

COMMIT;
