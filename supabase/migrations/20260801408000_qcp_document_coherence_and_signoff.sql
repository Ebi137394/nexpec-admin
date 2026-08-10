-- ════════════════════════════════════════════════════════════════════════════
--  20260801408000_qcp_document_coherence_and_signoff.sql   (Agent 3, Phase 4)
--
--  Required-document COHERENCE + un-forgeable ACCEPTANCE on top of the document
--  architecture that already exists. NO Documents v2: no new document table, no
--  new storage bucket, no second versioning model, no second audit spine.
--
--  ── WHAT THE EXISTING ARCHITECTURE ACTUALLY PROVIDES (verified, file:line) ──
--  public.documents            baseline:22665
--      id, organization_id NOT NULL → organizations, asset_id NOT NULL → assets
--      (ON DELETE CASCADE, baseline:28328), event_id → inspection_events,
--      title, file_url, file_type, file_size_kb, uploaded_by TEXT, uploaded_at.
--      RLS ON + REVOKE INSERT/UPDATE/DELETE FROM authenticated, org-scoped read
--      only  (20260801224000:55-68). Server-written. Good.
--      ⚠ It has NO project_id, and public.assets (baseline:21736) has no
--        project_id either. `documents` is the ASSET-INTEGRITY store.
--      ⚠ uploaded_by is TEXT and un-FK'd — it is a label, not attribution, and
--        is therefore unusable as a sign-off identity. Hence the new columns
--        below reference profiles(id).
--  public.project_documents    baseline:24132
--      job_id (NULLABLE, and carries NO foreign key at all), uploader_id →
--      auth.users, file_name/url/size/type, document_url. Reached only through
--      nx_can_access_doc for signed-URL minting (20260801252000:78-83).
--      ⚠ No RLS, and GRANT ALL TO anon + authenticated (baseline:40652-40654).
--        Written straight from the mobile client (app/(tabs)/resources.tsx:463).
--        Pre-existing, product-wide, and NOT a QCP path — reported, not touched
--        here; widening this migration to fix it would risk the shipped upload
--        flow for no QCP benefit.
--  Versioning: there is none, on either table. Supersession is modelled by the
--      OWNING record, which is exactly what qcp_revisions does — so QCP needs
--      no document versioning of its own, only revision-scoped requirements.
--  Audit: public.audit_events (baseline:21760) — subject_table/subject_id,
--      nullable job_id, free-form event_type (only `severity` carries a CHECK).
--      This is the correct spine here. public.job_events is NOT: it demands a
--      job_id, and a QCP is project-scoped with no job (see the next block), so
--      job_events_event_type_check is never reached and needs no widening.
--
--  ── THE COHERENCE CEILING, STATED HONESTLY ─────────────────────────────────
--  NOTHING in the schema references public.projects(id) — not one foreign key,
--  in the baseline or in any later migration. public.jobs has neither
--  project_id nor organization_id (baseline:3641-3700). So there is no join
--  path project → job, and none project → document.
--
--  Consequence for this lane: given the frozen FK target
--  `qcp_required_documents.document_id → documents(id)`, the finest coherence
--  that is EXPRESSIBLE is the ORGANIZATION. That is implemented below and it
--  closes cross-TENANT document injection, which is the real defect class.
--  Cross-PROJECT injection inside one organization is structurally
--  unpreventable while `documents` carries no project scope — it is not an
--  omission here, there is nothing to compare. Reported to the Lead.
--
--  The FK proves EXISTENCE, not COHERENCE — the exact lesson of
--  20260801404000 (tg_guard_itp_result_visit) and 20260801388000
--  (tg_guard_capture_visit). Same shape, same reasoning, applied to documents.
--
--  ── WHAT THIS MIGRATION ADDS ───────────────────────────────────────────────
--  1. Five additive nullable columns on qcp_required_documents carrying
--     submission + acceptance. Deliberately columns on the row that already
--     models the requirement, NOT a second approvals table — "reuse, do not
--     rebuild". §2 of the contract froze the requirement's DEFINITION columns
--     and did not describe acceptance; §5 allocated this migration for
--     "documents / approvals". Nothing frozen is altered, renamed or dropped.
--  2. A structural coherence guard (org must match, on BOTH the document's own
--     denormalised organization_id AND its asset's — those two are not
--     enforced equal anywhere).
--  3. A structural revision-lifecycle guard: superseded revisions are frozen
--     history; approved revisions accept FULFILMENT but not redefinition;
--     a requirement can never be re-pointed at another revision.
--  4. Un-forgeable attribution: accepted_by is never an RPC parameter, is
--     always auth.uid(), can never be the QCP's supplier (the party being
--     signed off), and can never be the person who submitted the document.
--     Enforced by a TRIGGER, not only by the RPC, so it binds service_role and
--     every future writer — 20260801404000's rationale.
--  5. Four SECURITY DEFINER RPCs. authenticated gets NO INSERT/UPDATE/DELETE
--     and NO column grant on the table — the 20260801402000 lesson: a policy
--     that authorises a row while pinning no column is a forgery surface. The
--     self-test asserts the negative with has_column_privilege.
--
--  ── NOT TOUCHED ────────────────────────────────────────────────────────────
--  The qcp_revisions state machine (Agent 1 owns it — this file reads
--  `status`, never writes it and defines no transition). deal_revisions is not
--  referenced: QCP revisioning is its own model. No payment surface. No
--  inspection_scope_templates join anywhere, so base_price_cents cannot leak —
--  asserted below.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── ORDERING: 20260801406000 must already be applied ────────────────────────
--  A plpgsql body is not column-checked at CREATE time (the 20260801252000
--  lesson), so this migration would apply clean against a missing schema and
--  explode at runtime. Fail loudly, here.
DO $ordering$
DECLARE
  v_missing record;
BEGIN
  IF to_regclass('public.quality_control_plans') IS NULL
     OR to_regclass('public.qcp_revisions') IS NULL
     OR to_regclass('public.qcp_required_documents') IS NULL THEN
    RAISE EXCEPTION
      'ORDERING: 20260801406000 (Agent 1, QCP schema) must apply before 20260801408000';
  END IF;

  --  EVERY column the triggers and RPCs below name is checked here. A plpgsql
  --  body is not column-checked at CREATE time, so a missing column would
  --  apply clean and raise 42703 in production instead (20260801252000).
  FOR v_missing IN
    SELECT x.t, x.c
      FROM (VALUES
        ('qcp_required_documents','revision_id'),
        ('qcp_required_documents','document_id'),
        ('qcp_required_documents','label'),
        ('qcp_required_documents','is_mandatory'),
        ('qcp_required_documents','acceptance_criteria'),
        ('qcp_revisions','status'),
        ('qcp_revisions','qcp_id'),
        ('qcp_revisions','revision_no'),
        ('quality_control_plans','organization_id'),
        ('quality_control_plans','supplier_id')
      ) AS x(t, c)
     WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = x.t AND column_name = x.c)
  LOOP
    RAISE EXCEPTION
      'SELFTEST: public.%.% is absent — the QCP schema does not match the frozen contract §2 shape this migration extends. Refusing to bolt acceptance onto a table that changed underneath it.',
      v_missing.t, v_missing.c;
  END LOOP;
END
$ordering$;

-- ════════════════════════════════════════════════════════════════════════════
--  1. SUBMISSION + ACCEPTANCE COLUMNS (additive; nothing frozen is altered)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.qcp_required_documents
  ADD COLUMN IF NOT EXISTS submitted_by    uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at    timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_by     uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accepted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS acceptance_note text;

COMMENT ON COLUMN public.qcp_required_documents.accepted_by IS
  'Sign-off attribution. Never an RPC parameter — always auth.uid() at nx_qcp_accept_document. A trigger additionally refuses the QCP supplier (the party being signed off) and refuses the submitter of the same row, so a document cannot be accepted by whoever produced it. public.documents.uploaded_by is TEXT and un-FK''d, which is why acceptance identity is recorded here against profiles(id) rather than reused from the document row.';

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.qcp_required_documents'::regclass
                    AND conname = 'qcp_req_doc_acceptance_paired') THEN
    ALTER TABLE public.qcp_required_documents
      ADD CONSTRAINT qcp_req_doc_acceptance_paired
      CHECK ((accepted_by IS NULL) = (accepted_at IS NULL));
  END IF;

  --  Accepting nothing is not an acceptance. Without this, a requirement could
  --  be signed off while document_id is still NULL ("required but not yet
  --  supplied") and the QCP would read as satisfied with no artifact behind it.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.qcp_required_documents'::regclass
                    AND conname = 'qcp_req_doc_acceptance_needs_document') THEN
    ALTER TABLE public.qcp_required_documents
      ADD CONSTRAINT qcp_req_doc_acceptance_needs_document
      CHECK (accepted_at IS NULL OR document_id IS NOT NULL);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.qcp_required_documents'::regclass
                    AND conname = 'qcp_req_doc_submission_paired') THEN
    ALTER TABLE public.qcp_required_documents
      ADD CONSTRAINT qcp_req_doc_submission_paired
      CHECK ((submitted_by IS NULL) = (submitted_at IS NULL));
  END IF;
END
$constraints$;

CREATE INDEX IF NOT EXISTS qcp_required_documents_revision_idx
  ON public.qcp_required_documents (revision_id);
CREATE INDEX IF NOT EXISTS qcp_required_documents_document_idx
  ON public.qcp_required_documents (document_id) WHERE document_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
--  2. AUTHORITY HELPERS
-- ════════════════════════════════════════════════════════════════════════════

--  Who may SUPPLY a document against a requirement. The supplier is included:
--  producing the artifact is the supplier's job. It is not a sign-off.
CREATE OR REPLACE FUNCTION public.nx_qcp_may_supply_document(
  p_qcp_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_uid IS NOT NULL AND (
    public.nx_is_admin(p_uid)
    OR EXISTS (
         SELECT 1 FROM public.quality_control_plans q
          WHERE q.id = p_qcp_id AND q.supplier_id = p_uid)
    OR EXISTS (
         SELECT 1
           FROM public.quality_control_plans q
           JOIN public.org_members m ON m.org_id = q.organization_id
          WHERE q.id = p_qcp_id
            AND m.user_id = p_uid
            -- 'viewer' is read-only and may not attach evidence.
            AND m.role IN ('owner','procurement_admin','project_lead'))
  );
$$;
ALTER FUNCTION public.nx_qcp_may_supply_document(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_may_supply_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_may_supply_document(uuid, uuid) TO authenticated, service_role;

--  Who may ACCEPT (sign off) a required document. The buyer side only. The
--  supplier is excluded structurally, not by convention — mirrors
--  nx_itp_may_waive (20260801402000:98): acceptance of a nonconformity, or of
--  the evidence that closes one, belongs to the party being protected.
CREATE OR REPLACE FUNCTION public.nx_qcp_may_accept_document(
  p_qcp_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_uid IS NOT NULL AND (
    public.nx_is_admin(p_uid)
    OR EXISTS (
         SELECT 1
           FROM public.quality_control_plans q
           JOIN public.org_members m ON m.org_id = q.organization_id
          WHERE q.id = p_qcp_id
            AND m.user_id = p_uid
            AND m.role IN ('owner','procurement_admin','project_lead')
            -- The inspected party never signs off on itself, even if it also
            -- holds a seat in the buyer's organization.
            AND (q.supplier_id IS NULL OR q.supplier_id <> p_uid))
  );
$$;
ALTER FUNCTION public.nx_qcp_may_accept_document(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_may_accept_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_may_accept_document(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_qcp_may_accept_document(uuid, uuid) IS
  'May this user sign off a QCP required document? Admin, or a non-viewer member of the QCP''s organization who is NOT the QCP''s supplier. Deliberately narrower than nx_qcp_may_supply_document: supplying evidence and accepting it are different acts, and the party being signed off may never perform the second one.';

--  Read authority for the revision-documents reader. Superseded revisions stay
--  readable — history does not become invisible when it is superseded.
CREATE OR REPLACE FUNCTION public.nx_qcp_may_read(
  p_qcp_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_uid IS NOT NULL AND (
    public.nx_is_admin(p_uid)
    OR EXISTS (
         SELECT 1 FROM public.quality_control_plans q
          WHERE q.id = p_qcp_id AND q.supplier_id = p_uid)
    OR EXISTS (
         SELECT 1
           FROM public.quality_control_plans q
           JOIN public.org_members m ON m.org_id = q.organization_id
          WHERE q.id = p_qcp_id AND m.user_id = p_uid)
  );
$$;
ALTER FUNCTION public.nx_qcp_may_read(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_may_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_may_read(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_qcp_may_read(uuid, uuid) IS
  'Read gate for QCP required documents: admin, the QCP''s supplier (own QCP only), or any member of the owning organization including viewer. Contract §4 also grants an engaged inspector read of the effective approved revision — that clause is NOT implementable: public.jobs carries neither project_id nor organization_id and nothing in the schema references public.projects(id), so "engaged on this project" has no join path. Fails CLOSED for inspectors until a project↔job link exists. Reported to the Lead, not silently approximated.';

-- ════════════════════════════════════════════════════════════════════════════
--  3. COHERENCE + LIFECYCLE + ANTI-FORGERY GUARD  (structural, not RPC-only)
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tg_guard_qcp_required_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $t$
DECLARE
  v_rev_status text;
  v_qcp_id     uuid;
  v_qcp_org    uuid;
  v_supplier   uuid;
  v_doc_org    uuid;
  v_asset_org  uuid;
  v_revision_id uuid;
BEGIN
  --  Branch explicitly rather than `CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW`:
  --  OLD is not a assigned row on INSERT, and relying on composite-record
  --  semantics for it is not worth the risk in a trigger that gates writes.
  IF TG_OP = 'DELETE' THEN
    v_revision_id := OLD.revision_id;
  ELSE
    v_revision_id := NEW.revision_id;
  END IF;

  SELECT r.status, r.qcp_id, q.organization_id, q.supplier_id
    INTO v_rev_status, v_qcp_id, v_qcp_org, v_supplier
    FROM public.qcp_revisions r
    JOIN public.quality_control_plans q ON q.id = r.qcp_id
   WHERE r.id = v_revision_id;

  -- Parent gone ⇒ we are inside the ON DELETE CASCADE from qcp_revisions (or
  -- from the QCP itself). PostgreSQL runs RI cascade as an AFTER trigger on the
  -- parent, so under READ COMMITTED (Supabase/PostgREST default) this lookup
  -- takes a fresh snapshot and the parent row is already invisible. A
  -- requirement's lifetime is bounded by its revision, so this must not be
  -- blocked. Under REPEATABLE READ the parent would still be visible and the
  -- cascade of an approved/superseded revision would be refused — a loud,
  -- safe failure, not a silent one.
  IF v_rev_status IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- ── LIFECYCLE ─────────────────────────────────────────────────────────────
  -- A superseded revision is history. Nothing about it may change, ever —
  -- otherwise "superseded revisions keep their requirements" is a promise the
  -- database does not keep.
  IF v_rev_status = 'superseded' THEN
    RAISE EXCEPTION
      'QCP_REVISION_SUPERSEDED: revision % is superseded history and its required documents are immutable. Amend by adding revision N+1 (nx_qcp_add_revision), never by editing N.',
      v_revision_id USING errcode = '23514';
  END IF;

  IF v_rev_status = 'approved' THEN
    -- An approved revision is the governing document. Its REQUIREMENTS are
    -- fixed; their FULFILMENT is the live operational act and must stay open,
    -- because document_id NULL explicitly means "required but not yet
    -- supplied" and the artifact usually arrives after approval.
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION
        'QCP_REVISION_APPROVED: revision % is approved; a new required document cannot be added to it. Raise revision N+1.',
        v_revision_id USING errcode = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'QCP_REVISION_APPROVED: revision % is approved; a required document cannot be removed from it. Raise revision N+1.',
        v_revision_id USING errcode = '23514';
    END IF;
    IF TG_OP = 'UPDATE'
       AND (NEW.label               IS DISTINCT FROM OLD.label
         OR NEW.is_mandatory        IS DISTINCT FROM OLD.is_mandatory
         OR NEW.acceptance_criteria IS DISTINCT FROM OLD.acceptance_criteria) THEN
      RAISE EXCEPTION
        'QCP_REVISION_APPROVED: the definition of a required document (label, is_mandatory, acceptance_criteria) is frozen once revision % is approved. Supplying or accepting the document is still permitted.',
        v_revision_id USING errcode = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.revision_id IS DISTINCT FROM OLD.revision_id THEN
    RAISE EXCEPTION
      'QCP_REQUIREMENT_REPARENT: a required document cannot be moved between revisions — that would rewrite the contents of a revision from the outside.'
      USING errcode = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- ── COHERENCE: the document must belong to this QCP's organization ────────
  -- The FK to documents(id) proves EXISTENCE only. Same defect class as the
  -- ITP visit_id hole closed in 20260801404000.
  IF NEW.document_id IS NOT NULL THEN
    SELECT d.organization_id, a.organization_id
      INTO v_doc_org, v_asset_org
      FROM public.documents d
      LEFT JOIN public.assets a ON a.id = d.asset_id
     WHERE d.id = NEW.document_id;

    IF v_doc_org IS NULL THEN
      RAISE EXCEPTION 'document % does not exist', NEW.document_id USING errcode = '23503';
    END IF;

    IF v_doc_org IS DISTINCT FROM v_qcp_org THEN
      RAISE EXCEPTION
        'QCP_DOCUMENT_FOREIGN: document % belongs to organization %, but this QCP belongs to organization % — a governing quality plan cannot cite another tenant''s document.',
        NEW.document_id, v_doc_org, v_qcp_org USING errcode = '23514';
    END IF;

    -- documents.organization_id is DENORMALISED from the asset and nothing
    -- enforces the two agree (baseline:22665 / :28328 declare both FKs
    -- independently). Check the asset's org too, or a row carrying a correct
    -- organization_id while pointing at a foreign asset would pass.
    IF v_asset_org IS DISTINCT FROM v_qcp_org THEN
      RAISE EXCEPTION
        'QCP_DOCUMENT_FOREIGN_ASSET: document % is filed against an asset in organization %, but this QCP belongs to organization %.',
        NEW.document_id, v_asset_org, v_qcp_org USING errcode = '23514';
    END IF;
  END IF;

  -- ── ANTI-FORGERY: who may be named as the acceptor ────────────────────────
  IF NEW.accepted_by IS NOT NULL THEN
    IF v_supplier IS NOT NULL AND NEW.accepted_by = v_supplier THEN
      RAISE EXCEPTION
        'QCP_SIGNOFF_SELF: the QCP supplier is the party being signed off and can never be recorded as the acceptor of its own required document.'
        USING errcode = '42501';
    END IF;
    IF NEW.submitted_by IS NOT NULL AND NEW.accepted_by = NEW.submitted_by THEN
      RAISE EXCEPTION
        'QCP_SIGNOFF_SELF: the person who supplied a document cannot be the person who accepts it.'
        USING errcode = '42501';
    END IF;
    IF NOT public.nx_qcp_may_accept_document(v_qcp_id, NEW.accepted_by) THEN
      RAISE EXCEPTION
        'QCP_SIGNOFF_DENIED: % does not hold acceptance authority on this QCP.',
        NEW.accepted_by USING errcode = '42501';
    END IF;
  END IF;

  -- An existing acceptance may not be quietly overwritten, nor may the
  -- document underneath it be swapped. Revoke first (there is an RPC for it,
  -- and it leaves an audit row) — otherwise the record could be made to say a
  -- different artifact was accepted, by a different person, with no trace.
  IF TG_OP = 'UPDATE' AND OLD.accepted_at IS NOT NULL THEN
    IF NEW.accepted_at IS NOT NULL THEN
      IF NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
         OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
         OR NEW.document_id IS DISTINCT FROM OLD.document_id THEN
        RAISE EXCEPTION
          'QCP_SIGNOFF_IMMUTABLE: this requirement is already accepted. Revoke the acceptance (nx_qcp_revoke_document_acceptance) before changing the document or the acceptor.'
          USING errcode = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $t$;
ALTER FUNCTION public.tg_guard_qcp_required_document() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_guard_qcp_required_document ON public.qcp_required_documents;
CREATE TRIGGER trg_guard_qcp_required_document
  BEFORE INSERT OR UPDATE OR DELETE ON public.qcp_required_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_qcp_required_document();

COMMENT ON TRIGGER trg_guard_qcp_required_document ON public.qcp_required_documents IS
  'Coherence + lifecycle + anti-forgery, structural so it binds service_role and any future writer rather than only the RPCs (20260801404000''s rationale). Coherence is enforced at ORGANIZATION granularity because that is the finest link that exists: public.documents has no project_id, public.assets has no project_id, and nothing in the schema references public.projects(id) at all. Cross-project injection inside one organization is therefore not expressible against this FK target and is a reported schema gap, not an omission here.';

-- ════════════════════════════════════════════════════════════════════════════
--  4. HISTORY — every submission and every sign-off is appended, never implied
-- ════════════════════════════════════════════════════════════════════════════
--  public.audit_events (baseline:21760) is the spine: subject_table/subject_id,
--  nullable job_id, and event_type carries NO check constraint (only severity
--  does), so nothing needs widening. job_events would have been wrong — it
--  requires a job_id and a QCP is project-scoped with no job.
CREATE OR REPLACE FUNCTION public.tg_qcp_required_document_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $t$
DECLARE
  v_kind text;
  v_qcp  uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.document_id IS NULL THEN RETURN NEW; END IF;   -- a bare requirement is not an event
    v_kind := 'qcp_document_submitted';
  ELSIF NEW.accepted_at IS NOT NULL AND OLD.accepted_at IS NULL THEN
    v_kind := 'qcp_document_accepted';
  ELSIF NEW.accepted_at IS NULL AND OLD.accepted_at IS NOT NULL THEN
    v_kind := 'qcp_document_acceptance_revoked';
  ELSIF NEW.document_id IS DISTINCT FROM OLD.document_id THEN
    v_kind := 'qcp_document_submitted';
  ELSE
    RETURN NEW;
  END IF;

  SELECT r.qcp_id INTO v_qcp FROM public.qcp_revisions r WHERE r.id = NEW.revision_id;

  INSERT INTO public.audit_events (
    event_type, severity, actor_id, subject_table, subject_id, summary, metadata
  ) VALUES (
    v_kind,
    'info',
    auth.uid(),
    'qcp_required_documents',
    NEW.id,
    format('%s on QCP required document "%s"', v_kind, NEW.label),
    jsonb_build_object(
      'qcp_id',               v_qcp,
      'revision_id',          NEW.revision_id,
      'previous_document_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.document_id END,
      'document_id',          NEW.document_id,
      'submitted_by',         NEW.submitted_by,
      'accepted_by',          NEW.accepted_by,
      'previous_accepted_by', CASE WHEN TG_OP = 'UPDATE' THEN OLD.accepted_by END,
      'acceptance_note',      NEW.acceptance_note,
      'is_mandatory',         NEW.is_mandatory
    )
  );
  RETURN NEW;
END $t$;
ALTER FUNCTION public.tg_qcp_required_document_audit() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_qcp_required_document_audit ON public.qcp_required_documents;
CREATE TRIGGER trg_qcp_required_document_audit
  AFTER INSERT OR UPDATE ON public.qcp_required_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_qcp_required_document_audit();

COMMENT ON TRIGGER trg_qcp_required_document_audit ON public.qcp_required_documents IS
  'Appends every submission, acceptance and revocation to public.audit_events. Deliberately NOT job_events: that spine requires a job_id and a QCP is project-scoped with no job, so job_events_event_type_check (a closed 10-value allow-list as of 20260801404000) is never reached and is not widened by this migration.';

-- ════════════════════════════════════════════════════════════════════════════
--  5. THE ONLY WRITE PATHS
-- ════════════════════════════════════════════════════════════════════════════
--  Nothing here takes an actor as a parameter. Attribution is auth.uid() or it
--  does not happen.

CREATE OR REPLACE FUNCTION public.nx_qcp_attach_document(
  p_requirement_id uuid,
  p_document_id    uuid
) RETURNS public.qcp_required_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_qcp uuid;
  v_out public.qcp_required_documents;
BEGIN
  SELECT r.qcp_id INTO v_qcp
    FROM public.qcp_required_documents d
    JOIN public.qcp_revisions r ON r.id = d.revision_id
   WHERE d.id = p_requirement_id;

  IF v_qcp IS NULL THEN
    RAISE EXCEPTION 'QCP_REQUIREMENT_NOT_FOUND: %', p_requirement_id USING errcode = 'P0002';
  END IF;
  IF NOT public.nx_qcp_may_supply_document(v_qcp) THEN
    RAISE EXCEPTION 'QCP_SUPPLY_DENIED: you may not attach documents to this quality control plan.'
      USING errcode = '42501';
  END IF;

  --  Coherence, revision lifecycle and sign-off immutability are all enforced
  --  by trg_guard_qcp_required_document, which this UPDATE necessarily fires.
  UPDATE public.qcp_required_documents
     SET document_id  = p_document_id,
         submitted_by = CASE WHEN p_document_id IS NULL THEN NULL ELSE auth.uid() END,
         submitted_at = CASE WHEN p_document_id IS NULL THEN NULL ELSE now()      END
   WHERE id = p_requirement_id
   RETURNING * INTO v_out;

  RETURN v_out;
END $$;
ALTER FUNCTION public.nx_qcp_attach_document(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_attach_document(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_attach_document(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_qcp_accept_document(
  p_requirement_id uuid,
  p_note           text DEFAULT NULL
) RETURNS public.qcp_required_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_qcp uuid;
  v_doc uuid;
  v_out public.qcp_required_documents;
BEGIN
  SELECT r.qcp_id, d.document_id INTO v_qcp, v_doc
    FROM public.qcp_required_documents d
    JOIN public.qcp_revisions r ON r.id = d.revision_id
   WHERE d.id = p_requirement_id;

  IF v_qcp IS NULL THEN
    RAISE EXCEPTION 'QCP_REQUIREMENT_NOT_FOUND: %', p_requirement_id USING errcode = 'P0002';
  END IF;
  IF v_doc IS NULL THEN
    RAISE EXCEPTION 'QCP_NOTHING_TO_ACCEPT: no document has been supplied against this requirement yet.'
      USING errcode = '23514';
  END IF;
  IF NOT public.nx_qcp_may_accept_document(v_qcp) THEN
    RAISE EXCEPTION 'QCP_SIGNOFF_DENIED: acceptance requires admin or a non-viewer member of the owning organization, and never the supplier being signed off.'
      USING errcode = '42501';
  END IF;

  UPDATE public.qcp_required_documents
     SET accepted_by     = auth.uid(),   -- ★ never a parameter
         accepted_at     = now(),
         acceptance_note = p_note
   WHERE id = p_requirement_id
   RETURNING * INTO v_out;

  RETURN v_out;
END $$;
ALTER FUNCTION public.nx_qcp_accept_document(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_accept_document(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_accept_document(uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.nx_qcp_accept_document(uuid, text) IS
  'Signs off a QCP required document. accepted_by is auth.uid() and is deliberately NOT a parameter — there is no way to name someone else as the acceptor through this surface, and trg_guard_qcp_required_document refuses the supplier and the submitter even if a future writer bypasses this function.';

CREATE OR REPLACE FUNCTION public.nx_qcp_revoke_document_acceptance(
  p_requirement_id uuid,
  p_note           text DEFAULT NULL
) RETURNS public.qcp_required_documents
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_qcp uuid;
  v_out public.qcp_required_documents;
BEGIN
  SELECT r.qcp_id INTO v_qcp
    FROM public.qcp_required_documents d
    JOIN public.qcp_revisions r ON r.id = d.revision_id
   WHERE d.id = p_requirement_id;

  IF v_qcp IS NULL THEN
    RAISE EXCEPTION 'QCP_REQUIREMENT_NOT_FOUND: %', p_requirement_id USING errcode = 'P0002';
  END IF;
  IF NOT public.nx_qcp_may_accept_document(v_qcp) THEN
    RAISE EXCEPTION 'QCP_SIGNOFF_DENIED: only the acceptance audience may withdraw an acceptance.'
      USING errcode = '42501';
  END IF;

  --  The revocation is appended to audit_events by the audit trigger before
  --  the columns are cleared, so the withdrawn sign-off stays on the record.
  UPDATE public.qcp_required_documents
     SET accepted_by     = NULL,
         accepted_at     = NULL,
         acceptance_note = p_note
   WHERE id = p_requirement_id
   RETURNING * INTO v_out;

  RETURN v_out;
END $$;
ALTER FUNCTION public.nx_qcp_revoke_document_acceptance(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_revoke_document_acceptance(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_revoke_document_acceptance(uuid, text) TO authenticated, service_role;

--  Reader. Works on ANY revision including superseded ones — a superseded QCP
--  revision stays readable history, with the acceptances it carried.
--  Never joins inspection_scope_templates, so base_price_cents is unreachable.
CREATE OR REPLACE FUNCTION public.nx_qcp_revision_documents(p_revision_id uuid)
RETURNS TABLE (
  requirement_id      uuid,
  revision_id         uuid,
  revision_no         int,
  revision_status     text,
  label               text,
  is_mandatory        boolean,
  acceptance_criteria text,
  document_id         uuid,
  document_title      text,
  document_uploaded_at timestamptz,
  submitted_by        uuid,
  submitted_at        timestamptz,
  accepted_by         uuid,
  accepted_at         timestamptz,
  acceptance_note     text,
  is_satisfied        boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_qcp uuid;
BEGIN
  SELECT r.qcp_id INTO v_qcp FROM public.qcp_revisions r WHERE r.id = p_revision_id;
  IF v_qcp IS NULL THEN
    RAISE EXCEPTION 'QCP_REVISION_NOT_FOUND: %', p_revision_id USING errcode = 'P0002';
  END IF;
  IF NOT public.nx_qcp_may_read(v_qcp) THEN
    RAISE EXCEPTION 'QCP_READ_DENIED' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT d.id, d.revision_id, r.revision_no, r.status,
         d.label, d.is_mandatory, d.acceptance_criteria,
         d.document_id, doc.title, doc.uploaded_at,
         d.submitted_by, d.submitted_at,
         d.accepted_by, d.accepted_at, d.acceptance_note,
         (d.document_id IS NOT NULL AND d.accepted_at IS NOT NULL) AS is_satisfied
    FROM public.qcp_required_documents d
    JOIN public.qcp_revisions r ON r.id = d.revision_id
    LEFT JOIN public.documents doc ON doc.id = d.document_id
   WHERE d.revision_id = p_revision_id
   ORDER BY d.is_mandatory DESC, d.label;
END $$;
ALTER FUNCTION public.nx_qcp_revision_documents(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_revision_documents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_revision_documents(uuid) TO authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════
--  6. GRANTS — the RPC is the only road (the 20260801402000 lesson)
-- ════════════════════════════════════════════════════════════════════════════
--  Defence in depth, not a redefinition of Agent 1's grants: contract §3 and
--  20260801402000 both require that no direct write path exists. If 406000
--  granted one, or a Supabase default privilege handed one out, it dies here.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.qcp_required_documents FROM authenticated;
REVOKE ALL                    ON TABLE public.qcp_required_documents FROM anon;

-- ── Self-tests ──────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_money constant text :=
    '\m(payout|wallet|escrow|transactions|admin_confirmed_at|inspector_payout_cents|client_price_cents|platform_spread_cents|base_price_cents|release_payment|stripe)\M';
  v_defs text;
BEGIN
  -- structure
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_guard_qcp_required_document' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: the QCP document coherence guard is missing — an FK would prove existence only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'trg_qcp_required_document_audit' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST: QCP document history is not being appended';
  END IF;
  IF to_regprocedure('public.nx_qcp_attach_document(uuid,uuid)') IS NULL
     OR to_regprocedure('public.nx_qcp_accept_document(uuid,text)') IS NULL
     OR to_regprocedure('public.nx_qcp_revoke_document_acceptance(uuid,text)') IS NULL
     OR to_regprocedure('public.nx_qcp_revision_documents(uuid)') IS NULL
     OR to_regprocedure('public.nx_qcp_may_accept_document(uuid,uuid)') IS NULL
     OR to_regprocedure('public.nx_qcp_may_supply_document(uuid,uuid)') IS NULL
     OR to_regprocedure('public.nx_qcp_may_read(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: a QCP document RPC is missing';
  END IF;

  -- every write path is a definer with a pinned search_path
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('nx_qcp_attach_document','nx_qcp_accept_document',
                         'nx_qcp_revoke_document_acceptance','nx_qcp_revision_documents',
                         'nx_qcp_may_accept_document','nx_qcp_may_supply_document','nx_qcp_may_read')
       AND (NOT p.prosecdef
            OR p.proconfig IS NULL
            OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))) THEN
    RAISE EXCEPTION 'SELFTEST: a QCP document function is not SECURITY DEFINER with a pinned search_path';
  END IF;

  -- ★ THE 402000 LESSON. No table write path, therefore no column may be
  --   writable either. There is no COLUMN grant to assert positively; the
  --   security property here is the negative one, so it is asserted directly.
  IF has_table_privilege('authenticated', 'public.qcp_required_documents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.qcp_required_documents', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.qcp_required_documents', 'DELETE') THEN
    RAISE EXCEPTION 'SELFTEST: authenticated holds a direct write on qcp_required_documents — sign-off could be forged straight through PostgREST';
  END IF;
  IF has_column_privilege('authenticated', 'public.qcp_required_documents', 'accepted_by',  'UPDATE')
     OR has_column_privilege('authenticated', 'public.qcp_required_documents', 'accepted_at',  'UPDATE')
     OR has_column_privilege('authenticated', 'public.qcp_required_documents', 'submitted_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.qcp_required_documents', 'document_id',  'UPDATE') THEN
    RAISE EXCEPTION 'SELFTEST: a sign-off or linkage column is directly writable by authenticated';
  END IF;
  IF has_table_privilege('anon', 'public.qcp_required_documents', 'SELECT') THEN
    RAISE EXCEPTION 'SELFTEST: anon can read QCP required documents';
  END IF;

  -- ★ ATTRIBUTION CANNOT BE PASSED IN. If accepted_by ever becomes a
  --   parameter, the whole anti-forgery argument collapses.
  IF EXISTS (
    SELECT 1 FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND specific_name LIKE 'nx_qcp_accept_document%'
       AND parameter_name ILIKE '%accept%') THEN
    RAISE EXCEPTION 'SELFTEST: nx_qcp_accept_document takes an acceptor parameter — sign-off is forgeable';
  END IF;

  -- ★ MONEY: no price, no payout, no settlement. base_price_cents included in
  --   the pattern — the contract''s explicit money warning.
  SELECT string_agg(pg_get_functiondef(p.oid), E'\n') INTO v_defs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND (p.proname LIKE 'nx_qcp_%' AND p.proname LIKE '%document%'
          OR p.proname IN ('tg_guard_qcp_required_document','tg_qcp_required_document_audit',
                           'nx_qcp_may_read'));
  IF v_defs IS NULL THEN
    RAISE EXCEPTION 'SELFTEST: the money guard matched no function — it is asserting nothing';
  END IF;
  IF v_defs ~* v_money THEN
    RAISE EXCEPTION 'SELFTEST: a QCP document function names a money surface';
  END IF;
  IF v_defs ~* '\minspection_scope_templates\M' THEN
    RAISE EXCEPTION 'SELFTEST: a QCP document function joins inspection_scope_templates — base_price_cents is one careless SELECT * away';
  END IF;

  -- the reader reads
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.nx_qcp_revision_documents(uuid)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'SELFTEST: nx_qcp_revision_documents is not STABLE — it could acquire a side effect';
  END IF;

  -- nothing borrowed was broken
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.documents'::regclass) THEN
    RAISE EXCEPTION 'REGRESSION: RLS was disturbed on public.documents';
  END IF;
  IF has_table_privilege('authenticated', 'public.documents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.documents', 'UPDATE') THEN
    RAISE EXCEPTION 'REGRESSION: 20260801224000''s documents lockdown was reopened';
  END IF;
  IF to_regprocedure('public.nx_can_access_doc(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'REGRESSION: nx_can_access_doc was disturbed — signed-URL minting is the existing document access path and this migration does not replace it';
  END IF;

  RAISE NOTICE 'QCP documents ready: org-coherent linkage, revision-scoped requirements, un-forgeable sign-off, history on audit_events, no direct write path, money-free.';
END
$verify$;

COMMIT;

NOTIFY pgrst, 'reload schema';
