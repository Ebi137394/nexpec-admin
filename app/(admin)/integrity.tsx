// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/integrity.tsx — Mobile Integrity Console (Predictive Integrity)
//
//  Web parity for /admin/integrity. Admin-gated (role IN admin/super_admin —
//  the inspector_integrity_analytics RPC also fail-closes to self/empty). 100%
//  read-only. Calls the SAME RPC and the SAME shared-core scorer the web uses
//  (computeIntegrityRisk / cohortFromRpc / inspectorMetricsFromRpc) → identical
//  numbers on both platforms. No model, pure statistics, $0.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import {
  cohortFromRpc, inspectorMetricsFromRpc, computeIntegrityRisk,
  type IntegrityRiskScore, type InspectorIntegrityMetrics, type RiskBand,
} from '@nexpec/shared-core';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  green: '#10B981', amber: '#F59E0B', orange: '#FB923C', red: '#EF4444',
};

const WINDOWS = [30, 90, 180, 365];

const BAND: Record<RiskBand, { fg: string; bg: string; border: string; label: string }> = {
  low: { fg: C.green, bg: 'rgba(16,185,129,0.14)', border: 'rgba(16,185,129,0.32)', label: 'LOW' },
  elevated: { fg: C.amber, bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.32)', label: 'ELEVATED' },
  high: { fg: C.orange, bg: 'rgba(251,146,60,0.14)', border: 'rgba(251,146,60,0.34)', label: 'HIGH' },
  critical: { fg: C.red, bg: 'rgba(239,68,68,0.14)', border: 'rgba(239,68,68,0.34)', label: 'CRITICAL' },
};

interface ScoredRow { m: InspectorIntegrityMetrics; score: IntegrityRiskScore; }
interface Payload {
  ok?: boolean; scope?: string;
  summary?: Record<string, unknown>;
  cohort?: Record<string, unknown>;
  inspectors?: Record<string, unknown>[];
}

export default function IntegrityConsoleScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [windowDays, setWindowDays] = useState(90);
  const [rows, setRows] = useState<ScoredRow[]>([]);
  const [summary, setSummary] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (days: number) => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }
      const profRes = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const role = (profRes.data as { role?: string } | null)?.role;
      const admin = role === 'admin' || role === 'super_admin';
      setIsAdmin(admin);
      if (!admin) return;

      // Same RPC + casts as the web page (types not regenerated yet).
      const { data, error: rpcErr } = await supabase.rpc(
        'inspector_integrity_analytics' as never,
        { p_window_days: days } as never,
      );
      if (rpcErr) { setError(rpcErr.message); return; }

      const payload = (data ?? {}) as Payload;
      const cohort = cohortFromRpc(payload.cohort ?? {});
      const scored: ScoredRow[] = (payload.inspectors ?? [])
        .map((raw) => {
          const m = inspectorMetricsFromRpc(raw);
          return { m, score: computeIntegrityRisk(m, cohort) };
        })
        .sort((a, b) => b.score.score - a.score.score);
      setRows(scored);
      setSummary(payload.summary ?? {});
    } catch (e: unknown) {
      console.warn('[integrity] load threw:', e);
      setError((e as Error)?.message ?? 'Could not load the integrity console.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(windowDays); }, [load, windowDays]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(windowDays); }, [load, windowDays]);

  const watch = useMemo(() => {
    const brokenChains = rows.filter((r) => r.m.chainBreakRate > 0).length;
    const rubberStamping = rows.filter((r) => {
      const ft = r.score.components.find((c) => c.key === 'fast_turnaround');
      const le = r.score.components.find((c) => c.key === 'low_evidence');
      return (ft?.risk ?? 0) >= 0.6 || (le?.risk ?? 0) >= 0.6;
    }).length;
    const elevatedPlus = rows.filter((r) => r.score.band === 'high' || r.score.band === 'critical').length;
    return { brokenChains, rubberStamping, elevatedPlus };
  }, [rows]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>Scoring inspectors…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Integrity console</Text>
        <View style={{ width: 22 }} />
      </View>

      {!isAdmin ? (
        <View style={s.center}><View style={s.reservedCard}><Ionicons name="lock-closed-outline" size={20} color={C.amber} /><Text style={s.reservedTitle}>Reserved access</Text><Text style={s.reservedBody}>The integrity console is reserved for the platform owner (admin).</Text></View></View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
        >
          <Animated.View entering={FadeIn.duration(220)} style={s.heroWrap}>
            <Text style={s.kicker}>PLATFORM · PREDICTIVE INTEGRITY</Text>
            <Text style={s.title}>Inspector risk forecast</Text>
            <Text style={s.subtitle}>
              Every inspector scored against the cohort on the signals that precede disputes —
              broken evidence chains, thin evidence, rushed seals. From cryptographic seal
              history; no self-reports.
            </Text>
            <View style={s.windowRow}>
              {WINDOWS.map((d) => {
                const active = d === windowDays;
                return (
                  <TouchableOpacity key={d} onPress={() => setWindowDays(d)} style={[s.windowChip, active && s.windowChipActive]} activeOpacity={0.7}>
                    <Text style={[s.windowChipText, active && s.windowChipTextActive]}>{d}d</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>

          {error ? (
            <View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>
          ) : null}

          {/* Watchlist */}
          <Animated.View entering={FadeInDown.delay(60).duration(240)} style={s.watchRow}>
            <WatchCard icon="link-outline" label="Broken chains" value={watch.brokenChains} tone={watch.brokenChains > 0 ? C.red : C.textMute} />
            <WatchCard icon="flash-outline" label="Rubber-stamping" value={watch.rubberStamping} tone={watch.rubberStamping > 0 ? C.orange : C.textMute} />
            <WatchCard icon="warning-outline" label="High / critical" value={watch.elevatedPlus} tone={watch.elevatedPlus > 0 ? C.amber : C.textMute} />
          </Animated.View>

          {/* Platform summary */}
          <Animated.View entering={FadeInDown.delay(120).duration(240)} style={s.statsGrid}>
            <StatTile label="INSPECTORS" value={num(summary.inspectors)} />
            <StatTile label="SEALS" value={num(summary.seals)} />
            <StatTile label="CHAIN-BREAK" value={`${Math.round(toNum(summary.chain_break_rate) * 100)}%`} tone={toNum(summary.chain_break_rate) > 0 ? C.amber : undefined} />
            <StatTile label="CAP/SEAL" value={fmt(summary.avg_captures_per_seal, 1)} />
            <StatTile label="TURNAROUND" value={`${fmt(summary.avg_turnaround_hours, 1)}h`} />
            <StatTile label="DISPUTES" value={num(summary.disputes)} tone={toNum(summary.disputes) > 0 ? C.red : undefined} />
          </Animated.View>

          {/* Ranked risk list */}
          {rows.length === 0 ? (
            <View style={s.emptyState}>
              <Ionicons name="shield-checkmark-outline" size={32} color={C.textMute} />
              <Text style={s.emptyText}>No sealed inspections in this window yet — nothing to score.</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {rows.map((r) => (
                <RiskCard key={r.m.inspectorId} row={r} open={expanded === r.m.inspectorId} onToggle={() => setExpanded(expanded === r.m.inspectorId ? null : r.m.inspectorId)} />
              ))}
            </View>
          )}

          <Text style={s.footnote}>Source · inspector_integrity_analytics RPC · shared-core risk scorer · read-only.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────
function RiskCard({ row, open, onToggle }: { row: ScoredRow; open: boolean; onToggle: () => void }) {
  const { m, score } = row;
  const b = BAND[score.band];
  const ft = score.components.find((c) => c.key === 'fast_turnaround');
  const le = score.components.find((c) => c.key === 'low_evidence');
  const chips: Array<{ t: string; fg: string }> = [];
  if (m.chainBreakRate > 0) chips.push({ t: 'Broken chains', fg: C.red });
  if (m.disputes > 0) chips.push({ t: `${m.disputes} dispute${m.disputes === 1 ? '' : 's'}`, fg: C.red });
  if ((ft?.risk ?? 0) >= 0.6) chips.push({ t: 'Rushed seals', fg: C.orange });
  if ((le?.risk ?? 0) >= 0.6) chips.push({ t: 'Thin evidence', fg: C.amber });
  if (m.revisions > 0) chips.push({ t: `${m.revisions} revision${m.revisions === 1 ? '' : 's'}`, fg: C.amber });

  return (
    <TouchableOpacity style={s.riskCard} activeOpacity={0.85} onPress={onToggle}>
      <View style={s.riskTop}>
        <View style={[s.scoreBox, { borderColor: b.border, backgroundColor: b.bg }]}>
          <Text style={[s.scoreNum, { color: b.fg }]}>{Math.round(score.score)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.riskLabelRow}>
            <Text style={s.riskLabel} numberOfLines={1}>{m.inspectorLabel ?? m.inspectorId.slice(0, 8)}</Text>
            <View style={[s.bandPill, { backgroundColor: b.bg, borderColor: b.border }]}>
              <Text style={[s.bandPillText, { color: b.fg }]}>{b.label}</Text>
            </View>
            {score.insufficientData && (
              <View style={[s.bandPill, { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: C.border }]}>
                <Text style={[s.bandPillText, { color: C.textMute }]}>PROVISIONAL</Text>
              </View>
            )}
          </View>
          <Text style={s.riskRationale} numberOfLines={open ? undefined : 2}>{score.rationale}</Text>
          {chips.length > 0 && (
            <View style={s.chipRow}>
              {chips.map((c, i) => (
                <View key={i} style={[s.flagChip, { borderColor: c.fg + '55' }]}><Text style={[s.flagChipText, { color: c.fg }]}>{c.t}</Text></View>
              ))}
            </View>
          )}
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMute} />
      </View>

      {open && (
        <View style={s.breakdown}>
          {score.components.map((c) => {
            const barFg = c.risk >= 0.6 ? C.red : c.risk >= 0.35 ? C.amber : C.green;
            return (
              <View key={c.key} style={s.compRow}>
                <View style={s.compHead}>
                  <Text style={s.compLabel}>{c.label}</Text>
                  <Text style={[s.compPct, { color: barFg }]}>{Math.round(c.risk * 100)}%{c.z != null ? `  ·  z ${c.z > 0 ? '+' : ''}${c.z}` : ''}</Text>
                </View>
                <View style={s.barTrack}><View style={[s.barFill, { width: `${Math.max(2, Math.round(c.risk * 100))}%`, backgroundColor: barFg }]} /></View>
                <Text style={s.compNote}>{c.note}</Text>
              </View>
            );
          })}
        </View>
      )}
    </TouchableOpacity>
  );
}

function WatchCard({ icon, label, value, tone }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: number; tone: string }) {
  return (
    <View style={s.watchCard}>
      <Ionicons name={icon} size={16} color={tone} />
      <Text style={[s.watchValue, { color: tone }]}>{value}</Text>
      <Text style={s.watchLabel}>{label}</Text>
    </View>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.statTile}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, { color: tone ?? C.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function toNum(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function num(v: unknown): string { return String(Math.round(toNum(v))); }
function fmt(v: unknown, dp: number): string { const n = toNum(v); return n.toFixed(dp); }

// ─── Styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  heroWrap: { gap: 6 },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 26, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },
  windowRow: { flexDirection: 'row', gap: 6, marginTop: 12, alignSelf: 'flex-start', padding: 4, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  windowChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  windowChipActive: { backgroundColor: C.primaryDim },
  windowChipText: { color: C.textMute, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  windowChipTextActive: { color: C.primary },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1, padding: 12, borderRadius: 12 },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  watchRow: { flexDirection: 'row', gap: 8 },
  watchCard: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  watchValue: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  watchLabel: { color: C.textMute, fontSize: 9.5, fontWeight: '600', textAlign: 'center' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { flexBasis: '30%', flexGrow: 1, padding: 12, minHeight: 60, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  statLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  statValue: { fontSize: 18, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },

  emptyState: { alignItems: 'center', padding: 32, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.01)' },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },

  riskCard: { borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 14 },
  riskTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  scoreBox: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  scoreNum: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  riskLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  riskLabel: { color: C.text, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  riskRationale: { color: C.textSec, fontSize: 11.5, lineHeight: 16, marginTop: 3 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 },
  flagChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  flagChipText: { fontSize: 9, fontWeight: '700' },

  bandPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  bandPillText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },

  breakdown: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', gap: 12 },
  compRow: { gap: 4 },
  compHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  compLabel: { color: C.text, fontSize: 12, fontWeight: '600' },
  compPct: { fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'] },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  compNote: { color: C.textMute, fontSize: 10, lineHeight: 14 },

  reservedCard: { alignItems: 'center', gap: 8, padding: 24, maxWidth: 320, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', backgroundColor: 'rgba(245,158,11,0.14)' },
  reservedTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
