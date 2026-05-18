// ════════════════════════════════════════════════════════════════════════════
//  app/cert/[slug].tsx
//
//  STEP 7 — Public Trust Certificate page.
//
//  The portable, supplier-facing artifact: each supplier who passes a
//  compliance inspection gets a trust_certificates row with a vanity
//  public_slug. They can present that URL to other buyers, link it
//  from their corporate site, etc. — anyone who hits the URL sees:
//
//    1. Who the certificate covers (supplier display name + scope).
//    2. The validity window.
//    3. A direct "Re-verify Now" CTA that hands off to /verify/<token>
//       where the underlying affidavit's signature is re-checked.
//
//  Uses fetch_cert_by_slug (anon-callable). Live-time expiry check is
//  enforced by the RPC itself — slugs whose certs are revoked or
//  expired return zero rows.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';

const C = {
  bg:        '#F8FAFC',
  panel:     '#FFFFFF',
  panelMute: '#F1F5F9',
  border:    '#E2E8F0',
  ink:       '#0F172A',
  inkMute:   '#475569',
  inkDim:    '#64748B',
  accent:    '#4338CA',
  accentSoft:'#EEF2FF',
  ok:        '#047857',
  okSoft:    '#ECFDF5',
  warn:      '#B45309',
  warnSoft:  '#FFFBEB',
};

interface CertRow {
  cert_id: string;
  scope_name: string;
  scope_slug: string;
  scope_category: string;
  scope_region: string;
  supplier_display_name: string;
  valid_from: string;
  valid_until: string;
  revoked_at: string | null;
  is_public_directory_listed: boolean;
  affidavit_verify_token: string;
}

export default function CertPage() {
  const router = useRouter();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [row, setRow] = useState<CertRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!slug) { setLoading(false); return; }
    try {
      const { data, error } = await supabase
        .rpc('fetch_cert_by_slug', { p_slug: slug })
        .maybeSingle();
      if (error) throw error;
      setRow(data as CertRow | null);
    } catch (e) {
      console.error('[cert] failed:', e);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const daysRemaining = useMemo(() => {
    if (!row) return 0;
    return Math.max(0, Math.ceil((new Date(row.valid_until).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }, [row]);

  if (loading) {
    return <SafeAreaView style={s.bg}><View style={s.center}><ActivityIndicator size="large" color={C.accent} /></View></SafeAreaView>;
  }

  if (!row) {
    return (
      <SafeAreaView style={s.bg}>
        <ScrollView contentContainerStyle={s.scroll}>
          {router.canGoBack() && (
            <Pressable onPress={() => router.back()} style={s.backChip}>
              <ChevronLeft size={14} color={C.inkMute} />
              <Text style={s.backChipText}>Back</Text>
            </Pressable>
          )}
          <View style={s.brandRow}>
            <View style={s.brandMark} />
            <Text style={s.brandName}>NEXPEC</Text>
            <Text style={s.brandSub}>Independent Compliance Authority</Text>
          </View>
          <View style={[s.hero, { backgroundColor: C.warnSoft, borderColor: C.warn + '55' }]}>
            <View style={[s.heroIcon, { backgroundColor: C.warn }]}>
              <AlertTriangle size={28} color="#FFF" />
            </View>
            <Text style={[s.heroTitle, { color: C.warn }]}>Certificate Not Found</Text>
            <Text style={s.heroSub}>
              No trust certificate matches this slug, or the certificate has been
              revoked or expired. Check that you have the correct URL.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.bg}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={s.scroll}>
        {router.canGoBack() && (
          <Pressable onPress={() => router.back()} style={s.backChip}>
            <ChevronLeft size={14} color={C.inkMute} />
            <Text style={s.backChipText}>Back</Text>
          </Pressable>
        )}

        {/* Brand */}
        <View style={s.brandRow}>
          <View style={s.brandMark} />
          <Text style={s.brandName}>NEXPEC</Text>
          <Text style={s.brandSub}>Independent Compliance Authority</Text>
        </View>

        {/* Certificate hero */}
        <View style={[s.hero, { backgroundColor: C.okSoft, borderColor: C.ok + '55' }]}>
          <View style={[s.heroIcon, { backgroundColor: C.ok }]}>
            <ShieldCheck size={28} color="#FFF" />
          </View>
          <Text style={s.heroEyebrow}>VERIFIED TRUST CERTIFICATE</Text>
          <Text style={s.heroSupplier}>{row.supplier_display_name}</Text>
          <Text style={s.heroScope}>{row.scope_name}</Text>
          <View style={s.heroBadgeRow}>
            <Badge label={row.scope_region.toUpperCase()} />
            <Badge label={row.scope_category.replace(/_/g, ' ')} />
            <Badge label={`${daysRemaining} days remaining`} accent />
          </View>
        </View>

        {/* Validity */}
        <View style={s.card}>
          <Text style={s.cardLabel}>Validity</Text>
          <View style={s.kvRow}><Text style={s.kvKey}>Issued from</Text><Text style={s.kvVal}>{fmtDate(row.valid_from)}</Text></View>
          <View style={s.kvRow}><Text style={s.kvKey}>Valid until</Text><Text style={s.kvVal}>{fmtDate(row.valid_until)}</Text></View>
          <View style={s.kvRow}>
            <Text style={s.kvKey}>Status</Text>
            <Text style={[s.kvVal, { color: C.ok }]}>Active</Text>
          </View>
        </View>

        {/* Hand off to verify page for full crypto proof */}
        <Pressable
          onPress={() => router.push(`/verify/${row.affidavit_verify_token}` as any)}
          style={s.verifyCta}
        >
          <View style={{ flex: 1 }}>
            <Text style={s.verifyCtaTitle}>Re-verify the underlying affidavit</Text>
            <Text style={s.verifyCtaSub}>
              See the full evidence summary, chain integrity, and the Ed25519 signature check.
            </Text>
          </View>
          <ChevronRight size={18} color={C.accent} />
        </Pressable>

        <View style={s.footer}>
          <Text style={s.footerText}>
            Trust certificates on NEXPEC are anchored to a cryptographically-signed
            compliance affidavit. The supplier above has been independently verified by
            a NEXPEC Compliance-Certified Inspector. Visit the underlying affidavit
            page above for full audit detail.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const Badge: React.FC<{ label: string; accent?: boolean }> = ({ label, accent }) => (
  <View style={[s.badge, accent && { backgroundColor: C.accentSoft, borderColor: C.accent + '55' }]}>
    <Text style={[s.badgeText, accent && { color: C.accent }]}>{label}</Text>
  </View>
);

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  scroll: { paddingHorizontal: 20, paddingVertical: 24, maxWidth: 720, alignSelf: 'center', width: '100%' },

  backChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: C.panel, borderColor: C.border, borderWidth: 1, borderRadius: 8,
    marginBottom: 10,
  },
  backChipText: { color: C.inkMute, fontSize: 12, fontWeight: '600' },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 18 },
  brandMark: { width: 16, height: 16, borderRadius: 4, backgroundColor: C.accent },
  brandName: { color: C.ink, fontSize: 14, fontWeight: '800', letterSpacing: 2 },
  brandSub: { color: C.inkMute, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 'auto' },

  hero: {
    borderWidth: 1, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16,
  },
  heroIcon: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center', marginBottom: 14,
  },
  heroEyebrow: {
    color: C.ok, fontSize: 10, fontWeight: '800', letterSpacing: 2,
    textTransform: 'uppercase', marginBottom: 6,
  },
  heroSupplier: { color: C.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center' },
  heroScope: { color: C.inkMute, fontSize: 14, marginTop: 6, marginBottom: 14, textAlign: 'center' },
  heroSub: { color: C.inkMute, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 420 },
  heroTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginBottom: 4 },

  heroBadgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  badge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: C.panelMute, borderColor: C.border, borderWidth: 1,
  },
  badgeText: { color: C.inkMute, fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

  card: { backgroundColor: C.panel, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardLabel: { color: C.inkMute, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 },
  kvRow: { flexDirection: 'row', paddingVertical: 6, gap: 12, borderBottomWidth: 1, borderBottomColor: C.panelMute },
  kvKey: { flex: 1, color: C.inkMute, fontSize: 12, paddingTop: 1 },
  kvVal: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '600', textAlign: 'right' },

  verifyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.accentSoft, borderColor: C.accent + '55', borderWidth: 1,
    borderRadius: 12, padding: 14, marginBottom: 18,
  },
  verifyCtaTitle: { color: C.accent, fontSize: 14, fontWeight: '800' },
  verifyCtaSub: { color: C.inkMute, fontSize: 12, marginTop: 2, lineHeight: 17 },

  footer: { paddingHorizontal: 8, paddingVertical: 18 },
  footerText: { color: C.inkDim, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
