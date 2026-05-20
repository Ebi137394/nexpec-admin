// ════════════════════════════════════════════════════════════════════════════
//  app/admin/reviews/page.tsx — Reviews Moderation Dashboard
//
//  Server Component. Admin-only. Mirrors the mobile admin command center's
//  reviews-moderation screen with deeper desktop affordances:
//
//    • Five-tab filter row — All / Visible / Hidden / Disputed / Flagged —
//      with live counts from fetchReviewModerationCounts().
//    • Dense review cards: rating glyph, reviewer→reviewee profiles,
//      direction chip, review body, status pill, moderator notes preview.
//    • Action drawer per card — Hide / Unhide / Dispute / Flag / Note —
//      each fires the moderate_review SECURITY DEFINER RPC via the
//      reviewsModeration Server Action.
//    • Aggregate strip at top: total + critical (disputed + flagged).
//
//  Routing model:
//    /admin/reviews?status=all|visible|hidden|disputed|flagged
//
//  Schema dependencies:
//    • supabase/migrations/20260520150000_reviews_moderation_schema.sql
//      (moderation_status column, moderate_review RPC, reviews_public view)
//
//  Admin gating is handled by the parent app/admin/layout.tsx; we don't
//  re-check here. The RPC itself also re-checks nx_is_admin() server-side.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Star,
  Eye,
  EyeOff,
  AlertTriangle,
  Flag,
  StickyNote,
  CheckCircle2,
  ArrowRight,
  MessagesSquare,
  Filter,
} from 'lucide-react';
import {
  fetchReviewsForModeration,
  fetchReviewModerationCounts,
  formatProfileLabel,
  formatInitials,
  formatRoleChip,
  formatRelativeTime,
  DIRECTION_LABELS,
  MODERATION_LABELS,
  type ModerationFilter,
  type ModerationReviewRow,
} from '@/lib/data/reviewsModeration';
import { moderateReviewAction } from '@/lib/actions/reviewsModeration';

export const metadata: Metadata = {
  title: 'Reviews Moderation',
  description:
    'Admin moderation surface for the reviews engine. Hide, dispute, flag, annotate — backed by moderate_review SECURITY DEFINER RPC.',
};

export const dynamic = 'force-dynamic';

const TABS: Array<{
  key: ModerationFilter;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}> = [
  { key: 'all', label: 'All', icon: Filter },
  { key: 'visible', label: 'Visible', icon: Eye },
  { key: 'hidden', label: 'Hidden', icon: EyeOff },
  { key: 'disputed', label: 'Disputed', icon: AlertTriangle },
  { key: 'flagged', label: 'Flagged', icon: Flag },
];

interface PageProps {
  searchParams: Promise<{
    status?: string;
    moderated?: string;
    error?: string;
    reviewId?: string;
  }>;
}

export default async function AdminReviewsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filter: ModerationFilter = isModerationFilter(sp.status)
    ? sp.status
    : 'all';

  const [rows, counts] = await Promise.all([
    fetchReviewsForModeration({ status: filter, limit: 100 }),
    fetchReviewModerationCounts(),
  ]);

  const criticalCount = counts.disputed + counts.flagged;

  return (
    <div className="space-y-8">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console · Reputation Engine
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Reviews Moderation
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Every review across the marketplace. Hide low-quality content,
          dispute coordinated false reviews, flag abuse, attach internal
          notes. All actions fire the{' '}
          <span className="font-mono text-violet-glow">moderate_review</span>{' '}
          RPC and refresh reputation aggregates atomically.
        </p>
      </header>

      {/* ── Outcome / error banners ─────────────────────────────────── */}
      {sp.moderated && !sp.error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-accent-green"
            strokeWidth={1.75}
          />
          <p className="text-sm text-accent-green">
            Review moderated — action <span className="font-mono">{sp.moderated}</span>{' '}
            recorded.
            {sp.reviewId ? (
              <span className="ml-2 text-accent-green/70">
                ({sp.reviewId.slice(0, 8)}…)
              </span>
            ) : null}
          </p>
        </div>
      ) : null}
      {sp.error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4">
          <AlertTriangle
            className="mt-0.5 h-5 w-5 shrink-0 text-accent-red"
            strokeWidth={1.75}
          />
          <p className="text-sm text-accent-red">{sp.error}</p>
        </div>
      ) : null}

      {/* ── Aggregate strip ─────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total reviews" value={counts.all.toLocaleString()} />
        <Stat
          label="Visible"
          value={counts.visible.toLocaleString()}
          tone="green"
        />
        <Stat
          label="Hidden"
          value={counts.hidden.toLocaleString()}
          tone={counts.hidden > 0 ? 'mute' : 'default'}
        />
        <Stat
          label="Needs review"
          value={criticalCount.toLocaleString()}
          tone={criticalCount > 0 ? 'amber' : 'default'}
        />
      </section>

      {/* ── Filter tabs ─────────────────────────────────────────────── */}
      <nav
        aria-label="Filter reviews by moderation status"
        className="flex flex-wrap gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-1.5"
      >
        {TABS.map((tab) => {
          const active = filter === tab.key;
          const count =
            tab.key === 'all'
              ? counts.all
              : tab.key === 'visible'
                ? counts.visible
                : tab.key === 'hidden'
                  ? counts.hidden
                  : tab.key === 'disputed'
                    ? counts.disputed
                    : counts.flagged;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={
                tab.key === 'all'
                  ? '/admin/reviews'
                  : `/admin/reviews?status=${tab.key}`
              }
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-violet/15 text-white ring-1 ring-inset ring-violet/30'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <Icon
                className={`h-3.5 w-3.5 ${
                  active ? 'text-violet-glow' : 'text-zinc-500'
                }`}
                strokeWidth={1.75}
              />
              <span>{tab.label}</span>
              <span
                className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  active
                    ? 'bg-violet/25 text-violet-glow'
                    : 'bg-white/[0.04] text-zinc-500'
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ── List ────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
            <MessagesSquare
              className="mx-auto h-8 w-8 text-zinc-600"
              strokeWidth={1.5}
            />
            <p className="mt-3 text-sm text-zinc-400">
              {filter === 'all'
                ? 'No reviews on the platform yet.'
                : `No reviews currently in "${filter}" status.`}
            </p>
          </div>
        ) : (
          rows.map((row) => <ReviewCard key={row.id} row={row} />)
        )}
      </section>

      <p className="text-[11px] text-zinc-600">
        Backed by{' '}
        <span className="font-mono">
          public.moderate_review(uuid, text, text)
        </span>{' '}
        — SECURITY DEFINER. Every action audits to{' '}
        <span className="font-mono">reviews.last_moderated_at</span> and
        refreshes <span className="font-mono">profiles.rating_average</span>{' '}
        atomically.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  ReviewCard — server component (no client state)
// ─────────────────────────────────────────────────────────────────────────

function ReviewCard({ row }: { row: ModerationReviewRow }) {
  const meta = MODERATION_LABELS[row.moderation_status];
  const reviewerName = formatProfileLabel(row.reviewer);
  const revieweeName = formatProfileLabel(row.reviewee);
  const reviewerInitials = formatInitials(row.reviewer);
  const revieweeInitials = formatInitials(row.reviewee);

  return (
    <article
      className={`rounded-3xl border bg-white/[0.01] p-5 sm:p-6 ${
        row.moderation_status === 'visible'
          ? 'border-white/[0.06]'
          : row.moderation_status === 'disputed'
            ? 'border-accent-amber/30'
            : row.moderation_status === 'flagged'
              ? 'border-accent-red/30'
              : 'border-white/[0.04]'
      }`}
    >
      {/* Top row — status pill + meta */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-industrial ${meta.tone}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
          <span className="rounded-full bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
            {DIRECTION_LABELS[row.direction]}
          </span>
          <span className="font-mono text-[10px] text-zinc-500">
            {formatRelativeTime(row.created_at)}
          </span>
        </div>
        <RatingDisplay value={row.rating} />
      </header>

      {/* Reviewer → Reviewee */}
      <div className="mt-5 flex items-center gap-3">
        <Avatar
          name={reviewerName}
          initials={reviewerInitials}
          src={row.reviewer?.avatar_url}
          role={row.reviewer?.role ?? null}
        />
        <ArrowRight
          className="h-4 w-4 shrink-0 text-zinc-600"
          strokeWidth={1.75}
        />
        <Avatar
          name={revieweeName}
          initials={revieweeInitials}
          src={row.reviewee?.avatar_url}
          role={row.reviewee?.role ?? null}
        />
        {row.job?.id ? (
          // /admin/jobs has NO dynamic [id] route — inspection is a drawer
          // keyed by the ?inspect= search param. Anything else 404s.
          <Link
            href={`/admin/jobs?inspect=${encodeURIComponent(row.job.id)}`}
            className="ml-auto truncate rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-zinc-300 hover:border-violet/40 hover:text-white"
          >
            {row.job.title ?? 'Open job'}
          </Link>
        ) : null}
      </div>

      {/* Body */}
      {row.body ? (
        <blockquote className="mt-5 rounded-2xl border border-white/[0.04] bg-ink-950/40 p-4">
          <p className="text-sm leading-relaxed text-zinc-200">{row.body}</p>
        </blockquote>
      ) : (
        <p className="mt-5 text-xs italic text-zinc-500">
          No written feedback — rating-only submission.
        </p>
      )}

      {/* Moderator notes / dispute reason / flag reason */}
      {(row.moderator_notes ||
        row.disputed_reason ||
        row.flagged_reason ||
        row.private_admin_note) && (
        <div className="mt-4 space-y-2">
          {row.disputed_reason ? (
            <NoteRow
              icon={
                <AlertTriangle className="h-3.5 w-3.5 text-accent-amber" strokeWidth={1.75} />
              }
              label="Dispute reason"
              tone="amber"
            >
              {row.disputed_reason}
            </NoteRow>
          ) : null}
          {row.flagged_reason ? (
            <NoteRow
              icon={
                <Flag className="h-3.5 w-3.5 text-accent-red" strokeWidth={1.75} />
              }
              label="Flag reason"
              tone="red"
            >
              {row.flagged_reason}
            </NoteRow>
          ) : null}
          {row.moderator_notes ? (
            <NoteRow
              icon={
                <StickyNote className="h-3.5 w-3.5 text-zinc-400" strokeWidth={1.75} />
              }
              label="Moderator note"
              tone="zinc"
            >
              {row.moderator_notes}
            </NoteRow>
          ) : null}
          {row.private_admin_note ? (
            <NoteRow
              icon={
                <StickyNote className="h-3.5 w-3.5 text-violet-glow" strokeWidth={1.75} />
              }
              label="Private admin note"
              tone="violet"
            >
              {row.private_admin_note}
            </NoteRow>
          ) : null}
        </div>
      )}

      {/* Last moderation timestamp */}
      {row.last_moderated_at ? (
        <p className="mt-3 font-mono text-[10px] text-zinc-500">
          last action: {formatRelativeTime(row.last_moderated_at)}
        </p>
      ) : null}

      {/* Action row — five buttons, each a separate form for clean POST */}
      <footer className="mt-5 flex flex-wrap gap-2 border-t border-white/[0.05] pt-4">
        {row.moderation_status === 'visible' ? (
          <ActionForm
            reviewId={row.id}
            action="hide"
            label="Hide"
            tone="zinc"
            icon={<EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />}
            promptForNotes
          />
        ) : (
          <ActionForm
            reviewId={row.id}
            action="unhide"
            label="Restore"
            tone="green"
            icon={<Eye className="h-3.5 w-3.5" strokeWidth={1.75} />}
          />
        )}
        {row.moderation_status !== 'disputed' ? (
          <ActionForm
            reviewId={row.id}
            action="dispute"
            label="Open dispute"
            tone="amber"
            icon={<AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />}
            promptForNotes
          />
        ) : null}
        {row.moderation_status !== 'flagged' ? (
          <ActionForm
            reviewId={row.id}
            action="flag"
            label="Flag"
            tone="red"
            icon={<Flag className="h-3.5 w-3.5" strokeWidth={1.75} />}
            promptForNotes
          />
        ) : null}
        <ActionForm
          reviewId={row.id}
          action="note"
          label="Add note"
          tone="violet"
          icon={<StickyNote className="h-3.5 w-3.5" strokeWidth={1.75} />}
          promptForNotes
          requireNotes
        />
      </footer>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────

function RatingDisplay({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={`h-3.5 w-3.5 ${
            i <= value ? 'fill-amber-300 text-amber-300' : 'text-zinc-700'
          }`}
          strokeWidth={1.5}
        />
      ))}
      <span className="ml-1 font-mono text-[11px] font-semibold text-white">
        {value}.0
      </span>
    </div>
  );
}

function Avatar({
  name,
  initials,
  src,
  role,
}: {
  name: string;
  initials: string;
  src: string | null | undefined;
  role: string | null;
}) {
  return (
    <div className="flex items-center gap-2">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className="h-8 w-8 rounded-full object-cover ring-1 ring-white/10"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet/15 text-[11px] font-bold text-violet-glow ring-1 ring-violet/30">
          {initials}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-white">{name}</p>
        <p className="font-mono text-[10px] text-zinc-500">
          {formatRoleChip(role)}
        </p>
      </div>
    </div>
  );
}

function NoteRow({
  icon,
  label,
  tone,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  tone: 'amber' | 'red' | 'zinc' | 'violet';
  children: React.ReactNode;
}) {
  const borderClass =
    tone === 'amber'
      ? 'border-accent-amber/20 bg-accent-amber/[0.04]'
      : tone === 'red'
        ? 'border-accent-red/20 bg-accent-red/[0.04]'
        : tone === 'violet'
          ? 'border-violet/20 bg-violet/[0.04]'
          : 'border-white/[0.05] bg-white/[0.02]';
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border ${borderClass} px-3 py-2`}
    >
      <span className="mt-0.5">{icon}</span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
          {label}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-300">{children}</p>
      </div>
    </div>
  );
}

function ActionForm({
  reviewId,
  action,
  label,
  tone,
  icon,
  promptForNotes,
  requireNotes,
}: {
  reviewId: string;
  action: 'hide' | 'unhide' | 'dispute' | 'flag' | 'note';
  label: string;
  tone: 'green' | 'amber' | 'red' | 'zinc' | 'violet';
  icon: React.ReactNode;
  promptForNotes?: boolean;
  requireNotes?: boolean;
}) {
  // Each action is a self-contained <form> POSTing to the same Server
  // Action. For actions that benefit from a reason, we render a tiny
  // inline <details> so the admin can attach notes without leaving the
  // card. Default-closed for visual calm.
  const toneClass =
    tone === 'green'
      ? 'border-accent-green/40 bg-accent-green/10 text-accent-green hover:bg-accent-green/15'
      : tone === 'amber'
        ? 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/15'
        : tone === 'red'
          ? 'border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/15'
          : tone === 'violet'
            ? 'border-violet/40 bg-violet/10 text-violet-glow hover:bg-violet/15'
            : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]';

  if (!promptForNotes) {
    return (
      <form action={moderateReviewAction}>
        <input type="hidden" name="reviewId" value={reviewId} />
        <input type="hidden" name="action" value={action} />
        <button
          type="submit"
          className={`inline-flex items-center gap-1.5 rounded-full border ${toneClass} px-3 py-1.5 text-[11px] font-semibold transition-colors`}
        >
          {icon}
          {label}
        </button>
      </form>
    );
  }

  return (
    <details className="group">
      <summary
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border ${toneClass} list-none px-3 py-1.5 text-[11px] font-semibold transition-colors`}
      >
        {icon}
        {label}
      </summary>
      <form
        action={moderateReviewAction}
        className="mt-2 flex flex-col gap-2 rounded-xl border border-white/[0.05] bg-ink-950/40 p-3 sm:flex-row sm:items-center"
      >
        <input type="hidden" name="reviewId" value={reviewId} />
        <input type="hidden" name="action" value={action} />
        <input
          type="text"
          name="notes"
          maxLength={500}
          placeholder={
            action === 'dispute'
              ? 'Dispute reason (e.g. coordinated false review)'
              : action === 'flag'
                ? 'Flag reason (e.g. abusive language)'
                : action === 'hide'
                  ? 'Hide reason (optional)'
                  : 'Internal note…'
          }
          required={!!requireNotes}
          className="flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-violet/40 focus:outline-none focus:ring-1 focus:ring-violet/30"
        />
        <button
          type="submit"
          className={`inline-flex items-center gap-1 rounded-full border ${toneClass} px-3 py-1.5 text-[11px] font-semibold transition-colors`}
        >
          Record {action}
        </button>
      </form>
    </details>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'green' | 'amber' | 'red' | 'mute';
}) {
  const valueClass =
    tone === 'green'
      ? 'text-accent-green'
      : tone === 'amber'
        ? 'text-accent-amber'
        : tone === 'red'
          ? 'text-accent-red'
          : tone === 'mute'
            ? 'text-zinc-400'
            : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className={`mt-1 font-display text-2xl font-semibold ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────

function isModerationFilter(v: string | undefined): v is ModerationFilter {
  return (
    v === 'all' ||
    v === 'visible' ||
    v === 'hidden' ||
    v === 'disputed' ||
    v === 'flagged'
  );
}
