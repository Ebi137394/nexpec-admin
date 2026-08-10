-- ════════════════════════════════════════════════════════════════════════════
--  20260801350000_current_job_inspector_engagement_aware.sql
--
--  ROOT CAUSE. nx_supplier_inspector_chat_authorized (20260801340000) requires
--  BOTH of:
--     nx_is_job_supplier(job, supplier)     -- satisfied only via brokered
--                                              artifacts (supplier_contracts,
--                                              or the accepted quote on
--                                              jobs.source_rfq_id)
--     is_active_contract_inspector(job, insp) -- reads public.job_contracts only
--
--  and tg_job_contracts_reject_brokered_job() forbids job_contracts on any job
--  with source_rfq_id IS NOT NULL. The two conditions are therefore mutually
--  exclusive: supplier↔inspector chat was structurally unreachable on exactly
--  the jobs it exists for. The pgTAP suites only appeared to work because their
--  fixtures wrote an illegal job_contracts row onto a brokered job, which that
--  trigger correctly rejected the moment it ran.
--
--  NEXPEC has TWO legitimate inspector engagement models, and the gate knew
--  only one:
--     Marketplace  source_rfq_id IS NULL      → public.job_contracts
--     Brokered     source_rfq_id IS NOT NULL  → deals → agreements
--                                               (+ inspector_engagement_meta)
--
--  ── THE CANONICAL BROKERED ANSWER (not invented — reused) ──────────────────
--  public.release_inspector_payout() is the strongest shipped precedent, and it
--  is the MONEY path, so chat authority now agrees with payout authority:
--
--      SELECT * INTO v_a FROM public.agreements
--       WHERE deal_id = p_deal_id AND kind = 'inspector_engagement'
--         AND status <> 'voided'
--       ORDER BY version DESC LIMIT 1;
--      IF v_a.status <> 'executed' THEN RAISE 'CONTRACT-BEFORE-MONEY: ...';
--
--  "Current engagement" = latest non-voided version, which must then be
--  'executed'. _apply_revision marks the superseded row 'amended' and inserts a
--  higher version, so ORDER BY version DESC naturally follows revisions and an
--  older 'amended' row can never win.
--
--  ── WHY jobs.contractor_id ALONE IS NOT ENOUGH ─────────────────────────────
--  _brokered_create_engagement writes jobs.contractor_id at PRESENTED time,
--  before the inspector has signed, and no shipped trigger guarantees a
--  void/cancel clears that pointer. Authorizing from it alone would (a) open
--  the supplier channel before the inspector ever accepted, and (b) leave a
--  revoked inspector with live access. It is used here only as a consistency
--  cross-check, never as the authority.
--
--  ── FAIL CLOSED ON DISAGREEMENT ────────────────────────────────────────────
--  The three brokered records must agree: the job pointer, the current
--  agreement's counterparty, and inspector_engagement_meta. Any divergence —
--  which item G of this work order shows is reachable — denies access rather
--  than picking a winner. A split-brain engagement is exactly when the platform
--  should NOT be opening a private channel.
--
--  ── DEAL STATUS ────────────────────────────────────────────────────────────
--  From CONSTRAINT deals_status_check, verbatim:
--      forming | awaiting_client_signature | funded | dispatched
--      | in_delivery | closed | cancelled
--  Only 'cancelled' is treated as revoking. 'closed' stays permitted, matching
--  340000's contract that a COMPLETED engagement still allows operational chat.
--  No status value is invented here.
--
--  ── SCOPE ──────────────────────────────────────────────────────────────────
--  Buyer↔Inspector (nx_direct_chat_authorized) and Buyer↔Supplier
--  (nx_buyer_supplier_chat_authorized) are NOT touched. Buyer↔Supplier never
--  consults an inspector, so the engagement-model conflict cannot arise there.
--  is_active_contract_inspector is NOT modified — it is delegated to.
--  Media needs no change: nx_can_access_doc already routes supplier-inspector
--  attachments through nx_supplier_inspector_chat_authorized, so stale media
--  fails automatically once the gate is correct.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The canonical "is this the current inspector for this job?" helper ───
CREATE OR REPLACE FUNCTION public.nx_is_current_job_inspector(
  p_job_id       uuid,
  p_inspector_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job RECORD;
  v_a   RECORD;
BEGIN
  IF p_job_id IS NULL OR p_inspector_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, source_rfq_id, contractor_id INTO v_job
    FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- ── MARKETPLACE: delegate, never reimplement ─────────────────────────────
  IF v_job.source_rfq_id IS NULL THEN
    RETURN public.is_active_contract_inspector(p_job_id, p_inspector_id);
  END IF;

  -- ── BROKERED ─────────────────────────────────────────────────────────────
  -- The job's live pointer must name this inspector. Necessary, not sufficient.
  IF v_job.contractor_id IS DISTINCT FROM p_inspector_id THEN
    RETURN false;
  END IF;

  -- Current inspector engagement, resolved exactly as release_inspector_payout
  -- resolves it: latest non-voided version on a non-cancelled deal for this job.
  SELECT a.id, a.status, a.counterparty_id
    INTO v_a
    FROM public.agreements a
    JOIN public.deals d ON d.id = a.deal_id
   WHERE d.job_id = p_job_id
     AND COALESCE(d.status, '') <> 'cancelled'
     AND a.kind = 'inspector_engagement'
     AND a.status <> 'voided'
   ORDER BY a.version DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN false;                      -- no engagement at all
  END IF;

  -- Presented / signed / countersigned are NOT enough. Operational contact with
  -- the supplier begins only once the inspector engagement is EXECUTED.
  IF v_a.status <> 'executed' THEN
    RETURN false;
  END IF;

  IF v_a.counterparty_id IS DISTINCT FROM p_inspector_id THEN
    RETURN false;                      -- agreement names a different inspector
  END IF;

  -- The disclosure record must corroborate the same inspector on the same
  -- agreement. _brokered_create_engagement can leave these disagreeing, so the
  -- cross-check is load-bearing rather than decorative.
  IF NOT EXISTS (
    SELECT 1 FROM public.inspector_engagement_meta m
     WHERE m.agreement_id = v_a.id
       AND m.inspector_id = p_inspector_id
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;
ALTER FUNCTION public.nx_is_current_job_inspector(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_is_current_job_inspector(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_is_current_job_inspector(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_is_current_job_inspector(uuid, uuid) IS
  'THE single answer to "is this user the currently authorized inspector for this job", dispatching on the job''s engagement model. Marketplace (source_rfq_id IS NULL) delegates to is_active_contract_inspector. Brokered requires the job pointer, the CURRENT inspector_engagement agreement (latest non-voided version, resolved exactly as release_inspector_payout resolves it) to be status=executed and to name this inspector, a corroborating inspector_engagement_meta row, and a non-cancelled deal. Fails closed on any disagreement between the three records.';

-- ── 2. Point the supplier↔inspector gate at it ──────────────────────────────
--  Only the inspector predicate changes. Supplier relationship, party check,
--  lifecycle window and identity-mode independence are all preserved verbatim.
CREATE OR REPLACE FUNCTION public.nx_supplier_inspector_chat_authorized(
  p_job_id       uuid,
  p_inspector_id uuid,
  p_supplier_id  uuid,
  p_uid          uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.jobs j
     WHERE j.id = p_job_id
       AND p_uid IS NOT NULL
       AND p_inspector_id IS NOT NULL
       AND p_supplier_id  IS NOT NULL
       -- only the two parties themselves; the buyer is NOT in this room
       AND (p_uid = p_inspector_id OR p_uid = p_supplier_id)
       -- ★ engagement-model aware (20260801350000), replacing the
       --   marketplace-only is_active_contract_inspector that made this gate
       --   unsatisfiable on brokered jobs.
       AND public.nx_is_current_job_inspector(p_job_id, p_inspector_id)
       AND public.nx_is_job_supplier(p_job_id, p_supplier_id)
       AND COALESCE(j.status, '') NOT IN ('cancelled', 'paid')
  );
$$;
COMMENT ON FUNCTION public.nx_supplier_inspector_chat_authorized(uuid, uuid, uuid, uuid) IS
  'THE authority for operational supplier↔inspector chat. Caller must BE one of the two parties; the inspector must be current under whichever engagement model owns the job (nx_is_current_job_inspector); the supplier must be attached to that job; the job must be non-terminal. Deliberately does NOT consult identity_mode. Consulted by RLS, send_message, the RPCs and nx_can_access_doc, so message and media authorization revoke together.';

-- ── 3. Self-tests ───────────────────────────────────────────────────────────
--  ── WHY THESE GUARDS STRIP COMMENTS FIRST ──────────────────────────────────
--  pg_proc.prosrc contains the function body INCLUDING its comments, so a
--  bare-identifier regex matches prose. The first version of this block raised
--  'the supplier channel still calls the marketplace-only predicate' against a
--  body whose only occurrence of that name was the comment explaining that it
--  had been REPLACED — a pure false positive that aborted the migration.
--  (Same trap as 20260801326000; documented here so it is not re-learned.)
--
--  Every check below therefore runs against v_code = prosrc with `--` line
--  comments stripped, and every "must call X" check matches a CALL shape
--  (identifier immediately followed by an open paren) rather than a bare
--  identifier. A comment can no longer satisfy or break a guard, while
--  executable code that reintroduces is_active_contract_inspector(...) inside
--  the supplier gate still fails the migration.
--
--  The behavioural proof below remains the primary authority; these are
--  regression tripwires, not the specification.
-- (Implemented inline below rather than via a pg_temp helper: creating a
--  function inside the migration transaction is an avoidable failure surface.)

DO $verify$
DECLARE
  v text;
  -- prosrc with `--` line comments removed. None of the bodies inspected here
  -- contain '--' inside a string literal.
BEGIN
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.nx_supplier_inspector_chat_authorized(uuid,uuid,uuid,uuid)'::regprocedure;
  IF v ~ 'is_active_contract_inspector\s*\(' THEN
    RAISE EXCEPTION 'GATE: the supplier channel still CALLS the marketplace-only predicate directly';
  END IF;
  IF v !~ 'nx_is_current_job_inspector\s*\(' THEN
    RAISE EXCEPTION 'GATE: the supplier channel does not call the engagement-aware helper';
  END IF;
  IF v ~* 'identity_mode' THEN
    RAISE EXCEPTION 'DESIGN: the operational gate must not consult identity_mode';
  END IF;
  IF v !~ 'nx_is_job_supplier\s*\(' THEN
    RAISE EXCEPTION 'GATE: the supplier relationship requirement was lost';
  END IF;

  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.nx_is_current_job_inspector(uuid,uuid)'::regprocedure;
  IF v !~ 'is_active_contract_inspector\s*\(' THEN
    RAISE EXCEPTION 'HELPER: marketplace authority must be DELEGATED, not reimplemented';
  END IF;
  IF v !~ '''executed''' THEN
    RAISE EXCEPTION 'HELPER: a brokered engagement must be required to be executed';
  END IF;
  IF v !~ 'inspector_engagement_meta' THEN
    RAISE EXCEPTION 'HELPER: the engagement-meta cross-check is missing';
  END IF;
  IF v !~ 'version DESC' THEN
    RAISE EXCEPTION 'HELPER: the current agreement is not resolved by latest version';
  END IF;
  -- Only real deals_status_check values may appear as quoted literals.
  IF v ~* '''(active|void|revoked|terminated|ended|open)''' THEN
    RAISE EXCEPTION 'HELPER: an invented deal status literal is present';
  END IF;

  -- Marketplace authority itself must be untouched.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.is_active_contract_inspector(uuid,uuid)'::regprocedure;
  IF v !~ 'job_contracts' THEN
    RAISE EXCEPTION 'REGRESSION: is_active_contract_inspector was altered';
  END IF;

  -- Buyer↔Inspector must be untouched by this migration.
  SELECT regexp_replace(prosrc, '--[^\n]*', '', 'g') INTO v FROM pg_proc
   WHERE oid = 'public.nx_direct_chat_authorized(uuid,uuid,uuid)'::regprocedure;
  IF v !~ 'nx_job_effective_identity_mode\s*\(' THEN
    RAISE EXCEPTION 'REGRESSION: buyer↔inspector lost its live identity-mode requirement';
  END IF;
  IF v !~ 'is_active_contract_inspector\s*\(' THEN
    RAISE EXCEPTION 'REGRESSION: buyer↔inspector inspector authority changed';
  END IF;

  -- The brokered guard must remain.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_job_contracts_reject_brokered_job' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'REGRESSION: tg_job_contracts_reject_brokered_job was removed';
  END IF;
END
$verify$;

-- ── 4. Behavioural proof over a REAL brokered engagement ────────────────────
--  Builds RFQ → quote → deal → brokered job → agreement → engagement meta with
--  no job_contracts anywhere, then walks the authority states.
DO $behaviour$
--  ── FIXTURE ISOLATION ──────────────────────────────────────────────────────
--  Every id is generated. The first version used hard-coded literals and
--  collided with rows left by earlier migration proofs in the same reset.
--
--  ── CLEANUP MUST FOLLOW RELATIONSHIPS, NOT THE INSERT LIST ─────────────────
--  Inserting a supplier_quotes row with status='accepted' fires
--  trg_zz_autocontract_on_quote_insert → _brokered_ensure_supplier_contract(),
--  which creates rows this block never wrote:
--      • a SECOND deal (awarded_quote_id = the quote)
--      • agreements kind='supplier_supply' (counterparty = supplier)
--      • agreements kind='client_supply'   (counterparty = the BUYER)  ← this
--        is what held agreements_counterparty_id_fkey against the buyer profile
--      • a supplier_contracts row
--  Deleting only what was explicitly inserted therefore left FK-bearing
--  side-effect rows behind. Cleanup below collects every deal reachable from
--  the fixture job / rfq / quote / buyer and unwinds those first, then asserts
--  that nothing still references the fixture principals before removing them.
DECLARE
  v_pre       RECORD;
  v_pre_email text;
  v_pre_role  text;
  v_buyer uuid := gen_random_uuid();
  v_sup   uuid := gen_random_uuid();
  v_i1    uuid := gen_random_uuid();
  v_i2    uuid := gen_random_uuid();
  v_rfq   uuid := gen_random_uuid();
  v_quote uuid := gen_random_uuid();
  v_job   uuid := gen_random_uuid();
  v_deal  uuid := gen_random_uuid();
  v_agr1  uuid := gen_random_uuid();
  v_agr2  uuid := gen_random_uuid();
  v_tag   text := 'nx350-' || replace(gen_random_uuid()::text, '-', '') || '@selftest.nx';
  v_deals uuid[];
  v_left  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at) VALUES
    (v_buyer,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','b.'||v_tag,now(),now()),
    (v_sup,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated','s.'||v_tag,now(),now()),
    (v_i1,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i1.'||v_tag,now(),now()),
    (v_i2,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated','i2.'||v_tag,now(),now());
  INSERT INTO public.profiles (id, email, role) VALUES
    (v_buyer,'b.'||v_tag,'client'), (v_sup,'s.'||v_tag,'supplier'),
    (v_i1,'i1.'||v_tag,'inspector'), (v_i2,'i2.'||v_tag,'inspector')
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
  FOR v_pre IN SELECT * FROM (VALUES (v_buyer,'b.'||v_tag,'client'), (v_sup,'s.'||v_tag,'supplier'),
    (v_i1,'i1.'||v_tag,'inspector'), (v_i2,'i2.'||v_tag,'inspector')) AS t(id, email, role)
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


  INSERT INTO public.supplier_profiles (id, legal_name) VALUES (v_sup, 'Selftest Forge 350000')
    -- Same generated-id reasoning as the profiles upsert above: supplier_profiles
    -- is keyed on the principal id, so any Production trigger that derives a
    -- supplier record from a role='supplier' profile would collide here too.
    ON CONFLICT (id) DO UPDATE SET legal_name = EXCLUDED.legal_name;
  INSERT INTO public.supplier_rfqs (id, client_id, title, status, requires_source_inspection)
  VALUES (v_rfq, v_buyer, 'selftest rfq 350000', 'awarded', true);

  -- Brokered job: source_rfq_id set, NO job_contracts (the trigger forbids it).
  INSERT INTO public.jobs (id, title, client_id, status, moderation_status, source_rfq_id, contractor_id)
  VALUES (v_job, 'brokered selftest 350000', v_buyer, 'in_progress', 'approved', v_rfq, v_i1);
  UPDATE public.supplier_rfqs SET spawned_job_id = v_job WHERE id = v_rfq;

  -- This INSERT fires the autocontract trigger described above.
  INSERT INTO public.supplier_quotes (id, rfq_id, supplier_id, quote, status)
  VALUES (v_quote, v_rfq, v_sup, '{}'::jsonb, 'accepted');

  INSERT INTO public.deals (id, rfq_id, job_id, client_id, status, currency)
  VALUES (v_deal, v_rfq, v_job, v_buyer, 'dispatched', 'USD');

  -- (1) PRESENTED only → DENIED. Supplier contact must not begin before the
  --     inspector has actually accepted the engagement.
  INSERT INTO public.agreements (id, deal_id, kind, status, counterparty_id, version, amount_cents, currency)
  VALUES (v_agr1, v_deal, 'inspector_engagement', 'presented', v_i1, 1, 100000, 'USD');
  INSERT INTO public.inspector_engagement_meta (agreement_id, deal_id, inspector_id)
  VALUES (v_agr1, v_deal, v_i1);

  IF public.nx_is_current_job_inspector(v_job, v_i1) THEN
    RAISE EXCEPTION 'SELFTEST: a merely PRESENTED engagement authorized the inspector';
  END IF;

  -- (2) EXECUTED → allowed.
  UPDATE public.agreements SET status = 'executed' WHERE id = v_agr1;
  IF NOT public.nx_is_current_job_inspector(v_job, v_i1) THEN
    RAISE EXCEPTION 'SELFTEST: an EXECUTED brokered engagement was not authorized';
  END IF;
  IF NOT public.nx_supplier_inspector_chat_authorized(v_job, v_i1, v_sup, v_sup) THEN
    RAISE EXCEPTION 'SELFTEST: the supplier cannot reach its own inspection inspector';
  END IF;
  IF public.nx_supplier_inspector_chat_authorized(v_job, v_i1, v_sup, v_buyer) THEN
    RAISE EXCEPTION 'SELFTEST: the BUYER is a party to the operational room';
  END IF;

  -- (3) VOIDED, with the job pointer left stale → DENIED.
  UPDATE public.agreements SET status = 'voided' WHERE id = v_agr1;
  IF public.nx_is_current_job_inspector(v_job, v_i1) THEN
    RAISE EXCEPTION 'SELFTEST: a VOIDED engagement still authorized (stale jobs.contractor_id trusted)';
  END IF;

  -- (4) Superseded: v1 amended, v2 executed for a NEW inspector.
  UPDATE public.agreements SET status = 'amended' WHERE id = v_agr1;
  INSERT INTO public.agreements (id, deal_id, kind, status, counterparty_id, version, amount_cents, currency)
  VALUES (v_agr2, v_deal, 'inspector_engagement', 'executed', v_i2, 2, 100000, 'USD');
  INSERT INTO public.inspector_engagement_meta (agreement_id, deal_id, inspector_id)
  VALUES (v_agr2, v_deal, v_i2);
  UPDATE public.jobs SET contractor_id = v_i2 WHERE id = v_job;

  IF public.nx_is_current_job_inspector(v_job, v_i1) THEN
    RAISE EXCEPTION 'SELFTEST: the SUPERSEDED inspector is still current';
  END IF;
  IF NOT public.nx_is_current_job_inspector(v_job, v_i2) THEN
    RAISE EXCEPTION 'SELFTEST: the replacement inspector is not current';
  END IF;

  -- (5) Split brain: pointer says i1, current agreement says i2 → DENY BOTH.
  UPDATE public.jobs SET contractor_id = v_i1 WHERE id = v_job;
  IF public.nx_is_current_job_inspector(v_job, v_i1)
     OR public.nx_is_current_job_inspector(v_job, v_i2) THEN
    RAISE EXCEPTION 'SELFTEST: a split-brain engagement authorized someone';
  END IF;
  UPDATE public.jobs SET contractor_id = v_i2 WHERE id = v_job;

  -- (6) Cancelled deal → DENIED even with an executed agreement.
  UPDATE public.deals SET status = 'cancelled' WHERE id = v_deal;
  IF public.nx_is_current_job_inspector(v_job, v_i2) THEN
    RAISE EXCEPTION 'SELFTEST: a CANCELLED deal still authorized the inspector';
  END IF;
  UPDATE public.deals SET status = 'closed' WHERE id = v_deal;
  IF NOT public.nx_is_current_job_inspector(v_job, v_i2) THEN
    RAISE EXCEPTION 'SELFTEST: a CLOSED (completed) deal should still allow operational chat';
  END IF;

  -- ── FK-SAFE CLEANUP, FIXTURE-SCOPED ──────────────────────────────────────
  -- Every deal reachable from this fixture, including the one the autocontract
  -- trigger created. Scoped strictly to fixture ids — nothing global.
  SELECT COALESCE(array_agg(DISTINCT d.id), '{}')
    INTO v_deals
    FROM public.deals d
   WHERE d.job_id = v_job
      OR d.rfq_id = v_rfq
      OR d.awarded_quote_id = v_quote
      OR d.client_id = v_buyer;

  DELETE FROM public.deal_money_legs          WHERE deal_id = ANY(v_deals);
  DELETE FROM public.inspector_engagement_meta WHERE deal_id = ANY(v_deals);
  DELETE FROM public.agreements               WHERE deal_id = ANY(v_deals)
                                                 OR counterparty_id IN (v_buyer, v_sup, v_i1, v_i2);
  DELETE FROM public.supplier_contracts       WHERE rfq_id = v_rfq
                                                 OR job_id = v_job
                                                 OR supplier_id = v_sup
                                                 OR quote_id = v_quote;
  DELETE FROM public.deals                    WHERE id = ANY(v_deals);
  DELETE FROM public.supplier_quotes          WHERE rfq_id = v_rfq OR supplier_id = v_sup;
  UPDATE public.supplier_rfqs SET spawned_job_id = NULL WHERE id = v_rfq;
  DELETE FROM public.conversations            WHERE job_id = v_job;
  DELETE FROM public.jobs                     WHERE id = v_job;
  DELETE FROM public.supplier_rfqs            WHERE id = v_rfq;
  DELETE FROM public.supplier_profiles        WHERE id = v_sup;
  DELETE FROM public.notifications            WHERE recipient_id IN (v_buyer, v_sup, v_i1, v_i2);

  -- Prove no FK still points at the fixture principals BEFORE removing them,
  -- so an unexpected side-effect row reports itself instead of surfacing as an
  -- opaque constraint violation.
  SELECT count(*) INTO v_left FROM public.agreements
   WHERE counterparty_id IN (v_buyer, v_sup, v_i1, v_i2);
  IF v_left > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % agreement row(s) still reference fixture principals after cleanup', v_left;
  END IF;
  SELECT count(*) INTO v_left FROM public.deals WHERE client_id IN (v_buyer, v_sup, v_i1, v_i2);
  IF v_left > 0 THEN
    RAISE EXCEPTION 'SELFTEST: % deal row(s) still reference fixture principals after cleanup', v_left;
  END IF;

  DELETE FROM public.profiles WHERE id IN (v_buyer, v_sup, v_i1, v_i2);
  DELETE FROM auth.users      WHERE id IN (v_buyer, v_sup, v_i1, v_i2);

  IF EXISTS (SELECT 1 FROM public.jobs WHERE id = v_job)
     OR EXISTS (SELECT 1 FROM public.supplier_rfqs WHERE id = v_rfq)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id IN (v_buyer, v_sup, v_i1, v_i2))
     OR EXISTS (SELECT 1 FROM auth.users WHERE id IN (v_buyer, v_sup, v_i1, v_i2))
     OR EXISTS (SELECT 1 FROM public.deals WHERE job_id = v_job)
     OR EXISTS (SELECT 1 FROM public.agreements WHERE counterparty_id IN (v_buyer, v_sup, v_i1, v_i2)) THEN
    RAISE EXCEPTION 'SELFTEST: the behavioural proof left LIVE fixture rows behind';
  END IF;

  RAISE NOTICE 'Brokered inspector authority verified: presented denied, executed allowed, voided/superseded/split-brain/cancelled all denied; fixtures removed.';
END
$behaviour$;

COMMIT;
