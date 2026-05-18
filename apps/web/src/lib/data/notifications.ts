// ════════════════════════════════════════════════════════════════════════════
//  lib/data/notifications.ts
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { NotificationKind, NotificationRow } from './notifications.types';

export type { NotificationRow };

export async function fetchMyNotifications(
  limit: number = 50,
): Promise<NotificationRow[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('notifications')
      .select(
        'id, recipient_id, kind, title, body, link_href, job_id, is_read, created_at, read_at',
      )
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      recipientId: String(r.recipient_id),
      kind: ((r.kind as string | null) ?? 'system') as NotificationKind,
      title: String(r.title ?? ''),
      body: (r.body as string | null) ?? null,
      linkHref: (r.link_href as string | null) ?? null,
      jobId: (r.job_id as string | null) ?? null,
      isRead: Boolean(r.is_read),
      createdAt: String(r.created_at ?? ''),
      readAt: (r.read_at as string | null) ?? null,
    }));
  } catch {
    return [];
  }
}

export async function fetchMyUnreadCount(): Promise<number> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 0;
    const { data, error } = await supabase
      .from('profiles')
      .select('unread_notifications_count')
      .eq('id', user.id)
      .maybeSingle();
    if (error || !data) return 0;
    const n = (data as { unread_notifications_count?: unknown }).unread_notifications_count;
    return typeof n === 'number' ? n : 0;
  } catch {
    return 0;
  }
}
