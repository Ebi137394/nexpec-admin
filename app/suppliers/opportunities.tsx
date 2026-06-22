// app/suppliers/opportunities.tsx — Supplier: browse open RFQs (mobile parity with web).
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { useOpenOpportunities } from '../../src/hooks/useSupplierEcosystem';
import { useLanguage } from '@/src/i18n/LanguageProvider';

type Filter = 'all' | 'matched' | 'inspection' | 'procurement';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'matched', label: 'Matched' },
  { key: 'inspection', label: 'Source / FAT' }, { key: 'procurement', label: 'Procurement' },
];

export default function SupplierOpportunities() {
  const { t, isRTL, language } = useLanguage();
  const router = useRouter();
  const { items, loading } = useOpenOpportunities();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const list = useMemo(() => items.filter((o) => {
    if (filter === 'matched' && !o.matched) return false;
    if (filter === 'inspection' && !o.requires_source_inspection) return false;
    if (filter === 'procurement' && o.requires_source_inspection) return false;
    if (q.trim() && !o.title.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [items, filter, q]);

  const goBack = () => (router.canGoBack() ? router.back() : router.push('/supplier-dashboard' as any));

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title}>{t('Opportunities')}</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={18} color={T.colors.textMuted} />
        <TextInput value={q} onChangeText={setQ} placeholder={t('Search opportunities…')} placeholderTextColor={T.colors.textMuted} style={s.search} returnKeyType="search" />
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {FILTERS.map((f) => {
            const active = f.key === filter;
            return (
              <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)} activeOpacity={0.8} style={[s.chip, active && { backgroundColor: T.colors.primary, borderColor: T.colors.primary }]}>
                <Text style={[s.chipTxt, active && { color: '#FFF' }]}>{t(f.label)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
      ) : list.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="megaphone-outline" size={28} color={T.colors.textMuted} />
          <Text style={s.emptyTxt}>{t('No matching opportunities. Make sure your capabilities are listed so we can match you to new RFQs.')}</Text>
          <TouchableOpacity style={s.emptyBtn} onPress={() => router.push('/suppliers/onboard' as any)}><Text style={s.emptyBtnTxt}>{t('Update capabilities')}</Text></TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
          {list.map((o) => (
            <TouchableOpacity key={o.id} style={s.card} activeOpacity={0.85} onPress={() => router.push(`/rfqs/${o.id}` as any)}>
              <View style={[s.iconTile, { backgroundColor: 'rgba(124,58,237,0.14)' }]}>
                <Ionicons name={o.requires_source_inspection ? 'shield-checkmark-outline' : 'cube-outline'} size={20} color={T.colors.primaryLight} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.titleRow}>
                  <Text style={s.cardTitle} numberOfLines={1}>{o.title}</Text>
                  {o.matched && <View style={s.matchPill}><Text style={s.matchTxt}>{t('MATCH')}</Text></View>}
                  {o.alreadyQuoted && <View style={s.bidPill}><Text style={s.bidTxt}>{t('YOU BID')}</Text></View>}
                </View>
                <Text style={s.cardSub}>{o.requires_source_inspection ? t('Source / FAT inspection') : t('Procurement only')}, {new Date(o.created_at).toLocaleDateString()}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={T.colors.textMuted} />
            </TouchableOpacity>
          ))}
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
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: T.spacing.lg, paddingHorizontal: T.spacing.md, height: 44, backgroundColor: T.colors.inputBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  search: { flex: 1, color: T.colors.text, fontSize: T.fontSize.sm, paddingVertical: 0 },
  chips: { gap: 8, paddingHorizontal: T.spacing.lg, paddingVertical: T.spacing.md },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: T.borderRadius.full, borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.inputBackground },
  chipTxt: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: T.spacing.lg, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  iconTile: { width: 44, height: 44, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '600', flexShrink: 1 },
  matchPill: { backgroundColor: 'rgba(124,58,237,0.16)', borderRadius: T.borderRadius.full, paddingHorizontal: 7, paddingVertical: 2 },
  matchTxt: { color: '#8B5CF6', fontSize: 9, fontWeight: '800' },
  bidPill: { borderWidth: 1, borderColor: '#38BDF8', borderRadius: T.borderRadius.full, paddingHorizontal: 7, paddingVertical: 2 },
  bidTxt: { color: '#38BDF8', fontSize: 9, fontWeight: '700' },
  cardSub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyTxt: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { borderWidth: 1, borderColor: T.colors.primary, borderRadius: T.borderRadius.full, paddingHorizontal: 18, paddingVertical: 9 },
  emptyBtnTxt: { color: T.colors.primary, fontSize: T.fontSize.sm, fontWeight: '700' },
});
