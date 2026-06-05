// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/negotiations.tsx — Counter-offer inbox (cross-job)
//
//  Mirrors the web /inspector/negotiations page. The inline counter card
//  on (inspector)/jobs/[id]/index.tsx is good for one-job-at-a-time, but
//  inspectors with multiple pending negotiations have no aggregated view.
//  This screen surfaces all of them in one inbox + lets the inspector
//  accept/decline directly without navigating to each job.
//
//  RPC contract:
//    inspector_respond_to_counter(p_application_id, p_decision, p_note)
//    Decision ∈ {'accepted', 'rejected'}. SECURITY DEFINER. Idempotency
//    guard prevents double-acts. After acceptance bid_amount_cents is
//    overwritten with admin_counter_cents and the negotiation closes.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

const C = {
  bg: '#020420',
  bgElev: '#070A24',
  card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF',
  textSec: '#A8B2C7',
  textMuted: '#6B7390',
  textDim: '#475569',
  primary: '#7C3AED',
  primaryDim: 'rgba(124, 58, 237, 0.14)',
  amber: '#F59E0B',
  amberDim: 'rgba(245, 158, 11, 0.14)',
  amberBorder: 'rgba(245, 158, 11, 0.32)',
  ok: '#10F995',
  okDim: 'rgba(16, 249, 149, 0.12)',
  okBorder: 'rgba(16, 249, 149, 0.32)',
  danger: '#EF4444',
  dangerDim: 'rgba(239, 68, 68, 0.14)',
  dangerBorder: 'rgba(239, 68, 68, 0.32)',
};

type NegotiationStatus =
  | 'admin_countered'
  | 'counter_accepted'
  | 'counter_rejected'
  | null;

interface Negotiation {
  id: string;
  job_id: string;
  job_title: string | null;
  bid_amount_cents: number | null;
  admin_counter_cents: number | null;
  admin_comment: string | null;
  admin_countered_at: string | null;
  negotiation_status: NegotiationStatus;
  inspector_decision: string | null;
  inspector_decision_at: string | null;
  inspector_decision_note: string | null;
  updated_at: string | null;
}

const STATUS_META: Record<NonNullable<NegotiationStatus>, { label: string; tone: string; toneDim: string; icon: string }> = {
  admin_countered: { label: 'AWAITING YOU', tone: C.amber, toneDim: C.amberDim, icon: 'time' },
  counter_accepted: { label: 'ACCEPTED', tone: C.ok, toneDim: C.okDim, icon: 'checkmark-circle' },
  counter_rejected: { label: 'DECLINED', tone: C.textMuted, toneDim: 'rgba(107,115,144,0.14)', icon: 'close-circle' },
};

const formatUSD = (cents: number | null) => {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
};

export default function InspectorNegotiationsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [items, setItems] = useState<Negotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      // Pull ALL negotiation states for this inspector — both pending and
      // resolved — so the inbox doubles as a history.
      const { data, error } = await supabase
        .from('applications')
        .select(
          'id, job_id, bid_amount_cents, admin_counter_cents, admin_comment, admin_countered_at, negotiation_status, inspector_decision, inspector_decision_at, inspector_decision_note, updated_at',
        )
        .eq('applicant_id', user.id)
        .not('admin_countered_at', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []) as Omit<Negotiation, 'job_title'>[];

      const jobIds = Array.from(new Set(rows.map((r) => r.job_id)));
      const titles = new Map<string, string | null>();
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase
          .from('jobs')
          .select('id, title')
          .in('id', jobIds);
        (jobs as Array<{ id: string; title: string | null }> | null)?.forEach((j) =>
          titles.set(j.id, j.title),
        );
      }
      setItems(rows.map((r) => ({ ...r, job_title: titles.get(r.job_id) ?? null })));
    } catch (err) {
      console.warn('[inspector-negotiations] fetch error:', (err as Error)?.message);
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  // ── Respond to counter ──────────────────────────────────────────────────
  const respond = useCallback(
    async (applicationId: string, decision: 'accepted' | 'rejected') => {
      if (actingId) return;
      const verb = decision === 'accepted' ? 'Accept' : 'Decline';
      const body =
        decision === 'accepted'
          ? 'Your bid will be replaced with the admin\'s counter amount. This is binding.'
          : 'The application returns to its prior state. Admin can issue a new counter later.';
      Alert.alert(`${verb} counter offer?`, body, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: verb,
          style: decision === 'accepted' ? 'default' : 'destructive',
          onPress: async () => {
            setActingId(applicationId);
            try {
              const { error } = await supabase.rpc('inspector_respond_to_counter', {
                p_application_id: applicationId,
                p_decision: decision,
                p_note: null,
              });
              if (error) throw error;
              await fetchAll();
            } catch (err: any) {
              Alert.alert(
                'Could not record decision',
                err?.message ?? 'Please try again in a moment.',
              );
            } finally {
              setActingId(null);
            }
          },
        },
      ]);
    },
    [actingId, fetchAll],
  );

  const counts = useMemo(
    () => ({
      pending: items.filter((i) => i.negotiation_status === 'admin_countered').length,
      accepted: items.filter((i) => i.negotiation_status === 'counter_accepted').length,
      rejected: items.filter((i) => i.negotiation_status === 'counter_rejected').length,
    }),
    [items],
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glow} />
      <SafeAreaView style={s.safeArea} edges={['top']}>
        <View style={s.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [s.iconBtn, pressed && { transform: [{ scale: 0.92 }] }]}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.kicker}>INSPECTOR PORTAL</Text>
            <Text style={s.headerTitle}>Negotiations</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void fetchAll();
              }}
              tintColor={C.primary}
              colors={[C.primary]}
            />
          }
        >
          <View style={s.statStrip}>
            <View style={{ flex: 1 }}>
              <Text style={[s.statValue, { color: C.amber }]}>{counts.pending}</Text>
              <Text style={s.statLabel}>Awaiting you</Text>
            </View>
            <View style={s.statDiv} />
            <View style={{ flex: 1 }}>
              <Text style={[s.statValue, { color: C.ok }]}>{counts.accepted}</Text>
              <Text style={s.statLabel}>Accepted</Text>
            </View>
            <View style={s.statDiv} />
            <View style={{ flex: 1 }}>
              <Text style={[s.statValue, { color: C.textMuted }]}>{counts.rejected}</Text>
              <Text style={s.statLabel}>Declined</Text>
            </View>
          </View>

          {loading ? (
            <View style={{ paddingVertical: 60, alignItems: 'center', gap: 12 }}>
              <ActivityIndicator size="large" color={C.primary} />
              <Text style={s.loadingText}>LOADING NEGOTIATIONS…</Text>
            </View>
          ) : items.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="swap-horizontal" size={22} color={C.primary} />
              </View>
              <Text style={s.emptyTitle}>No negotiations yet</Text>
              <Text style={s.emptySub}>
                When admin sends a counter-offer on one of your bids, it lands here.
                You can accept or decline without navigating to each job.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10, marginTop: 12 }}>
              {items.map((n, i) => {
                const acting = actingId === n.id;
                const meta = n.negotiation_status ? STATUS_META[n.negotiation_status] : null;
                const isPending = n.negotiation_status === 'admin_countered';
                const original = n.bid_amount_cents ?? 0;
                const counter = n.admin_counter_cents ?? 0;
                const delta = counter - original;
                const deltaPct = original > 0 ? ((delta / original) * 100).toFixed(1) : null;
                return (
                  <Animated.View
                    key={n.id}
                    entering={FadeInDown.delay(Math.min(i, 6) * 60).duration(300)}
                  >
                    <View
                      style={[
                        s.card,
                        isPending && { borderColor: C.amberBorder },
                      ]}
                    >
                      <View style={s.cardTopRow}>
                        <Pressable
                          style={{ flex: 1, minWidth: 0 }}
                          onPress={() => router.push(`/(inspector)/jobs/${n.job_id}` as any)}
                        >
                          <Text style={s.cardTitle} numberOfLines={1}>
                            {n.job_title ?? 'Untitled job'}
                          </Text>
                          <Text style={s.cardTime}>
                            {n.admin_countered_at
                              ? `Counter sent ${new Date(n.admin_countered_at).toLocaleString()}`
                              : ''}
                          </Text>
                        </Pressable>
                        {meta && (
                          <View
                            style={[
                              s.statusPill,
                              { backgroundColor: meta.toneDim, borderColor: meta.tone + '55' },
                            ]}
                          >
                            <Ionicons name={meta.icon as any} size={9} color={meta.tone} />
                            <Text style={[s.statusPillText, { color: meta.tone }]}>
                              {meta.label}
                            </Text>
                          </View>
                        )}
                      </View>

                      {/* Money diff row */}
                      <View style={s.moneyRow}>
                        <View style={s.moneyCol}>
                          <Text style={s.moneyLabel}>YOUR BID</Text>
                          <Text style={s.moneyOriginal}>{formatUSD(n.bid_amount_cents)}</Text>
                        </View>
                        <Ionicons name="arrow-forward" size={16} color={C.textDim} />
                        <View style={s.moneyCol}>
                          <Text style={s.moneyLabel}>COUNTER</Text>
                          <Text style={[s.moneyCounter, { color: isPending ? C.amber : C.text }]}>
                            {formatUSD(n.admin_counter_cents)}
                          </Text>
                          {deltaPct != null && (
                            <Text
                              style={[
                                s.moneyDelta,
                                { color: delta >= 0 ? C.ok : C.danger },
                              ]}
                            >
                              {delta >= 0 ? '+' : ''}
                              {deltaPct}%
                            </Text>
                          )}
                        </View>
                      </View>

                      {n.admin_comment && (
                        <View style={s.commentBox}>
                          <Text style={s.commentLabel}>ADMIN NOTE</Text>
                          <Text style={s.commentText}>{n.admin_comment}</Text>
                        </View>
                      )}

                      {n.inspector_decision_at && (
                        <Text style={s.decisionMeta}>
                          You {n.inspector_decision === 'accepted' ? 'accepted' : 'declined'}{' '}
                          {new Date(n.inspector_decision_at).toLocaleString()}
                          {n.inspector_decision_note ? `, "${n.inspector_decision_note}"` : ''}
                        </Text>
                      )}

                      {isPending && (
                        <View style={s.actionRow}>
                          <Pressable
                            onPress={() => respond(n.id, 'rejected')}
                            disabled={acting}
                            style={({ pressed }) => [
                              s.declineBtn,
                              acting && { opacity: 0.5 },
                              pressed && { transform: [{ scale: 0.97 }] },
                            ]}
                          >
                            <Ionicons name="close" size={13} color={C.danger} />
                            <Text style={s.declineText}>Decline</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => respond(n.id, 'accepted')}
                            disabled={acting}
                            style={({ pressed }) => [
                              s.acceptBtn,
                              acting && { opacity: 0.5 },
                              pressed && { transform: [{ scale: 0.97 }] },
                            ]}
                          >
                            {acting ? (
                              <ActivityIndicator size="small" color="#1F1300" />
                            ) : (
                              <Ionicons name="checkmark" size={14} color="#1F1300" />
                            )}
                            <Text style={s.acceptText}>{acting ? 'Recording…' : 'Accept'}</Text>
                          </Pressable>
                        </View>
                      )}

                      {!isPending && (
                        <Pressable
                          onPress={() => router.push(`/(inspector)/jobs/${n.job_id}` as any)}
                          style={({ pressed }) => [
                            s.viewBtn,
                            pressed && { transform: [{ scale: 0.98 }] },
                          ]}
                        >
                          <Text style={s.viewBtnText}>Open job</Text>
                          <Ionicons name="chevron-forward" size={12} color={C.textSec} />
                        </Pressable>
                      )}
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safeArea: { flex: 1 },
  glow: {
    position: 'absolute',
    top: -160,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: C.amber,
    opacity: 0.05,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: C.bgElev,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  kicker: { color: C.amber, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 1 },

  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 6,
    gap: 16,
  },
  statValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: {
    color: C.textMuted,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  statDiv: { width: 1, height: 28, backgroundColor: C.border },

  loadingText: { color: C.textMuted, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4 },

  empty: {
    marginTop: 20,
    padding: 28,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    backgroundColor: C.card,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: C.primaryDim,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  emptySub: { color: C.textMuted, fontSize: 11.5, lineHeight: 16, textAlign: 'center' },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 14,
  },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  cardTime: { color: C.textMuted, fontSize: 10.5, fontStyle: 'italic', marginTop: 3 },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  moneyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    gap: 12,
  },
  moneyCol: { flex: 1 },
  moneyLabel: {
    color: C.textMuted,
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  moneyOriginal: {
    color: C.textSec,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    textDecorationLine: 'line-through',
  },
  moneyCounter: {
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.4,
  },
  moneyDelta: {
    fontSize: 10.5,
    fontWeight: '800',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  commentBox: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  commentLabel: { color: C.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4 },
  commentText: { color: C.text, fontSize: 12, lineHeight: 17 },

  decisionMeta: {
    color: C.textMuted,
    fontSize: 10.5,
    fontStyle: 'italic',
    marginBottom: 12,
  },

  actionRow: { flexDirection: 'row', gap: 8 },
  declineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: C.dangerDim,
    borderWidth: 1,
    borderColor: C.dangerBorder,
    paddingVertical: 11,
    borderRadius: 11,
  },
  declineText: { color: C.danger, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  acceptBtn: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.ok,
    paddingVertical: 11,
    borderRadius: 11,
    shadowColor: C.ok,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  acceptText: { color: '#0A2818', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.3 },

  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: C.bgElev,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 10,
    borderRadius: 11,
  },
  viewBtnText: { color: C.textSec, fontSize: 11.5, fontWeight: '700' },
});
