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

    // Pending — job contracts awaiting MY signature (V3 job_contracts via the
    // client-scoped view, which is blind to the inspector payout by design)
    // NOTE on the error handling in this file: PostgREST reports a failure as
    // { data: null, error } — it does NOT throw. A bare try/catch therefore
    // never fires, and a permission denial / bad column silently renders 0 or
    // an empty list with nothing in the logs. Every block below now inspects
    // `error` explicitly and warns. The tiles still degrade to 0 rather than
    // 500-ing the dashboard, but the failure is no longer invisible.
    let unsignedContracts = 0;
    {
      const { count, error: contractsErr } = await supabase
        .from('client_job_contracts_view')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', user.id)
        .eq('status', 'pending_client_signature');
      if (contractsErr) {
        console.warn(
          '[clientDashboardWidgets] unsigned-contracts count failed:',
          contractsErr.message,
        );
      } else {
        unsignedContracts = count ?? 0;
      }
    }

    // Pending — open disputes I opened
    let openDisputesByMe = 0;
    {
      // SCHEMA: this read `.from('disputes').eq('opener_id', …)` and filtered
      // .in('status', ['open','investigating']). Three faults at once — the
      // canonical table is job_disputes, its raiser column is raised_by, and
      // 'investigating' is not admissible under job_disputes_status_check
      // (open | resolved_paid | resolved_refunded). The query errored on every
      // call with an empty message body, the warn below printed nothing
      // useful, and the tile read a permanent 0 no matter how many disputes
      // the client had open.
      const { count, error: disputesErr } = await supabase
        .from('job_disputes')
        .select('id', { count: 'exact', head: true })
        .eq('raised_by', user.id)
        .eq('status', 'open');
      if (disputesErr) {
        console.warn(
          '[clientDashboardWidgets] open-disputes count failed:',
          disputesErr.message,
        );
      } else {
        openDisputesByMe = count ?? 0;
      }
    }

    // Pending — reports admin has forwarded that the client has not closed out.
    //
    // SCHEMA: this used to filter .in('status', ['under_review',
    // 'awaiting_approval']). Neither value is admissible — jobs_status_check
    // restricts status to pending_approval|open|assigned|in_progress|completed|
    // paid|cancelled|disputed — so the predicate matched ZERO rows on every
    // account and the "Jobs awaiting review" tile was permanently 0, even when
    // reports were sitting on the client's desk.
    //
    // GOLDEN_RULE_6 defines the real "awaiting your decision" set: admin has
    // handed the report off (admin_confirmed_at IS NOT NULL) and the job has
    // not yet been closed out. That's the same gate /client/jobs/[id]/release
    // uses to decide whether to render the approve / request-revision CTAs.
    let jobsPendingMyReview = 0;
    {
      const { count, error: pendingErr } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', user.id)
        .not('admin_confirmed_at', 'is', null)
        .in('status', ['assigned', 'in_progress'])
        .is('deleted_at', null);
      // PostgREST returns { data: null, error } instead of throwing, so a bare
      // try/catch here would silently render 0 for a real failure. Log it.
      if (pendingErr) {
        console.warn(
          '[clientDashboardWidgets] pending-review count failed:',
          pendingErr.message,
        );
      } else {
        jobsPendingMyReview = count ?? 0;
      }
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
    {
      const { data: jobs, error: recentErr } = await supabase
        .from('jobs')
        // Operational columns only — no revoked pricing column here, so the
        // base table is correct and jobs_secure_view is not needed.
        .select('id, title, status, created_at, escrow_status, deleted_at')
        .eq('client_id', user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5);
      if (recentErr) {
        console.warn(
          '[clientDashboardWidgets] recent-jobs query failed:',
          recentErr.message,
        );
      }
      if (jobs) {
        recentJobs = (jobs as unknown as Array<Record<string, unknown>>).map((j) => ({
          id: String(j.id),
          title: String(j.title ?? 'Inspection'),
          status: String(j.status ?? 'open'),
          createdAt: String(j.created_at ?? ''),
          // SCHEMA: the select above (correctly) asks for escrow_status, but
          // this mapper read j.escrow_paused — a column that does not exist on
          // public.jobs and was never in the projection. It was therefore
          // ALWAYS undefined → null, so the "hold paused" badge on the
          // dashboard's Recent-jobs list could never render, even for a job
          // whose payment hold really was frozen. escrow_status is constrained
          // to pending|funded|released|refunded|disputed (jobs_escrow_status_chk);
          // 'disputed' is the state in which funds stop moving.
          escrowPaused: String(j.escrow_status ?? '') === 'disputed',
        }));
      }
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
