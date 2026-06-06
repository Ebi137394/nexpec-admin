-- ════════════════════════════════════════════════════════════════════════════
--  20260801125500_unified_contracts_consolidation.sql
--
--  UNIFIED CONTRACTS — one legal source of truth for the UI.
--
--  Two parts:
--    1) LEGAL RIGOR — upgrade the two thin brokered templates (supplier_supply,
--       inspector_engagement) to full Master Service Agreement + Schedule,
--       porting the meticulous indemnity / E&O / confidentiality / survival
--       language of the original V3 MSAs. (client_supply already carries the
--       full liability-cap + escrow + credential clauses; left untouched.)
--       Templates are rendered at present/assign time, so this applies ONLY to
--       NEW or PENDING contracts; already-executed/sealed bodies are immutable.
--
--    2) SINGLE READ MODEL — unified_contracts_view: every contract a party can
--       see, exactly once, price-blind. UNION of:
--         • the brokered spine `agreements` (native + already-adopted legacy)
--         • any un-adopted V3 job_contracts  (client + inspector projections)
--         • any un-adopted V3 supplier_contracts (supplier projection)
--       De-duped on the spine `legacy_ref`, so a contract adopted into the spine
--       never also appears via its V3 row. V1 `contracts` (assignments) are
--       intentionally excluded — admin archive only.
--
--  Owner-run + security_barrier (mirrors the P0 party views): the per-branch
--  `WHERE counterparty = auth.uid() OR nx_is_admin()` is the security boundary,
--  and each row carries exactly ONE amount for ONE party (no cross-party price).
--
--  Idempotent. ADDITIVE. No legacy row is modified or deleted.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Legal rigor: MSA + Schedule (supplier) ────────────────────────────────
CREATE OR REPLACE FUNCTION public._brokered_supplier_supply_md(p_title text, p_amount_cents bigint, p_currency text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format(
$md$# NEXPEC Supplier Supply Agreement

## Master Service Agreement (MSA)

**Parties.** This Agreement is between the Supplier and **NEXPEC** (the Broker-of-Record). The Supplier supplies to NEXPEC; the Supplier does not contract with, and shall not solicit, the end client.

**1. Engagement & standard.** The Supplier shall supply the goods and/or services described in Schedule A to the specification, codes, and quality standards stated therein, and shall permit NEXPEC source / Factory Acceptance Test (FAT) inspection before shipment.

**2. Quality, inspection & acceptance.** The Supplier shall grant the NEXPEC-assigned inspector reasonable access for FAT / QA-QC. Goods that are non-conforming, defective, or late may be rejected; NEXPEC may withhold payment until the non-conformity is remedied or the order is re-performed at the Supplier's cost.

**3. Strict indemnification (Supplier bears one hundred percent of the liability).** The Supplier assumes full and sole responsibility for its goods, services, acts, and omissions, and shall defend, indemnify, and hold harmless NEXPEC, its affiliates, officers, employees, and the end client (the "Indemnified Parties") from and against any and all claims, demands, losses, damages, liabilities, fines, penalties, and costs (including reasonable legal and expert fees) arising out of or relating to: (a) defective, non-conforming, late, or deficient goods or services; (b) damage to industrial equipment, facilities, or property; (c) bodily injury or death; (d) the Supplier's negligence, recklessness, or wilful misconduct; (e) infringement of any intellectual-property or other third-party right; or (f) the Supplier's breach of this Agreement or violation of law. This indemnity is primary and non-contributory, is not capped, and survives termination or completion.

**4. Professional liability (E&O) insurance.** Throughout the term and any applicable warranty period the Supplier shall maintain, at its own expense, valid Professional Liability / Errors & Omissions cover, together with Commercial General Liability and any statutorily required workers' compensation, with limits customary for the industry and commensurate with the value and risk of the engagement. On request the Supplier shall furnish certificates of insurance, name NEXPEC as additional insured, and confirm such cover is primary and non-contributory. Lapse of required insurance is a material breach and entitles NEXPEC to suspend release of funds.

**5. Warranty & title.** The Supplier warrants the goods conform to specification and are free of defects and third-party IP claims. Title and risk pass to NEXPEC (or its nominee) on NEXPEC's acceptance of the goods.

**6. Confidentiality & non-circumvention.** The Supplier shall not solicit, contact, or transact directly with the end client introduced through NEXPEC during the engagement and for twenty-four (24) months thereafter; all coordination runs through the NEXPEC platform.

**7. Term, termination & survival.** This Agreement governs the engagement in Schedule A and may be terminated for material breach. Sections 3, 4, 5, and 6 survive termination or completion.

**8. Governing terms & disputes.** Disputes are handled through NEXPEC's escrow-backed resolution process; this Agreement incorporates NEXPEC's standard platform terms.

## Schedule A — Engagement particulars

- **Subject.** "%1$s"
- **Supplier consideration.** NEXPEC shall pay the Supplier **%2$s %3$s**, from escrow, upon (a) this Agreement being executed and (b) NEXPEC's acceptance of the goods (inspection passed). No advance is due.
- **Inspection.** NEXPEC-assigned independent inspector; source / FAT before shipment where specified.
- **Price-blindness.** The end-client price is not disclosed to the Supplier.

_Sealed on execution (SHA-256 + OpenTimestamps), verifiable at /passport._$md$,
    coalesce(p_title,'this RFQ'),
    to_char(round(p_amount_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'));
$$;

-- ── 1b. Legal rigor: MSA + Schedule (inspector) ──────────────────────────────
CREATE OR REPLACE FUNCTION public._brokered_inspector_engagement_md(p_title text, p_payout_cents bigint, p_currency text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format(
$md$# NEXPEC Inspector Engagement

## Master Service Agreement (MSA)

**Parties.** This Agreement is between the Inspector and **NEXPEC** (the Broker-of-Record). The Inspector does not contract with, and shall not solicit, the client or the supplier.

**1. Engagement & standard.** The Inspector shall perform the source / FAT / in-service inspection described in Schedule A to the assigned discipline standard (e.g., ASME, API, ISO, or as specified), independently of the supplier and to the standard of care of a competent inspector qualified in that discipline.

**2. Independence & conflicts of interest.** The Inspector affirms no financial or employment relationship with the supplier, accepts the assignment on a blind-matched basis, shall disclose any actual or potential conflict immediately, and shall recuse where impartiality could be compromised.

**3. Professional liability (E&O) insurance.** The Inspector shall maintain Professional Liability / Errors & Omissions cover appropriate to the scope and value of the engagement, furnish certificates on request, and treat a lapse as a material breach entitling NEXPEC to suspend the payout.

**4. Final report, identity & audit.** The Inspector shall issue the formal inspection report. The Inspector's legal name and signature appear on the final report delivered to the client, which is the client's auditable deliverable for ASME / API and regulatory compliance. Findings shall be reported impartially and completely.

**5. Intellectual property & records.** The report and findings are assigned to NEXPEC and the client for the purposes of the engagement; the Inspector shall retain working records in accordance with the applicable standard's retention requirements.

**6. Indemnification.** The Inspector shall defend, indemnify, and hold harmless NEXPEC and the client against losses, claims, and costs arising from the Inspector's negligence, wilful misconduct, or breach of this Agreement. This indemnity survives termination or completion.

**7. Confidentiality & non-circumvention.** The Inspector shall not solicit or transact directly with the client or the supplier for the subject matter of this engagement during the term and for twenty-four (24) months thereafter; all coordination runs through the NEXPEC platform.

**8. Term, termination & survival.** This Agreement governs the engagement in Schedule A and may be terminated for material breach. Sections 4, 5, 6, and 7 survive termination or completion.

**9. Governing terms & disputes.** Disputes are handled through NEXPEC's escrow-backed resolution process; this Agreement incorporates NEXPEC's standard platform terms.

## Schedule A — Engagement particulars

- **Assignment.** "%1$s"
- **Inspector payout.** NEXPEC shall pay the Inspector **%2$s %3$s**, from escrow, upon (a) this Agreement being executed and (b) the final report being reviewed and admin-confirmed.
- **Price-blindness.** The client price is not disclosed to the Inspector.

_Sealed on execution (SHA-256 + OpenTimestamps), verifiable at /passport._$md$,
    coalesce(p_title,'this assignment'),
    to_char(round(p_payout_cents/100.0, 2), 'FM999G999G990D00'),
    coalesce(p_currency,'USD'));
$$;

-- ── 2. Single read model: unified_contracts_view ─────────────────────────────
DROP VIEW IF EXISTS public.unified_contracts_view;
CREATE VIEW public.unified_contracts_view WITH (security_barrier = true) AS
  -- (1) Brokered spine: native + already-adopted legacy. One amount per party.
  SELECT
    a.id::text                          AS contract_id,
    'spine'::text                       AS source,
    a.kind                              AS kind,
    a.counterparty_id                   AS counterparty_id,
    a.status                            AS status,
    (a.status = 'presented')            AS signable,
    a.amount_cents::bigint              AS amount_cents,
    a.currency                          AS currency,
    a.body_md                           AS body_md,
    a.content_sha256                    AS content_sha256,
    a.deal_id                           AS deal_id,
    d.job_id                            AS job_id,
    a.signed_at                         AS signed_at,
    a.executed_at                       AS executed_at,
    a.created_at                        AS created_at,
    a.legacy_ref                        AS legacy_ref
  FROM public.agreements a
  JOIN public.deals d ON d.id = a.deal_id
  WHERE a.counterparty_id = auth.uid() OR public.nx_is_admin()

  UNION ALL
  -- (2) Un-adopted job_contracts → client projection (client price only).
  SELECT
    'jc:'||jc.id||':client', 'job_contract', 'client_supply',
    jc.client_id, jc.status,
    (jc.client_signed_at IS NULL AND jc.status NOT IN ('voided','fully_executed')),
    jc.client_price_cents::bigint, 'USD', jc.contract_text_md, NULL::text,
    NULL::uuid, jc.job_id, jc.client_signed_at,
    CASE WHEN jc.status = 'fully_executed' THEN jc.updated_at END,
    jc.created_at, 'jc:'||jc.id||':client'
  FROM public.job_contracts jc
  WHERE jc.client_id IS NOT NULL
    AND (jc.client_id = auth.uid() OR public.nx_is_admin())
    AND NOT EXISTS (SELECT 1 FROM public.agreements a WHERE a.legacy_ref = 'jc:'||jc.id||':client')

  UNION ALL
  -- (3) Un-adopted job_contracts → inspector projection (payout only).
  SELECT
    'jc:'||jc.id||':inspector', 'job_contract', 'inspector_engagement',
    jc.inspector_id, jc.status,
    (jc.inspector_signed_at IS NULL AND jc.status NOT IN ('voided','fully_executed')),
    jc.inspector_payout_cents::bigint, 'USD', jc.contract_text_md, NULL::text,
    NULL::uuid, jc.job_id, jc.inspector_signed_at,
    CASE WHEN jc.status = 'fully_executed' THEN jc.updated_at END,
    jc.created_at, 'jc:'||jc.id||':inspector'
  FROM public.job_contracts jc
  WHERE jc.inspector_id IS NOT NULL
    AND (jc.inspector_id = auth.uid() OR public.nx_is_admin())
    AND NOT EXISTS (SELECT 1 FROM public.agreements a WHERE a.legacy_ref = 'jc:'||jc.id||':inspector')

  UNION ALL
  -- (4) Un-adopted supplier_contracts → supplier projection (cost only).
  SELECT
    'sc:'||sc.id, 'supplier_contract', 'supplier_supply',
    sc.supplier_id, sc.status,
    (sc.supplier_signed_at IS NULL AND sc.status NOT IN ('voided','executed')),
    sc.amount_cents::bigint, 'USD', sc.contract_text_md, sc.content_sha256,
    NULL::uuid, sc.job_id, sc.supplier_signed_at, sc.executed_at,
    sc.created_at, 'sc:'||sc.id
  FROM public.supplier_contracts sc
  WHERE sc.supplier_id IS NOT NULL
    AND (sc.supplier_id = auth.uid() OR public.nx_is_admin())
    AND NOT EXISTS (SELECT 1 FROM public.agreements a WHERE a.legacy_ref = 'sc:'||sc.id);

GRANT SELECT ON public.unified_contracts_view TO authenticated;

-- ── 3. Self-tests ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public._brokered_supplier_supply_md(text,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: supplier template missing';
  END IF;
  IF to_regprocedure('public._brokered_inspector_engagement_md(text,bigint,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: inspector template missing';
  END IF;
  IF to_regclass('public.unified_contracts_view') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: unified_contracts_view missing';
  END IF;
  -- Rigor smoke test: the enriched templates must carry the MSA spine.
  IF public._brokered_inspector_engagement_md('X', 1000, 'USD') NOT LIKE '%Master Service Agreement%' THEN
    RAISE EXCEPTION 'SELFTEST: inspector template not upgraded to MSA';
  END IF;
  IF public._brokered_supplier_supply_md('X', 1000, 'USD') NOT LIKE '%indemnif%' THEN
    RAISE EXCEPTION 'SELFTEST: supplier template missing indemnification';
  END IF;
  RAISE NOTICE 'Unified contracts OK: MSA+Schedule templates + price-blind unified_contracts_view.';
END $$;

COMMIT;
