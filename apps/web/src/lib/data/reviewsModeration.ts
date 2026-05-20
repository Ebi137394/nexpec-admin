// ════════════════════════════════════════════════════════════════════════════
//  lib/data/reviewsModeration.ts
//
//  Admin-only data fetcher for the Reviews Moderation page. Reads from
//  the unmasked public.reviews table (admin RLS allows it) and hydrates
//  the reviewer, reviewee, and job in a single PostgREST request.
//
//  The mobile admin command center has had this surface since web Sprint 8;
//  the web platform was lagging. Migration 20260520150000_reviews_moderation_schema
//  shipped the underlying schema + moderate_review RPC; this fetcher
//  exposes it to the Next.js page.
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// ─── Types ────────────────────────────────────────────────────────────────

export type ModerationStatus = 'visible' | 'hidden' | 'disputed' | 'flagged';
export type ModerationFilter = ModerationStatus | 'all';
export type ReviewDirection = 'client_to_inspector' | 'inspector_to_client';

export interface ModerationProfileLite {
  id: string;
  full_name: string | null;
  company_name: string | null;
  avatar_url: string | null;
  role: string | null;
}

export interface ModerationReviewRow {
  id: string;
  job_id: string;
  reviewer_id: string;
  reviewee_id: string;
  direction: ReviewDirection;
  rating: number;
  would_recommend: boolean;
  body: string | null;
  published_at: string;
  created_at: string;
  moderation_status: ModerationStatus;
  moderator_notes: string | null;
  private_admin_note: string | null;
  hidden_at: string | null;
  hidden_by: string | null;
  disputed_at: string | null;
  disputed_reason: string | null;
  flagged_at: string | null;
  flagged_reason: string | null;
  last_moderated_at: string | null;
  last_moderated_by: string | null;
  reviewer: ModerationProfileLite | null;
  reviewee: ModerationProfileLite | null;
  job: { id: string; title: string | null } | null;
}

export interface ModerationCounts {
  all: number;
  visible: number;
  hidden: number;
  disputed: number;
  flagged: number;
}

// ─── Constants ────────────────────────────────────────────────────────────

export const MODERATION_LABELS: Record<
  ModerationStatus,
  { label: string; tone: string; dot: string }
> = {
  visible: { label: 'Visible', tone: 'text-accent-green', dot: 'bg-accent-green' },
  hidden: { label: 'Hidden', tone: 'text-zinc-400', dot: 'bg-zinc-500' },
  disputed: { label: 'Disputed', tone: 'text-accent-amber', dot: 'bg-accent-amber' },
  flagged: { label: 'Flagged', tone: 'text-accent-red', dot: 'bg-accent-red' },
};

export const DIRECTION_LABELS: Record<ReviewDirection, string> = {
  client_to_inspector: 'Client → Inspector',
  inspector_to_client: 'Inspector → Client',
};

// ─── Fetchers ─────────────────────────────────────────────────────────────

/**
 * Admin-only list. RLS lets admins see every row; non-admins won't
 * receive non-visible rows so this fetcher is also safe to call from
 * a guard that intends "show whatever the caller can see" — but the
 * /admin/reviews page is gated by the admin layout, so we expect
 * admin context here in practice.
 */
export async function fetchReviewsForModeration(opts: {
  status?: ModerationFilter;
  limit?: number;
  offset?: number;
} = {}): Promise<ModerationReviewRow[]> {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from('reviews')
    .select(
      `
      id, job_id, reviewer_id, reviewee_id, direction, rating,
      would_recommend, body, published_at, created_at,
      moderation_status, moderator_notes, private_admin_note,
      hidden_at, hidden_by,
      disputed_at, disputed_reason,
      flagged_at, flagged_reason,
      last_moderated_at, last_moderated_by,
      reviewer:profiles!reviewer_id (
        id, full_name, company_name, avatar_url, role
      ),
      reviewee:profiles!reviewee_id (
        id, full_name, company_name, avatar_url, role
      ),
      job:jobs!job_id ( id, title )
    `,
    )
    .order('created_at', { ascending: false });

  if (opts.status && opts.status !== 'all') {
    q = q.eq('moderation_status', opts.status);
  }
  q = q.range(offset, offset + limit - 1);

  const { data, error } = await q;
  if (error) {
    console.error('[fetchReviewsForModeration] failed:', error.message);
    return [];
  }
  return ((data ?? []) as unknown) as ModerationReviewRow[];
}

/**
 * Tab badge counts. One round-trip — Postgres `COUNT(*) FILTER (WHERE …)`
 * via parallel HEAD requests is cheaper than client-side bucket counting
 * when the table grows.
 */
export async function fetchReviewModerationCounts(): Promise<ModerationCounts> {
  const supabase = await createSupabaseServerClient();
  const [all, visible, hidden, disputed, flagged] = await Promise.all([
    supabase.from('reviews').select('id', { count: 'exact', head: true }),
    supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('moderation_status', 'visible'),
    supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('moderation_status', 'hidden'),
    supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('moderation_status', 'disputed'),
    supabase
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .eq('moderation_status', 'flagged'),
  ]);

  return {
    all: all.count ?? 0,
    visible: visible.count ?? 0,
    hidden: hidden.count ?? 0,
    disputed: disputed.count ?? 0,
    flagged: flagged.count ?? 0,
  };
}

// ─── Display helpers ─────────────────────────────────────────────────────

export function formatProfileLabel(p: ModerationProfileLite | null): string {
  if (!p) return 'Unknown';
  return (
    (p.company_name && p.company_name.trim()) ||
    (p.full_name && p.full_name.trim()) ||
    'Unknown'
  );
}

export function formatInitials(p: ModerationProfileLite | null): string {
  const name = formatProfileLabel(p);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (
    parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)
  ).toUpperCase();
}

export function formatRoleChip(role: string | null): string {
  if (!role) return '—';
  switch (role) {
    case 'super_admin':
      return 'Super Admin';
    case 'admin':
      return 'Admin';
    case 'enterprise':
      return 'Enterprise';
    case 'agency':
      return 'Agency';
    case 'client':
      return 'Client';
    case 'inspector':
      return 'Inspector';
    default:
      return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

export function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
