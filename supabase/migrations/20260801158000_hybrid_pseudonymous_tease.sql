-- ════════════════════════════════════════════════════════════════════════════
--  20260801158000_hybrid_pseudonymous_tease.sql
--
--  Hybrid Pseudonymous Model — server payload for the buyer's pre-unlock
--  evaluation card. Extends client_assigned_inspector_view with:
--
--    • inspector_name_masked  ALWAYS-ON server-computed tease (e.g. 'D▦▦▦▦ ▦.').
--      The REAL name is NEVER emitted pre-reveal — only this mask leaves the DB,
--      so it cannot be recovered by inspecting the network payload. (The real
--      name stays behind the existing identity-escrow gate via
--      inspector_legal_name.)
--    • inspector_cv_url       GATED — the real uploaded CV, only after reveal.
--    • inspector_avatar_url   GATED — the real photo, only after reveal (the
--      free tier shows an abstract avatar rendered client-side from the handle).
--    • inspector_verified / inspector_rating / inspector_jobs / inspector_has_cv
--      ALWAYS-ON, NON-PII trust signals that power the "verified accountable
--      human" trust strip without revealing identity.
--
--  Reveal gate is IDENTICAL to the existing inspector_legal_name gate
--  (nx_is_admin OR final-report admin-confirmed OR paid Named-Disclosure lifted
--  identity_revealed_at). Anti-poaching preserved: nothing identifying crosses
--  the wire until the sealed amendment is signed AND the fee is collected.
--
--  Append-only CREATE OR REPLACE (new columns added at the END; existing columns
--  unchanged) so dependents + grants survive. Idempotent. ADDITIVE.
-- ════════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── 1. Fixed-width name mask (first initial + blocks; NEVER length-revealing) ──
--   'David Chen' → 'D▦▦▦▦ ▦.'   |   ''/NULL → '▦▦▦▦ ▦.'
--   Fixed width on purpose: the real name's length is itself a weak re-id signal.
CREATE OR REPLACE FUNCTION public.nx_mask_name(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN p_name IS NULL OR btrim(p_name) = '' THEN '▦▦▦▦ ▦.'
    ELSE upper(substr(btrim(p_name), 1, 1)) || '▦▦▦▦ ▦.'
  END;
$fn$;
REVOKE ALL ON FUNCTION public.nx_mask_name(text) FROM public;
GRANT EXECUTE ON FUNCTION public.nx_mask_name(text) TO authenticated, service_role;

-- ── 2. Extend the buyer's assigned-inspector view (append-only) ───────────────
CREATE OR REPLACE VIEW public.client_assigned_inspector_view WITH (security_barrier = true) AS
  SELECT
    m.deal_id,
    'NX-' || upper(substr(encode(extensions.digest(m.inspector_id::text, 'sha256'), 'hex'), 1, 8)) AS handle,
    m.dossier, m.certificate, m.independence, m.artifacts_seal_id,
    m.client_review, m.review_deadline,
    m.identity_revealed_at,
    a.status AS engagement_status,
    d.transparency_tier,
    j.admin_confirmed_at AS report_confirmed_at,
    CASE WHEN public.nx_is_admin() OR j.admin_confirmed_at IS NOT NULL OR m.identity_revealed_at IS NOT NULL THEN p.full_name ELSE NULL END AS inspector_legal_name,
    CASE WHEN public.nx_is_admin() OR j.admin_confirmed_at IS NOT NULL OR m.identity_revealed_at IS NOT NULL THEN sig.signed_name ELSE NULL END AS inspector_signature,
    -- ── NEW: hybrid pseudonymous tease (always-on; only the MASK leaves the DB) ──
    public.nx_mask_name(p.full_name) AS inspector_name_masked,
    -- ── NEW: paid-reveal payload (gated identically to the legal name) ──
    CASE WHEN public.nx_is_admin() OR j.admin_confirmed_at IS NOT NULL OR m.identity_revealed_at IS NOT NULL THEN COALESCE(p.cv_url, p.resume_url) ELSE NULL END AS inspector_cv_url,
    CASE WHEN public.nx_is_admin() OR j.admin_confirmed_at IS NOT NULL OR m.identity_revealed_at IS NOT NULL THEN p.avatar_url ELSE NULL END AS inspector_avatar_url,
    -- ── NEW: non-PII trust signals (always-on) ──
    (p.verification_status = 'verified' OR p.is_verified IS TRUE) AS inspector_verified,
    COALESCE(NULLIF(p.rating_average, 0), NULLIF(p.avg_rating, 0), NULLIF(p.rating, 0), 0) AS inspector_rating,
    COALESCE(p.completed_jobs_count, 0) AS inspector_jobs,
    (COALESCE(p.cv_url, p.resume_url) IS NOT NULL) AS inspector_has_cv
  FROM public.inspector_engagement_meta m
  JOIN public.agreements a ON a.id = m.agreement_id
  JOIN public.deals d ON d.id = m.deal_id
  JOIN public.profiles p ON p.id = m.inspector_id
  LEFT JOIN public.jobs j ON j.id = d.job_id
  LEFT JOIN LATERAL (
    SELECT s.signed_name FROM public.agreement_signatures s
    WHERE s.agreement_id = m.agreement_id AND s.party_role = 'inspector'
    ORDER BY s.signed_at DESC LIMIT 1
  ) sig ON true
  WHERE d.client_id = auth.uid() OR public.nx_is_admin();
GRANT SELECT ON public.client_assigned_inspector_view TO authenticated;

-- ── 3. Self-tests — the mask must tease without leaking ───────────────────────
DO $$
BEGIN
  IF public.nx_mask_name('David Chen') <> 'D▦▦▦▦ ▦.' THEN
    RAISE EXCEPTION 'SELFTEST: nx_mask_name format wrong: %', public.nx_mask_name('David Chen');
  END IF;
  -- must never leak the real name beyond the first initial
  IF public.nx_mask_name('David Chen') ILIKE '%avid%' OR public.nx_mask_name('David Chen') ILIKE '%chen%' THEN
    RAISE EXCEPTION 'SELFTEST: nx_mask_name leaks the real name';
  END IF;
  -- fixed width: a long and a short name mask to the same length (no length leak)
  IF length(public.nx_mask_name('Bo')) <> length(public.nx_mask_name('Maximilian Schwarzenberger')) THEN
    RAISE EXCEPTION 'SELFTEST: mask width leaks name length';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='client_assigned_inspector_view'
                   AND column_name='inspector_name_masked') THEN
    RAISE EXCEPTION 'SELFTEST: view missing inspector_name_masked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='client_assigned_inspector_view'
                   AND column_name='inspector_has_cv') THEN
    RAISE EXCEPTION 'SELFTEST: view missing inspector_has_cv';
  END IF;
  RAISE NOTICE 'Hybrid pseudonymous tease OK: masked name always-on, real name/cv/avatar gated.';
END $$;

COMMIT;
