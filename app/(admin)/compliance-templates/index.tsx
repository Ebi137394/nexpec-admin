// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/compliance-templates/index.tsx
//
//  STEP 2 — Admin Scope-Template Library (LIST screen)
//
//  CRUD entry point for the inspection_scope_templates table. Admins use
//  this screen to curate the catalog of compliance scopes available to
//  buyers at job-post time.
//
//  Architecture:
//    • Read-only list — full CRUD on the [id].tsx editor screen.
//    • Filters: category, region, active-only toggle.
//    • Each row shows: name + slug + version, category badge, region
//      badge, requirements count, price, validity months, is_active dot.
//    • Tap row → /admin/compliance-templates/<id>
//    • "+ New" → /admin/compliance-templates/new
//    • Inline toggle: flip is_active without leaving the screen.
//
//  RLS: write policies on inspection_scope_templates require admin/
//  super_admin. Non-admin users hitting this route get an "Access
//  denied" state — the route guard is in _layout.tsx but we belt-and-
//  brace here.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Plus,
  Search,
  ShieldAlert,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// ─────────────────────────────────────────────────────────────
//  Color tokens — matches the rest of the dark-theme admin tools
// ─────────────────────────────────────────────────────────────
const C = {
  bg:        '#020420',
  card:      '#0A0E2A',
  cardLift:  '#0F1538',
  border:    '#1A1F4A',
  borderHi:  '#2B2F6E',
  primary:   '#7C3AED',
  primarySoft: '#A78BFA',
  primaryDim: 'rgba(124,58,237,0.14)',
  text:      '#FFFFFF',
  textSec:   '#CBD5F5',
  textDim:   '#64748B',
  ok:        '#10B981',
  warn:      '#F59E0B',
  danger:    '#EF4444',
  cyan:      '#06B6D4',
};

// ─────────────────────────────────────────────────────────────
//  Types — local mirror of the inspection_scope_templates row
// ─────────────────────────────────────────────────────────────
interface ScopeTemplate {
  id: string;
  slug: string;
  name: string;
  version: number;
  category: string;
  region: string;
  validity_months: number;
  base_price_cents: number;
  requires_credential_tier: 'cci_basic' | 'cci_advanced' | 'cci_lead';
  is_active: boolean;
  created_at: string;
  requirements_count: number;
}

// ─────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────
export default function ComplianceTemplatesIndex() {
  const router = useRouter();
  const { role } = useAuth();
  const isAdmin = role === 'admin' || role === 'super_admin';

  const [templates, setTemplates] = useState<ScopeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      // Two-step fetch: templates + per-template requirement counts.
      const { data: t, error: tErr } = await supabase
        .from('inspection_scope_templates')
        .select('id, slug, name, version, category, region, validity_months, base_price_cents, requires_credential_tier, is_active, created_at')
        .order('is_active', { ascending: false })
        .order('category', { ascending: true })
        .order('name', { ascending: true });

      if (tErr) throw tErr;
      const rows = (t ?? []) as Omit<ScopeTemplate, 'requirements_count'>[];

      // Count requirements per template in one round-trip.
      const ids = rows.map((r) => r.id);
      let counts: Record<string, number> = {};
      if (ids.length) {
        const { data: r, error: rErr } = await supabase
          .from('inspection_evidence_requirements')
          .select('template_id')
          .in('template_id', ids);
        if (rErr) throw rErr;
        counts = (r ?? []).reduce<Record<string, number>>((acc, row: any) => {
          acc[row.template_id] = (acc[row.template_id] ?? 0) + 1;
          return acc;
        }, {});
      }

      setTemplates(
        rows.map((row) => ({ ...row, requirements_count: counts[row.id] ?? 0 }))
      );
    } catch (e: any) {
      console.error('[compliance-templates/index] fetch failed:', e);
      Alert.alert('Error', e?.message ?? 'Failed to load templates.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchTemplates();
    }, [fetchTemplates])
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (!showInactive && !t.is_active) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.slug.includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    });
  }, [templates, search, showInactive]);

  const onToggleActive = async (tpl: ScopeTemplate) => {
    setTogglingId(tpl.id);
    const next = !tpl.is_active;
    // Optimistic
    setTemplates((prev) =>
      prev.map((t) => (t.id === tpl.id ? { ...t, is_active: next } : t))
    );
    try {
      const { error } = await supabase
        .from('inspection_scope_templates')
        .update({ is_active: next })
        .eq('id', tpl.id);
      if (error) throw error;
    } catch (e: any) {
      // Roll back
      setTemplates((prev) =>
        prev.map((t) => (t.id === tpl.id ? { ...t, is_active: tpl.is_active } : t))
      );
      Alert.alert('Error', e?.message ?? 'Failed to toggle template.');
    } finally {
      setTogglingId(null);
    }
  };

  // ─── Access denied state ───────────────────────────────────
  if (!isAdmin) {
    return (
      <SafeAreaView style={s.bg} edges={['top']}>
        <View style={s.deniedWrap}>
          <ShieldAlert size={48} color={C.danger} />
          <Text style={s.deniedTitle}>Admin only</Text>
          <Text style={s.deniedSub}>The Compliance Template Library is reserved for NEXPEC admins.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Loading state ────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.bg} edges={['top']}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ─── Main render ──────────────────────────────────────────
  return (
    <SafeAreaView style={s.bg} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Compliance Templates</Text>
          <Text style={s.headerSub}>
            {templates.filter((t) => t.is_active).length} active, {templates.length} total
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/(admin)/compliance-templates/new' as any)}
          style={({ pressed }) => [s.newBtn, pressed && { opacity: 0.85 }]}
        >
          <Plus size={16} color="#FFF" strokeWidth={3} />
          <Text style={s.newBtnText}>New</Text>
        </Pressable>
      </View>

      {/* Filter row */}
      <View style={s.filterRow}>
        <View style={s.searchBox}>
          <Search size={14} color={C.textDim} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, slug, or category"
            placeholderTextColor={C.textDim}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Pressable
          onPress={() => setShowInactive((v) => !v)}
          style={[s.chip, showInactive && s.chipOn]}
        >
          <Text style={[s.chipText, showInactive && s.chipTextOn]}>
            {showInactive ? 'Showing inactive' : 'Active only'}
          </Text>
        </Pressable>
      </View>

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchTemplates(); }}
            tintColor={C.primary}
          />
        }
        ListEmptyComponent={
          <View style={s.empty}>
            <ClipboardList size={32} color={C.textDim} />
            <Text style={s.emptyTitle}>No templates found</Text>
            <Text style={s.emptySub}>
              {search ? 'Try clearing the search.' : 'Create your first compliance template to expose it to buyers.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => router.push(`/(admin)/compliance-templates/${item.id}` as any)}
            style={({ pressed }) => [s.row, pressed && { backgroundColor: C.cardLift }]}
          >
            <View style={{ flex: 1 }}>
              <View style={s.rowTopLine}>
                <Text style={s.rowName} numberOfLines={1}>{item.name}</Text>
                <View style={[s.dot, { backgroundColor: item.is_active ? C.ok : C.textDim }]} />
              </View>
              <Text style={s.rowSlug} numberOfLines={1}>
                {item.slug}, v{item.version}
              </Text>
              <View style={s.rowBadges}>
                <Badge label={item.category.replace(/_/g, ' ')} tint={C.cyan} />
                <Badge label={item.region.toUpperCase()} tint={C.primarySoft} />
                <Badge label={tierLabel(item.requires_credential_tier)} tint={C.warn} />
              </View>
              <View style={s.rowMetaLine}>
                <Text style={s.rowMeta}>
                  {item.requirements_count} req, ${(item.base_price_cents / 100).toFixed(0)}, {item.validity_months} mo
                </Text>
              </View>
            </View>
            <View style={s.rowRight}>
              <Switch
                value={item.is_active}
                onValueChange={() => onToggleActive(item)}
                disabled={togglingId === item.id}
                thumbColor={item.is_active ? C.ok : C.textDim}
                trackColor={{ false: '#1F2937', true: 'rgba(16,185,129,0.4)' }}
              />
              <ChevronRight size={18} color={C.textDim} />
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
const tierLabel = (t: 'cci_basic' | 'cci_advanced' | 'cci_lead') => {
  switch (t) {
    case 'cci_basic':    return 'BASIC';
    case 'cci_advanced': return 'ADVANCED';
    case 'cci_lead':     return 'LEAD';
  }
};

const Badge: React.FC<{ label: string; tint: string }> = ({ label, tint }) => (
  <View style={[s.badge, { borderColor: tint + '66', backgroundColor: tint + '14' }]}>
    <Text style={[s.badgeText, { color: tint }]}>{label}</Text>
  </View>
);

// ─────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: C.bg,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  headerSub: { color: C.textDim, fontSize: 12, marginTop: 2 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: C.primary,
  },
  newBtnText: { color: '#FFF', fontSize: 13, fontWeight: '800' },

  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  searchInput: { flex: 1, color: C.text, fontSize: 13, padding: 0, margin: 0 },

  chip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  chipOn: { backgroundColor: C.primaryDim, borderColor: C.primary },
  chipText: { color: C.textDim, fontSize: 11, fontWeight: '700' },
  chipTextOn: { color: C.primarySoft },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: 10,
  },
  rowTopLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  rowName: { color: C.text, fontSize: 15, fontWeight: '800', flex: 1 },
  rowSlug: { color: C.textDim, fontSize: 11, fontFamily: 'monospace' as any, marginBottom: 6 },
  rowBadges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  rowMetaLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowMeta: { color: C.textSec, fontSize: 11 },
  rowRight: { alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },

  badge: {
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },

  empty: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
    gap: 8,
  },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  emptySub: { color: C.textDim, fontSize: 12, textAlign: 'center', maxWidth: 280 },

  deniedWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 8,
  },
  deniedTitle: { color: C.text, fontSize: 18, fontWeight: '800' },
  deniedSub: { color: C.textDim, fontSize: 13, textAlign: 'center', maxWidth: 280 },
});
