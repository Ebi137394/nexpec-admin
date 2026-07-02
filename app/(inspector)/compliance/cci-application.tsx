// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/compliance/cci-application.tsx
//
//  STEP 3 — CCI Application screen (inspector-facing)
//
//  Three render modes, decided by the current inspector_credentials row:
//
//    1. APPLY     — no row yet OR last row was rejected/expired. Show
//                   the full multi-section application form.
//    2. PENDING   — row exists with status='pending'. Show a read-only
//                   summary + "Under review" banner.
//    3. DECIDED   — row exists with status='approved' / 'suspended'.
//                   Show the approved tier + badge + restrictions.
//
//  Critical trust primitive: the strict-liability signature.
//    • Inspector must scroll the agreement to the bottom.
//    • Each consent checkbox is gated and recorded with timestamp.
//    • Full legal name typed (≥ 4 chars).
//    • Signature payload canonicalized → sha256 → stored alongside
//      the payload jsonb so admin review can re-verify integrity.
//
//  RLS: writes are inspector-self INSERTs with status='pending'. The
//  inspector_credentials policy + the schema's uniqueness index
//  (uq_inspector_active_credential_per_tier) together prevent
//  double-applications for the same tier.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import {
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileBadge,
  IdCard,
  Lock,
  Shield,
  ShieldCheck,
  Upload,
} from 'lucide-react-native';
import Constants from 'expo-constants';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useLanguage } from '@/src/i18n/LanguageProvider';
import {
  AGREEMENT_TEXT,
  CONSENTS,
  VERSION as AGREEMENT_VERSION,
  type ConsentKey,
} from '@/src/features/compliance/agreements/strict_liability_v1';
import {
  getAgreementTextSha256,
  hashSignaturePayload,
  type ConsentAck,
  type StrictLiabilitySignaturePayload,
} from '@/src/features/compliance/lib/signature';

// ─────────────────────────────────────────────────────────────
//  Palette (matches admin compliance-templates screens)
// ─────────────────────────────────────────────────────────────
const C = {
  bg: '#020420', card: '#0A0E2A', cardLift: '#0F1538', border: '#1A1F4A',
  primary: '#7C3AED', primarySoft: '#A78BFA',
  primaryDim: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF', textSec: '#CBD5F5', textDim: '#64748B',
  ok: '#10B981', warn: '#F59E0B', danger: '#EF4444', amber: '#FBBF24',
};

type Tier = 'cci_basic' | 'cci_advanced' | 'cci_lead';
type Status = 'pending' | 'approved' | 'suspended' | 'rejected' | 'expired';

interface CredentialRow {
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
  expires_at: string | null;
}

const TIER_CARDS: { tier: Tier; title: string; sub: string }[] = [
  { tier: 'cci_basic',    title: 'CCI Basic',    sub: 'Supplier existence, license verification, facility photo packs.' },
  { tier: 'cci_advanced', title: 'CCI Advanced', sub: 'Production capacity, multi-site audits, supply-chain mapping.' },
  { tier: 'cci_lead',     title: 'CCI Lead',     sub: 'Regulated industries, sealed reports, expert-witness eligibility.' },
];

const COUNTRIES = ['AE','SA','EG','QA','KW','BH','OM','JO','LB','TR','PK','IN','GB','US','DE','FR','CN','ID','PH','MY'];

// ─────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────
export default function CciApplicationScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, isRTL, language } = useLanguage();
  const insideRef = useRef<ScrollView>(null);

  // ─── Data ───────────────────────────────────────────────
  const [existing, setExisting] = useState<CredentialRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // ─── Form state ─────────────────────────────────────────
  const [tier, setTier] = useState<Tier>('cci_basic');
  const [country, setCountry] = useState<string>('AE');
  const [govIdLocalUri, setGovIdLocalUri] = useState<string | null>(null);
  const [experienceYears, setExperienceYears] = useState<string>('2');
  const [experienceLocalUris, setExperienceLocalUris] = useState<string[]>([]);

  // Signature flow
  const [agreementSha, setAgreementSha] = useState<string | null>(null);
  const [scrolledToBottomAt, setScrolledToBottomAt] = useState<string | null>(null);
  const [consentAcks, setConsentAcks] = useState<Record<ConsentKey, ConsentAck | null>>(
    () => Object.fromEntries(CONSENTS.map((c) => [c.key, null])) as Record<ConsentKey, ConsentAck | null>
  );
  const [legalName, setLegalName] = useState('');

  // ─── Bootstrap: compute agreement hash + fetch existing row ───
  useEffect(() => {
    getAgreementTextSha256(AGREEMENT_VERSION).then(setAgreementSha).catch(() => setAgreementSha(null));
  }, []);

  const fetchExisting = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('inspector_credentials')
        .select('*')
        .eq('inspector_id', user.id)
        .order('applied_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      setExisting(data as CredentialRow | null);
    } catch (e) {
      console.warn('[cci-application] fetch existing failed:', e);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { fetchExisting(); }, [fetchExisting]));

  const mode: 'apply' | 'pending' | 'decided' = useMemo(() => {
    if (!existing) return 'apply';
    if (existing.status === 'pending')                                 return 'pending';
    if (existing.status === 'approved' || existing.status === 'suspended') return 'decided';
    return 'apply';     // rejected / expired → can re-apply
  }, [existing]);

  // ─── Pickers ────────────────────────────────────────────
  const pickGovId = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('Permission needed'), t('Allow photo access to attach your ID.'));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: false,
    });
    if (!res.canceled && res.assets[0]) {
      setGovIdLocalUri(res.assets[0].uri);
    }
  };

  const pickExperience = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: 6,
    });
    if (!res.canceled && res.assets.length) {
      setExperienceLocalUris(res.assets.map((a) => a.uri).slice(0, 6));
    }
  };

  // ─── Scroll-to-bottom guard ─────────────────────────────
  const onAgreementScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (scrolledToBottomAt) return;
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const reachedBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 12;
    if (reachedBottom) {
      setScrolledToBottomAt(new Date().toISOString());
    }
  };

  // ─── Consent tick ───────────────────────────────────────
  const toggleConsent = (c: typeof CONSENTS[number]) => {
    setConsentAcks((prev) => {
      const cur = prev[c.key];
      if (cur) return { ...prev, [c.key]: null };
      return {
        ...prev,
        [c.key]: { key: c.key, label: c.label, accepted_at: new Date().toISOString() },
      };
    });
  };

  // ─── Submit gate ────────────────────────────────────────
  const allConsentsTicked = CONSENTS.every((c) => consentAcks[c.key] != null);
  const canSubmit =
    !!user?.id &&
    !!govIdLocalUri &&
    !!country &&
    parseFloat(experienceYears) >= 2 &&
    experienceLocalUris.length >= 1 &&
    !!scrolledToBottomAt &&
    allConsentsTicked &&
    legalName.trim().length >= 4 &&
    !!agreementSha;

  // ─── Upload helper ──────────────────────────────────────
  const uploadLocalToBucket = async (localUri: string, remotePath: string): Promise<string> => {
    // Read file as base64 → ArrayBuffer. fetch(uri).blob() uploads 0 bytes
    // on native (Expo Blob limitation), so this is the only reliable path.
    const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
    const fileBytes = decode(base64);
    const { error } = await supabase.storage
      .from('compliance')
      .upload(remotePath, fileBytes, { upsert: false, contentType: 'image/jpeg' });
    if (error) throw error;
    return remotePath;
  };

  // ─── Submit ─────────────────────────────────────────────
  const onSubmit = async () => {
    if (!user?.id || !canSubmit || !agreementSha) return;
    setSubmitting(true);
    try {
      // 1) Uploads
      const stamp = Date.now();
      const govIdRemote = `cci-applications/${user.id}/gov_id/${stamp}.jpg`;
      await uploadLocalToBucket(govIdLocalUri!, govIdRemote);

      const expRemotePaths: string[] = [];
      for (let i = 0; i < experienceLocalUris.length; i++) {
        const p = `cci-applications/${user.id}/experience/${stamp}-${i}.jpg`;
        await uploadLocalToBucket(experienceLocalUris[i], p);
        expRemotePaths.push(p);
      }

      // 2) Signature payload
      const consents: ConsentAck[] = CONSENTS
        .map((c) => consentAcks[c.key])
        .filter((c): c is ConsentAck => !!c);

      const payload: StrictLiabilitySignaturePayload = {
        payload_schema_version: '1',
        agreement_version: AGREEMENT_VERSION,
        agreement_text_sha256: agreementSha,
        signer_inspector_id: user.id,
        signer_legal_name: legalName.trim(),
        consents,
        scrolled_to_bottom_at: scrolledToBottomAt!,
        signed_at: new Date().toISOString(),
        device: {
          platform: (Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web')
            ? (Platform.OS as 'ios' | 'android' | 'web')
            : 'unknown',
          app_version: String(Constants.expoConfig?.version ?? 'dev'),
        },
      };
      const sigSha = await hashSignaturePayload(payload);

      // 3) Insert credential row (RLS: status='pending', inspector_id = auth.uid)
      const { error: insErr } = await supabase
        .from('inspector_credentials')
        .insert({
          inspector_id: user.id,
          tier,
          status: 'pending',
          gov_id_storage_path: govIdRemote,
          gov_id_issuing_country: country,
          gov_id_verified: false,
          experience_years_documented: parseFloat(experienceYears),
          experience_evidence_paths: expRemotePaths,
          strict_liability_agreement_version: AGREEMENT_VERSION,
          strict_liability_signed_at: payload.signed_at,
          strict_liability_signature_sha256: sigSha,
          strict_liability_signature_payload: payload,
        });

      if (insErr) throw insErr;

      Alert.alert(t('Submitted'), t('Your application is under review. We will notify you once an admin has decided.'));
      fetchExisting();
    } catch (e: any) {
      console.error('[cci-application] submit failed:', e);
      Alert.alert(t('Error'), e?.message ?? t('Submission failed. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={s.bg} edges={['top']}>
        <View style={s.center}><ActivityIndicator color={C.primary} size="large" /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.bg} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>{t('CCI Credential')}</Text>
          <Text style={s.headerSub}>{t('Compliance-Certified Inspector application')}</Text>
        </View>
        <View style={s.shieldWrap}>
          <Shield size={18} color={C.primarySoft} />
        </View>
      </View>

      {mode === 'pending' && existing && <PendingPanel existing={existing} />}
      {mode === 'decided' && existing && <DecidedPanel existing={existing} />}
      {mode === 'apply' && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} ref={insideRef as any}>
            {/* Intro */}
            <View style={s.introCard}>
              <ShieldCheck size={20} color={C.primarySoft} />
              <Text style={s.introTitle}>{t('Apply to become a Compliance-Certified Inspector')}</Text>
              <Text style={s.introBody}>
                {t('CCIs are the only inspectors allowed to take regulator-grade compliance jobs on NEXPEC. Your credential is reviewed by a NEXPEC admin and, once approved, unlocks compliance inspections at your tier.')}
              </Text>
            </View>

            {/* SECTION 1: Tier */}
            <Section title={t('1, Select Tier')} icon={FileBadge}>
              {TIER_CARDS.map((card) => (
                <Pressable
                  key={card.tier}
                  onPress={() => setTier(card.tier)}
                  style={[s.tierCard, tier === card.tier && s.tierCardOn]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.tierTitle}>{t(card.title)}</Text>
                    <Text style={s.tierSub}>{t(card.sub)}</Text>
                  </View>
                  {tier === card.tier && <CheckCircle2 size={20} color={C.primarySoft} />}
                </Pressable>
              ))}
            </Section>

            {/* SECTION 2: Government ID */}
            <Section title={t('2, Government-Issued ID')} icon={IdCard}>
              <Text style={s.fieldLabel}>{t('Issuing country')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                {COUNTRIES.map((c) => (
                  <Pressable key={c} onPress={() => setCountry(c)} style={[s.countryChip, country === c && s.countryChipOn]}>
                    <Text style={[s.countryChipText, country === c && s.countryChipTextOn]}>{c}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <Text style={[s.fieldLabel, { marginTop: 14 }]}>{t('ID image')}</Text>
              {govIdLocalUri ? (
                <View style={s.thumbWrap}>
                  <Image source={{ uri: govIdLocalUri }} style={s.thumb} />
                  <Pressable onPress={pickGovId} style={s.thumbReplace}>
                    <Text style={s.thumbReplaceText}>{t('Replace')}</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={pickGovId} style={s.uploadBtn}>
                  <Upload size={16} color={C.primarySoft} />
                  <Text style={s.uploadBtnText}>{t('Upload ID (front)')}</Text>
                </Pressable>
              )}
            </Section>

            {/* SECTION 3: Experience */}
            <Section title={t('3, Documented Experience')} icon={Clock}>
              <Text style={s.fieldLabel}>{t('Years of relevant experience (min 2)')}</Text>
              <TextInput
                value={experienceYears}
                onChangeText={setExperienceYears}
                keyboardType="numeric"
                style={s.input}
                placeholder="2.0"
                placeholderTextColor={C.textDim}
              />
              <Text style={[s.fieldLabel, { marginTop: 14 }]}>{t('Evidence (CV, certificates, reference letters, up to 6)')}</Text>
              {experienceLocalUris.length > 0 && (
                <View style={s.expGrid}>
                  {experienceLocalUris.map((u, i) => (
                    <Image key={i} source={{ uri: u }} style={s.expThumb} />
                  ))}
                </View>
              )}
              <Pressable onPress={pickExperience} style={s.uploadBtn}>
                <Upload size={16} color={C.primarySoft} />
                <Text style={s.uploadBtnText}>
                  {experienceLocalUris.length ? `${t('Replace evidence')} (${experienceLocalUris.length} ${t('selected')})` : t('Upload evidence')}
                </Text>
              </Pressable>
            </Section>

            {/* SECTION 4: Strict-Liability Agreement */}
            <Section title={t('4, Strict-Liability Agreement')} icon={Lock} accent>
              <Text style={s.agreementMeta}>
                {t('Version')} {AGREEMENT_VERSION}, sha256 {agreementSha ? agreementSha.slice(0, 10) + '…' : t('computing…')}
              </Text>
              <View style={s.agreementBox}>
                <ScrollView onScroll={onAgreementScroll} scrollEventThrottle={120} nestedScrollEnabled>
                  <Text style={s.agreementText}>{AGREEMENT_TEXT}</Text>
                </ScrollView>
              </View>
              <View style={s.scrollGate}>
                {scrolledToBottomAt
                  ? <Text style={s.scrollGateOk}>{t('✓ You have read the agreement in full')}</Text>
                  : <Text style={s.scrollGateBad}>{t('Scroll to the bottom of the agreement to continue')}</Text>}
              </View>

              {/* Consents */}
              {CONSENTS.map((c) => {
                const on = consentAcks[c.key] != null;
                return (
                  <Pressable
                    key={c.key}
                    onPress={() => scrolledToBottomAt && toggleConsent(c)}
                    style={[s.consentRow, on && s.consentRowOn, !scrolledToBottomAt && { opacity: 0.4 }]}
                    disabled={!scrolledToBottomAt}
                  >
                    <View style={[s.consentBox, on && s.consentBoxOn]}>
                      {on && <CheckCircle2 size={14} color="#FFF" />}
                    </View>
                    <Text style={s.consentLabel}>{c.label}</Text>
                  </Pressable>
                );
              })}

              {/* Legal name */}
              <Text style={[s.fieldLabel, { marginTop: 14 }]}>{t('Full legal name (as it appears on your government ID)')}</Text>
              <TextInput
                value={legalName}
                onChangeText={setLegalName}
                style={s.input}
                placeholder={t('e.g., Aisha Khalid Al-Mansoori')}
                placeholderTextColor={C.textDim}
                editable={allConsentsTicked && !!scrolledToBottomAt}
              />

              {/* Submit */}
              <Pressable
                onPress={onSubmit}
                disabled={!canSubmit || submitting}
                style={[s.submit, (!canSubmit || submitting) && { opacity: 0.5 }]}
              >
                {submitting
                  ? <ActivityIndicator color="#FFF" />
                  : <Text style={s.submitText}>{t('Sign & Submit Application')}</Text>}
              </Pressable>

              {!canSubmit && (
                <Text style={s.submitHint}>
                  {t('Complete every section, scroll the agreement, tick all six consents, and type your full legal name.')}
                </Text>
              )}
            </Section>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────
const Section: React.FC<{ title: string; icon: any; accent?: boolean; children: React.ReactNode }> =
  ({ title, icon: Icon, accent, children }) => (
    <View style={[s.section, accent && s.sectionAccent]}>
      <View style={s.sectionHead}>
        <View style={s.sectionIcon}><Icon size={14} color={accent ? C.amber : C.primarySoft} /></View>
        <Text style={s.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );

const PendingPanel: React.FC<{ existing: CredentialRow }> = ({ existing }) => {
  const { t, language } = useLanguage();
  return (
  <View style={s.statusWrap}>
    <View style={[s.statusCircle, { backgroundColor: 'rgba(245,158,11,0.16)', borderColor: C.warn }]}>
      <Clock size={36} color={C.warn} />
    </View>
    <Text style={s.statusTitle}>{t('Under review')}</Text>
    <Text style={s.statusSub}>
      {t('Your')} {t(tierLabel(existing.tier))} {t('application was submitted on')} {fmtDate(existing.applied_at)}.
      {' '}{t('A NEXPEC admin will decide within 3 business days.')}
    </Text>
    <View style={s.statusKv}>
      <Text style={s.statusKvLabel}>{t('Signature anchor')}</Text>
      <Text style={s.statusKvVal}>{(existing.strict_liability_signature_sha256 || '').slice(0, 16)}…</Text>
    </View>
  </View>
  );
};

const DecidedPanel: React.FC<{ existing: CredentialRow }> = ({ existing }) => {
  const { t, language } = useLanguage();
  const ok = existing.status === 'approved';
  return (
    <View style={s.statusWrap}>
      <View style={[
        s.statusCircle,
        ok ? { backgroundColor: 'rgba(16,185,129,0.16)', borderColor: C.ok }
           : { backgroundColor: 'rgba(239,68,68,0.16)',  borderColor: C.danger },
      ]}>
        <ShieldCheck size={36} color={ok ? C.ok : C.danger} />
      </View>
      <Text style={s.statusTitle}>{ok ? `${t(tierLabel(existing.tier))}, ${t('Approved')}` : t('Suspended')}</Text>
      <Text style={s.statusSub}>
        {ok
          ? `${t('You may now accept compliance jobs at the')} ${t(tierLabel(existing.tier))} ${t('tier.')}`
          : t('Your credential is currently suspended. Contact NEXPEC support for details.')}
      </Text>
      {existing.expires_at && (
        <View style={s.statusKv}>
          <Text style={s.statusKvLabel}>{t('Expires')}</Text>
          <Text style={s.statusKvVal}>{fmtDate(existing.expires_at)}</Text>
        </View>
      )}
    </View>
  );
};

const tierLabel = (t: Tier) => (
  { cci_basic: 'CCI Basic', cci_advanced: 'CCI Advanced', cci_lead: 'CCI Lead' }[t]
);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ─────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  shieldWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.primaryDim, borderWidth: 1, borderColor: 'rgba(124,58,237,0.45)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '800' },
  headerSub:   { color: C.textDim, fontSize: 11, marginTop: 1 },

  introCard: {
    backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)',
    borderWidth: 1, borderRadius: 16, padding: 14, marginBottom: 16,
    gap: 6,
  },
  introTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  introBody:  { color: C.textSec, fontSize: 12, lineHeight: 17 },

  section: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 14, padding: 14, marginBottom: 14,
  },
  sectionAccent: { borderColor: 'rgba(251,191,36,0.40)' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionIcon: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center',
  },
  sectionTitle: { color: C.textDim, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },

  tierCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    borderRadius: 12, padding: 12, marginBottom: 8,
  },
  tierCardOn: { borderColor: C.primary, backgroundColor: C.primaryDim },
  tierTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  tierSub:   { color: C.textDim, fontSize: 12, marginTop: 2 },

  countryChip: {
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 8,
  },
  countryChipOn: { backgroundColor: C.primaryDim, borderColor: C.primary },
  countryChipText:   { color: C.textDim, fontSize: 12, fontWeight: '700' },
  countryChipTextOn: { color: C.primarySoft },

  fieldLabel: { color: C.textSec, fontSize: 11, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', marginBottom: 6 },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14,
  },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.bg, borderWidth: 1, borderStyle: 'dashed', borderColor: C.primary + '88',
    borderRadius: 12, paddingVertical: 12, marginTop: 4,
  },
  uploadBtnText: { color: C.primarySoft, fontSize: 13, fontWeight: '700' },
  thumbWrap: { position: 'relative', borderRadius: 10, overflow: 'hidden' },
  thumb: { width: '100%', height: 160, backgroundColor: C.cardLift },
  thumbReplace: {
    position: 'absolute', top: 8, right: 8,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  thumbReplaceText: { color: '#FFF', fontSize: 11, fontWeight: '700' },
  expGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  expThumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: C.cardLift },

  agreementMeta: { color: C.textDim, fontSize: 10, marginBottom: 8, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any },
  agreementBox: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    height: 220, padding: 12, marginBottom: 8,
  },
  agreementText: { color: C.textSec, fontSize: 11, lineHeight: 17 },
  scrollGate: { marginBottom: 10 },
  scrollGateOk:  { color: C.ok, fontSize: 11, fontWeight: '700' },
  scrollGateBad: { color: C.warn, fontSize: 11, fontWeight: '700' },

  consentRow: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    padding: 10, marginBottom: 6,
  },
  consentRowOn: { borderColor: C.primary, backgroundColor: C.primaryDim },
  consentBox: {
    width: 20, height: 20, borderRadius: 5,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.bg,
    justifyContent: 'center', alignItems: 'center', marginTop: 2,
  },
  consentBoxOn: { backgroundColor: C.primary, borderColor: C.primary },
  consentLabel: { flex: 1, color: C.text, fontSize: 12, lineHeight: 17 },

  submit: {
    marginTop: 14, backgroundColor: C.primary,
    paddingVertical: 14, borderRadius: 12, alignItems: 'center',
  },
  submitText: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  submitHint: { color: C.textDim, fontSize: 11, marginTop: 8, textAlign: 'center' },

  statusWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: 24, gap: 10,
  },
  statusCircle: {
    width: 96, height: 96, borderRadius: 48, borderWidth: 2,
    justifyContent: 'center', alignItems: 'center',
  },
  statusTitle: { color: C.text, fontSize: 18, fontWeight: '800', marginTop: 8 },
  statusSub: { color: C.textDim, fontSize: 13, textAlign: 'center', maxWidth: 320, lineHeight: 19 },
  statusKv: {
    flexDirection: 'row', gap: 10, alignItems: 'center',
    marginTop: 14, backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  statusKvLabel: { color: C.textDim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  statusKvVal: { color: C.text, fontSize: 12, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any },
});
