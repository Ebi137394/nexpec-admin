'use server';
// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/inspectionAdmin.ts — Admin actions for the Inspection Marketplace
//  identity-disclosure + inspector-replacement feature (Workflow A only).
//
//  Thin wrappers over the SECURITY DEFINER RPCs (which enforce admin-only authz,
//  validation, locking, audit, and notifications in the DB):
//    • admin_set_project_policy   → identity_mode + replacement_mode
//    • admin_void_contract        → void with required reason
//    • admin_replace_inspector    → void-and-reissue in one transaction
//    • admin_search_assignable_inspectors / admin_assign_inspector_directly
//                                 → book a known inspector who never applied
//    • nx_match_inspectors_for_job → RANKED recommendations (additive to the
//                                    name search, which is preserved)
//  Disclosure/authorization decisions live in the DB, never here.
// ════════════════════════════════════════════════════════════════════════════
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface AssignableInspector {
  id: string;
  fullName: string | null;
  email: string | null;
  headline: string | null;
  locationCity: string | null;
  ratingAverage: number | null;
  /** ADMIN-ONLY. Drives the override warning; never reaches a client surface. */
  isVerified: boolean;
  /** ADMIN-ONLY. 'admin'/'super_admin' when the inspector is also a platform admin. */
  role: string | null;
  /** ADMIN-ONLY. True when this row is the signed-in admin (self-assignment). */
  isSelf: boolean;
}

/**
 * A ranked candidate from the deterministic matching engine (20260801358000).
 *
 * This is ADDITIVE to AssignableInspector, not a replacement: name search
 * answers "find the person I already have in mind", recommendations answer
 * "who should I even be considering". Both remain available in the UI.
 *
 * Every number here is a MATCH score, never money — the ranking RPC reads no
 * pricing column at all, so this type cannot carry a payout or a margin.
 */
export interface RecommendedInspector {
  id: string;
  fullName: string | null;
  /** 0–100, deterministic and reproducible. */
  score: number;
  /** Sub-scores, so an admin can see WHY — never a black box. */
  specialtyPts: number;
  certPts: number;
  distancePts: number;
  /** Null when the job or the inspector has no coordinates. */
  distanceKm: number | null;
  /** Flag only. Deliberately NOT a filter — the admin decides. */
  workAuthorized: boolean;
  isVerified: boolean;
  ratingAverage: number | null;
  completedJobs: number | null;
  /** Human-readable justifications, e.g. 'covers 2/2 discipline(s)'. */
  reasons: string[];
}

export async function setProjectPolicy(
  jobId: string,
  identityMode: 'protected' | 'professional' | 'full',
  replacementMode: 'client_reapproval' | 'admin_authorized',
): Promise<ActionResult> {
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('admin_set_project_policy', {
      p_job_id: jobId,
      p_identity_mode: identityMode,
      p_replacement_mode: replacementMode,
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/admin/jobs/${jobId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
}

export async function voidContract(
  jobId: string,
  contractId: string,
  reason: string,
): Promise<ActionResult> {
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: 'A reason is required to void a contract.' };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('admin_void_contract', {
      p_contract_id: contractId,
      p_reason: reason.trim(),
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/admin/jobs/${jobId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
}

// ── Direct assignment ───────────────────────────────────────────────────────
//  Both RPCs are admin-gated inside their own function bodies, so these
//  wrappers add no authorization of their own — they must not, or the two
//  layers could drift.

/** Verified inspectors eligible for direct assignment. Admin-only server side. */
export async function searchAssignableInspectors(
  query: string,
  includeUnverified = false,
): Promise<{ ok: true; inspectors: AssignableInspector[] } | { ok: false; error: string }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('admin_search_assignable_inspectors', {
      p_query: query.trim() === '' ? null : query.trim(),
      p_limit: 20,
      p_include_unverified: includeUnverified,
    });
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return {
      ok: true,
      inspectors: rows.map((r) => ({
        id: String(r.id),
        fullName: (r.full_name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        headline: (r.headline as string | null) ?? null,
        locationCity: (r.location_city as string | null) ?? null,
        ratingAverage: r.rating_average === null || r.rating_average === undefined
          ? null
          : Number(r.rating_average),
        isVerified: Boolean(r.is_verified),
        role: (r.role as string | null) ?? null,
        isSelf: Boolean(r.is_self),
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
}

/**
 * Ranked inspector recommendations for a job.
 *
 * Complements searchAssignableInspectors — it does not replace it. Search is
 * for "I know who I want"; this is for "who should I consider". The RPC is
 * admin-gated in its own body, so this wrapper adds no authorization of its own
 * (the two layers must not drift).
 *
 * `includeUnverified` surfaces unverified inspectors so the existing admin
 * override path stays reachable; they are excluded by default.
 */
export async function recommendInspectorsForJob(
  jobId: string,
  limit = 10,
  includeUnverified = false,
): Promise<{ ok: true; inspectors: RecommendedInspector[] } | { ok: false; error: string }> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc('nx_match_inspectors_for_job', {
      p_job_id: jobId,
      p_limit: limit,
      p_include_unverified: includeUnverified,
    });
    if (error) return { ok: false, error: error.message };

    const num = (v: unknown): number | null =>
      v === null || v === undefined ? null : Number(v);

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return {
      ok: true,
      inspectors: rows.map((r) => ({
        id: String(r.inspector_id),
        fullName: (r.full_name as string | null) ?? null,
        score: Number(r.score ?? 0),
        specialtyPts: Number(r.specialty_pts ?? 0),
        certPts: Number(r.cert_pts ?? 0),
        distancePts: Number(r.distance_pts ?? 0),
        distanceKm: num(r.distance_km),
        workAuthorized: Boolean(r.work_authorized),
        isVerified: Boolean(r.is_verified),
        ratingAverage: num(r.rating),
        completedJobs: num(r.completed_jobs),
        reasons: Array.isArray(r.reasons) ? (r.reasons as string[]) : [],
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
}

/**
 * Book a known inspector who never applied.
 *
 * The RPC manufactures the applications row the hire pipeline already expects
 * and then delegates to admin_dispatch_job / admin_replace_inspector, so the
 * client-facing workflow, notifications and contract steps are byte-for-byte
 * the ordinary ones. Nothing here is client-visible.
 */
export async function assignInspectorDirectly(
  jobId: string,
  inspectorId: string,
  clientPriceCents: number,
  inspectorPayoutCents: number,
  reason: string,
): Promise<ActionResult> {
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: 'A reason is required for a direct assignment.' };
  }
  if (
    !Number.isFinite(clientPriceCents) || !Number.isFinite(inspectorPayoutCents) ||
    clientPriceCents <= 0 || inspectorPayoutCents <= 0
  ) {
    return { ok: false, error: 'Client price and inspector payout must both be greater than zero.' };
  }
  if (inspectorPayoutCents > clientPriceCents) {
    return { ok: false, error: 'Inspector payout cannot exceed the client price.' };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('admin_assign_inspector_directly', {
      p_job_id: jobId,
      p_inspector_id: inspectorId,
      p_client_price_cents: Math.round(clientPriceCents),
      p_inspector_payout_cents: Math.round(inspectorPayoutCents),
      p_reason: reason.trim(),
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/admin/jobs/${jobId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
}

export async function replaceInspector(
  jobId: string,
  newApplicationId: string,
  clientPriceCents: number,
  inspectorPayoutCents: number,
  reason: string,
): Promise<ActionResult> {
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: 'A reason is required to replace an inspector.' };
  }
  if (!Number.isFinite(clientPriceCents) || !Number.isFinite(inspectorPayoutCents) || clientPriceCents < 0 || inspectorPayoutCents < 0) {
    return { ok: false, error: 'Prices must be non-negative.' };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.rpc('admin_replace_inspector', {
      p_job_id: jobId,
      p_new_application_id: newApplicationId,
      p_client_price_cents: Math.round(clientPriceCents),
      p_inspector_payout_cents: Math.round(inspectorPayoutCents),
      p_reason: reason.trim(),
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath(`/admin/jobs/${jobId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unexpected error' };
  }
}
