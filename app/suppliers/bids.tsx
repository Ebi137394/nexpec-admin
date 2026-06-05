// app/suppliers/bids.tsx — Supplier: My Bids (mobile parity with web).
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { toCents, formatUsd } from '../../src/core/utils/money';
import { useMyQuotes } from '../../src/hooks/useSupplierEcosystem';

const STATUS: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  submitted: { label: 'Submitted', color: '#38BDF8', bg: 'rgba(56,189,248,0.16)', icon: 'time-outline' },
  shortlisted: { label: 'Shortlisted', color: '#F59E0B', bg: 'rgba(245,158,11,0.16)', icon: 'trophy-outline' },
  accepted: { label: 'Awarded', color: '#10B981', bg: 'rgba(16,185,129,0.16)', icon: 'rocket-outline' },
  declined: { label: 'Not selected', color: '#EF4444', bg: 'rgba(239,68,68,0.14)', icon: 'close-circle-outline' },
  withdrawn: { label: 'Withdrawn', color: '#94A3B8', bg: 'rgba(148,163,184,0.14)', icon: 'remove-circle-outline' },
};
type Tab = 'active' | 'won' | 'all';

export default function SupplierBids() {
  const router = useRouter();
  const { items, loading } = useMyQuotes();
  const [tab, setTab] = useState<Tab>('active');

  const counts = useMemo(() => ({
    active: items.filter((q) => q.status === 'submitted' || q.status === 'shortlisted').length,
    won: items.filter((q) => q.status === 'accepted').length, all: items.length,
  }), [items]);
  const list = useMemo(() => {
    if (tab === 'active') return items.filter((q) => q.status === 'submitted' || q.status === 'shortlisted');
    if (tab === 'won') return items.filter((q) => q.status === 'accepted');
    return items;
  }, [items, tab]);

  const goBack = () => (router.canGoBack() ? router.back() : router.push('/supplier-dashboard' as any));

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title}>My Bids</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={s.tabs}>
        {([['active', 'Active', counts.active], ['won', 'Awarded', counts.won], ['all', 'All', counts.all]] as const).map(([key, label, n]) => {
          const active = key === tab;
          return (
            <TouchableOpacity key={key} onPress={() => setTab(key)} activeOpacity={0.8} style={[s.tab, active && { backgroundColor: T.colors.primary, borderColor: T.colors.primary }]}>
              <Text style={[s.tabTxt, active && { color: '#FFF' }]}>{label} ({n})</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
      ) : list.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="document-text-outline" size={28} color={T.colors.textMuted} />
          <Text style={s.emptyTxt}>{tab === 'won' ? 'No awards yet.' : tab === 'active' ? 'No active bids.' : 'No bids yet.'} Browse opportunities and submit a quote.</Text>
          <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/suppliers/opportunities' as any)}><Text style={s.emptyBtnTxt}>Browse opportunities</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
          {list.map((q) => {
            const st = STATUS[q.status] ?? STATUS.submitted;
            const cents = q.quote?.amount_cents != null ? q.quote.amount_cents : (q.quote?.amount != null ? toCents(q.quote.amount) : null);
            return (
              <TouchableOpacity key={q.id} style={s.card} activeOpacity={0.85} onPress={() => router.push(`/rfqs/${q.rfq_id}` as any)}>
                <View style={[s.iconTile, { backgroundColor: st.bg }]}><Ionicons name={st.icon} size={20} color={st.color} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle} numberOfLines={1}>{q.rfq_title || 'RFQ'}</Text>
                  <Text style={s.cardSub}>{cents != null ? formatUsd(cents) : 'Quote on file'} · {new Date(q.created_at).toLocaleDateString()}{q.status === 'accepted' && q.spawned_job_id ? ' · dispatched' : ''}</Text>
                </View>
                <View style={[s.chip, { backgroundColor: st.bg }]}><Text style={[s.chipTxt, { color: st.color }]}>{st.label}</Text></View>
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md },
  back: { padding: 4, marginLeft: -4 },
  title: { color: T.colors.text, fontSize: T.fontSize.xl, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: T.spacing.lg, paddingBottom: T.spacing.md },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: T.borderRadius.full, borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.inputBackground },
  tabTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: T.spacing.lg, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  iconTile: { width: 44, height: 44, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '600' },
  cardSub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 4 },
  chip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: T.borderRadius.full },
  chipTxt: { fontSize: 10, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { borderWidth: 1, borderColor: T.colors.primary, borderRadius: T.borderRadius.full, paddingHorizontal: 18, paddingVertical: 9 },
  emptyBtnTxt: { color: T.colors.primary, fontSize: T.fontSize.sm, fontWeight: '700' },
});
