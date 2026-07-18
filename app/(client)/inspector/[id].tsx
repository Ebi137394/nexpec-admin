// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/inspector/[id].tsx — Mobile NEXPEC Trust Card (anonymized)
//
//  Mobile parity with the web public trust card (apps/web/src/app/p/[userId]).
//
//  ANTI-POACHING BY CONSTRUCTION. This screen renders ZERO identity. It reads
//  ONLY the PII-free `inspectors_directory` projection (no name, photo, bio,
//  headline, city, email, or phone ever enters the query), so there is nothing
//  on screen, in the network response, or in memory to disintermediate with.
//  The inspector appears as a stable pseudonymous handle (NX-XXXXXX) + a
//  deterministic Trust Sigil generated from the opaque id.
//
//  ONE DOOR. The only way to engage is the admin-brokered, held flow
//  (Golden Rules). Identity is revealed inside an engagement, never before.
// ════════════════════════════════════════════════════════════════════════════
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { nxHandle, nxHash } from '../../../src/core/utils/handle';

// PII-free columns — mirrors the web fetchInspectorTrustCard projection over the
// `inspectors_directory` view. NEVER add name / avatar / bio / city / contact.
const CARD_COLS =
  'id, location_province, specialty_slugs, ndt_methods, certifications, ' +
  'verification_status, rating_average, rating_count, recommend_percent, ' +
  'completed_jobs_count, total_jobs, created_at';

const C = {
  bg: '#020420',
  card: 'rgba(255,255,255,0.03)',
  card2: 'rgba(255,255,255,0.02)',
  border: 'rgba(255,255,255,0.08)',
  text: '#F8FAFC',
  dim: '#94A3B8',
  mute: '#64748B',
  violet: '#7C3AED',
  violetGlow: '#A855F7',
  cyan: '#22D3EE',
  amber: '#F59E0B',
  green: '#22C55E',
};

interface TrustCard {
  id: string;
  location_province: string | null;
  specialty_slugs: string[] | null;
  ndt_methods: string[] | null;
  certifications: string[] | null;
  verification_status: string | null;
  rating_average: number | null;
  rating_count: number | null;
  recommend_percent: number | null;
  completed_jobs_count: number | null;
  total_jobs: number | null;
  created_at: string | null;
}

const prettySlug = (s: string) =>
  s.split('-').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const dedupe = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = it.toLowerCase();
    if (it && !seen.has(k)) { seen.add(k); out.push(it); }
  }
  return out;
};

const yearOf = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : String(d.getFullYear());
};

// Deterministic Trust Sigil gradient from the opaque id (no PII, stable).
const sigilColors = (id: string): [string, string] => {
  const h = nxHash('nexpec-sigil:' + id);
  return [`hsl(${h % 360},68%,46%)`, `hsl(${(h + 48) % 360},64%,30%)`];
};

export default function InspectorTrustCardScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [card, setCard] = useState<TrustCard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!id) { setLoading(false); return; }
      try {
        // PII-free read only — never `.from('profiles')` on a buyer surface.
        const { data } = await supabase
          .from('inspectors_directory')
          .select(CARD_COLS)
          .eq('id', id)
          .maybeSingle();
        if (alive) setCard((data as unknown as TrustCard) ?? null);
      } catch {
        if (alive) setCard(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const handle = nxHandle(id);
  const [g1, g2] = useMemo(() => sigilColors(id ?? ''), [id]);

  const competencies = useMemo(() => {
    if (!card) return [];
    return dedupe([
      ...(card.specialty_slugs ?? []).map(prettySlug),
      ...(card.ndt_methods ?? []).map((m) => m.toUpperCase()),
      ...(card.certifications ?? []).map((c) => c.trim()).filter(Boolean),
    ]);
  }, [card]);

  const ratingCount = card?.rating_count ?? 0;
  const ratingAvg = card?.rating_average ?? 0;
  const completed = card?.completed_jobs_count ?? 0;
  const total = card?.total_jobs ?? 0;
  const completion = total > 0 ? Math.round((completed / total) * 100) : null;
  const isVerified = (card?.verification_status ?? '') === 'verified';
  const region = card?.location_province?.trim() || null;

  const goBack = () =>
    router.canGoBack() ? router.back() : router.push('/(client)/explore' as any);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back} accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Inspector</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={C.violet} /></View>
      ) : !card ? (
        <View style={s.center}>
          <Ionicons name="shield-outline" size={42} color={C.mute} />
          <Text style={s.unavailTitle}>Inspector unavailable</Text>
          <Text style={s.unavailBody}>
            This NEXPEC inspector profile isn’t publicly available. Verified, active
            inspectors appear here as anonymized trust cards.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
          {/* Header card: sigil + pseudonymous handle + verification */}
          <View style={s.block}>
            <View style={s.headRow}>
              <LinearGradient colors={[g1, g2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.sigil}>
                <Text style={s.sigilGlyph}>{handle.slice(3, 5)}</Text>
              </LinearGradient>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.title}>NEXPEC-Verified Inspector</Text>
                <Text style={s.handle}>{handle}</Text>
                <Text style={s.sub}>Inspector{region ? `, Region: ${region}` : ''}</Text>
                {isVerified && (
                  <View style={s.badge}>
                    <Ionicons name="shield-checkmark" size={12} color={C.cyan} />
                    <Text style={s.badgeTxt}>Identity-verified</Text>
                  </View>
                )}
              </View>
            </View>
            <View style={s.lockNote}>
              <Ionicons name="lock-closed" size={14} color={C.cyan} style={{ marginTop: 1 }} />
              <Text style={s.lockTxt}>
                Identity is protected by NEXPEC. You’re seeing platform-verified capability
                and performance — no résumé, no bias. Engagement happens securely through
                NEXPEC with payment hold and dispute protection.
              </Text>
            </View>
          </View>

          {/* Performance metrics */}
          <View style={s.metrics}>
            <Metric label="Rating" value={ratingCount > 0 ? ratingAvg.toFixed(2) : '—'} sub={ratingCount > 0 ? `${ratingCount} review${ratingCount === 1 ? '' : 's'}` : 'No reviews'} tone={C.amber} />
            <Metric label="Recommend" value={ratingCount > 0 ? `${card.recommend_percent ?? 0}%` : '—'} sub="of clients" tone={C.green} />
            <Metric label="Completion" value={completion != null ? `${completion}%` : '—'} sub="jobs closed" tone={C.cyan} />
            <Metric label="Jobs done" value={String(completed)} sub="via NEXPEC" tone={C.violetGlow} />
            <Metric label="On NEXPEC" value={yearOf(card.created_at)} sub="since" tone={C.cyan} />
          </View>

          {/* Verified competencies (platform-vouched, not a CV) */}
          <View style={s.block}>
            <View style={s.secHead}>
              <Ionicons name="ribbon-outline" size={18} color={C.cyan} />
              <Text style={s.secTitle}>NEXPEC-Verified Competencies</Text>
            </View>
            <Text style={s.secSub}>Each capability is verified by NEXPEC, not a self-reported CV.</Text>
            {competencies.length === 0 ? (
              <Text style={s.muted}>Competencies are being verified.</Text>
            ) : (
              <View style={s.chips}>
                {competencies.map((c) => (
                  <View key={c} style={s.chip}>
                    <Ionicons name="shield-checkmark" size={12} color={C.cyan} />
                    <Text style={s.chipTxt}>{c}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Engage through NEXPEC — the only door */}
          <LinearGradient colors={['rgba(124,58,237,0.16)', 'rgba(34,211,238,0.06)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[s.block, s.engage]}>
            <Text style={s.engageTitle}>Request this inspector through NEXPEC</Text>
            <Text style={s.engageBody}>
              Post your scope and NEXPEC assigns {handle} (or a peer of equal verification)
              with payment hold, signed deliverables, and dispute protection built in.
            </Text>
            <TouchableOpacity style={s.cta} activeOpacity={0.85} onPress={() => router.push('/post-new-job' as any)}>
              <Text style={s.ctaTxt}>Start a request</Text>
              <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </TouchableOpacity>
          </LinearGradient>

          {/* Client reviews — aggregate only; reviewer identity is never fetched here */}
          <View style={s.block}>
            <View style={s.secHead}>
              <Ionicons name="star-outline" size={18} color={C.amber} />
              <Text style={s.secTitle}>Client reviews</Text>
            </View>
            <Text style={s.secSub}>
              {ratingCount === 0
                ? 'No reviews yet. Verified clients can review after a job completes.'
                : `${ratingAvg.toFixed(2)} average across ${ratingCount} review${ratingCount === 1 ? '' : 's'}.`}
            </Text>
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <View style={s.metric}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={[s.metricValue, { color: tone }]}>{value}</Text>
      <Text style={s.metricSub}>{sub}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  back: { padding: 4, marginLeft: -4 },
  headerTitle: { flex: 1, textAlign: 'center', color: C.text, fontSize: 17, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  unavailTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 6 },
  unavailBody: { color: C.dim, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  scroll: { padding: 16, gap: 14 },
  block: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 18, padding: 16 },
  headRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  sigil: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sigilGlyph: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  title: { color: C.text, fontSize: 17, fontWeight: '700' },
  handle: { color: C.violetGlow, fontSize: 14, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  sub: { color: C.mute, fontSize: 11, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: 8, backgroundColor: 'rgba(34,211,238,0.10)', borderColor: 'rgba(34,211,238,0.30)', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { color: C.cyan, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  lockNote: { flexDirection: 'row', gap: 8, marginTop: 14, backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12 },
  lockTxt: { flex: 1, color: C.dim, fontSize: 12, lineHeight: 18 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { flexGrow: 1, flexBasis: '30%', backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 14, padding: 12 },
  metricLabel: { color: C.mute, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  metricValue: { fontSize: 20, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  metricSub: { color: C.mute, fontSize: 10, marginTop: 1 },
  secHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  secTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  secSub: { color: C.mute, fontSize: 12, marginTop: 4, lineHeight: 17 },
  muted: { color: C.mute, fontSize: 13, marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(124,58,237,0.08)', borderColor: 'rgba(124,58,237,0.25)', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipTxt: { color: '#E2E8F0', fontSize: 12, fontWeight: '500' },
  engage: { borderColor: 'rgba(124,58,237,0.25)' },
  engageTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  engageBody: { color: C.dim, fontSize: 13, lineHeight: 19, marginTop: 6 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.violet, borderRadius: 999, paddingVertical: 13, marginTop: 14 },
  ctaTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
