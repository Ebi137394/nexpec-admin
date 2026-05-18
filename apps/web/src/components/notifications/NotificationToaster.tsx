// ════════════════════════════════════════════════════════════════════════════
//  components/notifications/NotificationToaster.tsx
//
//  Client-side, fixed-position toast layer. Subscribes to the user's
//  `notifications` realtime stream and pops a slide-in toast for each new
//  arrival. Toasts auto-dismiss after 6s; clicking opens the linkHref.
//
//  Mount inside layouts (one per portal) so it lives across navigations.
//  Pairs with NotificationBellLive — both share the same subscription
//  semantics, but use different channel names so they don't conflict.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';
import {
  Bell,
  X,
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

interface ToastNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkHref: string | null;
  createdAt: string;
}

interface Props {
  userId: string;
}

const TOAST_TTL_MS = 6000;
const MAX_TOASTS = 4;

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

export function NotificationToaster({ userId }: Props) {
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const seenIdsRef = useRef<Set<string>>(new Set());

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

  function dismiss(id: string) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const t = timersRef.current[id];
    if (t) {
      clearTimeout(t);
      delete timersRef.current[id];
    }
  }

  function push(n: ToastNotification) {
    if (seenIdsRef.current.has(n.id)) return;
    seenIdsRef.current.add(n.id);
    setToasts((prev) => {
      const next = [n, ...prev];
      return next.slice(0, MAX_TOASTS);
    });
    timersRef.current[n.id] = setTimeout(() => dismiss(n.id), TOAST_TTL_MS);

    // Also play a discreet ping if supported
    try {
      if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
        navigator.vibrate?.(15);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!supabase || !userId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel(`toaster:${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `recipient_id=eq.${userId}`,
          },
          (payload) => {
            try {
              const r = payload.new as Record<string, unknown>;
              push({
                id: String(r.id),
                kind: String(r.kind ?? 'system'),
                title: String(r.title ?? 'New notification'),
                body: (r.body as string | null) ?? null,
                linkHref: (r.link_href as string | null) ?? null,
                createdAt: String(r.created_at ?? new Date().toISOString()),
              });
            } catch {
              /* ignore */
            }
          },
        )
        .subscribe();
    } catch (e) {
      if (typeof console !== 'undefined') {
        console.warn('[NotificationToaster] subscribe failed:', e);
      }
    }
    return () => {
      try {
        Object.values(timersRef.current).forEach((t) => clearTimeout(t));
        timersRef.current = {};
        if (channel) supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, userId]);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto group relative overflow-hidden rounded-2xl border border-violet/30 bg-ink-950/95 shadow-2xl backdrop-blur-xl animate-toast-slide-in"
          style={{
            animation: 'toast-slide-in 0.35s ease-out',
          }}
        >
          {/* Progress bar */}
          <span
            aria-hidden
            className="absolute left-0 top-0 h-0.5 w-full origin-left bg-violet"
            style={{ animation: `toast-progress ${TOAST_TTL_MS}ms linear forwards` }}
          />
          <div className="flex items-start gap-3 p-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
              <KindIcon kind={t.kind} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{t.title}</p>
              {t.body && (
                <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-400">
                  {t.body}
                </p>
              )}
              <div className="mt-2 flex items-center gap-2">
                {t.linkHref && (
                  <Link
                    href={t.linkHref}
                    onClick={() => dismiss(t.id)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-2.5 py-0.5 text-[10px] font-semibold text-violet-glow hover:bg-violet/20"
                  >
                    Open
                  </Link>
                )}
                <Link
                  href="/notifications"
                  onClick={() => dismiss(t.id)}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  View all
                </Link>
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-white/[0.05] hover:text-white"
            >
              <X className="h-3 w-3" strokeWidth={1.75} />
            </button>
          </div>
        </div>
      ))}

      {/* Keyframes — scoped inline so we don't fight Tailwind config */}
      <style jsx global>{`
        @keyframes toast-slide-in {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        @keyframes toast-progress {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
      {/* Hidden accessible alias used by screen readers as a sentinel. */}
      <span className="sr-only">
        <Bell aria-hidden />
        {toasts.length} new {toasts.length === 1 ? 'notification' : 'notifications'}
      </span>
    </div>
  );
}
