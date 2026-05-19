// ════════════════════════════════════════════════════════════════════════════
//  app/notifications/page.tsx — full notification feed (all roles)
//
//  Enhancements:
//    • Filter pills (All / Unread / Messages / Jobs / Payouts / Reviews /
//      Disputes / Contracts / System)
//    • Date grouping (Today / Yesterday / This week / Earlier)
//    • Per-kind icon + colored kind chip
//    • Inline mark-read; preserved "Mark all read"
//    • Live updates piggyback off NotificationBellLive's realtime channel.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Bell,
  Check,
  MessageCircle,
  ShieldCheck,
  Briefcase,
  Wallet,
  Star,
  FileCheck2,
  AlertTriangle,
  FolderOpen,
  Settings,
  ArrowLeft,
  LayoutDashboard,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchMyNotifications } from '@/lib/data/notifications';
import {
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/actions/notifications';
import type {
  NotificationKind,
  NotificationRow,
} from '@/lib/data/notifications.types';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

type FilterKey =
  | 'all'
  | 'unread'
  | 'messages'
  | 'jobs'
  | 'payouts'
  | 'reviews'
  | 'disputes'
  | 'contracts'
  | 'system';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all',       label: 'All' },
  { key: 'unread',    label: 'Unread' },
  { key: 'messages',  label: 'Messages' },
  { key: 'jobs',      label: 'Jobs' },
  { key: 'payouts',   label: 'Payouts' },
  { key: 'reviews',   label: 'Reviews' },
  { key: 'disputes',  label: 'Disputes' },
  { key: 'contracts', label: 'Contracts' },
  { key: 'system',    label: 'System' },
];

function matchesFilter(n: NotificationRow, f: FilterKey): boolean {
  if (f === 'all') return true;
  if (f === 'unread') return !n.isRead;
  if (f === 'messages')  return n.kind === 'message';
  if (f === 'jobs')      return ['assignment', 'application_status', 'job_moderated'].includes(n.kind);
  if (f === 'payouts')   return n.kind === 'payout_released';
  if (f === 'reviews')   return n.kind === 'review_received';
  if (f === 'disputes')  return n.kind === 'dispute_filed' || n.kind === 'dispute_update';
  if (f === 'contracts') return n.kind === 'contract_assigned';
  if (f === 'system')    return n.kind === 'system' || n.kind === 'document_uploaded';
  return true;
}

function groupBucket(iso: string): 'Today' | 'Yesterday' | 'This week' | 'Earlier' {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Earlier';
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);
  if (d > weekAgo) return 'This week';
  return 'Earlier';
}

interface PageProps {
  searchParams?: Promise<{ filter?: string }>;
}

export default async function NotificationsPage({ searchParams }: PageProps) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/notifications'));

  const sp = (await searchParams) ?? {};
  const activeFilter: FilterKey = (() => {
    const v = (sp.filter ?? 'all') as FilterKey;
    return FILTERS.some((f) => f.key === v) ? v : 'all';
  })();

  const items = await fetchMyNotifications(200);
  const unread = items.filter((n) => !n.isRead).length;
  const visible = items.filter((n) => matchesFilter(n, activeFilter));

  type BucketKey = 'Today' | 'Yesterday' | 'This week' | 'Earlier';
  const todayList: NotificationRow[] = [];
  const yesterdayList: NotificationRow[] = [];
  const thisWeekList: NotificationRow[] = [];
  const earlierList: NotificationRow[] = [];
  for (const n of visible) {
    const key = groupBucket(n.createdAt);
    if (key === 'Today') todayList.push(n);
    else if (key === 'Yesterday') yesterdayList.push(n);
    else if (key === 'This week') thisWeekList.push(n);
    else earlierList.push(n);
  }
  const orderedBuckets: Array<[BucketKey, NotificationRow[]]> = [
    ['Today', todayList],
    ['Yesterday', yesterdayList],
    ['This week', thisWeekList],
    ['Earlier', earlierList],
  ];

  // Detect role to point the "back" link at the right dashboard.
  let backHref = '/';
  let backLabel = 'Home';
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    const role = ((prof as { role?: unknown } | null)?.role ?? '')
      .toString()
      .toLowerCase();
    if (role === 'admin' || role === 'super_admin') {
      backHref = '/admin/dashboard';
      backLabel = 'Admin dashboard';
    } else if (role === 'inspector') {
      backHref = '/inspector/dashboard';
      backLabel = 'Inspector dashboard';
    } else if (['client', 'agency', 'enterprise'].includes(role)) {
      backHref = '/client/dashboard';
      backLabel = 'Client dashboard';
    }
  } catch {
    /* fall through to root */
  }

  return (
    <main className="container-narrow py-10">
      {/* Back link — explicit so users always have a way out of the feed. */}
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition-colors hover:text-violet-glow"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Back to {backLabel}
      </Link>

      <header className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Notifications
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Activity feed
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Every cross-role signal: messages, job updates, payouts, reviews,
            disputes, contracts.{' '}
            {unread > 0 && (
              <span className="text-violet-glow">
                {unread} unread.
              </span>
            )}
          </p>
        </div>
        {unread > 0 && (
          <form action={markAllNotificationsRead}>
            <input
              type="hidden"
              name="returnTo"
              value={`/notifications${activeFilter !== 'all' ? `?filter=${activeFilter}` : ''}`}
            />
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-200 hover:border-violet/40 hover:text-white"
            >
              <Check className="h-3 w-3" strokeWidth={1.75} />
              Mark all read
            </button>
          </form>
        )}
      </header>

      {/* Filter pills */}
      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Filter notifications">
        {FILTERS.map((f) => {
          const isActive = f.key === activeFilter;
          const href = f.key === 'all' ? '/notifications' : `/notifications?filter=${f.key}`;
          const count =
            f.key === 'all'
              ? items.length
              : items.filter((n) => matchesFilter(n, f.key)).length;
          return (
            <Link
              key={f.key}
              href={href}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                isActive
                  ? 'border-violet/40 bg-violet/10 text-violet-glow'
                  : 'border-white/10 bg-white/[0.02] text-zinc-400 hover:border-violet/30 hover:text-white'
              }`}
            >
              {f.label}
              <span
                className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] ${
                  isActive ? 'bg-violet text-white' : 'bg-white/[0.06] text-zinc-400'
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      <section className="mt-6 space-y-6">
        {visible.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
            <Bell className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-zinc-400">
              {activeFilter === 'all' || activeFilter === 'unread'
                ? 'No notifications yet.'
                : `No ${FILTERS.find((f) => f.key === activeFilter)?.label.toLowerCase() ?? ''} notifications.`}
            </p>
            <p className="mt-1 text-[11px] text-zinc-600">
              Activity will appear here in real time — no refresh needed.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Link
                href={backHref}
                className="inline-flex items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold text-violet-glow hover:bg-violet/20"
              >
                <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={2} />
                {backLabel}
              </Link>
              <Link
                href="/admin/diagnostics"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-300 hover:border-violet/30 hover:text-white"
              >
                System diagnostics
              </Link>
            </div>
          </div>
        ) : (
          orderedBuckets.map(([label, list]) =>
            list.length === 0 ? null : (
              <div key={label}>
                <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
                  {label}
                </h2>
                <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
                  {list.map((n) => (
                    <NotificationItem key={n.id} n={n} activeFilter={activeFilter} />
                  ))}
                </ul>
              </div>
            ),
          )
        )}
      </section>
    </main>
  );
}

function NotificationItem({
  n,
  activeFilter,
}: {
  n: NotificationRow;
  activeFilter: FilterKey;
}) {
  const returnTo = `/notifications${activeFilter !== 'all' ? `?filter=${activeFilter}` : ''}`;
  return (
    <li className="flex items-start gap-3 px-4 py-4 sm:px-5">
      <span
        className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
          n.isRead
            ? 'bg-white/[0.03] text-zinc-500 ring-white/10'
            : 'bg-violet/15 text-violet-glow ring-violet/30'
        }`}
      >
        <KindIcon kind={n.kind} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className={`truncate text-sm font-semibold ${n.isRead ? 'text-zinc-400' : 'text-white'}`}>
              {n.title}
            </p>
            <KindChip kind={n.kind} />
          </div>
          <time className="shrink-0 text-[11px] text-zinc-500">
            {formatRelative(n.createdAt)}
          </time>
        </div>
        {n.body && <p className="mt-1 text-xs text-zinc-500">{n.body}</p>}
        <div className="mt-2 flex items-center gap-2">
          {n.linkHref && (
            <Link
              href={n.linkHref}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-[11px] font-semibold text-violet-glow hover:bg-violet/20"
            >
              Open
            </Link>
          )}
          {!n.isRead && (
            <form action={markNotificationRead}>
              <input type="hidden" name="id" value={n.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold text-zinc-400 hover:border-violet/40 hover:text-white"
              >
                <Check className="h-3 w-3" strokeWidth={1.75} />
                Mark read
              </button>
            </form>
          )}
        </div>
      </div>
    </li>
  );
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  const cls = 'h-4 w-4';
  const stroke = 1.75;
  switch (kind) {
    case 'message':           return <MessageCircle className={cls} strokeWidth={stroke} />;
    case 'job_moderated':     return <ShieldCheck className={cls} strokeWidth={stroke} />;
    case 'application_status':
    case 'assignment':        return <Briefcase className={cls} strokeWidth={stroke} />;
    case 'report_submitted':
    case 'report_approved':   return <FileCheck2 className={cls} strokeWidth={stroke} />;
    case 'payout_released':   return <Wallet className={cls} strokeWidth={stroke} />;
    case 'review_received':   return <Star className={cls} strokeWidth={stroke} />;
    case 'dispute_filed':
    case 'dispute_update':    return <AlertTriangle className={cls} strokeWidth={stroke} />;
    case 'document_uploaded': return <FolderOpen className={cls} strokeWidth={stroke} />;
    case 'contract_assigned': return <FileCheck2 className={cls} strokeWidth={stroke} />;
    default:                  return <Settings className={cls} strokeWidth={stroke} />;
  }
}

function KindChip({ kind }: { kind: NotificationKind }) {
  const label = (() => {
    switch (kind) {
      case 'message': return 'Message';
      case 'assignment': return 'Job';
      case 'application_status': return 'Application';
      case 'job_moderated': return 'Moderation';
      case 'payout_released': return 'Payout';
      case 'review_received': return 'Review';
      case 'dispute_filed':
      case 'dispute_update':   return 'Dispute';
      case 'contract_assigned': return 'Contract';
      case 'document_uploaded': return 'Document';
      case 'report_submitted':
      case 'report_approved':   return 'Report';
      default: return 'System';
    }
  })();
  return (
    <span className="hidden shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-zinc-500 sm:inline">
      {label}
    </span>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return d.toLocaleDateString();
}
