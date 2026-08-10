-- ════════════════════════════════════════════════════════════════════════════
--  20260801406000_qcp_foundation.sql
--
--  PHASE 4 — QCP (Quality Control Plan). Implements docs/qcp-canonical-contract.md
--  §2 schema, §3 seven-RPC surface and §4 authorization matrix. Nothing else.
--
--  ── QCP ORCHESTRATES, IT DOES NOT OWN POINTS ───────────────────────────────
--  The single fact that shapes this whole file: qcp_stage_templates holds a
--  LINK to inspection_scope_templates(id) and nothing more. The ITP points come
--  with the template through itp_points.template_id (20260801398000). No point,
--  stage semantic, acceptance criterion or evidence requirement is copied into
--  a QCP table — a self-test below pins qcp_stage_templates at exactly three
--  columns so a future edit cannot quietly turn it into ITP v2.
--
--  ── APPEND-PRESERVING REVISIONS ────────────────────────────────────────────
--  draft → under_review → approved → superseded. `approved` and `superseded`
--  are immutable: tg_qcp_revision_state() rejects every UPDATE to a row in
--  those states except the single approved → superseded transition, and even
--  that transition must move nothing but `status`. Amending an approved
--  revision means INSERTing revision N+1 with supersedes_id — never editing N.
--  Two partial unique indexes hold the machine together:
--      qcp_revisions_one_approved_idx  exactly one effective revision per QCP
--      qcp_revisions_one_open_idx      at most one revision under construction
--  The child tables are frozen with the revision: a stage or template link may
--  only be written while its revision is a draft, otherwise "immutable" would
--  mean "immutable except for everything that matters".
--
--  ── EVERY WRITE GOES THROUGH AN RPC (THE 20260801402000 LESSON) ────────────
--  402000 found that itp_results_write authorised the ROW while pinning no
--  COLUMN, so any team member could POST a forged release straight to
--  PostgREST. The lesson is applied here pre-emptively rather than after the
--  fact: authenticated receives SELECT and nothing else on all five tables. No
--  INSERT policy, no UPDATE policy, no column grant. There is therefore no
--  policy that could authorise a row without pinning a column, because there is
--  no write policy at all. The seven SECURITY DEFINER RPCs are the only road.
--
--  NOTE: this database carries ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES
--  TO anon, authenticated (baseline:40931-40932). A bare GRANT SELECT would
--  therefore leave INSERT/UPDATE/DELETE in place on a brand-new table. Every
--  table below is explicitly REVOKEd from authenticated first.
--
--  ── MONEY ──────────────────────────────────────────────────────────────────
--  inspection_scope_templates carries a per-template money column. QCP joins
--  that table (to validate a template link) and must never read that column.
--  The negative guard from 20260801400000 is reproduced at the foot of this
--  file, widened to any *_cents token, and applied to every QCP function.
--  Nothing here settles, releases or records anything financial.
--
--  ── NCR ────────────────────────────────────────────────────────────────────
--  A QCP nonconformance is an ordinary flash report, raised from the ITP point
--  that failed through the bridge that already exists
--  (nx_raise_ncr_from_itp_point, 20260801398000). No table, no bridge, no
--  second NCR path is added here, and a self-test refuses one.
--
--  ── PROGRESS IS DERIVED, NEVER STORED ──────────────────────────────────────
--  nx_project_qcp() computes it at read time from itp_point_results through
--  qcp_stage_templates → itp_points. No progress column exists; a self-test
--  refuses one.
--
--  ── ONE INFERENCE, DECLARED ────────────────────────────────────────────────
--  public.projects has no link to public.jobs — verified: jobs has no
--  project_id, nothing in the schema references projects(id), and the table
--  carries no RLS (baseline 24154; see also 20260801252000, which records that
--  projects "has neither client_id nor inspector_id"). "The project an
--  inspector is engaged on" is therefore not directly derivable. It is derived
--  here from the QCP's own orchestration spine and nothing else:
--      a job counts when its scope_template_id is one of the templates this
--      QCP links, AND its buyer principal COALESCE(agency_id, client_id)
--      belongs to the QCP's organization (org_members / organizations.owner_id)
--      or its department belongs to that organization.
--  One implementation, nx_qcp_scope_job_ids(), serves BOTH inspector visibility
--  and progress derivation, so the two can never disagree. It fails closed: a
--  QCP that links no template yields no jobs, hence no inspector access and an
--  empty progress rollup.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════════
--  1) SCHEMA — contract §2, verbatim
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1.1 The plan is an IDENTITY. Status lives on the revision, not here. ─────
CREATE TABLE IF NOT EXISTS public.quality_control_plans (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES public.projects(id)      ON DELETE CASCADE,
  -- Denormalised from the project so every authorisation predicate is a single
  -- column read; tg_qcp_org_matches_project() keeps it honest.
  organization_id  uuid NOT NULL REFERENCES public.organizations(id),
  -- The inspected party, optional. A supplier is NOT a buyer (see the role
  -- matrix): it reads its own obligations and nothing else.
  supplier_id      uuid REFERENCES public.profiles(id),
  title            text NOT NULL,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qcp_title_not_blank CHECK (length(btrim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS qcp_project_idx  ON public.quality_control_plans (project_id);
CREATE INDEX IF NOT EXISTS qcp_org_idx      ON public.quality_control_plans (organization_id);
CREATE INDEX IF NOT EXISTS qcp_supplier_idx ON public.quality_control_plans (supplier_id)
  WHERE supplier_id IS NOT NULL;

COMMENT ON TABLE public.quality_control_plans IS
  'The governing quality document for a project, as an IDENTITY only — it deliberately carries no status, because status belongs to the revision. organization_id is denormalised from the project and pinned equal to it by trigger so every authorisation predicate reads one column.';

-- ── 1.2 Revisions — append-preserving ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qcp_revisions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qcp_id        uuid NOT NULL REFERENCES public.quality_control_plans(id) ON DELETE CASCADE,
  revision_no   int  NOT NULL,
  status        text NOT NULL DEFAULT 'draft',
  quality_scope text,
  standards     text[],
  procedures    text,
  supersedes_id uuid REFERENCES public.qcp_revisions(id),
  approved_by   uuid,
  approved_at   timestamptz,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT qcp_revisions_status_check CHECK (status = ANY (ARRAY[
    'draft','under_review','approved','superseded'])),
  CONSTRAINT qcp_revisions_no_positive CHECK (revision_no > 0),
  CONSTRAINT qcp_revisions_approval_pair CHECK (
    (approved_by IS NULL AND approved_at IS NULL)
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  -- A revision cannot be effective or historical without an approval stamp.
  CONSTRAINT qcp_revisions_effective_is_approved CHECK (
    status NOT IN ('approved','superseded') OR approved_at IS NOT NULL),
  CONSTRAINT qcp_revisions_no_self_supersede CHECK (
    supersedes_id IS NULL OR supersedes_id <> id),
  CONSTRAINT qcp_revisions_qcp_no_unique UNIQUE (qcp_id, revision_no)
);

-- Exactly one EFFECTIVE revision per plan. Non-deferrable on purpose: the
-- approval RPC must supersede the incumbent BEFORE it stamps the successor.
CREATE UNIQUE INDEX IF NOT EXISTS qcp_revisions_one_approved_idx
  ON public.qcp_revisions (qcp_id) WHERE status = 'approved';
-- At most one revision under construction. Without this, two concurrent drafts
-- could each claim to supersede the same incumbent and the lineage recorded in
-- supersedes_id would be a lie for whichever approved second.
CREATE UNIQUE INDEX IF NOT EXISTS qcp_revisions_one_open_idx
  ON public.qcp_revisions (qcp_id) WHERE status IN ('draft','under_review');

CREATE INDEX IF NOT EXISTS qcp_revisions_qcp_idx
  ON public.qcp_revisions (qcp_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS qcp_revisions_supersedes_idx
  ON public.qcp_revisions (supersedes_id) WHERE supersedes_id IS NOT NULL;

COMMENT ON TABLE public.qcp_revisions IS
  'Append-preserving revision history. An approved or superseded revision is a historical record and may never be edited: amending means inserting revision N+1 with supersedes_id set. qcp_revisions_one_approved_idx guarantees exactly one effective revision; qcp_revisions_one_open_idx guarantees the amendment lineage in supersedes_id is unambiguous.';

-- ── 1.3 Stages ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qcp_stages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id  uuid NOT NULL REFERENCES public.qcp_revisions(id) ON DELETE CASCADE,
  sequence_no  int  NOT NULL,
  name         text NOT NULL,
  -- Free text for the SAME reason itp_points.responsible_party is free text: a
  -- contractual role (contractor QC / third party / client rep / notified body)
  -- that varies per client and does not map onto a NEXPEC account.
  responsible_party text,
  CONSTRAINT qcp_stages_sequence_positive CHECK (sequence_no > 0),
  CONSTRAINT qcp_stages_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT qcp_stages_revision_seq_unique UNIQUE (revision_id, sequence_no)
);

COMMENT ON TABLE public.qcp_stages IS
  'A stage of the governing plan. Carries no acceptance criterion, no point type and no evidence requirement — those live on itp_points, reached through the template link in qcp_stage_templates.';

-- ── 1.4 THE ORCHESTRATION ROW ───────────────────────────────────────────────
--  Three columns, forever. No ON DELETE clause on template_id on purpose: a
--  template referenced by a quality plan must not be deletable out from under
--  it. itp_points cascades away with its template; a QCP link blocks the drop.
CREATE TABLE IF NOT EXISTS public.qcp_stage_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id    uuid NOT NULL REFERENCES public.qcp_stages(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.inspection_scope_templates(id),
  CONSTRAINT qcp_stage_templates_unique UNIQUE (stage_id, template_id)
);

CREATE INDEX IF NOT EXISTS qcp_stage_templates_template_idx
  ON public.qcp_stage_templates (template_id);

COMMENT ON TABLE public.qcp_stage_templates IS
  'THE ORCHESTRATION ROW: a link from a QCP stage to an existing inspection_scope_templates row, and nothing else. The plan content — points, types, acceptance criteria, evidence — arrives through itp_points.template_id and is never copied here. Three columns is the contract; a self-test in this migration fails the deploy if a fourth appears.';

-- ── 1.5 Required documents — links EXISTING documents, stores no file ───────
CREATE TABLE IF NOT EXISTS public.qcp_required_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id  uuid NOT NULL REFERENCES public.qcp_revisions(id) ON DELETE CASCADE,
  label        text NOT NULL,
  document_id  uuid REFERENCES public.documents(id),
  is_mandatory boolean NOT NULL DEFAULT true,
  acceptance_criteria text,
  CONSTRAINT qcp_required_documents_label_not_blank CHECK (length(btrim(label)) > 0)
);

CREATE INDEX IF NOT EXISTS qcp_required_documents_revision_idx
  ON public.qcp_required_documents (revision_id);
CREATE INDEX IF NOT EXISTS qcp_required_documents_document_idx
  ON public.qcp_required_documents (document_id) WHERE document_id IS NOT NULL;

COMMENT ON TABLE public.qcp_required_documents IS
  'A document the plan REQUIRES, linked to an existing public.documents row. document_id NULL means required but not yet supplied. The requirement itself freezes with the revision; document_id stays writable afterwards, which is the seam the documents lane (20260801408000) fulfils against. A linked document must belong to the plan''s organization — enforced by trigger, not by hope.';

-- ════════════════════════════════════════════════════════════════════════════
--  2) TRIGGERS — the invariants that must bind service_role too
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_touch_qcp() RETURNS trigger
    LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $t$
BEGIN NEW.updated_at := now(); RETURN NEW; END $t$;
ALTER FUNCTION public.tg_touch_qcp() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_touch_qcp ON public.quality_control_plans;
CREATE TRIGGER trg_touch_qcp BEFORE UPDATE ON public.quality_control_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_qcp();

-- ── 2.1 The denormalised org must equal the project's org ───────────────────
CREATE OR REPLACE FUNCTION public.tg_qcp_org_matches_project() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $t$
DECLARE v_org uuid;
BEGIN
  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = NEW.project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project % does not exist', NEW.project_id USING errcode = '23503';
  END IF;
  IF v_org IS DISTINCT FROM NEW.organization_id THEN
    RAISE EXCEPTION
      'QCP_ORG_MISMATCH: project % belongs to organization %, not % — a plan cannot be filed under another tenant',
      NEW.project_id, v_org, NEW.organization_id USING errcode = '23514';
  END IF;
  RETURN NEW;
END $t$;
ALTER FUNCTION public.tg_qcp_org_matches_project() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_qcp_org_matches_project ON public.quality_control_plans;
CREATE TRIGGER trg_qcp_org_matches_project
  BEFORE INSERT OR UPDATE OF project_id, organization_id ON public.quality_control_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_qcp_org_matches_project();

COMMENT ON TRIGGER trg_qcp_org_matches_project ON public.quality_control_plans IS
  'organization_id is denormalised from the project and is the column every authorisation predicate reads. If it could drift from projects.organization_id, one UPDATE would move a whole plan into another tenant''s read scope. Structural so it binds service_role and any future writer, not only the RPC.';

-- ── 2.2 THE APPEND-PRESERVING STATE MACHINE ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_qcp_revision_state() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $t$
BEGIN
  -- Identity never moves, in any state.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.qcp_id IS DISTINCT FROM OLD.qcp_id
     OR NEW.revision_no IS DISTINCT FROM OLD.revision_no
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'QCP_REVISION_IDENTITY_IMMUTABLE: a revision''s plan, number and authorship are fixed at creation'
      USING errcode = '42501';
  END IF;

  -- A superseded revision is closed history. Nothing reopens it.
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION
      'QCP_REVISION_IMMUTABLE: revision % is superseded and is closed history — amend by inserting the next revision',
      OLD.revision_no USING errcode = '42501';
  END IF;

  -- An approved revision admits EXACTLY ONE update: approved -> superseded,
  -- moving nothing but the status word.
  IF OLD.status = 'approved' THEN
    IF NEW.status = 'superseded'
       AND NEW.quality_scope IS NOT DISTINCT FROM OLD.quality_scope
       AND NEW.standards     IS NOT DISTINCT FROM OLD.standards
       AND NEW.procedures    IS NOT DISTINCT FROM OLD.procedures
       AND NEW.supersedes_id IS NOT DISTINCT FROM OLD.supersedes_id
       AND NEW.approved_by   IS NOT DISTINCT FROM OLD.approved_by
       AND NEW.approved_at   IS NOT DISTINCT FROM OLD.approved_at THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION
      'QCP_REVISION_IMMUTABLE: revision % is approved — the only permitted change is being superseded by its successor',
      OLD.revision_no USING errcode = '42501';
  END IF;

  -- Forward only. There is no reject edge and no un-submit edge in the frozen
  -- state machine, so there is none here.
  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft','under_review') THEN
    RAISE EXCEPTION 'QCP_REVISION_TRANSITION: draft may only stay draft or move to under_review (attempted %)',
      NEW.status USING errcode = '22023';
  END IF;
  IF OLD.status = 'under_review' AND NEW.status NOT IN ('under_review','approved') THEN
    RAISE EXCEPTION 'QCP_REVISION_TRANSITION: under_review may only stay under_review or move to approved (attempted %)',
      NEW.status USING errcode = '22023';
  END IF;

  -- The approval stamp exists only on an approved revision, and only then.
  IF NEW.status = 'approved' AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL) THEN
    RAISE EXCEPTION 'QCP_REVISION_TRANSITION: an approved revision must record who approved it and when'
      USING errcode = '22023';
  END IF;
  IF NEW.status <> 'approved' AND (NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'QCP_REVISION_TRANSITION: an unapproved revision may not carry an approval stamp'
      USING errcode = '22023';
  END IF;

  RETURN NEW;
END $t$;
ALTER FUNCTION public.tg_qcp_revision_state() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_qcp_revision_state ON public.qcp_revisions;
CREATE TRIGGER trg_qcp_revision_state BEFORE UPDATE ON public.qcp_revisions
  FOR EACH ROW EXECUTE FUNCTION public.tg_qcp_revision_state();

COMMENT ON TRIGGER trg_qcp_revision_state ON public.qcp_revisions IS
  'The append-preserving guarantee, enforced structurally rather than in the RPC so it binds service_role, a future migration and a direct psql session alike. approved and superseded are immutable; the single exception is approved -> superseded, which may move nothing but the status word.';

-- ── 2.3 The children freeze with their revision ─────────────────────────────
--  Without this, "an approved revision is immutable" would mean "immutable
--  except for its stages, its template links and everything it orchestrates".
CREATE OR REPLACE FUNCTION public.tg_qcp_child_draft_only() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $t$
DECLARE
  v_revision uuid;
  v_status   text;
BEGIN
  IF TG_TABLE_NAME = 'qcp_stages' THEN
    IF TG_OP = 'DELETE' THEN v_revision := OLD.revision_id;
    ELSE                     v_revision := NEW.revision_id;
    END IF;
  ELSE
    SELECT s.revision_id INTO v_revision FROM public.qcp_stages s
     WHERE s.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.stage_id ELSE NEW.stage_id END;
  END IF;

  -- The parent is already gone: this is a cascade, not an edit. Let it run.
  IF v_revision IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  SELECT r.status INTO v_status FROM public.qcp_revisions r WHERE r.id = v_revision;
  IF v_status IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF v_status <> 'draft' THEN
    RAISE EXCEPTION
      'QCP_REVISION_IMMUTABLE: % on % is refused because revision % is % — build the next revision instead',
      TG_OP, TG_TABLE_NAME, v_revision, v_status USING errcode = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $t$;
ALTER FUNCTION public.tg_qcp_child_draft_only() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_qcp_stages_draft_only ON public.qcp_stages;
CREATE TRIGGER trg_qcp_stages_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.qcp_stages
  FOR EACH ROW EXECUTE FUNCTION public.tg_qcp_child_draft_only();

DROP TRIGGER IF EXISTS trg_qcp_stage_templates_draft_only ON public.qcp_stage_templates;
CREATE TRIGGER trg_qcp_stage_templates_draft_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.qcp_stage_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_qcp_child_draft_only();

-- ── 2.4 Required documents: requirement frozen, fulfilment open ─────────────
CREATE OR REPLACE FUNCTION public.tg_qcp_required_document_guard() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $t$
DECLARE
  v_revision uuid;
  v_status   text;
  v_plan_org uuid;
  v_doc_org  uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_revision := OLD.revision_id;
  ELSE                     v_revision := NEW.revision_id;
  END IF;

  SELECT r.status, q.organization_id INTO v_status, v_plan_org
    FROM public.qcp_revisions r
    JOIN public.quality_control_plans q ON q.id = r.qcp_id
   WHERE r.id = v_revision;

  -- Cascade from a vanished parent.
  IF v_status IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' AND v_status <> 'draft' THEN
    RAISE EXCEPTION
      'QCP_REVISION_IMMUTABLE: a required document cannot be removed from revision % (status %)',
      v_revision, v_status USING errcode = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND v_status <> 'draft' THEN
    RAISE EXCEPTION
      'QCP_REVISION_IMMUTABLE: a new requirement cannot be added to revision % (status %) — build the next revision',
      v_revision, v_status USING errcode = '42501';
  END IF;

  -- Outside draft the REQUIREMENT is frozen; only its fulfilment may move.
  IF TG_OP = 'UPDATE' AND v_status <> 'draft' THEN
    IF NEW.revision_id IS DISTINCT FROM OLD.revision_id
       OR NEW.label IS DISTINCT FROM OLD.label
       OR NEW.is_mandatory IS DISTINCT FROM OLD.is_mandatory
       OR NEW.acceptance_criteria IS DISTINCT FROM OLD.acceptance_criteria THEN
      RAISE EXCEPTION
        'QCP_REVISION_IMMUTABLE: revision % is % — only document_id may be written on a frozen requirement',
        v_revision, v_status USING errcode = '42501';
    END IF;
  END IF;

  -- A plan may only require documents belonging to its own tenant.
  IF TG_OP <> 'DELETE' AND NEW.document_id IS NOT NULL THEN
    SELECT d.organization_id INTO v_doc_org FROM public.documents d WHERE d.id = NEW.document_id;
    IF v_doc_org IS NULL THEN
      RAISE EXCEPTION 'document % does not exist', NEW.document_id USING errcode = '23503';
    END IF;
    IF v_doc_org IS DISTINCT FROM v_plan_org THEN
      RAISE EXCEPTION
        'QCP_DOCUMENT_CROSS_ORG: document % belongs to organization %, the plan to % — refused',
        NEW.document_id, v_doc_org, v_plan_org USING errcode = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $t$;
ALTER FUNCTION public.tg_qcp_required_document_guard() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_qcp_required_document_guard ON public.qcp_required_documents;
CREATE TRIGGER trg_qcp_required_document_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.qcp_required_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_qcp_required_document_guard();

COMMENT ON TRIGGER trg_qcp_required_document_guard ON public.qcp_required_documents IS
  'Two invariants. (1) The REQUIREMENT freezes with its revision, but document_id stays writable so a document can still be supplied against an approved plan — that is the seam the documents lane fulfils against, and it is deliberately the only writable column outside draft. (2) A linked document must belong to the plan''s organization, which the FK to documents(id) cannot express.';

-- ════════════════════════════════════════════════════════════════════════════
--  3) AUTHORIZATION HELPERS — contract §4
-- ════════════════════════════════════════════════════════════════════════════

-- ── 3.1 Who is the organization here ────────────────────────────────────────
--  org_members is the canonical org predicate in this repository
--  (20260801224000). organizations.owner_id is included because an owner does
--  not always carry a membership row. profiles.organization_id is deliberately
--  NOT trusted: it is a profile attribute, not a membership grant.
CREATE OR REPLACE FUNCTION public.nx_qcp_org_reader(
  p_org_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_uid IS NOT NULL AND p_org_id IS NOT NULL AND (
    public.nx_is_admin(p_uid)
    OR EXISTS (SELECT 1 FROM public.org_members m
                WHERE m.org_id = p_org_id AND m.user_id = p_uid)
    OR EXISTS (SELECT 1 FROM public.organizations o
                WHERE o.id = p_org_id AND o.owner_id = p_uid));
$$;
ALTER FUNCTION public.nx_qcp_org_reader(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_org_reader(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_org_reader(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_qcp_org_author(
  p_org_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Authoring and approving the governing quality document is not a viewer's
  -- act. The frozen matrix names account KINDS, not org_member_role values;
  -- filling that silence fails closed rather than open.
  SELECT p_uid IS NOT NULL AND p_org_id IS NOT NULL AND (
    public.nx_is_admin(p_uid)
    OR EXISTS (SELECT 1 FROM public.organizations o
                WHERE o.id = p_org_id AND o.owner_id = p_uid)
    OR EXISTS (SELECT 1 FROM public.org_members m
                WHERE m.org_id = p_org_id AND m.user_id = p_uid
                  AND m.role IN ('owner','procurement_admin','project_lead')));
$$;
ALTER FUNCTION public.nx_qcp_org_author(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_org_author(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_org_author(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_org_author(uuid, uuid) IS
  'May this user author or approve a QCP for this organization? Admin, the organization owner, or a member holding owner / procurement_admin / project_lead. A viewer reads and does not author — the frozen matrix is silent on org_member_role and silence is resolved closed.';

-- ── 3.2 The one place jobs enter a QCP ──────────────────────────────────────
--  Serves BOTH inspector visibility and derived progress so the two cannot
--  disagree. NOT granted to authenticated: it is called only from inside the
--  SECURITY DEFINER functions below (which execute as their owner), so exposing
--  it would only hand out a job-id enumeration oracle.
CREATE OR REPLACE FUNCTION public.nx_qcp_scope_job_ids(p_qcp_id uuid)
RETURNS TABLE (job_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT j.id
    FROM public.quality_control_plans q
    JOIN public.qcp_revisions       r  ON r.qcp_id = q.id
    JOIN public.qcp_stages          s  ON s.revision_id = r.id
    JOIN public.qcp_stage_templates st ON st.stage_id = s.id
    JOIN public.jobs                j  ON j.scope_template_id = st.template_id
   WHERE q.id = p_qcp_id
     AND j.deleted_at IS NULL
     AND (
       EXISTS (SELECT 1 FROM public.org_members m
                WHERE m.org_id = q.organization_id
                  AND m.user_id = COALESCE(j.agency_id, j.client_id))
       OR EXISTS (SELECT 1 FROM public.organizations o
                   WHERE o.id = q.organization_id
                     AND o.owner_id = COALESCE(j.agency_id, j.client_id))
       OR EXISTS (SELECT 1 FROM public.departments d
                   WHERE d.id = j.department_id AND d.org_id = q.organization_id)
     );
$$;
ALTER FUNCTION public.nx_qcp_scope_job_ids(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_scope_job_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nx_qcp_scope_job_ids(uuid) TO service_role;

COMMENT ON FUNCTION public.nx_qcp_scope_job_ids(uuid) IS
  'The jobs a QCP actually governs. public.projects has no link to public.jobs anywhere in the schema, so engagement is derived from the plan''s own orchestration spine: the job runs one of the templates this plan links AND its buyer principal COALESCE(agency_id, client_id) belongs to the plan''s organization (membership, ownership or department). Deliberately not executable by authenticated — it is an internal predicate, and handing it out would be a job-id oracle.';

CREATE OR REPLACE FUNCTION public.nx_qcp_is_engaged_inspector(
  p_qcp_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  -- Nothing to be engaged on until a revision is effective: an inspector never
  -- sees a plan that is still being drafted.
  SELECT p_uid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.qcp_revisions r
                  WHERE r.qcp_id = p_qcp_id AND r.status = 'approved')
     AND EXISTS (
           SELECT 1 FROM public.nx_qcp_scope_job_ids(p_qcp_id) sj
            WHERE EXISTS (SELECT 1 FROM public.jobs j
                           WHERE j.id = sj.job_id AND j.contractor_id = p_uid)
               OR public.nx_is_active_job_team_member(sj.job_id, p_uid));
$$;
ALTER FUNCTION public.nx_qcp_is_engaged_inspector(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_is_engaged_inspector(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_is_engaged_inspector(uuid, uuid) TO authenticated, service_role;

-- ── 3.3 The two read predicates and the write predicate ─────────────────────
--  can_read_detail = everyone who may see stages, template links and progress.
--  can_read        = the above PLUS the named supplier, who sees obligations.
CREATE OR REPLACE FUNCTION public.nx_qcp_can_read_detail(
  p_qcp_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.quality_control_plans q
     WHERE q.id = p_qcp_id
       AND (public.nx_qcp_org_reader(q.organization_id, p_uid)
            OR public.nx_qcp_is_engaged_inspector(q.id, p_uid)));
$$;
ALTER FUNCTION public.nx_qcp_can_read_detail(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_can_read_detail(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_can_read_detail(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_qcp_can_read(
  p_qcp_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.nx_qcp_can_read_detail(p_qcp_id, p_uid)
      OR EXISTS (SELECT 1 FROM public.quality_control_plans q
                  WHERE q.id = p_qcp_id AND p_uid IS NOT NULL AND q.supplier_id = p_uid);
$$;
ALTER FUNCTION public.nx_qcp_can_read(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_can_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_can_read(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.nx_qcp_can_author(
  p_qcp_id uuid, p_uid uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.quality_control_plans q
     WHERE q.id = p_qcp_id AND public.nx_qcp_org_author(q.organization_id, p_uid));
$$;
ALTER FUNCTION public.nx_qcp_can_author(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_can_author(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_can_author(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_can_author(uuid, uuid) IS
  'Author / approve authority on a plan. An inspector is never inside this predicate: inspectors execute ITP work, they do not edit the governing plan. A supplier is never inside it either — it is the inspected party, not a buyer.';

-- ════════════════════════════════════════════════════════════════════════════
--  4) RLS — SELECT only, and only what the matrix allows
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.quality_control_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qcp_revisions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qcp_stages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qcp_stage_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qcp_required_documents  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS qcp_plans_read ON public.quality_control_plans;
CREATE POLICY qcp_plans_read ON public.quality_control_plans
  FOR SELECT TO authenticated
  USING (public.nx_qcp_can_read(quality_control_plans.id, auth.uid()));

--  A revision that is not effective is internal to the authoring organization.
DROP POLICY IF EXISTS qcp_revisions_read ON public.qcp_revisions;
CREATE POLICY qcp_revisions_read ON public.qcp_revisions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.quality_control_plans q
       WHERE q.id = qcp_revisions.qcp_id
         AND (
           public.nx_qcp_org_reader(q.organization_id, auth.uid())
           OR (qcp_revisions.status = 'approved'
               AND (public.nx_qcp_is_engaged_inspector(q.id, auth.uid())
                    OR (auth.uid() IS NOT NULL AND q.supplier_id = auth.uid())))
         ))
  );

--  Stages and template links are plan internals: org and engaged inspector.
--  A supplier reads obligations, not the orchestration.
DROP POLICY IF EXISTS qcp_stages_read ON public.qcp_stages;
CREATE POLICY qcp_stages_read ON public.qcp_stages
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.qcp_revisions r
             WHERE r.id = qcp_stages.revision_id
               AND public.nx_qcp_can_read_detail(r.qcp_id, auth.uid()))
  );

DROP POLICY IF EXISTS qcp_stage_templates_read ON public.qcp_stage_templates;
CREATE POLICY qcp_stage_templates_read ON public.qcp_stage_templates
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.qcp_stages s
              JOIN public.qcp_revisions r ON r.id = s.revision_id
             WHERE s.id = qcp_stage_templates.stage_id
               AND public.nx_qcp_can_read_detail(r.qcp_id, auth.uid()))
  );

DROP POLICY IF EXISTS qcp_required_documents_read ON public.qcp_required_documents;
CREATE POLICY qcp_required_documents_read ON public.qcp_required_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.qcp_revisions r
        JOIN public.quality_control_plans q ON q.id = r.qcp_id
       WHERE r.id = qcp_required_documents.revision_id
         AND (
           public.nx_qcp_org_reader(q.organization_id, auth.uid())
           OR (r.status = 'approved'
               AND (public.nx_qcp_is_engaged_inspector(q.id, auth.uid())
                    OR (auth.uid() IS NOT NULL AND q.supplier_id = auth.uid())))
         ))
  );

--  ★ THE 402000 LESSON, APPLIED BEFORE THE FACT.
--  ALTER DEFAULT PRIVILEGES in this database grants ALL on new public tables to
--  anon and authenticated, so a bare GRANT SELECT would leave INSERT, UPDATE
--  and DELETE standing. Strip them, then hand back SELECT alone. There is no
--  write policy on any of these tables, so there is no policy that can
--  authorise a row without pinning a column.
REVOKE ALL ON TABLE public.quality_control_plans  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.qcp_revisions          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.qcp_stages             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.qcp_stage_templates    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.qcp_required_documents FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.quality_control_plans  TO authenticated;
GRANT SELECT ON TABLE public.qcp_revisions          TO authenticated;
GRANT SELECT ON TABLE public.qcp_stages             TO authenticated;
GRANT SELECT ON TABLE public.qcp_stage_templates    TO authenticated;
GRANT SELECT ON TABLE public.qcp_required_documents TO authenticated;

GRANT ALL ON TABLE public.quality_control_plans  TO service_role;
GRANT ALL ON TABLE public.qcp_revisions          TO service_role;
GRANT ALL ON TABLE public.qcp_stages             TO service_role;
GRANT ALL ON TABLE public.qcp_stage_templates    TO service_role;
GRANT ALL ON TABLE public.qcp_required_documents TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
--  5) THE SEVEN RPCs — contract §3
-- ════════════════════════════════════════════════════════════════════════════

-- ── 5.1 nx_qcp_create ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_qcp_create(
  p_project_id  uuid,
  p_title       text,
  p_supplier_id uuid DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_org   uuid;
  v_qcp   uuid;
  v_rev   uuid;
  v_title text := NULLIF(btrim(coalesce(p_title, '')), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'a quality plan needs a title' USING errcode = '22023';
  END IF;

  SELECT p.organization_id INTO v_org FROM public.projects p WHERE p.id = p_project_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'project not found' USING errcode = 'P0002';
  END IF;

  IF NOT public.nx_qcp_org_author(v_org, v_uid) THEN
    RAISE EXCEPTION 'not authorized to author a quality plan for this organization'
      USING errcode = '42501';
  END IF;

  IF p_supplier_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p_supplier_id) THEN
    RAISE EXCEPTION 'supplier not found' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.quality_control_plans
    (project_id, organization_id, supplier_id, title, created_by)
  VALUES (p_project_id, v_org, p_supplier_id, v_title, v_uid)
  RETURNING id INTO v_qcp;

  INSERT INTO public.qcp_revisions (qcp_id, revision_no, status, created_by)
  VALUES (v_qcp, 1, 'draft', v_uid)
  RETURNING id INTO v_rev;

  BEGIN
    INSERT INTO public.audit_events
      (event_type, severity, actor_id, subject_table, subject_id, summary, metadata)
    VALUES ('qcp.created', 'info', v_uid, 'quality_control_plans', v_qcp,
            'Quality control plan created with revision 1 in draft',
            jsonb_build_object('qcp_id', v_qcp, 'revision_id', v_rev,
                               'project_id', p_project_id, 'organization_id', v_org));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'qcp create audit failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'qcp_id', v_qcp, 'revision_id', v_rev,
                            'revision_no', 1, 'status', 'draft');
END $fn$;

ALTER FUNCTION public.nx_qcp_create(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_create(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_create(uuid, text, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_create(uuid, text, uuid) IS
  'Creates a quality plan and its revision 1 in draft. organization_id is taken from the project, never from the caller. Returns no money column of any kind.';

-- ── 5.2 nx_qcp_add_revision ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_qcp_add_revision(p_qcp_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_cur  RECORD;
  v_open text;
  v_next int;
  v_new  uuid;
  v_stage RECORD;
  v_new_stage uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;
  IF NOT public.nx_qcp_can_author(p_qcp_id, v_uid) THEN
    RAISE EXCEPTION 'not authorized to amend this quality plan' USING errcode = '42501';
  END IF;

  -- Serialise concurrent amendments on the plan identity.
  PERFORM 1 FROM public.quality_control_plans q WHERE q.id = p_qcp_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'quality plan not found' USING errcode = 'P0002';
  END IF;

  SELECT r.status INTO v_open FROM public.qcp_revisions r
   WHERE r.qcp_id = p_qcp_id AND r.status IN ('draft','under_review') LIMIT 1;
  IF v_open IS NOT NULL THEN
    RAISE EXCEPTION
      'a revision is already open on this plan (status %) — finish or approve it before starting another',
      v_open USING errcode = '22023';
  END IF;

  SELECT * INTO v_cur FROM public.qcp_revisions r
   WHERE r.qcp_id = p_qcp_id AND r.status = 'approved';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nothing to amend: this plan has no approved revision' USING errcode = '22023';
  END IF;

  SELECT COALESCE(max(r.revision_no), 0) + 1 INTO v_next
    FROM public.qcp_revisions r WHERE r.qcp_id = p_qcp_id;

  INSERT INTO public.qcp_revisions
    (qcp_id, revision_no, status, quality_scope, standards, procedures,
     supersedes_id, created_by)
  VALUES (p_qcp_id, v_next, 'draft', v_cur.quality_scope, v_cur.standards,
          v_cur.procedures, v_cur.id, v_uid)
  RETURNING id INTO v_new;

  -- Clone the plan STRUCTURE. Only links are copied; no point, criterion or
  -- evidence requirement is duplicated, because none is stored here to begin.
  FOR v_stage IN
    SELECT s.id, s.sequence_no, s.name, s.responsible_party
      FROM public.qcp_stages s WHERE s.revision_id = v_cur.id ORDER BY s.sequence_no
  LOOP
    INSERT INTO public.qcp_stages (revision_id, sequence_no, name, responsible_party)
    VALUES (v_new, v_stage.sequence_no, v_stage.name, v_stage.responsible_party)
    RETURNING id INTO v_new_stage;

    INSERT INTO public.qcp_stage_templates (stage_id, template_id)
    SELECT v_new_stage, st.template_id
      FROM public.qcp_stage_templates st WHERE st.stage_id = v_stage.id;
  END LOOP;

  -- Requirements carry forward WITH the document already supplied: the same
  -- document still satisfies the same requirement until someone says otherwise.
  INSERT INTO public.qcp_required_documents
    (revision_id, label, document_id, is_mandatory, acceptance_criteria)
  SELECT v_new, d.label, d.document_id, d.is_mandatory, d.acceptance_criteria
    FROM public.qcp_required_documents d WHERE d.revision_id = v_cur.id;

  BEGIN
    INSERT INTO public.audit_events
      (event_type, severity, actor_id, subject_table, subject_id, summary, metadata)
    VALUES ('qcp.revision_opened', 'info', v_uid, 'qcp_revisions', v_new,
            'New draft revision opened as an amendment',
            jsonb_build_object('qcp_id', p_qcp_id, 'revision_no', v_next,
                               'supersedes_id', v_cur.id));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'qcp amendment audit failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'qcp_id', p_qcp_id, 'revision_id', v_new,
                            'revision_no', v_next, 'status', 'draft',
                            'supersedes_id', v_cur.id);
END $fn$;

ALTER FUNCTION public.nx_qcp_add_revision(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_add_revision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_add_revision(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_add_revision(uuid) IS
  'Amending an approved plan means a NEW revision, never an edit: clones the effective revision''s structure into revision N+1 in draft and records supersedes_id. Refuses while another revision is open, so the amendment lineage cannot become ambiguous.';

-- ── 5.3 nx_qcp_submit_revision ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_qcp_submit_revision(p_revision_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_rev RECORD;
  v_stages int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.id, r.qcp_id, r.revision_no, r.status INTO v_rev
    FROM public.qcp_revisions r WHERE r.id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revision not found' USING errcode = 'P0002';
  END IF;
  IF NOT public.nx_qcp_can_author(v_rev.qcp_id, v_uid) THEN
    RAISE EXCEPTION 'not authorized to submit this revision' USING errcode = '42501';
  END IF;
  IF v_rev.status <> 'draft' THEN
    RAISE EXCEPTION 'only a draft revision can be submitted (status %)', v_rev.status
      USING errcode = '22023';
  END IF;

  SELECT count(*) INTO v_stages FROM public.qcp_stages s WHERE s.revision_id = p_revision_id;
  IF v_stages = 0 THEN
    RAISE EXCEPTION 'a revision with no stage has nothing to review' USING errcode = '22023';
  END IF;

  UPDATE public.qcp_revisions SET status = 'under_review' WHERE id = p_revision_id;

  BEGIN
    INSERT INTO public.audit_events
      (event_type, severity, actor_id, subject_table, subject_id, summary, metadata)
    VALUES ('qcp.revision_submitted', 'info', v_uid, 'qcp_revisions', p_revision_id,
            'Quality plan revision submitted for review',
            jsonb_build_object('qcp_id', v_rev.qcp_id, 'revision_no', v_rev.revision_no));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'qcp submit audit failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'revision_id', p_revision_id,
                            'status', 'under_review');
END $fn$;

ALTER FUNCTION public.nx_qcp_submit_revision(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_submit_revision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_submit_revision(uuid) TO authenticated, service_role;

-- ── 5.4 nx_qcp_approve_revision ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_qcp_approve_revision(
  p_revision_id uuid, p_note text DEFAULT NULL
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid  uuid := auth.uid();
  v_rev  RECORD;
  v_prev uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.id, r.qcp_id, r.revision_no, r.status INTO v_rev
    FROM public.qcp_revisions r WHERE r.id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revision not found' USING errcode = 'P0002';
  END IF;
  IF NOT public.nx_qcp_can_author(v_rev.qcp_id, v_uid) THEN
    RAISE EXCEPTION 'not authorized to approve this revision' USING errcode = '42501';
  END IF;
  IF v_rev.status <> 'under_review' THEN
    RAISE EXCEPTION 'only a revision under review can be approved (status %)', v_rev.status
      USING errcode = '22023';
  END IF;

  -- Serialise the swap on the plan identity, then supersede the incumbent
  -- BEFORE stamping the successor: qcp_revisions_one_approved_idx is not
  -- deferrable, so the order is the atomicity.
  PERFORM 1 FROM public.quality_control_plans q WHERE q.id = v_rev.qcp_id FOR UPDATE;

  SELECT r.id INTO v_prev FROM public.qcp_revisions r
   WHERE r.qcp_id = v_rev.qcp_id AND r.status = 'approved';

  IF v_prev IS NOT NULL THEN
    UPDATE public.qcp_revisions SET status = 'superseded' WHERE id = v_prev;
  END IF;

  UPDATE public.qcp_revisions
     SET status = 'approved', approved_by = v_uid, approved_at = now(),
         supersedes_id = COALESCE(v_prev, supersedes_id)
   WHERE id = p_revision_id;

  -- The note lives on the append-only audit spine. The frozen schema has no
  -- note column and this migration does not invent one.
  BEGIN
    INSERT INTO public.audit_events
      (event_type, severity, actor_id, subject_table, subject_id, summary, metadata)
    VALUES ('qcp.revision_approved', 'info', v_uid, 'qcp_revisions', p_revision_id,
            'Quality plan revision approved and made effective',
            jsonb_build_object('qcp_id', v_rev.qcp_id, 'revision_no', v_rev.revision_no,
                               'superseded_revision_id', v_prev,
                               'note', NULLIF(btrim(coalesce(p_note, '')), '')));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'qcp approval audit failed: %', SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'revision_id', p_revision_id,
                            'status', 'approved', 'superseded_revision_id', v_prev);
END $fn$;

ALTER FUNCTION public.nx_qcp_approve_revision(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_approve_revision(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_approve_revision(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_approve_revision(uuid, text) IS
  'Makes a revision effective and supersedes the incumbent in the same statement order the non-deferrable one-approved index requires. Approving a quality plan settles nothing and moves nothing: it is a document decision. The approval note is written to audit_events because the frozen schema has no note column.';

-- ── 5.5 nx_qcp_set_stage_templates — draft only ─────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_qcp_set_stage_templates(
  p_stage_id uuid, p_template_ids uuid[]
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid    uuid := auth.uid();
  v_qcp    uuid;
  v_status text;
  v_ids    uuid[] := COALESCE(p_template_ids, ARRAY[]::uuid[]);
  v_found  int;
  v_want   int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT r.qcp_id, r.status INTO v_qcp, v_status
    FROM public.qcp_stages s JOIN public.qcp_revisions r ON r.id = s.revision_id
   WHERE s.id = p_stage_id;
  IF v_qcp IS NULL THEN
    RAISE EXCEPTION 'stage not found' USING errcode = 'P0002';
  END IF;
  IF NOT public.nx_qcp_can_author(v_qcp, v_uid) THEN
    RAISE EXCEPTION 'not authorized to edit this quality plan' USING errcode = '42501';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'template links can only be set on a draft revision (status %)', v_status
      USING errcode = '22023';
  END IF;

  SELECT count(DISTINCT u) INTO v_want FROM unnest(v_ids) u;
  -- Existence and activity only. This is the join the money guard watches: the
  -- template row is touched for its id and its active flag, nothing else.
  SELECT count(*) INTO v_found
    FROM public.inspection_scope_templates t
   WHERE t.id = ANY (v_ids) AND t.is_active;
  IF v_found <> v_want THEN
    RAISE EXCEPTION 'one or more scope templates do not exist or are inactive'
      USING errcode = 'P0002';
  END IF;

  DELETE FROM public.qcp_stage_templates st WHERE st.stage_id = p_stage_id;
  INSERT INTO public.qcp_stage_templates (stage_id, template_id)
  SELECT p_stage_id, w.t FROM (SELECT DISTINCT u AS t FROM unnest(v_ids) u) w;

  RETURN jsonb_build_object('ok', true, 'stage_id', p_stage_id,
                            'template_count', v_want);
END $fn$;

ALTER FUNCTION public.nx_qcp_set_stage_templates(uuid, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_set_stage_templates(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_set_stage_templates(uuid, uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_set_stage_templates(uuid, uuid[]) IS
  'Replaces the set of scope templates a draft stage orchestrates. It writes LINKS ONLY — no point, stage semantic, acceptance criterion or evidence requirement is copied out of the template, because the plan reads them live through itp_points.template_id. Reads the template row for its id and active flag and for nothing else.';

-- ── 5.6 nx_project_qcp — the reader, with derived progress ──────────────────
CREATE OR REPLACE FUNCTION public.nx_project_qcp(p_project_id uuid)
RETURNS TABLE (
  qcp_id            uuid,
  title             text,
  organization_id   uuid,
  supplier_id       uuid,
  revision_id       uuid,
  revision_no       int,
  status            text,
  quality_scope     text,
  standards         text[],
  procedures        text,
  supersedes_id     uuid,
  approved_by       uuid,
  approved_at       timestamptz,
  viewer_scope      text,
  stages            jsonb,
  required_documents jsonb,
  progress          jsonb
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_uid   uuid := auth.uid();
  v_plan  RECORD;
  v_rev   RECORD;
  v_scope text;
  v_jobs  uuid[];
  v_stages jsonb;
  v_docs   jsonb;
  v_prog   jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id) THEN
    RAISE EXCEPTION 'project not found' USING errcode = 'P0002';
  END IF;

  FOR v_plan IN
    SELECT q.* FROM public.quality_control_plans q WHERE q.project_id = p_project_id
     ORDER BY q.created_at
  LOOP
    -- Fail closed: an unauthorised caller simply sees no plan on this project.
    IF NOT public.nx_qcp_can_read(v_plan.id, v_uid) THEN
      CONTINUE;
    END IF;

    IF public.nx_is_admin(v_uid) THEN
      v_scope := 'admin';
    ELSIF public.nx_qcp_org_reader(v_plan.organization_id, v_uid) THEN
      v_scope := 'org';
    ELSIF public.nx_qcp_is_engaged_inspector(v_plan.id, v_uid) THEN
      v_scope := 'inspector';
    ELSE
      v_scope := 'supplier';
    END IF;

    -- The EFFECTIVE revision. Only the authoring organization sees a plan that
    -- has not yet been approved; an inspector or a supplier sees nothing until
    -- there is something effective to see.
    SELECT r.* INTO v_rev FROM public.qcp_revisions r
     WHERE r.qcp_id = v_plan.id AND r.status = 'approved';
    IF NOT FOUND THEN
      IF v_scope NOT IN ('admin','org') THEN
        CONTINUE;
      END IF;
      SELECT r.* INTO v_rev FROM public.qcp_revisions r
       WHERE r.qcp_id = v_plan.id ORDER BY r.revision_no DESC LIMIT 1;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;
    END IF;

    v_jobs := COALESCE((SELECT array_agg(sj.job_id)
                          FROM public.nx_qcp_scope_job_ids(v_plan.id) sj),
                       ARRAY[]::uuid[]);

    -- ── DERIVED progress. Never stored, always recomputed, always scoped to
    --    the jobs this plan actually governs.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'stage_id',          s.id,
             'sequence_no',       s.sequence_no,
             'name',              s.name,
             'responsible_party', s.responsible_party,
             'template_ids',      COALESCE(tl.ids, '[]'::jsonb),
             'progress',          pr.rollup
           ) ORDER BY s.sequence_no), '[]'::jsonb)
      INTO v_stages
      FROM public.qcp_stages s
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(st.template_id ORDER BY st.template_id) AS ids
          FROM public.qcp_stage_templates st WHERE st.stage_id = s.id
      ) tl ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_build_object(
                 'points_total',    count(*),
                 'points_recorded', count(*) FILTER (WHERE d.recorded),
                 'points_passed',   count(*) FILTER (WHERE d.passed),
                 'points_failed',   count(*) FILTER (WHERE d.failed),
                 'points_blocking', count(*) FILTER (WHERE d.blocking),
                 'pct_complete',
                   CASE WHEN count(*) = 0 THEN 0
                        ELSE round(100.0 * count(*) FILTER (WHERE d.recorded) / count(*))::int
                   END) AS rollup
          FROM (
            SELECT
              EXISTS (SELECT 1 FROM public.itp_point_results r
                       WHERE r.point_id = pts.id AND r.job_id = ANY (v_jobs)
                         AND r.result <> 'pending')                              AS recorded,
              EXISTS (SELECT 1 FROM public.itp_point_results r
                       WHERE r.point_id = pts.id AND r.job_id = ANY (v_jobs)
                         AND r.result IN ('passed','waived','not_applicable'))   AS passed,
              EXISTS (SELECT 1 FROM public.itp_point_results r
                       WHERE r.point_id = pts.id AND r.job_id = ANY (v_jobs)
                         AND r.result = 'failed')                                AS failed,
              (pts.blocks_progress AND NOT EXISTS (
                 SELECT 1 FROM public.itp_point_results r
                  WHERE r.point_id = pts.id AND r.job_id = ANY (v_jobs)
                    AND (r.result IN ('passed','waived','not_applicable')
                         OR r.released_at IS NOT NULL)))                         AS blocking
            FROM (SELECT DISTINCT ip.id, ip.blocks_progress
                    FROM public.qcp_stage_templates st2
                    JOIN public.itp_points ip
                      ON ip.template_id = st2.template_id AND ip.is_active
                   WHERE st2.stage_id = s.id) pts
          ) d
      ) pr ON true
     WHERE s.revision_id = v_rev.id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id',                  d.id,
             'label',               d.label,
             'document_id',         d.document_id,
             'is_mandatory',        d.is_mandatory,
             'acceptance_criteria', d.acceptance_criteria,
             'is_supplied',         d.document_id IS NOT NULL
           ) ORDER BY d.is_mandatory DESC, d.label), '[]'::jsonb)
      INTO v_docs
      FROM public.qcp_required_documents d WHERE d.revision_id = v_rev.id;

    SELECT jsonb_build_object(
             'jobs_in_scope',   cardinality(v_jobs),
             'points_total',    count(*),
             'points_recorded', count(*) FILTER (WHERE d.recorded),
             'points_passed',   count(*) FILTER (WHERE d.passed),
             'points_failed',   count(*) FILTER (WHERE d.failed),
             'points_blocking', count(*) FILTER (WHERE d.blocking),
             'pct_complete',
               CASE WHEN count(*) = 0 THEN 0
                    ELSE round(100.0 * count(*) FILTER (WHERE d.recorded) / count(*))::int
               END,
             'documents_required',
               (SELECT count(*) FROM public.qcp_required_documents rd
                 WHERE rd.revision_id = v_rev.id AND rd.is_mandatory),
             'documents_supplied',
               (SELECT count(*) FROM public.qcp_required_documents rd
                 WHERE rd.revision_id = v_rev.id AND rd.is_mandatory
                   AND rd.document_id IS NOT NULL))
      INTO v_prog
      FROM (
        SELECT
          EXISTS (SELECT 1 FROM public.itp_point_results r
                   WHERE r.point_id = pts.id AND r.job_id = ANY (v_jobs)
                     AND r.result <> 'pending')                              AS recorded,
          EXISTS (SELECT 1 FROM public.itp_point_results r
                   WHERE r.point_id = pts.id AND r.job_id = ANY (v_jobs)
                     AND r.result IN ('passed','waived','not_applicable'))   AS passed,
          EXISTS (SELECT 1 FROM public.itp_point_results r
                   WHERE r.point_id = pts.id AND r.job_id = ANY (v_jobs)
                     AND r.result = 'failed')                                AS failed,
          (pts.blocks_progress AND NOT EXISTS (
             SELECT 1 FROM public.itp_point_results r
              WHERE r.point_id = pts.id AND r.job_id = ANY (v_jobs)
                AND (r.result IN ('passed','waived','not_applicable')
                     OR r.released_at IS NOT NULL)))                         AS blocking
        FROM (SELECT DISTINCT ip.id, ip.blocks_progress
                FROM public.qcp_stages s3
                JOIN public.qcp_stage_templates st3 ON st3.stage_id = s3.id
                JOIN public.itp_points ip
                  ON ip.template_id = st3.template_id AND ip.is_active
               WHERE s3.revision_id = v_rev.id) pts
      ) d;

    -- ── Supplier redaction. The inspected party reads its own obligations:
    --    status, applicable standards and required documents. Not the internal
    --    scope, not the procedures, not the stage orchestration, not progress,
    --    and never another supplier's plan (that is already excluded above).
    IF v_scope = 'supplier' THEN
      qcp_id := v_plan.id; title := v_plan.title;
      organization_id := v_plan.organization_id; supplier_id := v_plan.supplier_id;
      revision_id := v_rev.id; revision_no := v_rev.revision_no; status := v_rev.status;
      quality_scope := NULL; standards := v_rev.standards; procedures := NULL;
      supersedes_id := NULL; approved_by := NULL; approved_at := v_rev.approved_at;
      viewer_scope := v_scope; stages := '[]'::jsonb;
      required_documents := v_docs; progress := NULL;
    ELSE
      qcp_id := v_plan.id; title := v_plan.title;
      organization_id := v_plan.organization_id; supplier_id := v_plan.supplier_id;
      revision_id := v_rev.id; revision_no := v_rev.revision_no; status := v_rev.status;
      quality_scope := v_rev.quality_scope; standards := v_rev.standards;
      procedures := v_rev.procedures; supersedes_id := v_rev.supersedes_id;
      approved_by := v_rev.approved_by; approved_at := v_rev.approved_at;
      viewer_scope := v_scope; stages := v_stages;
      required_documents := v_docs; progress := v_prog;
    END IF;

    RETURN NEXT;
  END LOOP;
END $fn$;

ALTER FUNCTION public.nx_project_qcp(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_project_qcp(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_project_qcp(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_project_qcp(uuid) IS
  'The effective quality plan for a project: current revision, stages, the scope templates each stage orchestrates, the required documents, and progress DERIVED at read time from itp_point_results through qcp_stage_templates to itp_points. No progress is stored anywhere. Returns no money column; the scope template is referenced by id only. An unauthorised caller receives no rows rather than an error, and a supplier receives obligations only.';

-- ── 5.7 nx_qcp_revision_history ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nx_qcp_revision_history(p_qcp_id uuid)
RETURNS TABLE (
  revision_id     uuid,
  revision_no     int,
  status          text,
  supersedes_id   uuid,
  superseded_by   uuid,
  quality_scope   text,
  standards       text[],
  procedures      text,
  approved_by     uuid,
  approved_at     timestamptz,
  created_by      uuid,
  created_at      timestamptz,
  stage_count     int,
  template_link_count int,
  required_document_count int
)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING errcode = '28000';
  END IF;

  SELECT q.organization_id INTO v_org
    FROM public.quality_control_plans q WHERE q.id = p_qcp_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'quality plan not found' USING errcode = 'P0002';
  END IF;

  -- History is the authoring organization's record. An inspector reads the
  -- effective revision through nx_project_qcp; a supplier reads its own
  -- obligations. Neither reads what a plan used to say.
  IF NOT public.nx_qcp_org_reader(v_org, auth.uid()) THEN
    RAISE EXCEPTION 'not authorized to read this plan history' USING errcode = '42501';
  END IF;

  RETURN QUERY
    SELECT r.id, r.revision_no, r.status, r.supersedes_id,
           (SELECT n.id FROM public.qcp_revisions n WHERE n.supersedes_id = r.id LIMIT 1),
           r.quality_scope, r.standards, r.procedures,
           r.approved_by, r.approved_at, r.created_by, r.created_at,
           (SELECT count(*)::int FROM public.qcp_stages s WHERE s.revision_id = r.id),
           (SELECT count(*)::int FROM public.qcp_stage_templates st
              JOIN public.qcp_stages s2 ON s2.id = st.stage_id
             WHERE s2.revision_id = r.id),
           (SELECT count(*)::int FROM public.qcp_required_documents d
             WHERE d.revision_id = r.id)
      FROM public.qcp_revisions r
     WHERE r.qcp_id = p_qcp_id
     ORDER BY r.revision_no;
END $fn$;

ALTER FUNCTION public.nx_qcp_revision_history(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nx_qcp_revision_history(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nx_qcp_revision_history(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.nx_qcp_revision_history(uuid) IS
  'The full append-preserved history of a plan, every revision including superseded ones, with what each revision orchestrated. Organization-scoped: history is the authoring tenant''s record, so an inspector and a supplier are refused. Returns no money column.';

-- ════════════════════════════════════════════════════════════════════════════
--  6) SELF-TESTS
--
--  NOTE FOR FUTURE EDITORS, inherited from 20260801400000: pg_get_functiondef()
--  includes the function's OWN in-body comments. Nothing written INSIDE any
--  function body above may contain a token the money scan below searches for,
--  or the scan matches its own explanation and the deploy fails for no reason.
--  This has bitten this repository twice.
-- ════════════════════════════════════════════════════════════════════════════
DO $test$
DECLARE
  v_money constant text :=
    '\m(payout|wallet|escrow|transactions|admin_confirmed_at|base_price_cents|release_payment|stripe|price)\M';
  v_cents constant text := '\m[a-z_]*_cents\M';
  v_tbl  text;
  v_fn   text;
  v_def  text;
  v_cfg  text;
  v_name text;
  v_n    int;
  v_tables constant text[] := ARRAY[
    'quality_control_plans','qcp_revisions','qcp_stages',
    'qcp_stage_templates','qcp_required_documents'];
  v_rpcs constant text[] := ARRAY[
    'public.nx_qcp_create(uuid,text,uuid)',
    'public.nx_qcp_add_revision(uuid)',
    'public.nx_qcp_submit_revision(uuid)',
    'public.nx_qcp_approve_revision(uuid,text)',
    'public.nx_qcp_set_stage_templates(uuid,uuid[])',
    'public.nx_project_qcp(uuid)',
    'public.nx_qcp_revision_history(uuid)'];
BEGIN
  -- ══ THE SCHEMA EXISTS AND IS LOCKED DOWN ══════════════════════════════════
  FOREACH v_tbl IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      RAISE EXCEPTION 'SELFTEST FAILED: table % was not created', v_tbl;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public'
                    AND tablename = v_tbl AND rowsecurity) THEN
      RAISE EXCEPTION 'SELFTEST FAILED: RLS is not enabled on %', v_tbl;
    END IF;
    -- ★ THE 402000 LESSON. A write grant here would reopen the forgery surface
    --   that lockdown closed, because ALTER DEFAULT PRIVILEGES hands ALL to
    --   authenticated on every new public table.
    IF has_table_privilege('authenticated', 'public.' || v_tbl, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_tbl, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_tbl, 'DELETE') THEN
      RAISE EXCEPTION
        'SELFTEST FAILED: authenticated holds a write grant on % — every write must go through an RPC', v_tbl;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || v_tbl, 'SELECT') THEN
      RAISE EXCEPTION 'SELFTEST FAILED: authenticated cannot read % — the register would go blank', v_tbl;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_tbl, 'SELECT') THEN
      RAISE EXCEPTION 'SELFTEST FAILED: anon can read %', v_tbl;
    END IF;
    -- No write POLICY either, so there is no policy that authorises a row
    -- while pinning no column.
    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname='public' AND tablename = v_tbl
                  AND cmd IN ('INSERT','UPDATE','DELETE','ALL')) THEN
      RAISE EXCEPTION 'SELFTEST FAILED: % carries a write policy', v_tbl;
    END IF;
    -- ══ PROGRESS IS DERIVED, NEVER STORED ═══════════════════════════════════
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name = v_tbl
                  AND (column_name ILIKE '%progress%' OR column_name ILIKE '%percent%'
                       OR column_name ILIKE '%completion%')) THEN
      RAISE EXCEPTION 'SELFTEST FAILED: % stores progress — progress is derived at read time', v_tbl;
    END IF;
  END LOOP;

  -- ══ QCP ORCHESTRATES; IT DOES NOT OWN POINTS ══════════════════════════════
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='qcp_stage_templates';
  IF v_n <> 3 THEN
    RAISE EXCEPTION
      'SELFTEST FAILED: qcp_stage_templates has % columns — it is a LINK row (id, stage_id, template_id) and a fourth column means point data is being copied', v_n;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='qcp_stage_templates'
       AND column_name='template_id') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: qcp_stage_templates does not link a scope template';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class f ON f.oid = c.confrelid
     WHERE t.relname='qcp_stage_templates' AND c.contype='f'
       AND f.relname='inspection_scope_templates') THEN
    RAISE EXCEPTION
      'SELFTEST FAILED: qcp_stage_templates does not reference inspection_scope_templates — QCP would be a second template system';
  END IF;
  -- No ITP concept may be duplicated into any QCP table.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name LIKE 'qcp\_%'
                AND column_name IN ('point_type','blocks_progress','requires_signoff',
                                    'evidence_requirement_id','requirement',
                                    'reference_document','witnessed_by','signed_off_by')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP table duplicates an ITP point concept — that is ITP v2';
  END IF;
  IF to_regclass('public.itp_points') IS NULL
     OR to_regclass('public.itp_point_results') IS NULL
     OR to_regclass('public.inspection_scope_templates') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the ITP spine QCP orchestrates is missing';
  END IF;

  -- ══ NO SECOND NCR PATH, NO PROJECTS V2, NO DOCUMENT STORE ═════════════════
  IF to_regclass('public.qcp_ncrs') IS NOT NULL
     OR to_regclass('public.qcp_nonconformances') IS NOT NULL
     OR to_regclass('public.qcp_documents') IS NOT NULL
     OR to_regclass('public.qcp_points') IS NOT NULL
     OR to_regclass('public.qcp_templates') IS NOT NULL
     OR to_regclass('public.projects_v2') IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a parallel NCR, point, template, document or project table exists';
  END IF;
  IF to_regclass('public.flash_reports') IS NULL
     OR to_regprocedure('public.nx_raise_ncr_from_itp_point(uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the existing NCR path QCP reuses is gone';
  END IF;

  -- ══ THE APPEND-PRESERVING MACHINE ═════════════════════════════════════════
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public'
                  AND indexname='qcp_revisions_one_approved_idx') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: nothing guarantees exactly one effective revision per plan';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_qcp_revision_state' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an approved revision is editable — history is not append-preserving';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_qcp_stages_draft_only' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
                     WHERE tgname='trg_qcp_stage_templates_draft_only' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the stages of an approved revision are still editable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname='trg_qcp_org_matches_project' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a plan could be filed under another tenant';
  END IF;
  v_def := pg_get_functiondef('public.tg_qcp_revision_state()'::regprocedure);
  IF position('QCP_REVISION_IMMUTABLE' IN v_def) = 0
     OR position('superseded' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the revision immutability rule is not in the trigger';
  END IF;

  -- ══ THE SEVEN RPCs, HARDENED IDENTICALLY ══════════════════════════════════
  FOREACH v_fn IN ARRAY v_rpcs LOOP
    IF to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'SELFTEST FAILED: the frozen RPC % is missing', v_fn;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION 'SELFTEST FAILED: % is not SECURITY DEFINER', v_fn;
    END IF;
    IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = v_fn::regprocedure) <> 'postgres' THEN
      RAISE EXCEPTION 'SELFTEST FAILED: % is not owned by postgres', v_fn;
    END IF;
    -- Matched loosely on purpose: PostgreSQL normalises the stored GUC string
    -- differently for `SET search_path = public, pg_temp` and
    -- `SET search_path TO 'public','pg_temp'`, and a deploy must not fail over
    -- quoting. What matters is that the path is pinned to exactly these two.
    SELECT array_to_string(proconfig, ',') INTO v_cfg
      FROM pg_proc WHERE oid = v_fn::regprocedure;
    IF v_cfg IS NULL OR v_cfg !~ 'search_path'
       OR v_cfg !~ 'public' OR v_cfg !~ 'pg_temp' THEN
      RAISE EXCEPTION 'SELFTEST FAILED: % does not pin its search path to public, pg_temp', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'SELFTEST FAILED: anon can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn::regprocedure, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'SELFTEST FAILED: % is not callable by the application', v_fn;
    END IF;
  END LOOP;

  -- The internal job-scope predicate must NOT be handed to the client.
  IF has_function_privilege('authenticated', 'public.nx_qcp_scope_job_ids(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.nx_qcp_scope_job_ids(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the internal job-scope predicate is directly callable — that is an enumeration oracle';
  END IF;

  -- ══ MONEY: NO PRICE, NO PAYMENT SIDE EFFECT, ANYWHERE IN QCP ══════════════
  v_n := 0;
  FOR v_name, v_fn, v_def IN
    SELECT p.proname, p.oid::regprocedure::text, pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND (p.proname LIKE 'nx\_qcp\_%' OR p.proname LIKE 'tg\_qcp\_%'
            OR p.proname = 'nx_project_qcp' OR p.proname = 'tg_touch_qcp')
  LOOP
    v_n := v_n + 1;
    IF v_def ~* v_money THEN
      RAISE EXCEPTION 'SELFTEST FAILED: QCP function % names a money surface', v_fn;
    END IF;
    IF v_def ~* v_cents THEN
      RAISE EXCEPTION 'SELFTEST FAILED: QCP function % names a currency-amount column', v_fn;
    END IF;
    -- Reporting reads; the readers must not write.
    IF v_name IN ('nx_project_qcp', 'nx_qcp_revision_history') THEN
      IF v_def ~* '\m(INSERT|UPDATE|DELETE)\s+(INTO\s+)?public\.' THEN
        RAISE EXCEPTION 'SELFTEST FAILED: the QCP reader % writes', v_fn;
      END IF;
    END IF;
  END LOOP;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'SELFTEST FAILED: the money scan matched no QCP function — the guard is not actually running';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.parameters
     WHERE specific_schema = 'public'
       AND (parameter_name ILIKE '%_cents%'
            OR parameter_name ILIKE '%price%'
            OR parameter_name ILIKE '%payout%'
            OR parameter_name ILIKE '%spread%')
       AND (specific_name LIKE 'nx_qcp%' OR specific_name LIKE 'nx_project_qcp%')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP function exposes a money column';
  END IF;
  IF (SELECT provolatile FROM pg_proc WHERE oid = 'public.nx_project_qcp(uuid)'::regprocedure) <> 's'
     OR (SELECT provolatile FROM pg_proc
          WHERE oid = 'public.nx_qcp_revision_history(uuid)'::regprocedure) <> 's' THEN
    RAISE EXCEPTION 'SELFTEST FAILED: a QCP reader is not STABLE — it could acquire a side effect';
  END IF;
  -- The orphaned report state machine must stay unattached: it completes the
  -- job on approval, which fires settlement. Re-pinned here because QCP adds an
  -- approval verb of its own and must never be wired to that one.
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc  f ON f.oid = t.tgfoid
     WHERE NOT t.tgisinternal
       AND c.relname = 'inspection_reports'
       AND f.proname IN ('handle_inspection_report_state_machine',
                         'handle_report_status_change',
                         'handle_report_submission')) THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an orphaned report state machine is attached — an approval would auto-complete the job';
  END IF;

  -- ══ THE THINGS QCP MUST NOT HAVE DISTURBED ════════════════════════════════
  IF to_regprocedure('public.nx_job_itp(uuid,uuid)') IS NULL
     OR to_regprocedure('public.nx_itp_record_result(uuid,uuid,text,uuid,text,text)') IS NULL
     OR to_regprocedure('public.nx_itp_release_hold(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'SELFTEST FAILED: an ITP RPC was disturbed by the QCP migration';
  END IF;
  IF has_table_privilege('authenticated', 'public.itp_point_results', 'INSERT') THEN
    RAISE EXCEPTION 'REGRESSION: authenticated regained INSERT on itp_point_results — 20260801402000 was undone';
  END IF;

  RAISE NOTICE 'QCP foundation ready: orchestration-only template links, append-preserving revisions, SELECT-only tables, seven definer RPCs, derived progress, money-free.';
END
$test$;

COMMIT;

NOTIFY pgrst, 'reload schema';
