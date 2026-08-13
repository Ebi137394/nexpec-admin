// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/reviews/reviewClient.ts — route-local plumbing for the
//  Senior Inspector review surface (LANE B, web).
//
//  WHAT THIS FILE IS AND IS NOT
//  It is NOT a data-access layer. Every fact that carries a rule — the review
//  rounds, who may decide, whether a decision may be submitted — comes from the
//  frozen contract in @nexpec/shared-core (net/fundingReview + domain/
//  seniorReview) and is never re-derived here. What lives here is the small
//  amount of route-local wiring the contract deliberately does not own:
//
//    1. binding shared-core to the browser Supabase client (createCore),
//    2. discovering WHICH reports are routed to me (the contract's reader is
//       per-report: fetchReviewRounds(reportId) needs an id to start from),
//    3. the best-effort report/evidence read for the reviewing surface.
//
//  ── MONEY: STRUCTURALLY ABSENT ────────────────────────────────────────────
//  Nothing in this module — or anywhere under app/inspector/reviews/ — imports
//  domain/funding, any funding reader, or any payment RPC. No query below
//  selects a price, payout, spread or amount column. report_senior_reviews has
//  no money column at all, and the two other reads name their columns
//  explicitly and name no money column. Review moves no money, so this surface
//  has nowhere to put an amount even by accident.
//
//  ── DELIVERY: STRUCTURALLY ABSENT ─────────────────────────────────────────
//  deliverReportToClient is never imported anywhere in this route. Delivery is
//  Admin-only; the symbol is not in scope in a single module of this surface,
//  so no control can be wired to it and none can be revealed by a state change.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { createCore, getCore } from '@nexpec/shared-core';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { FinalReportDoc } from '@/lib/data/inspectorReport.types';

/** Private bucket that submit-report writes evidence into. Paths only are
 *  persisted in final_report_doc; URLs are minted per render. */
const EVIDENCE_BUCKET = 'inspection-photos';

/** Read-time signed-URL TTL. Matches SIGNED_URL_TTL.VIEW in shared-core. */
const EVIDENCE_TTL_SECONDS = 60 * 60;

/**
 * Bind shared-core to the browser client, once. The browser client is a
 * per-tab singleton bound to this user's cookies, so the shared-core singleton
 * is per-user by construction — unlike a server binding, which would be shared
 * across concurrent requests.
 */
export function ensureCore() {
  try {
    return getCore();
  } catch {
    const supabase = createSupabaseBrowserClient();
    // apps/web and the repo root each resolve their own copy of
    // @supabase/supabase-js, and SupabaseClient carries protected members, so
    // the two structurally identical classes are not assignable across copies.
    // The runtime object is the same shape; the cast is a build-graph artefact,
    // not a type hole.
    return createCore({
      supabase: supabase as unknown as Parameters<
        typeof createCore
      >[0]['supabase'],
    });
  }
}

export function reviewSupabase() {
  ensureCore();
  return createSupabaseBrowserClient();
}

export async function currentUserId(): Promise<string | null> {
  const supabase = reviewSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** One report routed to me, newest assignment first. */
export interface AssignedReportRef {
  reportId: string;
  jobId: string;
  /** Most recent assignment timestamp among MY rounds on this report. */
  lastAssignedAt: string;
}

/**
 * The reports routed to THIS Senior Inspector.
 *
 * The only filter is `reviewer_id = me`, which is also the RLS policy
 * (report_senior_reviews_reviewer, 20260801450000 §7): a reviewer can read
 * their own assignment rows and nothing else. The inbox therefore cannot list
 * a report that was not routed to this account even if the filter were dropped.
 *
 * Selects ids and timestamps only — the decision-bearing fields are read back
 * through fetchReviewRounds() so no screen re-derives review state from a
 * hand-rolled row shape.
 */
export async function fetchAssignedReportRefs(
  reviewerId: string,
): Promise<AssignedReportRef[]> {
  const supabase = reviewSupabase();
  const { data, error } = await supabase
    .from('report_senior_reviews')
    .select('inspection_report_id, job_id, assigned_at')
    .eq('reviewer_id', reviewerId)
    .order('assigned_at', { ascending: false });

  if (error) {
    throw new Error(error.message || 'Could not read your review assignments');
  }

  const seen = new Map<string, AssignedReportRef>();
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const reportId = String(raw.inspection_report_id ?? '');
    if (!reportId || seen.has(reportId)) continue;
    seen.set(reportId, {
      reportId,
      jobId: String(raw.job_id ?? ''),
      lastAssignedAt: String(raw.assigned_at ?? ''),
    });
  }
  return Array.from(seen.values());
}

/**
 * Best-effort job titles for the inbox. `id, title` ONLY — never a price,
 * payout or spread column. A job the reviewer may not read simply does not
 * come back and the row degrades to its report reference; nothing is invented
 * to fill the gap.
 */
export async function fetchJobTitles(
  jobIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = jobIds.filter(Boolean);
  if (ids.length === 0) return out;

  const supabase = reviewSupabase();
  const { data, error } = await supabase
    .from('jobs')
    .select('id, title')
    .in('id', ids);

  if (error) return out;
  for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
    const id = String(raw.id ?? '');
    const title = raw.title == null ? '' : String(raw.title);
    if (id && title) out.set(id, title);
  }
  return out;
}

/** The report under review, as far as this reviewer is authorised to read it. */
export interface ReportUnderReview {
  id: string;
  jobId: string;
  inspectorId: string;
  status: string | null;
  notes: string | null;
  doc: FinalReportDoc | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * The report body. Named columns only, and no money column among them.
 *
 * RLS on inspection_reports is the authority. If it does not admit this
 * reviewer, the read returns nothing and the caller renders an explicit
 * "not released to your account" state — it must not fabricate a body, and it
 * must not fall back to a wider query.
 */
export async function fetchReportUnderReview(
  reportId: string,
): Promise<ReportUnderReview | null> {
  const supabase = reviewSupabase();
  const { data, error } = await supabase
    .from('inspection_reports')
    .select(
      'id, job_id, inspector_id, status, notes, final_report_doc, created_at, updated_at',
    )
    .eq('id', reportId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !data) return null;

  const r = data as unknown as Record<string, unknown>;
  return {
    id: String(r.id),
    jobId: String(r.job_id ?? ''),
    inspectorId: String(r.inspector_id ?? ''),
    status: (r.status as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    doc: parseFinalReportDoc(r.final_report_doc),
    createdAt: (r.created_at as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
  };
}

/**
 * final_report_doc is a TEXT column holding JSON. Legacy rows hold plain text
 * and parse to null — the caller then renders `notes` as the body rather than
 * pretending the structured doc exists.
 */
export function parseFinalReportDoc(value: unknown): FinalReportDoc | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const candidate: unknown = JSON.parse(value);
    if (
      candidate &&
      typeof candidate === 'object' &&
      'version' in (candidate as Record<string, unknown>)
    ) {
      return candidate as FinalReportDoc;
    }
  } catch {
    return null;
  }
  return null;
}

export interface EvidenceItem {
  path: string;
  caption: string | null;
  /** Null when the storage layer did not authorise this reviewer. */
  url: string | null;
}

/**
 * Mint view URLs for the report's photo evidence.
 *
 * The evidence bucket is private and owner+admin only at the storage-RLS layer
 * (20260801236000). Cross-party reads go through the server-authorised
 * `mint-doc-url` edge function, which re-checks nx_can_access_doc as
 * service_role — the same path the mobile client already uses. A null url is a
 * genuine "not authorised", surfaced as such rather than as a broken image.
 */
export async function mintEvidenceUrls(
  doc: FinalReportDoc | null,
): Promise<EvidenceItem[]> {
  const entries = doc?.evidence ?? [];
  if (entries.length === 0) return [];

  const paths = entries.map((e) => e.path).filter(Boolean);
  const supabase = reviewSupabase();

  let urls: Record<string, string | null> = {};
  try {
    const { data, error } = await supabase.functions.invoke('mint-doc-url', {
      body: { bucket: EVIDENCE_BUCKET, paths, ttl: EVIDENCE_TTL_SECONDS },
    });
    if (!error) {
      urls = (data as { urls?: Record<string, string | null> })?.urls ?? {};
    }
  } catch {
    urls = {};
  }

  return entries.map((e) => ({
    path: e.path,
    caption: e.caption ?? null,
    url: urls[e.path] ?? null,
  }));
}

/** Narrow an unknown Supabase/RPC error into something renderable. */
export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error && typeof error === 'object') {
    const m = (error as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return fallback;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString();
}
