// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobsModeration.ts — bird's-eye job queue for super_admin
//
//  Pure types live in `./jobsModeration.types.ts` so client components can
//  type-import without dragging next/headers into the client bundle.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  ALL_JOB_STATUSES,
  type JobStatus,
} from '@nexpec/shared-core';
import type {
  ModerationJob,
  ModerationPageResult,
  ModerationQuery,
  ModerationJobDetail,
  ModerationTimelineEvent,
} from './jobsModeration.types';

// Re-export types for any consumer that still uses the legacy import path.
export type {
  ModerationJob,
  ModerationPageResult,
  ModerationQuery,
  ModerationJobDetail,
  ModerationTimelineEvent,
};

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function isJobStatus(v: string | undefined): v is JobStatus {
  if (!v) return false;
  return (ALL_JOB_STATUSES as readonly string[]).includes(v);
}

export async function fetchJobsModerationPage(
  query: ModerationQuery = {},
): Promise<ModerationPageResult> {
  try {
    const pageSize = Math.min(
      Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const page = Math.max(query.page ?? 1, 1);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const supabase = await createSupabaseServerClient();

    // Cascading SELECT — your tenant uses `location_city`, `inspector_id`,
    // `hired_inspector_id` (not the legacy `location` / `contractor_id`),
    // so try the canonical projection first and fall through if columns
    // don't exist.
    const WIDE =
      'id, title, location_city, status, created_at, updated_at, client_id, inspector_id, hired_inspector_id, client_price_cents, inspector_payout_cents, payout_amount_cents, payout_status, moderation_status';
    const MID =
      'id, title, location_city, status, created_at, updated_at, client_id, hired_inspector_id, client_price_cents, payout_amount_cents, moderation_status';
    const NARROW =
      'id, title, status, created_at, updated_at, client_id';

    const projections = [WIDE, MID, NARROW];
    let rawJobs: Array<Record<string, unknown>> | null = null;
    let count: number | null = null;

    for (const proj of projections) {
      let q = supabase
        .from('jobs')
        .select(proj, { count: 'exact' })
        .order('updated_at', { ascending: false })
        .range(from, to);
      if (query.status) q = q.eq('status', query.status);
      const { data, count: c, error } = await q;
      if (!error && data) {
        rawJobs = data as unknown as Array<Record<string, unknown>>;
        count = c ?? null;
        break;
      }
      if (error) {
        console.warn('[jobsModeration] page projection failed:', error.message);
      }
    }

    if (!rawJobs) {
      return { jobs: [], total: 0, page, pageSize, totalPages: 1 };
    }

    const profileIds = new Set<string>();
    for (const j of rawJobs) {
      if (j.client_id) profileIds.add(String(j.client_id));
      const inspectorAny = j.hired_inspector_id ?? j.inspector_id ?? j.contractor_id;
      if (inspectorAny) profileIds.add(String(inspectorAny));
    }

  const profileMap = new Map<string, string | null>();
  if (profileIds.size > 0) {
    const { data: profs, error: profsErr } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', Array.from(profileIds));
    if (!profsErr && profs) {
      for (const p of profs) {
        profileMap.set(p.id as string, (p.full_name as string | null) ?? null);
      }
    }
  }

    const jobs: ModerationJob[] = rawJobs.map((j) => {
      const inspectorId =
        (j.hired_inspector_id as string | null) ??
        (j.inspector_id as string | null) ??
        (j.contractor_id as string | null) ??
        null;
      return {
        id: String(j.id),
        title: (j.title as string | null) ?? null,
        location: ((j.location_city as string | null) ?? (j.location as string | null)) ?? null,
        status: j.status as JobStatus,
        created_at: (j.created_at as string | null) ?? null,
        updated_at: (j.updated_at as string | null) ?? null,
        client_id: (j.client_id as string | null) ?? null,
        client_name: j.client_id
          ? (profileMap.get(String(j.client_id)) ?? null)
          : null,
        contractor_id: inspectorId,
        contractor_name: inspectorId ? (profileMap.get(inspectorId) ?? null) : null,
        client_price_cents: (j.client_price_cents as number | null) ?? null,
        payout_amount_cents:
          ((j.inspector_payout_cents as number | null) ?? (j.payout_amount_cents as number | null)) ?? null,
        payout_status: (j.payout_status as string | null) ?? null,
      };
    });

    const total = count ?? jobs.length;
    return {
      jobs,
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[jobsModeration] threw:', e);
    }
    return {
      jobs: [],
      total: 0,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
      totalPages: 1,
    };
  }
}

export async function fetchModerationJob(
  jobId: string,
): Promise<ModerationJobDetail | null> {
  if (!jobId) return null;
  try {
    const supabase = await createSupabaseServerClient();

    const WIDE =
      'id, title, location_city, description, status, created_at, updated_at, client_id, inspector_id, hired_inspector_id, client_price_cents, inspector_payout_cents, payout_amount_cents, payout_status, moderation_status, moderation_reviewed_at, moderation_reviewed_by, moderation_notes';
    const MID =
      'id, title, location_city, description, status, created_at, updated_at, client_id, hired_inspector_id, client_price_cents, payout_amount_cents, moderation_status, moderation_notes';
    const NARROW =
      'id, title, description, status, created_at, updated_at, client_id, moderation_status';

    let j: Record<string, unknown> | null = null;
    for (const proj of [WIDE, MID, NARROW]) {
      const { data, error } = await supabase
        .from('jobs')
        .select(proj)
        .eq('id', jobId)
        .maybeSingle();
      if (!error && data) {
        j = data as unknown as Record<string, unknown>;
        break;
      }
      if (error) {
        console.warn('[fetchModerationJob projection]', error.message);
      }
    }
    if (!j) return null;

    const ids: string[] = [];
    if (j.client_id) ids.push(String(j.client_id));
    const inspectorAny =
      j.hired_inspector_id ?? j.inspector_id ?? j.contractor_id ?? null;
    if (inspectorAny) ids.push(String(inspectorAny));

    const profileMap = new Map<
      string,
      { name: string | null; email: string | null }
    >();
    if (ids.length > 0) {
      try {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', ids);
        for (const p of (profs ?? []) as Array<Record<string, unknown>>) {
          profileMap.set(String(p.id), {
            name: (p.full_name as string | null) ?? null,
            email: (p.email as string | null) ?? null,
          });
        }
      } catch {
        /* ignore */
      }
    }

    const client = j.client_id ? profileMap.get(String(j.client_id)) ?? null : null;
    const contractor = inspectorAny
      ? profileMap.get(String(inspectorAny)) ?? null
      : null;

    return {
      id: String(j.id),
      title: (j.title as string | null) ?? null,
      location: ((j.location_city as string | null) ?? (j.location as string | null)) ?? null,
      description: (j.description as string | null) ?? null,
      status: j.status as JobStatus,
      created_at: (j.created_at as string | null) ?? null,
      updated_at: (j.updated_at as string | null) ?? null,
      client_id: (j.client_id as string | null) ?? null,
      client_name: client?.name ?? null,
      client_email: client?.email ?? null,
      contractor_id: inspectorAny ? String(inspectorAny) : null,
      contractor_name: contractor?.name ?? null,
      contractor_email: contractor?.email ?? null,
      client_price_cents: (j.client_price_cents as number | null) ?? null,
      payout_amount_cents:
        ((j.inspector_payout_cents as number | null) ??
          (j.payout_amount_cents as number | null)) ?? null,
      payout_status: (j.payout_status as string | null) ?? null,
      moderation_status: (j.moderation_status as string | null) ?? null,
      moderation_reviewed_at: (j.moderation_reviewed_at as string | null) ?? null,
      moderation_reviewed_by: (j.moderation_reviewed_by as string | null) ?? null,
      moderation_notes: (j.moderation_notes as string | null) ?? null,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchModerationJob] threw:', e);
    }
    return null;
  }
}

export async function fetchModerationTimeline(
  jobId: string,
  limit = 20,
): Promise<ModerationTimelineEvent[]> {
  if (!jobId) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('audit_events')
      .select('id, created_at, event_type, severity, summary, actor_label')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as ModerationTimelineEvent[];
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchModerationTimeline] threw:', e);
    }
    return [];
  }
}
