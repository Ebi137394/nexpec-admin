// ════════════════════════════════════════════════════════════════════════════
//  app/suppliers/contracts/[id].tsx — view + e-sign a Supplier Agreement (mobile)
//
//  Two-party brokered agreement (Supplier ↔ NEXPEC). The supplier signs first;
//  NEXPEC counter-signs to execute and seal it (content_sha256). Mobile parity
//  with web /suppliers/contracts/[id]. The awarded value is the supplier's OWN
//  quote — price-blindness preserved.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useId, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import {
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  Clock,
  FileSignature,
  ExternalLink,
  FileText,
  Hourglass,
  Lock,
  AlertCircle,
  PenLine,
  Fingerprint,
} from 'lucide-react-native';
import {
  useSupplierContract,
  signSupplierContract,
  type SupplierContractStatus,
} from '@/src/hooks/useSupplierContracts';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { formatUsd } from '@/src/core/utils/money';

const C = {
  bg: '#020420',
  bgElev: '#070A24',
  card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.32)',
  borderGreen: 'rgba(16, 249, 149, 0.35)',
  text: '#FFFFFF',
  textSecondary: '#A8B2C7',
  textMuted: '#6B7390',
  textDim: '#475569',
  primary: '#7C3AED',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',
  cyan: '#00FFFF',
  ok: '#10F995',
  okGlow: 'rgba(16, 249, 149, 0.12)',
  warn: '#F59E0B',
  warnDim: 'rgba(245, 158, 11, 0.14)',
  danger: '#EF4444',
  dangerDim: 'rgba(239, 68, 68, 0.14)',
};

const STATUS_META: Record<
  SupplierContractStatus,
  { label: string; tone: string; toneDim: string; icon: any }
> = {
  draft: { label: 'Draft', tone: C.textMuted, toneDim: 'rgba(255,255,255,0.06)', icon: FileText },
  pending_supplier_signature: { label: 'Awaiting You', tone: C.primary, toneDim: C.primaryGlow, icon: PenLine },
  pending_admin_countersignature: { label: 'Awaiting NEXPEC', tone: C.warn, toneDim: C.warnDim, icon: Hourglass },
  executed: { label: 'Executed', tone: C.ok, toneDim: C.okGlow, icon: CheckCircle2 },
  voided: { label: 'Voided', tone: C.danger, toneDim: C.dangerDim, icon: AlertCircle },
};

export default function SupplierContractSignScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { contract, loading, refetch } = useSupplierContract(id);
  const [refreshing, setRefreshing] = useState(false);
  const [signing, setSigning] = useState(false);
  const [typedName, setTypedName] = useState('');

  const channelId = useId();
  useRealtimeSubscription({
    channelName: `supplier-contract:${id ?? 'none'}:${channelId}`,
    bindings: [
      { event: '*', table: 'supplier_contracts', filter: id ? `id=eq.${id}` : undefined },
    ],
    onChange: () => refetch(),
    onDesync: () => refetch(),
    enabled: !!id,
  });

  const status = (contract?.status ?? 'pending_supplier_signature') as SupplierContractStatus;
  const meta = STATUS_META[status] ?? STATUS_META.pending_supplier_signature;
  const canSign = status === 'pending_supplier_signature';
  const isExecuted = status === 'executed';

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleSign = useCallback(async () => {
    if (!contract) return;
    const trimmed = typedName.trim();
    if (trimmed.length < 2) {
      Alert.alert('Type your full name', 'Enter your full legal name to sign.');
      return;
    }
    setSigning(true);
    const res = await signSupplierContract(contract.id, trimmed);
    setSigning(false);
    if (!res.ok) {
      Alert.alert('Could not sign', res.error ?? 'The server refused the signature.');
      return;
    }
    setTypedName('');
    await refetch();
    Alert.alert('Signed', 'You signed. NEXPEC will counter-sign to execute the agreement.');
  }, [contract, typedName, refetch]);

  const handleOpenDocument = useCallback(async () => {
    if (!contract?.custom_contract_url) return;
    try {
      await Linking.openURL(contract.custom_contract_url);
    } catch {
      Alert.alert('Cannot open', 'The agreement URL is not reachable from this device.');
    }
  }, [contract?.custom_contract_url]);

  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={s.center}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.loadingText}>OPENING AGREEMENT…</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!contract) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <Header onBack={() => router.back()} status={null} />
          <View style={s.errorWrap}>
            <Lock size={26} color={C.danger} strokeWidth={1.6} />
            <Text style={s.errorTitle}>Agreement not accessible</Text>
            <Text style={s.errorBody}>
              This agreement no longer exists or you don&apos;t have permission to view it.
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <Header onBack={() => router.back()} status={meta} />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 60 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={C.primary}
                colors={[C.primary]}
              />
            }
          >
            {/* Title */}
            <Animated.View entering={FadeInDown.duration(360)} style={s.titleCard}>
              <View style={s.titleIcon}>
                <FileSignature size={18} color={C.primary} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.titleKicker}>NEXPEC SUPPLIER AGREEMENT</Text>
                <Text style={s.titleText} numberOfLines={2}>
                  {contract.rfq_title ?? 'Supplier agreement'}
                </Text>
                <Text style={s.titleSub}>Counterparty: NEXPEC (Broker of record)</Text>
              </View>
            </Animated.View>

            {/* Timeline */}
            <SectionHeader icon={<Clock size={14} color={C.primary} />} kicker="STATE MACHINE" title="Signature timeline" tint={C.primary} />
            <Animated.View entering={FadeInDown.delay(80)} style={s.timelineCard}>
              <Step n={1} label="Issued" done at={contract.created_at} />
              <Connector done={!!contract.supplier_signed_at || isExecuted} />
              <Step
                n={2}
                label="You sign"
                done={!!contract.supplier_signed_at}
                active={canSign}
                at={contract.supplier_signed_at}
                name={contract.supplier_signed_name}
              />
              <Connector done={isExecuted} />
              <Step
                n={3}
                label="Executed"
                done={isExecuted}
                active={!!contract.supplier_signed_at && !isExecuted}
                at={contract.admin_signed_at}
                isTerminal
              />
            </Animated.View>

            {/* Awarded value — supplier's OWN number */}
            <SectionHeader icon={<Lock size={14} color={C.primary} />} kicker="YOUR PAYOUT" title="Awarded value" tint={C.primary} />
            <Animated.View entering={FadeInDown.delay(140)} style={s.priceCard}>
              <LinearGradient
                colors={['rgba(124,58,237,0.10)', 'rgba(124,58,237,0.02)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Text style={s.priceValue}>{formatUsd(contract.amount_cents)}</Text>
              <Text style={s.priceCaption}>
                Administered by NEXPEC and released to your connected payout account against
                verified milestones. This is your awarded quote value.
              </Text>
            </Animated.View>

            {/* Document */}
            <SectionHeader
              icon={<FileText size={14} color={C.cyan} />}
              kicker="THE DOCUMENT"
              title="Agreement terms"
              tint={C.cyan}
              right={
                contract.custom_contract_url ? (
                  <Pressable onPress={handleOpenDocument} style={s.docCta}>
                    <ExternalLink size={11} color={C.cyan} strokeWidth={2} />
                    <Text style={s.docCtaText}>Open PDF</Text>
                  </Pressable>
                ) : null
              }
            />
            <Animated.View entering={FadeInDown.delay(200)} style={s.docCard}>
              {contract.contract_text_md ? (
                <ScrollView style={s.docScroll} nestedScrollEnabled showsVerticalScrollIndicator>
                  <Text style={s.docBody}>{contract.contract_text_md}</Text>
                </ScrollView>
              ) : (
                <View style={s.docEmpty}>
                  <FileText size={20} color={C.textMuted} strokeWidth={1.5} />
                  <Text style={s.docEmptyText}>
                    Terms are attached as a PDF. Tap &quot;Open PDF&quot; above to review.
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* Execution seal */}
            {isExecuted && contract.content_sha256 ? (
              <Animated.View entering={FadeIn.delay(220)} style={s.sealCard}>
                <View style={s.sealHeader}>
                  <Fingerprint size={15} color={C.ok} strokeWidth={1.8} />
                  <Text style={s.sealTitle}>Tamper-evident execution seal</Text>
                </View>
                <Text style={s.sealBody}>
                  Signed by {contract.supplier_signed_name ?? 'you'} and counter-signed by NEXPEC
                  {contract.admin_signed_name ? ` (${contract.admin_signed_name})` : ''}.
                </Text>
                <Text style={s.sealHash}>sha256:{contract.content_sha256}</Text>
              </Animated.View>
            ) : null}

            {/* Sign panel */}
            {canSign ? (
              <>
                <SectionHeader icon={<PenLine size={14} color={C.warn} />} kicker="YOUR SIGNATURE" title="Sign to proceed" tint={C.warn} />
                <Animated.View entering={FadeIn.delay(260)} style={s.signCard}>
                  <Text style={s.signLabel}>Type your full legal name</Text>
                  <TextInput
                    style={s.signInput}
                    placeholder="e.g. Jane Q. Public"
                    placeholderTextColor={C.textDim}
                    value={typedName}
                    onChangeText={setTypedName}
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!signing}
                    returnKeyType="done"
                  />
                  <Pressable
                    onPress={handleSign}
                    disabled={signing || typedName.trim().length < 2}
                    style={({ pressed }) => [
                      s.signCta,
                      (signing || typedName.trim().length < 2) && { opacity: 0.6 },
                      pressed && { transform: [{ scale: 0.98 }] },
                    ]}
                  >
                    <LinearGradient
                      colors={[C.primary, C.primaryBright]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                    {signing ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <PenLine size={15} color="#FFFFFF" strokeWidth={2} />
                    )}
                    <Text style={s.signCtaText}>{signing ? 'Recording…' : 'Sign agreement'}</Text>
                  </Pressable>
                  <Text style={s.signFootnote}>
                    Your typed name, timestamp, IP, and device user-agent are stored as evidence.
                    Equivalent to a typed e-signature.
                  </Text>
                </Animated.View>
              </>
            ) : null}

            {/* Awaiting NEXPEC */}
            {status === 'pending_admin_countersignature' ? (
              <Animated.View entering={FadeIn.delay(260)} style={s.waitCard}>
                <Hourglass size={18} color={C.warn} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={s.waitTitle}>Waiting on NEXPEC</Text>
                  <Text style={s.waitBody}>
                    You signed{contract.supplier_signed_at ? ` on ${new Date(contract.supplier_signed_at).toLocaleString()}` : ''}.
                    NEXPEC will counter-sign to execute.
                  </Text>
                </View>
              </Animated.View>
            ) : null}

            {/* Executed */}
            {isExecuted ? (
              <Animated.View entering={FadeIn.delay(260)} style={s.executedCard}>
                <View style={s.executedIcon}>
                  <CheckCircle2 size={24} color={C.ok} strokeWidth={2} />
                </View>
                <Text style={s.executedTitle}>Agreement executed</Text>
                <Text style={s.executedBody}>
                  Both parties have signed. Brokered milestone payouts can now be released to your
                  wallet for this engagement.
                </Text>
              </Animated.View>
            ) : null}

            <View style={s.trustRow}>
              <ShieldCheck size={11} color={C.textMuted} />
              <Text style={s.trustText}>
                Signing is authenticated by your account. All transitions are audited on the server.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const Header: React.FC<{
  onBack: () => void;
  status: { label: string; tone: string; toneDim: string; icon: any } | null;
}> = ({ onBack, status }) => {
  const Icon = status?.icon ?? ShieldCheck;
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} style={s.headerBtn} hitSlop={10}>
        <ArrowLeft size={18} color={C.text} />
      </Pressable>
      <View style={s.headerCenter}>
        <Text style={s.headerKicker}>BINDING &amp; BROKERED</Text>
        <Text style={s.headerTitle}>Agreement</Text>
      </View>
      {status ? (
        <View style={[s.headerStatus, { backgroundColor: status.toneDim, borderColor: status.tone + '55' }]}>
          <Icon size={11} color={status.tone} strokeWidth={2} />
          <Text style={[s.headerStatusText, { color: status.tone }]}>{status.label.toUpperCase()}</Text>
        </View>
      ) : (
        <View style={{ width: 38 }} />
      )}
    </View>
  );
};

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  kicker: string;
  title: string;
  tint: string;
  right?: React.ReactNode;
}> = ({ icon, kicker, title, tint, right }) => (
  <View style={s.sectionHeader}>
    <View style={[s.sectionIconWrap, { backgroundColor: tint + '14' }]}>{icon}</View>
    <View style={{ flex: 1 }}>
      <Text style={[s.sectionKicker, { color: tint }]}>{kicker}</Text>
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
    {right}
  </View>
);

const Step: React.FC<{
  n: number;
  label: string;
  done?: boolean;
  active?: boolean;
  at?: string | null;
  name?: string | null;
  isTerminal?: boolean;
}> = ({ n, label, done, active, at, name, isTerminal }) => {
  const tone = done ? C.ok : active ? C.warn : C.textMuted;
  const ring = done ? C.ok : active ? C.warn : 'rgba(255,255,255,0.10)';
  return (
    <View style={s.tlStep}>
      <View style={[s.tlDot, { borderColor: ring }]}>
        {done ? (
          <CheckCircle2 size={18} color={C.ok} strokeWidth={2.2} />
        ) : isTerminal ? (
          <ShieldCheck size={14} color={C.textMuted} strokeWidth={1.8} />
        ) : (
          <Text style={[s.tlIndex, { color: tone }]}>{n}</Text>
        )}
      </View>
      <Text style={[s.tlLabel, { color: tone }]} numberOfLines={1}>{label}</Text>
      {at ? (
        <Text style={s.tlMeta} numberOfLines={1}>
          {name ? `${name}, ` : ''}
          {new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </Text>
      ) : active ? (
        <Text style={[s.tlMeta, { color: C.warn }]}>Awaiting</Text>
      ) : (
        <Text style={s.tlMeta}>—</Text>
      )}
    </View>
  );
};

const Connector: React.FC<{ done?: boolean }> = ({ done }) => (
  <View style={[s.tlConnector, { backgroundColor: done ? C.ok : 'rgba(255,255,255,0.06)' }]} />
);

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  glowTopLeft: { position: 'absolute', top: -160, left: -100, width: 360, height: 360, borderRadius: 200, backgroundColor: C.primary, opacity: 0.2 },
  glowBottomRight: { position: 'absolute', bottom: -180, right: -100, width: 340, height: 340, borderRadius: 200, backgroundColor: C.ok, opacity: 0.04 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  headerBtn: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.bgElev, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerKicker: { color: C.cyan, fontSize: 9, fontWeight: '800', letterSpacing: 1.6, marginBottom: 1 },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  headerStatus: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  headerStatusText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { color: C.textMuted, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },

  errorWrap: { margin: 20, padding: 24, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', gap: 12 },
  errorTitle: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 4 },
  errorBody: { color: C.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center' },

  titleCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 20, marginTop: 8, marginBottom: 4, padding: 14, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.borderStrong },
  titleIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.primaryGlow, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.borderStrong },
  titleKicker: { color: C.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  titleText: { color: C.text, fontSize: 15, fontWeight: '800', letterSpacing: -0.2, marginTop: 2, lineHeight: 19 },
  titleSub: { color: C.textMuted, fontSize: 11, marginTop: 4 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginTop: 16, marginBottom: 10 },
  sectionIconWrap: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  sectionKicker: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  sectionTitle: { color: C.text, fontSize: 14, fontWeight: '800', letterSpacing: -0.2, marginTop: 1 },

  timelineCard: { marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 14, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'flex-start' },
  tlStep: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  tlDot: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 8, backgroundColor: C.bgElev },
  tlIndex: { fontSize: 13, fontWeight: '800' },
  tlLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3, textAlign: 'center' },
  tlMeta: { color: C.textMuted, fontSize: 9.5, fontWeight: '500', marginTop: 3, textAlign: 'center' },
  tlConnector: { height: 2, flex: 0.5, marginTop: 18, borderRadius: 1 },

  priceCard: { marginHorizontal: 20, padding: 18, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.borderStrong, overflow: 'hidden' },
  priceValue: { color: C.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.8, marginBottom: 6 },
  priceCaption: { color: C.textMuted, fontSize: 11, lineHeight: 15 },

  docCard: { marginHorizontal: 20, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  docScroll: { maxHeight: 220, padding: 14 },
  docBody: { color: C.textSecondary, fontSize: 12.5, lineHeight: 18.5 },
  docEmpty: { padding: 22, alignItems: 'center', gap: 8 },
  docEmptyText: { color: C.textMuted, fontSize: 11.5, textAlign: 'center', lineHeight: 16 },
  docCta: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, backgroundColor: 'rgba(0,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(0,255,255,0.30)' },
  docCtaText: { color: C.cyan, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },

  sealCard: { marginHorizontal: 20, marginTop: 14, padding: 16, borderRadius: 16, backgroundColor: C.okGlow, borderWidth: 1, borderColor: C.borderGreen },
  sealHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sealTitle: { color: C.ok, fontSize: 13, fontWeight: '800' },
  sealBody: { color: C.textSecondary, fontSize: 11.5, lineHeight: 16, marginTop: 6 },
  sealHash: { color: 'rgba(16,249,149,0.75)', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 8 },

  signCard: { marginHorizontal: 20, padding: 16, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: 'rgba(245, 158, 11, 0.35)' },
  signLabel: { color: C.warn, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },
  signInput: { backgroundColor: C.bgElev, color: C.text, fontSize: 15, fontWeight: '600', paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  signCta: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14, overflow: 'hidden' },
  signCtaText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  signFootnote: { color: C.textMuted, fontSize: 10.5, lineHeight: 14.5, marginTop: 10, paddingHorizontal: 2 },

  waitCard: { marginHorizontal: 20, marginTop: 14, padding: 16, borderRadius: 16, backgroundColor: C.warnDim, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', flexDirection: 'row', gap: 12 },
  waitTitle: { color: C.warn, fontSize: 13, fontWeight: '800' },
  waitBody: { color: C.textSecondary, fontSize: 11.5, lineHeight: 16, marginTop: 3 },

  executedCard: { marginHorizontal: 20, marginTop: 14, padding: 20, borderRadius: 18, backgroundColor: C.okGlow, borderWidth: 1, borderColor: C.borderGreen, alignItems: 'center' },
  executedIcon: { width: 50, height: 50, borderRadius: 14, backgroundColor: 'rgba(16, 249, 149, 0.20)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.borderGreen, marginBottom: 10 },
  executedTitle: { color: C.ok, fontSize: 15, fontWeight: '800', letterSpacing: -0.2, marginBottom: 4 },
  executedBody: { color: C.textSecondary, fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: 4 },

  trustRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, marginHorizontal: 28 },
  trustText: { color: C.textMuted, fontSize: 10, lineHeight: 14, flex: 1 },
});
