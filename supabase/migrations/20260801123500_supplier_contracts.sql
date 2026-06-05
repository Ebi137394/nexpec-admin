-- ============================================================================
--  20260801123500_supplier_contracts.sql
--
--  Supplier Agreement — the formalised, signed contract between the awarded
--  SUPPLIER and NEXPEC (the broker-of-record). Mirrors job_contracts' proven
--  e-signature state machine, but two-party (supplier + admin) because the
--  Golden Rules make NEXPEC the counterparty — the client never contracts the
--  supplier directly (admin-brokered, anti-poaching).
--
--  Lifecycle:  admin_generate → pending_supplier_signature
--              supplier_sign  → pending_admin_countersignature
--              admin_countersign → executed (+ content_sha256 seal)
--
--  Enforcement:  release_supplier_contract() (the financial release) now REFUSES
--  to credit a supplier wallet unless an `executed` agreement exists for the
--  quote. Contract-before-money, in SQL.
--
--  Idempotent + safe to re-run.
-- ============================================================================

BEGIN;

-- ── 1. supplier_contracts (mirror of job_contracts, brokered two-party) ─────
CREATE TABLE IF NOT EXISTS public.supplier_contracts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id                  uuid NOT NULL UNIQUE REFERENCES public.supplier_quotes(id) ON DELETE CASCADE,
  rfq_id                    uuid REFERENCES public.supplier_rfqs(id) ON DELETE SET NULL,
  job_id                    uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  supplier_id               uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_cents              bigint NOT NULL DEFAULT 0,
  contract_text_md          text,
  custom_contract_url       text,
  status                    text NOT NULL DEFAULT 'pending_supplier_signature'
                            CHECK (status IN ('draft','pending_supplier_signature','pending_admin_countersignature','executed','voided')),
  -- e-signature evidence (typed legal name + ip + timestamp)
  supplier_signed_at        timestamptz,
  supplier_signed_name      text,
  supplier_signed_ip        text,
  admin_signed_at           timestamptz,
  admin_signed_name         text,
  admin_signed_ip           text,
  admin_signed_by           uuid,
  -- execution seal (tamper-evident fingerprint over the signed terms)
  content_sha256            text,
  executed_at               timestamptz,
  -- void
  voided_at                 timestamptz,
  voided_by                 uuid,
  voided_reason             text,
  generated_by              uuid,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_contracts_supplier ON public.supplier_contracts(supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_contracts_quote    ON public.supplier_contracts(quote_id);

CREATE OR REPLACE FUNCTION public.touch_supplier_contracts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_supplier_contracts_touch ON public.supplier_contracts;
CREATE TRIGGER trg_supplier_contracts_touch BEFORE UPDATE ON public.supplier_contracts
  FOR EACH ROW EXECUTE FUNCTION public.touch_supplier_contracts_updated_at();

-- ── 2. RLS — supplier reads own; admin all; mutations via RPC only ──────────
ALTER TABLE public.supplier_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_contracts_select_self ON public.supplier_contracts;
CREATE POLICY supplier_contracts_select_self ON public.supplier_contracts
  FOR SELECT TO authenticated USING (supplier_id = auth.uid() OR public.nx_is_admin());
DROP POLICY IF EXISTS supplier_contracts_service_all ON public.supplier_contracts;
CREATE POLICY supplier_contracts_service_all ON public.supplier_contracts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- helper: awarded-quote value (tolerates legacy quote shapes)
CREATE OR REPLACE FUNCTION public._supplier_quote_cents(p_quote jsonb)
RETURNS bigint LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(p_quote->>'amount_cents','')::bigint,
    (NULLIF(p_quote->>'amount','')::numeric * 100)::bigint,
    NULLIF(p_quote->>'price_cents','')::bigint, 0);
$$;

-- ── 3. admin_generate_supplier_contract (admin only) ────────────────────────
CREATE OR REPLACE FUNCTION public.admin_generate_supplier_contract(
  p_quote_id uuid,
  p_contract_text_md text DEFAULT NULL,
  p_custom_contract_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_q RECORD; v_job uuid; v_amount bigint; v_text text; v_id uuid; v_title text;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;

  SELECT q.id, q.supplier_id, q.rfq_id, q.status, q.quote, r.title, r.spawned_job_id
    INTO v_q
    FROM public.supplier_quotes q
    JOIN public.supplier_rfqs r ON r.id = q.rfq_id
   WHERE q.id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quote_not_found'; END IF;
  IF v_q.status <> 'accepted' THEN RAISE EXCEPTION 'CONTRACT_REQUIRES_AWARD: quote is not accepted'; END IF;

  v_amount := public._supplier_quote_cents(v_q.quote);
  v_job := v_q.spawned_job_id;
  v_title := COALESCE(v_q.title, 'Awarded contract');

  -- Default brokered agreement template (admin may override via p_contract_text_md).
  v_text := COALESCE(p_contract_text_md, format(
$md$# NEXPEC Supplier Agreement

**Parties:** NEXPEC (the "Broker-of-Record" and Prime Contractor) and the awarded Supplier (the "Supplier").
**Engagement:** %s
**Awarded value:** $%s

The Supplier is an independent contractor; nothing here creates an employment, partnership, joint venture, or agency relationship. NEXPEC contracts the end client separately and is the Supplier's sole counterparty for this engagement.

1. **Scope & standards.** The Supplier shall furnish the goods and/or services described in the referenced RFQ in strict conformance with the agreed specifications, drawings, codes, and recognized industry standards, performed in a professional and workmanlike manner and in compliance with all applicable laws and safety and environmental regulations.

2. **Brokered settlement & escrow leverage.** Payment is administered by NEXPEC and held in escrow. Funds are released solely at NEXPEC's direction, against verified milestones, and only upon zero-liability completion — meaning no open defect, non-conformance, equipment or property damage, personal-injury claim, warranty issue, or dispute attributable to the Supplier. The Supplier holds no claim, lien, or entitlement to any funds prior to NEXPEC's release. NEXPEC may withhold, set off, deduct from, or claw back escrowed or released amounts to satisfy the Supplier's liabilities or indemnity obligations under this Agreement.

3. **Strict indemnification — Supplier bears one hundred percent (100) of the liability.** The Supplier assumes full and sole responsibility for its goods, services, acts, and omissions, and shall defend, indemnify, and hold harmless NEXPEC, its affiliates, officers, employees, and the end client (together, the "Indemnified Parties") from and against any and all claims, demands, losses, damages, liabilities, fines, penalties, and costs (including reasonable legal fees and expert costs) arising out of or relating to: (a) defective, non-conforming, late, or deficient goods or services; (b) damage to industrial equipment, facilities, or any property; (c) bodily injury or death; (d) the Supplier's negligence, recklessness, or willful misconduct; (e) infringement of any intellectual-property or other third-party right; or (f) the Supplier's breach of this Agreement or violation of law. This indemnity is primary and non-contributory, is not capped, and survives termination or completion.

4. **Professional liability (E&O) insurance.** Throughout the term and any applicable warranty period, the Supplier shall maintain, at its own expense, valid Professional Liability / Errors & Omissions (E&O) insurance, together with Commercial General Liability and any statutorily required workers' compensation coverage, with limits customary for the industry and commensurate with the value and risk of the engagement. On request, the Supplier shall furnish certificates of insurance, name NEXPEC as additional insured, and confirm such coverage is primary and non-contributory. Lapse of required insurance is a material breach and entitles NEXPEC to suspend release of funds.

5. **Source / FAT inspection & quality.** Where the RFQ requires it, the Supplier shall grant a NEXPEC-dispatched inspector reasonable access for source / Factory Acceptance Testing prior to shipment. All certificates and evidence are sealed into NEXPEC's Trust Spine and must be accurate, complete, and current. The Supplier warrants good title and conformance of all deliverables.

6. **Confidentiality & non-circumvention.** The Supplier shall not solicit, contact, or transact directly with the end client introduced through NEXPEC during the engagement and for twelve (12) months thereafter; all coordination runs through the NEXPEC platform.

7. **NEXPEC limitation.** NEXPEC acts solely as broker and payment administrator. NEXPEC's aggregate liability to the Supplier shall not exceed the amounts actually payable to the Supplier for the engagement, and NEXPEC shall not be liable for any indirect, incidental, or consequential damages.

8. **Term, termination & survival.** This Agreement governs the awarded engagement and may be terminated for material breach. Sections 2, 3, 4, 6, and 7 survive termination or completion.

By signing, the Supplier accepts these terms in full. NEXPEC countersigns to execute.$md$,
    v_title, to_char(v_amount / 100.0, 'FM999,999,990.00')));

  -- supersede any prior non-void contract for this quote
  UPDATE public.supplier_contracts
     SET status = 'voided', voided_at = now(), voided_by = auth.uid(), voided_reason = 'Superseded by new generation'
   WHERE quote_id = p_quote_id AND status <> 'voided';

  INSERT INTO public.supplier_contracts(
    quote_id, rfq_id, job_id, supplier_id, amount_cents,
    contract_text_md, custom_contract_url, status, generated_by
  ) VALUES (
    p_quote_id, v_q.rfq_id, v_job, v_q.supplier_id, v_amount,
    v_text, p_custom_contract_url, 'pending_supplier_signature', auth.uid()
  ) RETURNING id INTO v_id;

  BEGIN
    PERFORM public.create_system_notification(
      v_q.supplier_id, 'Agreement ready to sign',
      'Review and e-sign your NEXPEC supplier agreement to proceed to payout.',
      'contract_assigned', '/suppliers/contracts/' || v_id::text, v_job);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'contract_id', v_id, 'status', 'pending_supplier_signature');
END $fn$;
REVOKE ALL ON FUNCTION public.admin_generate_supplier_contract(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_generate_supplier_contract(uuid, text, text) TO authenticated, service_role;

-- ── 4. supplier_sign_contract (the awarded supplier) ────────────────────────
CREATE OR REPLACE FUNCTION public.supplier_sign_contract(
  p_contract_id uuid, p_typed_name text, p_ip text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_c RECORD;
BEGIN
  SELECT * INTO v_c FROM public.supplier_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found'; END IF;
  IF v_c.supplier_id <> auth.uid() THEN RAISE EXCEPTION 'only the awarded supplier may sign'; END IF;
  IF v_c.status <> 'pending_supplier_signature' THEN RAISE EXCEPTION 'contract not awaiting supplier signature (status=%)', v_c.status; END IF;
  IF p_typed_name IS NULL OR length(trim(p_typed_name)) < 2 THEN RAISE EXCEPTION 'type your full legal name to sign'; END IF;

  UPDATE public.supplier_contracts
     SET supplier_signed_at = now(), supplier_signed_name = trim(p_typed_name),
         supplier_signed_ip = p_ip, status = 'pending_admin_countersignature'
   WHERE id = p_contract_id;

  BEGIN
    PERFORM public.create_admin_notification(
      'Supplier signed an agreement', 'Awaiting NEXPEC countersignature to execute.',
      'contract_assigned', '/admin/supplier-payouts', v_c.job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'status', 'pending_admin_countersignature');
END $fn$;
REVOKE ALL ON FUNCTION public.supplier_sign_contract(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.supplier_sign_contract(uuid, text, text) TO authenticated;

-- ── 5. admin_countersign_supplier_contract → executed + sealed ──────────────
CREATE OR REPLACE FUNCTION public.admin_countersign_supplier_contract(
  p_contract_id uuid, p_typed_name text, p_ip text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $fn$
DECLARE v_c RECORD; v_seal text; v_when timestamptz := now();
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO v_c FROM public.supplier_contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract_not_found'; END IF;
  IF v_c.status <> 'pending_admin_countersignature' THEN RAISE EXCEPTION 'contract not awaiting countersignature (status=%)', v_c.status; END IF;
  IF p_typed_name IS NULL OR length(trim(p_typed_name)) < 2 THEN RAISE EXCEPTION 'type your full legal name to countersign'; END IF;

  -- Tamper-evident seal over the executed terms (Trust-Spine style fingerprint).
  v_seal := encode(extensions.digest(convert_to(
      coalesce(v_c.id::text,'') || '|' || coalesce(v_c.quote_id::text,'') || '|' ||
      coalesce(v_c.supplier_id::text,'') || '|' || coalesce(v_c.amount_cents::text,'') || '|' ||
      coalesce(v_c.supplier_signed_name,'') || '|' || coalesce(v_c.supplier_signed_at::text,'') || '|' ||
      trim(p_typed_name) || '|' || coalesce(v_when::text,'') || '|' || coalesce(v_c.contract_text_md,''),
      'utf8'), 'sha256'), 'hex');

  UPDATE public.supplier_contracts
     SET admin_signed_at = v_when, admin_signed_name = trim(p_typed_name), admin_signed_ip = p_ip,
         admin_signed_by = auth.uid(), status = 'executed', executed_at = v_when, content_sha256 = v_seal
   WHERE id = p_contract_id;

  BEGIN
    PERFORM public.create_system_notification(
      v_c.supplier_id, 'Agreement executed',
      'Your NEXPEC supplier agreement is fully signed. Brokered payouts can now be released.',
      'contract_assigned', '/suppliers/contracts/' || p_contract_id::text, v_c.job_id);
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object('ok', true, 'status', 'executed', 'content_sha256', v_seal);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_countersign_supplier_contract(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_countersign_supplier_contract(uuid, text, text) TO authenticated, service_role;

-- ── 6. Gate the financial release on an executed agreement ──────────────────
--  Re-defines release_supplier_contract (20260801123400) with one added check:
--  no signed, executed agreement → no release.
CREATE OR REPLACE FUNCTION public.release_supplier_contract(
  p_quote_id uuid, p_amount_cents int, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_supplier_id uuid; v_rfq_id uuid; v_status text; v_quote jsonb;
  v_contract_cents bigint; v_already bigint; v_release_id uuid;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'not authorised: admin only'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'INVALID_AMOUNT'; END IF;

  SELECT supplier_id, rfq_id, status, quote
    INTO v_supplier_id, v_rfq_id, v_status, v_quote
    FROM public.supplier_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_NOT_FOUND'; END IF;
  IF v_status <> 'accepted' THEN RAISE EXCEPTION 'CONTRACT_NOT_AWARDED'; END IF;

  -- NEW: a signed, executed supplier agreement is mandatory before any release.
  IF NOT EXISTS (
    SELECT 1 FROM public.supplier_contracts
     WHERE quote_id = p_quote_id AND status = 'executed'
  ) THEN
    RAISE EXCEPTION 'CONTRACT_NOT_EXECUTED: a signed supplier agreement must be executed before releasing funds';
  END IF;

  v_contract_cents := public._supplier_quote_cents(v_quote);
  SELECT COALESCE(SUM(amount_halalas), 0) INTO v_already
    FROM public.supplier_releases WHERE quote_id = p_quote_id;
  IF v_contract_cents > 0 AND (v_already + p_amount_cents) > v_contract_cents THEN
    RAISE EXCEPTION 'OVER_RELEASE: contract %, already released %, attempted %', v_contract_cents, v_already, p_amount_cents;
  END IF;

  INSERT INTO public.supplier_releases (quote_id, rfq_id, supplier_id, amount_halalas, note, released_by)
    VALUES (p_quote_id, v_rfq_id, v_supplier_id, p_amount_cents, p_note, v_uid)
    RETURNING id INTO v_release_id;

  PERFORM public.credit_supplier_earnings(v_supplier_id, p_amount_cents, COALESCE(p_note, 'Milestone release'), v_rfq_id);

  RETURN jsonb_build_object('release_id', v_release_id, 'supplier_id', v_supplier_id,
    'amount_cents', p_amount_cents, 'contract_cents', v_contract_cents,
    'released_total_cents', v_already + p_amount_cents);
END $$;
REVOKE ALL ON FUNCTION public.release_supplier_contract(uuid, int, text) FROM public;
GRANT EXECUTE ON FUNCTION public.release_supplier_contract(uuid, int, text) TO authenticated, service_role;

-- ── 7. Self-test ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.supplier_contracts') IS NULL THEN RAISE EXCEPTION 'SELFTEST supplier_contracts missing'; END IF;
  IF to_regprocedure('public.admin_generate_supplier_contract(uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST generate RPC missing'; END IF;
  IF to_regprocedure('public.supplier_sign_contract(uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST sign RPC missing'; END IF;
  IF to_regprocedure('public.admin_countersign_supplier_contract(uuid,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST countersign RPC missing'; END IF;
  RAISE NOTICE 'Supplier agreements ready: generate→sign→countersign(sealed); release gated on execution.';
END $$;

COMMIT;
