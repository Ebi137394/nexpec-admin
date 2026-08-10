'use server';
// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/qcp.ts — moving a Quality Control Plan through its lifecycle
//
//  Thin wrappers over the five canonical QCP mutation RPCs frozen in §3 of
//  docs/qcp-canonical-contract.md. There are no other writes: §3 grants the QCP
//  tables SELECT to authenticated and NO INSERT/UPDATE grant at all, which is
//  the 402000 lesson made structural — a policy that authorises a row while
//  pinning no column is a forgery surface, so every write goes through a
//  SECURITY DEFINER function that carries the invariants with it.
//
//  ── NO AUTHORIZATION HERE, DELIBERATELY ────────────────────────────────────
//  Each RPC decides in its own body against the §4 matrix, and the five do NOT
//  all decide the same thing: authoring is open to admin and the org principal,
//  approval is a narrower act, and set_stage_templates additionally refuses any
//  revision that is not a draft. Re-stating that here would create a second
//  opinion that can drift from the first. A page may use
//  isQcpRevisionEditable() to avoid DRAWING a control the database would
//  refuse, but that is cosmetic — this layer neither adds nor relaxes a check.
//
//  ── APPROVED REVISIONS ARE IMMUTABLE ───────────────────────────────────────
//  There is no update action in this file and there is no place to add one. A
//  trigger rejects any UPDATE to an approved or superseded row except the
//  single approved → superseded transition, and amending an approved revision
//  means calling addQcpRevision to insert N+1 with supersedes_id set. A surface
//  that offered an "edit approved plan" control would be lying about what the
//  database will do with it.
//
//  ── NO MONEY ───────────────────────────────────────────────────────────────
//  Creating, submitting, approving or superseding a revision moves nothing.
//  inspection_scope_templates.base_price_cents is never read, joined or
//  forwarded by any function here; selecting a template into a stage is a
//  quality decision with no commercial effect, and settlement stays manual.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { QCP_RPC } from '@/lib/data/qcp';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Mutation names as literals, tied back to QCP_RPC by `satisfies`.
 *
 * Same two guards lib/actions/jobItp.ts relies on: the build fails if a literal
 * drifts from the frozen contract, and scripts/qa/check-db-refs.mjs — which can
 * only see `.rpc('<literal>')` — still checks each name against the migrations,
 * so this surface cannot ship ahead of the QCP schema.
 */
const RPC_CREATE = 'nx_qcp_create' satisfies typeof QCP_RPC.create;
const RPC_ADD_REVISION = 'nx_qcp_add_revision' satisfies typeof QCP_RPC.addRevision;
const RPC_SUBMIT = 'nx_qcp_submit_revision' satisfies typeof QCP_RPC.submitRevision;
const RPC_APPROVE = 'nx_qcp_approve_revision' satisfies typeof QCP_RPC.approveRevision;
const RPC_SET_STAGE_TEMPLATES =
  'nx_qcp_set_stage_templates' satisfies typeof QCP_RPC.setStageTemplates;

export type QcpActionResult =
  | {
      ok: true;
      /** The plan this act landed on, when the RPC reports one. */
      qcpId?: string | null;
      /** The revision this act landed on, when the RPC reports one. */
      revisionId?: string | null;
      revisionNo?: number | null;
      status?: string | null;
      /** True when the RPC recognised the act as already done. */
      idempotent?: boolean;
    }
  | { ok: false; error: string };

type Row = Record<string, unknown>;

/**
 * Reads an id out of whatever shape the RPC returned.
 *
 * The frozen contract fixes the RPC names and arguments but not their return
 * projection, and Agent 1 is writing the migration in parallel with this file.
 * Tolerating `{qcp_id}`, `{id}` or a bare uuid string costs one function; a
 * hard assumption about the projection costs a broken redirect the first time
 * it is wrong. Every spelling accepted below is a spelling of the same §2
 * column — none invents a field the contract does not define.
 */
function readId(data: unknown, ...keys: string[]): string | null {
  if (typeof data === 'string' && data.length > 0) return data;
  const rows: unknown[] = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Row;
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
  }
  return null;
}

function readNumber(data: unknown, ...keys: string[]): number | null {
  const rows: unknown[] = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Row;
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return null;
}

function readString(data: unknown, ...keys: string[]): string | null {
  return readId(data, ...keys);
}

/**
 * Revalidation, always called AFTER the try/catch that made the change.
 *
 * A revalidation or redirect signal thrown inside a try block is the exact bug
 * that made admin approval fail with NEXT_REDIRECT earlier in this project, so
 * the placement in every action below is deliberate and must not be "tidied"
 * into the try.
 */
function revalidateQcp(qcpId?: string | null) {
  revalidatePath('/admin/compliance/qcp');
  if (qcpId) revalidatePath(`/admin/compliance/qcp/${qcpId}`);
}

// ════════════════════════════════════════════════════════════════════════════
//  1. Create — plan identity plus revision 1 in draft
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a plan for a project.
 *
 * The RPC creates BOTH the plan and revision 1 in `draft`, because a QCP with
 * no revision has no content and would be an identity nobody can author. The
 * organization is not passed: §2 denormalises it from the project and a trigger
 * enforces the two agree, so sending it from a form would only give the client
 * a way to disagree with the project.
 *
 * `supplierId` is optional and means "the inspected party". A supplier is not a
 * buyer here — naming one has no commercial effect whatsoever.
 */
export async function createQcp(
  projectId: string,
  title: string,
  supplierId?: string | null,
): Promise<QcpActionResult> {
  const trimmed = title.trim();
  if (!projectId) return { ok: false, error: 'Pick a project for this plan.' };
  if (trimmed.length < 3) {
    return { ok: false, error: 'Give the plan a title of at least 3 characters.' };
  }

  let qcpId: string | null = null;
  let revisionId: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_CREATE, {
      p_project_id: projectId,
      p_title: trimmed,
      p_supplier_id: supplierId?.trim() ? supplierId.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
    qcpId = readId(data, 'qcp_id', 'id', 'plan_id');
    revisionId = readId(data, 'revision_id');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateQcp(qcpId);
  return { ok: true, qcpId, revisionId, revisionNo: 1, status: 'draft' };
}

// ════════════════════════════════════════════════════════════════════════════
//  2. Add revision — the ONLY way to amend an approved plan
// ════════════════════════════════════════════════════════════════════════════

/**
 * Clone the current approved revision into a new draft.
 *
 * This is what "editing an approved QCP" actually is. The RPC sets
 * supersedes_id on the new draft so the chain is explicit, and the supersession
 * of the old revision happens on APPROVAL of the new one, not here — until then
 * the previously approved revision remains the effective one, which is the
 * whole point of an append-preserving model. Nothing is overwritten and nothing
 * is deleted.
 */
export async function addQcpRevision(qcpId: string): Promise<QcpActionResult> {
  if (!qcpId) return { ok: false, error: 'No plan identified.' };

  let revisionId: string | null = null;
  let revisionNo: number | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_ADD_REVISION, {
      p_qcp_id: qcpId,
    });
    if (error) return { ok: false, error: error.message };
    revisionId = readId(data, 'revision_id', 'id');
    revisionNo = readNumber(data, 'revision_no');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateQcp(qcpId);
  return { ok: true, qcpId, revisionId, revisionNo, status: 'draft' };
}

// ════════════════════════════════════════════════════════════════════════════
//  3. Submit — draft → under_review
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hand a draft to the reviewer.
 *
 * After this the revision is no longer a draft, and nx_qcp_set_stage_templates
 * — which is draft-only — will refuse it. That is intentional: review is
 * meaningless if the thing under review can still change underneath it. Getting
 * back to editable means the reviewer declines it, or a later revision is
 * opened; this surface does not offer a "withdraw" because §3 defines no RPC
 * for one, and a button that silently did nothing would be worse than the gap.
 *
 * `qcpId` is carried only so the page can be revalidated; it takes no part in
 * the decision.
 */
export async function submitQcpRevision(
  qcpId: string,
  revisionId: string,
): Promise<QcpActionResult> {
  if (!revisionId) return { ok: false, error: 'No revision identified.' };

  let status: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_SUBMIT, {
      p_revision_id: revisionId,
    });
    if (error) return { ok: false, error: error.message };
    status = readString(data, 'status');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateQcp(qcpId);
  return { ok: true, qcpId, revisionId, status: status ?? 'under_review' };
}

// ════════════════════════════════════════════════════════════════════════════
//  4. Approve — under_review → approved, superseding the prior effective one
// ════════════════════════════════════════════════════════════════════════════

/**
 * Approve a revision under review and make it the effective plan.
 *
 * Two things happen ATOMICALLY inside the RPC and neither is reproduced here:
 * the revision becomes approved, and the previously approved revision of the
 * same plan becomes superseded. A partial UNIQUE index on (qcp_id) WHERE status
 * = 'approved' means the database itself guarantees at most one effective
 * revision — so this wrapper never has to check, and must never try, whether
 * another one is already approved.
 *
 * The approval is the sign-off: §2 stamps approved_by and approved_at on the
 * row. There is no separate signature artefact and no second approval system.
 */
export async function approveQcpRevision(
  qcpId: string,
  revisionId: string,
  note?: string | null,
): Promise<QcpActionResult> {
  if (!revisionId) return { ok: false, error: 'No revision identified.' };

  let status: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc(RPC_APPROVE, {
      p_revision_id: revisionId,
      p_note: note?.trim() ? note.trim() : null,
    });
    if (error) return { ok: false, error: error.message };
    status = readString(data, 'status');
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateQcp(qcpId);
  return { ok: true, qcpId, revisionId, status: status ?? 'approved' };
}

// ════════════════════════════════════════════════════════════════════════════
//  5. Set stage templates — the orchestration act
// ════════════════════════════════════════════════════════════════════════════

/**
 * Replace the set of scope templates a stage orchestrates.
 *
 * SET, not add: the RPC takes the whole array and the qcp_stage_templates row
 * is a link and nothing more — no point, no stage and no acceptance criterion
 * is copied out of the template, so replacing the selection loses nothing that
 * was authored here. The ITP points arrive through itp_points.template_id and
 * continue to belong to the template.
 *
 * DRAFT ONLY. The RPC enforces it; isQcpRevisionEditable() lets the page avoid
 * drawing the control on a revision that is under review, approved or
 * superseded.
 *
 * NOTE WHAT IS NOT HERE: base_price_cents. The caller passes template ids it
 * obtained from fetchQcpScopeTemplateOptions, which does not project the price
 * column, so no price is read on the way in or on the way out.
 */
export async function setQcpStageTemplates(
  qcpId: string,
  stageId: string,
  templateIds: readonly string[],
): Promise<QcpActionResult> {
  if (!stageId) return { ok: false, error: 'No stage identified.' };

  // De-duplicated because qcp_stage_templates is UNIQUE (stage_id, template_id)
  // and a form that posted the same id twice would otherwise raise 23505 for a
  // selection the user made only once.
  const ids = [...new Set(templateIds.filter((t) => typeof t === 'string' && t.length > 0))];

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc(RPC_SET_STAGE_TEMPLATES, {
      p_stage_id: stageId,
      p_template_ids: ids,
    });
    if (error) return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
  revalidateQcp(qcpId);
  return { ok: true, qcpId };
}
