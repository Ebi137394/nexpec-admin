// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/inspection-domains.tsx
//  Mobile parity for web `/admin/domains` (+ readiness) — the Inspection-Domain
//  console.
//
//  Source of truth mirrored exactly (web is NOT a CRUD editor):
//    • Table public.inspection_domains — PK is `slug` (the inspection_domain
//      ENUM). All attributes are migration-seeded + read-only; the ONLY writes
//      are two boolean toggles:
//        – is_launched : publicly visible in the marketplace ("publish")
//        – is_active   : kill-switch (off = hidden everywhere)
//      Web writes them via direct `.update({...}).eq('slug', slug)` (no RPC),
//      admin God-mode-gated (UI gate mirrors RLS inspection_domains_admin_write =
//      nx_is_admin() = role IN ('admin','super_admin')). Each toggle is idempotent.
//    • Readiness is a LIVE-COMPUTED, advisory verdict (gates nothing): blocked
//      if inactive / no scope templates / no specialty groups; live if launched;
//      else ready. (The web's thin-pool "caution" needs the inspector match
//      query — surfaced here as the eligible-pool note; the launch decision is
//      the human's via the toggle, exactly as on web.)
//
//  Palette + components locked to the app (#020420 / #7C3AED). Additive screen.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, StatusBar, SafeAreaView, Switch, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138', cardDeep: '#080C2A',
  border: 'rgba(255,255,255,0.06)', borderHi: 'rgba(255,255,255,0.12)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', green: '#10B981', greenDim: 'rgba(16,185,129,0.14)',
  amber: '#F59E0B', amberDim: 'rgba(245,158,11,0.14)', red: '#EF4444', redDim: 'rgba(239,68,68,0.14)',
};

// icon_key (seeded) → Ionicons name. Mirrors the web Lucide mapping intent.
const ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  shield: 'shield-checkmark-outline',
  building: 'business-outline',
  zap: 'flash-outline',
  wrench: 'construct-outline',
  flask: 'flask-outline',
};

type Verdict = 'live' | 'ready' | 'blocked';

interface DomainRow {
  slug: string;
  displayName: string;
  personaLabel: string;
  shortPitch: string;
  iconKey: string;
  regulatoryBodies: string[];
  defaultGroups: string[];
  isLaunched: boolean;
  isActive: boolean;
  displayOrder: number;
  scopeTemplateCount: number;
  jobCount: number;
}

function computeVerdict(d: DomainRow): { kind: Verdict; reason: string } {
  if (d.isLaunched) return { kind: 'live', reason: 'Launched · publicly visible' };
  if (!d.isActive) return { kind: 'blocked', reason: 'Kill-switch off (inactive)' };
  if (d.scopeTemplateCount === 0) return { kind: 'blocked', reason: 'No active scope templates' };
  if (d.defaultGroups.length === 0) return { kind: 'blocked', reason: 'No specialty groups carved' };
  return { kind: 'ready', reason: 'Content complete — ready to launch' };
}

const VERDICT_STYLE: Record<Verdict, { label: string; color: string; bg: string }> = {
  live: { label: 'LIVE', color: C.green, bg: C.greenDim },
  ready: { label: 'READY', color: C.cyan, bg: 'rgba(0,255,255,0.12)' },
  blocked: { label: 'BLOCKED', color: C.amber, bg: C.amberDim },
};

export default function InspectionDomainsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [domains, setDomains] = useState<DomainRow[]>([]);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }

      const profRes = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const role = (profRes.data as { role?: string } | null)?.role;
      // God-mode: the single platform admin has full access. UI gate mirrors the
      // nx_is_admin() RLS helper exactly (role IN ('admin','super_admin')) so the
      // owner is never locked out of an action the database would permit.
      const isAdmin = role === 'admin' || role === 'super_admin';
      setIsAdmin(isAdmin);

      const [domRes, tplRes, jobRes] = await Promise.all([
        supabase
          .from('inspection_domains')
          .select('slug, display_name, persona_label, short_pitch, icon_key, regulatory_bodies, default_specialty_groups, is_launched, is_active, display_order')
          .order('display_order', { ascending: true }),
        supabase.from('inspection_scope_templates').select('domain').eq('is_active', true),
        supabase.from('jobs').select('domain').is('deleted_at', null),
      ]);
      if (domRes.error) { setError(domRes.error.message); return; }

      const tplByDomain = new Map<string, number>();
      ((tplRes.data ?? []) as Array<{ domain: string }>).forEach((r) =>
        tplByDomain.set(r.domain, (tplByDomain.get(r.domain) ?? 0) + 1));
      const jobByDomain = new Map<string, number>();
      ((jobRes.data ?? []) as Array<{ domain: string }>).forEach((r) =>
        jobByDomain.set(r.domain, (jobByDomain.get(r.domain) ?? 0) + 1));

      setDomains(((domRes.data ?? []) as Array<Record<string, unknown>>).map((r) => {
        const slug = String(r.slug);
        return {
          slug,
          displayName: String(r.display_name ?? slug),
          personaLabel: String(r.persona_label ?? ''),
          shortPitch: String(r.short_pitch ?? ''),
          iconKey: String(r.icon_key ?? 'shield'),
          regulatoryBodies: Array.isArray(r.regulatory_bodies) ? (r.regulatory_bodies as string[]) : [],
          defaultGroups: Array.isArray(r.default_specialty_groups) ? (r.default_specialty_groups as string[]) : [],
          isLaunched: r.is_launched === true,
          isActive: r.is_active !== false,
          displayOrder: typeof r.display_order === 'number' ? r.display_order : Number(r.display_order ?? 0),
          scopeTemplateCount: tplByDomain.get(slug) ?? 0,
          jobCount: jobByDomain.get(slug) ?? 0,
        };
      }));
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Could not load domains.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const setFlag = useCallback(async (slug: string, field: 'is_launched' | 'is_active', value: boolean) => {
    // Optimistic: flip locally, then persist. Idempotent (absolute boolean).
    setDomains((prev) => prev.map((d) => (d.slug === slug
      ? { ...d, ...(field === 'is_launched' ? { isLaunched: value } : { isActive: value }) }
      : d)));
    setSavingSlug(slug);
    try {
      const { error: updErr } = await supabase
        .from('inspection_domains') // outbox-exempt: online admin domain toggle (idempotent)
        .update(field === 'is_launched' ? { is_launched: value } : { is_active: value })
        .eq('slug', slug);
      if (updErr) {
        // Revert optimistic change on failure.
        setDomains((prev) => prev.map((d) => (d.slug === slug
          ? { ...d, ...(field === 'is_launched' ? { isLaunched: !value } : { isActive: !value }) }
          : d)));
        Alert.alert(
          'Could not update',
          /row-level security|permission|42501/i.test(updErr.message)
            ? 'Only a platform admin can manage inspection domains.'
            : updErr.message,
        );
      }
    } catch (e: unknown) {
      setDomains((prev) => prev.map((d) => (d.slug === slug
        ? { ...d, ...(field === 'is_launched' ? { isLaunched: !value } : { isActive: !value }) }
        : d)));
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally {
      setSavingSlug(null);
    }
  }, []);

  const liveCount = useMemo(() => domains.filter((d) => d.isLaunched && d.isActive).length, [domains]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Inspection domains</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        <Animated.View entering={FadeIn.duration(200)}>
          <LinearGradient colors={[C.primaryDim, 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={s.hero}>
            <Text style={s.heroKicker}>PLATFORM · INSPECTION DOMAINS</Text>
            <Text style={s.heroSub}>{liveCount} live · {domains.length} configured. Launch a domain when its content + pool are ready.</Text>
          </LinearGradient>
        </Animated.View>

        {error && (
          <View style={s.bannerErr}>
            <Ionicons name="alert-circle-outline" size={16} color={C.red} />
            <Text style={s.bannerErrText}>{error}</Text>
          </View>
        )}

        {!isAdmin ? (
          <View style={s.section}>
            <View style={s.reservedCard}>
              <Ionicons name="lock-closed-outline" size={20} color={C.amber} />
              <Text style={s.reservedTitle}>Reserved access</Text>
              <Text style={s.reservedBody}>Managing inspection domains is reserved for the platform owner (admin).</Text>
            </View>
          </View>
        ) : (
          <View style={s.section}>
            {domains.map((d) => {
              const v = computeVerdict(d);
              const vs = VERDICT_STYLE[v.kind];
              const saving = savingSlug === d.slug;
              return (
                <View key={d.slug} style={[s.domainCard, !d.isActive && { opacity: 0.7 }]}>
                  <View style={s.domainTop}>
                    <View style={s.domainIcon}>
                      <Ionicons name={ICON[d.iconKey] ?? 'shield-checkmark-outline'} size={20} color={C.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.domainName}>{d.displayName}</Text>
                      <Text style={s.domainPersona} numberOfLines={1}>{d.personaLabel}</Text>
                    </View>
                    <View style={[s.verdictPill, { backgroundColor: vs.bg }]}>
                      <Text style={[s.verdictText, { color: vs.color }]}>{vs.label}</Text>
                    </View>
                  </View>

                  <Text style={s.domainPitch} numberOfLines={2}>{d.shortPitch}</Text>

                  <View style={s.statRow}>
                    <Stat label="Scope templates" value={String(d.scopeTemplateCount)} warn={d.scopeTemplateCount === 0} />
                    <Stat label="Specialty groups" value={String(d.defaultGroups.length)} warn={d.defaultGroups.length === 0} />
                    <Stat label="Jobs" value={String(d.jobCount)} />
                  </View>
                  {!!v.reason && <Text style={s.verdictReason}>{v.reason}</Text>}

                  {d.regulatoryBodies.length > 0 && (
                    <View style={s.chipsRow}>
                      {d.regulatoryBodies.slice(0, 6).map((b) => (
                        <View key={b} style={s.chip}><Text style={s.chipText}>{b}</Text></View>
                      ))}
                    </View>
                  )}

                  <View style={s.toggleBlock}>
                    <View style={s.toggleRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.toggleLabel}>Launched</Text>
                        <Text style={s.toggleHint}>Publicly visible in the marketplace.</Text>
                      </View>
                      <Switch
                        value={d.isLaunched}
                        onValueChange={(val) => setFlag(d.slug, 'is_launched', val)}
                        disabled={saving || !d.isActive}
                        trackColor={{ false: C.border, true: C.primary }}
                        thumbColor="#FFFFFF"
                      />
                    </View>
                    <View style={s.toggleDivider} />
                    <View style={s.toggleRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.toggleLabel}>Active</Text>
                        <Text style={s.toggleHint}>Kill-switch. Off = hidden from every surface.</Text>
                      </View>
                      <Switch
                        value={d.isActive}
                        onValueChange={(val) => setFlag(d.slug, 'is_active', val)}
                        disabled={saving}
                        trackColor={{ false: C.border, true: C.primary }}
                        thumbColor="#FFFFFF"
                      />
                    </View>
                  </View>
                </View>
              );
            })}
            <Text style={s.footnote}>
              Domain content (name, pitch, specialty groups, regulatory bodies) is seeded by migration and read-only here — the launch decision is the only control, exactly as on web.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, warn && { color: C.amber }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: C.text },
  scroll: { paddingBottom: 48 },
  hero: { marginHorizontal: 16, marginTop: 4, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: C.border },
  heroKicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: C.primary },
  heroSub: { fontSize: 13, color: C.textSec, marginTop: 6 },
  bannerErr: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: C.redDim, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  bannerErrText: { color: C.red, fontSize: 13, flex: 1 },
  section: { marginHorizontal: 16, marginTop: 16, gap: 12 },
  reservedCard: { backgroundColor: C.card, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: C.border, alignItems: 'center', gap: 8 },
  reservedTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  domainCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: C.border },
  domainTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  domainIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.primaryDim, alignItems: 'center', justifyContent: 'center' },
  domainName: { color: C.text, fontSize: 16, fontWeight: '700' },
  domainPersona: { color: C.textMute, fontSize: 12, marginTop: 2 },
  verdictPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  verdictText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  domainPitch: { color: C.textSec, fontSize: 13, lineHeight: 19, marginTop: 12 },
  statRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  stat: { flex: 1, backgroundColor: C.cardDeep, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  statValue: { color: C.text, fontSize: 18, fontWeight: '800' },
  statLabel: { color: C.textMute, fontSize: 10, marginTop: 2 },
  verdictReason: { color: C.textMute, fontSize: 12, marginTop: 10 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: C.cardDeep, borderWidth: 1, borderColor: C.border },
  chipText: { color: C.textSec, fontSize: 11 },
  toggleBlock: { marginTop: 14, backgroundColor: C.cardDeep, borderRadius: 12, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  toggleDivider: { height: 1, backgroundColor: C.border },
  toggleLabel: { color: C.text, fontSize: 14, fontWeight: '600' },
  toggleHint: { color: C.textMute, fontSize: 12, marginTop: 2 },
  footnote: { color: C.textMute, fontSize: 12, lineHeight: 18, marginTop: 6 },
});
