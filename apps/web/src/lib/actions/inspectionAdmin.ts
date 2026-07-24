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
//  Disclosure/authorization decisions live in the DB, never here.
// ════════════════════════════════════════════════════════════════════════════
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type ActionResult = { ok: true } | { ok: false; error: string };

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
