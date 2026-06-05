// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/finance/invoices.tsx — Mobile Invoice Approver (list)
//
//  Reads public.invoices via RLS (auto-filtered to client_id = auth.uid()
//  or org-rollup via fin_visible_client_ids). Filter chips by status,
//  tap-through to detail at /(client)/finance/invoices/[id].
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

type InvoiceStatus = 'pending_review' | 'approved' | 'disputed' | 'paid' | 'voided';
type FilterKey = 'all' | InvoiceStatus;

interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  jobId: string;
  jobTitle: string | null;
  totalCents: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string;
  dueDate: string | null;
}

interface Counts {
  total: number; pendingReview: number; approved: number;
  disputed: number; paid: number; voided: number;
  outstandingCents: number;
}

const EMPTY_COUNTS: Counts = {
  total: 0, pendingReview: 0, approved: 0, disputed: 0,
  paid: 0, voided: 0, outstandingCents: 0,
};

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  disputed: 'Disputed',
  paid: 'Paid',
  voided: 'Voided',
};

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'pending_review', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'paid', label: 'Paid' },
];

export default function InvoicesListScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<InvoiceRow[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in to view invoices.');
        return;
      }

      // Build query
      let q = supabase
        .from('invoices')
        .select('id, invoice_number, job_id, total_cents, currency, status, issued_at, due_date')
        .order('issued_at', { ascending: false })
        .limit(100);
      if (filter !== 'all') q = q.eq('status', filter);
      const { data, error: qErr } = await q;
      if (qErr) {
        setError(qErr.message);
        return;
      }

      const invRows = (data ?? []) as Array<Record<string, unknown>>;
      const jobIds = Array.from(new Set(invRows.map((r) => r.job_id as string).filter(Boolean)));
      const titleByJob = new Map<string, string | null>();
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase.from('jobs').select('id, title').in('id', jobIds);
        (jobs as Array<{ id: string; title: string | null }> | null)?.forEach((j) =>
          titleByJob.set(j.id, j.title),
        );
      }

      setRows(invRows.map((r) => ({
        id: String(r.id),
        invoiceNumber: String(r.invoice_number ?? ''),
        jobId: String(r.job_id ?? ''),
        jobTitle: titleByJob.get(String(r.job_id ?? '')) ?? null,
        totalCents: numberOr(r.total_cents, 0),
        currency: String(r.currency ?? 'USD'),
        status: ((r.status as InvoiceStatus) ?? 'pending_review') as InvoiceStatus,
        issuedAt: String(r.issued_at ?? ''),
        dueDate: (r.due_date as string | null) ?? null,
      })));

      // Counts (separate lightweight query — fetches all, no filter)
      const { data: allRows } = await supabase
        .from('invoices')
        .select('status, total_cents');
      const c: Counts = { ...EMPTY_COUNTS };
      (allRows as Array<{ status: string; total_cents: number | string | null }> | null)?.forEach((r) => {
        c.total += 1;
        if (r.status === 'pending_review') c.pendingReview += 1;
        else if (r.status === 'approved') c.approved += 1;
        else if (r.status === 'disputed') c.disputed += 1;
        else if (r.status === 'paid') c.paid += 1;
        else if (r.status === 'voided') c.voided += 1;
        if (r.status === 'pending_review' || r.status === 'approved') {
          c.outstandingCents += numberOr(r.total_cents, 0);
        }
      });
      setCounts(c);
    } catch (e) {
      console.warn('[invoices] load threw:', e);
      setError('Could not load invoices.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={s.centerText}>Loading invoices…</Text>
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
      >
        {/* Header */}
        <Animated.View entering={FadeIn.duration(220)} style={s.header}>
          <Text style={s.kicker}>CLIENT PORTAL, FINANCE</Text>
          <Text style={s.title}>Invoices</Text>
          <Text style={s.subtitle}>
            Every executed contract auto-issues an invoice here. Review,
            approve, or raise a dispute. Disputed invoices are mediated
            by admin.
          </Text>

          <View style={s.outstandingChip}>
            <Ionicons name="hourglass" size={12} color={C.amber} />
            <Text style={s.outstandingChipText}>
              OUTSTANDING, {formatCents(counts.outstandingCents)}
            </Text>
          </View>
        </Animated.View>

        {error ? (
          <View style={s.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={C.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Stats strip */}
        <Animated.View entering={FadeInDown.delay(60).duration(240)} style={s.statsGrid}>
          <StatTile label="TOTAL" value={String(counts.total)} tone="default" />
          <StatTile label="PENDING" value={String(counts.pendingReview)} tone={counts.pendingReview > 0 ? 'amber' : 'default'} />
          <StatTile label="APPROVED" value={String(counts.approved)} tone="violet" />
          <StatTile label="DISPUTED" value={String(counts.disputed)} tone={counts.disputed > 0 ? 'red' : 'default'} />
        </Animated.View>

        {/* Filter chips */}
        <Animated.View entering={FadeInDown.delay(120).duration(240)}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.filterRow}
          >
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  style={[s.filterChip, active && s.filterChipActive]}
                  activeOpacity={0.7}
                >
                  <Text style={[s.filterChipText, active && s.filterChipTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>

        {/* List */}
        {rows.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="document-text-outline" size={32} color={C.textMute} />
            <Text style={s.emptyText}>
              {filter === 'all'
                ? 'No invoices yet. They auto-issue when a contract reaches fully-executed.'
                : `No ${STATUS_LABEL[filter as InvoiceStatus].toLowerCase()} invoices.`}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map((inv) => <InvoiceCard key={inv.id} inv={inv} />)}
          </View>
        )}

        <Text style={s.footnote}>
          Source, public.invoices, RLS-gated by client_id and admin scope.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function InvoiceCard({ inv }: { inv: InvoiceRow }) {
  return (
    <TouchableOpacity
      onPress={() => router.push(`/(client)/finance/invoices/${inv.id}` as any)}
      style={s.invoiceCard}
      activeOpacity={0.75}
    >
      <LinearGradient
        colors={[C.primaryDim, 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.invoiceCardGradient}
      />
      <View style={s.invoiceIcon}>
        <Ionicons name="receipt" size={18} color={C.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.invoiceTopRow}>
          <Text style={s.invoiceNumber}>{inv.invoiceNumber}</Text>
          <StatusPill status={inv.status} />
        </View>
        <Text style={s.invoiceJob} numberOfLines={1}>
          {inv.jobTitle ?? '(untitled job)'}
        </Text>
        <View style={s.invoiceMeta}>
          <Ionicons name="calendar-outline" size={10} color={C.textMute} />
          <Text style={s.invoiceMetaText}>Issued {formatDate(inv.issuedAt)}</Text>
          {inv.dueDate && (
            <>
              <Text style={s.invoiceMetaText}>Due {formatDate(inv.dueDate)}</Text>
            </>
          )}
        </View>
      </View>
      <View style={s.invoiceRight}>
        <Text style={s.invoiceAmount}>{formatCents(inv.totalCents, inv.currency)}</Text>
        <Ionicons name="chevron-forward" size={14} color={C.textMute} />
      </View>
    </TouchableOpacity>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: 'default' | 'violet' | 'green' | 'amber' | 'red' }) {
  const fg = tone === 'violet' ? C.primary : tone === 'green' ? C.green : tone === 'amber' ? C.amber : tone === 'red' ? C.red : C.text;
  return (
    <View style={s.statTile}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

function StatusPill({ status }: { status: InvoiceStatus }) {
  const palette = {
    pending_review: { fg: C.amber, bg: C.amberDim, border: 'rgba(245,158,11,0.32)' },
    approved: { fg: C.primary, bg: C.primaryDim, border: 'rgba(124,58,237,0.32)' },
    disputed: { fg: C.red, bg: C.redDim, border: 'rgba(239,68,68,0.32)' },
    paid: { fg: C.green, bg: C.greenDim, border: 'rgba(16,185,129,0.32)' },
    voided: { fg: C.textMute, bg: 'rgba(255,255,255,0.04)', border: C.border },
  }[status];
  return (
    <View style={[s.pill, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[s.pillText, { color: palette.fg }]}>
        {STATUS_LABEL[status].toUpperCase()}
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
  outstandingChip: {
    alignSelf: 'flex-start', marginTop: 10,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 999, borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.32)', backgroundColor: C.amberDim,
  },
  outstandingChipText: { color: C.amber, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.redDim, borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1,
    padding: 12, borderRadius: 12,
  },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: {
    flexBasis: '23%', flexGrow: 1, padding: 12, minHeight: 64,
    borderRadius: 14, borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  statLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  statValue: { fontSize: 18, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },

  filterRow: { gap: 8, paddingHorizontal: 2 },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)',
  },
  filterChipActive: { backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)' },
  filterChipText: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: C.primary, fontWeight: '700' },

  emptyState: {
    alignItems: 'center', padding: 32, gap: 10,
    borderRadius: 18, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },

  invoiceCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.card, overflow: 'hidden',
  },
  invoiceCardGradient: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 60,
  },
  invoiceIcon: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center',
  },
  invoiceTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  invoiceNumber: { color: C.textMute, fontSize: 10, fontFamily: 'monospace' },
  invoiceJob: { color: C.text, fontWeight: '600', fontSize: 14, marginTop: 4 },
  invoiceMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  invoiceMetaText: { color: C.textMute, fontSize: 10 },
  invoiceRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  invoiceAmount: { color: C.text, fontWeight: '700', fontSize: 15, fontVariant: ['tabular-nums'] },

  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
