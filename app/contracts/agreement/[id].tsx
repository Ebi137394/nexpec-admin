// app/contracts/agreement/[id].tsx — brokered-spine Review & Sign, hosted under the
//   unified Contracts hub (mirrors web /[portal]/contracts/agreement/[id]). Reached
//   from the Contracts screens; clean back navigation, no dead-end. Signs any of the
//   counterparty's own legs (supplier_supply / inspector_engagement / client_supply).
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../../src/components/DynamicForm/theme';
import { fetchAgreement, signAgreement, type MyAgreement } from '../../../src/hooks/useSupplierEcosystem';
import { formatUsd } from '../../../src/core/utils/money';

const KIND_LABEL: Record<string, string> = {
  client_supply: 'Supply & Inspection Agreement',
  supplier_supply: 'Supplier Supply Agreement',
  inspector_engagement: 'Inspector Engagement',
};
const AMOUNT_LABEL: Record<string, string> = {
  client_supply: 'Total payable into escrow',
  supplier_supply: 'You will be paid on goods acceptance',
  inspector_engagement: 'Your payout on admin-confirmed report',
};

export default function ContractAgreementSignScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [agr, setAgr] = useState<MyAgreement | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let on = true;
    fetchAgreement(id!).then((a) => { if (on) setAgr(a); }).catch(() => {}).finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [id]);

  const executed = agr?.status === 'executed' || done;
  const goBack = () => { if (router.canGoBack()) router.back(); else router.replace('/contracts' as any); };

  const sign = async () => {
    if (!agr || !name.trim() || !agreed) return;
    setBusy(true); setErr(null);
    const { error } = await signAgreement(agr.id, name.trim());
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(true);
  };

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={goBack} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>Review & sign</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
      ) : !agr ? (
        <View style={s.center}><Text style={s.muted}>This agreement was not found, or it is not addressed to you.</Text></View>
      ) : executed ? (
        <View style={s.content}>
          <View style={s.okCard}>
            <Ionicons name="checkmark-circle" size={22} color={T.colors.success} />
            <Text style={s.okTitle}>Signed and executed</Text>
            <Text style={s.okBody}>Your signature is sealed. NEXPEC will proceed; funds move only as the contracted milestones clear.</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={goBack} activeOpacity={0.85}>
              <Text style={s.primaryBtnTxt}>Back to Contracts</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <Text style={s.kicker}>{(KIND_LABEL[agr.kind] ?? 'AGREEMENT').toUpperCase()}</Text>
          <View style={s.escrowCard}>
            <Ionicons name="cash-outline" size={16} color={T.colors.primaryLight} />
            <Text style={s.escrowTxt}>{AMOUNT_LABEL[agr.kind] ?? 'Amount'}: <Text style={s.escrowAmt}>{formatUsd(agr.amount_cents)}</Text></Text>
          </View>
          <View style={s.bodyCard}><Text style={s.bodyTxt}>{agr.body_md}</Text></View>
          <Text style={s.label}>Type your full legal name to sign</Text>
          <TextInput value={name} onChangeText={setName} placeholder="Full legal name" placeholderTextColor={T.colors.textMuted} style={s.input} />
          <TouchableOpacity style={s.checkRow} onPress={() => setAgreed((v) => !v)} activeOpacity={0.8}>
            <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={20} color={agreed ? T.colors.primary : T.colors.textMuted} />
            <Text style={s.checkTxt}>I have read and agree to this Agreement with NEXPEC.</Text>
          </TouchableOpacity>
          {!!err && <Text style={s.err}>{err}</Text>}
          <TouchableOpacity style={[s.primaryBtn, (busy || !name.trim() || !agreed) && { opacity: 0.6 }]} disabled={busy || !name.trim() || !agreed} onPress={sign} activeOpacity={0.85}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="shield-checkmark" size={16} color="#fff" />}
            <Text style={s.primaryBtnTxt}>{busy ? 'Signing…' : 'Sign agreement'}</Text>
          </TouchableOpacity>
          <Text style={s.footnote}>Sealed on signature (SHA-256). You contract only with NEXPEC.</Text>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: T.spacing.lg },
  muted: { color: T.colors.textSecondary, textAlign: 'center' },
  content: { paddingHorizontal: T.spacing.lg, paddingBottom: 40 },
  kicker: { color: T.colors.primaryLight, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 10 },
  escrowCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.colors.cardBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.lg, padding: T.spacing.md, marginBottom: 12 },
  escrowTxt: { color: T.colors.textSecondary, fontSize: 13, flex: 1 },
  escrowAmt: { color: T.colors.text, fontWeight: '800' },
  bodyCard: { backgroundColor: T.colors.cardBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.lg, padding: T.spacing.md, marginBottom: 16 },
  bodyTxt: { color: T.colors.textSecondary, fontSize: 13, lineHeight: 20 },
  label: { color: T.colors.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  input: { backgroundColor: T.colors.inputBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, color: T.colors.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, marginBottom: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 16 },
  checkTxt: { color: T.colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },
  err: { color: T.colors.error, fontSize: 13, marginBottom: 12 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: 14, marginTop: 4 },
  primaryBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  footnote: { color: T.colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 12 },
  okCard: { alignSelf: 'stretch', gap: 8, backgroundColor: T.colors.cardBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.lg, padding: T.spacing.lg },
  okTitle: { color: T.colors.text, fontSize: 18, fontWeight: '800' },
  okBody: { color: T.colors.textSecondary, fontSize: 13, lineHeight: 20 },
});
