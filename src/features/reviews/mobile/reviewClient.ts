// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/reviews/reviewClient.ts — route-local plumbing for the
//  Senior Inspector review screens (LANE B, mobile).
//
//  Mirror of apps/web/src/app/inspector/reviews/reviewClient.ts. It is NOT a
//  data-access layer: every rule-bearing fact — the rounds, who may decide,
//  whether a decision may be submitted — comes from the frozen contract in
//  @nexpec/shared-core and is never re-derived here. What lives here is the
//  route-local wiring the contract does not own: binding shared-core to the
//  mobile Supabase client, discovering WHICH reports are routed to me (the
//  contract's reader is per-report), and the report/evidence read.
//
//  ── WHY THE DEEP IMPORT PATH ──────────────────────────────────────────────
//  packages/shared-core/src/index.ts does not re-export domain/seniorReview or
//  net/fundingReview, and the "exports" subpaths ("@nexpec/shared-core/net")
//  need package-exports resolution, which neither this tsconfig
//  (moduleResolution: node) nor Metro on Expo SDK 52 performs. The deep source
//  path is the one specifier that resolves in both the typechecker and the
//  bundler today. shared-core is frozen for this lane, so it is not amended
//  here; adding those two lines to its index is a follow-up for its owner and
//  would let this collapse to the package root.
//
//  ── MONEY AND DELIVERY: STRUCTURALLY ABSENT ───────────────────────────────
//  Nothing under app/(inspector)/reviews/ imports domain/funding, any funding
//  reader, any payment RPC, or deliverReportToClient. No query below names a
//  price, payout, spread or amount column — report_senior_reviews has none at
//  all, and the other two reads name their columns explicitly.
// ════════════════════════════════════════════════════════════════════════════

import { createCore, getCore } from '@nexpec/shared-core';
import { supabase } from '@/lib/supabase';
import { signedUrls, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';

/** Private bucket that submit-report writes evidence into. */
const EVIDENCE_BUCKET = 'inspection-photos';

/**
 * Bind shared-core to the app's Supabase client, once. app/_layout.tsx does
 * not call createCore() yet and belongs to another lane, so this screen binds
 * lazily to the same singleton client rather than reaching across lanes.
 */
export function ensureCore() {
  try {
    return getCore();
  } catch {
    return createCore({ supabase });
  }
}

export function reviewSupabase() {
  ensureCore();
  return supabase;
}

export async function currentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await reviewSupabase().auth.getUser();
  return user?.id ?? null;
}

/** One report routed to me. */
export interface AssignedReportRef {
  reportId: string;
  jobId: string;
  lastAssignedAt: string;
}

/**
 * The reports routed to THIS Senior Inspector.
 *
 * The only filter is `reviewer_id = me`, which is also the RLS policy
 * (report_senior_reviews_reviewer, 20260801450000 §7). Ids and timestamps
 * only — the decision-bearing fields are read back through fetchReviewRounds()
 * so no screen re-derives review state from a hand-rolled row shape.
 */
export async function fetchAssignedReportRefs(
  reviewerId: string,
): Promise<AssignedReportRef[]> {
  const { data, error } = await reviewSupabase()
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
 * Best-effort job titles. `id, title` ONLY — never a price, payout or spread
 * column. A job this reviewer may not read simply does not come back and the
 * row degrades to its report reference; nothing is invented to fill the gap.
 */
export async function fetchJobTitles(
  jobIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = jobIds.filter(Boolean);
  if (ids.length === 0) return out;

  const { data, error } = await reviewSupabase()
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

/**
 * The structured report body, as persisted in inspection_reports
 * .final_report_doc (a TEXT column holding JSON). The authoritative shape is
 * FinalReportDoc in apps/web/src/lib/data/inspectorReport.types.ts; this is a
 * read-only, defensive narrowing of the same JSON for the mobile bundle, which
 * cannot import from the web app. Every field is optional here because legacy
 * rows predate the shape.
 */
export interface ReportDocView {
  result?: string;
  summary?: string;
  evidence?: Array<{ path?: string; caption?: string | null }>;
  attestation?: { inspectorName?: string; attestedAt?: string };
}

export interface ReportUnderReview {
  id: string;
  jobId: string;
  inspectorId: string;
  status: string | null;
  notes: string | null;
  doc: ReportDocView | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * The report body. Named columns only, and no money column among them.
 *
 * RLS on inspection_reports is the authority. If it does not admit this
 * reviewer the read returns nothing, and the caller renders an explicit
 * "not released to your account" state — it must not fabricate a body, and it
 * must not retry with a wider query.
 */
export async function fetchReportUnderReview(
  reportId: string,
): Promise<ReportUnderReview | null> {
  const { data, error } = await reviewSupabase()
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

/** Legacy rows hold plain text and parse to null; the caller then renders
 *  `notes` rather than pretending the structured doc exists. */
export function parseFinalReportDoc(value: unknown): ReportDocView | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const candidate: unknown = JSON.parse(value);
    if (
      candidate &&
      typeof candidate === 'object' &&
      'version' in (candidate as Record<string, unknown>)
    ) {
      return candidate as ReportDocView;
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
 * Mint view URLs for the report's photo evidence through the shared
 * signed-URL helper, which routes private buckets via the server-authorised
 * `mint-doc-url` edge function (nx_can_access_doc re-checked as service_role).
 * A null url is a genuine "not authorised" and is surfaced as such rather than
 * as a broken image.
 */
export async function mintEvidenceUrls(
  doc: ReportDocView | null,
): Promise<EvidenceItem[]> {
  const entries = (doc?.evidence ?? []).filter(
    (e): e is { path: string; caption?: string | null } =>
      typeof e?.path === 'string' && e.path.length > 0,
  );
  if (entries.length === 0) return [];

  ensureCore();
  let urls: Record<string, string | null> = {};
  try {
    urls = await signedUrls(
      EVIDENCE_BUCKET,
      entries.map((e) => e.path),
      SIGNED_URL_TTL.VIEW,
    );
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

export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString();
}
