// ════════════════════════════════════════════════════════════════════════════
//  src/components/jobs/PipelineSection.tsx
//
//  "Awaiting Action" pipeline strip — surfaces jobs/applications/contracts
//  that live in between the well-known states (`open` / `in_progress` /
//  `completed`). Before this component, these rows were UX-orphaned:
//    • A job in `pending_approval` doesn't show on the buyer's "open" feed.
//    • A job in `assigned` (client signed, inspector hasn't) shows on
//      neither party's active list.
//    • A contract in `pending_client_signature` or
//      `pending_inspector_signature` only surfaces inside the Contracts Hub.
//    • An application in `admin_countered` or `accepted` only surfaces
//      inside one job's detail screen.
//
//  This component aggregates those limbo rows into a single visually
//  distinct band that lives ABOVE the existing job list — strictly
//  additive, no tab navigation changes, no existing UI removed.
//
//  Visual contract:
//    • Amber accent — distinct from green (active) and cyan (completed).
//    • One row per pipeline item, single-line, single CTA.
//    • Suppresses itself entirely when there's nothing waiting (calm UI).
//
//  Role-aware:
//    • buyer  (client / agency / enterprise): jobs + client_job_contracts_view
//    • inspector: applications + inspector_job_contracts_view
//
//  GR2: buyer fetches use BUYER_JOB_FIELDS via inline projection. Inspector
//  fetches never name client_price_cents. The contracts views handle the
//  blind-pricing isolation at the DB layer.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

// ─────────────────────────────────────────────────────────────────────────────
//  Theme — locked to rest-of-app vocabulary (#020420 / #7C3AED / amber accent)
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  borderAmber: 'rgba(245, 158, 11, 0.32)',
  text: '#FFFFFF',
  textSec: '#A8B2C7',
  textMuted: '#6B7390',
  amber: '#F59E0B',
  amberDim: 'rgba(245, 158, 11, 0.14)',
  amberGlow: 'rgba(245, 158, 11, 0.05)',
  primary: '#7C3AED',
  primaryDim: 'rgba(124, 58, 237, 0.14)',
  cyan: '#00FFFF',
  cyanDim: 'rgba(0, 255, 255, 0.12)',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Pipeline item shape
// ─────────────────────────────────────────────────────────────────────────────
export type PipelineKind =
  | 'awaiting_admin_approval'   // buyer: jobs.pending_approval
  | 'awaiting_your_signature'   // buyer or inspector: contract waiting on us
  | 'awaiting_their_signature'  // buyer: client signed, inspector hasn't
  | 'counter_offer_received'    // inspector: applications.admin_countered
  | 'awarded_pending_contract'  // inspector: applications.accepted, no contract yet
  | 'kickoff_pending'           // inspector: contract fully_executed but jobs.status didn't advance
  // ── ADMIN GATES (V3 contract state machine — admin holds 3 signoffs) ──
  | 'admin_pending_approval'    // jobs.pending_approval — admin moderation queue
  | 'admin_pending_contract'    // application selected, no job_contract row issued
  | 'admin_pending_signoff'     // job completed, admin_confirmed_at IS NULL
  | 'admin_open_dispute'        // jobs.disputed — needs mediation
  | 'admin_milestone_request';  // inspector requested milestone release

interface PipelineItem {
  id: string;                 // unique within the section
  kind: PipelineKind;
  jobId: string | null;
  jobTitle: string | null;
  amountCents: number | null;
  updatedAt: string | null;
  routeTo: string;            // tap target
  ctaLabel: string;           // short verb
}

interface Props {
  userId: string | null;
  /** 'client' | 'agency' | 'enterprise' | 'inspector' — anything else suppresses the section. */
  userRole: string | null | undefined;
}

const isBuyerRole = (r: string | null | undefined) =>
  r === 'client' || r === 'agency' || r === 'enterprise';

const isAdminRole = (r: string | null | undefined) =>
  r === 'admin' || r === 'super_admin';

// ─────────────────────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────────────────────
export function PipelineSection({ userId, userRole }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);

  const role = (userRole ?? '').toString().trim().toLowerCase();
  const buyer = isBuyerRole(role);
  const inspector = role === 'inspector';
  const admin = isAdminRole(role);

  const titleCache = React.useRef<Map<string, string | null>>(new Map());

  const hydrateJobTitles = useCallback(async (jobIds: string[]) => {
    const missing = Array.from(
      new Set(jobIds.filter((id) => id && !titleCache.current.has(id))),
    );
    if (missing.length === 0) return;
    const { data } = await supabase
      .from('jobs')
      .select('id, title')
      .in('id', missing);
    (data as Array<{ id: string; title: string | null }> | null)?.forEach((j) => {
      titleCache.current.set(j.id, j.title);
    });
  }, []);

  const fetchPipeline = useCallback(async () => {
    if (!userId || (!buyer && !inspector && !admin)) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const collected: PipelineItem[] = [];

    try {
      if (buyer) {
        // ── BUYER PIPELINE ────────────────────────────────────────────
        // 1. Contracts waiting on the buyer's signature (highest priority).
        // 2. Jobs in pending_approval (admin moderation queue).
        // 3. Jobs in 'assigned' (buyer signed, awaiting inspector signature).
        const [contractsRes, pendingApprovalRes, assignedRes] = await Promise.all([
          supabase
            .from('client_job_contracts_view')
            .select('id, job_id, status, client_price_cents, updated_at')
            .eq('client_id', userId)
            .in('status', ['pending_client_signature'])
            .order('updated_at', { ascending: false })
            .limit(15),
          supabase
            .from('jobs')
            .select('id, title, client_price_cents, status, updated_at')
            .eq('client_id', userId)
            .eq('status', 'pending_approval')
            .order('updated_at', { ascending: false })
            .limit(15),
          supabase
            .from('jobs')
            .select('id, title, client_price_cents, status, updated_at')
            .eq('client_id', userId)
            .eq('status', 'assigned')
            .order('updated_at', { ascending: false })
            .limit(15),
        ]);

        const contractRows = (contractsRes.data ?? []) as Array<{
          id: string;
          job_id: string | null;
          client_price_cents: number | null;
          updated_at: string | null;
        }>;
        const pendingApprovalRows = (pendingApprovalRes.data ?? []) as Array<{
          id: string;
          title: string | null;
          client_price_cents: number | null;
          updated_at: string | null;
        }>;
        const assignedRows = (assignedRes.data ?? []) as Array<{
          id: string;
          title: string | null;
          client_price_cents: number | null;
          updated_at: string | null;
        }>;

        await hydrateJobTitles(
          contractRows.map((c) => c.job_id).filter(Boolean) as string[],
        );

        contractRows.forEach((c) => {
          collected.push({
            id: `c:${c.id}`,
            kind: 'awaiting_your_signature',
            jobId: c.job_id,
            jobTitle: c.job_id ? titleCache.current.get(c.job_id) ?? null : null,
            amountCents: c.client_price_cents,
            updatedAt: c.updated_at,
            routeTo: `/contracts/job/${c.id}`,
            ctaLabel: 'Sign now',
          });
        });
        pendingApprovalRows.forEach((j) => {
          collected.push({
            id: `pa:${j.id}`,
            kind: 'awaiting_admin_approval',
            jobId: j.id,
            jobTitle: j.title,
            amountCents: j.client_price_cents,
            updatedAt: j.updated_at,
            routeTo: `/job-details/${j.id}`,
            ctaLabel: 'View',
          });
        });
        assignedRows.forEach((j) => {
          collected.push({
            id: `as:${j.id}`,
            kind: 'awaiting_their_signature',
            jobId: j.id,
            jobTitle: j.title,
            amountCents: j.client_price_cents,
            updatedAt: j.updated_at,
            routeTo: `/job-details/${j.id}`,
            ctaLabel: 'View',
          });
        });
      } else if (inspector) {
        // ── INSPECTOR PIPELINE ────────────────────────────────────────
        // 1. Applications with admin_countered → must respond.
        // 2. Contracts pending the inspector's signature.
        // 3. Applications accepted/selected but no contract yet
        //    (admin still preparing the binding agreement).
        // 4. SAFETY NET — fully_executed contracts whose parent job
        //    didn't advance to in_progress (self-heal trigger bypass).
        const [counterRes, contractRes, acceptedRes, executedRes] = await Promise.all([
          supabase
            .from('applications')
            .select('id, job_id, admin_counter_cents, bid_amount_cents, updated_at')
            .eq('applicant_id', userId)
            .eq('negotiation_status', 'admin_countered')
            .order('updated_at', { ascending: false })
            .limit(15),
          supabase
            .from('inspector_job_contracts_view')
            .select('id, job_id, status, inspector_payout_cents, updated_at')
            .eq('inspector_id', userId)
            .in('status', ['pending_inspector_signature'])
            .order('updated_at', { ascending: false })
            .limit(15),
          supabase
            .from('applications')
            .select('id, job_id, bid_amount_cents, status, updated_at')
            .eq('applicant_id', userId)
            .in('status', ['accepted', 'selected'])
            .order('updated_at', { ascending: false })
            .limit(15),
          supabase
            .from('inspector_job_contracts_view')
            .select('id, job_id, status, inspector_payout_cents, updated_at')
            .eq('inspector_id', userId)
            .eq('status', 'fully_executed')
            .order('updated_at', { ascending: false })
            .limit(15),
        ]);

        const counterRows = (counterRes.data ?? []) as Array<{
          id: string;
          job_id: string;
          admin_counter_cents: number | null;
          bid_amount_cents: number | null;
          updated_at: string | null;
        }>;
        const contractRows = (contractRes.data ?? []) as Array<{
          id: string;
          job_id: string | null;
          inspector_payout_cents: number | null;
          updated_at: string | null;
        }>;
        const acceptedRows = (acceptedRes.data ?? []) as Array<{
          id: string;
          job_id: string;
          bid_amount_cents: number | null;
          updated_at: string | null;
        }>;
        const executedRows = (executedRes.data ?? []) as Array<{
          id: string;
          job_id: string | null;
          inspector_payout_cents: number | null;
          updated_at: string | null;
        }>;

        // Suppress duplicates: if an accepted application already has a
        // contract pending, prefer the contract row (more actionable).
        const contractJobIds = new Set(
          contractRows.map((c) => c.job_id).filter(Boolean) as string[],
        );

        // Identify fully_executed contracts whose job STILL hasn't advanced.
        // We surface a kickoff_pending row only for those — when the self-
        // heal trigger worked, jobs.status is in_progress and the
        // assignments screen already shows it under In Progress.
        const executedJobIds = executedRows
          .map((c) => c.job_id)
          .filter(Boolean) as string[];
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
        const stalledExecuted = executedRows.filter((c) => {
          if (!c.job_id) return false;
          const s = jobStatusByJobId.get(c.job_id);
          return s !== 'in_progress'
              && s !== 'completed'
              && s !== 'disputed'
              && s !== 'cancelled'
              && s !== 'refunded';
        });

        const allJobIds = [
          ...counterRows.map((r) => r.job_id),
          ...contractRows.map((r) => r.job_id),
          ...acceptedRows.map((r) => r.job_id),
          ...stalledExecuted.map((r) => r.job_id),
        ].filter(Boolean) as string[];
        await hydrateJobTitles(allJobIds);

        contractRows.forEach((c) => {
          collected.push({
            id: `c:${c.id}`,
            kind: 'awaiting_your_signature',
            jobId: c.job_id,
            jobTitle: c.job_id ? titleCache.current.get(c.job_id) ?? null : null,
            amountCents: c.inspector_payout_cents,
            updatedAt: c.updated_at,
            routeTo: `/contracts/job/${c.id}`,
            ctaLabel: 'Sign now',
          });
        });
        counterRows.forEach((a) => {
          collected.push({
            id: `co:${a.id}`,
            kind: 'counter_offer_received',
            jobId: a.job_id,
            jobTitle: titleCache.current.get(a.job_id) ?? null,
            amountCents: a.admin_counter_cents,
            updatedAt: a.updated_at,
            routeTo: `/(inspector)/jobs/${a.job_id}`,
            ctaLabel: 'Respond',
          });
        });
        acceptedRows.forEach((a) => {
          if (contractJobIds.has(a.job_id)) return; // dedupe
          collected.push({
            id: `ap:${a.id}`,
            kind: 'awarded_pending_contract',
            jobId: a.job_id,
            jobTitle: titleCache.current.get(a.job_id) ?? null,
            amountCents: a.bid_amount_cents,
            updatedAt: a.updated_at,
            routeTo: `/(inspector)/jobs/${a.job_id}`,
            ctaLabel: 'View',
          });
        });
        stalledExecuted.forEach((c) => {
          collected.push({
            id: `kp:${c.id}`,
            kind: 'kickoff_pending',
            jobId: c.job_id,
            jobTitle: c.job_id ? titleCache.current.get(c.job_id) ?? null : null,
            amountCents: c.inspector_payout_cents,
            updatedAt: c.updated_at,
            routeTo: c.job_id ? `/(inspector)/jobs/${c.job_id}` : `/(inspector)/dashboard`,
            ctaLabel: 'Begin',
          });
        });
      } else if (admin) {
        // ── ADMIN PIPELINE (2026-05-20 — fixes Admin UX black hole) ──
        //
        //   Admin holds three signoff gates on the V3 contract state
        //   machine:
        //     1. Approve a new job before it goes live (pending_approval).
        //     2. Generate a job_contract once an applicant is selected.
        //     3. Sign off on the completed report before escrow releases.
        //
        //   Plus two cross-role mediation streams:
        //     4. Open disputes — mediation required.
        //     5. Milestone release requests — inspector asked for a payout.
        //
        //   Admin queries are platform-wide (no client_id/inspector_id
        //   filter). RLS already grants admins SELECT on the underlying
        //   rows via nx_is_admin().
        const [
          pendingApprovalRes,
          acceptedAppsRes,
          pendingSignoffRes,
          openDisputesRes,
          milestoneReqRes,
        ] = await Promise.all([
          // 1) Pending approval queue
          supabase
            .from('jobs')
            .select('id, title, updated_at, client_price_cents')
            .eq('status', 'pending_approval')
            .order('updated_at', { ascending: false })
            .limit(15),
          // 2) Selected/accepted applications — admin must issue contract.
          //    We don't filter against existing job_contracts here because
          //    the right cross-table query is a left-anti-join that
          //    PostgREST doesn't natively support. The badge wording is
          //    accurate either way ("admin should confirm contract").
          supabase
            .from('applications')
            .select('id, job_id, updated_at, bid_amount_cents, status')
            .in('status', ['selected', 'accepted'])
            .order('updated_at', { ascending: false })
            .limit(15),
          // 3) Completed jobs awaiting admin signoff (admin_confirmed_at IS NULL)
          supabase
            .from('jobs')
            .select('id, title, updated_at, client_price_cents, admin_confirmed_at')
            .eq('status', 'completed')
            .is('admin_confirmed_at', null)
            .order('updated_at', { ascending: false })
            .limit(15),
          // 4) Open disputes
          supabase
            .from('jobs')
            .select('id, title, updated_at, client_price_cents')
            .eq('status', 'disputed')
            .order('updated_at', { ascending: false })
            .limit(15),
          // 5) Milestone release requests — read from audit_events
          supabase
            .from('audit_events')
            .select('id, payload, created_at')
            .eq('event_kind', 'milestone_release_requested')
            .order('created_at', { ascending: false })
            .limit(15),
        ]);

        type J = { id: string; title: string | null; updated_at: string | null; client_price_cents: number | null };
        const pendingApprovalRows = (pendingApprovalRes.data ?? []) as J[];
        const acceptedAppRows = (acceptedAppsRes.data ?? []) as Array<{
          id: string;
          job_id: string;
          updated_at: string | null;
          bid_amount_cents: number | null;
        }>;
        const pendingSignoffRows = (pendingSignoffRes.data ?? []) as J[];
        const openDisputeRows = (openDisputesRes.data ?? []) as J[];
        const milestoneRows = (milestoneReqRes.data ?? []) as Array<{
          id: string;
          payload: { job_id?: string; job_title?: string | null; amount_cents?: number | null };
          created_at: string | null;
        }>;

        await hydrateJobTitles(acceptedAppRows.map((a) => a.job_id));

        // Push in priority order so the highest-urgency rows surface first.
        openDisputeRows.forEach((j) => {
          collected.push({
            id: `ad-dispute:${j.id}`,
            kind: 'admin_open_dispute',
            jobId: j.id,
            jobTitle: j.title,
            amountCents: j.client_price_cents,
            updatedAt: j.updated_at,
            // Land on the dedicated disputes board (built same day as this
            // pipeline). Operator gets the resolution picker + escrow
            // diff in one screen instead of generic job detail.
            routeTo: `/(admin)/disputes`,
            ctaLabel: 'Mediate',
          });
        });
        pendingSignoffRows.forEach((j) => {
          collected.push({
            id: `ad-signoff:${j.id}`,
            kind: 'admin_pending_signoff',
            jobId: j.id,
            jobTitle: j.title,
            amountCents: j.client_price_cents,
            updatedAt: j.updated_at,
            routeTo: `/(admin)/jobs/${j.id}`,
            ctaLabel: 'Review',
          });
        });
        acceptedAppRows.forEach((a) => {
          collected.push({
            id: `ad-contract:${a.id}`,
            kind: 'admin_pending_contract',
            jobId: a.job_id,
            jobTitle: titleCache.current.get(a.job_id) ?? null,
            amountCents: a.bid_amount_cents,
            updatedAt: a.updated_at,
            routeTo: `/(admin)/jobs/${a.job_id}`,
            ctaLabel: 'Issue',
          });
        });
        pendingApprovalRows.forEach((j) => {
          collected.push({
            id: `ad-approve:${j.id}`,
            kind: 'admin_pending_approval',
            jobId: j.id,
            jobTitle: j.title,
            amountCents: j.client_price_cents,
            updatedAt: j.updated_at,
            routeTo: `/(admin)/job-moderation`,
            ctaLabel: 'Approve',
          });
        });
        milestoneRows.forEach((r) => {
          const jobId = r.payload?.job_id ?? null;
          collected.push({
            id: `ad-milestone:${r.id}`,
            kind: 'admin_milestone_request',
            jobId,
            jobTitle: r.payload?.job_title ?? null,
            amountCents: r.payload?.amount_cents ?? null,
            updatedAt: r.created_at,
            routeTo: jobId ? `/(admin)/jobs/${jobId}` : `/(admin)/dashboard`,
            ctaLabel: 'Action',
          });
        });
      }
    } catch (err) {
      // Soft-fail: don't break the rest of the screen if a single fetch errors.
      console.warn('[PipelineSection] fetch error:', (err as Error)?.message);
    } finally {
      // Sort by priority (your-signature first, then counters, then admin-waits)
      const priorityOrder: Record<PipelineKind, number> = {
        awaiting_your_signature: 0,
        counter_offer_received: 1,
        // kickoff_pending = the contract is fully signed but the job didn't
        // advance. Inspector should see this near the top so they begin work.
        kickoff_pending: 2,
        awarded_pending_contract: 3,
        awaiting_their_signature: 4,
        awaiting_admin_approval: 5,
        // Admin gates — disputes hottest, milestone requests warm,
        // approvals coolest (still must clear, but not blocking money).
        admin_open_dispute: 0,
        admin_pending_signoff: 1,
        admin_milestone_request: 2,
        admin_pending_contract: 3,
        admin_pending_approval: 4,
      };
      collected.sort((a, b) => {
        const dp = priorityOrder[a.kind] - priorityOrder[b.kind];
        if (dp !== 0) return dp;
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return tb - ta;
      });
      setItems(collected);
      setLoading(false);
    }
  }, [userId, buyer, inspector, hydrateJobTitles]);

  useEffect(() => {
    void fetchPipeline();
  }, [fetchPipeline]);

  // Suppress entirely when there's no work waiting (calm UI principle).
  // Also suppress on the first paint to avoid a flash of empty state.
  if (loading) {
    return (
      <View style={s.loadingStrip}>
        <ActivityIndicator size="small" color={C.amber} />
        <Text style={s.loadingText}>Checking your pipeline…</Text>
      </View>
    );
  }
  if (items.length === 0) return null;

  return (
    <Animated.View entering={FadeIn.duration(220)} style={s.wrap}>
      <View style={s.header}>
        <View style={s.headerIconWrap}>
          <Ionicons name="hourglass" size={13} color={C.amber} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.kicker}>AWAITING ACTION · {items.length}</Text>
          <Text style={s.title}>Pipeline</Text>
        </View>
      </View>

      <View style={s.list}>
        {items.map((item, i) => (
          <PipelineRow
            key={item.id}
            item={item}
            delay={Math.min(i, 5) * 60}
            onPress={() => {
              try {
                router.push(item.routeTo as any);
              } catch (e) {
                console.warn('[PipelineSection] nav error', e);
              }
            }}
          />
        ))}
      </View>

      <Text style={s.footnote}>
        These are jobs and contracts that paused while waiting on you, the
        other party, or NEXPEC moderation. Tap any row to act.
      </Text>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const KIND_META: Record<
  PipelineKind,
  { label: string; tone: string; toneDim: string; icon: string }
> = {
  awaiting_your_signature: {
    label: 'Your Signature Required',
    tone: C.amber,
    toneDim: C.amberDim,
    icon: 'create-outline',
  },
  counter_offer_received: {
    label: 'Counter Offer Waiting',
    tone: C.amber,
    toneDim: C.amberDim,
    icon: 'swap-horizontal',
  },
  awarded_pending_contract: {
    label: 'Awarded · Awaiting Contract',
    tone: C.primary,
    toneDim: C.primaryDim,
    icon: 'ribbon',
  },
  awaiting_their_signature: {
    label: 'Awaiting Inspector Signature',
    tone: C.cyan,
    toneDim: C.cyanDim,
    icon: 'time',
  },
  awaiting_admin_approval: {
    label: 'Awaiting Admin Approval',
    tone: C.cyan,
    toneDim: C.cyanDim,
    icon: 'shield-checkmark',
  },
  kickoff_pending: {
    label: 'Contract Signed · Begin Work',
    tone: C.cyan,
    toneDim: C.cyanDim,
    icon: 'checkmark-done-circle',
  },
  // ── Admin gates ───────────────────────────────────────────────────────
  admin_open_dispute: {
    label: 'Open Dispute · Mediate',
    tone: '#EF4444',
    toneDim: 'rgba(239,68,68,0.14)',
    icon: 'flame',
  },
  admin_pending_signoff: {
    label: 'Awaiting Your Sign-off',
    tone: C.amber,
    toneDim: C.amberDim,
    icon: 'checkmark-done',
  },
  admin_milestone_request: {
    label: 'Milestone Release Requested',
    tone: C.amber,
    toneDim: C.amberDim,
    icon: 'cash-outline',
  },
  admin_pending_contract: {
    label: 'Issue Contract',
    tone: C.primary,
    toneDim: C.primaryDim,
    icon: 'document-text',
  },
  admin_pending_approval: {
    label: 'Pending Job Approval',
    tone: C.cyan,
    toneDim: C.cyanDim,
    icon: 'shield-checkmark',
  },
};

function PipelineRow({
  item,
  delay,
  onPress,
}: {
  item: PipelineItem;
  delay: number;
  onPress: () => void;
}) {
  const meta = KIND_META[item.kind];
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(280)}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          s.row,
          pressed && { transform: [{ scale: 0.99 }] },
        ]}
      >
        <View
          style={[
            s.rowIcon,
            { backgroundColor: meta.toneDim, borderColor: meta.tone + '55' },
          ]}
        >
          <Ionicons name={meta.icon as any} size={14} color={meta.tone} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.rowTitle} numberOfLines={1}>
            {item.jobTitle ?? 'Untitled job'}
          </Text>
          <View style={s.rowMetaRow}>
            <View
              style={[
                s.rowBadge,
                { backgroundColor: meta.toneDim, borderColor: meta.tone + '55' },
              ]}
            >
              <Text style={[s.rowBadgeText, { color: meta.tone }]}>
                {meta.label}
              </Text>
            </View>
            {item.amountCents != null ? (
              <Text style={s.rowAmount}>
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: 0,
                }).format(item.amountCents / 100)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={s.rowCta}>
          <Text style={s.rowCtaText}>{item.ctaLabel}</Text>
          <Ionicons name="chevron-forward" size={12} color={C.textSec} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  loadingStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: C.amberGlow,
    borderWidth: 1,
    borderColor: C.borderAmber,
  },
  loadingText: {
    color: C.amber,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
  },

  wrap: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.borderAmber,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  headerIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: C.amberDim,
    borderWidth: 1,
    borderColor: C.borderAmber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kicker: {
    color: C.amber,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  title: {
    color: C.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 1,
  },

  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderWidth: 1,
    borderColor: C.border,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: C.text, fontSize: 12.5, fontWeight: '700' },
  rowMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  rowBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 7,
    borderWidth: 1,
  },
  rowBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  rowAmount: {
    color: C.textSec,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rowCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: C.border,
  },
  rowCtaText: { color: C.textSec, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },

  footnote: {
    color: C.textMuted,
    fontSize: 10,
    lineHeight: 14,
    marginTop: 12,
    paddingHorizontal: 2,
  },
});
