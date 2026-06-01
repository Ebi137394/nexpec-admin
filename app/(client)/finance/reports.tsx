// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/finance/reports.tsx — Mobile Client Deliverables (reports list)
//
//  Web parity for /client/reports. Read-only list of inspection reports that
//  have been reviewed by admin and handed off to the client (GOLDEN_RULE_6:
//  admin_confirmed_at IS NOT NULL). Source: public.jobs, RLS-gated to
//  client_id = auth.uid(). GOLDEN_RULE_2: only client_price_cents (the
//  client's own money) is exposed — never inspector payout or spread.
//  Tap-through mirrors web → the job detail at /(client)/jobs/[id].
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', cyanDim: 'rgba(0,255,255,0.12)',
  green: '#10B981', greenDim: 'rgba(16,185,129,0.14)',
  amber: '#F59E0B', amberDim: 'rgba(245,158,11,0.14)',
  red: '#EF4444', redDim: 'rgba(239,68,68,0.14)',
};

// jobs.payout_status CHECK = unpaid | processing | paid | disputed
type PayoutStatus = 'unpaid' | 'processing' | 'paid' | 'disputed';

interface ReportRow {
  jobId: string;
  jobTitle: string | null;
  inspectorName: string | null;
  adminConfirmedAt: string | null;
  clientPriceCents: number | null;
  payoutStatus: PayoutStatus;
}

const ESCROW_LABEL: Record<PayoutStatus, string> = {
  unpaid: 'In escrow',
  processing: 'Processing',
  paid: 'Released',
  disputed: 'Disputed',
};

export default function ClientReportsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in to view your reports.');
        return;
      }

      // Deliverables = jobs handed off to the client (admin-reviewed).
      // RLS already scopes to the client; we also filter client_id for parity.
      const { data, error: qErr } = await supabase
        .from('jobs')
        .select('id, title, hired_inspector_id, contractor_id, admin_confirmed_at, status, updated_at, client_price_cents, payout_status')
        .eq('client_id', user.id)
        .not('admin_confirmed_at', 'is', null)
        .is('deleted_at', null)
        .order('admin_confirmed_at', { ascending: false })
        .limit(200);
      if (qErr) {
        setError(qErr.message);
        return;
      }

      const jobRows = (data ?? []) as Array<Record<string, unknown>>;

      // Hydrate inspector names from profiles (hired_inspector_id ?? contractor_id).
      const inspectorIds = Array.from(new Set(
        jobRows
          .flatMap((r) => [r.hired_inspector_id, r.contractor_id])
          .map((v) => (v == null ? '' : String(v)))
          .filter(Boolean),
      ));
      const nameById = new Map<string, string | null>();
      if (inspectorIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', inspectorIds);
        (profs as Array<{ id: string; full_name: string | null }> | null)?.forEach((p) =>
          nameById.set(p.id, p.full_name),
        );
      }

      setRows(jobRows.map((r) => {
        const hired = r.hired_inspector_id == null ? '' : String(r.hired_inspector_id);
        const contractor = r.contractor_id == null ? '' : String(r.contractor_id);
        const inspectorName =
          (hired && nameById.get(hired)) ||
          (contractor && nameById.get(contractor)) ||
          null;
        return {
          jobId: String(r.id),
          jobTitle: (r.title as string | null) ?? null,
          inspectorName,
          adminConfirmedAt: (r.admin_confirmed_at as string | null) ?? null,
          clientPriceCents: r.client_price_cents == null ? null : numberOr(r.client_price_cents, 0),
          payoutStatus: normalizePayout(r.payout_status),
        };
      }));
    } catch (e) {
      console.warn('[reports] load threw:', e);
      setError('Could not load reports.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={s.centerText}>Loading reports…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const releasedCount = rows.filter((r) => r.payoutStatus === 'paid').length;

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
      >
        {/* Header */}
        <Animated.View entering={FadeIn.duration(220)} style={s.header}>
          <Text style={s.kicker}>CLIENT PORTAL · DELIVERABLES</Text>
          <Text style={s.title}>Reports</Text>
          <Text style={s.subtitle}>
            Inspection reports reviewed by our team and ready for you. Each
            one was verified before hand-off — tap to open the full job.
          </Text>

          <View style={s.countChip}>
            <Ionicons name="document-text" size={12} color={C.primary} />
            <Text style={s.countChipText}>
              {rows.length} DELIVERABLE{rows.length === 1 ? '' : 'S'}
              {releasedCount > 0 ? ` · ${releasedCount} RELEASED` : ''}
            </Text>
          </View>
        </Animated.View>

        {error ? (
          <View style={s.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={C.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* List */}
        {rows.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="document-text-outline" size={32} color={C.textMute} />
            <Text style={s.emptyText}>
              No reports yet. Finished inspections appear here once our team
              has reviewed and handed them off to you.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map((r) => <ReportCard key={r.jobId} r={r} />)}
          </View>
        )}

        <Text style={s.footnote}>
          Source · public.jobs · handed-off (admin-reviewed) · RLS-gated by client_id.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function ReportCard({ r }: { r: ReportRow }) {
  return (
    <TouchableOpacity
      onPress={() => router.push(`/(client)/jobs/${r.jobId}` as any)}
      style={s.reportCard}
      activeOpacity={0.75}
    >
      <LinearGradient
        colors={[C.primaryDim, 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.reportCardGradient}
      />
      <View style={s.reportIcon}>
        <Ionicons name="document-text" size={18} color={C.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.reportTopRow}>
          <Text style={s.reportJob} numberOfLines={1}>
            {r.jobTitle ?? '(untitled job)'}
          </Text>
          <EscrowPill status={r.payoutStatus} />
        </View>
        <View style={s.reportMeta}>
          <Ionicons name="person-outline" size={10} color={C.textMute} />
          <Text style={s.reportMetaText} numberOfLines={1}>
            {r.inspectorName ?? 'Inspector —'}
          </Text>
        </View>
        <View style={s.reportMeta}>
          <Ionicons name="checkmark-done-outline" size={10} color={C.textMute} />
          <Text style={s.reportMetaText}>Handed off {formatDate(r.adminConfirmedAt)}</Text>
        </View>
      </View>
      <View style={s.reportRight}>
        {r.clientPriceCents != null && (
          <Text style={s.reportAmount}>{formatCents(r.clientPriceCents)}</Text>
        )}
        <Ionicons name="chevron-forward" size={14} color={C.textMute} />
      </View>
    </TouchableOpacity>
  );
}

function EscrowPill({ status }: { status: PayoutStatus }) {
  const palette = {
    unpaid: { fg: C.textMute, bg: 'rgba(255,255,255,0.04)', border: C.border },
    processing: { fg: C.cyan, bg: C.cyanDim, border: 'rgba(0,255,255,0.32)' },
    paid: { fg: C.green, bg: C.greenDim, border: 'rgba(16,185,129,0.32)' },
    disputed: { fg: C.red, bg: C.redDim, border: 'rgba(239,68,68,0.32)' },
  }[status];
  return (
    <View style={[s.pill, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[s.pillText, { color: palette.fg }]}>
        {ESCROW_LABEL[status].toUpperCase()}
      </Text>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function numberOr(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function normalizePayout(v: unknown): PayoutStatus {
  const s = String(v ?? 'unpaid');
  if (s === 'processing' || s === 'paid' || s === 'disputed') return s;
  return 'unpaid';
}
function formatCents(cents: number, currency = 'USD'): string {
  if (!Number.isFinite(cents)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);
}
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },

  header: { gap: 6 },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 28, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },
  countChip: {
    alignSelf: 'flex-start', marginTop: 10,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999, borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.32)', backgroundColor: C.primaryDim,
  },
  countChipText: { color: C.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.redDim, borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1,
    padding: 12, borderRadius: 12,
  },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  emptyState: {
    alignItems: 'center', padding: 32, gap: 10,
    borderRadius: 18, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },

  reportCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.card, overflow: 'hidden',
  },
  reportCardGradient: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 60,
  },
  reportIcon: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center',
  },
  reportTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  reportJob: { color: C.text, fontWeight: '600', fontSize: 14, flexShrink: 1 },
  reportMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  reportMetaText: { color: C.textMute, fontSize: 10, flexShrink: 1 },
  reportRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  reportAmount: { color: C.text, fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },

  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
