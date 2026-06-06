// src/components/contracts/InspectorTrust.tsx — mobile Trust Architecture (A–E),
//   1:1 with the web components. Pure presentation over already-blinded data
//   (no PII, no backend). Used by the deal sign screen's shortlist + assigned cards.
import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NEXPEC_THEME as T } from '../DynamicForm/theme';

const AMBER = '#fbbf24';
const AMBER_SOFT = 'rgba(251,191,36,0.12)';

export interface CertData {
  handle: string;
  competencies: string[];
  certifications: string[];
  region: string | null;
  scope: string | null;
  tier: string;
  sealId?: string | null;
  redactedCv?: string | null;
  statement?: string | null;
  eoPolicyRef?: string | null;
}

// ── A + B — cryptographic Digital Certificate (NO name, NO photo) ──────────────
export function CredentialCertificate({
  data, slot, revealed, legalName, onReveal, vipUnlocked,
}: {
  data: CertData; slot?: string; revealed?: boolean; legalName?: string | null; onReveal?: () => void; vipUnlocked?: boolean;
}) {
  return (
    <View style={ct.card}>
      <View style={ct.accent} />
      <View style={ct.headRow}>
        <View style={ct.headLeft}>
          <View style={ct.monogram}>
            <Ionicons name={revealed ? 'ribbon' : 'lock-closed'} size={18} color={revealed ? T.colors.success : T.colors.primaryLight} />
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={ct.kicker}>NEXPEC VERIFIED CREDENTIAL</Text>
            <Text style={ct.handle} numberOfLines={1}>{revealed && legalName ? legalName : data.handle}</Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {!!slot && <Text style={ct.slot}>Option {slot}</Text>}
          <Text style={ct.tier}>{data.tier} tier</Text>
          {vipUnlocked && <Text style={ct.vipChip}>Named disclosure</Text>}
        </View>
      </View>

      {data.certifications.length > 0 && (
        <View style={ct.chipRow}>
          {data.certifications.map((cert) => (
            <View key={cert} style={ct.certChip}>
              <Ionicons name="checkmark" size={11} color={T.colors.success} />
              <Text style={ct.certChipTxt}>{cert}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={ct.kv}><Text style={ct.k}>Competencies: </Text>{data.competencies.length ? data.competencies.join(', ') : 'n/a'}</Text>
      <Text style={ct.kv}><Text style={ct.k}>Region: </Text>{data.region ?? 'n/a'}</Text>
      <Text style={ct.kv}><Text style={ct.k}>Scope: </Text>{data.scope ?? 'n/a'}</Text>
      {data.tier === 'named' && !!data.redactedCv && <Text style={ct.cv}>{data.redactedCv}</Text>}
      {!!data.statement && <Text style={ct.statement}>{data.statement}</Text>}

      <View style={ct.sealRow}>
        <View style={ct.sealLeft}>
          <Ionicons name="finger-print" size={13} color={T.colors.primaryLight} />
          <Text style={ct.sealTxt}>SHA-256 sealed</Text>
        </View>
        <Text style={ct.sealId} numberOfLines={1}>{data.eoPolicyRef ? `${data.eoPolicyRef}  ` : ''}{data.sealId ?? data.handle}</Text>
      </View>

      {!revealed && (
        <View style={ct.lockRow}>
          <View style={ct.sealLeft}>
            <Ionicons name="lock-closed" size={12} color={T.colors.textMuted} />
            <Text style={ct.lockTxt}>Name & photo sealed until final report</Text>
          </View>
          {!!onReveal && (
            <TouchableOpacity onPress={onReveal} hitSlop={8} style={ct.revealBtn} activeOpacity={0.8}>
              <Ionicons name="sparkles" size={12} color={AMBER} />
              <Text style={ct.revealTxt}>Reveal now</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

// ── C — Neutrality Guarantee badge ─────────────────────────────────────────────
export function NeutralityBadge({ statement, supplierHandle }: { statement?: string | null; supplierHandle?: string | null }) {
  return (
    <View style={nb.wrap}>
      <View style={nb.icon}><Ionicons name="shield-checkmark" size={16} color={T.colors.success} /></View>
      <View style={{ flexShrink: 1 }}>
        <Text style={nb.title}>NEUTRALITY GUARANTEED, ZERO CONFLICT</Text>
        <Text style={nb.body}>
          {statement ?? 'Independent of the supplier; no financial or employment relationship.'}
          {supplierHandle ? ` Screened against supplier ${supplierHandle}.` : ''}
        </Text>
      </View>
    </View>
  );
}

// ── E — Named-Disclosure VIP gate: offer → sign sealed amendment → unlocked ─────
type RequestResult = { agreementId: string; feeCents: number; currency: string; bodyMd: string | null } | { error: string };
export function VipDisclosureGate({
  open, onClose, tier, handle, onRequest, onSign, onUnlocked,
}: {
  open: boolean; onClose: () => void; tier: string; handle: string;
  onRequest?: () => Promise<RequestResult>;
  onSign?: (agreementId: string, name: string) => Promise<{ error?: { message: string } | null }>;
  onUnlocked?: () => void;
}) {
  const [phase, setPhase] = useState<'offer' | 'sign' | 'done'>('offer');
  const [amend, setAmend] = useState<{ agreementId: string; feeCents: number; currency: string; bodyMd: string | null } | null>(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const functional = !!onRequest && !!onSign;
  const benefits = [
    'Inspector legal name + verified CV, disclosed upfront',
    'Direct credential audit before mobilization',
    'Extended 36-month non-circumvention + liquidated damages',
    'Sealed amendment to your MSA (SHA-256 + OpenTimestamps)',
  ];
  const close = () => { setPhase('offer'); setAmend(null); setName(''); setAgreed(false); setErr(null); setBusy(false); onClose(); };
  const proceed = async () => {
    if (!onRequest) return;
    setBusy(true); setErr(null);
    const res = await onRequest();
    setBusy(false);
    if ('error' in res) { setErr(res.error); return; }
    setAmend(res); setPhase('sign');
  };
  const doSign = async () => {
    if (!onSign || !amend || !name.trim() || !agreed) return;
    setBusy(true); setErr(null);
    const { error } = await onSign(amend.agreementId, name.trim());
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPhase('done'); onUnlocked?.();
  };
  const feeLabel = amend ? `${(amend.feeCents / 100).toFixed(2)} ${amend.currency}` : '';
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <View style={vp.overlay}>
        <View style={vp.card}>
          <View style={vp.accent} />
          <TouchableOpacity onPress={close} hitSlop={10} style={vp.close}><Ionicons name="close" size={20} color={T.colors.textMuted} /></TouchableOpacity>
          <ScrollView contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={false}>
            <View style={vp.crown}><Ionicons name="diamond" size={24} color={AMBER} /></View>

            {phase === 'done' ? (
              <>
                <Text style={vp.title}>Named disclosure unlocked</Text>
                <View style={vp.okBox}>
                  <Text style={vp.okTitle}>Sealed amendment executed</Text>
                  <Text style={vp.okBody}>The inspector&apos;s legal name and verified credentials are now revealed below. Your sealed amendment is verifiable at /passport.</Text>
                </View>
                <TouchableOpacity style={[vp.cta, { backgroundColor: T.colors.primary }]} onPress={close} activeOpacity={0.85}><Text style={[vp.ctaTxt, { color: '#fff' }]}>Done</Text></TouchableOpacity>
              </>
            ) : phase === 'sign' && amend ? (
              <>
                <Text style={vp.title}>Sign the disclosure amendment</Text>
                <View style={vp.feeRow}><Text style={vp.feeLabel}>Premium fee</Text><Text style={vp.feeVal}>{feeLabel}</Text></View>
                {!!amend.bodyMd && <ScrollView style={vp.bodyBox} nestedScrollEnabled showsVerticalScrollIndicator={false}><Text style={vp.bodyTxt}>{amend.bodyMd}</Text></ScrollView>}
                <TextInput value={name} onChangeText={setName} placeholder="Type your full legal name to sign" placeholderTextColor={T.colors.textMuted} style={vp.input} />
                <TouchableOpacity style={vp.checkRow} onPress={() => setAgreed((v) => !v)} activeOpacity={0.8}>
                  <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={20} color={agreed ? AMBER : T.colors.textMuted} />
                  <Text style={vp.checkTxt}>I agree to the premium fee and the extended 36-month non-circumvention + liquidated damages.</Text>
                </TouchableOpacity>
                {!!err && <Text style={vp.errTxt}>{err}</Text>}
                <TouchableOpacity style={[vp.cta, (busy || !name.trim() || !agreed) && { opacity: 0.6 }]} disabled={busy || !name.trim() || !agreed} onPress={doSign} activeOpacity={0.85}>
                  <Text style={vp.ctaTxt}>{busy ? 'Sealing…' : 'Sign & unlock'}</Text>
                  <Ionicons name="shield-checkmark" size={16} color="#1a1505" />
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={vp.title}>Unlock Named Disclosure</Text>
                <Text style={vp.desc}>
                  Inspector <Text style={vp.handle}>{handle}</Text> is sealed at the <Text style={{ fontWeight: '800', color: T.colors.text }}>{tier}</Text> tier. NEXPEC escrows identity to protect against poaching — upgrade to reveal it before the final report.
                </Text>
                <View style={{ marginTop: 16, gap: 10 }}>
                  {benefits.map((b) => (
                    <View key={b} style={vp.benefitRow}>
                      <Ionicons name="sparkles" size={15} color={AMBER} style={{ marginTop: 1 }} />
                      <Text style={vp.benefitTxt}>{b}</Text>
                    </View>
                  ))}
                </View>
                <View style={vp.priceRow}>
                  <View>
                    <Text style={vp.priceKicker}>NAMED DISCLOSURE</Text>
                    <Text style={vp.priceName}>Premium add-on</Text>
                  </View>
                  <Text style={vp.vipChip}>VIP tier</Text>
                </View>
                {!!err && <Text style={vp.errTxt}>{err}</Text>}
                {functional ? (
                  <TouchableOpacity style={[vp.cta, busy && { opacity: 0.6 }]} disabled={busy} onPress={proceed} activeOpacity={0.85}>
                    <Text style={vp.ctaTxt}>{busy ? 'Preparing amendment…' : 'Continue to terms'}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#1a1505" />
                  </TouchableOpacity>
                ) : (
                  <Text style={vp.note}>Available once an inspector is engaged on this deal.</Text>
                )}
                <Text style={vp.fine}>Stricter non-circumvention applies. Pricing confirmed by NEXPEC.</Text>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const ct = StyleSheet.create({
  card: { position: 'relative', overflow: 'hidden', borderWidth: 1, borderColor: T.colors.primary, borderRadius: T.borderRadius.lg, backgroundColor: T.colors.cardBackground, padding: T.spacing.md, paddingTop: T.spacing.md + 3, gap: 6 },
  accent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: T.colors.primary },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  monogram: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: T.colors.primary, backgroundColor: T.colors.inputBackground, alignItems: 'center', justifyContent: 'center' },
  kicker: { color: T.colors.primaryLight, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  handle: { color: T.colors.text, fontSize: 14, fontWeight: '800' },
  slot: { color: T.colors.primaryLight, fontSize: 11, fontWeight: '800', backgroundColor: T.colors.inputBackground, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  tier: { color: T.colors.textSecondary, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  vipChip: { color: AMBER, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', backgroundColor: AMBER_SOFT, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  certChip: { flexDirection: 'row', alignItems: 'center', gap: 3, borderWidth: 1, borderColor: T.colors.success, backgroundColor: 'rgba(34,197,94,0.10)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  certChipTxt: { color: T.colors.success, fontSize: 11, fontWeight: '700' },
  kv: { color: T.colors.text, fontSize: 12.5, lineHeight: 18 },
  k: { color: T.colors.textMuted },
  cv: { color: T.colors.textSecondary, fontSize: 12.5, fontStyle: 'italic', marginTop: 2 },
  statement: { color: T.colors.textSecondary, fontSize: 11.5, lineHeight: 17, marginTop: 4 },
  sealRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6, borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: T.borderRadius.md, paddingHorizontal: 10, paddingVertical: 7 },
  sealLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  sealTxt: { color: T.colors.textSecondary, fontSize: 11 },
  sealId: { color: T.colors.textSecondary, fontSize: 11, flexShrink: 1, textAlign: 'right' },
  lockRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 2 },
  lockTxt: { color: T.colors.textMuted, fontSize: 11 },
  revealBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  revealTxt: { color: AMBER, fontSize: 11, fontWeight: '800' },
});

const nb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderColor: T.colors.success, backgroundColor: 'rgba(34,197,94,0.07)', borderRadius: T.borderRadius.lg, padding: T.spacing.md },
  icon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: T.colors.success, backgroundColor: 'rgba(34,197,94,0.10)', alignItems: 'center', justifyContent: 'center' },
  title: { color: T.colors.success, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  body: { color: T.colors.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
});

const vp = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 420, maxHeight: '85%', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)', borderRadius: T.borderRadius.lg, backgroundColor: T.colors.cardBackground },
  accent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: AMBER, zIndex: 1 },
  close: { position: 'absolute', top: 12, right: 12, zIndex: 2 },
  crown: { width: 48, height: 48, borderRadius: T.borderRadius.md, borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)', backgroundColor: AMBER_SOFT, alignItems: 'center', justifyContent: 'center' },
  title: { color: T.colors.text, fontSize: 20, fontWeight: '800', marginTop: 12 },
  desc: { color: T.colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 },
  handle: { fontWeight: '700', color: T.colors.text },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  benefitTxt: { color: T.colors.text, fontSize: 13, lineHeight: 19, flexShrink: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.inputBackground, borderRadius: T.borderRadius.md, paddingHorizontal: 14, paddingVertical: 12, marginTop: 16 },
  priceKicker: { color: T.colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  priceName: { color: T.colors.text, fontSize: 14, fontWeight: '800', marginTop: 2 },
  vipChip: { color: AMBER, fontSize: 11, fontWeight: '800', backgroundColor: AMBER_SOFT, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: AMBER, borderRadius: T.borderRadius.md, paddingVertical: 13, marginTop: 16 },
  ctaTxt: { color: '#1a1505', fontSize: 15, fontWeight: '800' },
  fine: { color: T.colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 },
  okBox: { borderWidth: 1, borderColor: T.colors.success, backgroundColor: 'rgba(34,197,94,0.07)', borderRadius: T.borderRadius.md, padding: 16, marginTop: 16 },
  okTitle: { color: T.colors.success, fontSize: 14, fontWeight: '800' },
  okBody: { color: T.colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  feeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)', backgroundColor: AMBER_SOFT, borderRadius: T.borderRadius.md, paddingHorizontal: 14, paddingVertical: 11, marginTop: 14 },
  feeLabel: { color: T.colors.textSecondary, fontSize: 13 },
  feeVal: { color: '#fcd34d', fontSize: 14, fontWeight: '800' },
  bodyBox: { maxHeight: 200, borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.background, borderRadius: T.borderRadius.md, padding: 12, marginTop: 12 },
  bodyTxt: { color: T.colors.textSecondary, fontSize: 12, lineHeight: 18 },
  input: { backgroundColor: T.colors.inputBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, color: T.colors.text, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, marginTop: 12 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  checkTxt: { color: T.colors.textSecondary, fontSize: 12.5, lineHeight: 18, flex: 1 },
  errTxt: { color: T.colors.error, fontSize: 13, marginTop: 10 },
  note: { color: T.colors.textSecondary, fontSize: 12.5, textAlign: 'center', borderWidth: 1, borderColor: T.colors.inputBorder, backgroundColor: T.colors.inputBackground, borderRadius: T.borderRadius.md, paddingHorizontal: 14, paddingVertical: 12, marginTop: 16 },
});
