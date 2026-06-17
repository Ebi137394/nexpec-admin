-- ════════════════════════════════════════════════════════════════════════════
--  20260609120000_provable_inspection_seals.sql
--
--  PROVABLE INSPECTION ENGINE — Sprint 1 (Cryptographic Integrity Overlay)
--  ──────────────────────────────────────────────────────────────────────
--  Pure additive migration. Touches no existing tables, no existing
--  functions, no existing triggers. Introduces ONE sidecar table and
--  FOUR new functions, all prefixed with `pi_` (Provable Inspection)
--  for unambiguous identification.
--
--  WHAT THIS SOLVES
--  ────────────────
--  `inspection_captures` already implements a per-photo SHA-256 chain
--  via `capture_sha256` + `prev_capture_sha256`. That gives you image-
--  level chain-of-custody. What was missing: a single roll-up root
--  that binds every capture + every inspection_item + the report's
--  own metadata into ONE attestable hash, signed by the inspector,
--  optionally co-signed by the client, and anchored in audit_events.
--
--  THIS MIGRATION INTRODUCES
--  ─────────────────────────
--    Table:
--      • pi_report_seals
--
--    Functions:
--      • pi_canonical_json(jsonb)          → text     (helper)
--      • pi_seal_inspection_report(uuid)   → seal row (primary)
--      • pi_countersign_inspection_report(uuid) → seal row (client signs)
--      • pi_fetch_report_seal(uuid)        → seal row (read with auth)
--
--  WHAT THIS DOES NOT TOUCH
--  ────────────────────────
--    • inspection_reports / inspection_items / inspection_captures
--    • findings (different domain — project_id, not job_id)
--    • report_templates / inspection_evidence_requirements
--    • jobs / jobs.status / job lifecycle RPCs
--    • assemble_evidence_pack — wiring the seal into the CEL manifest
--      is intentionally deferred to a future sprint
--    • notify-* triggers — sealing emits its own event_type that is
--      NOT picked up by the existing evidence-pack notification path.
--      Adding notifications for sealing is also a future sprint.
--
--  DOCTRINE
--  ────────
--    • SECURITY DEFINER + `SET search_path = public, pg_temp` on every
--      function (matches notify_safe / cron_upsert_fx_rate / etc.).
--    • All mutations are RPC-only. Direct INSERT/UPDATE/DELETE blocked
--      via REVOKE + RLS read-only policies.
--    • Sealing is idempotent — re-calling on an already-sealed report
--      returns the existing seal rather than raising.
--    • Sealing NEVER changes jobs.status or any business-state column.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────
-- 1) pi_report_seals — the sidecar table.
--
--    One row per sealed inspection report (UNIQUE on report_id).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pi_report_seals (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  timestamptz NOT NULL    DEFAULT now(),
  updated_at                  timestamptz NOT NULL    DEFAULT now(),

  -- The sealed report. One seal per report — re-sealing is idempotent.
  report_id                   uuid        NOT NULL    UNIQUE
                                          REFERENCES public.inspection_reports(id) ON DELETE CASCADE,

  -- Denormalised for fast filtering. Foreign keys enforce coherence.
  job_id                      uuid        NOT NULL    REFERENCES public.jobs(id)     ON DELETE CASCADE,
  inspector_id                uuid        NOT NULL    REFERENCES public.profiles(id) ON DELETE RESTRICT,

  -- Hash algorithm tag. Lets us evolve the canonical-JSON spec without
  -- breaking re-derivation of older seals.
  algorithm                   text        NOT NULL    DEFAULT 'sha256/canonical-json/v1',

  -- The four hashes that define the integrity bundle:
  root_sha256                 text        NOT NULL,   -- the anchor
  captures_root_sha256        text        NOT NULL,   -- root over ordered capture_sha256 chain
  items_root_sha256           text        NOT NULL,   -- root over canonical items
  report_meta_sha256          text        NOT NULL,   -- hash of canonical report metadata

  captures_count              integer     NOT NULL    CHECK (captures_count >= 0),
  items_count                 integer     NOT NULL    CHECK (items_count >= 0),

  -- Chain-integrity verdict. The chain is computed across the existing
  -- inspection_captures.prev_capture_sha256 → previous.capture_sha256
  -- linkage. If any link is broken we still seal (truth-telling beats
  -- silent failure) but flag the break.
  chain_verified              boolean     NOT NULL,
  chain_break_at_capture_id   uuid                    REFERENCES public.inspection_captures(id) ON DELETE SET NULL,

  -- Inspector signature.
  inspector_sealed_at         timestamptz NOT NULL    DEFAULT now(),
  inspector_signature_sha256  text        NOT NULL,

  -- Client countersignature (NULL until pi_countersign_inspection_report fires).
  client_signed_at            timestamptz,
  client_signed_by            uuid                    REFERENCES public.profiles(id) ON DELETE SET NULL,
  client_signature_sha256     text,

  -- Audit-trail link. Set inside the RPC at seal time.
  audit_event_id              uuid                    REFERENCES public.audit_events(id) ON DELETE SET NULL,

  -- Coherence checks:
  CONSTRAINT pi_report_seals_client_sig_pair
    CHECK (
      (client_signed_at IS NULL AND client_signed_by IS NULL AND client_signature_sha256 IS NULL)
      OR
      (client_signed_at IS NOT NULL AND client_signed_by IS NOT NULL AND client_signature_sha256 IS NOT NULL)
    ),
  CONSTRAINT pi_report_seals_break_pair
    CHECK (
      (chain_verified IS TRUE AND chain_break_at_capture_id IS NULL)
      OR
      (chain_verified IS FALSE)
    )
);

COMMENT ON TABLE public.pi_report_seals IS
  'Cryptographic seal over an inspection_reports row + its captures + its items. One row per report. Sealing is idempotent; re-calling pi_seal_inspection_report returns the existing seal.';

COMMENT ON COLUMN public.pi_report_seals.root_sha256 IS
  'The anchor hash. Computed as SHA-256 over (captures_root || items_root || report_meta) sorted lexicographically. Any modification to the report, its items, or its captures will invalidate this on re-derivation.';

COMMENT ON COLUMN public.pi_report_seals.algorithm IS
  'Hash spec version tag. Bump when the canonical-JSON algorithm changes so older seals remain re-derivable under their original spec.';

-- Indexes
CREATE INDEX IF NOT EXISTS pi_report_seals_job_idx
  ON public.pi_report_seals (job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pi_report_seals_inspector_idx
  ON public.pi_report_seals (inspector_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pi_report_seals_client_idx
  ON public.pi_report_seals (client_signed_by, client_signed_at DESC)
  WHERE client_signed_at IS NOT NULL;

-- Realtime: optionally publish so the mobile screen reflects state without a refetch.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'pi_report_seals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pi_report_seals;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pi_report_seals realtime publication add: %', SQLERRM;
END $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) RLS — read-only policies. All writes are RPC-only.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.pi_report_seals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pi_report_seals_select_admin     ON public.pi_report_seals;
DROP POLICY IF EXISTS pi_report_seals_select_inspector ON public.pi_report_seals;
DROP POLICY IF EXISTS pi_report_seals_select_client    ON public.pi_report_seals;

-- Platform Owner sees everything.
CREATE POLICY pi_report_seals_select_admin
  ON public.pi_report_seals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid() AND role = 'super_admin'
    )
  );

-- Inspectors see their own seals.
CREATE POLICY pi_report_seals_select_inspector
  ON public.pi_report_seals FOR SELECT
  USING (inspector_id = auth.uid());

-- Clients see seals for jobs they own.
CREATE POLICY pi_report_seals_select_client
  ON public.pi_report_seals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs j
       WHERE j.id = pi_report_seals.job_id
         AND j.client_id = auth.uid()
    )
  );

-- Block direct writes — RPCs only.
REVOKE INSERT, UPDATE, DELETE ON public.pi_report_seals FROM PUBLIC, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 3) pi_canonical_json — deterministic JSON canonicaliser.
--
--    Recursive serialiser that produces a stable byte string for any
--    jsonb input: object keys sorted lexicographically, array order
--    preserved, scalars emitted via jsonb's own JSON encoding (which
--    is already RFC-compliant).
--
--    Stable string → stable SHA-256. Same algorithm as the web's
--    canonicalJson.ts so a future /verify-side re-derivation will match.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_canonical_json(p jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_type   text;
  v_parts  text[] := ARRAY[]::text[];
  v_key    text;
  v_arr_len int;
  v_i      int;
BEGIN
  IF p IS NULL THEN
    RETURN 'null';
  END IF;

  v_type := jsonb_typeof(p);

  IF v_type = 'object' THEN
    FOR v_key IN SELECT k FROM jsonb_object_keys(p) k ORDER BY k LOOP
      v_parts := array_append(
        v_parts,
        to_jsonb(v_key)::text || ':' || public.pi_canonical_json(p -> v_key)
      );
    END LOOP;
    RETURN '{' || array_to_string(v_parts, ',') || '}';
  END IF;

  IF v_type = 'array' THEN
    v_arr_len := jsonb_array_length(p);
    FOR v_i IN 0..(v_arr_len - 1) LOOP
      v_parts := array_append(v_parts, public.pi_canonical_json(p -> v_i));
    END LOOP;
    RETURN '[' || array_to_string(v_parts, ',') || ']';
  END IF;

  -- Scalars: string / number / boolean / null. jsonb::text emits
  -- the JSON-encoded form for each.
  RETURN p::text;
END
$fn$;

COMMENT ON FUNCTION public.pi_canonical_json(jsonb) IS
  'Deterministic JSON canonicalisation. Object keys sorted lexicographically; array order preserved; scalars via jsonb''s native encoding. Used to compute pi_report_seals hashes. Mirrors the web canonicalJson.ts algorithm.';

GRANT EXECUTE ON FUNCTION public.pi_canonical_json(jsonb) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4) pi_seal_inspection_report — the primary sealing RPC.
--
--    Idempotent: if a seal already exists for the report, returns it
--    unchanged. Otherwise:
--      1. Auth: caller must be the report's inspector (or super_admin).
--      2. Loads inspection_captures (ordered) and verifies the chain.
--      3. Loads inspection_items.
--      4. Composes captures_root, items_root, report_meta hashes.
--      5. Composes root_sha256 over those three.
--      6. Computes inspector signature.
--      7. Emits an audit event + writes the seal in two writes.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_seal_inspection_report(p_report_id uuid)
RETURNS public.pi_report_seals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller             uuid := auth.uid();
  v_is_admin           boolean;
  v_report             public.inspection_reports%ROWTYPE;
  v_existing           public.pi_report_seals%ROWTYPE;

  v_seal_id            uuid := gen_random_uuid();
  v_sealed_at          timestamptz := now();

  v_captures_count     integer := 0;
  v_items_count        integer := 0;
  v_chain_verified     boolean := true;
  v_chain_break_at     uuid;

  v_prev_hash          text;
  v_captures_concat    text := '';
  v_items_concat       text := '';

  v_captures_root      text;
  v_items_root         text;
  v_report_meta_sha    text;
  v_root               text;
  v_inspector_sig      text;

  v_audit_id           uuid;
  v_actor_role         text;

  v_capture            RECORD;
  v_item               RECORD;
  v_item_jsonb         jsonb;
  v_report_jsonb       jsonb;

  v_result             public.pi_report_seals%ROWTYPE;
BEGIN
  -- ────────── Auth ──────────
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_caller AND role = 'super_admin'
  ) INTO v_is_admin;

  v_actor_role := CASE WHEN v_is_admin THEN 'super_admin' ELSE 'inspector' END;

  -- ────────── Load report ──────────
  SELECT * INTO v_report
    FROM public.inspection_reports
   WHERE id = p_report_id;

  IF v_report.id IS NULL THEN
    RAISE EXCEPTION 'inspection report % not found', p_report_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_report.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'inspection report % is deleted and cannot be sealed', p_report_id
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_admin AND v_report.inspector_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'only the report author or NEXPEC Admin may seal this report'
      USING ERRCODE = '42501';
  END IF;

  -- ────────── Idempotency ──────────
  SELECT * INTO v_existing
    FROM public.pi_report_seals
   WHERE report_id = p_report_id;

  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- ────────── Captures root + chain verification ──────────
  v_prev_hash := NULL;
  FOR v_capture IN
    SELECT id, capture_sha256, prev_capture_sha256, sort_index, captured_at
      FROM public.inspection_captures
     WHERE job_id = v_report.job_id
     ORDER BY sort_index ASC, captured_at ASC NULLS LAST, id ASC
  LOOP
    v_captures_count := v_captures_count + 1;

    -- Chain validation. Records the FIRST break and keeps going.
    IF v_captures_count = 1 THEN
      -- The first capture's prev should be NULL.
      IF v_capture.prev_capture_sha256 IS NOT NULL THEN
        v_chain_verified := false;
        v_chain_break_at := COALESCE(v_chain_break_at, v_capture.id);
      END IF;
    ELSE
      IF v_capture.prev_capture_sha256 IS DISTINCT FROM v_prev_hash THEN
        v_chain_verified := false;
        v_chain_break_at := COALESCE(v_chain_break_at, v_capture.id);
      END IF;
    END IF;

    -- Missing per-capture hash is itself a chain break.
    IF v_capture.capture_sha256 IS NULL THEN
      v_chain_verified := false;
      v_chain_break_at := COALESCE(v_chain_break_at, v_capture.id);
    END IF;

    v_captures_concat := v_captures_concat
                         || COALESCE(v_capture.capture_sha256, '')
                         || '|';
    v_prev_hash := v_capture.capture_sha256;
  END LOOP;

  v_captures_root := encode(digest(v_captures_concat, 'sha256'), 'hex');

  -- ────────── Items root ──────────
  FOR v_item IN
    SELECT id, description, status, photo_url, notes, location, created_at
      FROM public.inspection_items
     WHERE report_id = p_report_id
     ORDER BY created_at ASC NULLS LAST, id ASC
  LOOP
    v_items_count := v_items_count + 1;
    v_item_jsonb := jsonb_build_object(
      'id',          v_item.id,
      'description', v_item.description,
      'status',      v_item.status,
      'photo_url',   v_item.photo_url,
      'notes',       v_item.notes,
      'location',    v_item.location,
      'created_at',  v_item.created_at
    );
    v_items_concat := v_items_concat
                      || public.pi_canonical_json(v_item_jsonb)
                      || '|';
  END LOOP;

  v_items_root := encode(digest(v_items_concat, 'sha256'), 'hex');

  -- ────────── Report metadata hash ──────────
  v_report_jsonb := jsonb_build_object(
    'id',                 v_report.id,
    'job_id',             v_report.job_id,
    'inspector_id',       v_report.inspector_id,
    'status',             v_report.status,
    'notes',              v_report.notes,
    'pdf_url',            v_report.pdf_url,
    'final_report_doc',   v_report.final_report_doc,
    'is_published',       v_report.is_published,
    'is_client_approved', v_report.is_client_approved,
    'signed_docs_url',    v_report.signed_docs_url,
    'created_at',         v_report.created_at
  );
  v_report_meta_sha := encode(
    digest(public.pi_canonical_json(v_report_jsonb), 'sha256'),
    'hex'
  );

  -- ────────── Compose root_sha256 ──────────
  -- Three sub-roots concatenated in lexicographic order. Reproducible
  -- by any third-party verifier given the raw rows.
  WITH parts(s) AS (
    VALUES (v_captures_root), (v_items_root), (v_report_meta_sha)
  )
  SELECT encode(digest(string_agg(s, '|' ORDER BY s), 'sha256'), 'hex')
    INTO v_root
    FROM parts;

  -- ────────── Inspector signature ──────────
  v_inspector_sig := encode(
    digest(
      v_report.inspector_id::text || '|'
      || to_char(v_sealed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || v_root,
      'sha256'
    ),
    'hex'
  );

  -- ────────── Audit event first (single-write seal afterwards) ──────────
  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role, actor_label,
    subject_table, subject_id, job_id, summary, delta, metadata
  )
  VALUES (
    'compliance.inspection_report.sealed',
    'info',
    v_caller,
    v_actor_role,
    NULL,
    'inspection_reports',
    p_report_id,
    v_report.job_id,
    format(
      'Sealed inspection report %s (captures=%s, items=%s, chain=%s)',
      p_report_id,
      v_captures_count,
      v_items_count,
      CASE WHEN v_chain_verified THEN 'intact' ELSE 'broken' END
    ),
    jsonb_build_object(
      'seal_id',                   v_seal_id,
      'root_sha256',               v_root,
      'captures_root_sha256',      v_captures_root,
      'items_root_sha256',         v_items_root,
      'report_meta_sha256',        v_report_meta_sha,
      'inspector_signature_sha256', v_inspector_sig,
      'captures_count',            v_captures_count,
      'items_count',               v_items_count,
      'chain_verified',            v_chain_verified,
      'chain_break_at_capture_id', v_chain_break_at,
      'algorithm',                 'sha256/canonical-json/v1'
    ),
    jsonb_build_object(
      'seal_id',   v_seal_id::text,
      'root_hash', v_root
    )
  )
  RETURNING id INTO v_audit_id;

  -- ────────── Insert the seal ──────────
  INSERT INTO public.pi_report_seals (
    id,
    report_id, job_id, inspector_id,
    algorithm,
    root_sha256, captures_root_sha256, items_root_sha256, report_meta_sha256,
    captures_count, items_count,
    chain_verified, chain_break_at_capture_id,
    inspector_sealed_at, inspector_signature_sha256,
    audit_event_id
  )
  VALUES (
    v_seal_id,
    p_report_id, v_report.job_id, v_report.inspector_id,
    'sha256/canonical-json/v1',
    v_root, v_captures_root, v_items_root, v_report_meta_sha,
    v_captures_count, v_items_count,
    v_chain_verified, v_chain_break_at,
    v_sealed_at, v_inspector_sig,
    v_audit_id
  )
  RETURNING * INTO v_result;

  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION public.pi_seal_inspection_report(uuid) IS
  'Computes and stores a cryptographic seal for an inspection report. Idempotent. Caller must be the report''s inspector_id or super_admin.';

GRANT EXECUTE ON FUNCTION public.pi_seal_inspection_report(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 5) pi_countersign_inspection_report — client co-sign.
--
--    Adds a second cryptographic signature to a sealed report,
--    representing the client's agreement. Idempotent: if already
--    countersigned, returns the existing seal unchanged.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_countersign_inspection_report(p_report_id uuid)
RETURNS public.pi_report_seals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller        uuid := auth.uid();
  v_is_admin      boolean;
  v_seal          public.pi_report_seals%ROWTYPE;
  v_job_client_id uuid;
  v_signed_at     timestamptz := now();
  v_signature     text;
  v_audit_id      uuid;
  v_actor_role    text;
  v_result        public.pi_report_seals%ROWTYPE;
BEGIN
  -- ────────── Auth ──────────
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_caller AND role = 'super_admin'
  ) INTO v_is_admin;

  v_actor_role := CASE WHEN v_is_admin THEN 'super_admin' ELSE 'client' END;

  -- ────────── Load seal ──────────
  SELECT * INTO v_seal
    FROM public.pi_report_seals
   WHERE report_id = p_report_id;

  IF v_seal.id IS NULL THEN
    RAISE EXCEPTION 'report % has not been sealed yet — inspector must seal first', p_report_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency.
  IF v_seal.client_signed_at IS NOT NULL THEN
    RETURN v_seal;
  END IF;

  -- ────────── Authorization: client of the job, or admin ──────────
  SELECT client_id INTO v_job_client_id
    FROM public.jobs
   WHERE id = v_seal.job_id;

  IF NOT v_is_admin
     AND (v_job_client_id IS NULL OR v_job_client_id <> v_caller)
  THEN
    RAISE EXCEPTION 'only the client of this job or NEXPEC Admin may countersign'
      USING ERRCODE = '42501';
  END IF;

  -- ────────── Compute client signature ──────────
  v_signature := encode(
    digest(
      v_caller::text || '|'
      || to_char(v_signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      || '|' || v_seal.root_sha256,
      'sha256'
    ),
    'hex'
  );

  -- ────────── Audit event ──────────
  INSERT INTO public.audit_events (
    event_type, severity, actor_id, actor_role,
    subject_table, subject_id, job_id, summary, delta, metadata
  )
  VALUES (
    'compliance.inspection_report.countersigned',
    'info',
    v_caller,
    v_actor_role,
    'pi_report_seals',
    v_seal.id,
    v_seal.job_id,
    format('Client countersigned seal %s for report %s', v_seal.id, p_report_id),
    jsonb_build_object(
      'seal_id',                 v_seal.id,
      'root_sha256',             v_seal.root_sha256,
      'client_signature_sha256', v_signature,
      'client_signed_at',        v_signed_at
    ),
    jsonb_build_object(
      'seal_id',   v_seal.id::text,
      'root_hash', v_seal.root_sha256
    )
  )
  RETURNING id INTO v_audit_id;

  -- ────────── Apply countersignature ──────────
  UPDATE public.pi_report_seals
     SET client_signed_at        = v_signed_at,
         client_signed_by        = v_caller,
         client_signature_sha256 = v_signature,
         updated_at              = now()
   WHERE id = v_seal.id
  RETURNING * INTO v_result;

  RETURN v_result;
END
$fn$;

COMMENT ON FUNCTION public.pi_countersign_inspection_report(uuid) IS
  'Client co-sign on an already-sealed inspection report. Idempotent. Caller must be jobs.client_id or super_admin.';

GRANT EXECUTE ON FUNCTION public.pi_countersign_inspection_report(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 6) pi_fetch_report_seal — read-only fetch with explicit auth.
--
--    Returns the seal row if the caller is the inspector, the job's
--    client, or super_admin. Returns NULL-row (id IS NULL) if no seal
--    exists. Raises 42501 if the seal exists but caller is unauthorised.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pi_fetch_report_seal(p_report_id uuid)
RETURNS public.pi_report_seals
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_caller   uuid := auth.uid();
  v_is_admin boolean;
  v_result   public.pi_report_seals%ROWTYPE;
  v_can_see  boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_result
    FROM public.pi_report_seals
   WHERE report_id = p_report_id;

  IF v_result.id IS NULL THEN
    -- No seal — return all-NULL row. Caller checks id IS NULL.
    RETURN v_result;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id = v_caller AND role = 'super_admin'
  ) INTO v_is_admin;

  v_can_see :=
    v_is_admin
    OR v_result.inspector_id = v_caller
    OR EXISTS (
         SELECT 1 FROM public.jobs
          WHERE id = v_result.job_id AND client_id = v_caller
       );

  IF NOT v_can_see THEN
    RAISE EXCEPTION 'not authorised to view this seal' USING ERRCODE = '42501';
  END IF;

  RETURN v_result;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.pi_fetch_report_seal(uuid) TO authenticated;

COMMIT;
