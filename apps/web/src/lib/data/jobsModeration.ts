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
  const pageSize = Math.min(
    Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1),
    MAX_PAGE_SIZE,
  );
  const page = Math.max(query.page ?? 1, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = await createSupabaseServerClient();

  let q = supabase
    .from('jobs')
    .select(
      'id, title, location, status, created_at, updated_at, client_id, contractor_id, client_price_cents, payout_amount_cents, payout_status',
      { count: 'exact' },
    )
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (query.status) q = q.eq('status', query.status);

  const { data: rawJobs, count, error } = await q;

  if (error || !rawJobs) {
    if (error) console.warn('[jobsModeration] page query failed:', error.message);
    return { jobs: [], total: 0, page, pageSize, totalPages: 1 };
  }

  const profileIds = new Set<string>();
  for (const j of rawJobs) {
    if (j.client_id) profileIds.add(j.client_id as string);
    if (j.contractor_id) profileIds.add(j.contractor_id as string);
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

  const jobs: ModerationJob[] = rawJobs.map((j) => ({
    id: j.id as string,
    title: (j.title as string | null) ?? null,
    location: (j.location as string | null) ?? null,
    status: j.status as JobStatus,
    created_at: (j.created_at as string | null) ?? null,
    updated_at: (j.updated_at as string | null) ?? null,
    client_id: (j.client_id as string | null) ?? null,
    client_name: j.client_id ? (profileMap.get(j.client_id as string) ?? null) : null,
    contractor_id: (j.contractor_id as string | null) ?? null,
    contractor_name: j.contractor_id
      ? (profileMap.get(j.contractor_id as string) ?? null)
      : null,
    client_price_cents: (j.client_price_cents as number | null) ?? null,
    payout_amount_cents: (j.payout_amount_cents as number | null) ?? null,
    payout_status: (j.payout_status as string | null) ?? null,
  }));

  const total = count ?? jobs.length;
  return {
    jobs,
    total,
    page,
    pageSize,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  };
}

export async function fetchModerationJob(
  jobId: string,
): Promise<ModerationJobDetail | null> {
  if (!jobId) return null;
  const supabase = await createSupabaseServerClient();
  const { data: j, error } = await supabase
    .from('jobs')
    .select(
      'id, title, location, description, status, created_at, updated_at, client_id, contractor_id, client_price_cents, payout_amount_cents, payout_status, moderation_status, moderation_reviewed_at, moderation_reviewed_by, moderation_notes',
    )
    .eq('id', jobId)
    .maybeSingle();

  if (error || !j) return null;

  const ids: string[] = [];
  if (j.client_id) ids.push(j.client_id as string);
  if (j.contractor_id) ids.push(j.contractor_id as string);

  const profileMap = new Map<string, { name: string | null; email: string | null }>();
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids);
    for (const p of profs ?? []) {
      profileMap.set(p.id as string, {
        name: (p.full_name as string | null) ?? null,
        email: (p.email as string | null) ?? null,
      });
    }
  }

  const client = j.client_id ? profileMap.get(j.client_id as string) ?? null : null;
  const contractor = j.contractor_id
    ? profileMap.get(j.contractor_id as string) ?? null
    : null;

  return {
    id: j.id as string,
    title: (j.title as string | null) ?? null,
    location: (j.location as string | null) ?? null,
    description: (j.description as string | null) ?? null,
    status: j.status as JobStatus,
    created_at: (j.created_at as string | null) ?? null,
    updated_at: (j.updated_at as string | null) ?? null,
    client_id: (j.client_id as string | null) ?? null,
    client_name: client?.name ?? null,
    client_email: client?.email ?? null,
    contractor_id: (j.contractor_id as string | null) ?? null,
    contractor_name: contractor?.name ?? null,
    contractor_email: contractor?.email ?? null,
    client_price_cents: (j.client_price_cents as number | null) ?? null,
    payout_amount_cents: (j.payout_amount_cents as number | null) ?? null,
    payout_status: (j.payout_status as string | null) ?? null,
    moderation_status: (j.moderation_status as string | null) ?? null,
    moderation_reviewed_at: (j.moderation_reviewed_at as string | null) ?? null,
    moderation_reviewed_by: (j.moderation_reviewed_by as string | null) ?? null,
    moderation_notes: (j.moderation_notes as string | null) ?? null,
  };
}

export async function fetchModerationTimeline(
  jobId: string,
  limit = 20,
): Promise<ModerationTimelineEvent[]> {
  if (!jobId) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('audit_events')
    .select('id, created_at, event_type, severity, summary, actor_label')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as ModerationTimelineEvent[];
}
