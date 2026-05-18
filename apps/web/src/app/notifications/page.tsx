// ════════════════════════════════════════════════════════════════════════════
//  app/notifications/page.tsx — full notification feed (all roles)
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
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchMyNotifications } from '@/lib/data/notifications';
import {
  markNotificationRead,
  markAllNotificationsRead,
} from '@/lib/actions/notifications';
import type { NotificationKind } from '@/lib/data/notifications.types';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/notifications'));

  const items = await fetchMyNotifications(100);
  const unread = items.filter((n) => !n.isRead).length;

  return (
    <main className="container-narrow py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
            <input type="hidden" name="returnTo" value="/notifications" />
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

      <section className="mt-8">
        {items.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
            <Bell className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-zinc-400">No notifications yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
            {items.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-4 py-4 sm:px-5">
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
                    <p className={`truncate text-sm font-semibold ${n.isRead ? 'text-zinc-400' : 'text-white'}`}>
                      {n.title}
                    </p>
                    <time className="shrink-0 text-[11px] text-zinc-500">
                      {formatRelative(n.createdAt)}
                    </time>
                  </div>
                  {n.body && (
                    <p className="mt-1 text-xs text-zinc-500">{n.body}</p>
                  )}
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
                        <input type="hidden" name="returnTo" value="/notifications" />
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
            ))}
          </ul>
        )}
      </section>
    </main>
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
