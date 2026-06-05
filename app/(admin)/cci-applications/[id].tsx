// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/cci-applications/[id].tsx
//
//  STEP 3 — Admin CCI Application Review (detail + decide)
//
//  Sections:
//    1. Applicant header (name, email, tier, applied_at)
//    2. Government ID — country + signed-URL preview
//    3. Experience — years + evidence thumbnails (signed URLs)
//    4. Strict-liability signature integrity panel
//         • Re-canonicalizes stored payload, recomputes sha256, compares
//           against stored signature_sha256
//         • Re-hashes the bound agreement text, compares against the
//           agreement_text_sha256 in the payload
//         • Shows green/red per check; admin cannot approve unless all
//           checks pass
//    5. Decision controls — Approve (sets expires_at), Reject, with
//       decision_notes
//
//  RLS: this screen only renders for admin/super_admin per
//  credentials_update_self_pending_or_admin and is_admin().
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  CheckCircle2,
  ChevronLeft,
  Eye,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react-native';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { verifyStoredSignature, type StrictLiabilitySignaturePayload, type SignatureVerificationResult } from '@/src/features/compliance/lib/signature';

const C = {
  bg: '#020420', card: '#0A0E2A', cardLift: '#0F1538', border: '#1A1F4A',
  primary: '#7C3AED', primarySoft: '#A78BFA', primaryDim: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF', textSec: '#CBD5F5', textDim: '#64748B',
  ok: '#10B981', warn: '#F59E0B', danger: '#EF4444',
};

type Tier = 'cci_basic' | 'cci_advanced' | 'cci_lead';
type Status = 'pending' | 'approved' | 'suspended' | 'rejected' | 'expired';

interface FullRow {
  id: string;
  inspector_id: string;
  tier: Tier;
  status: Status;
  gov_id_storage_path: string | null;
  gov_id_issuing_country: string | null;
  gov_id_verified: boolean;
  experience_years_documented: number | null;
  experience_evidence_paths: string[] | null;
  strict_liability_agreement_version: string | null;
  strict_liability_signed_at: string | null;
  strict_liability_signature_sha256: string | null;
  strict_liability_signature_payload: StrictLiabilitySignaturePayload | null;
  applied_at: string;
  decided_at: string | null;
  decision_notes: string | null;
  decided_by_admin_id: string | null;
  expires_at: string | null;
  inspector: {
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  } | null;
}

// Default validity window: 24 months from approval.
const DEFAULT_EXPIRY_MONTHS = 24;

export default function CciApplicationReview() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, role } = useAuth();
  const isAdmin = role === 'admin' || role === 'super_admin';

  const [row, setRow] = useState<FullRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [govUrl, setGovUrl] = useState<string | null>(null);
  const [expUrls, setExpUrls] = useState<string[]>([]);
  const [verification, setVerification] = useState<SignatureVerificationResult | null>(null);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [working, setWorking] = useState(false);

  // ─── Load row + sign URLs ───────────────────────────────
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('inspector_credentials')
        .select(`
          *,
          inspector:profiles!inspector_credentials_inspector_id_fkey (full_name, first_name, last_name, email)
        `)
        .eq('id', id)
        .single();
      if (error) throw error;
      const r = data as any;
      const insp = Array.isArray(r.inspector) ? r.inspector[0] : r.inspector;
      const norm: FullRow = { ...r, inspector: insp };
      setRow(norm);
      setDecisionNotes(norm.decision_notes ?? '');

      // Sign URLs for previewable evidence
      const signed: string[] = [];
      if (norm.gov_id_storage_path) {
        const { data: u } = await supabase.storage.from('compliance').createSignedUrl(norm.gov_id_storage_path, 600);
        setGovUrl(u?.signedUrl ?? null);
      }
      if (norm.experience_evidence_paths?.length) {
        for (const p of norm.experience_evidence_paths) {
          const { data: u } = await supabase.storage.from('compliance').createSignedUrl(p, 600);
          if (u?.signedUrl) signed.push(u.signedUrl);
        }
      }
      setExpUrls(signed);

      // Verify signature integrity
      const v = await verifyStoredSignature({
        storedPayload: norm.strict_liability_signature_payload,
        storedSignatureSha256: norm.strict_liability_signature_sha256,
        storedAgreementVersion: norm.strict_liability_agreement_version,
        rowInspectorId: norm.inspector_id,
      });
      setVerification(v);
    } catch (e: any) {
      console.error('[cci review] load failed:', e);
      Alert.alert('Error', e?.message ?? 'Failed to load application.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // ─── Decisions ──────────────────────────────────────────
  const decide = async (newStatus: 'approved' | 'rejected') => {
    if (!row || !user?.id) return;
    if (newStatus === 'approved' && !verification?.ok) {
      Alert.alert(
        'Signature integrity check failed',
        'Cannot approve an application whose strict-liability signature does not verify. Reject and ask the inspector to re-apply.'
      );
      return;
    }

    const now = new Date();
    const expires = new Date(now);
    expires.setMonth(expires.getMonth() + DEFAULT_EXPIRY_MONTHS);

    setWorking(true);
    try {
      const { error } = await supabase
        .from('inspector_credentials')
        .update({
          status: newStatus,
          decided_at: now.toISOString(),
          decided_by_admin_id: user.id,
          decision_notes: decisionNotes.trim() || null,
          expires_at: newStatus === 'approved' ? expires.toISOString() : null,
          gov_id_verified: newStatus === 'approved' ? true : row.gov_id_verified,
        })
        .eq('id', row.id);
      if (error) throw error;

      Alert.alert(
        newStatus === 'approved' ? 'Approved' : 'Rejected',
        newStatus === 'approved'
          ? `${tierLabel(row.tier)} credential granted, valid until ${expires.toLocaleDateString()}.`
          : 'Application rejected. The inspector can re-apply after resolving the issue.'
      );
      router.back();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Decision could not be recorded.');
    } finally {
      setWorking(false);
    }
  };

  // ─── Render guards ──────────────────────────────────────
  if (!isAdmin) {
    return <SafeAreaView style={s.bg} edges={['top']}><View style={s.center}><ShieldAlert size={48} color={C.danger} /><Text style={s.deniedTitle}>Admin only</Text></View></SafeAreaView>;
  }
  if (loading || !row) {
    return <SafeAreaView style={s.bg} edges={['top']}><View style={s.center}><ActivityIndicator color={C.primary} size="large" /></View></SafeAreaView>;
  }

  const isDecided = row.status !== 'pending';
  const displayName =
    row.inspector?.full_name?.trim() ||
    [row.inspector?.first_name, row.inspector?.last_name].filter(Boolean).join(' ').trim() ||
    'Inspector';

  // ─── Render ─────────────────────────────────────────────
  return (
    <SafeAreaView style={s.bg} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{displayName}</Text>
          <Text style={s.headerSub}>{tierLabel(row.tier)}, {row.inspector?.email}</Text>
        </View>
        <View style={[s.statusPill, statusTone(row.status)]}>
          <Text style={[s.statusPillText, { color: statusTone(row.status).borderColor }]}>{row.status.toUpperCase()}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>

          {/* SECTION: Gov ID */}
          <Card title="Government-Issued ID">
            <Kv k="Country" v={row.gov_id_issuing_country ?? '—'} />
            <Kv k="Verified" v={row.gov_id_verified ? 'Yes' : 'Not yet'} valColor={row.gov_id_verified ? C.ok : C.warn} />
            {govUrl && <Image source={{ uri: govUrl }} style={s.idImage} />}
            {govUrl && (
              <Pressable onPress={() => Linking.openURL(govUrl)} style={s.openBtn}>
                <Eye size={14} color={C.primarySoft} />
                <Text style={s.openBtnText}>Open full image</Text>
              </Pressable>
            )}
          </Card>

          {/* SECTION: Experience */}
          <Card title="Documented Experience">
            <Kv k="Years" v={String(row.experience_years_documented ?? '—')} />
            {expUrls.length > 0 && (
              <View style={s.expGrid}>
                {expUrls.map((u, i) => (
                  <Pressable key={i} onPress={() => Linking.openURL(u)}>
                    <Image source={{ uri: u }} style={s.expThumb} />
                  </Pressable>
                ))}
              </View>
            )}
          </Card>

          {/* SECTION: Signature integrity */}
          <Card title="Strict-Liability Signature Integrity" accent>
            <Kv k="Agreement version" v={row.strict_liability_agreement_version ?? '—'} />
            <Kv k="Signed at" v={row.strict_liability_signed_at ? new Date(row.strict_liability_signed_at).toLocaleString() : '—'} />
            <Kv k="Legal name" v={row.strict_liability_signature_payload?.signer_legal_name ?? '—'} />
            <Kv k="Signature sha256" v={(row.strict_liability_signature_sha256 ?? '—').slice(0, 22) + '…'} mono />

            <View style={{ marginTop: 12, gap: 8 }}>
              <Check label="Payload hash intact"            ok={!!verification?.checks.payload_hash_intact} />
              <Check label="Agreement text hash intact"      ok={!!verification?.checks.agreement_text_intact} />
              <Check label="Signer ID matches credential row" ok={!!verification?.checks.signer_matches_row} />
              <Check label="Payload schema recognised"        ok={!!verification?.checks.payload_schema_known} />
            </View>

            {row.strict_liability_signature_payload?.consents?.length ? (
              <View style={{ marginTop: 12 }}>
                <Text style={s.consentHead}>Consents acknowledged</Text>
                {row.strict_liability_signature_payload.consents.map((c, i) => (
                  <View key={i} style={s.consentRow}>
                    <CheckCircle2 size={12} color={C.ok} style={{ marginTop: 3 }} />
                    <Text style={s.consentLabel}>{c.label}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={s.integrityFootnote}>
              {verification?.ok
                ? '✓ All checks passed. This signature is cryptographically intact.'
                : '✗ One or more integrity checks failed. Do not approve.'}
            </Text>
          </Card>

          {/* SECTION: Decision */}
          {!isDecided && (
            <Card title="Decision">
              <Text style={s.fieldLabel}>Decision notes (optional)</Text>
              <TextInput
                style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
                multiline
                value={decisionNotes}
                onChangeText={setDecisionNotes}
                placeholder="Internal note explaining the decision. Visible to the inspector if rejection."
                placeholderTextColor={C.textDim}
              />
              <View style={s.decideRow}>
                <Pressable
                  style={[s.decideBtn, { backgroundColor: '#7F1D1D' }]}
                  onPress={() => decide('rejected')}
                  disabled={working}
                >
                  {working ? <ActivityIndicator color="#FFF" /> : <><XCircle size={16} color="#FFF" /><Text style={s.decideText}>Reject</Text></>}
                </Pressable>
                <Pressable
                  style={[s.decideBtn, { backgroundColor: verification?.ok ? C.ok : C.textDim }]}
                  onPress={() => decide('approved')}
                  disabled={working || !verification?.ok}
                >
                  {working ? <ActivityIndicator color="#FFF" /> : <><ShieldCheck size={16} color="#FFF" /><Text style={s.decideText}>Approve</Text></>}
                </Pressable>
              </View>
              {!verification?.ok && (
                <Text style={s.integrityFootnote}>Approval is disabled until signature integrity checks pass.</Text>
              )}
            </Card>
          )}

          {isDecided && (
            <Card title="Decision Recorded">
              <Kv k="Status" v={row.status} />
              <Kv k="Decided at" v={row.decided_at ? new Date(row.decided_at).toLocaleString() : '—'} />
              <Kv k="Expires"    v={row.expires_at ? new Date(row.expires_at).toLocaleDateString() : '—'} />
              {row.decision_notes && <Kv k="Notes" v={row.decision_notes} />}
            </Card>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────
const Card: React.FC<{ title: string; accent?: boolean; children: React.ReactNode }> = ({ title, accent, children }) => (
  <View style={[s.card, accent && { borderColor: 'rgba(251,191,36,0.40)' }]}>
    <Text style={s.cardTitle}>{title}</Text>
    {children}
  </View>
);

const Kv: React.FC<{ k: string; v: string; valColor?: string; mono?: boolean }> = ({ k, v, valColor, mono }) => (
  <View style={s.kvRow}>
    <Text style={s.kvKey}>{k}</Text>
    <Text style={[s.kvVal, !!valColor && { color: valColor }, mono && { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any, fontSize: 12 }]}>{v}</Text>
  </View>
);

const Check: React.FC<{ label: string; ok: boolean }> = ({ label, ok }) => (
  <View style={s.checkRow}>
    {ok ? <Check2 /> : <X size={14} color={C.danger} />}
    <Text style={[s.checkLabel, { color: ok ? C.ok : C.danger }]}>{label}</Text>
  </View>
);
const Check2 = () => <CheckCircle2 size={14} color={C.ok} />;

const tierLabel = (t: Tier) => ({ cci_basic: 'CCI Basic', cci_advanced: 'CCI Advanced', cci_lead: 'CCI Lead' }[t]);
const statusTone = (st: Status) => {
  const c =
    st === 'pending'   ? C.warn :
    st === 'approved'  ? C.ok :
    st === 'suspended' ? C.warn :
                          C.danger;
  return { borderColor: c, backgroundColor: c + '14' };
};

const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8 },
  deniedTitle: { color: C.text, fontSize: 18, fontWeight: '800' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  headerSub: { color: C.textDim, fontSize: 11, marginTop: 1 },
  statusPill: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },

  card: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 14, padding: 14, marginBottom: 14,
  },
  cardTitle: {
    color: C.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase',
    marginBottom: 10,
  },

  kvRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 4 },
  kvKey: { color: C.textDim, fontSize: 11, width: 130, textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 1 },
  kvVal: { color: C.text, fontSize: 13, flex: 1 },

  idImage: { width: '100%', height: 200, marginTop: 10, borderRadius: 10, backgroundColor: C.cardLift },
  openBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    alignSelf: 'flex-start',
    backgroundColor: C.primaryDim, borderRadius: 8,
  },
  openBtnText: { color: C.primarySoft, fontSize: 11, fontWeight: '700' },

  expGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  expThumb: { width: 84, height: 84, borderRadius: 8, backgroundColor: C.cardLift },

  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkLabel: { fontSize: 13, fontWeight: '700' },

  consentHead: { color: C.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 6 },
  consentRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', paddingVertical: 3 },
  consentLabel: { color: C.textSec, fontSize: 11, flex: 1, lineHeight: 16 },

  integrityFootnote: { color: C.textDim, fontSize: 11, marginTop: 12, fontStyle: 'italic' },

  fieldLabel: { color: C.textSec, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14,
  },

  decideRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  decideBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12,
  },
  decideText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
});
