// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientDashboardWidgets.ts — pending-action + activity rollups
//
//  Powers the new dashboard cards: "What needs your attention" (unsigned
//  contracts, unaccepted required clauses on assigned jobs, open disputes,
//  new applications), recent notifications, recent activity, and a recent
//  jobs row.
//
//  Everything RLS-gated; defensive try/catch around each query so a single
//  missing table doesn't crash the dashboard.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface PendingActions {
  unsignedContracts: number;
  openDisputesByMe: number;
  jobsPendingMyReview: number;
  unreadMessages: number;
  unreadNotifications: number;
}

export interface RecentJob {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  escrowPaused: boolean | null;
}

export interface RecentNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  linkHref: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface ClientDashboardWidgets {
  pending: PendingActions;
  recentJobs: RecentJob[];
  recentNotifications: RecentNotification[];
  helpSupportConversationId: string | null;
}

export async function fetchClientDashboardWidgets(): Promise<ClientDashboardWidgets> {
  const empty: ClientDashboardWidgets = {
    pending: {
      unsignedContracts: 0,
      openDisputesByMe: 0,
      jobsPendingMyReview: 0,
      unreadMessages: 0,
      unreadNotifications: 0,
    },
    recentJobs: [],
    recentNotifications: [],
    helpSupportConversationId: null,
  };

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return empty;

    // Pending — unsigned required contracts
    let unsignedContracts = 0;
    try {
      const { count } = await supabase
        .from('contract_assignments')
        .select('id', { count: 'exact', head: true })
        .eq('party_id', user.id)
        .eq('required', true)
        .is('signed_at', null);
      unsignedContracts = count ?? 0;
    } catch {
      /* table may not exist or RLS denies — keep 0 */
    }

    // Pending — open disputes I opened
    let openDisputesByMe = 0;
    try {
      const { count } = await supabase
        .from('disputes')
        .select('id', { count: 'exact', head: true })
        .eq('opener_id', user.id)
        .in('status', ['open', 'investigating']);
      openDisputesByMe = count ?? 0;
    } catch {
      /* ignore */
    }

    // Pending — jobs awaiting review (status in_progress or under_review on my jobs)
    let jobsPendingMyReview = 0;
    try {
      const { count } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', user.id)
        .in('status', ['under_review', 'awaiting_approval']);
      jobsPendingMyReview = count ?? 0;
    } catch {
      /* ignore */
    }

    // Unread messages (sum of unread_for_user across own conversations)
    let unreadMessages = 0;
    try {
      const { data: convs } = await supabase
        .from('conversations')
        .select('unread_for_user')
        .eq('user_id', user.id);
      if (convs) {
        for (const c of convs as unknown as Array<{ unread_for_user?: number | null }>) {
          unreadMessages += typeof c.unread_for_user === 'number' ? c.unread_for_user : 0;
        }
      }
    } catch {
      /* ignore */
    }

    // Unread notifications — read straight from profiles counter
    let unreadNotifications = 0;
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('unread_notifications_count')
        .eq('id', user.id)
        .maybeSingle();
      const n = (prof as { unread_notifications_count?: number | null } | null)
        ?.unread_notifications_count;
      unreadNotifications = typeof n === 'number' ? n : 0;
    } catch {
      /* ignore */
    }

    // Recent jobs — last 5
    let recentJobs: RecentJob[] = [];
    try {
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, title, status, created_at, escrow_paused')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      if (jobs) {
        recentJobs = (jobs as unknown as Array<Record<string, unknown>>).map((j) => ({
          id: String(j.id),
          title: String(j.title ?? 'Inspection'),
          status: String(j.status ?? 'open'),
          createdAt: String(j.created_at ?? ''),
          escrowPaused: (j.escrow_paused as boolean | null) ?? null,
        }));
      }
    } catch {
      /* ignore */
    }

    // Recent notifications — last 5
    let recentNotifications: RecentNotification[] = [];
    try {
      const { data: notifs } = await supabase
        .from('notifications')
        .select('id, kind, title, body, link_href, is_read, created_at')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      if (notifs) {
        recentNotifications = (notifs as unknown as Array<Record<string, unknown>>).map(
          (n) => ({
            id: String(n.id),
            kind: String(n.kind ?? 'system'),
            title: String(n.title ?? ''),
            body: (n.body as string | null) ?? null,
            linkHref: (n.link_href as string | null) ?? null,
            isRead: Boolean(n.is_read),
            createdAt: String(n.created_at ?? ''),
          }),
        );
      }
    } catch {
      /* ignore */
    }

    // Help & Support conversation id — for the inline composer on the dashboard
    let helpSupportConversationId: string | null = null;
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .select('id')
        .eq('user_id', user.id)
        .eq('kind', 'help_support')
        .maybeSingle();
      helpSupportConversationId = (conv as { id?: string | null } | null)?.id ?? null;
    } catch {
      /* ignore */
    }

    return {
      pending: {
        unsignedContracts,
        openDisputesByMe,
        jobsPendingMyReview,
        unreadMessages,
        unreadNotifications,
      },
      recentJobs,
      recentNotifications,
      helpSupportConversationId,
    };
  } catch {
    return empty;
  }
}
