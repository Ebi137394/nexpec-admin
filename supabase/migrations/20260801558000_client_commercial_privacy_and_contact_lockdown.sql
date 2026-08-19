-- ════════════════════════════════════════════════════════════════════════════
--  20260801558000_client_commercial_privacy_and_contact_lockdown.sql
--
--  OWNER-REVIEW STRICT FIXTURE — two commercial-privacy defects, both
--  REPRODUCED on Staging before this migration was written:
--
--  1. CONTRACT BODY LEAK. job_contracts.contract_text_md is admin-authored
--     free text. The STRICT fixture stores:
--
--         ## NEXPEC Owner-Review Agreement
--         Client price $1,000.00 - Inspector payout $800.00 - 20/80 staged funding.
--
--     client_job_contracts_view, inspector_job_contracts_view and BOTH
--     job_contract legs of unified_contracts_view forwarded that column RAW,
--     so the Client received the Inspector's payout and platform spread, and
--     the Inspector received the Client's price. The structured price columns
--     were already blind (the client view has no inspector_payout_cents at
--     all); the free-text column was the bypass. A code comment in the web
--     template claimed "both UIs strip the other party's price line via a
--     per-role post-process" — no such post-process existed anywhere.
--
--  2. PRIVATE-CONTACT LEAK. Under identity_mode='full' the client-facing
--     views resolved the Inspector's real email and phone. New owner policy:
--     clients and inspectors must NEVER receive each other's private contact
--     details in ANY identity mode — full mode still discloses name/résumé/
--     certifications, but communication stays inside the job-scoped,
--     admin-monitored Project Messages room. Admins keep full visibility.
--
--  ── DESIGN ──────────────────────────────────────────────────────────────────
--  Signed agreements are immutable audit records: client_sign_job_contract /
--  inspector_sign_job_contract hash contract_text_md into the e-signature
--  evidence, so the STORED body is never rewritten. Instead each role reads a
--  ROLE-SAFE PROJECTION computed at query time:
--
--      client     → nx_contract_text_for_client(md)     no payout / spread /
--                                                        margin / internal pay
--      inspector  → nx_contract_text_for_inspector(md)  no client price /
--                                                        spread / margin
--      admin      → the raw master body (CASE nx_is_admin() passthrough)
--
--  The sanitizer is conservative: a line containing forbidden content is
--  split into clauses (spaced dashes / semicolons); forbidden clauses are
--  removed; on such a line any remaining dollar amount survives only with
--  the viewer's own-amount context; a line losing every clause becomes a
--  visible redaction marker; and if the assembled text STILL matches a
--  forbidden pattern the entire body falls back to a fully-redacted notice.
--  Over-redaction is acceptable; leakage is not. The structured columns
--  (client_price_cents / inspector_payout_cents), already role-projected,
--  remain the authoritative commercial figures.
--
--  Column lists, order and types of all four views are unchanged, so
--  CREATE OR REPLACE preserves existing grants and dependents. inspector_email
--  and inspector_phone stay in place as columns but now resolve NULL for
--  everyone except admins (mobile builds in the field select them; a dropped
--  column would break shipped clients, a NULL never can).
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Clause / line predicate ─────────────────────────────────────────────
--  True when p_text contains content the given viewer must not see. Used at
--  line granularity first, then clause granularity for surgical excision.

CREATE OR REPLACE FUNCTION public.nx_contract_clause_forbidden(
  p_text text,
  p_viewer text
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $fn$
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN false;
  END IF;

  -- Forbidden for BOTH non-admin parties: the platform's own economics.
  IF p_text ~* 'internal\s+compensation'
     OR p_text ~* '(platform|nexpec|broker)[^\n]{0,40}(margin|spread|commission)'
     OR p_text ~* '(margin|spread|commission)[^\n]{0,40}(platform|nexpec|broker)'
  THEN
    RETURN true;
  END IF;

  IF p_viewer = 'client' THEN
    RETURN p_text ~* 'shall\s+pay\s+the\s+inspector'
        OR p_text ~* 'inspector[^\n]{0,80}(payout|compensation|remit)'
        OR p_text ~* '(payout|compensation|remit)[^\n]{0,80}inspector'
        OR p_text ~* 'inspector[^\n]{0,80}\$\s*[0-9]'
        OR p_text ~* '\$\s*[0-9][^\n]{0,80}inspector'
        OR p_text ~* '\mpayout\M[^\n]{0,40}\$\s*[0-9]'
        OR p_text ~* '\$\s*[0-9][^\n]{0,40}\mpayout\M';
  ELSIF p_viewer = 'inspector' THEN
    RETURN p_text ~* 'client[^\n]{0,60}price'
        OR p_text ~* 'price[^\n]{0,60}client'
        OR p_text ~* 'total\s+contract\s+price'
        OR p_text ~* 'client[^\n]{0,60}\$\s*[0-9]'
        OR p_text ~* '\$\s*[0-9][^\n]{0,60}client';
  END IF;

  RAISE EXCEPTION 'nx_contract_clause_forbidden: unknown viewer %', p_viewer;
END;
$fn$;

-- ─── 2. Role-safe body projection ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.nx_contract_text_sanitize(
  p_md text,
  p_viewer text
) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
AS $fn$
DECLARE
  c_marker   constant text :=
    '_[Redacted — this portion of the commercial terms is visible only to authorized parties.]_';
  c_fallback constant text :=
    '_[The commercial terms of this agreement are shown in your pricing summary. The complete master document is retained in NEXPEC records and is available to authorized administrators.]_';
  v_line    text;
  v_clause  text;
  v_clauses text[];
  v_kept    text[];
  v_lines   text[] := '{}';
  v_out     text;
  v_own_ctx text;
BEGIN
  IF p_md IS NULL OR btrim(p_md) = '' THEN
    RETURN p_md;
  END IF;
  IF p_viewer NOT IN ('client', 'inspector') THEN
    RAISE EXCEPTION 'nx_contract_text_sanitize: unknown viewer %', p_viewer;
  END IF;

  -- On a line that needed excision, a surviving dollar amount is kept only
  -- when the clause names the viewer's OWN commercial context. An unlabeled
  -- amount on a redacted line could be the other party's figure — drop it.
  v_own_ctx := CASE p_viewer
    WHEN 'client' THEN
      'client\s+price|total[^\n]{0,20}price|you\s+pay|deposit|funding|tranche|mobilization'
    ELSE
      'payout|inspector'
  END;

  FOREACH v_line IN ARRAY string_to_array(p_md, E'\n') LOOP
    IF NOT public.nx_contract_clause_forbidden(v_line, p_viewer) THEN
      v_lines := v_lines || v_line;
      CONTINUE;
    END IF;

    v_clauses := regexp_split_to_array(v_line, '\s+[-–—]\s+|;\s+');
    v_kept := '{}';
    FOREACH v_clause IN ARRAY v_clauses LOOP
      IF public.nx_contract_clause_forbidden(v_clause, p_viewer) THEN
        CONTINUE;
      END IF;
      IF v_clause ~ '\$\s*[0-9]' AND v_clause !~* v_own_ctx THEN
        CONTINUE;
      END IF;
      v_kept := v_kept || v_clause;
    END LOOP;

    IF array_length(v_kept, 1) IS NULL
       OR btrim(array_to_string(v_kept, '')) = '' THEN
      v_lines := v_lines || c_marker;
    ELSE
      v_lines := v_lines || array_to_string(v_kept, ' - ');
    END IF;
  END LOOP;

  v_out := array_to_string(v_lines, E'\n');

  -- Hard gate: if anything forbidden survived assembly, redact the whole
  -- body. Leaking nothing beats rendering something.
  IF p_viewer = 'client' AND (
       v_out ~* 'shall\s+pay\s+the\s+inspector'
    OR v_out ~* 'internal\s+compensation'
    OR v_out ~* 'inspector[^\n]{0,80}payout'
    OR v_out ~* 'payout[^\n]{0,80}inspector'
    OR v_out ~* '(platform|nexpec|broker)[^\n]{0,40}(margin|spread|commission)'
  ) THEN
    RETURN c_fallback;
  END IF;
  IF p_viewer = 'inspector' AND (
       v_out ~* 'client[^\n]{0,60}price'
    OR v_out ~* 'total\s+contract\s+price'
    OR v_out ~* 'internal\s+compensation'
    OR v_out ~* '(platform|nexpec|broker)[^\n]{0,40}(margin|spread|commission)'
  ) THEN
    RETURN c_fallback;
  END IF;

  RETURN v_out;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.nx_contract_text_for_client(p_md text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT public.nx_contract_text_sanitize(p_md, 'client') $$;

CREATE OR REPLACE FUNCTION public.nx_contract_text_for_inspector(p_md text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT public.nx_contract_text_sanitize(p_md, 'inspector') $$;

-- ─── 3. client_job_contracts_view ───────────────────────────────────────────
--  Body sanitized for the client; raw for admin. Email/phone: admin only —
--  identity_mode no longer discloses private contact to anyone else.

CREATE OR REPLACE VIEW public.client_job_contracts_view
WITH (security_barrier = 'true') AS
SELECT
  jc.id,
  jc.job_id,
  jc.application_id,
  jc.client_id,
  jc.inspector_id,
  jc.client_price_cents,
  jc.status,
  CASE WHEN public.nx_is_admin() THEN jc.contract_text_md
       ELSE public.nx_contract_text_for_client(jc.contract_text_md)
  END AS contract_text_md,
  jc.custom_contract_url,
  jc.client_signed_at,
  jc.client_signed_name,
  jc.inspector_signed_at,
  jc.voided_at,
  jc.voided_reason,
  jc.created_at,
  jc.updated_at,
  jc.client_approval_type,
  jc.admin_authorized_at,
  public.nx_job_effective_identity_mode(jc.job_id) AS identity_mode,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.full_name       END AS inspector_display_name,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.headline        END AS inspector_headline,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.bio             END AS inspector_resume_summary,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.resume_url      END AS inspector_resume_url,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.certifications  END AS inspector_certifications,
  CASE WHEN public.nx_job_effective_identity_mode(jc.job_id) IN ('professional','full') THEN p.specialty_slugs END AS inspector_qualifications,
  -- OWNER RULE (2026-08-19): private contact never crosses the brokerage.
  -- Communication happens in the job-scoped, admin-monitored Project
  -- Messages room. No identity mode discloses these to a client.
  CASE WHEN public.nx_is_admin() THEN p.email END AS inspector_email,
  CASE WHEN public.nx_is_admin() THEN p.phone END AS inspector_phone,
  jc.effective_identity_mode AS executed_identity_mode
FROM public.job_contracts jc
JOIN public.jobs j ON j.id = jc.job_id
LEFT JOIN public.profiles p ON p.id = jc.inspector_id
WHERE jc.client_id = auth.uid() OR public.nx_is_admin();

-- ─── 4. inspector_job_contracts_view ────────────────────────────────────────

CREATE OR REPLACE VIEW public.inspector_job_contracts_view AS
SELECT
  jc.id,
  jc.job_id,
  jc.application_id,
  jc.client_id,
  jc.inspector_id,
  jc.inspector_payout_cents,
  jc.status,
  CASE WHEN public.nx_is_admin() THEN jc.contract_text_md
       ELSE public.nx_contract_text_for_inspector(jc.contract_text_md)
  END AS contract_text_md,
  jc.custom_contract_url,
  jc.client_signed_at,
  jc.inspector_signed_at,
  jc.inspector_signed_name,
  jc.voided_at,
  jc.voided_reason,
  jc.created_at,
  jc.updated_at
FROM public.job_contracts jc
WHERE jc.inspector_id = auth.uid() OR public.nx_is_admin();

-- ─── 5. unified_contracts_view — sanitize both job_contract legs ────────────
--  Spine (agreements) and supplier legs are the counterparty's own documents
--  and are unchanged.

CREATE OR REPLACE VIEW public.unified_contracts_view
WITH (security_barrier = 'true') AS
SELECT a.id::text AS contract_id,
    'spine'::text AS source,
    a.kind,
    a.counterparty_id,
    a.status,
    a.status = 'presented'::text AS signable,
    a.amount_cents,
    a.currency,
    a.body_md,
    a.content_sha256,
    a.deal_id,
    d.job_id,
    a.signed_at,
    a.executed_at,
    a.created_at,
    a.legacy_ref
   FROM public.agreements a
     JOIN public.deals d ON d.id = a.deal_id
  WHERE a.counterparty_id = auth.uid() OR public.nx_is_admin()
UNION ALL
 SELECT ('jc:'::text || jc.id) || ':client'::text AS contract_id,
    'job_contract'::text AS source,
    'client_supply'::text AS kind,
    jc.client_id AS counterparty_id,
    jc.status,
    jc.client_signed_at IS NULL AND (jc.status <> ALL (ARRAY['voided'::text, 'fully_executed'::text])) AS signable,
    jc.client_price_cents AS amount_cents,
    'USD'::text AS currency,
    CASE WHEN public.nx_is_admin() THEN jc.contract_text_md
         ELSE public.nx_contract_text_for_client(jc.contract_text_md)
    END AS body_md,
    NULL::text AS content_sha256,
    NULL::uuid AS deal_id,
    jc.job_id,
    jc.client_signed_at AS signed_at,
        CASE
            WHEN jc.status = 'fully_executed'::text THEN jc.updated_at
            ELSE NULL::timestamp with time zone
        END AS executed_at,
    jc.created_at,
    ('jc:'::text || jc.id) || ':client'::text AS legacy_ref
   FROM public.job_contracts jc
  WHERE jc.client_id IS NOT NULL AND (jc.client_id = auth.uid() OR public.nx_is_admin()) AND NOT (EXISTS ( SELECT 1
           FROM public.agreements a
          WHERE a.legacy_ref = (('jc:'::text || jc.id) || ':client'::text)))
UNION ALL
 SELECT ('jc:'::text || jc.id) || ':inspector'::text AS contract_id,
    'job_contract'::text AS source,
    'inspector_engagement'::text AS kind,
    jc.inspector_id AS counterparty_id,
    jc.status,
    jc.inspector_signed_at IS NULL AND (jc.status <> ALL (ARRAY['voided'::text, 'fully_executed'::text])) AS signable,
    jc.inspector_payout_cents AS amount_cents,
    'USD'::text AS currency,
    CASE WHEN public.nx_is_admin() THEN jc.contract_text_md
         ELSE public.nx_contract_text_for_inspector(jc.contract_text_md)
    END AS body_md,
    NULL::text AS content_sha256,
    NULL::uuid AS deal_id,
    jc.job_id,
    jc.inspector_signed_at AS signed_at,
        CASE
            WHEN jc.status = 'fully_executed'::text THEN jc.updated_at
            ELSE NULL::timestamp with time zone
        END AS executed_at,
    jc.created_at,
    ('jc:'::text || jc.id) || ':inspector'::text AS legacy_ref
   FROM public.job_contracts jc
  WHERE jc.inspector_id IS NOT NULL AND (jc.inspector_id = auth.uid() OR public.nx_is_admin()) AND NOT (EXISTS ( SELECT 1
           FROM public.agreements a
          WHERE a.legacy_ref = (('jc:'::text || jc.id) || ':inspector'::text)))
UNION ALL
 SELECT 'sc:'::text || sc.id AS contract_id,
    'supplier_contract'::text AS source,
    'supplier_supply'::text AS kind,
    sc.supplier_id AS counterparty_id,
    sc.status,
    sc.supplier_signed_at IS NULL AND (sc.status <> ALL (ARRAY['voided'::text, 'executed'::text])) AS signable,
    sc.amount_cents,
    'USD'::text AS currency,
    sc.contract_text_md AS body_md,
    sc.content_sha256,
    NULL::uuid AS deal_id,
    sc.job_id,
    sc.supplier_signed_at AS signed_at,
    sc.executed_at,
    sc.created_at,
    'sc:'::text || sc.id AS legacy_ref
   FROM public.supplier_contracts sc
  WHERE sc.supplier_id IS NOT NULL AND (sc.supplier_id = auth.uid() OR public.nx_is_admin()) AND NOT (EXISTS ( SELECT 1
           FROM public.agreements a
          WHERE a.legacy_ref = ('sc:'::text || sc.id)));

-- ─── 6. job_applicant_identity_view — contact never disclosed to clients ────
--  Identity disclosure (name / résumé / certifications) under professional |
--  full is UNCHANGED, as is the 516000 forwarding gate. Only email/phone are
--  now admin-only.

CREATE OR REPLACE VIEW public.job_applicant_identity_view
WITH (security_barrier = true) AS
SELECT a.id AS application_id,
    a.job_id,
    a.applicant_id,
    a.status AS application_status,
    a.created_at,
    m.eff_mode AS identity_mode,
    p.rating_average,
    p.reviews_count,
    p.completed_jobs_count,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.full_name
            ELSE NULL::text
        END AS inspector_display_name,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.headline
            ELSE NULL::text
        END AS inspector_headline,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.bio
            ELSE NULL::text
        END AS inspector_resume_summary,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.resume_url
            ELSE NULL::text
        END AS inspector_resume_url,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.certifications
            ELSE NULL::text[]
        END AS inspector_certifications,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.specialty_slugs
            ELSE NULL::text[]
        END AS inspector_qualifications,
        -- OWNER RULE (2026-08-19): no identity mode discloses private
        -- contact details to a client. Admin keeps them for vetting.
        CASE
            WHEN public.nx_is_admin() THEN p.email
            ELSE NULL::text
        END AS inspector_email,
        CASE
            WHEN public.nx_is_admin() THEN p.phone
            ELSE NULL::text
        END AS inspector_phone,
    p.rating,
    p.total_jobs,
    p.professional_title,
    p.title,
    p.experience_years,
    p.specialty_slugs,
    p.ndt_methods,
    p.location_city,
    p.location_province,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.avatar_url
            ELSE NULL::text
        END AS inspector_avatar_url,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.first_name
            ELSE NULL::text
        END AS inspector_first_name,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.last_name
            ELSE NULL::text
        END AS inspector_last_name,
        CASE
            WHEN m.eff_mode = ANY (ARRAY['professional'::text, 'full'::text]) THEN p.cv_url
            ELSE NULL::text
        END AS inspector_cv_url
   FROM public.applications a
     JOIN public.jobs j ON j.id = a.job_id
     LEFT JOIN public.profiles p ON p.id = a.applicant_id
     CROSS JOIN LATERAL ( SELECT public.nx_job_effective_identity_mode(a.job_id) AS eff_mode) m
  WHERE public.nx_is_admin()
     OR ( (j.client_id = auth.uid() OR j.agency_id = auth.uid())
          AND a.forwarded_to_client_at IS NOT NULL );

-- ─── 7. Selftest ────────────────────────────────────────────────────────────
DO $selftest$
DECLARE
  c_strict constant text :=
    E'## NEXPEC Owner-Review Agreement\nClient price $1,000.00 - Inspector payout $800.00 - 20/80 staged funding.';
  v_c uuid := gen_random_uuid(); v_i uuid := gen_random_uuid();
  v_j uuid := gen_random_uuid(); v_a uuid := gen_random_uuid();
  v_jc uuid;
  v_txt text; v_email text; v_phone text; v_def text;
BEGIN
  -- 1. UNIT — the sanitizer itself, asserted everywhere on every apply.
  v_txt := public.nx_contract_text_for_client(c_strict);
  IF v_txt <> E'## NEXPEC Owner-Review Agreement\nClient price $1,000.00 - 20/80 staged funding.' THEN
    RAISE EXCEPTION 'SELFTEST: client projection wrong: %', v_txt;
  END IF;
  v_txt := public.nx_contract_text_for_inspector(c_strict);
  IF v_txt <> E'## NEXPEC Owner-Review Agreement\nInspector payout $800.00 - 20/80 staged funding.' THEN
    RAISE EXCEPTION 'SELFTEST: inspector projection wrong: %', v_txt;
  END IF;
  -- The standard generated template's §2 must survive untouched for both
  -- parties (it names no amounts).
  v_txt := 'The Client''s fees are held for payout by NEXPEC and are released only after both';
  IF public.nx_contract_text_for_client(v_txt) <> v_txt
     OR public.nx_contract_text_for_inspector(v_txt) <> v_txt THEN
    RAISE EXCEPTION 'SELFTEST: amount-free legal text was over-redacted';
  END IF;
  -- A body that is nothing but forbidden content redacts fully, never leaks.
  v_txt := public.nx_contract_text_for_client('NEXPEC platform margin: $200.00 (internal compensation)');
  IF v_txt ~* 'margin|compensation|\$' THEN
    RAISE EXCEPTION 'SELFTEST: forbidden-only body leaked: %', v_txt;
  END IF;
  -- NULL stays NULL.
  IF public.nx_contract_text_for_client(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST: NULL body mutated';
  END IF;

  -- 2. CATALOGUE — the views must actually route through the sanitizer, and
  --    identity modes must no longer resolve p.email/p.phone to non-admins.
  SELECT pg_get_viewdef('public.client_job_contracts_view'::regclass, true) INTO v_def;
  IF v_def !~ 'nx_contract_text_for_client' THEN
    RAISE EXCEPTION 'SELFTEST: client view does not sanitize contract_text_md';
  END IF;
  IF v_def ~ '''full''::text THEN p.email' THEN
    RAISE EXCEPTION 'SELFTEST: client view still discloses email under full';
  END IF;
  SELECT pg_get_viewdef('public.inspector_job_contracts_view'::regclass, true) INTO v_def;
  IF v_def !~ 'nx_contract_text_for_inspector' THEN
    RAISE EXCEPTION 'SELFTEST: inspector view does not sanitize contract_text_md';
  END IF;
  SELECT pg_get_viewdef('public.unified_contracts_view'::regclass, true) INTO v_def;
  IF v_def !~ 'nx_contract_text_for_client' OR v_def !~ 'nx_contract_text_for_inspector' THEN
    RAISE EXCEPTION 'SELFTEST: unified view legs do not sanitize body_md';
  END IF;
  SELECT pg_get_viewdef('public.job_applicant_identity_view'::regclass, true) INTO v_def;
  IF v_def ~ '''full''::text THEN p.email' THEN
    RAISE EXCEPTION 'SELFTEST: applicant view still discloses email under full';
  END IF;
  IF v_def !~ 'forwarded_to_client_at IS NOT NULL' OR v_def !~ 'nx_is_admin\(\)' THEN
    RAISE EXCEPTION 'SELFTEST: 516000 forwarding/admin gates were lost';
  END IF;

  -- 3. BEHAVIOURAL — where the migration role can SET ROLE authenticated
  --    (local). On Staging this half is skipped; the persistent suite
  --    contract_commercial_privacy_test.sql carries the full role parity.
  BEGIN
    INSERT INTO auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    SELECT u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
           'st.'||u::text||'@synthetic.invalid', now(), now()
      FROM unnest(ARRAY[v_c,v_i]) u;
    INSERT INTO public.profiles (id, role, full_name, email, phone, is_verified) VALUES
      (v_c,'client','ST Client','st.c@synthetic.invalid','+15550001',true),
      (v_i,'inspector','ST Real Name','st.i@synthetic.invalid','+15550002',true);
    INSERT INTO public.jobs (id,title,client_id,status,moderation_status,payment_mode,
                             client_price_cents,inspector_payout_cents,identity_mode)
    VALUES (v_j,'selftest privacy',v_c,'open','approved','prepay',100000,80000,'full');
    INSERT INTO public.applications (id,job_id,applicant_id,status,bid_amount_cents,forwarded_to_client_at)
    VALUES (v_a,v_j,v_i,'accepted',80000,now());
    INSERT INTO public.job_contracts (job_id, application_id, client_id, inspector_id,
                                      client_price_cents, inspector_payout_cents,
                                      status, contract_text_md)
    VALUES (v_j, v_a, v_c, v_i, 100000, 80000, 'pending_client_signature', c_strict)
    RETURNING id INTO v_jc;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      '{"sub":"'||v_c::text||'","role":"authenticated"}', true);
    SELECT contract_text_md, inspector_email, inspector_phone
      INTO v_txt, v_email, v_phone
      FROM public.client_job_contracts_view WHERE id = v_jc;
    RESET ROLE;
    IF v_txt IS NULL OR v_txt ~* 'inspector payout|\$800|margin|spread'
       OR v_txt !~ '\$1,000\.00' OR v_txt !~ '20/80' THEN
      RAISE EXCEPTION 'SELFTEST: client leg leaked or over-redacted: %', v_txt;
    END IF;
    IF v_email IS NOT NULL OR v_phone IS NOT NULL THEN
      RAISE EXCEPTION 'SELFTEST: client received inspector contact under FULL (email=%, phone=%)',
        coalesce(v_email,'<null>'), coalesce(v_phone,'<null>');
    END IF;

    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims',
      '{"sub":"'||v_i::text||'","role":"authenticated"}', true);
    SELECT contract_text_md INTO v_txt
      FROM public.inspector_job_contracts_view WHERE id = v_jc;
    RESET ROLE;
    IF v_txt IS NULL OR v_txt ~* 'client price|\$1,000|margin|spread'
       OR v_txt !~ '\$800\.00' THEN
      RAISE EXCEPTION 'SELFTEST: inspector leg leaked or over-redacted: %', v_txt;
    END IF;

    RAISE NOTICE 'SELFTEST ok — role-safe projections hold under policy FULL';
    RAISE EXCEPTION 'SELFTEST_ROLLBACK_SENTINEL';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'SELFTEST: behavioural half skipped (migration role cannot SET ROLE authenticated); unit + catalogue assertions passed';
    WHEN OTHERS THEN
      IF SQLERRM <> 'SELFTEST_ROLLBACK_SENTINEL' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE email LIKE '%@synthetic.invalid') THEN
    RAISE EXCEPTION 'SELFTEST: synthetic profiles survived';
  END IF;
END
$selftest$;

COMMIT;

NOTIFY pgrst, 'reload schema';
