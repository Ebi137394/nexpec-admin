// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/finance/budget.tsx — Budget Overview · Mobile mirror of
//  /client/budget on web. Live spend tracker for client / agency /
//  enterprise / admin (visibility scope inferred at the DB layer).
//
//  Calls the four RPCs introduced by
//  20260521120000_financial_suite_foundation.sql:
//    get_budget_summary, get_budget_monthly,
//    get_budget_by_inspector, get_budget_recent_activity
//
//  Every RPC is SECURITY DEFINER and gates visibility via
//  fin_visible_client_ids() — this screen contains zero client-side
//  authorisation logic.
//
//  Premium industrial design: matches the rest of the app's dark theme
//  (#020420 background, #7C3AED primary, cyan/amber/green status accents).
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

// ─── Theme tokens — locked to the rest-of-app vocabulary ─────────────────
const C = {
  bg:         '#020420',
  card:       '#0B1138',
  cardDeep:   '#080C2A',
  border:     'rgba(255,255,255,0.06)',
  borderHi:   'rgba(255,255,255,0.12)',
  text:       '#FFFFFF',
  textSec:    '#A8B2C7',
  textMute:   '#6B7390',
  primary:    '#7C3AED',
  primaryDim: 'rgba(124,58,237,0.14)',
  cyan:       '#00FFFF',
  cyanDim:    'rgba(0,255,255,0.12)',
  green:      '#10B981',
  greenDim:   'rgba(16,185,129,0.14)',
  amber:      '#F59E0B',
  amberDim:   'rgba(245,158,11,0.14)',
  red:        '#EF4444',
  redDim:     'rgba(239,68,68,0.14)',
};

// ─── Shapes (mirror of web's budget.types.ts) ────────────────────────────
interface BudgetSummary {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  disputedJobs: number;
  committedCents: number;
  inEscrowCents: number;
  paidOutCents: number;
  awaitingPayoutCents: number;
  avgJobCents: number;
}
interface MonthlyPoint {
  monthStart: string;
  monthLabel: string;
  jobCount: number;
  committedCents: number;
  completedCents: number;
}
interface InspectorTotal {
  inspectorId: string;
  inspectorName: string;
  jobCount: number;
  totalCents: number;
  lastJobAt: string | null;
}
interface ActivityRow {
  jobId: string;
  jobTitle: string;
  status: string;
  clientPriceCents: number;
  clientId: string;
  clientName: string;
  inspectorId: string | null;
  inspectorName: string | null;
  createdAt: string;
}

const EMPTY_SUMMARY: BudgetSummary = {
  totalJobs: 0, activeJobs: 0, completedJobs: 0, disputedJobs: 0,
  committedCents: 0, inEscrowCents: 0, paidOutCents: 0,
  awaitingPayoutCents: 0, avgJobCents: 0,
};

type Scope = 'self' | 'org' | 'platform' | 'none';

// ═════════════════════════════════════════════════════════════════════════
//  Screen
// ═════════════════════════════════════════════════════════════════════════
export default function BudgetOverviewScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<BudgetSummary>(EMPTY_SUMMARY);
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [byInspector, setByInspector] = useState<InspectorTotal[]>([]);
  const [recent, setRecent] = useState<ActivityRow[]>([]);
  const [scope, setScope] = useState<Scope>('none');
  const [roleLabel, setRoleLabel] = useState<string>('Client');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in to view your budget.');
        return;
      }

      // Resolve scope from profile in parallel with the RPCs
      const [profileRes, summaryRes, monthlyRes, byInspectorRes, recentRes] =
        await Promise.all([
          supabase.from('profiles').select('role, organization_id').eq('id', user.id).maybeSingle(),
          supabase.rpc('get_budget_summary'),
          supabase.rpc('get_budget_monthly', { p_months: 12 }),
          supabase.rpc('get_budget_by_inspector', { p_limit: 10 }),
          supabase.rpc('get_budget_recent_activity', { p_limit: 25 }),
        ]);

      // Resolve scope
      const role = ((profileRes.data as { role?: string | null } | null)?.role ?? '').toLowerCase();
      const orgId = (profileRes.data as { organization_id?: string | null } | null)?.organization_id ?? null;
      if (role === 'admin' || role === 'super_admin') {
        setScope('platform'); setRoleLabel('Admin');
      } else if ((role === 'agency' || role === 'enterprise') && orgId) {
        setScope('org'); setRoleLabel(role === 'agency' ? 'Agency' : 'Enterprise');
      } else if (role === 'client' || role === 'agency' || role === 'enterprise') {
        setScope('self'); setRoleLabel(role.charAt(0).toUpperCase() + role.slice(1));
      } else {
        setScope('none'); setRoleLabel('');
      }

      // Summary (SETOF single row)
      const sRow = Array.isArray(summaryRes.data) && summaryRes.data.length > 0
        ? (summaryRes.data[0] as Record<string, unknown>)
        : null;
      if (sRow) {
        setSummary({
          totalJobs: numberOr(sRow.total_jobs, 0),
          activeJobs: numberOr(sRow.active_jobs, 0),
          completedJobs: numberOr(sRow.completed_jobs, 0),
          disputedJobs: numberOr(sRow.disputed_jobs, 0),
          committedCents: numberOr(sRow.committed_cents, 0),
          inEscrowCents: numberOr(sRow.in_escrow_cents, 0),
          paidOutCents: numberOr(sRow.paid_out_cents, 0),
          awaitingPayoutCents: numberOr(sRow.awaiting_payout_cents, 0),
          avgJobCents: numberOr(sRow.avg_job_cents, 0),
        });
      } else {
        setSummary(EMPTY_SUMMARY);
      }

      setMonthly(Array.isArray(monthlyRes.data)
        ? (monthlyRes.data as Array<Record<string, unknown>>).map((r) => ({
            monthStart: String(r.month_start ?? ''),
            monthLabel: String(r.month_label ?? ''),
            jobCount: numberOr(r.job_count, 0),
            committedCents: numberOr(r.committed_cents, 0),
            completedCents: numberOr(r.completed_cents, 0),
          }))
        : []);

      setByInspector(Array.isArray(byInspectorRes.data)
        ? (byInspectorRes.data as Array<Record<string, unknown>>).map((r) => ({
            inspectorId: String(r.inspector_id ?? ''),
            inspectorName: String(r.inspector_name ?? 'Unknown'),
            jobCount: numberOr(r.job_count, 0),
            totalCents: numberOr(r.total_cents, 0),
            lastJobAt: (r.last_job_at as string | null) ?? null,
          }))
        : []);

      setRecent(Array.isArray(recentRes.data)
        ? (recentRes.data as Array<Record<string, unknown>>).map((r) => ({
            jobId: String(r.job_id ?? ''),
            jobTitle: String(r.job_title ?? '(untitled)'),
            status: String(r.status ?? 'unknown'),
            clientPriceCents: numberOr(r.client_price_cents, 0),
            clientId: String(r.client_id ?? ''),
            clientName: String(r.client_name ?? 'Client'),
            inspectorId: (r.inspector_id as string | null) ?? null,
            inspectorName: (r.inspector_name as string | null) ?? null,
            createdAt: String(r.created_at ?? ''),
          }))
        : []);
    } catch (e) {
      console.warn('[budget] load threw:', e);
      setError('Could not load your budget. Pull to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  const scopeChip = useMemo(() => {
    if (scope === 'platform') {
      return { label: 'Platform-wide', icon: 'shield-checkmark' as const, color: C.amber, bg: C.amberDim };
    }
    if (scope === 'org') {
      return { label: 'Your organisation', icon: 'business' as const, color: C.cyan, bg: C.cyanDim };
    }
    if (scope === 'self') {
      return { label: 'Your spend', icon: 'person' as const, color: C.primary, bg: C.primaryDim };
    }
    return { label: '—', icon: 'help-circle' as const, color: C.textMute, bg: 'rgba(255,255,255,0.04)' };
  }, [scope]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={s.centerText}>Loading budget…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
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
        {/* ─── Header ──────────────────────────────────────────────── */}
        {/* The Expo Router stack header above already provides a native
            back chevron + "Budget Overview" title — we don't repeat
            them. Our header below adds the role kicker + subtitle +
            scope chip that the native header can't express. */}
        <Animated.View entering={FadeIn.duration(220)} style={s.header}>
          <Text style={s.kicker}>{roleLabel.toUpperCase()} PORTAL, FINANCE</Text>
          <Text style={s.title}>Budget Overview</Text>
          <Text style={s.subtitle}>
            Live spend tracker, what's committed, what's held, what's
            settled. Visibility runs under your account's role.
          </Text>

          <View style={[s.scopeChip, { backgroundColor: scopeChip.bg, borderColor: scopeChip.color + '55' }]}>
            <Ionicons name={scopeChip.icon} size={12} color={scopeChip.color} />
            <Text style={[s.scopeChipText, { color: scopeChip.color }]}>
              SCOPE, {scopeChip.label.toUpperCase()}
            </Text>
          </View>
        </Animated.View>

        {/* #QA — entry point to the department-budget (envelope) editor. The
            editor itself is role-gated (owner / procurement_admin / super_admin). */}
        <TouchableOpacity
          onPress={() => router.push('/(client)/finance/budget-envelopes' as any)}
          activeOpacity={0.8}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            marginHorizontal: 20, marginTop: 4, marginBottom: 8, padding: 14,
            borderRadius: 14, backgroundColor: C.primaryDim,
            borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)',
          }}
        >
          <Ionicons name="wallet-outline" size={18} color={C.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontWeight: '700', fontSize: 14 }}>Budget envelopes</Text>
            <Text style={{ color: C.textSec, fontSize: 12, marginTop: 2 }}>Set per-department spending caps</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.textMute} />
        </TouchableOpacity>

        {/* #QA — entry point to the approval-policy (spend band) editor. Role-gated. */}
        <TouchableOpacity
          onPress={() => router.push('/(client)/finance/budget-policies' as any)}
          activeOpacity={0.8}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            marginHorizontal: 20, marginTop: 0, marginBottom: 8, padding: 14,
            borderRadius: 14, backgroundColor: C.primaryDim,
            borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)',
          }}
        >
          <Ionicons name="shield-checkmark-outline" size={18} color={C.primary} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontWeight: '700', fontSize: 14 }}>Approval policies</Text>
            <Text style={{ color: C.textSec, fontSize: 12, marginTop: 2 }}>Tiered spend bands &amp; required approvers</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.textMute} />
        </TouchableOpacity>

        {error ? (
          <View style={s.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={C.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* ─── Hero metrics ────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(60).duration(240)} style={s.heroGrid}>
          <HeroTile
            icon="trending-up"
            label="Committed"
            value={formatCents(summary.committedCents)}
            sub={`${summary.totalJobs} job${summary.totalJobs === 1 ? '' : 's'} all-time`}
            tone="violet"
          />
          <HeroTile
            icon="wallet"
            label="Held"
            value={formatCents(summary.inEscrowCents)}
            sub="Funded, awaiting completion"
            tone="cyan"
          />
          <HeroTile
            icon="checkmark-done"
            label="Paid out"
            value={formatCents(summary.paidOutCents)}
            sub="Released, settled with inspector"
            tone="green"
          />
          <HeroTile
            icon="hourglass"
            label="Awaiting payout"
            value={formatCents(summary.awaitingPayoutCents)}
            sub="Completed, pending release"
            tone="amber"
          />
        </Animated.View>

        {/* ─── Activity rollup ─────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(120).duration(240)} style={s.rollupGrid}>
          <RollupTile icon="pulse" label="Active" value={String(summary.activeJobs)} tone="violet" />
          <RollupTile icon="checkmark-circle" label="Completed" value={String(summary.completedJobs)} tone="green" />
          <RollupTile
            icon="warning"
            label="Disputed"
            value={String(summary.disputedJobs)}
            tone={summary.disputedJobs > 0 ? 'red' : 'default'}
          />
          <RollupTile icon="briefcase" label="Avg size" value={formatCents(summary.avgJobCents)} tone="default" />
        </Animated.View>

        {/* ─── 12-month trend ─────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(180).duration(240)} style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="calendar" size={14} color={C.primary} />
            <Text style={s.sectionTitle}>12-month spend trend</Text>
          </View>
          <Text style={s.sectionHint}>
            Committed per month, oldest first. Months with no activity show empty.
          </Text>
          <MonthlyChart points={monthly} />
        </Animated.View>

        {/* ─── Top inspectors ─────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(240).duration(240)} style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="people" size={14} color={C.primary} />
            <Text style={s.sectionTitle}>Top inspectors by spend (YTD)</Text>
          </View>
          <Text style={s.sectionHint}>
            Calendar-year totals. Cancelled jobs excluded.
          </Text>
          {byInspector.length === 0 ? (
            <Text style={s.empty}>No inspector spend recorded this year.</Text>
          ) : (
            <View style={s.inspectorList}>
              {byInspector.map((row, i) => (
                <View key={row.inspectorId} style={[s.inspectorRow, i > 0 && s.rowDivider]}>
                  <View style={s.inspectorIcon}>
                    <Text style={s.inspectorIconText}>
                      {row.inspectorName.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.inspectorName} numberOfLines={1}>
                      {row.inspectorName}
                    </Text>
                    <Text style={s.inspectorMeta}>
                      {row.jobCount} job{row.jobCount === 1 ? '' : 's'}
                      {row.lastJobAt ? `, last ${relativeTime(row.lastJobAt)}` : ''}
                    </Text>
                  </View>
                  <Text style={s.inspectorAmount}>{formatCents(row.totalCents)}</Text>
                </View>
              ))}
            </View>
          )}
        </Animated.View>

        {/* ─── Recent activity ─────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(300).duration(240)} style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="time" size={14} color={C.primary} />
            <Text style={s.sectionTitle}>Recent activity</Text>
          </View>
          <Text style={s.sectionHint}>Most recent 25 jobs across your scope.</Text>
          {recent.length === 0 ? (
            <Text style={s.empty}>No recent jobs to show.</Text>
          ) : (
            <View style={s.activityList}>
              {recent.map((row, i) => (
                <TouchableOpacity
                  key={row.jobId}
                  onPress={() => router.push(`/(client)/jobs/${row.jobId}` as any)}
                  style={[s.activityRow, i > 0 && s.rowDivider]}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.activityTitle} numberOfLines={1}>
                      {row.jobTitle}
                    </Text>
                    <View style={s.activityMetaRow}>
                      <StatusPill status={row.status} />
                      {(scope === 'org' || scope === 'platform') && (
                        <Text style={s.activityMeta} numberOfLines={1}>
                          {row.clientName}
                        </Text>
                      )}
                      <Text style={s.activityMeta}>{relativeTime(row.createdAt)}</Text>
                    </View>
                  </View>
                  <View style={s.activityRight}>
                    <Text style={s.activityAmount}>
                      {formatCents(row.clientPriceCents)}
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color={C.textMute} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Animated.View>

        {/* ─── Audit footnote ──────────────────────────────────────── */}
        <Text style={s.footnote}>
          Source, get_budget_summary, get_budget_monthly, get_budget_by_inspector,
          get_budget_recent_activity, RLS-gated via fin_visible_client_ids().
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ═════════════════════════════════════════════════════════════════════════
//  Sub-components
// ═════════════════════════════════════════════════════════════════════════

type Tone = 'violet' | 'cyan' | 'green' | 'amber' | 'red' | 'default';

function HeroTile({
  icon, label, value, sub, tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string; value: string; sub: string; tone: Tone;
}) {
  const palette = TONE_PALETTE[tone] ?? TONE_PALETTE.violet;
  return (
    <View style={[s.heroTile, { borderColor: palette.border }]}>
      <LinearGradient
        colors={[palette.bg, 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={s.heroGradient}
      />
      <View style={[s.heroIconRow]}>
        <Ionicons name={icon} size={14} color={palette.fg} />
        <Text style={[s.heroLabel, { color: palette.fg }]}>{label.toUpperCase()}</Text>
      </View>
      <Text style={[s.heroValue, { color: palette.fg }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={s.heroSub} numberOfLines={2}>{sub}</Text>
    </View>
  );
}

function RollupTile({
  icon, label, value, tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string; value: string; tone: Tone;
}) {
  const fg = (TONE_PALETTE[tone] ?? TONE_PALETTE.default).fg;
  return (
    <View style={s.rollupTile}>
      <View style={s.rollupIconRow}>
        <Ionicons name={icon} size={12} color={C.textMute} />
        <Text style={s.rollupLabel}>{label.toUpperCase()}</Text>
      </View>
      <Text style={[s.rollupValue, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function MonthlyChart({ points }: { points: MonthlyPoint[] }) {
  if (!points.length) {
    return <Text style={s.empty}>No activity in the last 12 months.</Text>;
  }
  const max = points.reduce((m, p) => Math.max(m, p.committedCents, p.completedCents), 0);

  return (
    <View style={{ marginTop: 14 }}>
      <View style={s.chartRow}>
        {points.map((p) => {
          const committedH = max > 0 ? (p.committedCents / max) * 100 : 0;
          const completedH = max > 0 ? (p.completedCents / max) * 100 : 0;
          return (
            <View key={p.monthStart} style={s.chartColumn}>
              <View style={s.chartBarTrack}>
                <View
                  style={[
                    s.chartBarCommitted,
                    { height: `${committedH}%` },
                  ]}
                />
                <View
                  style={[
                    s.chartBarCompleted,
                    { height: `${completedH}%` },
                  ]}
                />
              </View>
              <Text style={s.chartLabel} numberOfLines={1}>
                {p.monthLabel.split(' ')[0]}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={s.legendRow}>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: 'rgba(124,58,237,0.5)' }]} />
          <Text style={s.legendText}>Committed</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.legendDot, { backgroundColor: 'rgba(0,255,255,0.7)' }]} />
          <Text style={s.legendText}>Completed</Text>
        </View>
        <Text style={s.legendPeak}>12mo peak {formatCents(max)}</Text>
      </View>
    </View>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone: Tone = (() => {
    if (status === 'in_progress' || status === 'assigned') return 'cyan';
    if (status === 'completed') return 'green';
    if (status === 'disputed') return 'red';
    if (status === 'open') return 'violet';
    if (status === 'cancelled' || status === 'voided') return 'default';
    if (status === 'pending_approval' || status === 'pending_review') return 'amber';
    return 'default';
  })();
  const p = TONE_PALETTE[tone] ?? TONE_PALETTE.default;
  return (
    <View style={[s.pill, { borderColor: p.border, backgroundColor: p.bg }]}>
      <Text style={[s.pillText, { color: p.fg }]}>
        {status.replace(/_/g, ' ').toUpperCase()}
      </Text>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────
const TONE_PALETTE: Record<Tone, { fg: string; bg: string; border: string }> = {
  violet:  { fg: C.primary, bg: C.primaryDim, border: 'rgba(124,58,237,0.32)' },
  cyan:    { fg: C.cyan,    bg: C.cyanDim,    border: 'rgba(0,255,255,0.32)' },
  green:   { fg: C.green,   bg: C.greenDim,   border: 'rgba(16,185,129,0.32)' },
  amber:   { fg: C.amber,   bg: C.amberDim,   border: 'rgba(245,158,11,0.32)' },
  red:     { fg: C.red,     bg: C.redDim,     border: 'rgba(239,68,68,0.32)' },
  default: { fg: C.text,    bg: 'rgba(255,255,255,0.04)', border: C.border },
};

function numberOr(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 18 },

  // Center loading / error
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },

  // Header
  header: { gap: 6 },
  kicker: {
    color: 'rgba(124,58,237,0.85)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: { color: C.text, fontSize: 28, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },
  scopeChip: {
    alignSelf: 'flex-start',
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  scopeChipText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.redDim,
    borderColor: 'rgba(239,68,68,0.32)',
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
  },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  // Hero grid
  heroGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  heroTile: {
    flexBasis: '47.6%',
    flexGrow: 1,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: C.card,
    minHeight: 110,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  heroGradient: {
    position: 'absolute',
    top: 0, left: 0, right: 0, height: 60,
  },
  heroIconRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  heroValue: { fontSize: 22, fontWeight: '800', marginTop: 8, fontVariant: ['tabular-nums'] },
  heroSub: { color: C.textMute, fontSize: 10, marginTop: 4, lineHeight: 13 },

  // Rollup grid
  rollupGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rollupTile: {
    flexBasis: '23%', flexGrow: 1,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    minHeight: 70,
  },
  rollupIconRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rollupLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  rollupValue: { fontSize: 15, fontWeight: '700', marginTop: 6, fontVariant: ['tabular-nums'] },

  // Section
  section: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  sectionHint: { color: C.textMute, fontSize: 11, marginTop: 4, lineHeight: 15 },
  empty: { color: C.textMute, fontSize: 13, textAlign: 'center', marginTop: 16, paddingVertical: 12 },

  // Chart
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  chartColumn: { flex: 1, alignItems: 'center', gap: 4 },
  chartBarTrack: {
    width: '100%',
    height: 110,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 4,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    position: 'relative',
  },
  chartBarCommitted: {
    width: '100%',
    backgroundColor: 'rgba(124,58,237,0.5)',
  },
  chartBarCompleted: {
    width: '100%',
    backgroundColor: 'rgba(0,255,255,0.7)',
    position: 'absolute',
    bottom: 0,
  },
  chartLabel: { color: C.textMute, fontSize: 8, fontWeight: '600', letterSpacing: 0.4 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 12, height: 6, borderRadius: 2 },
  legendText: { color: C.textMute, fontSize: 10 },
  legendPeak: { color: C.textMute, fontSize: 10, marginLeft: 'auto', fontVariant: ['tabular-nums'] },

  // Inspector list
  inspectorList: { marginTop: 12 },
  inspectorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
  inspectorIcon: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: C.primaryDim,
    justifyContent: 'center', alignItems: 'center',
  },
  inspectorIconText: { color: C.primary, fontWeight: '700', fontSize: 13 },
  inspectorName: { color: C.text, fontWeight: '600', fontSize: 13 },
  inspectorMeta: { color: C.textMute, fontSize: 10, marginTop: 2 },
  inspectorAmount: { color: C.primary, fontWeight: '700', fontSize: 14, fontVariant: ['tabular-nums'] },

  // Activity
  activityList: { marginTop: 12 },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  activityTitle: { color: C.text, fontWeight: '600', fontSize: 13 },
  activityMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  activityMeta: { color: C.textMute, fontSize: 10 },
  activityRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activityAmount: { color: C.primary, fontWeight: '700', fontSize: 13, fontVariant: ['tabular-nums'] },

  // Pill
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5 },

  // Footnote
  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, paddingHorizontal: 4, textAlign: 'center' },
});
