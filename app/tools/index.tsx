// app/tools/index.tsx
//
// The Tool Foundry — list surface. 100% data-driven from `engineering_tools`
// via useEngineeringTools(): categories, search, and cards all come from rows.
// Adding a tool in SQL makes it appear here with no code change.
//
// Built entirely on NEXPEC_THEME — no new design system, no layout edits to
// existing screens. Reached from Profile → Tools → Engineering Tools.

import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { useEngineeringTools } from '../../src/hooks/useEngineeringTools';

const CAT_LABEL: Record<string, string> = {
  all: 'All', ndt: 'NDT', welding: 'Welding', mechanical: 'Mechanical', civil: 'Civil',
  electrical: 'Electrical', chemical: 'Chemical', industrial: 'Industrial', general: 'General', document: 'Document',
};
const CAT_COLOR: Record<string, string> = {
  ndt: '#7C3AED', welding: '#F59E0B', mechanical: '#3B82F6', civil: '#10B981',
  electrical: '#06B6D4', chemical: '#EF4444', industrial: '#8B5CF6', general: '#64748B', document: '#0EA5E9',
};

export default function ToolsListScreen() {
  const router = useRouter();
  const { tools, categories, loading, error } = useEngineeringTools();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');

  const chips = useMemo(() => ['all', ...categories], [categories]);
  const list = useMemo(
    () => tools.filter((tl) =>
      (cat === 'all' || tl.category === cat) &&
      (q.trim() === '' || `${tl.title} ${tl.subtitle ?? ''}`.toLowerCase().includes(q.toLowerCase()))),
    [tools, cat, q],
  );

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />

      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={s.back} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={T.colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Engineering Tools</Text>
          <Text style={s.sub}>Field-grade calculators · sealed results</Text>
        </View>
        <View style={s.brandTile}><Ionicons name="construct" size={20} color={T.colors.primary} /></View>
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={18} color={T.colors.textMuted} />
        <TextInput
          value={q} onChangeText={setQ} placeholder="Search tools…"
          placeholderTextColor={T.colors.textMuted} style={s.search} returnKeyType="search"
        />
      </View>

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {chips.map((c) => {
            const active = c === cat;
            return (
              <TouchableOpacity key={c} onPress={() => setCat(c)} activeOpacity={0.8}
                style={[s.chip, active && { backgroundColor: T.colors.primary, borderColor: T.colors.primary }]}>
                <Text style={[s.chipText, active && { color: '#FFFFFF' }]}>{CAT_LABEL[c] ?? c}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
      ) : error ? (
        <View style={s.center}><Text style={s.err}>{error}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={s.listContent} showsVerticalScrollIndicator={false}>
          {list.map((tool) => {
            const accent = CAT_COLOR[tool.category] ?? T.colors.primary;
            return (
              <TouchableOpacity key={tool.key} activeOpacity={0.85} style={s.card}
                onPress={() => router.push((`/tools/${tool.key}`) as any)}>
                <View style={[s.iconTile, { backgroundColor: `${accent}22` }]}>
                  <Ionicons name={(tool.icon_token as any) ?? 'calculator-outline'} size={22} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.cardTitleRow}>
                    <Text style={s.cardTitle} numberOfLines={1}>{tool.title}</Text>
                    {tool.access_tier === 'pro' && <Ionicons name="lock-closed" size={13} color={T.colors.textMuted} />}
                  </View>
                  {!!tool.subtitle && <Text style={s.cardSub} numberOfLines={2}>{tool.subtitle}</Text>}
                  <Text style={[s.cardCat, { color: accent }]}>{CAT_LABEL[tool.category] ?? tool.category}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={T.colors.textMuted} />
              </TouchableOpacity>
            );
          })}
          {list.length === 0 && <Text style={s.empty}>No tools match your search.</Text>}
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
  brandTile: { width: 40, height: 40, borderRadius: T.borderRadius.lg, backgroundColor: 'rgba(124,58,237,0.14)', alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: T.spacing.lg, paddingHorizontal: T.spacing.md, height: 44, backgroundColor: T.colors.inputBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  search: { flex: 1, color: T.colors.text, fontSize: T.fontSize.sm, paddingVertical: 0 },
  chips: { gap: 8, paddingHorizontal: T.spacing.lg, paddingVertical: T.spacing.md },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: T.borderRadius.full, borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.inputBackground },
  chipText: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '600' },
  listContent: { paddingHorizontal: T.spacing.lg, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  iconTile: { width: 44, height: 44, borderRadius: T.borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '600', flexShrink: 1 },
  cardSub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 2, lineHeight: 16 },
  cardCat: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  err: { color: T.colors.error, fontSize: T.fontSize.sm, padding: T.spacing.lg, textAlign: 'center' },
  empty: { color: T.colors.textMuted, fontSize: T.fontSize.sm, textAlign: 'center', paddingVertical: 32 },
});
