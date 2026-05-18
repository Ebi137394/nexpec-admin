// ───────────────────────────────────────────────────────────────────
//  app/(admin)/financial/_shared.tsx
//
//  Shared module for the Financial Center detail screens.
//
//  Hosts:
//    • Color tokens (NEXPEC dark/purple palette — locked)
//    • Type definitions for all operational accounting datasets
//    • Status + role display tables
//    • Formatting helpers (USD, dates, deltas)
//    • Reusable row components (InspectorLeaderRow, ClientBalanceRow,
//      ActiveJobRow, RemainingPayoutRow, PipelineRow, SectionHeader)
//    • Common StyleSheet used by every detail screen
//    • fetchOperationalData() — single source of truth for the data
//      that powers the inspector / client / pipeline / active jobs /
//      pending payouts detail screens.
//
//  The leading underscore tells Expo Router NOT to treat this as a
//  route. It's just a regular TS module shared by the sibling files.
// ───────────────────────────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

// ═══════════════════════════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════════════════════════
export const C = {
  bg: '#020420',
  surface: '#0A0E2E',
  surfaceElevated: '#111640',
  border: '#1A1F4E',
  borderLight: '#334155',

  primary: '#7C3AED',
  primaryLight: '#8B5CF6',
  primaryBg: 'rgba(124,58,237,0.12)',
  primaryBorder: 'rgba(124,58,237,0.32)',

  blue: '#3B82F6',
  blueBg: 'rgba(59,130,246,0.12)',
  green: '#10B981',
  greenBg: 'rgba(16,185,129,0.14)',
  amber: '#F59E0B',
  amberBg: 'rgba(245,158,11,0.14)',
  red: '#EF4444',
  redBg: 'rgba(239,68,68,0.14)',
  cyan: '#06B6D4',
  cyanBg: 'rgba(6,182,212,0.14)',

  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDark: '#475569',
};

// ═══════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════
export interface InspectorJobRef {
  id: string;
  title: string;
  amountCents: number;
  status: string;
}
export interface InspectorLeaderItem {
  id: string;
  name: string;
  jobCount: number;
  totalEarningsCents: number;
  avgEarningsCents: number;
  jobs: InspectorJobRef[];
}

export interface ClientJobRef {
  id: string;
  title: string;
  status: string;
  amountCents: number;
}
export interface ClientBalanceItem {
  id: string;
  name: string;
  role: string;
  billedCents: number;
  paidCents: number;
  outstandingCents: number;
  jobs: ClientJobRef[];
}

export interface ActiveJobItem {
  id: string;
  title: string;
  status: string;
  payoutStatus: string;
  payoutCents: number;
  startDate: string | null;
  endDate: string | null;
  inspectorName: string | null;
  clientName: string | null;
}

export interface RemainingPayoutItem {
  id: string;
  title: string;
  payoutCents: number;
  inspectorName: string;
  inspectorId: string;
  completedDate: string | null;
}

export interface PipelineItem {
  status: string;
  count: number;
  valueCents: number;
}

export interface OperationalData {
  inspectorLeaderboard: InspectorLeaderItem[];
  clientBalances: ClientBalanceItem[];
  activeJobs: ActiveJobItem[];
  remainingPayouts: RemainingPayoutItem[];
  pipeline: PipelineItem[];
  escrowCents: number;
  pendingPayoutsCents: number;
}

// ═══════════════════════════════════════════════════════════════════
//  DISPLAY CONFIG (status + role rendering)
// ═══════════════════════════════════════════════════════════════════
export const JOB_STATUS_DISPLAY: Record<string, {
  label: string;
  color: string;
  bg: string;
}> = {
  open:        { label: 'Open',        color: C.cyan,  bg: C.cyanBg },
  assigned:    { label: 'Assigned',    color: C.blue,  bg: C.blueBg },
  in_progress: { label: 'In Progress', color: C.amber, bg: C.amberBg },
  completed:   { label: 'Completed',   color: C.green, bg: C.greenBg },
  disputed:    { label: 'Disputed',    color: C.red,   bg: C.redBg },
  cancelled:   { label: 'Cancelled',   color: C.textMuted, bg: 'rgba(100,116,139,0.12)' },
};

export const ROLE_DISPLAY: Record<string, { label: string; color: string }> = {
  client:     { label: 'Client',     color: C.primary },
  agency:     { label: 'Agency',     color: C.blue },
  enterprise: { label: 'Enterprise', color: C.green },
  unknown:    { label: 'Other',      color: C.textMuted },
};

// ═══════════════════════════════════════════════════════════════════
//  FORMATTERS
// ═══════════════════════════════════════════════════════════════════
export const formatUSD = (cents: number): string => {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const formatUSDCompact = (cents: number): string => {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${dollars.toFixed(0)}`;
};

export const formatShortDate = (iso: string): string => {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

// ═══════════════════════════════════════════════════════════════════
//  REUSABLE COMPONENTS
// ═══════════════════════════════════════════════════════════════════
export const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}> = ({ title, subtitle, rightSlot }) => (
  <View style={ss.sectionHeader}>
    <View style={{ flex: 1 }}>
      <Text style={ss.sectionTitle}>{title}</Text>
      {subtitle && <Text style={ss.sectionSubtitle}>{subtitle}</Text>}
    </View>
    {rightSlot}
  </View>
);

export const InspectorLeaderRow: React.FC<{
  rank: number;
  item: InspectorLeaderItem;
  expanded: boolean;
  onToggle: (id: string) => void;
  onJobPress: (jobId: string) => void;
}> = React.memo(({ rank, item, expanded, onToggle, onJobPress }) => {
  const handleToggle = React.useCallback(() => onToggle(item.id), [onToggle, item.id]);
  return (
  <View>
    <TouchableOpacity style={ss.leaderRow} onPress={handleToggle} activeOpacity={0.7}>
      <View style={ss.leaderRank}>
        <Text style={ss.leaderRankText}>#{rank}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={ss.leaderName} numberOfLines={1}>{item.name}</Text>
        <Text style={ss.leaderSubline}>
          {item.jobCount} {item.jobCount === 1 ? 'job' : 'jobs'} · avg{' '}
          {formatUSDCompact(item.avgEarningsCents)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={ss.leaderAmount}>{formatUSD(item.totalEarningsCents)}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={C.textMuted}
        />
      </View>
    </TouchableOpacity>
    {expanded && (
      <View style={ss.leaderExpand}>
        {item.jobs.map((j) => {
          const jobCfg = JOB_STATUS_DISPLAY[j.status] ?? JOB_STATUS_DISPLAY.open;
          return (
            <TouchableOpacity
              key={j.id}
              style={ss.leaderJobItem}
              onPress={() => onJobPress(j.id)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={ss.leaderJobTitle} numberOfLines={1}>{j.title}</Text>
                <Text style={[ss.leaderJobSub, { color: jobCfg.color }]}>
                  {jobCfg.label}
                </Text>
              </View>
              <Text style={ss.leaderJobAmount}>{formatUSDCompact(j.amountCents)}</Text>
              <Ionicons
                name="chevron-forward"
                size={13}
                color={C.textMuted}
                style={{ marginLeft: 4 }}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    )}
  </View>
  );
});

export const ClientBalanceRow: React.FC<{
  item: ClientBalanceItem;
  expanded: boolean;
  onToggle: (id: string) => void;
  onJobPress: (jobId: string) => void;
}> = React.memo(({ item, expanded, onToggle, onJobPress }) => {
  const meta = ROLE_DISPLAY[item.role] ?? ROLE_DISPLAY.unknown;
  const handleToggle = React.useCallback(() => onToggle(item.id), [onToggle, item.id]);
  return (
    <View>
      <TouchableOpacity style={ss.balanceRow} onPress={handleToggle} activeOpacity={0.7}>
        <View
          style={[
            ss.roleTag,
            {
              backgroundColor: meta.color + '22',
              borderColor: meta.color + '55',
            },
          ]}
        >
          <Text style={[ss.roleTagText, { color: meta.color }]}>
            {meta.label.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ss.balanceName} numberOfLines={1}>{item.name}</Text>
          <View style={ss.balanceStatsRow}>
            <Text style={ss.balanceStatLabel}>Billed</Text>
            <Text style={ss.balanceStatValue}>
              {formatUSDCompact(item.billedCents)}
            </Text>
            <Text style={ss.balanceStatSep}>·</Text>
            <Text style={ss.balanceStatLabel}>Paid</Text>
            <Text style={[ss.balanceStatValue, { color: C.green }]}>
              {formatUSDCompact(item.paidCents)}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text
            style={[
              ss.outstandingAmount,
              { color: item.outstandingCents > 0 ? C.amber : C.green },
            ]}
          >
            {formatUSDCompact(item.outstandingCents)}
          </Text>
          <Text style={ss.outstandingLabel}>outstanding</Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={C.textMuted}
          />
        </View>
      </TouchableOpacity>
      {expanded && (
        <View style={ss.leaderExpand}>
          {item.jobs.map((j) => {
            const cfg = JOB_STATUS_DISPLAY[j.status] ?? JOB_STATUS_DISPLAY.open;
            return (
              <TouchableOpacity
                key={j.id}
                style={ss.leaderJobItem}
                onPress={() => onJobPress(j.id)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={ss.leaderJobTitle} numberOfLines={1}>{j.title}</Text>
                  <Text style={[ss.leaderJobSub, { color: cfg.color }]}>{cfg.label}</Text>
                </View>
                <Text style={ss.leaderJobAmount}>{formatUSDCompact(j.amountCents)}</Text>
                <Ionicons
                  name="chevron-forward"
                  size={13}
                  color={C.textMuted}
                  style={{ marginLeft: 4 }}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
});

export const ActiveJobRow: React.FC<{
  item: ActiveJobItem;
  onPress: (id: string) => void;
}> = React.memo(({ item, onPress }) => {
  const cfg = JOB_STATUS_DISPLAY[item.status] ?? JOB_STATUS_DISPLAY.open;
  const handlePress = React.useCallback(() => onPress(item.id), [onPress, item.id]);
  return (
    <TouchableOpacity style={ss.activeJobRow} onPress={handlePress} activeOpacity={0.7}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={ss.activeJobTitle} numberOfLines={1}>{item.title}</Text>
        <View style={ss.activeJobMeta}>
          <Ionicons name="calendar-outline" size={11} color={C.textMuted} />
          <Text style={ss.activeJobMetaText}>
            {item.startDate ? formatShortDate(item.startDate) : '—'}
            {' → '}
            {item.endDate ? formatShortDate(item.endDate) : 'TBD'}
          </Text>
        </View>
        <View style={ss.activeJobMeta}>
          <Ionicons name="person-outline" size={11} color={C.textMuted} />
          <Text style={ss.activeJobMetaText} numberOfLines={1}>
            {item.inspectorName ?? 'Unassigned'} · {item.clientName ?? 'No client'}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View style={[ss.statusBadgeMini, { backgroundColor: cfg.bg }]}>
          <Text style={[ss.statusBadgeMiniText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <Text style={ss.activeJobAmount}>{formatUSDCompact(item.payoutCents)}</Text>
        <Text
          style={[
            ss.activeJobPayoutTag,
            { color: item.payoutStatus === 'paid' ? C.green : C.amber },
          ]}
        >
          {item.payoutStatus}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

export const RemainingPayoutRow: React.FC<{
  item: RemainingPayoutItem;
  onPress: (id: string) => void;
}> = React.memo(({ item, onPress }) => {
  const handlePress = React.useCallback(() => onPress(item.id), [onPress, item.id]);
  return (
  <TouchableOpacity style={ss.remainingRow} onPress={handlePress} activeOpacity={0.7}>
    <View style={ss.remainingIcon}>
      <Ionicons name="hourglass-outline" size={14} color={C.amber} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={ss.remainingTitle} numberOfLines={1}>{item.title}</Text>
      <Text style={ss.remainingSub} numberOfLines={1}>
        owed to {item.inspectorName} · completed{' '}
        {item.completedDate ? formatShortDate(item.completedDate) : '—'}
      </Text>
    </View>
    <Text style={ss.remainingAmount}>{formatUSD(item.payoutCents)}</Text>
    <Ionicons
      name="chevron-forward"
      size={14}
      color={C.textMuted}
      style={{ marginLeft: 4 }}
    />
  </TouchableOpacity>
  );
});

export const PipelineRow: React.FC<{ item: PipelineItem }> = React.memo(({ item }) => {
  const cfg = JOB_STATUS_DISPLAY[item.status] ?? {
    label: item.status,
    color: C.textMuted,
    bg: 'rgba(100,116,139,0.12)',
  };
  return (
    <View style={ss.pipelineRow}>
      <View style={[ss.pipelineBadge, { backgroundColor: cfg.bg }]}>
        <Text style={[ss.pipelineBadgeText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
      <Text style={ss.pipelineCount}>{item.count}</Text>
      <View style={{ flex: 1 }} />
      <Text style={ss.pipelineValue}>{formatUSDCompact(item.valueCents)}</Text>
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════════
//  DATA FETCHER — single source of truth
// ═══════════════════════════════════════════════════════════════════
//   One query for all jobs + one query for related profiles + one
//   query for pending payout requests. Each detail screen calls this
//   and reads the slice it needs. ~16 jobs today, plenty of headroom.
//
//   Schema rules respected (per locked DB conventions):
//     • Inspector = jobs.contractor_id (NOT inspector_id)
//     • Client name resolved via profiles.id = jobs.client_id
//       (NO jobs.company_name)
// ═══════════════════════════════════════════════════════════════════
export async function fetchOperationalData(): Promise<OperationalData> {
  const [allJobsRes, escrowJobsRes, pendingPayoutsRes] = await Promise.all([
    supabase
      .from('jobs')
      .select(`
        id, title, status, payout_status, escrow_status,
        client_id, contractor_id, agency_id,
        client_price_cents, inspector_payout_cents, payout_amount_cents,
        contractor_payout_amount_cents, platform_spread_cents,
        created_at, updated_at, scheduled_date, admin_confirmed_at
      `)
      .is('deleted_at', null),
    supabase
      .from('jobs')
      .select('client_price_cents, status')
      .in('status', ['assigned', 'in_progress']),
    supabase
      .from('payout_requests')
      .select('amount')
      .eq('status', 'pending'),
  ]);

  const allJobs = (allJobsRes.data ?? []) as any[];

  // Resolve user names via profiles (single batched query)
  const userIds = [
    ...new Set(
      allJobs.flatMap((j) => [j.client_id, j.contractor_id]).filter(Boolean),
    ),
  ] as string[];
  let nameRoleMap = new Map<string, { name: string; role: string }>();
  if (userIds.length > 0) {
    const { data: profilesData } = await supabase
      .from('profiles')
      .select('id, full_name, first_name, last_name, email, role, company_name')
      .in('id', userIds);
    nameRoleMap = new Map(
      (profilesData ?? []).map((p: any) => [
        p.id,
        {
          role: p.role ?? 'unknown',
          name:
            p.company_name ||
            p.full_name ||
            `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ||
            (p.email ? p.email.split('@')[0] : '') ||
            'Unknown',
        },
      ]),
    );
  }

  // Best-effort inspector payout amount (historical column drift)
  const payoutCentsOf = (j: any): number =>
    j.inspector_payout_cents ??
    j.payout_amount_cents ??
    j.contractor_payout_amount_cents ??
    0;

  // 1. Inspector leaderboard
  const inspMap = new Map<string, InspectorLeaderItem>();
  allJobs.forEach((j) => {
    if (!j.contractor_id) return;
    const earned = payoutCentsOf(j);
    if (earned <= 0) return;
    const entry =
      inspMap.get(j.contractor_id) ??
      ({
        id: j.contractor_id,
        name: nameRoleMap.get(j.contractor_id)?.name ?? 'Unknown',
        jobCount: 0,
        totalEarningsCents: 0,
        avgEarningsCents: 0,
        jobs: [],
      } as InspectorLeaderItem);
    entry.jobs.push({
      id: j.id,
      title: j.title ?? 'Untitled',
      amountCents: earned,
      status: j.status,
    });
    entry.totalEarningsCents += earned;
    inspMap.set(j.contractor_id, entry);
  });
  const inspectorLeaderboard = Array.from(inspMap.values())
    .map((x) => ({
      ...x,
      jobCount: x.jobs.length,
      avgEarningsCents:
        x.jobs.length > 0 ? x.totalEarningsCents / x.jobs.length : 0,
    }))
    .sort((a, b) => b.totalEarningsCents - a.totalEarningsCents);

  // 2. Client / agency / enterprise balances
  const clntMap = new Map<string, ClientBalanceItem>();
  allJobs.forEach((j) => {
    if (!j.client_id || j.status === 'cancelled') return;
    const meta = nameRoleMap.get(j.client_id);
    const billed = j.client_price_cents ?? 0;
    const isPaid = ['assigned', 'in_progress', 'completed', 'disputed'].includes(
      j.status,
    );
    const entry =
      clntMap.get(j.client_id) ??
      ({
        id: j.client_id,
        name: meta?.name ?? 'Unknown',
        role: meta?.role ?? 'unknown',
        billedCents: 0,
        paidCents: 0,
        outstandingCents: 0,
        jobs: [],
      } as ClientBalanceItem);
    entry.jobs.push({
      id: j.id,
      title: j.title ?? 'Untitled',
      status: j.status,
      amountCents: billed,
    });
    entry.billedCents += billed;
    if (isPaid) entry.paidCents += billed;
    entry.outstandingCents = entry.billedCents - entry.paidCents;
    clntMap.set(j.client_id, entry);
  });
  const clientBalances = Array.from(clntMap.values()).sort(
    (a, b) => b.billedCents - a.billedCents,
  );

  // 3. Active jobs with dates
  const activeJobs: ActiveJobItem[] = allJobs
    .filter((j) => ['assigned', 'in_progress'].includes(j.status))
    .map((j) => ({
      id: j.id,
      title: j.title ?? 'Untitled',
      status: j.status,
      payoutStatus: j.payout_status ?? 'unpaid',
      payoutCents: payoutCentsOf(j),
      startDate: j.scheduled_date ?? j.created_at,
      endDate: j.admin_confirmed_at,
      inspectorName: j.contractor_id
        ? nameRoleMap.get(j.contractor_id)?.name ?? null
        : null,
      clientName: j.client_id
        ? nameRoleMap.get(j.client_id)?.name ?? null
        : null,
    }))
    .sort(
      (a, b) =>
        new Date(b.startDate ?? 0).getTime() -
        new Date(a.startDate ?? 0).getTime(),
    );

  // 4. Remaining inspector payouts (completed + unpaid)
  const remainingPayouts: RemainingPayoutItem[] = allJobs
    .filter(
      (j) =>
        j.status === 'completed' &&
        j.payout_status === 'unpaid' &&
        j.contractor_id,
    )
    .map((j) => ({
      id: j.id,
      title: j.title ?? 'Untitled',
      payoutCents: payoutCentsOf(j),
      inspectorName: nameRoleMap.get(j.contractor_id)?.name ?? 'Unknown',
      inspectorId: j.contractor_id,
      completedDate: j.admin_confirmed_at ?? j.updated_at,
    }))
    .sort((a, b) => b.payoutCents - a.payoutCents);

  // 5. Pipeline by job status
  const pipelineMap = new Map<string, PipelineItem>();
  allJobs.forEach((j) => {
    const existing = pipelineMap.get(j.status) ?? {
      status: j.status,
      count: 0,
      valueCents: 0,
    };
    existing.count += 1;
    existing.valueCents += j.client_price_cents ?? 0;
    pipelineMap.set(j.status, existing);
  });
  const pipelineOrder = [
    'open',
    'assigned',
    'in_progress',
    'completed',
    'disputed',
    'cancelled',
    'pending_approval',
  ];
  const pipeline = pipelineOrder
    .map((st) => pipelineMap.get(st))
    .filter((x): x is PipelineItem => !!x);
  // Catch any unexpected statuses we didn't list
  pipelineMap.forEach((v, k) => {
    if (!pipelineOrder.includes(k)) pipeline.push(v);
  });

  // Rollups
  const escrowCents = (escrowJobsRes.data ?? []).reduce(
    (sum, j) => sum + (j.client_price_cents ?? 0),
    0,
  );
  const pendingPayoutsCents = (pendingPayoutsRes.data ?? []).reduce(
    (sum, p: any) => sum + Math.round(Number(p.amount) * 100),
    0,
  );

  return {
    inspectorLeaderboard,
    clientBalances,
    activeJobs,
    remainingPayouts,
    pipeline,
    escrowCents,
    pendingPayoutsCents,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  SHARED STYLES
// ═══════════════════════════════════════════════════════════════════
export const ss = StyleSheet.create({
  screenRoot: { flex: 1, backgroundColor: C.bg },
  loadingWrap: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { color: C.textSecondary, fontSize: 14 },

  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },

  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 14,
  },

  // ── FlatList-as-card wrappers ──────────────────────────────────
  // The FlatList itself becomes the visual card, so it virtualizes
  // properly while still looking like the existing card UI.
  listCard: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 14,
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  listHeaderArea: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 4,
  },
  listRowPad: {
    paddingHorizontal: 16,
  },
  listFooterArea: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 4,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.3,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 36,
    gap: 8,
  },
  emptyStateText: {
    fontSize: 12,
    color: C.textMuted,
  },

  // Inspector leaderboard
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
  },
  leaderRank: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderRankText: {
    fontSize: 11,
    fontWeight: '800',
    color: C.primary,
    letterSpacing: 0.3,
  },
  leaderName: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
  },
  leaderSubline: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },
  leaderAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: C.green,
    letterSpacing: -0.2,
  },
  leaderExpand: {
    backgroundColor: 'rgba(124,58,237,0.04)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 8,
    marginTop: 4,
  },
  leaderJobItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(124,58,237,0.08)',
  },
  leaderJobTitle: {
    fontSize: 12,
    color: C.textPrimary,
    fontWeight: '600',
  },
  leaderJobSub: {
    fontSize: 10,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  leaderJobAmount: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textSecondary,
  },

  // Client balance
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
  },
  roleTag: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleTagText: { fontSize: 13, fontWeight: '800' },
  balanceName: { fontSize: 13, fontWeight: '700', color: C.textPrimary },
  balanceStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  balanceStatLabel: { fontSize: 10, color: C.textMuted, letterSpacing: 0.3 },
  balanceStatValue: { fontSize: 11, color: C.textSecondary, fontWeight: '700' },
  balanceStatSep: { fontSize: 11, color: C.textDark, paddingHorizontal: 2 },
  outstandingAmount: { fontSize: 13, fontWeight: '800', letterSpacing: -0.2 },
  outstandingLabel: {
    fontSize: 9,
    color: C.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // Active job
  activeJobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  activeJobTitle: { fontSize: 13, fontWeight: '700', color: C.textPrimary },
  activeJobMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  activeJobMetaText: { fontSize: 11, color: C.textMuted, flex: 1 },
  activeJobAmount: { fontSize: 12, fontWeight: '700', color: C.textSecondary },
  activeJobPayoutTag: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statusBadgeMini: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusBadgeMiniText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },

  // Remaining payouts
  remainingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  remainingIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: C.amberBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remainingTitle: { fontSize: 13, fontWeight: '700', color: C.textPrimary },
  remainingSub: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  remainingAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: C.amber,
    letterSpacing: -0.2,
  },
  remainingFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: C.border,
    marginTop: 4,
  },
  remainingFooterLabel: {
    fontSize: 11,
    color: C.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  remainingFooterValue: {
    fontSize: 16,
    fontWeight: '800',
    color: C.amber,
    letterSpacing: -0.3,
  },

  // Pipeline rows
  pipelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 12,
  },
  pipelineBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  pipelineBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  pipelineCount: {
    fontSize: 14,
    fontWeight: '700',
    color: C.textPrimary,
    minWidth: 28,
  },
  pipelineValue: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textSecondary,
  },
});
