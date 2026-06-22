// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/wallet/statement.tsx — Mobile Inspector Earnings Statement
//
//  Mobile parity for web /inspector/wallet/statement/[period]. Period earnings
//  for the inspector: jobs where contractor_id = me AND payout_status = 'paid'
//  AND paid_at in the selected [start,end) range. Periods: month / quarter / year.
//
//  GOLDEN RULE 2 — STRICT: selects ONLY the admin-set inspector payout
//  (inspector_payout_cents). NEVER selects/derives client_price_cents or
//  platform_spread_cents. All columns verified against migrations
//  (00000000000000 baseline + 20260520120000). Web exports PDF; mobile exports a
//  native Share text statement.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView, Share, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { useLanguage } from '@/src/i18n/LanguageProvider';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  green: '#10B981', greenDim: 'rgba(16,185,129,0.14)', cyan: '#00FFFF', red: '#EF4444',
};

type Gran = 'month' | 'quarter' | 'year';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Line { jobId: string; title: string; paidAt: string | null; payoutCents: number; }

export default function InspectorStatementScreen() {
  const { t, language } = useLanguage();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [gran, setGran] = useState<Gran>('month');
  const [monthIdx, setMonthIdx] = useState(now.getMonth());     // 0-11
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1); // 1-4

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [inspectorName, setInspectorName] = useState<string>(t('Inspector'));
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => computeRange(year, gran, monthIdx, quarter), [year, gran, monthIdx, quarter]);
  const periodLabel = useMemo(() => labelFor(year, gran, monthIdx, quarter), [year, gran, monthIdx, quarter]);

  const load = useCallback(async (r: { start: string; end: string }) => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError(t('You must be signed in.')); return; }

      const profRes = await supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle();
      const pr = profRes.data as { full_name?: string | null; email?: string | null } | null;
      setInspectorName(pr?.full_name || pr?.email || t('Inspector'));

      // GR2: inspector payout ONLY. Never select client_price_cents / spread.
      const { data, error: qErr } = await supabase
        .from('jobs')
        .select('id, title, paid_at, completed_at, inspector_payout_cents, payout_status')
        .eq('contractor_id', user.id)
        .eq('payout_status', 'paid')
        .gte('paid_at', r.start)
        .lt('paid_at', r.end)
        .order('paid_at', { ascending: true });
      if (qErr) { setError(qErr.message); return; }

      setLines(((data ?? []) as Array<Record<string, unknown>>).map((j) => ({
        jobId: String(j.id),
        title: String(j.title ?? 'Inspection'),
        paidAt: (j.paid_at as string | null) ?? (j.completed_at as string | null) ?? null,
        payoutCents: j.inspector_payout_cents != null ? Number(j.inspector_payout_cents) : 0,
      })));
    } catch (e: unknown) {
      console.warn('[statement] load threw:', e);
      setError((e as Error)?.message ?? t('Could not load your statement.'));
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [language]);

  useEffect(() => { setLoading(true); void load(range); }, [load, range]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(range); }, [load, range]);

  const total = useMemo(() => lines.reduce((a, l) => a + l.payoutCents, 0), [lines]);

  const shareStatement = useCallback(async () => {
    try {
      const header = `NEXPEC, ${t('Payout statement')}\n${inspectorName}\n${t('Period:')} ${periodLabel}\n${t('Total paid:')} ${formatCents(total)}, ${lines.length} ${lines.length === 1 ? t('job') : t('jobs')}\n`;
      const body = lines.map((l) => `${l.paidAt ? formatDate(l.paidAt) : '—'}, ${l.title}, ${formatCents(l.payoutCents)}`).join('\n');
      await Share.share({ title: `${t('Payout statement')} ${periodLabel}`, message: `${header}\n${body || t('No paid jobs in this period.')}` });
    } catch (e: unknown) {
      Alert.alert(t('Could not share'), (e as Error)?.message ?? t('Unknown error.'));
    }
  }, [inspectorName, periodLabel, total, lines, language]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>{t('Building statement…')}</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>{t('Statement')}</Text>
        <TouchableOpacity onPress={shareStatement} hitSlop={10}><Ionicons name="share-outline" size={20} color={C.primary} /></TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        <Animated.View entering={FadeIn.duration(200)} style={s.heroWrap}>
          <Text style={s.kicker}>{t('INSPECTOR, EARNINGS')}</Text>
          <Text style={s.title}>{t('Payout statement')}</Text>
          <Text style={s.subtitle}>{t('Your settled payouts for the period, your admin-set inspector price only.')}</Text>
        </Animated.View>

        {/* Year + granularity */}
        <View style={s.yearRow}>
          <TouchableOpacity onPress={() => setYear((y) => y - 1)} hitSlop={8} style={s.yearBtn}><Ionicons name="chevron-back" size={16} color={C.textSec} /></TouchableOpacity>
          <Text style={s.yearText}>{year}</Text>
          <TouchableOpacity onPress={() => setYear((y) => Math.min(y + 1, now.getFullYear()))} hitSlop={8} style={s.yearBtn}><Ionicons name="chevron-forward" size={16} color={C.textSec} /></TouchableOpacity>
          <View style={{ flex: 1 }} />
          {(['month', 'quarter', 'year'] as Gran[]).map((g) => (
            <TouchableOpacity key={g} onPress={() => setGran(g)} style={[s.granChip, gran === g && s.granChipActive]} activeOpacity={0.7}>
              <Text style={[s.granChipText, gran === g && s.granChipTextActive]}>{t(g[0].toUpperCase() + g.slice(1))}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Period chips */}
        {gran !== 'year' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {gran === 'month'
              ? MONTHS.map((m, i) => (
                  <TouchableOpacity key={m} onPress={() => setMonthIdx(i)} style={[s.chip, monthIdx === i && s.chipActive]} activeOpacity={0.7}>
                    <Text style={[s.chipText, monthIdx === i && s.chipTextActive]}>{t(m)}</Text>
                  </TouchableOpacity>
                ))
              : [1, 2, 3, 4].map((q) => (
                  <TouchableOpacity key={q} onPress={() => setQuarter(q)} style={[s.chip, quarter === q && s.chipActive]} activeOpacity={0.7}>
                    <Text style={[s.chipText, quarter === q && s.chipTextActive]}>Q{q}</Text>
                  </TouchableOpacity>
                ))}
          </ScrollView>
        )}

        {error ? (<View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>) : null}

        {/* Summary */}
        <Animated.View entering={FadeInDown.delay(60).duration(220)} style={s.summaryCard}>
          <Text style={s.summaryLabel}>{periodLabel.toUpperCase()}, {t('TOTAL PAID')}</Text>
          <Text style={s.summaryTotal}>{formatCents(total)}</Text>
          <Text style={s.summaryMeta}>{lines.length} {lines.length === 1 ? t('settled job') : t('settled jobs')}</Text>
        </Animated.View>

        {/* Line items */}
        {lines.length === 0 ? (
          <View style={s.emptyState}><Ionicons name="receipt-outline" size={30} color={C.textMute} /><Text style={s.emptyText}>{t('No settled payouts in')} {periodLabel}.</Text></View>
        ) : (
          <View style={{ gap: 8 }}>
            {lines.map((l) => (
              <View key={l.jobId} style={s.lineRow}>
                <View style={s.lineIcon}><Ionicons name="checkmark-circle" size={15} color={C.green} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.lineTitle} numberOfLines={1}>{l.title}</Text>
                  <Text style={s.lineDate}>{t('Paid')} {l.paidAt ? formatDate(l.paidAt) : '—'}</Text>
                </View>
                <Text style={s.linePayout}>{formatCents(l.payoutCents)}</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={s.shareBtn} onPress={shareStatement} activeOpacity={0.85}>
          <Ionicons name="share-outline" size={16} color="#fff" /><Text style={s.shareBtnText}>{t('Share statement')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── period helpers ──────────────────────────────────────────────────────
function computeRange(year: number, gran: Gran, monthIdx: number, quarter: number): { start: string; end: string } {
  const iso = (y: number, m1: number) => `${y}-${String(m1).padStart(2, '0')}-01`;
  if (gran === 'year') return { start: iso(year, 1), end: iso(year + 1, 1) };
  if (gran === 'quarter') {
    const sm = (quarter - 1) * 3 + 1; const em = sm + 3;
    return { start: iso(year, sm), end: em > 12 ? iso(year + 1, 1) : iso(year, em) };
  }
  const m = monthIdx + 1;
  return { start: iso(year, m), end: m === 12 ? iso(year + 1, 1) : iso(year, m + 1) };
}
function labelFor(year: number, gran: Gran, monthIdx: number, quarter: number): string {
  if (gran === 'year') return String(year);
  if (gran === 'quarter') return `Q${quarter} ${year}`;
  return `${MONTHS[monthIdx]} ${year}`;
}
function formatCents(cents: number, currency = 'USD'): string {
  if (!Number.isFinite(cents)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);
}
function formatDate(iso: string): string { const t = new Date(iso).getTime(); return Number.isFinite(t) ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; }

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  heroWrap: { gap: 6 },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },

  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  yearBtn: { width: 30, height: 30, borderRadius: 9, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)' },
  yearText: { color: C.text, fontSize: 16, fontWeight: '800', minWidth: 48, textAlign: 'center' },
  granChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)', marginLeft: 6 },
  granChipActive: { backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)' },
  granChipText: { color: C.textSec, fontSize: 11, fontWeight: '700' },
  granChipTextActive: { color: C.primary },

  chipRow: { gap: 8, paddingHorizontal: 2, paddingVertical: 2 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  chipActive: { backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)' },
  chipText: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: C.primary, fontWeight: '700' },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1, padding: 12, borderRadius: 12 },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  summaryCard: { borderRadius: 16, borderWidth: 1, borderColor: 'rgba(16,185,129,0.28)', backgroundColor: C.greenDim, padding: 16, alignItems: 'center', gap: 3 },
  summaryLabel: { color: C.green, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  summaryTotal: { color: C.text, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  summaryMeta: { color: C.textSec, fontSize: 12 },

  emptyState: { alignItems: 'center', padding: 28, gap: 8, borderRadius: 16, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.01)' },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center' },

  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  lineIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.greenDim, justifyContent: 'center', alignItems: 'center' },
  lineTitle: { color: C.text, fontSize: 13, fontWeight: '600' },
  lineDate: { color: C.textMute, fontSize: 10, marginTop: 1 },
  linePayout: { color: C.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },

  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 13, marginTop: 2 },
  shareBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
