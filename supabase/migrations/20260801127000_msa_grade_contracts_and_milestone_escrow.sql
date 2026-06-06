-- ════════════════════════════════════════════════════════════════════════════
--  20260801127000_msa_grade_contracts_and_milestone_escrow.sql
--
--  THE MASTER SERVICE AGREEMENT UPGRADE — enterprise/EPC-grade legal flesh on the
--  brokered-deal spine, plus the milestone-escrow + deemed-acceptance machinery
--  the contracts now describe.  Three party templates rewritten end-to-end
--  (client_supply / supplier_supply / inspector_engagement) and the financial &
--  routing logic they reference is wired so the contracts never lie.
--
--  WHAT CHANGES, AND WHY (executive decisions, this migration):
--    • Jurisdiction (anchor): Province of Quebec + federal laws of Canada; binding
--      confidential arbitration in Montreal, in English, under ADRIC Arbitration
--      Rules.  Embedded as ONE shared "Common Terms" block so every leg is
--      identical and cannot drift.
--    • Milestone funding (HYBRID): the client funds a 30% mobilization deposit on
--      execution and the 70% balance on FAT/Inspection-Readiness — never 100% on
--      day one.  Full price is escrowed by FAT.  (fund_deal_balance.)
--    • Disbursement tranches (30 / 30 / 30 + 10% retention): NEXPEC releases from
--      escrow against milestones, never before; contract-before-money still holds.
--      Surfaced as deal_payment_schedule + Schedule B in every client contract.
--    • Inspector routing legally codified: three permitted methods
--      (broker_assignment | algorithmic_match | client_selection); the method
--      RECORDED on the deal governs; under all methods the inspector is verified,
--      conflict-screened, independent, identity-revealed on final-report signature.
--      Today only broker_assignment is wired — the clause is forward-valid for the
--      others; deals.inspector_routing records the actual method used.
--    • Warranty pass-through (back-to-back): supplier warranty flows Supplier →
--      NEXPEC → Client; NEXPEC is a conduit, capped at its Fees, fully indemnified.
--    • Deemed acceptance (10 business days): silence after delivery = irrevocable
--      acceptance → release authorized; a rejection inside the window must be a
--      SUBSTANTIVE Non-Conformance Report citing a Schedule A spec or ASME/API
--      code deviation (raise_nonconformance), else escrow does not freeze.
--    • Industrial protections: E&O/PI + CGL/Product insurance with Additional
--      Insured + primary/non-contributory + waiver of subrogation; Force Majeure
--      (incl. sanctions/supply-chain; never excuses payment for accepted work).
--
--  SCOPE: templates render at present/award/assign time → applies to NEW or
--  PENDING contracts only; executed/sealed bodies are immutable (unchanged).
--
--  Depends on P0 spine (124000) + P1 saga (124500) + P2 gates (124700) +
--  _quote_raw_cents + nx_is_admin + nx_set_updated_at + extensions.digest +
--  jobs(contractor_id, inspector_payout_cents, admin_confirmed_at).
--  Idempotent. ADDITIVE. No executed row is modified.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
-- 0. SCHEMA — routing record, delivery clocks, payment schedule, NCR ledger
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS inspector_routing text NOT NULL DEFAULT 'broker_assignment';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_inspector_routing_chk') THEN
    ALTER TABLE public.deals ADD CONSTRAINT deals_inspector_routing_chk
      CHECK (inspector_routing IN ('broker_assignment','algorithmic_match','client_selection'));
  END IF;
END $$;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS deposit_funded_at  timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS balance_funded_at  timestamptz;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS goods_delivered_at timestamptz;  -- starts the goods deemed-acceptance clock
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS report_delivered_at timestamptz; -- starts the report deemed-acceptance clock

-- the client-facing tranche schedule (30/30/30 + 10% retention). Source of truth
-- for Schedule B; one row per tranche, generated at award / backfilled below.
CREATE TABLE IF NOT EXISTS public.deal_payment_schedule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  tranche_no    integer NOT NULL,
  code          text NOT NULL CHECK (code IN ('mobilization','fat','final','retention')),
  label         text NOT NULL,
  pct_bps       integer NOT NULL CHECK (pct_bps >= 0 AND pct_bps <= 10000),
  amount_cents  bigint NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  trigger_basis text NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','released')),
  released_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, tranche_no)
);
CREATE INDEX IF NOT EXISTS idx_pay_sched_deal ON public.deal_payment_schedule(deal_id);
ALTER TABLE public.deal_payment_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pay_sched_select ON public.deal_payment_schedule;
CREATE POLICY pay_sched_select ON public.deal_payment_schedule
  FOR SELECT TO authenticated USING (
    public.nx_is_admin()
    OR EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND d.client_id = auth.uid())
  );
DROP POLICY IF EXISTS pay_sched_service_all ON public.deal_payment_schedule;
CREATE POLICY pay_sched_service_all ON public.deal_payment_schedule
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.deal_payment_schedule TO authenticated;

-- substantive Non-Conformance Reports — the only thing that freezes deemed-acceptance
CREATE TABLE IF NOT EXISTS public.deal_nonconformances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('goods','report')),
  raised_by   uuid REFERENCES public.profiles(id),
  basis       text NOT NULL CHECK (basis IN ('schedule_a_spec','code')),
  code_ref    text,
  citation    text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','withdrawn')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_ncr_deal ON public.deal_nonconformances(deal_id, kind, status);
ALTER TABLE public.deal_nonconformances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ncr_select ON public.deal_nonconformances;
CREATE POLICY ncr_select ON public.deal_nonconformances
  FOR SELECT TO authenticated USING (
    public.nx_is_admin()
    OR raised_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.deals d WHERE d.id = deal_id AND d.client_id = auth.uid())
  );
DROP POLICY IF EXISTS ncr_service_all ON public.deal_nonconformances;
CREATE POLICY ncr_service_all ON public.deal_nonconformances
  FOR ALL TO service_role USING (true) WITH CHECK (true);
GRANT SELECT ON public.deal_nonconformances TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. SHARED LEGAL SPINE — Common Terms (identical across all three legs)
--    The ONLY literal "%" signs in this migration live in the payment-schedule
--    renderer below, written as "%%" per Postgres format(). Everything else is
--    plain text in $md$ dollar-quoted blocks (no escaping required).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._brokered_common_terms_md()
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT $md$## Common Terms

**Governing Law.** This Agreement shall be exclusively governed by and construed in accordance with the laws of the Province of Quebec and the federal laws of Canada applicable therein, without regard to conflict-of-law principles.

**Dispute Resolution.** The parties shall first attempt in good faith to resolve any dispute by negotiation. Failing resolution, any dispute, controversy, or claim arising out of or relating to this Agreement, including its existence, validity, interpretation, performance, breach, or termination, shall be finally settled by binding and confidential arbitration in Montreal, Quebec. The arbitration shall be conducted in English and administered by the ADR Institute of Canada (ADRIC) under its Arbitration Rules. The arbitral award is final and binding and may be entered in any court of competent jurisdiction. Nothing herein prevents a party from seeking interim or injunctive relief, or from relying on the platform's escrow-backed resolution process for amounts held in escrow.

**Force Majeure.** No party (other than for the payment of amounts already due for accepted goods or services) shall be liable for any failure or delay caused by events beyond its reasonable control, including acts of God, natural disaster, epidemic or pandemic, war, terrorism, civil unrest, labour action, fire, flood, embargo or sanctions, governmental action, and failures of transport, ports, customs, utilities, or the supply chain. The affected party shall give prompt written notice and use commercially reasonable efforts to mitigate. If a force-majeure event continues for more than sixty (60) days, either party may terminate the affected scope; amounts for goods or services already accepted remain payable.

**Notices.** Notices shall be in writing and delivered through the NEXPEC platform and/or to the email of record, and are deemed received on transmission.

**Assignment.** A counterparty shall not assign this Agreement without NEXPEC's prior written consent. NEXPEC may assign to an affiliate or to a successor in interest.

**Confidentiality.** Each party shall keep confidential the terms of this Agreement and all non-public information exchanged, and shall use it solely for the engagement.

**Severability; Entire Agreement; Amendment; Waiver.** If any provision is held unenforceable, the remainder stays in effect. This Agreement, together with its Schedules and NEXPEC's incorporated platform terms, is the entire agreement and supersedes prior understandings on its subject matter. Amendments must be in writing. No waiver is implied by delay or partial exercise.

**Electronic Execution & Seal.** This Agreement may be executed electronically and in counterparts. On execution it is sealed (SHA-256 content hash, anchored via OpenTimestamps) and is independently verifiable at /passport.

**Survival.** The provisions concerning indemnification, insurance, warranty, confidentiality, non-circumvention, limitation of liability, governing law, and dispute resolution survive completion, expiry, or termination.$md$;
$fn$;

-- ── Schedule B renderer (the only place with literal percent signs → "%%") ─────
CREATE OR REPLACE FUNCTION public._brokered_payment_schedule_md(p_total_cents bigint, p_currency text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format($md$## Schedule B — Payment & Escrow Schedule

**Contract Price:** %1$s %2$s.

**B.1 Client Funding Schedule** — capital is never fully locked on day one:

- **Mobilization Deposit — 30%%** (%3$s %2$s), due on execution of this Agreement.
- **Balance — 70%%** (%4$s %2$s), due upon NEXPEC's FAT / Inspection-Readiness notice.

The full Contract Price is held in escrow no later than FAT-readiness.

**B.2 Disbursement Milestones** — released from escrow only, never in advance, and only once the governing agreement for the receiving party is executed (contract-before-money):

| Tranche | Release trigger | Share |
| --- | --- | --- |
| 1. Mobilization | On execution and mobilization | 30%% |
| 2. FAT / Inspection | On FAT / inspection pass (goods acceptance) | 30%% |
| 3. Final acceptance | On final report acceptance | 30%% |
| 4. Retention | After the warranty / punch-list period | 10%% |

Escrow is administered by NEXPEC; releases follow §Acceptance & Deemed Acceptance.$md$,
    to_char(round(p_total_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'),
    to_char(round(p_total_cents * 0.30 / 100.0, 2), 'FM999G999G990D00'),
    to_char(round(p_total_cents * 0.70 / 100.0, 2), 'FM999G999G990D00'));
$fn$;

-- ── Schedule A renderer (scope / ITP / codes / deliverables) ──────────────────
CREATE OR REPLACE FUNCTION public._brokered_schedule_a_md(p_title text, p_discipline text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format($md$## Schedule A — Scope, Inspection & Deliverables

- **Subject.** "%1$s".
- **Governing scope.** The goods, services, and acceptance criteria set out in the associated RFQ / scope of work, which is incorporated by reference.
- **Inspection & Test Plan (ITP).** Work is performed and verified against the ITP for this scope, including all designated hold, witness, and review points.
- **Codes & standards.** The specifications, codes, and standards stated in the scope and applicable to the %2$s discipline — e.g., ASME (incl. Sec. VIII / B31.3), API (incl. 510 / 570 / 653 / 6D), ISO 9001, and NACE/AMPP — as applicable.
- **Deliverables.** The formal inspection report bearing the inspector's legal name and signature, supporting records, and the sealed credential dossier, delivered through the NEXPEC platform for the client's ASME/API audit file.$md$,
    coalesce(p_title,'the engagement'),
    coalesce(p_discipline,'assigned'));
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. THE THREE MSA TEMPLATES (rewritten end-to-end)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 2a. CLIENT — Supply & Inspection Master Service Agreement ─────────────────
CREATE OR REPLACE FUNCTION public._brokered_client_supply_md(
  p_title text, p_amount_cents bigint, p_currency text, p_tier text, p_source_fat boolean
) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format($md$# NEXPEC Supply & Inspection Agreement (Master Service Agreement)

**Parties.** This Master Service Agreement is between the Client and **NEXPEC** (the Broker-of-Record). NEXPEC contracts the supplier and the inspector under separate agreements to which the Client is not a party; the Client contracts solely with NEXPEC. There is no contractual privity between the Client and any supplier or inspector.

**1. Scope.** NEXPEC shall procure and deliver the goods and/or services described in RFQ "%1$s"%2$s, brokered and quality-assured by NEXPEC, in accordance with Schedule A.

**2. Price, Escrow & Milestone Payments.** The Client price is **%3$s %4$s**, payable into NEXPEC-administered escrow per the milestone schedule in Schedule B. The Client funds a mobilization deposit on execution and the balance on FAT/Inspection-Readiness; NEXPEC releases funds to its supplier and inspector only after the governing agreement for each is executed and the corresponding milestone is met (contract-before-money). Escrowed funds are not NEXPEC's general assets.

**3. Inspector Routing & Credentials (%5$s tier).** NEXPEC assigns the inspector by one of the following permitted methods, the method recorded for this deal being the one that governs: (a) **Broker Assignment** — NEXPEC selects a verified inspector and seals their credential dossier into the deal; (b) **Algorithmic Match** — NEXPEC's competency-matching engine selects from verified inspectors against the scope; or (c) **Client Selection** — the Client selects from a blinded, anonymized competency dossier presented by NEXPEC. Under every method NEXPEC warrants that the assigned inspector is platform-verified to the discipline standard, is independent of the supplier, and has been conflict-screened. The Client receives a sealed, verifiable credential dossier; the inspector's legal name and signature are revealed to the Client on signature of the final formal report, which is the Client's auditable deliverable for ASME/API and regulatory compliance.

**4. Warranty Pass-Through (back-to-back).** The supplier grants its product and workmanship warranties to NEXPEC, and NEXPEC hereby passes those warranties through to the Client on a back-to-back basis. The Client's recourse for product defects, non-conformity, or failure is the supplier's warranty, which NEXPEC shall administer and enforce on the Client's behalf, including assignment of warranty rights where permitted. NEXPEC is the broker and is not the manufacturer, fabricator, or originator of the goods, and does not itself warrant the goods beyond the pass-through of the supplier's warranties and NEXPEC's own brokerage and quality-assurance obligations.

**5. Acceptance & Deemed Acceptance.** Following delivery of the goods and/or the inspection report, the Client has ten (10) business days to accept or to reject. Silence or inaction during that period constitutes irrevocable acceptance and authorizes release of the corresponding escrow tranche. A rejection within the window is effective only if accompanied by a formal, substantive Non-Conformance Report citing the specific deviation from the Schedule A specifications or the applicable ASME/API code; vague or unsubstantiated dissatisfaction does not freeze escrow.

**6. Limitation of Liability.** NEXPEC's aggregate liability under or in connection with this Agreement shall not exceed the fees actually earned by NEXPEC on this deal (the brokerage margin), and NEXPEC shall not be liable for indirect, incidental, consequential, special, punitive, or exemplary damages, or for loss of profit, revenue, production, or use. This cap does not apply to NEXPEC's fraud or wilful misconduct, and is without prejudice to the Client's warranty recourse under §4 and the supplier/inspector indemnities that flow through to the Client.

**7. Indemnification.** NEXPEC shall defend, indemnify, and hold the Client harmless against third-party claims arising from NEXPEC's gross negligence or wilful misconduct in performing the brokered services, subject to §6. The supplier's and inspector's indemnities in favour of the Client (as an indemnified party under their respective agreements) are preserved and enforced by NEXPEC for the Client's benefit.

**8. Insurance.** NEXPEC requires its assigned supplier and inspector to maintain Professional Indemnity / Errors & Omissions cover and, for the supplier, Product Liability and Commercial General Liability, with limits commensurate with the value and risk of the engagement, naming NEXPEC and, where applicable, the Client as additional insured on a primary and non-contributory basis with waiver of subrogation. Certificates are available on request; lapse is a material breach that suspends release of funds.

**9. Confidentiality & Non-Circumvention.** The Client shall not solicit, contract, or transact directly with any supplier or inspector introduced through NEXPEC for the subject matter of this Agreement, during the term and for twenty-four (24) months thereafter. Breach entitles NEXPEC to liquidated damages and to retain escrowed funds to the extent of its loss.

%6$s

%7$s

%8$s$md$,
    coalesce(p_title,'this RFQ'),
    CASE WHEN p_source_fat THEN ', including a source / Factory Acceptance Test (FAT) inspection at the supplier facility before shipment' ELSE '' END,
    to_char(round(p_amount_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'),
    upper(coalesce(p_tier,'standard')),
    public._brokered_schedule_a_md(p_title, 'assigned'),
    public._brokered_payment_schedule_md(p_amount_cents, p_currency),
    public._brokered_common_terms_md());
$fn$;

-- ── 2b. SUPPLIER — Supply Master Service Agreement ────────────────────────────
CREATE OR REPLACE FUNCTION public._brokered_supplier_supply_md(p_title text, p_amount_cents bigint, p_currency text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format($md$# NEXPEC Supplier Supply Agreement (Master Service Agreement)

**Parties.** This Master Service Agreement is between the Supplier and **NEXPEC** (the Broker-of-Record). The Supplier supplies to NEXPEC and does not contract with, and shall not solicit, the end client.

**1. Engagement & Standard.** The Supplier shall supply the goods and/or services described in Schedule A to the specifications, codes, and quality standards stated therein, and shall permit NEXPEC source / Factory Acceptance Test (FAT) inspection before shipment.

**2. Quality, Inspection & Acceptance.** The Supplier shall grant the NEXPEC-assigned inspector reasonable access for FAT / QA-QC. Goods that are non-conforming, defective, or late may be rejected; NEXPEC may withhold payment until the non-conformity is remedied or the order is re-performed at the Supplier's cost. Following NEXPEC's notice that goods are delivered for acceptance, acceptance is deemed to occur after ten (10) business days absent a substantive Non-Conformance Report citing a Schedule A specification or applicable ASME/API code deviation.

**3. Consideration & Payment.** NEXPEC shall pay the Supplier **%2$s %3$s**, from escrow, upon (a) this Agreement being executed and (b) NEXPEC's acceptance (actual or deemed) of the goods (inspection passed). Payment is released against the FAT / acceptance milestone; no advance is due unless separately agreed in Schedule A. The end-client price is not disclosed to the Supplier (price-blindness).

**4. Strict Indemnification (Supplier bears sole liability).** The Supplier assumes full and sole responsibility for its goods, services, acts, and omissions, and shall defend, indemnify, and hold harmless NEXPEC, its affiliates, officers, employees, and the end client (the "Indemnified Parties") from and against any and all claims, demands, losses, damages, liabilities, fines, penalties, and costs (including reasonable legal and expert fees) arising out of or relating to: (a) defective, non-conforming, late, or deficient goods or services; (b) damage to industrial equipment, facilities, or property; (c) bodily injury or death; (d) the Supplier's negligence, recklessness, or wilful misconduct; (e) infringement of any intellectual-property or other third-party right; or (f) the Supplier's breach of this Agreement or violation of law. This indemnity is primary and non-contributory, is not capped, and survives termination or completion.

**5. Warranty, Title & Pass-Through.** The Supplier warrants that the goods conform to specification and are free of defects and of third-party intellectual-property claims, for the warranty period stated in Schedule A or, failing that, for twelve (12) months from acceptance. The Supplier grants these warranties to NEXPEC together with the right to pass them through to, and enforce them for the benefit of, the end client on a back-to-back basis. Title and risk pass to NEXPEC (or its nominee) on NEXPEC's acceptance of the goods.

**6. Professional & Product Insurance.** Throughout the term and any warranty period the Supplier shall maintain, at its expense, Professional Liability / Errors & Omissions, Product Liability, and Commercial General Liability cover, together with any statutorily required workers' compensation, with limits no less than the greater of the contract value or one million dollars (CAD 1,000,000) per claim and in the aggregate. On request the Supplier shall furnish certificates, name NEXPEC and the end client as additional insured on a primary and non-contributory basis, and provide a waiver of subrogation. Lapse of required insurance is a material breach entitling NEXPEC to suspend release of funds.

**7. Confidentiality & Non-Circumvention.** The Supplier shall not solicit, contact, or transact directly with the end client introduced through NEXPEC during the engagement and for twenty-four (24) months thereafter; all coordination runs through the NEXPEC platform.

%4$s

%5$s$md$,
    coalesce(p_title,'this RFQ'),
    to_char(round(p_amount_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'),
    public._brokered_schedule_a_md(p_title, 'assigned'),
    public._brokered_common_terms_md());
$fn$;

-- ── 2c. INSPECTOR — Engagement Master Service Agreement ───────────────────────
CREATE OR REPLACE FUNCTION public._brokered_inspector_engagement_md(p_title text, p_payout_cents bigint, p_currency text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT format($md$# NEXPEC Inspector Engagement (Master Service Agreement)

**Parties.** This Master Service Agreement is between the Inspector and **NEXPEC** (the Broker-of-Record). The Inspector does not contract with, and shall not solicit, the client or the supplier.

**1. Engagement & Standard.** The Inspector shall perform the source / FAT / in-service inspection described in Schedule A to the assigned discipline standard (e.g., ASME, API, ISO, or as specified), independently of the supplier and to the standard of care of a competent inspector qualified in that discipline.

**2. Independence, Routing & Conflicts.** The Inspector is assigned by the method recorded for this deal — broker assignment, algorithmic match, or client selection from a blinded competency dossier. Under every method the Inspector affirms no financial or employment relationship with the supplier, accepts the assignment on an independent basis, shall disclose any actual or potential conflict immediately, and shall recuse where impartiality could be compromised.

**3. Professional Liability (E&O) Insurance.** The Inspector shall maintain Professional Liability / Errors & Omissions cover appropriate to the scope and value of the engagement, with limits no less than the greater of the engagement value or one million dollars (CAD 1,000,000), name NEXPEC and the client as additional insured on a primary and non-contributory basis where applicable, furnish certificates on request, and treat a lapse as a material breach entitling NEXPEC to suspend the payout.

**4. Final Report, Identity & Audit.** The Inspector shall issue the formal inspection report. The Inspector's legal name and signature appear on the final report delivered to the client, which is the client's auditable deliverable for ASME / API and regulatory compliance. Findings shall be reported impartially and completely.

**5. Intellectual Property & Records.** The report and findings are assigned to NEXPEC and the client for the purposes of the engagement; the Inspector shall retain working records in accordance with the applicable standard's retention requirements.

**6. Payout & Deemed Acceptance.** NEXPEC shall pay the Inspector **%2$s %3$s**, from escrow, upon (a) this Agreement being executed and (b) the final report being reviewed and admin-confirmed, or deemed accepted ten (10) business days after delivery absent a substantive Non-Conformance Report. The client price is not disclosed to the Inspector (price-blindness).

**7. Indemnification.** The Inspector shall defend, indemnify, and hold harmless NEXPEC and the client against losses, claims, and costs arising from the Inspector's negligence, wilful misconduct, or breach of this Agreement.

**8. Confidentiality & Non-Circumvention.** The Inspector shall not solicit or transact directly with the client or the supplier for the subject matter of this engagement during the term and for twenty-four (24) months thereafter; all coordination runs through the NEXPEC platform.

%4$s

%5$s$md$,
    coalesce(p_title,'this assignment'),
    to_char(round(p_payout_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'),
    public._brokered_schedule_a_md(p_title, 'assigned'),
    public._brokered_common_terms_md());
$fn$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. MILESTONE-ESCROW MACHINERY (the logic the contracts now describe)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 3a. payment-schedule generator (idempotent, per deal) ─────────────────────
CREATE OR REPLACE FUNCTION public._brokered_ensure_payment_schedule(p_deal_id uuid, p_total_cents bigint, p_currency text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  INSERT INTO public.deal_payment_schedule (deal_id, tranche_no, code, label, pct_bps, amount_cents, trigger_basis)
  SELECT p_deal_id, t.no, t.code, t.label, t.bps,
         (round(coalesce(p_total_cents,0) * t.bps / 10000.0))::bigint, t.basis
  FROM (VALUES
    (1,'mobilization','Mobilization deposit', 3000,'On execution and mobilization'),
    (2,'fat',         'FAT / Inspection',     3000,'On FAT / inspection pass (goods acceptance)'),
    (3,'final',       'Final acceptance',     3000,'On final report acceptance'),
    (4,'retention',   'Retention',            1000,'After the warranty / punch-list period')
  ) t(no, code, label, bps, basis)
  WHERE NOT EXISTS (SELECT 1 FROM public.deal_payment_schedule s WHERE s.deal_id = p_deal_id);
END $fn$;
REVOKE ALL ON FUNCTION public._brokered_ensure_payment_schedule(uuid, bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public._brokered_ensure_payment_schedule(uuid, bigint, text) TO authenticated, service_role;

-- ── 3b. business-day + deemed-acceptance helpers ──────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_business_days_elapsed(p_since timestamptz)
RETURNS integer LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN p_since IS NULL THEN 0 ELSE (
    SELECT count(*)::int
    FROM generate_series((p_since AT TIME ZONE 'UTC')::date + 1,
                         (now()    AT TIME ZONE 'UTC')::date,
                         interval '1 day') AS d
    WHERE extract(isodow FROM d) < 6   -- Mon..Fri (statutory holidays not modelled)
  ) END;
$fn$;

CREATE OR REPLACE FUNCTION public.nx_milestone_deemed_accepted(p_deal_id uuid, p_kind text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = public AS $fn$
DECLARE v_delivered timestamptz; v_open int; v_sla int := 10;
BEGIN
  SELECT CASE WHEN p_kind = 'report' THEN report_delivered_at ELSE goods_delivered_at END
    INTO v_delivered FROM public.deals WHERE id = p_deal_id;
  IF v_delivered IS NULL THEN RETURN false; END IF;
  SELECT count(*) INTO v_open FROM public.deal_nonconformances
    WHERE deal_id = p_deal_id AND kind = p_kind AND status = 'open';
  IF v_open > 0 THEN RETURN false; END IF;                       -- a substantive NCR freezes escrow
  RETURN public.nx_business_days_elapsed(v_delivered) >= v_sla;  -- 10 business days of silence = acceptance
END $fn$;

-- ── 3c. delivery setters (start the deemed-acceptance clock) ───────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_goods_delivered(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE public.deals SET goods_delivered_at = COALESCE(goods_delivered_at, now()) WHERE id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;
  RETURN jsonb_build_object('deal_id', p_deal_id, 'goods_delivered', true);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_mark_goods_delivered(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_mark_goods_delivered(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_mark_report_delivered(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  UPDATE public.deals SET report_delivered_at = COALESCE(report_delivered_at, now()) WHERE id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;
  RETURN jsonb_build_object('deal_id', p_deal_id, 'report_delivered', true);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_mark_report_delivered(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_mark_report_delivered(uuid) TO authenticated, service_role;

-- ── 3d. raise_nonconformance — the substantive rejection that freezes escrow ───
CREATE OR REPLACE FUNCTION public.raise_nonconformance(
  p_deal_id uuid, p_kind text, p_citation text, p_basis text DEFAULT 'schedule_a_spec', p_code_ref text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_uid uuid := auth.uid(); v_d public.deals; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF p_kind NOT IN ('goods','report') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  IF p_basis NOT IN ('schedule_a_spec','code') THEN RAISE EXCEPTION 'invalid_basis'; END IF;
  IF p_citation IS NULL OR length(btrim(p_citation)) < 20 THEN
    RAISE EXCEPTION 'NCR_NOT_SUBSTANTIVE: a rejection must cite a specific Schedule A spec or ASME/API code deviation';
  END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;
  IF NOT (v_d.client_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  INSERT INTO public.deal_nonconformances (deal_id, kind, raised_by, basis, code_ref, citation)
  VALUES (p_deal_id, p_kind, v_uid, p_basis, p_code_ref, btrim(p_citation))
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ncr_id', v_id, 'deal_id', p_deal_id, 'kind', p_kind, 'status', 'open');
END $fn$;
REVOKE ALL ON FUNCTION public.raise_nonconformance(uuid, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.raise_nonconformance(uuid, text, text, text, text) TO authenticated, service_role;

-- ── 3e. fund_deal_balance — the 70% balance at FAT-readiness (hybrid funding) ──
CREATE OR REPLACE FUNCTION public.fund_deal_balance(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_uid uuid := auth.uid(); v_d public.deals; v_leg public.deal_money_legs; v_agr uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;
  IF NOT (v_d.client_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_d.deposit_funded_at IS NULL THEN RAISE EXCEPTION 'DEPOSIT_NOT_FUNDED: sign and fund the mobilization deposit first'; END IF;
  IF v_d.balance_funded_at IS NOT NULL THEN
    RETURN jsonb_build_object('deal_id', p_deal_id, 'status', 'already_funded', 'reused', true);
  END IF;

  -- the executed client_supply gates the escrow hold
  SELECT id INTO v_agr FROM public.agreements
   WHERE deal_id = p_deal_id AND kind = 'client_supply' AND status = 'executed'
   ORDER BY version DESC LIMIT 1;
  IF v_agr IS NULL THEN RAISE EXCEPTION 'CLIENT_AGREEMENT_NOT_EXECUTED'; END IF;

  -- top the single client_escrow_in hold up to the full contract price
  SELECT * INTO v_leg FROM public.deal_money_legs WHERE deal_id = p_deal_id AND kind = 'client_escrow_in' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.deal_money_legs SET amount_cents = v_d.client_price_cents, status = 'held'
     WHERE id = v_leg.id;
  ELSE
    INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status)
    VALUES (p_deal_id, v_agr, 'client_escrow_in', v_d.client_price_cents, v_d.currency, 'held');
  END IF;

  UPDATE public.deals SET balance_funded_at = now() WHERE id = p_deal_id;
  RETURN jsonb_build_object('deal_id', p_deal_id, 'status', 'balance_funded',
                            'escrowed_cents', v_d.client_price_cents);
END $fn$;
REVOKE ALL ON FUNCTION public.fund_deal_balance(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.fund_deal_balance(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. RE-WIRE THE SAGA — schedule generation, routing record, deposit funding,
--    deemed-acceptance in the release gates
-- ════════════════════════════════════════════════════════════════════════════

-- ── 4a. award_and_dispatch — also generate the payment schedule at award ──────
CREATE OR REPLACE FUNCTION public.award_and_dispatch(p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_q   public.supplier_quotes;
  v_rfq public.supplier_rfqs;
  v_deal_id uuid;
  v_agr_id  uuid;
  v_body text;
  v_sha  text;
  v_source_fat boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_q FROM public.supplier_quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_quote'; END IF;
  SELECT * INTO v_rfq FROM public.supplier_rfqs WHERE id = v_q.rfq_id FOR UPDATE;
  IF NOT (v_rfq.client_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_q.client_price_cents IS NULL THEN RAISE EXCEPTION 'QUOTE_NOT_PRICED'; END IF;
  IF NOT public.nx_is_admin() AND v_q.status <> 'presented' THEN RAISE EXCEPTION 'QUOTE_NOT_PRESENTED'; END IF;

  SELECT d.id INTO v_deal_id FROM public.deals d WHERE d.awarded_quote_id = p_quote_id LIMIT 1;
  IF v_deal_id IS NOT NULL THEN
    PERFORM public._brokered_ensure_payment_schedule(v_deal_id, v_q.client_price_cents, 'USD');
    SELECT a.id INTO v_agr_id FROM public.agreements a
     WHERE a.deal_id = v_deal_id AND a.kind = 'client_supply' ORDER BY a.version DESC LIMIT 1;
    RETURN jsonb_build_object('deal_id', v_deal_id, 'client_agreement_id', v_agr_id, 'reused', true);
  END IF;

  v_source_fat := coalesce(v_rfq.requires_source_inspection, true);

  INSERT INTO public.deals (rfq_id, client_id, client_price_cents, currency, awarded_quote_id, status, created_by)
  VALUES (v_rfq.id, v_rfq.client_id, v_q.client_price_cents, 'USD', p_quote_id, 'awaiting_client_signature', v_uid)
  RETURNING id INTO v_deal_id;

  PERFORM public._brokered_ensure_payment_schedule(v_deal_id, v_q.client_price_cents, 'USD');

  v_body := public._brokered_client_supply_md(v_rfq.title, v_q.client_price_cents, 'USD', 'standard', v_source_fat);
  v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');

  INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency,
                                 body_md, content_sha256, ots_status, presented_at, generated_by)
  VALUES (v_deal_id, 'client_supply', 'presented', v_rfq.client_id, v_q.client_price_cents, 'USD',
          v_body, v_sha, 'unsubmitted', now(), v_uid)
  RETURNING id INTO v_agr_id;

  RETURN jsonb_build_object('deal_id', v_deal_id, 'client_agreement_id', v_agr_id, 'reused', false);
END $fn$;
REVOKE ALL ON FUNCTION public.award_and_dispatch(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.award_and_dispatch(uuid) TO authenticated;

-- ── 4b. sign_agreement — client_supply funds the 30% DEPOSIT only (hybrid) ─────
CREATE OR REPLACE FUNCTION public.sign_agreement(
  p_agreement_id uuid, p_signed_name text, p_ip text DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_a   public.agreements;
  v_d   public.deals;
  v_q   public.supplier_quotes;
  v_role text;
  v_job public.jobs;
  v_cost bigint;
  v_deposit bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_a FROM public.agreements WHERE id = p_agreement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_agreement'; END IF;
  IF NOT (v_a.counterparty_id = v_uid OR public.nx_is_admin()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF v_a.status <> 'presented' THEN RAISE EXCEPTION 'AGREEMENT_NOT_PRESENTED: status=%', v_a.status; END IF;

  v_role := CASE v_a.kind WHEN 'client_supply' THEN 'client'
                          WHEN 'supplier_supply' THEN 'supplier'
                          ELSE 'inspector' END;

  INSERT INTO public.agreement_signatures (agreement_id, signer_id, party_role, signed_name, signed_sha256, ip, user_agent)
  VALUES (p_agreement_id, v_uid, v_role, p_signed_name, v_a.content_sha256, p_ip, p_user_agent);

  UPDATE public.agreements
     SET status = 'executed', signed_at = now(), countersigned_at = now(), executed_at = now()
   WHERE id = p_agreement_id;

  IF v_a.kind = 'client_supply' THEN
    SELECT * INTO v_d FROM public.deals WHERE id = v_a.deal_id FOR UPDATE;
    PERFORM public._brokered_ensure_payment_schedule(v_d.id, v_d.client_price_cents, v_d.currency);

    -- HYBRID FUNDING: hold the 30% mobilization deposit now; balance at FAT-readiness.
    v_deposit := (round(coalesce(v_d.client_price_cents,0) * 0.30))::bigint;
    INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status)
    VALUES (v_d.id, v_a.id, 'client_escrow_in', v_deposit, v_d.currency, 'held')
    ON CONFLICT (deal_id, kind) DO NOTHING;
    UPDATE public.deals SET deposit_funded_at = COALESCE(deposit_funded_at, now()), status = 'funded' WHERE id = v_d.id;

    IF v_d.awarded_quote_id IS NOT NULL THEN
      SELECT * INTO v_q FROM public.supplier_quotes WHERE id = v_d.awarded_quote_id;
      BEGIN
        v_job := public.award_quote(v_d.awarded_quote_id);
      EXCEPTION WHEN OTHERS THEN v_job := NULL;
      END;
      IF v_job.id IS NOT NULL THEN
        UPDATE public.deals SET job_id = v_job.id WHERE id = v_d.id;
        UPDATE public.jobs  SET escrow_status = 'funded' WHERE id = v_job.id;
      END IF;

      v_cost := public._quote_raw_cents(v_q.quote);
      INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency, generated_by)
      VALUES (v_d.id, 'supplier_supply', 'draft', v_q.supplier_id, coalesce(v_cost,0), v_d.currency, v_uid)
      ON CONFLICT (deal_id, kind, version) DO NOTHING;
    END IF;

    UPDATE public.deals SET status = 'dispatched' WHERE id = v_d.id;
  END IF;

  RETURN jsonb_build_object('agreement_id', p_agreement_id, 'status', 'executed',
                            'deal_id', v_a.deal_id, 'job_id', (SELECT job_id FROM public.deals WHERE id = v_a.deal_id));
END $fn$;
REVOKE ALL ON FUNCTION public.sign_agreement(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.sign_agreement(uuid, text, text, text) TO authenticated;

-- ── 4c. admin_assign_inspector — record the routing method that governs ────────
--   NOTE: this REPLACES the P3/P4 (124800) version and PRESERVES its full body —
--   the A/B/C trust-artifact emission + the tier-based D client-review window —
--   while adding the routing record + the upgraded inspector template (auto via
--   _brokered_inspector_engagement_md). The arity widens 3→4, so the old 3-arg is
--   dropped first to avoid a PostgREST overload (the nx_is_admin ambiguity trap).
--   The web caller passes 3 named args → resolves to this 4-arg via the default.
DROP FUNCTION IF EXISTS public.admin_assign_inspector(uuid, uuid, bigint);
CREATE OR REPLACE FUNCTION public.admin_assign_inspector(
  p_deal_id uuid, p_inspector_id uuid, p_payout_cents bigint, p_routing text DEFAULT 'broker_assignment'
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $fn$
DECLARE
  v_d public.deals; v_title text; v_body text; v_sha text; v_agr_id uuid;
  v_supplier_id uuid; v_supplier_handle text; v_art jsonb; v_deadline timestamptz; v_routing text;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  IF p_inspector_id IS NULL THEN RAISE EXCEPTION 'inspector_required'; END IF;
  IF p_payout_cents IS NULL OR p_payout_cents < 0 THEN RAISE EXCEPTION 'invalid_payout'; END IF;
  v_routing := CASE WHEN p_routing IN ('broker_assignment','algorithmic_match','client_selection')
                    THEN p_routing ELSE 'broker_assignment' END;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;

  -- record the routing method that GOVERNS this deal (the contract clause references it)
  UPDATE public.deals SET inspector_routing = v_routing WHERE id = p_deal_id;

  SELECT r.title INTO v_title FROM public.supplier_rfqs r WHERE r.id = v_d.rfq_id;
  v_body := public._brokered_inspector_engagement_md(v_title, p_payout_cents, v_d.currency);
  v_sha  := encode(extensions.digest(v_body, 'sha256'), 'hex');

  -- upsert the engagement agreement (presented)
  SELECT id INTO v_agr_id FROM public.agreements
   WHERE deal_id = p_deal_id AND kind = 'inspector_engagement' AND status <> 'voided'
   ORDER BY version DESC LIMIT 1;
  IF v_agr_id IS NULL THEN
    INSERT INTO public.agreements (deal_id, kind, status, counterparty_id, amount_cents, currency, body_md, content_sha256, presented_at, generated_by)
    VALUES (p_deal_id, 'inspector_engagement', 'presented', p_inspector_id, p_payout_cents, v_d.currency, v_body, v_sha, now(), auth.uid())
    RETURNING id INTO v_agr_id;
  ELSE
    UPDATE public.agreements
       SET counterparty_id = p_inspector_id, amount_cents = p_payout_cents, body_md = v_body,
           content_sha256 = v_sha, status = 'presented', presented_at = now()
     WHERE id = v_agr_id AND status <> 'executed';
  END IF;

  IF v_d.job_id IS NOT NULL THEN
    UPDATE public.jobs SET contractor_id = p_inspector_id, inspector_payout_cents = p_payout_cents WHERE id = v_d.job_id;
  END IF;

  -- A/B/C trust artifacts (anonymized) + D review window by transparency tier (PRESERVED from 124800)
  SELECT supplier_id INTO v_supplier_id FROM public.supplier_quotes WHERE id = v_d.awarded_quote_id;
  v_supplier_handle := CASE WHEN v_supplier_id IS NULL THEN NULL
    ELSE 'NX-' || upper(substr(encode(extensions.digest(v_supplier_id::text, 'sha256'), 'hex'), 1, 6)) END;
  v_art := public._brokered_build_trust_artifacts(p_inspector_id, v_supplier_handle, v_title, v_d.transparency_tier);
  v_deadline := CASE v_d.transparency_tier
    WHEN 'standard'   THEN now() + interval '24 hours'
    WHEN 'enterprise' THEN now() + interval '48 hours'
    ELSE NULL END;   -- 'named' = manual approval only

  INSERT INTO public.inspector_engagement_meta
    (agreement_id, deal_id, inspector_id, dossier, certificate, independence, artifacts_sha, client_review, review_deadline, object_reason, reviewed_at)
  VALUES (v_agr_id, p_deal_id, p_inspector_id, v_art->'dossier', v_art->'certificate', v_art->'independence',
          encode(extensions.digest(v_art::text, 'sha256'), 'hex'), 'pending', v_deadline, NULL, NULL)
  ON CONFLICT (agreement_id) DO UPDATE SET
    inspector_id = EXCLUDED.inspector_id, dossier = EXCLUDED.dossier, certificate = EXCLUDED.certificate,
    independence = EXCLUDED.independence, artifacts_sha = EXCLUDED.artifacts_sha,
    client_review = 'pending', review_deadline = EXCLUDED.review_deadline, object_reason = NULL, reviewed_at = NULL;

  RETURN jsonb_build_object('agreement_id', v_agr_id, 'deal_id', p_deal_id, 'status', 'presented',
                            'routing', v_routing, 'review_deadline', v_deadline);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_assign_inspector(uuid, uuid, bigint, text) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_assign_inspector(uuid, uuid, bigint, text) TO authenticated, service_role;

-- ── 4d. release gates honor deemed-acceptance (silence) + freeze on open NCR ───
CREATE OR REPLACE FUNCTION public.release_supplier_payout(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_d public.deals; v_a public.agreements; v_accepted boolean;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;

  v_accepted := (v_d.goods_accepted_at IS NOT NULL) OR public.nx_milestone_deemed_accepted(p_deal_id, 'goods');
  IF NOT v_accepted THEN
    RAISE EXCEPTION 'GOODS_NOT_ACCEPTED: accept goods, or wait out the 10-business-day deemed-acceptance window, before paying the supplier';
  END IF;

  SELECT * INTO v_a FROM public.agreements
   WHERE deal_id = p_deal_id AND kind = 'supplier_supply' AND status <> 'voided'
   ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_supplier_agreement'; END IF;
  IF v_a.status <> 'executed' THEN RAISE EXCEPTION 'CONTRACT-BEFORE-MONEY: supplier agreement is % (must be executed)', v_a.status; END IF;

  INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status, released_at)
  VALUES (p_deal_id, v_a.id, 'supplier_payout', v_a.amount_cents, v_d.currency, 'released', now())
  ON CONFLICT (deal_id, kind) DO UPDATE
    SET status = 'released', released_at = now(), agreement_id = EXCLUDED.agreement_id, amount_cents = EXCLUDED.amount_cents;
  RETURN jsonb_build_object('deal_id', p_deal_id, 'kind', 'supplier_payout', 'status', 'released');
END $fn$;
REVOKE ALL ON FUNCTION public.release_supplier_payout(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.release_supplier_payout(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.release_inspector_payout(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_d public.deals; v_a public.agreements; v_confirmed timestamptz; v_ok boolean;
BEGIN
  IF NOT public.nx_is_admin() THEN RAISE EXCEPTION 'admin only'; END IF;
  SELECT * INTO v_d FROM public.deals WHERE id = p_deal_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_deal'; END IF;

  SELECT admin_confirmed_at INTO v_confirmed FROM public.jobs WHERE id = v_d.job_id;
  v_ok := (v_confirmed IS NOT NULL) OR public.nx_milestone_deemed_accepted(p_deal_id, 'report');
  IF NOT v_ok THEN
    RAISE EXCEPTION 'REPORT_NOT_CONFIRMED: confirm the report, or wait out the 10-business-day deemed-acceptance window, before paying the inspector';
  END IF;

  SELECT * INTO v_a FROM public.agreements
   WHERE deal_id = p_deal_id AND kind = 'inspector_engagement' AND status <> 'voided'
   ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_inspector_agreement'; END IF;
  IF v_a.status <> 'executed' THEN RAISE EXCEPTION 'CONTRACT-BEFORE-MONEY: inspector agreement is % (must be executed)', v_a.status; END IF;

  INSERT INTO public.deal_money_legs (deal_id, agreement_id, kind, amount_cents, currency, status, released_at)
  VALUES (p_deal_id, v_a.id, 'inspector_payout', v_a.amount_cents, v_d.currency, 'released', now())
  ON CONFLICT (deal_id, kind) DO UPDATE
    SET status = 'released', released_at = now(), agreement_id = EXCLUDED.agreement_id, amount_cents = EXCLUDED.amount_cents;
  RETURN jsonb_build_object('deal_id', p_deal_id, 'kind', 'inspector_payout', 'status', 'released');
END $fn$;
REVOKE ALL ON FUNCTION public.release_inspector_payout(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.release_inspector_payout(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. BACKFILL — every priced deal gets the 30/30/30+10 schedule
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.deal_payment_schedule (deal_id, tranche_no, code, label, pct_bps, amount_cents, trigger_basis)
SELECT d.id, t.no, t.code, t.label, t.bps,
       (round(d.client_price_cents * t.bps / 10000.0))::bigint, t.basis
FROM public.deals d
CROSS JOIN (VALUES
  (1,'mobilization','Mobilization deposit', 3000,'On execution and mobilization'),
  (2,'fat',         'FAT / Inspection',     3000,'On FAT / inspection pass (goods acceptance)'),
  (3,'final',       'Final acceptance',     3000,'On final report acceptance'),
  (4,'retention',   'Retention',            1000,'After the warranty / punch-list period')
) t(no, code, label, bps, basis)
WHERE d.client_price_cents > 0
  AND NOT EXISTS (SELECT 1 FROM public.deal_payment_schedule s WHERE s.deal_id = d.id);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. SELF-TESTS
-- ════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v_body text;
BEGIN
  -- schema
  IF to_regclass('public.deal_payment_schedule') IS NULL THEN RAISE EXCEPTION 'SELFTEST: deal_payment_schedule missing'; END IF;
  IF to_regclass('public.deal_nonconformances') IS NULL THEN RAISE EXCEPTION 'SELFTEST: deal_nonconformances missing'; END IF;
  -- helpers / rpcs
  IF to_regprocedure('public.fund_deal_balance(uuid)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: fund_deal_balance missing'; END IF;
  IF to_regprocedure('public.raise_nonconformance(uuid,text,text,text,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: raise_nonconformance missing'; END IF;
  IF to_regprocedure('public.nx_milestone_deemed_accepted(uuid,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: deemed-acceptance helper missing'; END IF;
  IF to_regprocedure('public.admin_assign_inspector(uuid,uuid,bigint,text)') IS NULL THEN RAISE EXCEPTION 'SELFTEST: admin_assign_inspector(4-arg) missing'; END IF;

  -- the three templates must carry the upgraded MSA spine
  v_body := public._brokered_client_supply_md('X', 1000000, 'USD', 'standard', true);
  IF v_body NOT LIKE '%Province of Quebec%'        THEN RAISE EXCEPTION 'SELFTEST: client template missing Quebec governing law'; END IF;
  IF v_body NOT LIKE '%ADRIC%'                     THEN RAISE EXCEPTION 'SELFTEST: client template missing ADRIC arbitration'; END IF;
  IF v_body NOT LIKE '%Warranty Pass-Through%'     THEN RAISE EXCEPTION 'SELFTEST: client template missing warranty pass-through'; END IF;
  IF v_body NOT LIKE '%Deemed Acceptance%'         THEN RAISE EXCEPTION 'SELFTEST: client template missing deemed-acceptance'; END IF;
  IF v_body NOT LIKE '%Schedule B%'                THEN RAISE EXCEPTION 'SELFTEST: client template missing payment schedule'; END IF;
  IF v_body NOT LIKE '%30%'                        THEN RAISE EXCEPTION 'SELFTEST: client schedule missing tranche percentages'; END IF;
  IF v_body NOT LIKE '%Routing%'                   THEN RAISE EXCEPTION 'SELFTEST: client template missing routing clause'; END IF;

  v_body := public._brokered_supplier_supply_md('X', 1000, 'USD');
  IF v_body NOT LIKE '%Province of Quebec%'        THEN RAISE EXCEPTION 'SELFTEST: supplier template missing governing law'; END IF;
  IF v_body NOT LIKE '%primary and non-contributory%' THEN RAISE EXCEPTION 'SELFTEST: supplier template missing indemnity/insurance armor'; END IF;
  IF v_body NOT LIKE '%back-to-back%'              THEN RAISE EXCEPTION 'SELFTEST: supplier template missing warranty pass-through'; END IF;

  v_body := public._brokered_inspector_engagement_md('X', 1000, 'USD');
  IF v_body NOT LIKE '%Province of Quebec%'        THEN RAISE EXCEPTION 'SELFTEST: inspector template missing governing law'; END IF;
  IF v_body NOT LIKE '%Routing%'                   THEN RAISE EXCEPTION 'SELFTEST: inspector template missing routing clause'; END IF;
  IF v_body NOT LIKE '%Deemed Acceptance%'         THEN RAISE EXCEPTION 'SELFTEST: inspector template missing deemed-acceptance'; END IF;

  RAISE NOTICE 'MSA upgrade OK: Quebec/ADRIC + 30/30/30+10 hybrid escrow + routing + warranty pass-through + deemed-acceptance(NCR) across all three templates.';
END $$;

COMMIT;
