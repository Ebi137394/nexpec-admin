// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectionAdminPanel.ts — server data for the Inspection Marketplace
//  admin controls (identity mode / replacement / void). Used by the admin Jobs
//  Moderation drawer (/admin/jobs?inspect=…) and the /admin/jobs/[id] page.
//
//  FAIL-SAFE: every read is guarded. If the release migrations
//  (20260801284000…290000) are NOT applied on the connected Supabase project,
//  the new columns/RPCs don't exist → the jobs read throws → we return
//  { available:false } so the caller can show a hint instead of crashing.
// ════════════════════════════════════════════════════════════════════════════
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type IdentityMode = 'protected' | 'professional' | 'full';
export type ReplacementMode = 'client_reapproval' | 'admin_authorized';

export interface InspectionAdminPanelData {
  available: boolean;        // false ⇒ columns/RPCs missing (migrations not applied)
  isInspectionJob: boolean;  // false ⇒ RFQ/brokered job → no controls
  jobStatus: string;
  identityMode: IdentityMode;
  replacementMode: ReplacementMode;
  /**
   * ★ 2026-08-06 — null when the job carries NO agreed client price yet.
   * Previously coerced to 0, which the panel rendered as "Client price
   * (preserved) 0.00" and then submitted verbatim to admin_replace_inspector,
   * whose envelope check (`p_client_price_cents <> COALESCE(job, old_contract,
   * p)`) would either reject it or — with no prior contract — mint a
   * replacement contract at a $0 client price. Unknown must stay unknown.
   */
  clientPriceCents: number | null;
  activeContract: { id: string; status: string; clientApprovalType: string } | null;
  applications: { id: string; applicantLabel: string; status: string }[];
}

/**
 * Returns the data for InspectionMarketplaceAdminPanel, or a sentinel when the
 * feature can't render:
 *   { available:false } → migrations not applied on this project.
 *   { available:true, isInspectionJob:false } → RFQ/brokered job (no controls).
 */
export async function getInspectionAdminPanelData(
  jobId: string,
): Promise<InspectionAdminPanelData | null> {
  try {
    const supabase = await createSupabaseServerClient();

    // Reading identity_mode/replacement_mode forces the "is it migrated?" check.
    const { data: job, error: jobErr } = await supabase
      .from('jobs_secure_view')
      .select('id, source_rfq_id, identity_mode, replacement_mode, client_price_cents, status, contractor_id')
      .eq('id', jobId)
      .maybeSingle();

    if (jobErr || !job) {
      // A missing-column error (PostgREST 42703) lands here → not migrated yet.
      // Log it: this sentinel renders "migrations not applied", so a PERMISSION
      // or network failure would otherwise masquerade as a deployment problem.
      if (jobErr && typeof console !== 'undefined') {
        console.error('[getInspectionAdminPanelData] job read failed:', jobErr.code, jobErr.message);
      }
      return { available: false, isInspectionJob: false, jobStatus: '', identityMode: 'protected', replacementMode: 'client_reapproval', clientPriceCents: null, activeContract: null, applications: [] };
    }

    const base: InspectionAdminPanelData = {
      available: true,
      isInspectionJob: !job.source_rfq_id,
      jobStatus: String(job.status ?? ''),
      identityMode: ((job.identity_mode as string) ?? 'protected') as IdentityMode,
      replacementMode: ((job.replacement_mode as string) ?? 'client_reapproval') as ReplacementMode,
      clientPriceCents:
        job.client_price_cents === null || job.client_price_cents === undefined
          ? null
          : Number(job.client_price_cents),
      activeContract: null,
      applications: [],
    };

    // RFQ/brokered jobs never get inspection contracts → no controls.
    if (!base.isInspectionJob) return base;

    // Current active (non-voided) contract.
    const { data: ac } = await supabase
      .from('job_contracts')
      .select('id, status, client_approval_type, inspector_id')
      .eq('job_id', jobId)
      .neq('status', 'voided')
      .maybeSingle();
    if (ac) {
      base.activeContract = {
        id: String(ac.id),
        status: String(ac.status),
        clientApprovalType: String(ac.client_approval_type ?? 'client_signature'),
      };
    }

    // Eligible replacement applications (exclude the current inspector).
    const { data: apps } = await supabase
      .from('applications')
      .select('id, applicant_id, status')
      .eq('job_id', jobId)
      .not('status', 'in', '("rejected","withdrawn")');
    const rows = (apps ?? []) as Array<Record<string, unknown>>;
    const currentInspectorId = (job.contractor_id as string | null) || null;
    const applicantIds = Array.from(new Set(rows.map((r) => String(r.applicant_id))));
    const nameMap = new Map<string, string | null>();
    if (applicantIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', applicantIds);
      for (const p of (profs ?? []) as Array<Record<string, unknown>>) {
        nameMap.set(String(p.id), (p.full_name as string | null) ?? null);
      }
    }
    base.applications = rows
      .filter((r) => String(r.applicant_id) !== currentInspectorId)
      .map((r) => ({
        id: String(r.id),
        applicantLabel: nameMap.get(String(r.applicant_id)) ?? `Applicant ${String(r.applicant_id).slice(0, 8)}`,
        status: String(r.status),
      }));

    return base;
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.error('[getInspectionAdminPanelData] threw:', e);
    }
    return { available: false, isInspectionJob: false, jobStatus: '', identityMode: 'protected', replacementMode: 'client_reapproval', clientPriceCents: null, activeContract: null, applications: [] };
  }
}
