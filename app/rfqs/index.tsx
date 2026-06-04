// app/rfqs/index.tsx — RFQ & Procurement hub (role-shaped by RLS)
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, StatusBar, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { useRfqs } from '../../src/hooks/useSupplierEcosystem';

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  open:     { label: 'Open',     color: '#8B5CF6', bg: 'rgba(124,58,237,0.16)' },
  quoted:   { label: 'Quoted',   color: '#38BDF8', bg: 'rgba(56,189,248,0.16)' },
  awarded:  { label: 'Awarded',  color: '#10B981', bg: 'rgba(16,185,129,0.16)' },
  closed:   { label: 'Closed',   color: '#94A3B8', bg: 'rgba(148,163,184,0.16)' },
  cancelled:{ label: 'Cancelled',color: '#EF4444', bg: 'rgba(239,68,68,0.16)' },
};

export default function RfqHubScreen() {
  const router = useRouter();
  const { items, loading, refetch } = useRfqs();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));
  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const sorted = useMemo(() => items, [items]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>RFQs & Procurement</Text>
          <Text style={s.sub}>Source anything — inspection auto-dispatches on award</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/rfqs/new' as any)} style={s.cta} activeOpacity={0.85}>
          <Ionicons name="add" size={16} color="#fff" /><Text style={s.ctaText}>New</Text>
        </TouchableOpacity>
      </View>

      {loading ? <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View> : (
        <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.colors.primary} />}>
          {sorted.map((r) => {
            const st = STATUS[r.status] ?? STATUS.open;
            return (
              <TouchableOpacity key={r.id} style={s.card} activeOpacity={0.85} onPress={() => router.push(`/rfqs/${r.id}` as any)}>
                <View style={s.cardTop}>
                  <Text style={s.cardTitle} numberOfLines={1}>{r.title}</Text>
                  <View style={[s.badge, { backgroundColor: st.bg }]}><Text style={[s.badgeTxt, { color: st.color }]}>{st.label}</Text></View>
                </View>
                <View style={s.metaRow}>
                  {r.requires_source_inspection
                    ? <View style={s.tag}><Ionicons name="shield-checkmark-outline" size={11} color={T.colors.primaryLight} /><Text style={s.tagTxt}>Source / FAT inspection</Text></View>
                    : <View style={s.tag}><Ionicons name="cube-outline" size={11} color={T.colors.textMuted} /><Text style={s.tagTxt}>Procurement only</Text></View>}
                  {!!r.spawned_job_id && <View style={[s.tag, { borderColor: T.colors.success }]}><Ionicons name="rocket-outline" size={11} color={T.colors.success} /><Text style={[s.tagTxt, { color: T.colors.success }]}>Inspection dispatched</Text></View>}
                </View>
                <Text style={s.date}>{new Date(r.created_at).toLocaleDateString()}</Text>
              </TouchableOpacity>
            );
          })}
          {sorted.length === 0 && (
            <View style={s.emptyWrap}>
              <Ionicons name="document-text-outline" size={32} color={T.colors.textMuted} />
              <Text style={s.empty}>No RFQs yet.</Text>
              <TouchableOpacity style={s.newBtn} onPress={() => router.push('/rfqs/new' as any)} activeOpacity={0.85}>
                <Ionicons name="add" size={16} color="#fff" /><Text style={s.newTxt}>Post your first RFQ</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md },
  back: { padding: 4, marginLeft: -4 },
  title: { color: T.colors.text, fontSize: T.fontSize.xl, fontWeight: '700' },
  sub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: T.colors.primary, paddingHorizontal: 12, paddingVertical: 8, borderRadius: T.borderRadius.full },
  ctaText: { color: '#fff', fontSize: T.fontSize.xs, fontWeight: '700' },
  listContent: { paddingHorizontal: T.spacing.lg, gap: 10, paddingTop: T.spacing.sm },
  card: { padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '600', flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: T.borderRadius.full },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: T.borderRadius.full, paddingHorizontal: 8, paddingVertical: 3 },
  tagTxt: { color: T.colors.textSecondary, fontSize: 10, fontWeight: '600' },
  date: { color: T.colors.textMuted, fontSize: T.fontSize.xs, marginTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  empty: { color: T.colors.textMuted, fontSize: T.fontSize.sm },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingHorizontal: 16, paddingVertical: 10 },
  newTxt: { color: '#fff', fontSize: T.fontSize.sm, fontWeight: '700' },
});
