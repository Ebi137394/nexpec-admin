// ════════════════════════════════════════════════════════════════════════════
//  src/lib/reviews.ts
//  NEXPEC — Premium Review & Reputation Engine (Frontend Library / v1)
//
//  Client-side library for the `reviews` table, `reviews_public` view,
//  and the two RPCs `submit_review` / `moderate_review`.
//
//  Exports:
//    • Types mirroring the DB schema.
//    • submitReview / moderateReview — RPC wrappers (typed).
//    • fetchReviewsAboutUser, fetchReputation, fetchExistingReview,
//      fetchReviewsForModeration — read helpers (admin vs. public auto).
//    • resolveRevieweeForJob — given a job + reviewer, returns the other
//      party (the reviewee). Used by the submission screen.
//    • Display helpers (formatReviewerName, formatRelativeTime,
//      formatRatingDisplay, MODERATION_LABELS).
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';

// ─── TYPES ────────────────────────────────────────────────────────────────

export type ModerationStatus = 'visible' | 'hidden' | 'disputed' | 'flagged';
export type ReviewerRole = 'client' | 'agency' | 'enterprise' | 'inspector';
export type ModerateAction = 'hide' | 'unhide' | 'dispute' | 'flag' | 'note';

export const MODERATION_LABELS: Record<ModerationStatus, { label: string; color: string; bg: string }> = {
  visible:  { label: 'Visible',  color: '#10B981', bg: 'rgba(16,185,129,0.14)' },
  hidden:   { label: 'Hidden',   color: '#94A3B8', bg: 'rgba(148,163,184,0.14)' },
  disputed: { label: 'Disputed', color: '#F59E0B', bg: 'rgba(245,158,11,0.14)' },
  flagged:  { label: 'Flagged',  color: '#EF4444', bg: 'rgba(239,68,68,0.14)' },
};

export interface ReviewProfileLite {
  id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
  avatar_url?: string | null;
  role?: string | null;
  is_verified?: boolean | null;
}

export interface ReviewRow {
  id: string;
  created_at: string;
  job_id: string;
  reviewer_id: string;
  reviewee_id: string;
  reviewer_role_snap: ReviewerRole;
  reviewee_role_snap: ReviewerRole;
  rating: number;                       // 1–5
  comment: string | null;
  is_public: boolean;
  moderation_status: ModerationStatus;
  weight: number;
  // Admin-only fields (only present when querying the unmasked table)
  private_admin_note?: string | null;
  moderator_notes?: string | null;
  hidden_at?: string | null;
  hidden_by?: string | null;
}

export interface ReviewWithParties extends ReviewRow {
  reviewer?: ReviewProfileLite | null;
  reviewee?: ReviewProfileLite | null;
  job?: { id: string; title: string | null } | null;
}

export interface ReputationStats {
  rating_average: number;
  rating_count: number;
  is_verified: boolean;
}

export interface JobPartyContext {
  jobId: string;
  jobTitle: string | null;
  jobStatus: string;
  adminConfirmedAt: string | null;
  clientId: string | null;
  agencyId: string | null;
  contractorId: string | null;
}

// ─── RPC WRAPPERS ─────────────────────────────────────────────────────────

export interface SubmitReviewArgs {
  jobId: string;
  revieweeId: string;
  rating: number;                       // 1–5
  comment?: string | null;
  isPublic?: boolean;
  privateAdminNote?: string | null;
}

export async function submitReview(args: SubmitReviewArgs): Promise<string> {
  const { data, error } = await supabase.rpc('submit_review', {
    p_job_id:             args.jobId,
    p_reviewee_id:        args.revieweeId,
    p_rating:             args.rating,
    p_comment:            args.comment ?? null,
    p_is_public:          args.isPublic ?? true,
    p_private_admin_note: args.privateAdminNote ?? null,
  });
  if (error) throw error;
  return String(data);
}

export interface ModerateReviewArgs {
  reviewId: string;
  action: ModerateAction;
  notes?: string | null;
}

export async function moderateReview(args: ModerateReviewArgs): Promise<void> {
  const { error } = await supabase.rpc('moderate_review', {
    p_review_id: args.reviewId,
    p_action:    args.action,
    p_notes:     args.notes ?? null,
  });
  if (error) throw error;
}

// ─── READ HELPERS ─────────────────────────────────────────────────────────

/**
 * Reviews ABOUT a user (the things appearing on their profile).
 * RLS automatically restricts to visible + public for non-admins.
 */
export async function fetchReviewsAboutUser(
  revieweeId: string,
  opts: { limit?: number; offset?: number; asAdmin?: boolean } = {},
): Promise<ReviewWithParties[]> {
  const table = opts.asAdmin ? 'reviews' : 'reviews_public';
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const { data, error } = await supabase
    .from(table)
    .select(`
      *,
      reviewer:profiles!reviewer_id (
        id, full_name, first_name, last_name, company_name, avatar_url, role, is_verified
      )
    `)
    .eq('reviewee_id', revieweeId)
    .eq('moderation_status', 'visible')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return (data ?? []) as ReviewWithParties[];
}

/** Pulls the denormalized reputation aggregate from `profiles`. */
export async function fetchReputation(userId: string): Promise<ReputationStats> {
  const { data, error } = await supabase
    .from('profiles')
    .select('rating_average, rating_count, is_verified')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return {
    rating_average: data?.rating_average != null ? Number(data.rating_average) : 0,
    rating_count:   data?.rating_count   != null ? Number(data.rating_count)   : 0,
    is_verified:    !!data?.is_verified,
  };
}

/** Returns the existing review by this reviewer for this job, if any. */
export async function fetchExistingReview(
  jobId: string,
  reviewerId: string,
): Promise<ReviewRow | null> {
  const { data, error } = await supabase
    .from('reviews_public')
    .select('*')
    .eq('job_id', jobId)
    .eq('reviewer_id', reviewerId)
    .maybeSingle();
  if (error && (error as any).code !== 'PGRST116') throw error;
  return (data as ReviewRow) ?? null;
}

/**
 * Admin moderation feed. Lists every review across the platform
 * (unmasked) — admin RLS allows it.
 */
export async function fetchReviewsForModeration(opts: {
  status?: ModerationStatus | 'all';
  limit?: number;
  offset?: number;
} = {}): Promise<ReviewWithParties[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let q = supabase
    .from('reviews')
    .select(`
      *,
      reviewer:profiles!reviewer_id (
        id, full_name, first_name, last_name, company_name, avatar_url, role
      ),
      reviewee:profiles!reviewee_id (
        id, full_name, first_name, last_name, company_name, avatar_url, role
      ),
      job:jobs!job_id ( id, title )
    `)
    .order('created_at', { ascending: false });

  if (opts.status && opts.status !== 'all') {
    q = q.eq('moderation_status', opts.status);
  }
  q = q.range(offset, offset + limit - 1);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ReviewWithParties[];
}

/**
 * Loads job-party context needed by the submission screen and computes
 * the reviewee (the party that is NOT the current user). Throws if the
 * current user isn't a party or if the job isn't admin-confirmed
 * completed (matching the DB-side gatekeeping).
 */
export async function resolveRevieweeForJob(
  jobId: string,
  reviewerId: string,
): Promise<{
  ctx: JobPartyContext;
  reviewee: ReviewProfileLite;
}> {
  const { data, error } = await supabase
    .from('jobs')
    .select(`
      id, title, status, admin_confirmed_at,
      client_id, agency_id, contractor_id,
      client:profiles!client_id (
        id, full_name, first_name, last_name, company_name, avatar_url, role, is_verified
      ),
      agency:profiles!agency_id (
        id, full_name, first_name, last_name, company_name, avatar_url, role, is_verified
      ),
      contractor:profiles!contractor_id (
        id, full_name, first_name, last_name, company_name, avatar_url, role, is_verified
      )
    `)
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Job not found');

  const job = data as any;
  if (job.status !== 'completed' || !job.admin_confirmed_at) {
    throw new Error('This job is not yet fully completed by admin gatekeeper.');
  }

  const isClient     = job.client_id     === reviewerId;
  const isAgency     = job.agency_id     === reviewerId;
  const isContractor = job.contractor_id === reviewerId;
  if (!isClient && !isAgency && !isContractor) {
    throw new Error('Only parties to this job can submit a review.');
  }

  // Figure out the other party. Priority: if reviewer is the contractor,
  // reviewee is the client (or agency if no client). If reviewer is
  // client/agency, reviewee is the contractor.
  let reviewee: ReviewProfileLite | null = null;
  if (isContractor) {
    reviewee = job.client ?? job.agency ?? null;
  } else {
    reviewee = job.contractor ?? null;
  }
  if (!reviewee) {
    throw new Error('Could not determine the other party for this job.');
  }

  return {
    ctx: {
      jobId: job.id,
      jobTitle: job.title ?? null,
      jobStatus: job.status,
      adminConfirmedAt: job.admin_confirmed_at,
      clientId: job.client_id ?? null,
      agencyId: job.agency_id ?? null,
      contractorId: job.contractor_id ?? null,
    },
    reviewee,
  };
}

// ─── DISPLAY HELPERS ──────────────────────────────────────────────────────

export function formatReviewerName(p?: ReviewProfileLite | null): string {
  if (!p) return 'Anonymous';
  return (
    (p.company_name && p.company_name.trim()) ||
    (p.full_name && p.full_name.trim()) ||
    [p.first_name, p.last_name].filter(Boolean).join(' ').trim() ||
    'User'
  );
}

export function formatInitials(p?: ReviewProfileLite | null): string {
  const name = formatReviewerName(p);
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase();
}

export function formatRoleLabel(role?: string | null): string {
  if (!role) return '';
  switch (role) {
    case 'super_admin': return 'Admin';
    case 'enterprise':  return 'Enterprise';
    case 'agency':      return 'Agency';
    case 'client':      return 'Client';
    case 'inspector':   return 'Inspector';
    default:            return role.charAt(0).toUpperCase() + role.slice(1);
  }
}

export function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'just now';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr  < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export function formatRatingDisplay(avg: number): string {
  if (avg <= 0) return '—';
  return avg.toFixed(1);
}
