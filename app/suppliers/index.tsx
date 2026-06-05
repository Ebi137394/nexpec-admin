// app/suppliers/index.tsx — Supplier Directory (turnkey marketplace)
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { useSupplierDirectory, useCapabilityCatalog } from '../../src/hooks/useSupplierEcosystem';
import { nxHandle } from '../../src/core/utils/handle';

export default function SupplierDirectoryScreen() {
  const router = useRouter();
  const { items, loading, error } = useSupplierDirectory();
  const { items: caps } = useCapabilityCatalog();
  const [q, setQ] = useState('');
  const [cap, setCap] = useState('all');

  const capLabel = useMemo(() => Object.fromEntries(caps.map((c) => [c.key, c.label])), [caps]);
  const chips = useMemo(() => ['all', ...caps.map((c) => c.key)], [caps]);
  // Anti-poaching: no name to search. Match the NX- handle, capabilities, country.
  const list = useMemo(() => items.filter((s) => {
    if (cap !== 'all' && !(s.capabilities ?? []).includes(cap)) return false;
    if (q.trim() === '') return true;
    const hay = `${nxHandle(s.id)} ${(s.capabilities ?? []).map((k) => capLabel[k] ?? k).join(' ')} ${s.country_code ?? ''}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }), [items, cap, q, capLabel]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Find Suppliers</Text>
          <Text style={s.sub}>Source equipment, labs & materials — any discipline</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/rfqs/new' as any)} style={s.cta} activeOpacity={0.85}>
          <Ionicons name="add" size={16} color="#fff" /><Text style={s.ctaText}>RFQ</Text>
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={18} color={T.colors.textMuted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search suppliers…" placeholderTextColor={T.colors.textMuted} style={s.search} />
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {chips.map((c) => {
            const active = c === cap;
            return (
              <TouchableOpacity key={c} onPress={() => setCap(c)} activeOpacity={0.8} style={[s.chip, active && { backgroundColor: T.colors.primary, borderColor: T.colors.primary }]}>
                <Text style={[s.chipText, active && { color: '#fff' }]}>{c === 'all' ? 'All' : (capLabel[c] ?? c)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
       : error ? <View style={s.center}><Text style={s.err}>{error}</Text></View>
       : (
        <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
          {list.map((sup) => (
            <View key={sup.id} style={s.card}>
              <View style={s.avatar}><Ionicons name="storefront" size={20} color={T.colors.primaryLight} /></View>
              <View style={{ flex: 1 }}>
                <View style={s.titleRow}>
                  <Text style={s.cardTitle} numberOfLines={1}>{nxHandle(sup.id)}</Text>
                  {sup.verified && <Ionicons name="shield-checkmark" size={14} color={T.colors.success} />}
                </View>
                <View style={s.capRow}>
                  {(sup.capabilities ?? []).slice(0, 3).map((k) => (
                    <View key={k} style={s.capPill}><Text style={s.capPillTxt}>{capLabel[k] ?? k}</Text></View>
                  ))}
                </View>
                <View style={s.metaRow}>
                  <Ionicons name="star" size={12} color="#F59E0B" />
                  <Text style={s.meta}>{Number(sup.rating_avg ?? 0).toFixed(1)} ({sup.rating_count ?? 0})</Text>
                  {!!sup.country_code && <Text style={s.meta}>· {sup.country_code}</Text>}
                </View>
              </View>
              <TouchableOpacity style={s.quoteBtn} activeOpacity={0.85} onPress={() => router.push('/rfqs/new' as any)}>
                <Text style={s.quoteBtnTxt}>Request</Text>
              </TouchableOpacity>
            </View>
          ))}
          {list.length === 0 && (
            <View style={s.emptyWrap}>
              <Ionicons name="cube-outline" size={32} color={T.colors.textMuted} />
              <Text style={s.empty}>No suppliers yet.</Text>
              <TouchableOpacity style={s.onboardBtn} onPress={() => router.push('/suppliers/onboard' as any)} activeOpacity={0.85}>
                <Ionicons name="storefront-outline" size={16} color={T.colors.primary} />
                <Text style={s.onboardTxt}>Become a supplier</Text>
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: T.spacing.lg, paddingHorizontal: T.spacing.md, height: 44, backgroundColor: T.colors.inputBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  search: { flex: 1, color: T.colors.text, fontSize: T.fontSize.sm, paddingVertical: 0 },
  chips: { gap: 8, paddingHorizontal: T.spacing.lg, paddingVertical: T.spacing.md },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: T.borderRadius.full, borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.inputBackground },
  chipText: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '600' },
  listContent: { paddingHorizontal: T.spacing.lg, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  avatar: { width: 44, height: 44, borderRadius: T.borderRadius.md, backgroundColor: 'rgba(124,58,237,0.18)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: T.colors.primaryLight, fontSize: T.fontSize.lg, fontWeight: '800' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '600', flexShrink: 1 },
  cardSub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 2 },
  capRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  capPill: { backgroundColor: T.colors.background, borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: T.borderRadius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  capPillTxt: { color: T.colors.textSecondary, fontSize: 10, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  meta: { color: T.colors.textMuted, fontSize: T.fontSize.xs },
  quoteBtn: { borderWidth: 1, borderColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingHorizontal: 12, paddingVertical: 8 },
  quoteBtnTxt: { color: T.colors.primary, fontSize: T.fontSize.xs, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: T.colors.error, fontSize: T.fontSize.sm, padding: T.spacing.lg, textAlign: 'center' },
  emptyWrap: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  empty: { color: T.colors.textMuted, fontSize: T.fontSize.sm },
  onboardBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingHorizontal: 16, paddingVertical: 10 },
  onboardTxt: { color: T.colors.primary, fontSize: T.fontSize.sm, fontWeight: '600' },
});
