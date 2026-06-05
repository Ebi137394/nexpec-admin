// ════════════════════════════════════════════════════════════════════════════
//  app/verify/[token].tsx
//
//  STEP 7 — Public Verified Compliance Affidavit page.
//
//  Anyone with a verify token (from the public_verify_url on a printed
//  affidavit or shared link) hits this page and gets:
//
//    1. An at-a-glance verdict — green if signature + chain + validity
//       all pass, amber if expired, red if revoked or signature broken.
//    2. The affidavit summary (subject name, scope, validity, inspector
//       tier, captures + documents counts, chain integrity).
//    3. Cryptographic proof panel showing the signing key id, JSON
//       payload SHA-256, the platform Ed25519 signature, and the
//       verdict of an independent re-verification done by the
//       verify-affidavit Edge Function.
//    4. A download link to the rendered HTML if available.
//
//  Anon-callable end-to-end:
//    • fetch_affidavit_by_verify_token RPC      (anon SELECT granted)
//    • verify-affidavit Edge Function           (anon, CORS open)
//    • compliance/affidavits/<job_id>/...html   (signed URL via storage)
//
//  Light theme (intentional — public trust documents read better in
//  light), single-column, max-width centered. Works in Expo Web and
//  the native shell alike.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { shareWorkingCopyPdf } from '@/src/features/compliance/lib/working-copy-pdf';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Fingerprint,
  Hash,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';

// ─────────────────────────────────────────────────────────────
//  Light palette — intentional break from the dark app shell.
//  Trust documents read better in light, especially when shared.
// ─────────────────────────────────────────────────────────────
const C = {
  bg:        '#F8FAFC',
  panel:     '#FFFFFF',
  panelMute: '#F1F5F9',
  border:    '#E2E8F0',
  borderHi:  '#CBD5E1',
  ink:       '#0F172A',
  inkMute:   '#475569',
  inkDim:    '#64748B',
  accent:    '#4338CA',
  accentSoft:'#EEF2FF',
  ok:        '#047857',
  okSoft:    '#ECFDF5',
  warn:      '#B45309',
  warnSoft:  '#FFFBEB',
  bad:       '#B91C1C',
  badSoft:   '#FEF2F2',
};

interface AffidavitSummaryRow {
  affidavit_id: string;
  status: string;
  valid_from: string;
  valid_until: string;
  issued_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  scope_name: string;
  scope_slug: string;
  scope_category: string;
  scope_region: string;
  scope_version: number;
  subject_name: string;
  inspector_tier: 'cci_basic' | 'cci_advanced' | 'cci_lead';
  buyer_type: 'client' | 'agency';
  total_captures: number;
  total_documents: number;
  external_evidence_count: number;
  chain_intact: boolean;
  html_storage_path: string | null;
  html_sha256: string | null;
  pdf_storage_path: string | null;
  pdf_sha256: string | null;
  json_payload_sha256: string;
  platform_signature: string;
  platform_signing_key_id: string;
  vca_version: string;
}

interface VerifyResult {
  ok: boolean;
  signature_valid: boolean;
  recomputed_sha256_matches: boolean;
  revoked: boolean;
  expired: boolean;
  revoked_reason: string | null;
  key_id: string;
  algorithm: string;
  json_payload_sha256: string;
  recomputed_sha256: string;
  key_unknown?: boolean;
  key_algorithm_mismatch?: boolean;
}

// ─────────────────────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────────────────────
export default function VerifyPage() {
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [row, setRow]         = useState<AffidavitSummaryRow | null>(null);
  const [verdict, setVerdict] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [htmlUrl, setHtmlUrl] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [workingCopyBusy, setWorkingCopyBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    try {
      const [rpcRes, fnRes] = await Promise.all([
        supabase.rpc('fetch_affidavit_by_verify_token', { p_token: token }).maybeSingle(),
        supabase.functions.invoke('verify-affidavit', { body: { token } }),
      ]);

      if (rpcRes.error || !rpcRes.data) {
        setRow(null);
      } else {
        setRow(rpcRes.data as AffidavitSummaryRow);
      }
      if (fnRes.error) {
        console.warn('[verify] edge fn error:', fnRes.error);
        setVerdict(null);
      } else {
        setVerdict(fnRes.data as VerifyResult);
      }

      // Optional: sign a 1-hour URL for the rendered HTML so visitors
      // can download the full affidavit document.
      if (rpcRes.data?.html_storage_path) {
        const { data: signed } = await supabase.storage
          .from('compliance')
          .createSignedUrl(rpcRes.data.html_storage_path, 60 * 60);
        setHtmlUrl(signed?.signedUrl ?? null);
      }

      // Same for the canonical PDF (Tier 1 of the PDF pipeline).
      // The PDF is the un-alterable presentation layer: anyone re-downloading
      // it and recomputing SHA-256 should land on row.pdf_sha256.
      if (rpcRes.data?.pdf_storage_path) {
        const { data: signed } = await supabase.storage
          .from('compliance')
          .createSignedUrl(rpcRes.data.pdf_storage_path, 60 * 60);
        setPdfUrl(signed?.signedUrl ?? null);
      }
    } catch (e) {
      console.error('[verify] failed:', e);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // ─── Tier 2 — Working Copy share ───────────────────────
  // Generates a local PDF from the canonical HTML via expo-print and
  // hands it to the native share sheet. The output is watermarked
  // "WORKING COPY — NOT CRYPTOGRAPHICALLY SIGNED" on every page so it
  // can't be confused with the Tier 1 signed PDF above.
  const handleShareWorkingCopy = useCallback(async () => {
    if (!htmlUrl) {
      Alert.alert(
        'HTML unavailable',
        'The canonical affidavit HTML is still loading. Try again in a moment.',
      );
      return;
    }
    setWorkingCopyBusy(true);
    try {
      const result = await shareWorkingCopyPdf({
        htmlSignedUrl: htmlUrl,
        fileName: `nexpec-working-copy-${token}.pdf`,
      });
      if (!result.ok) {
        Alert.alert(
          'Could not share working copy',
          result.error ?? 'An unknown error occurred.',
        );
      }
    } finally {
      setWorkingCopyBusy(false);
    }
  }, [htmlUrl, token]);

  // ─── Overall verdict + label ───────────────────────────
  const verdictState = useMemo<'verified' | 'revoked' | 'expired' | 'invalid' | 'unknown'>(() => {
    if (!verdict || !row) return 'unknown';
    if (verdict.revoked)            return 'revoked';
    if (!verdict.signature_valid)   return 'invalid';
    if (!verdict.recomputed_sha256_matches) return 'invalid';
    if (verdict.expired)            return 'expired';
    if (verdict.ok)                 return 'verified';
    return 'invalid';
  }, [verdict, row]);

  if (loading) {
    return (
      <SafeAreaView style={s.bg}>
        <View style={s.center}><ActivityIndicator size="large" color={C.accent} /></View>
      </SafeAreaView>
    );
  }

  if (!row) {
    return (
      <SafeAreaView style={s.bg}>
        <NotFound token={String(token ?? '')} onBack={() => router.canGoBack() && router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.bg}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Optional back chip — only renders inside the app */}
        {router.canGoBack() && (
          <Pressable onPress={() => router.back()} style={s.backChip}>
            <ChevronLeft size={14} color={C.inkMute} />
            <Text style={s.backChipText}>Back</Text>
          </Pressable>
        )}

        {/* ─── Brand strip ────────────────────────────────── */}
        <View style={s.brandRow}>
          <View style={s.brandMark} />
          <Text style={s.brandName}>NEXPEC</Text>
          <Text style={s.brandSub}>Independent Compliance Authority</Text>
        </View>

        {/* ─── Verdict hero ───────────────────────────────── */}
        <VerdictHero state={verdictState} />

        {/* ─── Subject card ───────────────────────────────── */}
        <Card>
          <Section label="Subject Entity">
            <Text style={s.subjectName}>{row.subject_name}</Text>
            <Text style={s.scopeLine}>
              {row.scope_name}, v{row.scope_version}, {row.scope_region.toUpperCase()}
            </Text>
          </Section>
        </Card>

        {/* ─── Validity ───────────────────────────────────── */}
        <Card>
          <Section label="Validity">
            <Kv k="Issued"      v={fmtDate(row.issued_at)} />
            <Kv k="Valid from"  v={fmtDate(row.valid_from)} />
            <Kv k="Valid until" v={fmtDate(row.valid_until)} valColor={verdictState === 'expired' ? C.bad : undefined} />
            {row.revoked_at && <Kv k="Revoked" v={fmtDate(row.revoked_at)} valColor={C.bad} />}
            {row.revoked_reason && <Kv k="Reason" v={row.revoked_reason} valColor={C.bad} />}
          </Section>
        </Card>

        {/* ─── Inspection summary ─────────────────────────── */}
        <Card>
          <Section label="Inspection Summary">
            <Kv k="Inspector tier"     v={tierLabel(row.inspector_tier)} />
            <Kv k="Buyer type"         v={row.buyer_type === 'client' ? 'Verified buyer (client)' : 'Verified buyer (agency)'} />
            <Kv k="Total captures"     v={String(row.total_captures)} />
            <Kv
              k="Documents verified"
              v={
                row.external_evidence_count > 0
                  ? `${row.total_documents}  (${row.external_evidence_count} external)`
                  : String(row.total_documents)
              }
            />
            <Kv
              k="Chain of custody"
              v={row.chain_intact ? 'Intact ✓' : 'BROKEN ✗'}
              valColor={row.chain_intact ? C.ok : C.bad}
            />
          </Section>
        </Card>

        {/* ─── Cryptographic proof ────────────────────────── */}
        <Card>
          <Section label="Cryptographic Proof">
            <Kv k="VCA schema version" v={row.vca_version} />
            <Kv k="Signing algorithm"  v={verdict?.algorithm ?? '—'} />
            <Kv k="Signing key id"     v={row.platform_signing_key_id} mono />
            <Kv k="JSON payload sha256" v={shortHash(row.json_payload_sha256)} mono />
            <Kv k="Platform signature" v={shortHash(row.platform_signature)} mono />
            <View style={s.cryptoVerdictWrap}>
              <CryptoCheck
                label="Signature verifies against signing key"
                ok={!!verdict?.signature_valid}
              />
              <CryptoCheck
                label="Payload sha256 matches re-canonicalized form"
                ok={!!verdict?.recomputed_sha256_matches}
              />
              <CryptoCheck
                label="Signing key is active and recognized"
                ok={!!verdict && !verdict.key_unknown && !verdict.key_algorithm_mismatch}
              />
            </View>
          </Section>
        </Card>

        {/* ─── Downloads ──────────────────────────────────── */}
        {pdfUrl && (
          <Pressable onPress={() => Linking.openURL(pdfUrl)} style={s.downloadBtnPrimary}>
            <Download size={14} color="#FFFFFF" />
            <Text style={s.downloadBtnPrimaryText}>Download Signed PDF</Text>
            <ExternalLink size={12} color="#FFFFFF" />
          </Pressable>
        )}
        {htmlUrl && (
          <Pressable onPress={() => Linking.openURL(htmlUrl)} style={s.downloadBtn}>
            <Download size={14} color={C.accent} />
            <Text style={s.downloadBtnText}>View full affidavit document</Text>
            <ExternalLink size={12} color={C.accent} />
          </Pressable>
        )}
        {pdfUrl && row.pdf_sha256 && (
          <Text style={s.pdfHashLine} numberOfLines={1}>
            PDF sha256: {row.pdf_sha256}
          </Text>
        )}

        {/* ─── Tier 2 — Working Copy share (client-side, unsigned) ─── */}
        {htmlUrl && (
          <Pressable
            onPress={handleShareWorkingCopy}
            disabled={workingCopyBusy}
            style={[s.workingCopyBtn, workingCopyBusy && { opacity: 0.6 }]}
          >
            {workingCopyBusy ? (
              <ActivityIndicator size="small" color="#B45309" />
            ) : (
              <>
                <Download size={14} color="#B45309" />
                <Text style={s.workingCopyBtnText}>Save / Share Working Copy</Text>
              </>
            )}
          </Pressable>
        )}
        {htmlUrl && (
          <Text style={s.workingCopyHint}>
            Working copies are watermarked and not cryptographically signed.
            For audit-grade evidence, share the Signed PDF above.
          </Text>
        )}

        {/* ─── Footer ─────────────────────────────────────── */}
        <View style={s.footer}>
          <Text style={s.footerText}>
            Verified by NEXPEC, The integrity of this affidavit can be re-checked at any
            time by visiting this URL. Independent verification: the platform signature
            above can be checked off-platform against the public key published at the
            signing key id shown.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────
const VerdictHero: React.FC<{ state: 'verified' | 'revoked' | 'expired' | 'invalid' | 'unknown' }> = ({ state }) => {
  const cfg = {
    verified: { Icon: ShieldCheck, color: C.ok,  bg: C.okSoft,  title: 'Verified',          sub: 'Signature, chain, and validity all check out.' },
    revoked:  { Icon: ShieldX,    color: C.bad,  bg: C.badSoft, title: 'Revoked',           sub: 'This affidavit has been revoked by NEXPEC.' },
    expired:  { Icon: Clock,      color: C.warn, bg: C.warnSoft,title: 'Expired',           sub: 'The validity window of this affidavit has lapsed.' },
    invalid:  { Icon: ShieldAlert,color: C.bad,  bg: C.badSoft, title: 'Signature Mismatch',sub: 'The signature or payload hash does not verify.' },
    unknown:  { Icon: AlertTriangle, color: C.warn, bg: C.warnSoft, title: 'Verification Unavailable', sub: 'Could not reach the verification service. Try again.' },
  }[state];
  return (
    <View style={[s.verdictHero, { backgroundColor: cfg.bg, borderColor: cfg.color + '55' }]}>
      <View style={[s.verdictHeroIcon, { backgroundColor: cfg.color }]}>
        <cfg.Icon size={28} color="#FFF" />
      </View>
      <Text style={[s.verdictHeroTitle, { color: cfg.color }]}>{cfg.title}</Text>
      <Text style={s.verdictHeroSub}>{cfg.sub}</Text>
    </View>
  );
};

const Card: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={s.card}>{children}</View>
);

const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <>
    <Text style={s.sectionLabel}>{label}</Text>
    {children}
  </>
);

const Kv: React.FC<{ k: string; v: string; valColor?: string; mono?: boolean }> = ({ k, v, valColor, mono }) => (
  <View style={s.kvRow}>
    <Text style={s.kvKey}>{k}</Text>
    <Text style={[s.kvVal, !!valColor && { color: valColor }, mono && s.mono]} numberOfLines={mono ? 1 : undefined}>{v}</Text>
  </View>
);

const CryptoCheck: React.FC<{ label: string; ok: boolean }> = ({ label, ok }) => (
  <View style={s.cryptoCheckRow}>
    {ok
      ? <CheckCircle2 size={14} color={C.ok} />
      : <XCircle size={14} color={C.bad} />}
    <Text style={[s.cryptoCheckText, { color: ok ? C.ok : C.bad }]}>{label}</Text>
  </View>
);

const NotFound: React.FC<{ token: string; onBack: () => void }> = ({ token, onBack }) => (
  <ScrollView contentContainerStyle={s.scroll}>
    <View style={s.brandRow}>
      <View style={s.brandMark} />
      <Text style={s.brandName}>NEXPEC</Text>
      <Text style={s.brandSub}>Independent Compliance Authority</Text>
    </View>
    <View style={[s.verdictHero, { backgroundColor: C.warnSoft, borderColor: C.warn + '55' }]}>
      <View style={[s.verdictHeroIcon, { backgroundColor: C.warn }]}>
        <AlertTriangle size={28} color="#FFF" />
      </View>
      <Text style={[s.verdictHeroTitle, { color: C.warn }]}>Affidavit Not Found</Text>
      <Text style={s.verdictHeroSub}>
        No affidavit matches the verify token <Text style={s.mono}>{token.slice(0, 12)}…</Text>.
        Confirm you have the correct URL, verify tokens are case-sensitive.
      </Text>
    </View>
    <Pressable onPress={onBack} style={s.downloadBtn}>
      <ChevronLeft size={14} color={C.accent} />
      <Text style={s.downloadBtnText}>Back</Text>
    </Pressable>
  </ScrollView>
);

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const shortHash = (h: string) => (h ? `${h.slice(0, 16)}…${h.slice(-8)}` : '—');
const tierLabel = (t: 'cci_basic' | 'cci_advanced' | 'cci_lead') => ({
  cci_basic: 'CCI Basic',
  cci_advanced: 'CCI Advanced',
  cci_lead: 'CCI Lead',
}[t] ?? t);

// ─────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────
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
  brandSub:  { color: C.inkMute, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginLeft: 'auto' },

  verdictHero: {
    borderWidth: 1, borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 16,
  },
  verdictHeroIcon: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  verdictHeroTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginBottom: 4 },
  verdictHeroSub:   { color: C.inkMute, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 420 },

  card: { backgroundColor: C.panel, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 },
  sectionLabel: {
    color: C.inkMute, fontSize: 10, fontWeight: '800', letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 10,
  },

  subjectName: { color: C.ink, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  scopeLine:   { color: C.inkMute, fontSize: 12, marginTop: 4 },

  kvRow: { flexDirection: 'row', paddingVertical: 6, gap: 12, borderBottomWidth: 1, borderBottomColor: C.panelMute },
  kvKey: { flex: 1, color: C.inkMute, fontSize: 12, paddingTop: 1 },
  kvVal: { flex: 1, color: C.ink, fontSize: 13, fontWeight: '600', textAlign: 'right' },

  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any, fontSize: 11 },

  cryptoVerdictWrap: { marginTop: 12, gap: 6 },
  cryptoCheckRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cryptoCheckText: { fontSize: 12, fontWeight: '600' },

  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 10,
    backgroundColor: C.accentSoft, borderColor: C.accent + '55', borderWidth: 1,
    marginTop: 4, marginBottom: 6,
  },
  downloadBtnText: { color: C.accent, fontSize: 13, fontWeight: '700' },
  // ★ PDF download — primary CTA, solid accent fill so it reads as the
  //   canonical regulator-grade artifact (HTML stays below as secondary).
  downloadBtnPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, borderRadius: 10,
    backgroundColor: C.accent,
    marginTop: 4, marginBottom: 6,
  },
  downloadBtnPrimaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
  pdfHashLine: {
    color: C.inkDim, fontSize: 10, marginBottom: 14, textAlign: 'center',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }) as any,
  },

  // ★ Tier 2 — Working Copy share button. Amber tint so it visually
  //   reads as a "convenience / not for legal use" affordance, clearly
  //   distinct from the solid-accent Signed PDF button above.
  workingCopyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 11, borderRadius: 10,
    backgroundColor: 'rgba(251, 191, 36, 0.12)',
    borderColor: 'rgba(180, 83, 9, 0.45)',
    borderWidth: 1,
    marginTop: 6,
  },
  workingCopyBtnText: { color: '#B45309', fontSize: 13, fontWeight: '700' },
  workingCopyHint: {
    color: C.inkDim, fontSize: 11, lineHeight: 16, textAlign: 'center',
    marginTop: 6, marginBottom: 18,
    fontStyle: 'italic',
  },

  footer: { paddingHorizontal: 8, paddingVertical: 18 },
  footerText: { color: C.inkDim, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
