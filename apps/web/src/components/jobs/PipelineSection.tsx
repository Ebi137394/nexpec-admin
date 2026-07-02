// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/jobs/PipelineSection.tsx
//
//  Server Component "Awaiting Action" strip — Next.js sibling of the
//  React Native PipelineSection at src/components/jobs/PipelineSection.tsx
//  on mobile. Same concept: surface jobs/applications/contracts that
//  live between the well-known states (`open` / `in_progress` /
//  `completed`) so users see what's actually waiting on them.
//
//  Drop-in for:
//    • apps/web/src/app/client/jobs/page.tsx       (buyer view)
//    • apps/web/src/app/inspector/assignments/page.tsx (inspector view)
//    • apps/web/src/app/inspector/jobs/page.tsx    (inspector secondary)
//
//  Strictly additive — no sidebar / nav changes per UX directive
//  (2026-05-20). Suppresses itself when nothing is pending (calm UI).
//
//  Role inferred from the parent page's tone prop:
//    tone="buyer"     → client/agency/enterprise queries
//    tone="inspector" → inspector queries
//
//  GR2: buyer queries never name payout columns; inspector queries
//  never name client_price_cents. The contracts views handle the
//  blind-pricing isolation at the DB layer.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  Hourglass,
  PenLine,
  ArrowLeftRight,
  Ribbon,
  Clock,
  ShieldCheck,
  ChevronRight,
  Flame,
  CheckCheck,
  DollarSign,
  FileText,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type Tone = 'buyer' | 'inspector' | 'admin';

type PipelineKind =
  | 'awaiting_your_signature'
  | 'counter_offer_received'
  | 'awarded_pending_contract'
  | 'awaiting_their_signature'
  | 'awaiting_admin_approval'
  // Safety net: contract is fully_executed but the parent jobs.status
  // hasn't advanced to 'in_progress' yet. The self-heal trigger should
  // make this state momentary, but if anything skips the trigger we want
  // the inspector to see the work instead of staring at an empty board.
  | 'kickoff_pending'
  // Admin gates (V3 contract state machine — admin holds 3 signoffs)
  | 'admin_open_dispute'
  | 'admin_pending_signoff'
  | 'admin_milestone_request'
  | 'admin_pending_contract'
  | 'admin_pending_approval';

interface PipelineItem {
  id: string;
  kind: PipelineKind;
  jobId: string | null;
  jobTitle: string | null;
  amountCents: number | null;
  updatedAt: string | null;
  routeTo: string;
  ctaLabel: string;
}

interface Props {
  tone: Tone;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Route helpers — one choke point per role so future contributors don't
//  reinvent the URL shape and 404 themselves.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Build an admin-side inspect URL for an individual job. The admin section
 * intentionally has NO /admin/jobs/[id]/page.tsx — inspection happens via
 * a drawer on /admin/jobs?inspect=<jobId>. Routing anywhere else 404s.
 */
function adminJobInspectHref(jobId: string): string {
  return `/admin/jobs?inspect=${encodeURIComponent(jobId)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Server-side fetcher
// ─────────────────────────────────────────────────────────────────────────────
async function loadPipeline(tone: Tone): Promise<PipelineItem[]> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const collected: PipelineItem[] = [];

  // Title cache shared across both tones — `jobs.title` lookup by id.
  const titleByJobId = new Map<string, string | null>();
  async function hydrateTitles(ids: Array<string | null>) {
    const need = Array.from(
      new Set(
        ids.filter(
          (id): id is string => !!id && !titleByJobId.has(id),
        ),
      ),
    );
    if (need.length === 0) return;
    const { data } = await supabase
      .from('jobs')
      .select('id, title')
      .in('id', need);
    (data as Array<{ id: string; title: string | null }> | null)?.forEach(
      (j) => titleByJobId.set(j.id, j.title),
    );
  }

  if (tone === 'buyer') {
    const [contractsRes, pendingApprovalRes, assignedRes] = await Promise.all([
      supabase
        .from('client_job_contracts_view')
        .select('id, job_id, status, client_price_cents, updated_at')
        .eq('client_id', user.id)
        .in('status', ['pending_client_signature'])
        .order('updated_at', { ascending: false })
        .limit(15),
      supabase
        .from('jobs')
        .select('id, title, client_price_cents, status, updated_at')
        .eq('client_id', user.id)
        .eq('status', 'pending_approval')
        .order('updated_at', { ascending: false })
        .limit(15),
      supabase
        .from('jobs')
        .select('id, title, client_price_cents, status, updated_at')
        .eq('client_id', user.id)
        .eq('status', 'assigned')
        .order('updated_at', { ascending: false })
        .limit(15),
    ]);

    const contracts = (contractsRes.data ?? []) as Array<{
      id: string;
      job_id: string | null;
      client_price_cents: number | null;
      updated_at: string | null;
    }>;
    const pendingApprovals = (pendingApprovalRes.data ?? []) as Array<{
      id: string;
      title: string | null;
      client_price_cents: number | null;
      updated_at: string | null;
    }>;
    const assigned = (assignedRes.data ?? []) as Array<{
      id: string;
      title: string | null;
      client_price_cents: number | null;
      updated_at: string | null;
    }>;

    await hydrateTitles(contracts.map((c) => c.job_id));

    contracts.forEach((c) => {
      collected.push({
        id: `c:${c.id}`,
        kind: 'awaiting_your_signature',
        jobId: c.job_id,
        jobTitle: c.job_id ? titleByJobId.get(c.job_id) ?? null : null,
        amountCents: c.client_price_cents,
        updatedAt: c.updated_at,
        routeTo: `/client/contracts`,
        ctaLabel: 'Sign now',
      });
    });
    pendingApprovals.forEach((j) => {
      collected.push({
        id: `pa:${j.id}`,
        kind: 'awaiting_admin_approval',
        jobId: j.id,
        jobTitle: j.title,
        amountCents: j.client_price_cents,
        updatedAt: j.updated_at,
        routeTo: `/client/jobs/${j.id}`,
        ctaLabel: 'View',
      });
    });
    assigned.forEach((j) => {
      collected.push({
        id: `as:${j.id}`,
        kind: 'awaiting_their_signature',
        jobId: j.id,
        jobTitle: j.title,
        amountCents: j.client_price_cents,
        updatedAt: j.updated_at,
        routeTo: `/client/jobs/${j.id}`,
        ctaLabel: 'View',
      });
    });
  } else if (tone === 'inspector') {
    // INSPECTOR
    const [counterRes, contractRes, acceptedRes, executedRes] = await Promise.all([
      supabase
        .from('applications')
        .select(
          'id, job_id, admin_counter_cents, bid_amount_cents, updated_at',
        )
        .eq('applicant_id', user.id)
        .eq('negotiation_status', 'admin_countered')
        .order('updated_at', { ascending: false })
        .limit(15),
      supabase
        .from('inspector_job_contracts_view')
        .select('id, job_id, status, inspector_payout_cents, updated_at')
        .eq('inspector_id', user.id)
        .in('status', ['pending_inspector_signature'])
        .order('updated_at', { ascending: false })
        .limit(15),
      supabase
        .from('applications')
        .select('id, job_id, bid_amount_cents, status, updated_at')
        .eq('applicant_id', user.id)
        .in('status', ['accepted', 'CLIENT_SELECTED'])
        .order('updated_at', { ascending: false })
        .limit(15),
      // SAFETY NET: every fully_executed contract for this inspector. We
      // cross-check the job's status in code and only surface a kickoff_
      // pending row when the job hasn't advanced yet — i.e. the self-heal
      // trigger somehow didn't fire. In steady state this returns rows
      // that we silently drop, which is fine.
      supabase
        .from('inspector_job_contracts_view')
        .select('id, job_id, status, inspector_payout_cents, updated_at')
        .eq('inspector_id', user.id)
        .eq('status', 'fully_executed')
        .order('updated_at', { ascending: false })
        .limit(15),
    ]);

    const counters = (counterRes.data ?? []) as Array<{
      id: string;
      job_id: string;
      admin_counter_cents: number | null;
      bid_amount_cents: number | null;
      updated_at: string | null;
    }>;
    const contracts = (contractRes.data ?? []) as Array<{
      id: string;
      job_id: string | null;
      inspector_payout_cents: number | null;
      updated_at: string | null;
    }>;
    const accepted = (acceptedRes.data ?? []) as Array<{
      id: string;
      job_id: string;
      bid_amount_cents: number | null;
      updated_at: string | null;
    }>;
    const executed = (executedRes.data ?? []) as Array<{
      id: string;
      job_id: string | null;
      inspector_payout_cents: number | null;
      updated_at: string | null;
    }>;

    const contractJobIds = new Set(
      contracts.map((c) => c.job_id).filter((id): id is string => !!id),
    );

    // Identify executed-but-not-advanced jobs by reading jobs.status for
    // exactly those job_ids. We DON'T surface a kickoff row if jobs.status
    // is already in_progress / completed / disputed / cancelled — the
    // self-heal worked or the job moved on.
    const executedJobIds = executed
      .map((c) => c.job_id)
      .filter((id): id is string => !!id);
    const jobStatusByJobId = new Map<string, string | null>();
    if (executedJobIds.length > 0) {
      const { data: statusRows } = await supabase
        .from('jobs')
        .select('id, status')
        .in('id', executedJobIds);
      (statusRows as Array<{ id: string; status: string | null }> | null)?.forEach(
        (r) => jobStatusByJobId.set(r.id, r.status ?? null),
      );
    }
    const stalledExecuted = executed.filter((c) => {
      if (!c.job_id) return false;
      const s = jobStatusByJobId.get(c.job_id);
      // Surface only when the job is genuinely parked in a pre-execution
      // state. If the trigger worked (status = in_progress) we don't need
      // a pipeline row — the assignments fetcher will show it under
      // In Progress.
      return s !== 'in_progress'
          && s !== 'completed'
          && s !== 'disputed'
          && s !== 'cancelled'
          && s !== 'refunded';
    });

    await hydrateTitles([
      ...counters.map((c) => c.job_id),
      ...contracts.map((c) => c.job_id),
      ...accepted.map((a) => a.job_id),
      ...stalledExecuted.map((c) => c.job_id),
    ]);

    contracts.forEach((c) => {
      collected.push({
        id: `c:${c.id}`,
        kind: 'awaiting_your_signature',
        jobId: c.job_id,
        jobTitle: c.job_id ? titleByJobId.get(c.job_id) ?? null : null,
        amountCents: c.inspector_payout_cents,
        updatedAt: c.updated_at,
        routeTo: `/inspector/contracts`,
        ctaLabel: 'Sign now',
      });
    });
    counters.forEach((a) => {
      collected.push({
        id: `co:${a.id}`,
        kind: 'counter_offer_received',
        jobId: a.job_id,
        jobTitle: titleByJobId.get(a.job_id) ?? null,
        amountCents: a.admin_counter_cents,
        updatedAt: a.updated_at,
        routeTo: `/inspector/negotiations`,
        ctaLabel: 'Respond',
      });
    });
    accepted.forEach((a) => {
      if (contractJobIds.has(a.job_id)) return; // dedupe — contract row wins
      collected.push({
        id: `ap:${a.id}`,
        kind: 'awarded_pending_contract',
        jobId: a.job_id,
        jobTitle: titleByJobId.get(a.job_id) ?? null,
        amountCents: a.bid_amount_cents,
        updatedAt: a.updated_at,
        routeTo: `/inspector/jobs/${a.job_id}`,
        ctaLabel: 'View',
      });
    });
    stalledExecuted.forEach((c) => {
      collected.push({
        id: `kp:${c.id}`,
        kind: 'kickoff_pending',
        jobId: c.job_id,
        jobTitle: c.job_id ? titleByJobId.get(c.job_id) ?? null : null,
        amountCents: c.inspector_payout_cents,
        updatedAt: c.updated_at,
        routeTo: c.job_id ? `/inspector/jobs/${c.job_id}` : `/inspector/contracts`,
        ctaLabel: 'Begin',
      });
    });
  }

  // ── ADMIN PIPELINE (2026-05-20 — closes the admin UX black hole) ──────
  //
  //   Admin holds three signoff gates on the V3 contract state machine
  //   plus two cross-role mediation streams. These queries are platform-
  //   wide (no client_id / inspector_id filter). Admin's RLS allows the
  //   SELECTs via nx_is_admin().
  if (tone === 'admin') {
    const [
      pendingApprovalRes,
      acceptedAppsRes,
      pendingSignoffRes,
      openDisputesRes,
      milestoneReqRes,
    ] = await Promise.all([
      supabase
        .from('jobs')
        .select('id, title, updated_at, client_price_cents')
        .eq('status', 'pending_approval')
        .order('updated_at', { ascending: false })
        .limit(15),
      supabase
        .from('applications')
        .select('id, job_id, updated_at, bid_amount_cents, status')
        .in('status', ['CLIENT_SELECTED', 'accepted'])
        .order('updated_at', { ascending: false })
        .limit(15),
      supabase
        .from('jobs')
        .select('id, title, updated_at, client_price_cents, admin_confirmed_at')
        .eq('status', 'completed')
        .is('admin_confirmed_at', null)
        .order('updated_at', { ascending: false })
        .limit(15),
      supabase
        .from('jobs')
        .select('id, title, updated_at, client_price_cents')
        .eq('status', 'disputed')
        .order('updated_at', { ascending: false })
        .limit(15),
      supabase
        .from('audit_events')
        .select('id, payload, created_at')
        .eq('event_kind', 'milestone_release_requested')
        .order('created_at', { ascending: false })
        .limit(15),
    ]);

    type J = { id: string; title: string | null; updated_at: string | null; client_price_cents: number | null };
    const pendingApprovals = (pendingApprovalRes.data ?? []) as J[];
    const acceptedApps = (acceptedAppsRes.data ?? []) as Array<{
      id: string;
      job_id: string;
      updated_at: string | null;
      bid_amount_cents: number | null;
    }>;
    const pendingSignoffs = (pendingSignoffRes.data ?? []) as J[];
    const openDisputes = (openDisputesRes.data ?? []) as J[];
    const milestoneReqs = (milestoneReqRes.data ?? []) as Array<{
      id: string;
      payload: { job_id?: string; job_title?: string | null; amount_cents?: number | null };
      created_at: string | null;
    }>;

    await hydrateTitles(acceptedApps.map((a) => a.job_id));

    // ROUTING NOTE — The web admin section deliberately has NO
    // /admin/jobs/[id]/page.tsx route. The canonical inspection surface
    // is /admin/jobs?inspect=<jobId>, a drawer that opens above the
    // moderation table. Same operator-anchored pattern used by
    // compliance and disputes. Every admin pipeline row routes through
    // adminJobInspectHref() so we have ONE choke point for this rule.
    openDisputes.forEach((j) => {
      collected.push({
        id: `ad-dispute:${j.id}`,
        kind: 'admin_open_dispute',
        jobId: j.id,
        jobTitle: j.title,
        amountCents: j.client_price_cents,
        updatedAt: j.updated_at,
        // Disputes have their own dedicated drawer keyed by jobId.
        routeTo: `/admin/disputes?jobId=${j.id}`,
        ctaLabel: 'Mediate',
      });
    });
    pendingSignoffs.forEach((j) => {
      collected.push({
        id: `ad-signoff:${j.id}`,
        kind: 'admin_pending_signoff',
        jobId: j.id,
        jobTitle: j.title,
        amountCents: j.client_price_cents,
        updatedAt: j.updated_at,
        routeTo: adminJobInspectHref(j.id),
        ctaLabel: 'Review',
      });
    });
    acceptedApps.forEach((a) => {
      collected.push({
        id: `ad-contract:${a.id}`,
        kind: 'admin_pending_contract',
        jobId: a.job_id,
        jobTitle: titleByJobId.get(a.job_id) ?? null,
        amountCents: a.bid_amount_cents,
        updatedAt: a.updated_at,
        routeTo: adminJobInspectHref(a.job_id),
        ctaLabel: 'Issue',
      });
    });
    pendingApprovals.forEach((j) => {
      collected.push({
        id: `ad-approve:${j.id}`,
        kind: 'admin_pending_approval',
        jobId: j.id,
        jobTitle: j.title,
        amountCents: j.client_price_cents,
        updatedAt: j.updated_at,
        routeTo: adminJobInspectHref(j.id),
        ctaLabel: 'Approve',
      });
    });
    milestoneReqs.forEach((r) => {
      const jobId = r.payload?.job_id ?? null;
      collected.push({
        id: `ad-milestone:${r.id}`,
        kind: 'admin_milestone_request',
        jobId,
        jobTitle: r.payload?.job_title ?? null,
        amountCents: r.payload?.amount_cents ?? null,
        updatedAt: r.created_at,
        routeTo: jobId ? adminJobInspectHref(jobId) : `/admin/dashboard`,
        ctaLabel: 'Action',
      });
    });
  }

  // Priority sort — most-actionable first.
  const priority: Record<PipelineKind, number> = {
    // Inspector ranks: signature first, then counter-offers, then a
    // kickoff-pending row (contract fully executed but the job didn't
    // advance) so the user sees it before the cooler awarded-pending rows.
    awaiting_your_signature: 0,
    counter_offer_received: 1,
    kickoff_pending: 2,
    awarded_pending_contract: 3,
    awaiting_their_signature: 4,
    awaiting_admin_approval: 5,
    // Admin gates — disputes hottest, milestone requests warm, approvals coolest.
    admin_open_dispute: 0,
    admin_pending_signoff: 1,
    admin_milestone_request: 2,
    admin_pending_contract: 3,
    admin_pending_approval: 4,
  };
  collected.sort((a, b) => {
    const dp = priority[a.kind] - priority[b.kind];
    if (dp !== 0) return dp;
    const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return tb - ta;
  });

  return collected;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────────────────────
export async function PipelineSection({ tone }: Props) {
  const items = await loadPipeline(tone);
  // Suppress entirely when there's no work waiting (calm UI principle).
  if (items.length === 0) return null;

  return (
    <section className="rounded-3xl border border-accent-amber/30 bg-accent-amber/[0.04] p-5 sm:p-6">
      <header className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent-amber/40 bg-accent-amber/10">
          <Hourglass
            className="h-4 w-4 text-accent-amber"
            strokeWidth={1.75}
          />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-accent-amber">
            Awaiting Action, {items.length}
          </p>
          <h2 className="mt-0.5 font-display text-lg font-semibold tracking-tight text-white">
            Pipeline
          </h2>
        </div>
      </header>

      <ul className="space-y-2">
        {items.map((item) => (
          <PipelineRow key={item.id} item={item} />
        ))}
      </ul>

      <p className="mt-4 text-[11px] text-zinc-500">
        These are jobs and contracts that paused while waiting on you, the
        other party, or NEXPEC moderation. Tap any row to act.
      </p>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const KIND_META: Record<
  PipelineKind,
  {
    label: string;
    tone: 'amber' | 'violet' | 'cyan' | 'red';
    Icon: LucideIcon;
  }
> = {
  awaiting_your_signature: {
    label: 'Your Signature Required',
    tone: 'amber',
    Icon: PenLine,
  },
  counter_offer_received: {
    label: 'Counter Offer Waiting',
    tone: 'amber',
    Icon: ArrowLeftRight,
  },
  awarded_pending_contract: {
    label: 'Awarded, Awaiting Contract',
    tone: 'violet',
    Icon: Ribbon,
  },
  awaiting_their_signature: {
    label: 'Awaiting Inspector Signature',
    tone: 'cyan',
    Icon: Clock,
  },
  awaiting_admin_approval: {
    label: 'Awaiting Admin Approval',
    tone: 'cyan',
    Icon: ShieldCheck,
  },
  kickoff_pending: {
    // "Your contract is fully signed and the job is yours — kick it off."
    label: 'Contract Signed, Begin Work',
    tone: 'cyan',
    Icon: CheckCheck,
  },
  // ── Admin gates ─────────────────────────────────────────────────────
  admin_open_dispute: {
    label: 'Open Dispute, Mediate',
    tone: 'red',
    Icon: Flame,
  },
  admin_pending_signoff: {
    label: 'Awaiting Your Sign-off',
    tone: 'amber',
    Icon: CheckCheck,
  },
  admin_milestone_request: {
    label: 'Milestone Release Requested',
    tone: 'amber',
    Icon: DollarSign,
  },
  admin_pending_contract: {
    label: 'Issue Contract',
    tone: 'violet',
    Icon: FileText,
  },
  admin_pending_approval: {
    label: 'Pending Job Approval',
    tone: 'cyan',
    Icon: ShieldCheck,
  },
};

const TONE_CLASSES: Record<
  'amber' | 'violet' | 'cyan' | 'red',
  { text: string; bg: string; border: string }
> = {
  amber: {
    text: 'text-accent-amber',
    bg: 'bg-accent-amber/10',
    border: 'border-accent-amber/40',
  },
  violet: {
    text: 'text-violet-glow',
    bg: 'bg-violet/10',
    border: 'border-violet/40',
  },
  cyan: {
    text: 'text-cyan-glow',
    bg: 'bg-cyan-glow/10',
    border: 'border-cyan-glow/40',
  },
  red: {
    text: 'text-accent-red',
    bg: 'bg-accent-red/10',
    border: 'border-accent-red/40',
  },
};

function PipelineRow({ item }: { item: PipelineItem }) {
  const meta = KIND_META[item.kind];
  const palette = TONE_CLASSES[meta.tone];
  const Icon = meta.Icon;
  return (
    <li>
      <Link
        href={item.routeTo}
        className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/15 hover:bg-white/[0.04]"
      >
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${palette.border} ${palette.bg}`}
        >
          <Icon className={`h-4 w-4 ${palette.text}`} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {item.jobTitle ?? 'Untitled job'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border ${palette.border} ${palette.bg} px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-industrial ${palette.text}`}
            >
              {meta.label}
            </span>
            {item.amountCents != null && (
              <span className="font-mono text-[11px] font-semibold text-zinc-400">
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: 0,
                }).format(item.amountCents / 100)}
              </span>
            )}
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-industrial text-zinc-300 group-hover:text-white">
          {item.ctaLabel}
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
        </span>
      </Link>
    </li>
  );
}
