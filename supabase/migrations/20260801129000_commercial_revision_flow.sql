-- ════════════════════════════════════════════════════════════════════════════
--  20260801129000_commercial_revision_flow.sql
--
--  THE COMMERCIAL REVISION LEDGER — a formal, audit-ready price-revision process
--  on the brokered-deal agreements spine. An arbitration docket, not a chat:
--  every move is a typed, reason-coded, sealed instrument; NEXPEC is the binding
--  arbiter; the moment both sides consent a superseding executed contract version
--  is auto-issued at the agreed figure (reusing the spine's version/supersedes).
--
--  Flow:  party opens a Revision Request on THEIR leg (proposed amount + reason
--         code + formal justification) → NEXPEC Accepts / Rejects / Counters →
--         party Accepts / Declines / Counters back (bounded rounds) → on mutual
--         consent the leg is superseded (old → amended) at the agreed amount.
--
--  Price-blindness: a client case lives entirely in client-price domain, a
--  supplier case in supplier-cost domain — the spread never crosses. RLS keys
--  both tables to counterparty_id = auth.uid() OR nx_is_admin().
--
--  Depends on: deals, agreements, agreement_signatures, _brokered_*_md templates,
--  _brokered_ensure_payment_schedule, notify_safe, nx_is_admin, extensions.digest.
--  Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. The case + the immutable sealed timeline ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.deal_revisions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id              uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  agreement_id         uuid NOT NULL REFERENCES public.agreements(id) ON DELETE CASCADE,
  kind                 text NOT NULL CHECK (kind IN ('client_supply','supplier_supply','inspector_engagement')),
  counterparty_id      uuid NOT NULL REFERENCES public.profiles(id),
  status               text NOT NULL DEFAULT 'requested'
                       CHECK (status IN ('requested','countered','applied','rejected','withdrawn')),
  reason_code          text NOT NULL CHECK (reason_code IN
                       ('scope_change','material_cost','schedule_change','market_adjustment','regulatory','error_correction','other')),
  justification        text NOT NULL,
  current_amount_cents bigint NOT NULL CHECK (current_amount_cents >= 0),
  proposed_amount_cents bigint NOT NULL CHECK (proposed_amount_cents >= 0),
  counter_amount_cents bigint CHECK (counter_amount_cents IS NULL OR counter_amount_cents >= 0),
  agreed_amount_cents  bigint CHECK (agreed_amount_cents IS NULL OR agreed_amount_cents >= 0),
  rounds               integer NOT NULL DEFAULT 1,
  created_by           uuid REFERENCES public.profiles(id),
  decided_by           uuid REFERENCES public.profiles(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  decided_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_deal_revisions_deal ON public.deal_revisions(deal_id, status);
CREATE INDEX IF NOT EXISTS idx_deal_revisions_cp   ON public.deal_revisions(counterparty_id, status);
-- only ONE open case per agreement
CREATE UNIQUE INDEX IF NOT EXISTS uniq_open_revision_per_agreement
  ON public.deal_revisions(agreement_id) WHERE status IN ('requested','countered');
DROP TRIGGER IF EXISTS trg_deal_revisions_touch ON public.deal_revisions;
CREATE TRIGGER trg_deal_revisions_touch BEFORE UPDATE ON public.deal_revisions
  FOR EACH ROW EXECUTE FUNCTION public.nx_set_updated_at();

CREATE TABLE IF NOT EXISTS public.deal_revision_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id    uuid NOT NULL REFERENCES public.deal_revisions(id) ON DELETE CASCADE,
  seq            integer NOT NULL,
  actor_id       uuid REFERENCES public.profiles(id),
  actor_role     text NOT NULL CHECK (actor_role IN ('client','supplier','inspector','nexpec')),
  action         text NOT NULL CHECK (action IN ('propose','counter','accept','reject','withdraw','apply')),
  amount_cents   bigint CHECK (amount_cents IS NULL OR amount_cents >= 0),
  reason_code    text,
  note           text,
  content_sha256 text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_revision_events_rev ON public.deal_revision_events(revision_id, seq);

ALTER TABLE public.deal_revisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_revision_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rev_select ON public.deal_revisions;
CREATE POLICY rev_select ON public.deal_revisions
  FOR SELECT TO authenticated USING (counterparty_id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS rev_service_all ON public.deal_revisions;
CREATE POLICY rev_service_all ON public.deal_revisions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS rev_events_select ON public.deal_revision_events;
CREATE POLICY rev_events_select ON public.deal_revision_events
  FOR SELECT TO authenticated USING (
    public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.deal_revisions r WHERE r.id = revision_id AND r.counterparty_id = auth.uid())
  );
DROP POLICY IF EXISTS rev_events_service_all ON public.deal_revision_events;
CREATE POLICY rev_events_service_all ON public.deal_revision_events FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT ON public.deal_revisions, public.deal_revision_events TO authenticated;

-- ── 2. helpers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._revision_role(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE p_kind WHEN 'client_supply' THEN 'client'
                     WHEN 'supplier_supply' THEN 'supplier'
                     ELSE 'inspector' END;
$fn$;

-- append a sealed event + return its seq
CREATE OR REPLACE FUNCTION public._revision_log(
  p_revision_id uuid, p_actor_id uuid, p_actor_role text, p_action text,
  p_amount bigint, p_reason text, p_note text
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_seq int; v_sha text;
BEGIN
  SELECT coalesce(max(seq),0)+1 INTO v_seq FROM public.deal_revision_events WHERE revision_id = p_revision_id;
  v_sha := encode(extensions.digest(
    coalesce(p_revision_id::text,'')||'|'||v_seq||'|'||coalesce(p_action,'')||'|'||coalesce(p_amount::text,'')||'|'||coalesce(p_note,''),
    'sha256'), 'hex');
  INSERT INTO public.deal_revision_events (revision_id, seq, actor_id, actor_role, action, amount_cents, reason_code, note, content_sha256)
  VALUES (p_revision_id, v_seq, p_actor_id, p_actor_role, p_action, p_amount, p_reason, p_note, v_sha);
END $fn$;
REVOKE ALL ON FUNCTION public._revision_log(uuid,uuid,text,bigint,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public._revision_log(uuid,uuid,text,bigint,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public._revision_notify(p_recipient uuid, p_title text, p_body text, p_deal uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF p_recipient IS NULL THEN RETURN; END IF;
  BEGIN
    PERFORM public.notify_safe(p_recipient, 'commercial_revision', p_title, p_body, '/contracts', NULL);
  EXCEPTION WHEN OTHERS THEN NULL;  -- never let notification shape break the ledger
  END;
END $fn$;
REVOKE ALL ON FUNCTION public._revision_notify(uuid,text,text,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public._revision_notify(uuid,text,text,uuid) TO service_role;

-- ── 3. APPLY — supersede the leg at the agreed amount (internal) ───────────────
CREATE OR REPLACE FUNCTION public._apply_revision(p_revision_id uuid, p_agreed bigint, p_actor uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_r public.deal_revisions; v_d public.deals; v_old public.agreements;
  v_title text; v_curr text; v_source_fat boolean; v_body text; v_sha text; v_newid uuid; v_ver int;
BEGIN
  SELECT * INTO v_r FROM public.deal_revisions WHERE id = p_revision_id FOR UPDATE;
  SELECT * INTO v_d FROM public.deals WHERE id = v_r.deal_id FOR UPDATE;
  SELECT * INTO v_old FROM public.agreements
   WHERE deal_id = v_r.deal_id AND kind = v_r.kind AND status <> 'voided'
   ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_agreement_to_supersede'; END IF;

  SELECT r.title, coalesce(r.requires_source_inspection,true) INTO v_title, v_source_fat
    FROM public.supplier_rfqs r WHERE r.id = v_d.rfq_id;
  v_curr := coalesce(v_old.currency, v_d.currency, 'USD');
  v_ver  := v_old.version + 1;
  v_body := CASE v_r.kind
    WHEN 'client_supply'      THEN public._brokered_client_supply_md(v_title, p_agreed, v_curr, coalesce(v_d.transparency_tier,'standard'), coalesce(v_source_fat,true))
    WHEN 'supplier_supply'    THEN public._brokered_supplier_supply_md(v_title, p_agreed, v_curr)
    ELSE                           public._brokered_inspector_engagement_md(v_title, p_agreed, v_curr) END;
  v_sha := encode(extensions.digest(v_body, 'sha256'), 'hex');

  INSERT INTO public.agreements (deal_id, kind, version, status, supersedes_id, counterparty_id, amount_cents, currency,
                                 body_md, content_sha256, ots_status, presented_at, signed_at, countersigned_at, executed_at, generated_by)
  VALUES (v_r.deal_id, v_r.kind, v_ver, 'executed', v_old.id, v_r.counterparty_id, p_agreed, v_curr,
          v_body, v_sha, 'unsubmitted', now(), now(), now(), now(), p_actor)
  RETURNING id INTO v_newid;
  UPDATE public.agreements SET status = 'amended' WHERE id = v_old.id;

  -- the docket's mutual consent IS the execution consent; record both signatures
  INSERT INTO public.agreement_signatures (agreement_id, signer_id, party_role, signed_name, signed_sha256)
  VALUES (v_newid, v_r.counterparty_id, public._revision_role(v_r.kind), 'Accepted via Commercial Revision '||v_r.id, v_sha),
         (v_newid, p_actor, 'nexpec', 'NEXPEC (revision arbiter)', v_sha);

  -- client leg: the revised price flows into the deal + escrow ledger + schedule
  IF v_r.kind = 'client_supply' THEN
    UPDATE public.deals SET client_price_cents = p_agreed WHERE id = v_r.deal_id;
    DELETE FROM public.deal_payment_schedule WHERE deal_id = v_r.deal_id;
    PERFORM public._brokered_ensure_payment_schedule(v_r.deal_id, p_agreed, v_curr);
    UPDATE public.deal_money_legs SET amount_cents = p_agreed
     WHERE deal_id = v_r.deal_id AND kind = 'client_escrow_in' AND status IN ('pending','held');
  END IF;

  UPDATE public.deal_revisions
     SET status = 'applied', agreed_amount_cents = p_agreed, decided_by = p_actor, decided_at = now()
   WHERE id = p_revision_id;
  PERFORM public._revision_log(p_revision_id, p_actor, 'nexpec', 'apply', p_agreed, NULL,
                               'Superseding contract v'||v_ver||' issued and executed.');
END $fn$;
REVOKE ALL ON FUNCTION public._apply_revision(uuid,bigint,uuid) FROM public;
GRANT EXECUTE ON FUNCTION public._apply_revision(uuid,bigint,uuid) TO service_role;

-- ── 4. request_price_revision — the party opens a formal request ──────────────
CREATE OR REPLACE FUNCTION public.request_price_revision(
  p_agreement_id uuid, p_proposed_amount_cents bigint, p_reason_code text, p_justification text
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_uid uuid := auth.uid(); v_a public.agreements; v_d public.deals; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_proposed_amount_cents IS NULL OR p_proposed_amount_cents < 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF p_reason_code NOT IN ('scope_change','material_cost','schedule_change','market_adjustment','regulatory','error_correction','other')
     THEN RAISE EXCEPTION 'invalid_reason_code'; END IF;
  IF p_justification IS NULL OR length(btrim(p_justification)) < 20 THEN
    RAISE EXCEPTION 'JUSTIFICATION_REQUIRED: provide a substantive formal justification (min 20 chars)';
  END IF;
  SELECT * INTO v_a FROM public.agreements WHERE id = p_agreement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_agreement'; END IF;
  IF v_a.counterparty_id <> v_uid THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_a.status NOT IN ('presented','executed') THEN RAISE EXCEPTION 'AGREEMENT_NOT_REVISABLE: status=%', v_a.status; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = v_a.deal_id;
  IF v_d.status IN ('closed','cancelled') THEN RAISE EXCEPTION 'DEAL_CLOSED'; END IF;
  IF EXISTS (SELECT 1 FROM public.deal_revisions WHERE agreement_id = p_agreement_id AND status IN ('requested','countered')) THEN
    RAISE EXCEPTION 'REVISION_ALREADY_OPEN: an open revision already exists for this agreement';
  END IF;

  INSERT INTO public.deal_revisions (deal_id, agreement_id, kind, counterparty_id, status, reason_code, justification,
                                     current_amount_cents, proposed_amount_cents, created_by)
  VALUES (v_a.deal_id, p_agreement_id, v_a.kind, v_uid, 'requested', p_reason_code, btrim(p_justification),
          v_a.amount_cents, p_proposed_amount_cents, v_uid)
  RETURNING id INTO v_id;
  PERFORM public._revision_log(v_id, v_uid, public._revision_role(v_a.kind), 'propose', p_proposed_amount_cents, p_reason_code, btrim(p_justification));
  PERFORM public._revision_notify(v_d.created_by, 'Commercial revision requested', 'A counterparty has requested a price revision.', v_a.deal_id);
  RETURN jsonb_build_object('revision_id', v_id, 'status', 'requested');
END $fn$;
REVOKE ALL ON FUNCTION public.request_price_revision(uuid,bigint,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_price_revision(uuid,bigint,text,text) TO authenticated, service_role;

-- ── 5. admin_counter_revision — NEXPEC counters with its own figure ───────────
CREATE OR REPLACE FUNCTION public.admin_counter_revision(p_revision_id uuid, p_counter_amount_cents bigint, p_admin_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_r public.deal_revisions; v_n int;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_counter_amount_cents IS NULL OR p_counter_amount_cents < 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  SELECT * INTO v_r FROM public.deal_revisions WHERE id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_revision'; END IF;
  IF v_r.status <> 'requested' THEN RAISE EXCEPTION 'REVISION_NOT_OPEN_FOR_COUNTER: status=%', v_r.status; END IF;
  SELECT count(*) INTO v_n FROM public.deal_revision_events WHERE revision_id = p_revision_id;
  IF v_n >= 10 THEN RAISE EXCEPTION 'REVISION_ROUNDS_EXCEEDED'; END IF;

  UPDATE public.deal_revisions SET status = 'countered', counter_amount_cents = p_counter_amount_cents, decided_by = auth.uid()
   WHERE id = p_revision_id;
  PERFORM public._revision_log(p_revision_id, auth.uid(), 'nexpec', 'counter', p_counter_amount_cents, NULL, p_admin_note);
  PERFORM public._revision_notify(v_r.counterparty_id, 'NEXPEC countered your revision', 'NEXPEC has proposed a counter figure for your review.', v_r.deal_id);
  RETURN jsonb_build_object('revision_id', p_revision_id, 'status', 'countered');
END $fn$;
REVOKE ALL ON FUNCTION public.admin_counter_revision(uuid,bigint,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_counter_revision(uuid,bigint,text) TO authenticated, service_role;

-- ── 6. admin_decide_revision — NEXPEC accepts (→ apply) or rejects ────────────
CREATE OR REPLACE FUNCTION public.admin_decide_revision(p_revision_id uuid, p_decision text, p_admin_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_r public.deal_revisions;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_decision NOT IN ('accept','reject') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  SELECT * INTO v_r FROM public.deal_revisions WHERE id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_revision'; END IF;
  IF v_r.status <> 'requested' THEN RAISE EXCEPTION 'REVISION_NOT_OPEN: status=%', v_r.status; END IF;

  IF p_decision = 'reject' THEN
    UPDATE public.deal_revisions SET status = 'rejected', decided_by = auth.uid(), decided_at = now() WHERE id = p_revision_id;
    PERFORM public._revision_log(p_revision_id, auth.uid(), 'nexpec', 'reject', NULL, NULL, p_admin_note);
    PERFORM public._revision_notify(v_r.counterparty_id, 'Revision declined', 'NEXPEC has declined your price-revision request.', v_r.deal_id);
    RETURN jsonb_build_object('revision_id', p_revision_id, 'status', 'rejected');
  END IF;

  -- accept = NEXPEC consents to the party's latest proposal → apply
  PERFORM public._revision_log(p_revision_id, auth.uid(), 'nexpec', 'accept', v_r.proposed_amount_cents, NULL, p_admin_note);
  PERFORM public._apply_revision(p_revision_id, v_r.proposed_amount_cents, auth.uid());
  PERFORM public._revision_notify(v_r.counterparty_id, 'Revision accepted', 'NEXPEC accepted your revision; a superseding contract has been issued.', v_r.deal_id);
  RETURN jsonb_build_object('revision_id', p_revision_id, 'status', 'applied', 'agreed_amount_cents', v_r.proposed_amount_cents);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_decide_revision(uuid,text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_decide_revision(uuid,text,text) TO authenticated, service_role;

-- ── 7. respond_to_counter — the party accepts / declines / counters back ──────
CREATE OR REPLACE FUNCTION public.respond_to_counter(
  p_revision_id uuid, p_decision text, p_amount_cents bigint DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_uid uuid := auth.uid(); v_r public.deal_revisions; v_role text; v_n int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_decision NOT IN ('accept','reject','counter') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  SELECT * INTO v_r FROM public.deal_revisions WHERE id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_revision'; END IF;
  IF v_r.counterparty_id <> v_uid THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_r.status <> 'countered' THEN RAISE EXCEPTION 'NO_COUNTER_TO_RESPOND_TO: status=%', v_r.status; END IF;
  v_role := public._revision_role(v_r.kind);

  IF p_decision = 'accept' THEN
    -- party consents to NEXPEC's counter → apply at the counter figure
    PERFORM public._revision_log(p_revision_id, v_uid, v_role, 'accept', v_r.counter_amount_cents, NULL, p_note);
    PERFORM public._apply_revision(p_revision_id, v_r.counter_amount_cents, v_uid);
    PERFORM public._revision_notify(v_r.created_by, 'Counter accepted', 'The counterparty accepted the counter; a superseding contract has been issued.', v_r.deal_id);
    RETURN jsonb_build_object('revision_id', p_revision_id, 'status', 'applied', 'agreed_amount_cents', v_r.counter_amount_cents);
  ELSIF p_decision = 'reject' THEN
    UPDATE public.deal_revisions SET status = 'rejected', decided_at = now() WHERE id = p_revision_id;
    PERFORM public._revision_log(p_revision_id, v_uid, v_role, 'reject', NULL, NULL, p_note);
    PERFORM public._revision_notify(v_r.created_by, 'Revision closed', 'The counterparty declined the counter; the revision is closed.', v_r.deal_id);
    RETURN jsonb_build_object('revision_id', p_revision_id, 'status', 'rejected');
  END IF;

  -- counter back → new party proposal, awaiting NEXPEC again
  IF p_amount_cents IS NULL OR p_amount_cents < 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  SELECT count(*) INTO v_n FROM public.deal_revision_events WHERE revision_id = p_revision_id;
  IF v_n >= 10 THEN RAISE EXCEPTION 'REVISION_ROUNDS_EXCEEDED'; END IF;
  UPDATE public.deal_revisions SET status = 'requested', proposed_amount_cents = p_amount_cents, rounds = rounds + 1
   WHERE id = p_revision_id;
  PERFORM public._revision_log(p_revision_id, v_uid, v_role, 'propose', p_amount_cents, v_r.reason_code, p_note);
  PERFORM public._revision_notify(v_r.created_by, 'Counter-proposal received', 'The counterparty proposed a revised figure for your review.', v_r.deal_id);
  RETURN jsonb_build_object('revision_id', p_revision_id, 'status', 'requested');
END $fn$;
REVOKE ALL ON FUNCTION public.respond_to_counter(uuid,text,bigint,text) FROM public;
GRANT EXECUTE ON FUNCTION public.respond_to_counter(uuid,text,bigint,text) TO authenticated, service_role;

-- ── 8. withdraw_revision — the party retracts an open case ────────────────────
CREATE OR REPLACE FUNCTION public.withdraw_revision(p_revision_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE v_uid uuid := auth.uid(); v_r public.deal_revisions;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_r FROM public.deal_revisions WHERE id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_revision'; END IF;
  IF v_r.counterparty_id <> v_uid THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_r.status NOT IN ('requested','countered') THEN RAISE EXCEPTION 'REVISION_NOT_OPEN'; END IF;
  UPDATE public.deal_revisions SET status = 'withdrawn', decided_at = now() WHERE id = p_revision_id;
  PERFORM public._revision_log(p_revision_id, v_uid, public._revision_role(v_r.kind), 'withdraw', NULL, NULL, p_note);
  RETURN jsonb_build_object('revision_id', p_revision_id, 'status', 'withdrawn');
END $fn$;
REVOKE ALL ON FUNCTION public.withdraw_revision(uuid,text) FROM public;
GRANT EXECUTE ON FUNCTION public.withdraw_revision(uuid,text) TO authenticated, service_role;

-- ── 9. Self-tests ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.deal_revisions') IS NULL THEN RAISE EXCEPTION 'SELFTEST: deal_revisions missing'; END IF;
  IF to_regclass('public.deal_revision_events') IS NULL THEN RAISE EXCEPTION 'SELFTEST: deal_revision_events missing'; END IF;
  IF to_regprocedure('public.request_price_revision(uuid,bigint,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: request_price_revision missing'; END IF;
  IF to_regprocedure('public.admin_counter_revision(uuid,bigint,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: admin_counter_revision missing'; END IF;
  IF to_regprocedure('public.respond_to_counter(uuid,text,bigint,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: respond_to_counter missing'; END IF;
  IF to_regprocedure('public.admin_decide_revision(uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: admin_decide_revision missing'; END IF;
  IF to_regprocedure('public._apply_revision(uuid,bigint,uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: _apply_revision missing'; END IF;
  -- price-blindness guard: revision tables must not expose any cross-party column
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='deal_revisions'
               AND column_name IN ('client_price_cents','cost_cents','payout_cents','spread_cents')) THEN
    RAISE EXCEPTION 'SELFTEST: deal_revisions exposes a cross-party money column';
  END IF;
  RAISE NOTICE 'Commercial Revision Ledger OK: cases + sealed events + request/counter/respond/decide + auto-supersede on consent.';
END $$;

COMMIT;
