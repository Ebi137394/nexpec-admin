// ════════════════════════════════════════════════════════════════════════════
//  lib/data/qcp.ts — reading the Quality Control Plan
//
//  QCP is the governing quality document binding a project (and where relevant
//  an organization and a supplier) to a set of scope templates, stages,
//  responsibilities, required documents and approvals, under an
//  append-preserving revision. It ORCHESTRATES: a revision selects existing
//  inspection_scope_templates rows and the ITP points arrive with them through
//  itp_points.template_id. Nothing here copies a point, a stage or an
//  acceptance criterion out of the template spine — there is one template
//  system, not two.
//
//  ── MONEY: STRUCTURALLY ABSENT ─────────────────────────────────────────────
//  inspection_scope_templates carries base_price_cents. It is a price column on
//  a table QCP joins, and NOTHING in the QCP surface may select, join, return
//  or render it. Every read below names its columns explicitly; there is no
//  select('*') in this file and QcpScopeTemplateOption has no price field, so
//  there is nowhere for a price to land even by accident. The admin scope
//  template library (lib/data/scopeTemplates.ts) does project it — that is why
//  this file has its OWN template reader rather than reusing that one.
//
//  ── WHY SOME READS ARE PLAIN SELECTS ───────────────────────────────────────
//  The frozen contract (§3) provides exactly two readers: nx_project_qcp, which
//  answers "what is the effective plan for this project", and
//  nx_qcp_revision_history, which answers "what has this plan been". It
//  provides no list reader and no reader for a revision that is NOT yet
//  effective — and a draft is precisely the revision an author is working on.
//  §3 also states the tables get SELECT to authenticated and no INSERT/UPDATE
//  grant, so a SELECT is the sanctioned way to read them and RLS remains the
//  authority. The plain reads below therefore fill the structural gap and only
//  the structural gap; they never re-derive status, effectiveness or progress,
//  all of which come from the canonical readers.
//
//  ── EVERY WRITE IS AN RPC ──────────────────────────────────────────────────
//  There is no write of any kind in this file. Mutations live in
//  lib/actions/qcp.ts and go through the canonical RPCs, without exception.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

// ════════════════════════════════════════════════════════════════════════════
//  Canonical RPC names — frozen contract §3
//
//  Written as a local const rather than added to @nexpec/shared-core: this lane
//  owns apps/web/src/lib/{data,actions}/qcp*.ts and nothing in packages/, and a
//  cross-lane edit during a parallel build is how two agents produce one
//  conflict. When QCP gains a mobile or offline consumer this block is the
//  thing to lift into shared-core/domain/qcp.ts, exactly as ITP_RPC was.
//
//  ARGUMENT NAMING. §3 lists the arguments bare (`nx_qcp_create(project_id,
//  title, supplier_id)`). Every nx_* function in this repository takes p_-
//  prefixed named arguments — nx_job_itp(p_job_id, p_visit_id),
//  nx_itp_record_result(p_point_id, …) — and Supabase's .rpc() passes arguments
//  BY NAME, so the prefix is load-bearing, not cosmetic. The p_ form is used
//  below and reported to the Lead as the one place this surface had to read an
//  intent into the contract rather than a literal.
// ════════════════════════════════════════════════════════════════════════════
export const QCP_RPC = {
  /** (p_project_id uuid, p_title text, p_supplier_id uuid) → plan + revision 1 draft */
  create: 'nx_qcp_create',
  /** (p_qcp_id uuid) → clones the approved revision into a new draft */
  addRevision: 'nx_qcp_add_revision',
  /** (p_revision_id uuid) → draft → under_review */
  submitRevision: 'nx_qcp_submit_revision',
  /** (p_revision_id uuid, p_note text) → under_review → approved, supersedes atomically */
  approveRevision: 'nx_qcp_approve_revision',
  /** (p_stage_id uuid, p_template_ids uuid[]) → draft-only */
  setStageTemplates: 'nx_qcp_set_stage_templates',
  /** (p_project_id uuid) → effective revision + stages + template links + progress */
  projectQcp: 'nx_project_qcp',
  /** (p_qcp_id uuid) → full append-preserved history */
  revisionHistory: 'nx_qcp_revision_history',
} as const;

/**
 * The reader names, written as literals and tied back to QCP_RPC by
 * `satisfies`.
 *
 * Two guards need different things and this satisfies both, exactly as
 * lib/data/jobItp.ts does it: TypeScript fails the build if a literal ever
 * drifts from the frozen contract, and scripts/qa/check-db-refs.mjs — which
 * scans for `.rpc('<literal>')` and cannot resolve a constant — still checks
 * each name against the migrations, so QCP code cannot ship ahead of the QCP
 * schema.
 */
const RPC_PROJECT_QCP = 'nx_project_qcp' satisfies typeof QCP_RPC.projectQcp;
const RPC_REVISION_HISTORY =
  'nx_qcp_revision_history' satisfies typeof QCP_RPC.revisionHistory;

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const QCP_REVISION_STATUSES = [
  'draft', 'under_review', 'approved', 'superseded',
] as const;
export type QcpRevisionStatus = (typeof QCP_REVISION_STATUSES)[number];

export const QCP_STATUS_LABELS: Record<QcpRevisionStatus, string> = {
  draft: 'Draft',
  under_review: 'Under review',
  approved: 'Approved',
  superseded: 'Superseded',
};

/** One line of plain English per state, for the surfaces that explain the plan. */
export const QCP_STATUS_MEANING: Record<QcpRevisionStatus, string> = {
  draft: 'Being authored. Stages and template selections can still change.',
  under_review: 'Submitted for approval. Content is settled; awaiting a decision.',
  approved: 'Effective and immutable. Amending means issuing the next revision.',
  superseded: 'Replaced by a later approved revision. Kept for the audit trail.',
};

export function coerceQcpStatus(v: unknown): QcpRevisionStatus {
  return typeof v === 'string' &&
    (QCP_REVISION_STATUSES as readonly string[]).includes(v)
    ? (v as QcpRevisionStatus)
    : 'draft';
}

/**
 * Whether a revision may still be authored.
 *
 * COSMETIC ONLY, like canOfferHoldRelease on the ITP surface. The frozen
 * contract makes approved and superseded rows immutable with a trigger, and
 * nx_qcp_set_stage_templates is draft-only in its own body; this predicate only
 * stops the UI drawing a control the database would refuse. It is deliberately
 * a status test and NOT a role test — role is the caller's to supply, because
 * §4 gives Inspector and Supplier read access to a draft's parent plan while
 * refusing them every write on it.
 */
export function isQcpRevisionEditable(status: QcpRevisionStatus): boolean {
  return status === 'draft';
}

// ── Row shapes ──────────────────────────────────────────────────────────────

/** Plan identity. There is NO status here: a QCP is an identity, not a state. */
export interface QcpPlan {
  id: string;
  projectId: string;
  organizationId: string;
  supplierId: string | null;
  title: string;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface QcpRevision {
  id: string;
  qcpId: string;
  revisionNo: number;
  status: QcpRevisionStatus;
  qualityScope: string | null;
  standards: string[];
  procedures: string | null;
  supersedesId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string;
  createdAt: string | null;
}

export interface QcpStage {
  id: string;
  revisionId: string;
  sequenceNo: number;
  name: string;
  responsibleParty: string | null;
}

/** The orchestration row. Carries a template reference and no point data. */
export interface QcpStageTemplateLink {
  id: string;
  stageId: string;
  templateId: string;
}

export interface QcpRequiredDocument {
  id: string;
  revisionId: string;
  label: string;
  documentId: string | null;
  isMandatory: boolean;
  acceptanceCriteria: string | null;
}

/**
 * A scope template as the QCP author sees it.
 *
 * NOTE WHAT IS MISSING: there is no price field, and no validityMonths either
 * (validity is a certificate property, not a plan property). Adding a price
 * here would be the defect the frozen contract's money warning exists to
 * prevent, so the type itself refuses it.
 */
export interface QcpScopeTemplateOption {
  id: string;
  slug: string;
  name: string;
  version: number;
  category: string;
  region: string;
  requiresCredentialTier: string;
  description: string | null;
  isActive: boolean;
}

/** Read-only ITP consequence of a template selection. QCP owns none of this. */
export interface QcpItpPointSummary {
  templateId: string;
  pointCount: number;
  holdCount: number;
  witnessCount: number;
  signoffCount: number;
  stages: string[];
}

/** Project + organization + supplier context for a plan header. */
export interface QcpContext {
  projectName: string | null;
  projectStatus: string | null;
  organizationName: string | null;
  organizationKind: string | null;
  supplierName: string | null;
  supplierCompany: string | null;
}

/** Derived at read time by nx_project_qcp. Never stored, never recomputed here. */
export interface QcpProgress {
  totalPoints: number | null;
  recordedPoints: number | null;
  passedPoints: number | null;
  failedPoints: number | null;
  outstandingPoints: number | null;
  /** False when the reader projected no progress columns at all. */
  reported: boolean;
}

/** A plan as it appears in the list, with the state of its newest revision. */
export interface QcpListItem extends QcpPlan {
  projectName: string | null;
  organizationName: string | null;
  latestRevisionNo: number | null;
  latestStatus: QcpRevisionStatus | null;
  effectiveRevisionNo: number | null;
  revisionCount: number;
}

// ── Tolerant field access ───────────────────────────────────────────────────
//
// nx_project_qcp and nx_qcp_revision_history are Agent 1's to shape and are
// being written in parallel with this file. The contract fixes WHAT they return
// (§3) and the column vocabulary (§2) but not whether the reader flattens a
// revision into the top level, nests it, or returns a jsonb document. These
// helpers read a value under any of several spellings and degrade to null
// rather than throwing, so a projection that names a field slightly differently
// costs a blank line on the page instead of a 500. Every fallback is a spelling
// of the SAME contract column — none of them invents a field the contract does
// not have.

type Row = Record<string, unknown>;

function asRow(v: unknown): Row {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
}

function pick(r: Row, ...keys: string[]): unknown {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  return null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/** text[] arrives as a real array from PostgREST; a lone string is tolerated. */
function strArray(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  }
  if (typeof v === 'string' && v.trim() !== '') return [v.trim()];
  return [];
}

function rowsOf(data: unknown): Row[] {
  if (Array.isArray(data)) return data.map(asRow);
  if (data && typeof data === 'object') {
    // A jsonb-returning reader may wrap the set: { revisions: [...] } etc.
    const r = asRow(data);
    for (const key of ['revisions', 'rows', 'items', 'stages', 'data']) {
      if (Array.isArray(r[key])) return (r[key] as unknown[]).map(asRow);
    }
    return [r];
  }
  return [];
}

function mapRevision(r: Row): QcpRevision {
  return {
    id: String(pick(r, 'id', 'revision_id') ?? ''),
    qcpId: String(pick(r, 'qcp_id', 'plan_id') ?? ''),
    revisionNo: num(pick(r, 'revision_no', 'revision')) ?? 0,
    status: coerceQcpStatus(pick(r, 'status', 'revision_status')),
    qualityScope: str(pick(r, 'quality_scope')),
    standards: strArray(pick(r, 'standards')),
    procedures: str(pick(r, 'procedures')),
    supersedesId: str(pick(r, 'supersedes_id')),
    approvedBy: str(pick(r, 'approved_by')),
    approvedAt: str(pick(r, 'approved_at')),
    createdBy: String(pick(r, 'created_by') ?? ''),
    createdAt: str(pick(r, 'created_at')),
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  CANONICAL READERS (§3)
// ════════════════════════════════════════════════════════════════════════════

export interface ProjectQcpRead {
  /** The revision the reader considers effective, when it names one. */
  effectiveRevision: QcpRevision | null;
  /** Stage rows the reader projected alongside it, when it projects any. */
  stages: QcpStage[];
  /** Template links the reader projected, when it projects any. */
  stageTemplates: QcpStageTemplateLink[];
  progress: QcpProgress;
  /** True when the RPC answered at all. False plus a message means it did not. */
  ok: boolean;
  unauthorized: boolean;
  message: string | null;
}

const EMPTY_PROGRESS: QcpProgress = {
  totalPoints: null,
  recordedPoints: null,
  passedPoints: null,
  failedPoints: null,
  outstandingPoints: null,
  reported: false,
};

/**
 * The effective plan for a project, and the progress derived from it.
 *
 * NON-THROWING, deliberately: this decorates a page that has already rendered a
 * plan header, and §4 refuses several audiences outright (an inspector not
 * engaged on the project, a supplier who is not the named supplier). A throw
 * there would take a working admin page down over a section that person should
 * simply not see — the same distinction readJobItp preserves.
 *
 * Progress is NOT computed here. §2 forbids storing it and derives it at read
 * time from itp_point_results through qcp_stage_templates → itp_points; if the
 * reader projects no progress columns, `reported` is false and the surface says
 * so rather than showing a fabricated zero.
 */
export async function readProjectQcp(projectId: string): Promise<ProjectQcpRead> {
  const empty: ProjectQcpRead = {
    effectiveRevision: null,
    stages: [],
    stageTemplates: [],
    progress: EMPTY_PROGRESS,
    ok: false,
    unauthorized: false,
    message: null,
  };
  if (!projectId) return empty;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_PROJECT_QCP, {
      p_project_id: projectId,
    });
    if (error) {
      const unauthorized =
        /not authori[sz]ed|42501|not_authenticated|28000/i.test(error.message);
      if (!unauthorized) console.error('[qcp] nx_project_qcp failed:', error.message);
      return { ...empty, unauthorized, message: error.message };
    }

    const rows = rowsOf(data);
    const head = rows[0] ?? {};

    // The revision may be flattened onto the row or nested under a key. Both
    // spellings are read; neither is invented.
    const revisionSource = asRow(
      pick(head, 'revision', 'effective_revision', 'current_revision'),
    );
    const revisionRow = Object.keys(revisionSource).length > 0 ? revisionSource : head;
    const revisionId = str(pick(revisionRow, 'id', 'revision_id'));
    const effectiveRevision = revisionId ? mapRevision(revisionRow) : null;

    const stageRows = Array.isArray(pick(head, 'stages'))
      ? (pick(head, 'stages') as unknown[]).map(asRow)
      : [];
    const stages: QcpStage[] = stageRows.map((s) => ({
      id: String(pick(s, 'id', 'stage_id') ?? ''),
      revisionId: String(pick(s, 'revision_id') ?? revisionId ?? ''),
      sequenceNo: num(pick(s, 'sequence_no')) ?? 0,
      name: String(pick(s, 'name', 'stage_name') ?? ''),
      responsibleParty: str(pick(s, 'responsible_party')),
    }));

    const linkRows = Array.isArray(pick(head, 'stage_templates', 'templates'))
      ? (pick(head, 'stage_templates', 'templates') as unknown[]).map(asRow)
      : [];
    const stageTemplates: QcpStageTemplateLink[] = linkRows.map((l) => ({
      id: String(pick(l, 'id') ?? ''),
      stageId: String(pick(l, 'stage_id') ?? ''),
      templateId: String(pick(l, 'template_id') ?? ''),
    }));

    const progressSource = asRow(pick(head, 'progress'));
    const p = Object.keys(progressSource).length > 0 ? progressSource : head;
    const totalPoints = num(pick(p, 'total_points', 'points_total', 'total'));
    const recordedPoints = num(pick(p, 'recorded_points', 'points_recorded', 'recorded'));
    const passedPoints = num(pick(p, 'passed_points', 'points_passed', 'passed'));
    const failedPoints = num(pick(p, 'failed_points', 'points_failed', 'failed'));
    const outstandingPoints = num(
      pick(p, 'outstanding_points', 'points_outstanding', 'outstanding'),
    );
    const reported =
      totalPoints !== null || recordedPoints !== null || passedPoints !== null ||
      failedPoints !== null || outstandingPoints !== null;

    return {
      effectiveRevision,
      stages,
      stageTemplates,
      progress: {
        totalPoints, recordedPoints, passedPoints, failedPoints,
        outstandingPoints, reported,
      },
      ok: true,
      unauthorized: false,
      message: null,
    };
  } catch (e) {
    return {
      ...empty,
      message: e instanceof Error ? e.message : 'unexpected error',
    };
  }
}

export interface QcpHistoryRead {
  revisions: QcpRevision[];
  ok: boolean;
  unauthorized: boolean;
  message: string | null;
}

/**
 * Every revision this plan has ever had, newest first.
 *
 * The history is append-preserved — a superseded revision is kept, not deleted
 * — so this is the audit trail, not a changelog. It is sorted here only for
 * display; the ordering carries no meaning the revision numbers do not already.
 */
export async function readQcpRevisionHistory(qcpId: string): Promise<QcpHistoryRead> {
  if (!qcpId) {
    return { revisions: [], ok: false, unauthorized: false, message: null };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_REVISION_HISTORY, {
      p_qcp_id: qcpId,
    });
    if (error) {
      const unauthorized =
        /not authori[sz]ed|42501|not_authenticated|28000/i.test(error.message);
      if (!unauthorized) {
        console.error('[qcp] nx_qcp_revision_history failed:', error.message);
      }
      return { revisions: [], ok: false, unauthorized, message: error.message };
    }
    const revisions = rowsOf(data)
      .map(mapRevision)
      .filter((r) => r.id !== '')
      .sort((a, b) => b.revisionNo - a.revisionNo);
    return { revisions, ok: true, unauthorized: false, message: null };
  } catch (e) {
    return {
      revisions: [],
      ok: false,
      unauthorized: false,
      message: e instanceof Error ? e.message : 'unexpected error',
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  STRUCTURAL READS — the gaps in the canonical reader surface, and no more
//
//  SELECT only, against relations §3 grants SELECT to authenticated and whose
//  RLS admits the §4 audience. None of these re-derives status, effectiveness
//  or progress; each degrades to an empty result rather than taking a page down.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The plan list.
 *
 * There is no list RPC in §3, and a governing document nobody can find is not a
 * governing document. Two queries rather than a PostgREST embed: qcp_revisions
 * has two foreign keys (qcp_id and the self-referential supersedes_id), and an
 * ambiguous embed hint is a runtime error rather than a compile one.
 */
export async function fetchAdminQcpList(opts: {
  status?: QcpRevisionStatus;
  projectId?: string;
  organizationId?: string;
  limit?: number;
} = {}): Promise<QcpListItem[]> {
  try {
    const supabase = await createSupabaseServerClient();

    let q = supabase
      .from('quality_control_plans')
      .select(
        'id, project_id, organization_id, supplier_id, title, created_by, created_at, updated_at',
      )
      .order('updated_at', { ascending: false })
      .limit(opts.limit ?? 200);
    if (opts.projectId) q = q.eq('project_id', opts.projectId);
    if (opts.organizationId) q = q.eq('organization_id', opts.organizationId);

    const { data, error } = await q;
    if (error || !data) {
      if (error) console.warn('[qcp] plan list failed:', error.message);
      return [];
    }

    const plans: QcpPlan[] = (data as unknown as Row[]).map((r) => ({
      id: String(r.id ?? ''),
      projectId: String(r.project_id ?? ''),
      organizationId: String(r.organization_id ?? ''),
      supplierId: str(r.supplier_id),
      title: String(r.title ?? ''),
      createdBy: String(r.created_by ?? ''),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
    }));
    if (plans.length === 0) return [];

    const ids = plans.map((p) => p.id);
    const [revRes, projectNames, orgNames] = await Promise.all([
      supabase
        .from('qcp_revisions')
        .select('id, qcp_id, revision_no, status')
        .in('qcp_id', ids),
      fetchProjectNames(plans.map((p) => p.projectId)),
      fetchOrganizationNames(plans.map((p) => p.organizationId)),
    ]);

    const byPlan = new Map<string, Array<{ no: number; status: QcpRevisionStatus }>>();
    if (revRes.error) {
      console.warn('[qcp] revision summary failed:', revRes.error.message);
    }
    for (const r of ((revRes.data ?? []) as unknown as Row[])) {
      const key = String(r.qcp_id ?? '');
      if (!key) continue;
      const list = byPlan.get(key) ?? [];
      list.push({ no: num(r.revision_no) ?? 0, status: coerceQcpStatus(r.status) });
      byPlan.set(key, list);
    }

    const out = plans.map((p) => {
      const revs = (byPlan.get(p.id) ?? []).sort((a, b) => b.no - a.no);
      const latest = revs[0] ?? null;
      // "Effective" is the approved one, and the schema's partial unique index
      // guarantees there is at most one — this picks it, it does not decide it.
      const effective = revs.find((r) => r.status === 'approved') ?? null;
      return {
        ...p,
        projectName: projectNames.get(p.projectId) ?? null,
        organizationName: orgNames.get(p.organizationId) ?? null,
        latestRevisionNo: latest?.no ?? null,
        latestStatus: latest?.status ?? null,
        effectiveRevisionNo: effective?.no ?? null,
        revisionCount: revs.length,
      } satisfies QcpListItem;
    });

    return opts.status ? out.filter((p) => p.latestStatus === opts.status) : out;
  } catch (e) {
    console.warn('[qcp] plan list threw:', e);
    return [];
  }
}

export async function fetchQcpPlan(qcpId: string): Promise<QcpPlan | null> {
  if (!qcpId) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('quality_control_plans')
      .select(
        'id, project_id, organization_id, supplier_id, title, created_by, created_at, updated_at',
      )
      .eq('id', qcpId)
      .maybeSingle();
    if (error || !data) {
      if (error) console.warn('[qcp] plan read failed:', error.message);
      return null;
    }
    const r = data as unknown as Row;
    return {
      id: String(r.id ?? ''),
      projectId: String(r.project_id ?? ''),
      organizationId: String(r.organization_id ?? ''),
      supplierId: str(r.supplier_id),
      title: String(r.title ?? ''),
      createdBy: String(r.created_by ?? ''),
      createdAt: str(r.created_at),
      updatedAt: str(r.updated_at),
    };
  } catch (e) {
    console.warn('[qcp] plan read threw:', e);
    return null;
  }
}

/**
 * Every revision of a plan, read structurally.
 *
 * The canonical history reader is preferred and is what the page shows; this
 * exists because the author needs the FULL body (quality scope, standards,
 * procedures) of a DRAFT revision, which no §3 reader projects — nx_project_qcp
 * answers only for the effective revision, and a draft is by definition not it.
 */
export async function fetchQcpRevisions(qcpId: string): Promise<QcpRevision[]> {
  if (!qcpId) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('qcp_revisions')
      .select(
        'id, qcp_id, revision_no, status, quality_scope, standards, procedures, supersedes_id, approved_by, approved_at, created_by, created_at',
      )
      .eq('qcp_id', qcpId)
      .order('revision_no', { ascending: false });
    if (error || !data) {
      if (error) console.warn('[qcp] revisions read failed:', error.message);
      return [];
    }
    return (data as unknown as Row[]).map(mapRevision);
  } catch (e) {
    console.warn('[qcp] revisions read threw:', e);
    return [];
  }
}

export interface QcpRevisionBody {
  stages: QcpStage[];
  /** templateIds selected on each stage, keyed by stage id. */
  templatesByStage: Map<string, string[]>;
  requiredDocuments: QcpRequiredDocument[];
}

/**
 * Stages, their template links and the required documents of ONE revision.
 *
 * Three reads rather than an embed, for the same ambiguity reason as the list.
 * A failure in any one degrades that section to empty; the revision header has
 * already loaded and must not be lost with it.
 */
export async function fetchQcpRevisionBody(revisionId: string): Promise<QcpRevisionBody> {
  const empty: QcpRevisionBody = {
    stages: [],
    templatesByStage: new Map(),
    requiredDocuments: [],
  };
  if (!revisionId) return empty;

  try {
    const supabase = await createSupabaseServerClient();
    const [stageRes, docRes] = await Promise.all([
      supabase
        .from('qcp_stages')
        .select('id, revision_id, sequence_no, name, responsible_party')
        .eq('revision_id', revisionId)
        .order('sequence_no', { ascending: true }),
      supabase
        .from('qcp_required_documents')
        .select('id, revision_id, label, document_id, is_mandatory, acceptance_criteria')
        .eq('revision_id', revisionId)
        .order('label', { ascending: true }),
    ]);

    if (stageRes.error) console.warn('[qcp] stages read failed:', stageRes.error.message);
    if (docRes.error) console.warn('[qcp] required documents read failed:', docRes.error.message);

    const stages: QcpStage[] = ((stageRes.data ?? []) as unknown as Row[]).map((s) => ({
      id: String(s.id ?? ''),
      revisionId: String(s.revision_id ?? revisionId),
      sequenceNo: num(s.sequence_no) ?? 0,
      name: String(s.name ?? ''),
      responsibleParty: str(s.responsible_party),
    }));

    const requiredDocuments: QcpRequiredDocument[] = (
      (docRes.data ?? []) as unknown as Row[]
    ).map((d) => ({
      id: String(d.id ?? ''),
      revisionId: String(d.revision_id ?? revisionId),
      label: String(d.label ?? ''),
      documentId: str(d.document_id),
      isMandatory: d.is_mandatory !== false,
      acceptanceCriteria: str(d.acceptance_criteria),
    }));

    const templatesByStage = new Map<string, string[]>();
    const stageIds = stages.map((s) => s.id).filter(Boolean);
    if (stageIds.length > 0) {
      const { data, error } = await supabase
        .from('qcp_stage_templates')
        .select('id, stage_id, template_id')
        .in('stage_id', stageIds);
      if (error) {
        console.warn('[qcp] stage template links read failed:', error.message);
      }
      for (const l of ((data ?? []) as unknown as Row[])) {
        const stageId = String(l.stage_id ?? '');
        const templateId = String(l.template_id ?? '');
        if (!stageId || !templateId) continue;
        const list = templatesByStage.get(stageId) ?? [];
        list.push(templateId);
        templatesByStage.set(stageId, list);
      }
    }

    return { stages, templatesByStage, requiredDocuments };
  } catch (e) {
    console.warn('[qcp] revision body threw:', e);
    return empty;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  SCOPE TEMPLATES — the price-blind projection
// ════════════════════════════════════════════════════════════════════════════

/**
 * The templates a QCP revision may select, WITHOUT base_price_cents.
 *
 * lib/data/scopeTemplates.ts already reads this table and deliberately projects
 * the price, because the compliance library is a commercial catalogue. QCP is
 * not: it is a quality document, its readers include suppliers and inspectors,
 * and the frozen contract forbids any QCP surface from selecting or joining
 * that column. Reusing the existing fetcher would have carried the price into
 * this lane's wire payload, so this reader names its nine columns and stops.
 *
 * Inactive templates are still returned when asked for, because a revision
 * approved last year may reference one that has since been retired and the plan
 * must still render honestly.
 */
export async function fetchQcpScopeTemplateOptions(opts: {
  activeOnly?: boolean;
  category?: string;
  ids?: readonly string[];
  limit?: number;
} = {}): Promise<QcpScopeTemplateOption[]> {
  try {
    const supabase = await createSupabaseServerClient();
    let q = supabase
      .from('inspection_scope_templates')
      // EXPLICIT COLUMNS. Never select('*') here — base_price_cents lives on
      // this table and a star select would put a price on a quality surface.
      .select(
        'id, slug, name, version, category, region, requires_credential_tier, description_md, is_active',
      )
      .order('category', { ascending: true })
      .order('name', { ascending: true })
      .limit(opts.limit ?? 300);

    if (opts.activeOnly) q = q.eq('is_active', true);
    if (opts.category) q = q.eq('category', opts.category);
    if (opts.ids) {
      const ids = [...new Set(opts.ids.filter(Boolean))];
      if (ids.length === 0) return [];
      q = q.in('id', ids);
    }

    const { data, error } = await q;
    if (error || !data) {
      if (error) console.warn('[qcp] scope template options failed:', error.message);
      return [];
    }
    return (data as unknown as Row[]).map((r) => ({
      id: String(r.id ?? ''),
      slug: String(r.slug ?? ''),
      name: String(r.name ?? ''),
      version: num(r.version) ?? 1,
      category: String(r.category ?? ''),
      region: String(r.region ?? 'global'),
      requiresCredentialTier: String(r.requires_credential_tier ?? 'cci_basic'),
      description: str(r.description_md),
      isActive: r.is_active !== false,
    }));
  } catch (e) {
    console.warn('[qcp] scope template options threw:', e);
    return [];
  }
}

/**
 * What the selected templates BRING WITH THEM, read only.
 *
 * This is the "resulting ITP" the plan orchestrates. It is summarised rather
 * than restated: the points belong to itp_points via template_id and are
 * authored on the template, not on the QCP, so this surface may show how many
 * arrive and of what kind but must never offer to edit one. Counting hold /
 * witness / sign-off points here is a count of DEFINITION rows — it is not the
 * ITP's live blocking state, which only nx_job_itp may answer, per the frozen
 * ITP contract.
 */
export async function fetchQcpItpSummary(
  templateIds: readonly string[],
): Promise<Map<string, QcpItpPointSummary>> {
  const out = new Map<string, QcpItpPointSummary>();
  const ids = [...new Set(templateIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('itp_points')
      .select('id, template_id, stage, point_type, blocks_progress, requires_signoff, is_active')
      .in('template_id', ids)
      .eq('is_active', true);
    if (error || !data) {
      if (error) console.warn('[qcp] ITP summary failed:', error.message);
      return out;
    }
    for (const r of (data as unknown as Row[])) {
      const templateId = String(r.template_id ?? '');
      if (!templateId) continue;
      const cur = out.get(templateId) ?? {
        templateId,
        pointCount: 0,
        holdCount: 0,
        witnessCount: 0,
        signoffCount: 0,
        stages: [],
      };
      cur.pointCount += 1;
      if (r.point_type === 'hold' || r.blocks_progress === true) cur.holdCount += 1;
      if (r.point_type === 'witness') cur.witnessCount += 1;
      if (r.requires_signoff === true) cur.signoffCount += 1;
      const stage = str(r.stage);
      if (stage && !cur.stages.includes(stage)) cur.stages.push(stage);
      out.set(templateId, cur);
    }
    for (const s of out.values()) s.stages.sort();
    return out;
  } catch (e) {
    console.warn('[qcp] ITP summary threw:', e);
    return out;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CONTEXT — project, organization, supplier, linked documents
// ════════════════════════════════════════════════════════════════════════════

export async function fetchProjectNames(
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(projectIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('projects')
      .select('id, name')
      .in('id', ids);
    if (error || !data) return out;
    for (const r of (data as unknown as Row[])) {
      out.set(String(r.id), String(r.name ?? ''));
    }
    return out;
  } catch {
    return out;
  }
}

export async function fetchOrganizationNames(
  orgIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(orgIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('organizations')
      .select('id, name')
      .in('id', ids);
    if (error || !data) return out;
    for (const r of (data as unknown as Row[])) {
      out.set(String(r.id), String(r.name ?? ''));
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * The three parties a plan header names.
 *
 * organization_id is denormalised from the project and a trigger enforces they
 * agree (§2), so this reads both and shows both — if they ever disagree the
 * header will say so rather than quietly picking one.
 */
export async function fetchQcpContext(plan: QcpPlan): Promise<QcpContext> {
  const out: QcpContext = {
    projectName: null,
    projectStatus: null,
    organizationName: null,
    organizationKind: null,
    supplierName: null,
    supplierCompany: null,
  };
  try {
    const supabase = await createSupabaseServerClient();
    const [projectRes, orgRes, supplierRes] = await Promise.all([
      plan.projectId
        ? supabase
            .from('projects')
            .select('id, name, status, organization_id')
            .eq('id', plan.projectId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      plan.organizationId
        ? supabase
            .from('organizations')
            .select('id, name, kind')
            .eq('id', plan.organizationId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      plan.supplierId
        ? supabase
            .from('profiles')
            .select('id, full_name, company_name')
            .eq('id', plan.supplierId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const proj = asRow(projectRes.data);
    out.projectName = str(proj.name);
    out.projectStatus = str(proj.status);

    const org = asRow(orgRes.data);
    out.organizationName = str(org.name);
    out.organizationKind = str(org.kind);

    const sup = asRow(supplierRes.data);
    out.supplierName = str(sup.full_name);
    out.supplierCompany = str(sup.company_name);

    return out;
  } catch (e) {
    console.warn('[qcp] context read threw:', e);
    return out;
  }
}

/** Titles for documents a revision already links, so a label is not a bare uuid. */
export async function fetchQcpDocumentTitles(
  documentIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(documentIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('documents')
      .select('id, title, file_type, uploaded_at')
      .in('id', ids);
    if (error || !data) {
      if (error) console.warn('[qcp] document titles failed:', error.message);
      return out;
    }
    for (const r of (data as unknown as Row[])) {
      out.set(String(r.id), String(r.title ?? ''));
    }
    return out;
  } catch {
    return out;
  }
}

/** Display names for the authors and approvers a revision names. */
export async function fetchQcpActorNames(
  userIds: readonly string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return out;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    if (error || !data) return out;
    for (const r of (data as unknown as Row[])) {
      out.set(String(r.id), str(r.full_name));
    }
    return out;
  } catch {
    return out;
  }
}

// ── Pickers for the create form ─────────────────────────────────────────────

export interface QcpProjectOption {
  id: string;
  name: string;
  status: string | null;
  organizationId: string;
  organizationName: string | null;
}

export interface QcpSupplierOption {
  id: string;
  name: string;
  companyName: string | null;
}

/**
 * Projects a QCP may be created against.
 *
 * Admin-surface only. public.projects carries NO row-level security policy in
 * the baseline, so this read is safe behind the /admin gate and would be a
 * cross-organization leak on any surface that is not. That is reported to the
 * Lead rather than patched here — this lane owns no migration.
 */
export async function fetchQcpProjectOptions(limit = 200): Promise<QcpProjectOption[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('projects')
      .select('id, name, status, organization_id')
      .order('name', { ascending: true })
      .limit(limit);
    if (error || !data) {
      if (error) console.warn('[qcp] project options failed:', error.message);
      return [];
    }
    const rows = data as unknown as Row[];
    const orgNames = await fetchOrganizationNames(
      rows.map((r) => String(r.organization_id ?? '')),
    );
    return rows.map((r) => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      status: str(r.status),
      organizationId: String(r.organization_id ?? ''),
      organizationName: orgNames.get(String(r.organization_id ?? '')) ?? null,
    }));
  } catch (e) {
    console.warn('[qcp] project options threw:', e);
    return [];
  }
}

/**
 * Suppliers a QCP may name as the inspected party.
 *
 * supplier_id is nullable in §2 and means "the inspected party, optional" — a
 * supplier is NOT a buyer on this platform, so naming one here binds the party
 * being inspected, never the party paying. Nothing about this selection has a
 * commercial effect.
 */
export async function fetchQcpSupplierOptions(limit = 200): Promise<QcpSupplierOption[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, company_name, role')
      .eq('role', 'supplier')
      .order('full_name', { ascending: true })
      .limit(limit);
    if (error || !data) {
      if (error) console.warn('[qcp] supplier options failed:', error.message);
      return [];
    }
    return (data as unknown as Row[]).map((r) => ({
      id: String(r.id ?? ''),
      name: str(r.full_name) ?? str(r.company_name) ?? 'Unnamed supplier',
      companyName: str(r.company_name),
    }));
  } catch (e) {
    console.warn('[qcp] supplier options threw:', e);
    return [];
  }
}

// ── Formatting shared by the QCP surfaces ───────────────────────────────────

export function formatQcpDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
