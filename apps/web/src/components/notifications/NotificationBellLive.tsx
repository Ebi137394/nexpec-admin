// ════════════════════════════════════════════════════════════════════════════
//  components/notifications/NotificationBellLive.tsx — live header bell
//
//  Client component. Subscribes to `public.notifications` realtime channel
//  filtered by recipient_id. New INSERTs increment the badge live, no page
//  reload. UPDATE events flip the badge down when a notification is read.
//
//  Renders a dropdown preview when clicked so users see the latest 5
//  notifications without leaving the page.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
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

interface InitialNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkHref: string | null;
  isRead: boolean;
  createdAt: string;
}

interface Props {
  userId: string;
  initialUnreadCount: number;
  initialRecent: InitialNotification[];
}

function KindIcon({ kind }: { kind: string }) {
  const cls = 'h-4 w-4';
  const sw = 1.75;
  switch (kind) {
    case 'message':           return <MessageCircle className={cls} strokeWidth={sw} />;
    case 'job_moderated':     return <ShieldCheck className={cls} strokeWidth={sw} />;
    case 'application_status':
    case 'assignment':        return <Briefcase className={cls} strokeWidth={sw} />;
    case 'report_submitted':
    case 'report_approved':   return <FileCheck2 className={cls} strokeWidth={sw} />;
    case 'payout_released':   return <Wallet className={cls} strokeWidth={sw} />;
    case 'review_received':   return <Star className={cls} strokeWidth={sw} />;
    case 'dispute_filed':
    case 'dispute_update':    return <AlertTriangle className={cls} strokeWidth={sw} />;
    case 'document_uploaded': return <FolderOpen className={cls} strokeWidth={sw} />;
    case 'contract_assigned': return <FileCheck2 className={cls} strokeWidth={sw} />;
    default:                  return <Settings className={cls} strokeWidth={sw} />;
  }
}

function relTime(iso: string): string {
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

export function NotificationBellLive({
  userId,
  initialUnreadCount,
  initialRecent,
}: Props) {
  const [count, setCount] = useState<number>(initialUnreadCount);
  const [recent, setRecent] = useState<InitialNotification[]>(initialRecent);
  const [open, setOpen] = useState<boolean>(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const supabase = useMemo(() => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) return null;
      return createBrowserClient(url, anon);
    } catch {
      return null;
    }
  }, []);

  // Click-outside closes the panel.
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Polling fallback — even if Realtime isn't enabled on the notifications
  // table, we still refresh the badge every 25 seconds AND whenever the tab
  // regains focus. This ensures the bell never stays cold.
  useEffect(() => {
    if (!supabase || !userId) return;

    let stopped = false;
    async function refresh() {
      try {
        const { data: profile } = await supabase!
          .from('profiles')
          .select('unread_notifications_count')
          .eq('id', userId)
          .maybeSingle();
        if (stopped) return;
        const n = (profile as { unread_notifications_count?: unknown } | null)
          ?.unread_notifications_count;
        if (typeof n === 'number') setCount(n);

        const { data: rows } = await supabase!
          .from('notifications')
          .select('id, kind, title, body, link_href, is_read, created_at')
          .eq('recipient_id', userId)
          .order('created_at', { ascending: false })
          .limit(8);
        if (stopped || !Array.isArray(rows)) return;
        setRecent(
          rows.map((r: Record<string, unknown>) => ({
            id: String(r.id),
            kind: String(r.kind ?? 'system'),
            title: String(r.title ?? ''),
            body: (r.body as string | null) ?? null,
            linkHref: (r.link_href as string | null) ?? null,
            isRead: Boolean(r.is_read),
            createdAt: String(r.created_at ?? ''),
          })),
        );
      } catch (e) {
        if (typeof console !== 'undefined') {
          console.warn('[NotificationBell poll] refresh failed:', e);
        }
      }
    }

    // initial refresh + interval
    refresh();
    const interval = setInterval(refresh, 25_000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [supabase, userId]);

  // Realtime subscription. Logs the SUBSCRIBED/CHANNEL_ERROR status to the
  // browser console so we can verify the publication is wired without
  // having to read server logs.
  useEffect(() => {
    if (!supabase || !userId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_id=eq.${userId}`,
          },
          (payload) => {
            try {
              const r = payload.new as Record<string, unknown>;
              const next: InitialNotification = {
                id: String(r.id),
                kind: String(r.kind ?? 'system'),
                title: String(r.title ?? ''),
                body: (r.body as string | null) ?? null,
                linkHref: (r.link_href as string | null) ?? null,
                isRead: Boolean(r.is_read),
                createdAt: String(r.created_at ?? new Date().toISOString()),
              };
              setRecent((prev) =>
                prev.some((n) => n.id === next.id)
                  ? prev
                  : [next, ...prev].slice(0, 8),
              );
              if (!next.isRead) setCount((c) => c + 1);
              // Optional: browser notification
              try {
                if (
                  typeof Notification !== 'undefined' &&
                  Notification.permission === 'granted'
                ) {
                  new Notification(next.title, {
                    body: next.body ?? undefined,
                    icon: '/icon.png',
                    tag: next.id,
                  });
                }
              } catch {
                /* ignore */
              }
            } catch {
              /* ignore */
            }
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_id=eq.${userId}`,
          },
          (payload) => {
            try {
              const r = payload.new as Record<string, unknown>;
              const id = String(r.id);
              const isRead = Boolean(r.is_read);
              setRecent((prev) =>
                prev.map((n) => (n.id === id ? { ...n, isRead } : n)),
              );
              const oldRow = (payload.old ?? {}) as Record<string, unknown>;
              if (isRead && oldRow.is_read === false) {
                setCount((c) => Math.max(0, c - 1));
              }
            } catch {
              /* ignore */
            }
          },
        )
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(
              '[NotificationBellLive] realtime degraded, falling back to 25s polling',
            );
          }
        });
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.warn('[NotificationBellLive] subscribe threw:', e);
      }
    }
    return () => {
      try {
        if (channel) supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [supabase, userId]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.05] hover:text-white"
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-violet px-1 text-[9px] font-semibold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Recent notifications"
          className="absolute right-0 top-12 z-50 w-[min(380px,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-2xl border border-white/10 bg-ink-950/95 shadow-2xl backdrop-blur-xl"
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-industrial text-zinc-300">
              Notifications {count > 0 && <span className="ml-1 text-violet-glow">{count}</span>}
            </p>
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-[11px] font-semibold text-violet-glow hover:text-white"
            >
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="p-8 text-center">
              <Bell className="mx-auto h-7 w-7 text-zinc-700" strokeWidth={1.5} />
              <p className="mt-3 text-xs text-zinc-500">No notifications yet.</p>
              <p className="mt-1 text-[11px] text-zinc-600">
                Activity will appear here in real time.
              </p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-white/[0.05] overflow-y-auto">
              {recent.slice(0, 8).map((n) => (
                <li key={n.id} className="px-3 py-3 hover:bg-white/[0.02]">
                  <Link
                    href={n.linkHref ?? '/notifications'}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-3"
                  >
                    <span
                      className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ${
                        n.isRead
                          ? 'bg-white/[0.03] text-zinc-500 ring-white/10'
                          : 'bg-violet/15 text-violet-glow ring-violet/30'
                      }`}
                    >
                      <KindIcon kind={n.kind} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={`truncate text-xs font-semibold ${n.isRead ? 'text-zinc-400' : 'text-white'}`}>
                          {n.title}
                        </p>
                        <span className="shrink-0 text-[10px] text-zinc-500">
                          {relTime(n.createdAt)}
                        </span>
                      </div>
                      {n.body && (
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">
                          {n.body}
                        </p>
                      )}
                    </div>
                    {!n.isRead && (
                      <span className="mt-2 inline-block h-2 w-2 shrink-0 rounded-full bg-violet" />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-white/[0.06] px-4 py-2 text-[10px] text-zinc-600">
            Live updates, powered by Supabase Realtime
            <button
              type="button"
              onClick={() => {
                try {
                  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
                    Notification.requestPermission();
                  }
                } catch {
                  /* ignore */
                }
              }}
              className="ml-2 text-violet-glow hover:text-white"
            >
              Enable browser pop-ups
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
