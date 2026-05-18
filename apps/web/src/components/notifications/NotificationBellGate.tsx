// ════════════════════════════════════════════════════════════════════════════
//  components/notifications/NotificationBellGate.tsx
//
//  Server component. Fetches initial unread count + the 8 most recent
//  notifications for the signed-in user, then hands off to the live
//  client bell. If the user is signed-out (or anything else fails), we
//  render a static, inert bell so the header layout never collapses.
// ════════════════════════════════════════════════════════════════════════════

import { Bell } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { NotificationBellLive } from './NotificationBellLive';

export async function NotificationBellGate() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return (
        <span
          aria-hidden
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-zinc-500"
        >
          <Bell className="h-4 w-4" strokeWidth={1.75} />
        </span>
      );
    }

    // Unread count from cached profile counter (best-effort)
    let unread = 0;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('unread_notifications_count')
        .eq('id', user.id)
        .maybeSingle();
      const n = (data as { unread_notifications_count?: unknown } | null)
        ?.unread_notifications_count;
      unread = typeof n === 'number' ? n : 0;
    } catch {
      unread = 0;
    }

    // 8 most recent (best-effort)
    let recent: Array<{
      id: string;
      kind: string;
      title: string;
      body: string | null;
      linkHref: string | null;
      isRead: boolean;
      createdAt: string;
    }> = [];
    try {
      const { data } = await supabase
        .from('notifications')
        .select('id, kind, title, body, link_href, is_read, created_at')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false })
        .limit(8);
      if (Array.isArray(data)) {
        recent = data.map((r: Record<string, unknown>) => ({
          id: String(r.id),
          kind: String(r.kind ?? 'system'),
          title: String(r.title ?? ''),
          body: (r.body as string | null) ?? null,
          linkHref: (r.link_href as string | null) ?? null,
          isRead: Boolean(r.is_read),
          createdAt: String(r.created_at ?? ''),
        }));
      }
    } catch {
      recent = [];
    }

    return (
      <NotificationBellLive
        userId={user.id}
        initialUnreadCount={unread}
        initialRecent={recent}
      />
    );
  } catch {
    return (
      <span
        aria-hidden
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-zinc-500"
      >
        <Bell className="h-4 w-4" strokeWidth={1.75} />
      </span>
    );
  }
}
