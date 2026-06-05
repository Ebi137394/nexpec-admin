// ════════════════════════════════════════════════════════════════════════════
//  components/NotificationBell.tsx — header bell with unread badge
//
//  Server component; reads the unread count from profiles.unread_notifications_count.
//  Renders a link to /notifications. A future revision can swap in a client
//  component with Supabase Realtime subscription for live badge updates;
//  current implementation polls on each route navigation via dynamic render.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { fetchMyUnreadCount } from '@/lib/data/notifications';

export async function NotificationBell() {
  const count = await fetchMyUnreadCount();
  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.05] hover:text-white"
    >
      <Bell className="h-4 w-4" strokeWidth={1.75} />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-violet px-1 text-[9px] font-semibold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
