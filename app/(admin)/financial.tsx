// ───────────────────────────────────────────────────────────────────
//  app/(admin)/financial.tsx
//
//  Super Admin — Financial Control Center.
//
//  Single-screen analytics dashboard pulling from the canonical money
//  tables (jobs, transactions, payout_requests, profiles). All
//  aggregations prefer cents/halalas columns since they're the
//  authoritative source post the Phase-3b cents migration. Falls back
//  to `amount`-style numeric dollar columns only where halalas isn't
//  populated.
//
//  Margin source-of-truth: jobs.platform_spread_cents when present,
//  computed (client_price_cents - inspector_payout_cents) when null.
//
//  Time bucketing: all dates converted to the device's local timezone
//  via toLocaleDateString before grouping into daily buckets.
//
//  Locked NEXPEC palette: bg #020420, primary #7C3AED.
//  Zero edits to other components — fully isolated screen.
// ───────────────────────────────────────────────────────────────────

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
  StatusBar,
  Stack as RNStack,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import { supabase } from '@/lib/supabase';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ═══════════════════════════════════════════════════════════════════
//  THEME — locked NEXPEC palette
// ═══════════════════════════════════════════════════════════════════
const C = {
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

  gridLine: 'rgba(148,163,184,0.08)',
};

// ═══════════════════════════════════════════════════════════════════
//  TYPES + CONSTANTS
// ═══════════════════════════════════════════════════════════════════
type RangeKey = '7d' | '30d' | '90d' | 'all';
const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '7d', label: '7D', days: 7 },
  { key: '30d', label: '30D', days: 30 },
  { key: '90d', label: '90D', days: 90 },
  { key: 'all', label: 'All', days: null },
];

interface KpiSet {
  inflowCents: number;
  payoutsCents: number;
  marginCents: number;
  escrowCents: number;
  prevInflowCents: number;
  prevPayoutsCents: number;
  prevMarginCents: number;
}

interface DailyBucket {
  dayLabel: string;
  marginCents: number;
  payoutsCents: number;
}

interface RoleSlice {
  role: string;
  cents: number;
}

interface RecentTxn {
  id: string;
  type: string;
  amountCents: number;
  status: string;
  createdAt: string;
  referenceId: string | null;
  description: string | null;
  jobId: string | null;
  jobTitle: string | null;
}

interface PipelineItem {
  status: string;
  count: number;
  valueCents: number;
}

// ── Operational accounting types (added Phase 4.1) ──────────────────
interface InspectorJobRef {
  id: string;
  title: string;
  amountCents: number;
  status: string;
}
interface InspectorLeaderItem {
  id: string;
  name: string;
  jobCount: number;
  totalEarningsCents: number;
  avgEarningsCents: number;
  jobs: InspectorJobRef[];
}

interface ClientJobRef {
  id: string;
  title: string;
  status: string;
  amountCents: number;
}
interface ClientBalanceItem {
  id: string;
  name: string;
  role: string;
  billedCents: number;
  paidCents: number;
  outstandingCents: number;
  jobs: ClientJobRef[];
}

interface ActiveJobItem {
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

interface RemainingPayoutItem {
  id: string;
  title: string;
  payoutCents: number;
  inspectorName: string;
  inspectorId: string;
  completedDate: string | null;
}

const JOB_STATUS_DISPLAY: Record<string, {
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

const ROLE_DISPLAY: Record<string, { label: string; color: string }> = {
  client:     { label: 'Client',     color: C.primary },
  agency:     { label: 'Agency',     color: C.blue },
  enterprise: { label: 'Enterprise', color: C.green },
  unknown:    { label: 'Other',      color: C.textMuted },
};

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
const formatUSD = (cents: number): string => {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatUSDCompact = (cents: number): string => {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  if (abs >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
  return `$${dollars.toFixed(0)}`;
};

const pctDelta = (current: number, previous: number): number => {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

const formatPctDelta = (pct: number): string => {
  const sign = pct >= 0 ? '▲' : '▼';
  return `${sign} ${Math.abs(pct).toFixed(1)}%`;
};

const formatLocalDayKey = (iso: string): string => {
  // Local-timezone date key (YYYY-MM-DD) for daily bucket grouping
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const formatShortDate = (iso: string): string => {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
};

const formatRelativeTime = (iso: string): string => {
  const d = new Date(iso);
  const diffMins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const getDateRange = (
  rangeKey: RangeKey,
): { start: Date; end: Date; previousStart: Date; previousEnd: Date } => {
  const end = new Date();
  const range = RANGES.find((r) => r.key === rangeKey);
  if (!range || range.days === null) {
    const farPast = new Date(2000, 0, 1);
    return { start: farPast, end, previousStart: farPast, previousEnd: farPast };
  }
  const start = new Date(end.getTime() - range.days * 24 * 60 * 60 * 1000);
  const previousEnd = new Date(start);
  const previousStart = new Date(
    start.getTime() - range.days * 24 * 60 * 60 * 1000,
  );
  return { start, end, previousStart, previousEnd };
};

const computeMarginCents = (job: {
  platform_spread_cents: number | null;
  client_price_cents: number | null;
  inspector_payout_cents: number | null;
}): number => {
  if (job.platform_spread_cents != null) return job.platform_spread_cents;
  return (job.client_price_cents ?? 0) - (job.inspector_payout_cents ?? 0);
};

const txnIcon = (
  type: string,
): { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string } => {
  switch (type) {
    case 'payment':
    case 'deposit':
    case 'earning':
      return { icon: 'arrow-down-circle', color: C.green, bg: C.greenBg };
    case 'payout':
    case 'withdrawal':
      return { icon: 'arrow-up-circle', color: C.primary, bg: C.primaryBg };
    case 'refund':
      return { icon: 'refresh-circle', color: C.amber, bg: C.amberBg };
    case 'fee':
      return { icon: 'remove-circle', color: C.red, bg: C.redBg };
    case 'escrow':
      return { icon: 'lock-closed', color: C.blue, bg: C.blueBg };
    case 'expense':
      return { icon: 'receipt-outline', color: C.cyan, bg: C.cyanBg };
    default:
      return { icon: 'swap-horizontal', color: C.textMuted, bg: 'rgba(100,116,139,0.12)' };
  }
};

// ═══════════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════
const RangePicker: React.FC<{
  active: RangeKey;
  onChange: (key: RangeKey) => void;
}> = React.memo(({ active, onChange }) => (
  <View style={s.rangeRow}>
    {RANGES.map((r) => (
      <TouchableOpacity
        key={r.key}
        onPress={() => onChange(r.key)}
        activeOpacity={0.7}
        style={[s.rangeChip, active === r.key && s.rangeChipActive]}
      >
        <Text
          style={[s.rangeChipText, active === r.key && s.rangeChipTextActive]}
        >
          {r.label}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
));

const KpiCard: React.FC<{
  label: string;
  valueCents: number;
  deltaPct?: number | null;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
}> = React.memo(({ label, valueCents, deltaPct, icon, color, bg }) => (
  <View style={s.kpiCard}>
    <View style={s.kpiCardHeader}>
      <View style={[s.kpiCardIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={s.kpiCardLabel}>{label}</Text>
    </View>
    <Text style={s.kpiCardValue}>{formatUSDCompact(valueCents)}</Text>
    {deltaPct != null && (
      <Text
        style={[
          s.kpiCardDelta,
          { color: deltaPct >= 0 ? C.green : C.red },
        ]}
      >
        {formatPctDelta(deltaPct)} vs prev
      </Text>
    )}
  </View>
));

const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}> = ({ title, subtitle, rightSlot }) => (
  <View style={s.sectionHeader}>
    <View style={{ flex: 1 }}>
      <Text style={s.sectionTitle}>{title}</Text>
      {subtitle && <Text style={s.sectionSubtitle}>{subtitle}</Text>}
    </View>
    {rightSlot}
  </View>
);

const TransactionRow: React.FC<{
  txn: RecentTxn;
  onPress: () => void;
}> = React.memo(({ txn, onPress }) => {
  const cfg = txnIcon(txn.type);
  const isStandalone = !txn.jobId;
  const statusColor =
    txn.status === 'paid' || txn.status === 'completed'
      ? C.green
      : txn.status === 'failed'
      ? C.red
      : C.amber;

  return (
    <TouchableOpacity
      style={s.txnRow}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={!txn.jobId}
    >
      <View style={[s.txnIcon, { backgroundColor: cfg.bg }]}>
        <Ionicons name={cfg.icon} size={18} color={cfg.color} />
      </View>
      <View style={s.txnBody}>
        <View style={s.txnTopLine}>
          <Text style={s.txnType}>
            {txn.type.charAt(0).toUpperCase() + txn.type.slice(1)}
          </Text>
          <Text style={s.txnAmount}>{formatUSD(txn.amountCents)}</Text>
        </View>
        <View style={s.txnMidLine}>
          <Text style={s.txnContext} numberOfLines={1}>
            {isStandalone
              ? 'Standalone · System transfer'
              : txn.jobTitle ?? 'Linked job'}
          </Text>
        </View>
        <View style={s.txnBottomLine}>
          <Text style={s.txnDate}>{formatRelativeTime(txn.createdAt)}</Text>
          <View style={[s.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[s.txnStatus, { color: statusColor }]}>
            {txn.status}
          </Text>
          {txn.referenceId && (
            <>
              <Text style={s.txnDateSep}>·</Text>
              <Text style={s.txnRef} numberOfLines={1}>
                {txn.referenceId.slice(0, 14)}…
              </Text>
            </>
          )}
        </View>
      </View>
      {txn.jobId && (
        <Ionicons
          name="chevron-forward"
          size={16}
          color={C.textMuted}
          style={{ marginLeft: 4 }}
        />
      )}
    </TouchableOpacity>
  );
});

const PipelineRow: React.FC<{ item: PipelineItem }> = React.memo(({ item }) => {
  const cfg = JOB_STATUS_DISPLAY[item.status] ?? {
    label: item.status,
    color: C.textMuted,
    bg: 'rgba(100,116,139,0.12)',
  };
  return (
    <View style={s.pipelineRow}>
      <View style={[s.pipelineBadge, { backgroundColor: cfg.bg }]}>
        <Text style={[s.pipelineBadgeText, { color: cfg.color }]}>
          {cfg.label}
        </Text>
      </View>
      <Text style={s.pipelineCount}>{item.count}</Text>
      <View style={{ flex: 1 }} />
      <Text style={s.pipelineValue}>{formatUSDCompact(item.valueCents)}</Text>
    </View>
  );
});

// Inspector leaderboard row — expandable to show per-job earnings
const InspectorLeaderRow: React.FC<{
  rank: number;
  item: InspectorLeaderItem;
  expanded: boolean;
  onToggle: () => void;
  onJobPress: (jobId: string) => void;
}> = React.memo(({ rank, item, expanded, onToggle, onJobPress }) => (
  <View>
    <TouchableOpacity style={s.leaderRow} onPress={onToggle} activeOpacity={0.7}>
      <View style={s.leaderRank}>
        <Text style={s.leaderRankText}>#{rank}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.leaderName} numberOfLines={1}>{item.name}</Text>
        <Text style={s.leaderSubline}>
          {item.jobCount} {item.jobCount === 1 ? 'job' : 'jobs'} · avg{' '}
          {formatUSDCompact(item.avgEarningsCents)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={s.leaderAmount}>{formatUSD(item.totalEarningsCents)}</Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={C.textMuted}
        />
      </View>
    </TouchableOpacity>
    {expanded && (
      <View style={s.leaderExpand}>
        {item.jobs.map((j) => {
          const jobCfg =
            JOB_STATUS_DISPLAY[j.status] ?? JOB_STATUS_DISPLAY.open;
          return (
            <TouchableOpacity
              key={j.id}
              style={s.leaderJobItem}
              onPress={() => onJobPress(j.id)}
              activeOpacity={0.7}
            >
              <View style={{ flex: 1 }}>
                <Text style={s.leaderJobTitle} numberOfLines={1}>
                  {j.title}
                </Text>
                <Text style={[s.leaderJobSub, { color: jobCfg.color }]}>
                  {jobCfg.label}
                </Text>
              </View>
              <Text style={s.leaderJobAmount}>
                {formatUSDCompact(j.amountCents)}
              </Text>
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
));

// Client / Agency / Enterprise balance row — expandable to show jobs
const ClientBalanceRow: React.FC<{
  item: ClientBalanceItem;
  expanded: boolean;
  onToggle: () => void;
  onJobPress: (jobId: string) => void;
}> = React.memo(({ item, expanded, onToggle, onJobPress }) => {
  const meta = ROLE_DISPLAY[item.role] ?? ROLE_DISPLAY.unknown;
  return (
    <View>
      <TouchableOpacity style={s.balanceRow} onPress={onToggle} activeOpacity={0.7}>
        <View
          style={[
            s.roleTag,
            {
              backgroundColor: meta.color + '22',
              borderColor: meta.color + '55',
            },
          ]}
        >
          <Text style={[s.roleTagText, { color: meta.color }]}>
            {meta.label.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.balanceName} numberOfLines={1}>{item.name}</Text>
          <View style={s.balanceStatsRow}>
            <Text style={s.balanceStatLabel}>Billed</Text>
            <Text style={s.balanceStatValue}>
              {formatUSDCompact(item.billedCents)}
            </Text>
            <Text style={s.balanceStatSep}>·</Text>
            <Text style={s.balanceStatLabel}>Paid</Text>
            <Text style={[s.balanceStatValue, { color: C.green }]}>
              {formatUSDCompact(item.paidCents)}
            </Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 2 }}>
          <Text
            style={[
              s.outstandingAmount,
              { color: item.outstandingCents > 0 ? C.amber : C.green },
            ]}
          >
            {formatUSDCompact(item.outstandingCents)}
          </Text>
          <Text style={s.outstandingLabel}>outstanding</Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={12}
            color={C.textMuted}
          />
        </View>
      </TouchableOpacity>
      {expanded && (
        <View style={s.leaderExpand}>
          {item.jobs.map((j) => {
            const cfg =
              JOB_STATUS_DISPLAY[j.status] ?? JOB_STATUS_DISPLAY.open;
            return (
              <TouchableOpacity
                key={j.id}
                style={s.leaderJobItem}
                onPress={() => onJobPress(j.id)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.leaderJobTitle} numberOfLines={1}>
                    {j.title}
                  </Text>
                  <Text style={[s.leaderJobSub, { color: cfg.color }]}>
                    {cfg.label}
                  </Text>
                </View>
                <Text style={s.leaderJobAmount}>
                  {formatUSDCompact(j.amountCents)}
                </Text>
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

// Active job row — dates + payout status
const ActiveJobRow: React.FC<{
  item: ActiveJobItem;
  onPress: () => void;
}> = React.memo(({ item, onPress }) => {
  const cfg = JOB_STATUS_DISPLAY[item.status] ?? JOB_STATUS_DISPLAY.open;
  return (
    <TouchableOpacity style={s.activeJobRow} onPress={onPress} activeOpacity={0.7}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.activeJobTitle} numberOfLines={1}>{item.title}</Text>
        <View style={s.activeJobMeta}>
          <Ionicons name="calendar-outline" size={11} color={C.textMuted} />
          <Text style={s.activeJobMetaText}>
            {item.startDate ? formatShortDate(item.startDate) : '—'}
            {' → '}
            {item.endDate ? formatShortDate(item.endDate) : 'TBD'}
          </Text>
        </View>
        <View style={s.activeJobMeta}>
          <Ionicons name="person-outline" size={11} color={C.textMuted} />
          <Text style={s.activeJobMetaText} numberOfLines={1}>
            {item.inspectorName ?? 'Unassigned'} · {item.clientName ?? 'No client'}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View style={[s.statusBadgeMini, { backgroundColor: cfg.bg }]}>
          <Text style={[s.statusBadgeMiniText, { color: cfg.color }]}>
            {cfg.label}
          </Text>
        </View>
        <Text style={s.activeJobAmount}>
          {formatUSDCompact(item.payoutCents)}
        </Text>
        <Text
          style={[
            s.activeJobPayoutTag,
            { color: item.payoutStatus === 'paid' ? C.green : C.amber },
          ]}
        >
          {item.payoutStatus}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

// Remaining payout row — completed job awaiting disbursement
const RemainingPayoutRow: React.FC<{
  item: RemainingPayoutItem;
  onPress: () => void;
}> = React.memo(({ item, onPress }) => (
  <TouchableOpacity style={s.remainingRow} onPress={onPress} activeOpacity={0.7}>
    <View style={s.remainingIcon}>
      <Ionicons name="hourglass-outline" size={14} color={C.amber} />
    </View>
    <View style={{ flex: 1 }}>
      <Text style={s.remainingTitle} numberOfLines={1}>{item.title}</Text>
      <Text style={s.remainingSub} numberOfLines={1}>
        owed to {item.inspectorName} · completed{' '}
        {item.completedDate ? formatShortDate(item.completedDate) : '—'}
      </Text>
    </View>
    <Text style={s.remainingAmount}>{formatUSD(item.payoutCents)}</Text>
    <Ionicons
      name="chevron-forward"
      size={14}
      color={C.textMuted}
      style={{ marginLeft: 4 }}
    />
  </TouchableOpacity>
));

// ═══════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function FinancialDashboard() {
  const router = useRouter();
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [kpis, setKpis] = useState<KpiSet>({
    inflowCents: 0,
    payoutsCents: 0,
    marginCents: 0,
    escrowCents: 0,
    prevInflowCents: 0,
    prevPayoutsCents: 0,
    prevMarginCents: 0,
  });
  const [dailyBuckets, setDailyBuckets] = useState<DailyBucket[]>([]);
  const [revenueByRole, setRevenueByRole] = useState<RoleSlice[]>([]);
  const [marginVelocity, setMarginVelocity] = useState({
    avgCents: 0,
    medianCents: 0,
    completedCount: 0,
    marginRate: 0,
  });
  const [recentTxns, setRecentTxns] = useState<RecentTxn[]>([]);
  // ★ Phase 4.2 — pipeline / leaderboard / balance state was moved to
  //   dedicated sub-screens under /financial/. This dashboard only
  //   keeps KPIs, charts, and a Recent Transactions preview.

  // ─── DATA FETCHERS ───────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const { start, end, previousStart, previousEnd } = getDateRange(rangeKey);
    const startIso = start.toISOString();
    const endIso = end.toISOString();
    const prevStartIso = previousStart.toISOString();
    const prevEndIso = previousEnd.toISOString();

    try {
      // Run all queries in parallel.
      // ★ Phase 4.2 — slimmed down to 4 queries: the operational
      //   accounting queries (all-jobs, payout_requests, client
      //   profiles placeholder) moved to fetchOperationalData() in
      //   /financial/_shared.tsx and run only when the user opens a
      //   detail sub-screen.
      const [jobsInRange, jobsInPrevRange, escrowJobs, txns] =
        await Promise.all([
          // 1. Jobs in current range — drives KPIs, cash flow, revenue-by-role
          supabase
            .from('jobs')
            .select(
              'id, client_id, client_price_cents, inspector_payout_cents, platform_spread_cents, status, payout_status, escrow_status, created_at, admin_confirmed_at',
            )
            .gte('created_at', startIso)
            .lte('created_at', endIso),

          // 2. Jobs in previous range — for KPI deltas
          supabase
            .from('jobs')
            .select(
              'client_price_cents, inspector_payout_cents, platform_spread_cents, status, payout_status, created_at',
            )
            .gte('created_at', prevStartIso)
            .lte('created_at', prevEndIso),

          // 3. Escrow in-flight — jobs with money locked but not yet released
          supabase
            .from('jobs')
            .select('client_price_cents, status, escrow_status')
            .in('status', ['assigned', 'in_progress']),

          // 4. Recent transactions with job title joined
          supabase
            .from('transactions')
            .select(
              `id, type, amount, gross_amount_halalas, status, created_at, reference_id, description, job_id,
               job:jobs!transactions_job_id_fkey ( title )`,
            )
            .order('created_at', { ascending: false })
            .limit(20),
        ]);

      // ─── KPIs ────────────────────────────────────────────────────
      const currentJobs = jobsInRange.data ?? [];
      const prevJobs = jobsInPrevRange.data ?? [];

      const inflowCents = currentJobs.reduce(
        (sum, j) => sum + (j.client_price_cents ?? 0),
        0,
      );
      const prevInflowCents = prevJobs.reduce(
        (sum, j) => sum + (j.client_price_cents ?? 0),
        0,
      );

      const payoutsCents = currentJobs
        .filter((j) => j.payout_status === 'paid')
        .reduce((sum, j) => sum + (j.inspector_payout_cents ?? 0), 0);
      const prevPayoutsCents = prevJobs
        .filter((j) => j.payout_status === 'paid')
        .reduce((sum, j) => sum + (j.inspector_payout_cents ?? 0), 0);

      const marginCents = currentJobs
        .filter((j) => j.status === 'completed')
        .reduce((sum, j) => sum + computeMarginCents(j), 0);
      const prevMarginCents = prevJobs
        .filter((j) => j.status === 'completed')
        .reduce((sum, j) => sum + computeMarginCents(j), 0);

      const escrowCents = (escrowJobs.data ?? []).reduce(
        (sum, j) => sum + (j.client_price_cents ?? 0),
        0,
      );

      setKpis({
        inflowCents,
        payoutsCents,
        marginCents,
        escrowCents,
        prevInflowCents,
        prevPayoutsCents,
        prevMarginCents,
      });

      // ─── CASH FLOW DAILY BUCKETS ─────────────────────────────────
      const buckets = new Map<string, DailyBucket>();
      currentJobs.forEach((j) => {
        const key = formatLocalDayKey(j.created_at);
        const existing = buckets.get(key) ?? {
          dayLabel: formatShortDate(j.created_at),
          marginCents: 0,
          payoutsCents: 0,
        };
        if (j.status === 'completed') {
          existing.marginCents += computeMarginCents(j);
        }
        if (j.payout_status === 'paid') {
          existing.payoutsCents += j.inspector_payout_cents ?? 0;
        }
        buckets.set(key, existing);
      });
      const sortedBuckets = Array.from(buckets.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, v]) => v);
      setDailyBuckets(sortedBuckets);

      // ─── REVENUE BY ROLE (client / agency / enterprise) ──────────
      const clientIds = [
        ...new Set(currentJobs.map((j) => j.client_id).filter(Boolean)),
      ] as string[];
      let roleMap = new Map<string, string>();
      if (clientIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, role')
          .in('id', clientIds);
        roleMap = new Map((profiles ?? []).map((p: any) => [p.id, p.role]));
      }
      const byRole = new Map<string, number>();
      currentJobs.forEach((j) => {
        const role = roleMap.get(j.client_id ?? '') ?? 'unknown';
        byRole.set(role, (byRole.get(role) ?? 0) + (j.client_price_cents ?? 0));
      });
      const roleSlices: RoleSlice[] = Array.from(byRole.entries())
        .map(([role, cents]) => ({ role, cents }))
        .sort((a, b) => b.cents - a.cents);
      setRevenueByRole(roleSlices);

      // ─── MARGIN VELOCITY ─────────────────────────────────────────
      const completedWithMargin = currentJobs
        .filter((j) => j.status === 'completed')
        .map((j) => computeMarginCents(j));
      const completedCount = completedWithMargin.length;
      const avgCents =
        completedCount > 0
          ? completedWithMargin.reduce((s, c) => s + c, 0) / completedCount
          : 0;
      const sortedMargins = [...completedWithMargin].sort((a, b) => a - b);
      const medianCents =
        sortedMargins.length > 0
          ? sortedMargins[Math.floor(sortedMargins.length / 2)]
          : 0;
      const marginRate =
        inflowCents > 0 ? (marginCents / inflowCents) * 100 : 0;
      setMarginVelocity({
        avgCents,
        medianCents,
        completedCount,
        marginRate,
      });

      // ─── RECENT TRANSACTIONS ─────────────────────────────────────
      const txnRows: RecentTxn[] = (txns.data ?? []).map((t: any) => ({
        id: t.id,
        type: t.type,
        amountCents:
          t.gross_amount_halalas ??
          (t.amount != null ? Math.round(Number(t.amount) * 100) : 0),
        status: t.status ?? 'pending',
        createdAt: t.created_at,
        referenceId: t.reference_id,
        description: t.description,
        jobId: t.job_id,
        jobTitle: t.job?.title ?? null,
      }));
      setRecentTxns(txnRows);

      // ★ Phase 4.2 — pipeline counts, pending payouts rollup,
      //   leaderboards, client balances, active jobs and remaining
      //   payouts all moved to /financial/* sub-screens via
      //   fetchOperationalData() in _shared.tsx. The main dashboard
      //   only computes KPIs, the cash-flow chart, the revenue donut,
      //   and the recent transactions preview. Promise.all above is
      //   slimmed down to the four queries those four widgets need.
    } catch (err) {
      console.error('[financial-dashboard] fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [rangeKey]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchAll();
    }, [fetchAll]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchAll();
  }, [fetchAll]);

  // ★ Phase 4.2 — toggleInspector / toggleClient / goToJob were used by
  //   the inline leaderboards before sub-screens. Removed along with
  //   those sections; sub-screens have their own equivalents.

  // ─── DERIVED VALUES FOR CHARTS ───────────────────────────────────
  const inflowDelta = useMemo(
    () => pctDelta(kpis.inflowCents, kpis.prevInflowCents),
    [kpis],
  );
  const payoutsDelta = useMemo(
    () => pctDelta(kpis.payoutsCents, kpis.prevPayoutsCents),
    [kpis],
  );
  const marginDelta = useMemo(
    () => pctDelta(kpis.marginCents, kpis.prevMarginCents),
    [kpis],
  );

  // Stacked bar chart data: each bar = one day, stacks = [margin, payouts]
  // (their sum = total money moved that day).
  const stackedBarData = useMemo(() => {
    // Limit to last 14 days max for visual clarity
    const slice = dailyBuckets.slice(-14);
    return slice.map((b) => ({
      label: b.dayLabel,
      stacks: [
        { value: b.marginCents / 100, color: C.green },
        { value: b.payoutsCents / 100, color: C.blue },
      ],
    }));
  }, [dailyBuckets]);

  const totalRevenueForDonut = useMemo(
    () => revenueByRole.reduce((s, r) => s + r.cents, 0),
    [revenueByRole],
  );

  const pieData = useMemo(
    () =>
      revenueByRole.map((r) => ({
        value: r.cents,
        color: (ROLE_DISPLAY[r.role] ?? ROLE_DISPLAY.unknown).color,
        text:
          totalRevenueForDonut > 0
            ? `${Math.round((r.cents / totalRevenueForDonut) * 100)}%`
            : '',
      })),
    [revenueByRole, totalRevenueForDonut],
  );

  // ─── RENDER ──────────────────────────────────────────────────────
  if (loading && !refreshing) {
    return (
      <View style={s.loadingWrap}>
        <Stack.Screen options={{ title: 'Financial Center' }} />
        <ActivityIndicator size="large" color={C.primary} />
        <Text style={s.loadingText}>Loading financial data…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Financial Center' }} />
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
      >
        {/* ── Header banner ───────────────────────────────────────── */}
        <LinearGradient
          colors={['rgba(124,58,237,0.18)', 'rgba(124,58,237,0.04)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.headerBanner}
        >
          <View>
            <Text style={s.headerTitle}>Financial Control Center</Text>
            <Text style={s.headerSubtitle}>
              Platform-level view · Live data
            </Text>
          </View>
          <Ionicons name="trending-up" size={28} color={C.primary} />
        </LinearGradient>

        {/* ── Range picker ────────────────────────────────────────── */}
        <RangePicker active={rangeKey} onChange={setRangeKey} />

        {/* ── KPI cards ───────────────────────────────────────────── */}
        <View style={s.kpiGrid}>
          <KpiCard
            label="TOTAL INFLOW"
            valueCents={kpis.inflowCents}
            deltaPct={inflowDelta}
            icon="arrow-down-circle"
            color={C.green}
            bg={C.greenBg}
          />
          <KpiCard
            label="INSPECTOR PAYOUTS"
            valueCents={kpis.payoutsCents}
            deltaPct={payoutsDelta}
            icon="arrow-up-circle"
            color={C.blue}
            bg={C.blueBg}
          />
          <KpiCard
            label="PLATFORM MARGIN"
            valueCents={kpis.marginCents}
            deltaPct={marginDelta}
            icon="trophy"
            color={C.primary}
            bg={C.primaryBg}
          />
          <KpiCard
            label="ESCROW IN-FLIGHT"
            valueCents={kpis.escrowCents}
            deltaPct={null}
            icon="lock-closed"
            color={C.amber}
            bg={C.amberBg}
          />
        </View>

        {/* ── Cash flow stacked bar chart ─────────────────────────── */}
        <View style={s.card}>
          <SectionHeader
            title="Cash Flow Over Time"
            subtitle="Daily margin (green) + inspector payouts (blue)"
          />
          {stackedBarData.length > 0 ? (
            <View style={{ marginTop: 12, alignItems: 'center' }}>
              <BarChart
                width={SCREEN_WIDTH - 80}
                height={200}
                stackData={stackedBarData}
                barWidth={Math.max(8, (SCREEN_WIDTH - 120) / Math.max(stackedBarData.length, 1) - 8)}
                spacing={6}
                noOfSections={4}
                yAxisColor={C.gridLine}
                xAxisColor={C.gridLine}
                xAxisLabelTextStyle={{ color: C.textMuted, fontSize: 9 }}
                yAxisTextStyle={{ color: C.textMuted, fontSize: 9 }}
                yAxisLabelPrefix="$"
                rulesColor={C.gridLine}
                rulesType="solid"
                isAnimated
                animationDuration={500}
              />
              <View style={s.legend}>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: C.green }]} />
                  <Text style={s.legendText}>Margin</Text>
                </View>
                <View style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: C.blue }]} />
                  <Text style={s.legendText}>Payouts</Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={s.emptyState}>
              <Ionicons name="bar-chart-outline" size={32} color={C.textMuted} />
              <Text style={s.emptyStateText}>No activity in this range</Text>
            </View>
          )}
        </View>

        {/* ── Revenue by role + margin velocity ───────────────────── */}
        <View style={s.twoColRow}>
          <View style={[s.card, { flex: 1, marginRight: 6 }]}>
            <Text style={s.miniCardTitle}>Revenue by Account</Text>
            {totalRevenueForDonut > 0 ? (
              <>
                <View style={{ alignItems: 'center', marginVertical: 12 }}>
                  <PieChart
                    data={pieData}
                    donut
                    radius={56}
                    innerRadius={36}
                    innerCircleColor={C.surface}
                    centerLabelComponent={() => (
                      <View style={{ alignItems: 'center' }}>
                        <Text style={s.donutCenterValue}>
                          {formatUSDCompact(totalRevenueForDonut)}
                        </Text>
                        <Text style={s.donutCenterLabel}>Total</Text>
                      </View>
                    )}
                  />
                </View>
                <View>
                  {revenueByRole.map((r) => {
                    const meta = ROLE_DISPLAY[r.role] ?? ROLE_DISPLAY.unknown;
                    const pct =
                      totalRevenueForDonut > 0
                        ? Math.round((r.cents / totalRevenueForDonut) * 100)
                        : 0;
                    return (
                      <View key={r.role} style={s.donutLegendRow}>
                        <View
                          style={[
                            s.donutLegendDot,
                            { backgroundColor: meta.color },
                          ]}
                        />
                        <Text style={s.donutLegendLabel}>{meta.label}</Text>
                        <Text style={s.donutLegendPct}>{pct}%</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            ) : (
              <View style={s.emptyState}>
                <Text style={s.emptyStateText}>No revenue yet</Text>
              </View>
            )}
          </View>

          <View style={[s.card, { flex: 1, marginLeft: 6 }]}>
            <Text style={s.miniCardTitle}>Margin Velocity</Text>
            <View style={s.statRow}>
              <Text style={s.statLabel}>Avg / job</Text>
              <Text style={s.statValue}>
                {formatUSD(marginVelocity.avgCents)}
              </Text>
            </View>
            <View style={s.statRow}>
              <Text style={s.statLabel}>Median</Text>
              <Text style={s.statValue}>
                {formatUSD(marginVelocity.medianCents)}
              </Text>
            </View>
            <View style={s.statRow}>
              <Text style={s.statLabel}>Margin rate</Text>
              <Text style={[s.statValue, { color: C.green }]}>
                {marginVelocity.marginRate.toFixed(1)}%
              </Text>
            </View>
            <View style={s.statRow}>
              <Text style={s.statLabel}>Completed</Text>
              <Text style={s.statValue}>
                {marginVelocity.completedCount}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Financial Reports & Details — sub-screen navigation ─── */}
        <View style={s.card}>
          <SectionHeader
            title="Financial Reports & Details"
            subtitle="Deep dives — tap to open dedicated screens"
          />
          <View style={s.reportsGrid}>
            <TouchableOpacity
              style={s.reportCard}
              activeOpacity={0.7}
              onPress={() => router.push('/(admin)/financial/inspectors' as any)}
            >
              <View style={[s.reportIcon, { backgroundColor: C.greenBg }]}>
                <Ionicons name="trophy-outline" size={20} color={C.green} />
              </View>
              <Text style={s.reportTitle}>Inspector Earnings</Text>
              <Text style={s.reportSubtitle}>Leaderboard · per-job breakdown</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={s.reportChevron} />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.reportCard}
              activeOpacity={0.7}
              onPress={() => router.push('/(admin)/financial/clients' as any)}
            >
              <View style={[s.reportIcon, { backgroundColor: C.primaryBg }]}>
                <Ionicons name="business-outline" size={20} color={C.primary} />
              </View>
              <Text style={s.reportTitle}>Client Accounts</Text>
              <Text style={s.reportSubtitle}>Billed · Paid · Outstanding</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={s.reportChevron} />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.reportCard}
              activeOpacity={0.7}
              onPress={() => router.push('/(admin)/financial/pipeline' as any)}
            >
              <View style={[s.reportIcon, { backgroundColor: C.cyanBg }]}>
                <Ionicons name="git-branch-outline" size={20} color={C.cyan} />
              </View>
              <Text style={s.reportTitle}>Job Pipeline</Text>
              <Text style={s.reportSubtitle}>Status counts · escrow rollups</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={s.reportChevron} />
            </TouchableOpacity>

            <TouchableOpacity
              style={s.reportCard}
              activeOpacity={0.7}
              onPress={() => router.push('/(admin)/financial/active-jobs' as any)}
            >
              <View style={[s.reportIcon, { backgroundColor: C.blueBg }]}>
                <Ionicons name="calendar-outline" size={20} color={C.blue} />
              </View>
              <Text style={s.reportTitle}>Active Jobs</Text>
              <Text style={s.reportSubtitle}>Dates · payout status</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={s.reportChevron} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.reportCard, { flexBasis: '100%' }]}
              activeOpacity={0.7}
              onPress={() => router.push('/(admin)/financial/pending-payouts' as any)}
            >
              <View style={[s.reportIcon, { backgroundColor: C.amberBg }]}>
                <Ionicons name="hourglass-outline" size={20} color={C.amber} />
              </View>
              <Text style={s.reportTitle}>Pending Inspector Payouts</Text>
              <Text style={s.reportSubtitle}>Completed jobs awaiting disbursement</Text>
              <Ionicons name="chevron-forward" size={16} color={C.textMuted} style={s.reportChevron} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Recent transactions ─────────────────────────────────── */}
        <View style={s.card}>
          <SectionHeader
            title="Recent Transactions"
            subtitle={`${recentTxns.length} most recent · tap a job-linked row to inspect`}
          />
          {recentTxns.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              {recentTxns.map((txn) => (
                <TransactionRow
                  key={txn.id}
                  txn={txn}
                  onPress={() => {
                    if (txn.jobId) {
                      router.push(`/(admin)/jobs/${txn.jobId}` as any);
                    }
                  }}
                />
              ))}
            </View>
          ) : (
            <View style={s.emptyState}>
              <Ionicons name="receipt-outline" size={32} color={C.textMuted} />
              <Text style={s.emptyStateText}>No transactions yet</Text>
            </View>
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  loadingWrap: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: { color: C.textSecondary, fontSize: 14 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12 },

  headerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.primaryBorder,
    marginBottom: 14,
  },
  headerTitle: {
    color: C.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    color: C.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },

  rangeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  rangeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  rangeChipActive: {
    backgroundColor: C.primaryBg,
    borderColor: C.primary,
  },
  rangeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textSecondary,
    letterSpacing: 0.5,
  },
  rangeChipTextActive: {
    color: C.primary,
  },

  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  kpiCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  kpiCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  kpiCardIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiCardLabel: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  kpiCardValue: {
    fontSize: 22,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: -0.5,
  },
  kpiCardDelta: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
  },

  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    marginBottom: 14,
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

  legend: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: C.textSecondary, fontSize: 11, fontWeight: '600' },

  twoColRow: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  miniCardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.4,
  },
  donutCenterValue: {
    fontSize: 14,
    fontWeight: '800',
    color: C.textPrimary,
  },
  donutCenterLabel: {
    fontSize: 9,
    color: C.textMuted,
    letterSpacing: 0.5,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  donutLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
  },
  donutLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  donutLegendLabel: {
    flex: 1,
    fontSize: 12,
    color: C.textSecondary,
  },
  donutLegendPct: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textPrimary,
  },

  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  statLabel: {
    fontSize: 12,
    color: C.textMuted,
  },
  statValue: {
    fontSize: 13,
    color: C.textPrimary,
    fontWeight: '700',
  },

  txnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  txnIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  txnBody: { flex: 1, gap: 2 },
  txnTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txnType: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
  },
  txnAmount: {
    fontSize: 13,
    fontWeight: '800',
    color: C.textPrimary,
  },
  txnMidLine: { marginTop: 1 },
  txnContext: {
    fontSize: 11,
    color: C.textSecondary,
  },
  txnBottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  txnDate: { fontSize: 10, color: C.textMuted },
  txnDateSep: { fontSize: 10, color: C.textMuted },
  txnRef: {
    fontSize: 10,
    color: C.textMuted,
    fontFamily: 'monospace',
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  txnStatus: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize',
  },

  pipelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  pipelineBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 86,
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
  pipelineFooter: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  pipelineFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 8,
  },
  pipelineFooterLabel: {
    flex: 1,
    fontSize: 12,
    color: C.textSecondary,
  },
  pipelineFooterValue: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
  },

  emptyState: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  emptyStateText: {
    fontSize: 12,
    color: C.textMuted,
  },

  // ── Financial reports navigation grid ─────────────────────────────
  reportsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  reportCard: {
    flexGrow: 1,
    flexBasis: '47%',
    backgroundColor: C.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    gap: 6,
  },
  reportIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  reportTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: -0.1,
  },
  reportSubtitle: {
    fontSize: 10,
    color: C.textMuted,
    lineHeight: 14,
  },
  reportChevron: {
    position: 'absolute',
    top: 14,
    right: 14,
  },

  // ── Inspector leaderboard rows ────────────────────────────────────
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

  // ── Expandable per-job sub-rows (shared by inspector + client) ────
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

  // ── Client / agency balance rows ──────────────────────────────────
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
  roleTagText: {
    fontSize: 13,
    fontWeight: '800',
  },
  balanceName: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
  },
  balanceStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  balanceStatLabel: {
    fontSize: 10,
    color: C.textMuted,
    letterSpacing: 0.3,
  },
  balanceStatValue: {
    fontSize: 11,
    color: C.textSecondary,
    fontWeight: '700',
  },
  balanceStatSep: {
    fontSize: 11,
    color: C.textDark,
    paddingHorizontal: 2,
  },
  outstandingAmount: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  outstandingLabel: {
    fontSize: 9,
    color: C.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // ── Active jobs financial rows ────────────────────────────────────
  activeJobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  activeJobTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
  },
  activeJobMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  activeJobMetaText: {
    fontSize: 11,
    color: C.textMuted,
    flex: 1,
  },
  activeJobAmount: {
    fontSize: 12,
    fontWeight: '700',
    color: C.textSecondary,
  },
  activeJobPayoutTag: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statusBadgeMini: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeMiniText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // ── Remaining payout rows ─────────────────────────────────────────
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
  remainingTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
  },
  remainingSub: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 2,
  },
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
});
