// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientReports.ts — list reports the admin has forwarded to client
//
//  GOLDEN_RULE_6 — only jobs where admin_confirmed_at IS NOT NULL surface
//  here. If the report is still on admin's desk (inspector submitted but
//  admin hasn't approved + forwarded), it does NOT appear yet.
//
//  GOLDEN_RULE_2 — projection deliberately excludes inspector payout +
//  spread fields. We do include client_price_cents (the client's final
//  price, admin-set) since that's the client's own money.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ClientReportRow } from './clientReports.types';

export type { ClientReportRow };

export async function fetchClientReports(): Promise<ClientReportRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    // 1. Jobs admin has handed off (admin_confirmed_at IS NOT NULL).
    //    Filter to current client + soft-deleted exclusion.
    //    GOLDEN_RULE_2 — explicit projection, no inspector_payout / spread.
    const { data: rawJobs, error } = await supabase
      .from('jobs_secure_view')
      .select(
        'id, title, hired_inspector_id, contractor_id, admin_confirmed_at, status, updated_at, client_price_cents, payout_status',
      )
      .eq('client_id', user.id)
      .not('admin_confirmed_at', 'is', null)
      .is('deleted_at', null)
      .order('admin_confirmed_at', { ascending: false })
      .limit(200);

    if (error || !rawJobs) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchClientReports] jobs query failed:', error.message);
      }
      return [];
    }

    if (rawJobs.length === 0) return [];

    // 2. Hydrate inspector names. Prefer hired_inspector_id, fall back to
    //    contractor_id — different parts of the codebase historically used
    //    either. Both reference auth.users; we read full_name from profiles.
    const inspectorIds = new Set<string>();
    for (const j of rawJobs) {
      const hid = (j.hired_inspector_id as string | null) ?? null;
      const cid = (j.contractor_id as string | null) ?? null;
      if (hid) inspectorIds.add(hid);
      else if (cid) inspectorIds.add(cid);
    }

    const inspectorNameById = new Map<string, string | null>();
    if (inspectorIds.size > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', Array.from(inspectorIds));
      for (const p of profs ?? []) {
        inspectorNameById.set(
          (p as Record<string, unknown>).id as string,
          ((p as Record<string, unknown>).full_name as string | null) ?? null,
        );
      }
    }

    return rawJobs.map((row): ClientReportRow => {
      const j = row as unknown as Record<string, unknown>;
      const inspectorId =
        ((j.hired_inspector_id as string | null) ?? null) ||
        ((j.contractor_id as string | null) ?? null);
      return {
        jobId: String(j.id),
        jobTitle: String(j.title ?? '(untitled)'),
        inspectorId,
        inspectorFullName: inspectorId
          ? inspectorNameById.get(inspectorId) ?? null
          : null,
        adminConfirmedAt: (j.admin_confirmed_at as string | null) ?? null,
        completedAt:
          (j.status as string) === 'completed'
            ? ((j.updated_at as string | null) ?? null)
            : null,
        clientPriceCents:
          typeof j.client_price_cents === 'string'
            ? Number(j.client_price_cents)
            : (j.client_price_cents as number | null) ?? null,
        payoutStatus: (j.payout_status as string | null) ?? null,
      };
    });
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchClientReports] threw:', e);
    }
    return [];
  }
}
