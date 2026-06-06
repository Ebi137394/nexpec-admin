// app/deals/[id]/sign.tsx — mobile Review & sign (parity with web /deals/[id]/sign)
//   Signing executes the Client↔NEXPEC supply agreement and HOLDS the client
//   price in escrow (contract-before-money), which dispatches the inspection.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../../src/components/DynamicForm/theme';
import {
  fetchClientAgreement, signAgreement, fetchAssignedInspector, clientReviewEngagement,
  fetchDealById, fetchPaymentSchedule, fundDealBalance, raiseNonconformance,
  fetchInspectorShortlist, selectInspector, requestNamedDisclosure,
  type ClientAgreement, type AssignedInspector, type DealRow, type PaymentTranche, type InspectorCandidate,
} from '../../../src/hooks/useSupplierEcosystem';
import { formatUsd } from '../../../src/core/utils/money';
import { CredentialCertificate, NeutralityBadge, VipDisclosureGate } from '../../../src/components/contracts/InspectorTrust';

export default function DealSignScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [agr, setAgr] = useState<ClientAgreement | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let on = true;
    fetchClientAgreement(id!).then((a) => { if (on) setAgr(a); }).catch(() => {}).finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [id]);

  const executed = agr?.status === 'executed' || done;

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
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>Review & sign</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
      ) : !agr ? (
        <View style={s.center}><Text style={s.muted}>No supply agreement found for this deal.</Text></View>
      ) : executed ? (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <View style={s.okCard}>
            <Ionicons name="checkmark-circle" size={22} color={T.colors.success} />
            <Text style={s.okTitle}>Signed and mobilized</Text>
            <Text style={s.okBody}>Your 30% mobilization deposit is held in escrow against the {formatUsd(agr.amount_cents)} contract price; the 70% balance is due at FAT/Inspection-Readiness (see your payment schedule below). NEXPEC is dispatching your inspection.</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => router.replace('/rfqs' as any)} activeOpacity={0.85}>
              <Text style={s.primaryBtnTxt}>Back to RFQs</Text>
            </TouchableOpacity>
          </View>
          <View style={[s.bodyCard, { marginTop: 12 }]}>
            <Text style={s.kicker}>YOUR EXECUTED AGREEMENT</Text>
            <Text style={{ color: T.colors.textSecondary, fontSize: 13, marginTop: 8 }}>
              <Text style={{ color: T.colors.textMuted }}>Date issued: </Text>
              {(agr.presented_at || agr.created_at) ? new Date((agr.presented_at || agr.created_at) as string).toLocaleString() : 'n/a'}
            </Text>
            <Text style={{ color: T.colors.textSecondary, fontSize: 13, marginTop: 2 }}>
              <Text style={{ color: T.colors.textMuted }}>Date executed: </Text>
              {agr.executed_at ? new Date(agr.executed_at).toLocaleString() : 'Just now'}
            </Text>
            {!!agr.body_md && <Text style={[s.bodyTxt, { marginTop: 10 }]}>{agr.body_md}</Text>}
            {!!agr.content_sha256 && <Text style={[s.footnote, { textAlign: 'left', marginTop: 8 }]}>Sealed sha256:{agr.content_sha256}</Text>}
          </View>
          <MilestoneFundingCard dealId={id!} />
          <InspectorShortlistCard dealId={id!} />
          <AssignedInspectorCard dealId={id!} />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <Text style={s.kicker}>SUPPLY AND INSPECTION AGREEMENT</Text>
          <View style={s.escrowCard}>
            <Ionicons name="lock-closed" size={16} color={T.colors.primaryLight} />
            <Text style={s.escrowTxt}>On signature you fund the <Text style={s.escrowAmt}>30% mobilization deposit</Text> of the {formatUsd(agr.amount_cents)} contract price; the 70% balance is due at FAT/Inspection-Readiness (Schedule B).</Text>
          </View>
          <View style={s.bodyCard}><Text style={s.bodyTxt}>{agr.body_md}</Text></View>
          <Text style={s.label}>Type your full legal name to sign</Text>
          <TextInput value={name} onChangeText={setName} placeholder="e.g. Jane A. Client" placeholderTextColor={T.colors.textMuted} style={s.input} />
          <TouchableOpacity style={s.checkRow} onPress={() => setAgreed((v) => !v)} activeOpacity={0.8}>
            <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={20} color={agreed ? T.colors.primary : T.colors.textMuted} />
            <Text style={s.checkTxt}>I have read and agree, and authorise NEXPEC to hold the 30% mobilization deposit in escrow.</Text>
          </TouchableOpacity>
          {!!err && <Text style={s.err}>{err}</Text>}
          <TouchableOpacity style={[s.primaryBtn, (busy || !name.trim() || !agreed) && { opacity: 0.6 }]} disabled={busy || !name.trim() || !agreed} onPress={sign} activeOpacity={0.85}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="shield-checkmark" size={16} color="#fff" />}
            <Text style={s.primaryBtnTxt}>{busy ? 'Signing…' : 'Sign and fund deposit'}</Text>
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
  muted: { color: T.colors.textSecondary },
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

// ── Assigned-inspector trust panel: A/B/C dossier + D review gate + F identity escrow ──
const REVIEW_LABEL: Record<string, string> = {
  pending: 'Awaiting your review', approved: 'Approved by you',
  objected: 'Objection raised', auto_approved: 'Auto-approved',
};

function AssignedInspectorCard({ dealId }: { dealId: string }) {
  const [insp, setInsp] = useState<AssignedInspector | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [showObject, setShowObject] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [vipOpen, setVipOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchAssignedInspector(dealId).then(setInsp).catch(() => setInsp(null)).finally(() => setLoading(false));
  }, [dealId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={c.card}><ActivityIndicator color={T.colors.primary} /></View>;
  if (!insp) return (
    <View style={c.card}>
      <Text style={c.h}>Inspector assignment pending</Text>
      <Text style={c.body}>NEXPEC is blind-matching a credential-verified inspector. Their independent, anonymized dossier will appear here for your review before work begins.</Text>
    </View>
  );

  const review = async (decision: 'approved' | 'objected') => {
    if (decision === 'objected' && !reason.trim()) { setShowObject(true); return; }
    setBusy(decision); setErr(null);
    const { error } = await clientReviewEngagement(dealId, decision, decision === 'objected' ? reason.trim() : undefined);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setShowObject(false); setReason(''); load();
  };

  const d = insp.dossier, cert = insp.certificate, indep = insp.independence;
  const pending = insp.client_review === 'pending';
  const revealed = !!insp.inspector_legal_name;
  const reviewColor = insp.client_review === 'objected' ? T.colors.error : pending ? T.colors.primaryLight : T.colors.success;

  return (
    <View style={c.wrap}>
      <View style={c.head}>
        <Ionicons name="ribbon" size={16} color={T.colors.primaryLight} />
        <Text style={c.title}>Your assigned inspector</Text>
        <Text style={c.handle}>{insp.handle}</Text>
      </View>
      <View style={c.pillRow}>
        <Text style={[c.pill, { color: T.colors.primaryLight, borderColor: T.colors.primaryLight }]}>{insp.transparency_tier} tier</Text>
        <Text style={[c.pill, { color: reviewColor, borderColor: reviewColor }]}>{REVIEW_LABEL[insp.client_review] ?? insp.client_review}</Text>
      </View>

      <CredentialCertificate
        data={{
          handle: insp.handle,
          competencies: d?.competencies ?? [],
          certifications: d?.certifications ?? [],
          region: d?.region ?? null,
          scope: d?.scope ?? null,
          tier: insp.transparency_tier,
          sealId: insp.artifacts_seal_id,
          statement: cert?.statement ?? null,
          eoPolicyRef: cert?.eo_policy_ref ?? null,
          redactedCv: d?.redacted_cv ?? null,
        }}
        revealed={revealed}
        legalName={insp.inspector_legal_name}
        vipUnlocked={!!insp.identity_revealed_at && !insp.report_confirmed_at}
        onReveal={revealed ? undefined : () => setVipOpen(true)}
      />
      <NeutralityBadge statement={indep?.statement} supplierHandle={indep?.supplier_handle} />

      {pending ? (
        <View style={[c.sect, { borderColor: T.colors.primaryLight }]}>
          <Text style={c.body}>
            Review the dossier above, then approve to let work begin{insp.review_deadline
              ? `. It auto-approves ${new Date(insp.review_deadline).toLocaleString()} if you take no action.`
              : ' (manual approval, no deadline).'}
          </Text>
          {showObject && (
            <TextInput value={reason} onChangeText={setReason} placeholder="Tell NEXPEC why so we can re-match" placeholderTextColor={T.colors.textMuted} multiline style={c.objInput} />
          )}
          {!!err && <Text style={c.err}>{err}</Text>}
          <View style={c.btnRow}>
            <TouchableOpacity style={[c.approveBtn, busy === 'approved' && { opacity: 0.6 }]} disabled={busy === 'approved'} onPress={() => review('approved')} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={15} color="#0b0b0f" />
              <Text style={c.approveTxt}>{busy === 'approved' ? 'Approving…' : 'Approve'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[c.objectBtn, busy === 'objected' && { opacity: 0.6 }]} disabled={busy === 'objected'} onPress={() => review('objected')} activeOpacity={0.85}>
              <Ionicons name="flag" size={15} color={T.colors.error} />
              <Text style={c.objectTxt}>{showObject ? (busy === 'objected' ? 'Submitting…' : 'Submit objection') : 'Object'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : insp.client_review === 'objected' ? (
        <Text style={c.note}>You objected to this inspector. NEXPEC will blind-match a replacement and present a new dossier here.</Text>
      ) : (
        <Text style={c.note}>Inspector {insp.client_review === 'auto_approved' ? 'auto-approved' : 'approved'}; work can proceed.</Text>
      )}

      <View style={c.sect}>
        <Text style={c.sectLabel}>INSPECTOR IDENTITY</Text>
        {revealed ? (
          <>
            <Text style={c.kv}><Text style={c.k}>Legal name: </Text>{insp.inspector_legal_name}</Text>
            {!!insp.inspector_signature && <Text style={c.kv}><Text style={c.k}>Signature: </Text>{insp.inspector_signature}</Text>}
            <Text style={c.seal}>Released with the admin-confirmed final report for your ASME/API audit file.</Text>
          </>
        ) : (
          <>
            <Text style={c.body}>Held in escrow. The real name and signature are released when the final report is admin-confirmed, giving you an auditable deliverable.</Text>
            <TouchableOpacity style={c.vipBtn} onPress={() => setVipOpen(true)} activeOpacity={0.85}>
              <Ionicons name="diamond" size={14} color="#fbbf24" />
              <Text style={c.vipBtnTxt}>Unlock named disclosure (VIP)</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      <VipDisclosureGate
        open={vipOpen}
        onClose={() => setVipOpen(false)}
        tier={insp.transparency_tier}
        handle={insp.handle}
        onRequest={async () => {
          const { data, error } = await requestNamedDisclosure(dealId);
          if (error) return { error: error.message };
          const r = data as { agreement_id?: string; fee_cents?: number; currency?: string; body_md?: string | null; revealed?: boolean };
          if (r?.revealed) { load(); return { error: 'Identity already disclosed for this deal.' }; }
          return { agreementId: r.agreement_id ?? '', feeCents: r.fee_cents ?? 0, currency: r.currency ?? 'USD', bodyMd: r.body_md ?? null };
        }}
        onSign={async (id, nm) => { const { error } = await signAgreement(id, nm); return { error }; }}
        onUnlocked={() => load()}
      />
    </View>
  );
}

// ── Milestone funding (Schedule B): fund the 70% balance at FAT-readiness + raise an NCR ──
function MilestoneFundingCard({ dealId }: { dealId: string }) {
  const [deal, setDeal] = useState<DealRow | null>(null);
  const [sched, setSched] = useState<PaymentTranche[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showNcr, setShowNcr] = useState(false);
  const [citation, setCitation] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([fetchDealById(dealId), fetchPaymentSchedule(dealId)])
      .then(([d, sc]) => { setDeal(d); setSched(sc); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dealId]);
  useEffect(() => { load(); }, [load]);

  const fundBalance = async () => {
    setBusy('fund'); setErr(null);
    const { error } = await fundDealBalance(dealId);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    load();
  };
  const submitNcr = async () => {
    setBusy('ncr'); setErr(null);
    const { error } = await raiseNonconformance(dealId, 'goods', citation.trim());
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setShowNcr(false); setCitation(''); load();
  };

  if (loading) return <View style={c.card}><ActivityIndicator color={T.colors.primary} /></View>;
  if (!deal) return null;
  const balanceDue = !!deal.deposit_funded_at && !deal.balance_funded_at;

  return (
    <View style={c.wrap}>
      <View style={c.head}>
        <Ionicons name="wallet" size={16} color={T.colors.primaryLight} />
        <Text style={c.title}>Payment schedule</Text>
      </View>
      <View style={c.pillRow}>
        <Text style={[c.pill, { color: deal.deposit_funded_at ? T.colors.success : T.colors.textMuted, borderColor: deal.deposit_funded_at ? T.colors.success : T.colors.inputBorder }]}>Deposit 30% {deal.deposit_funded_at ? 'funded' : 'due'}</Text>
        <Text style={[c.pill, { color: deal.balance_funded_at ? T.colors.success : T.colors.primaryLight, borderColor: deal.balance_funded_at ? T.colors.success : T.colors.primaryLight }]}>Balance 70% {deal.balance_funded_at ? 'funded' : 'due at FAT'}</Text>
      </View>

      {sched.length > 0 && (
        <View style={c.sect}>
          {sched.map((t) => (
            <View key={t.id} style={c.schedRow}>
              <Text style={c.schedLabel}>{t.label} ({Math.round(t.pct_bps / 100)}%)</Text>
              <Text style={c.schedAmt}>{formatUsd(t.amount_cents)}</Text>
            </View>
          ))}
        </View>
      )}

      {balanceDue && (
        <TouchableOpacity style={[c.fundBtn, busy === 'fund' && { opacity: 0.6 }]} disabled={busy === 'fund'} onPress={fundBalance} activeOpacity={0.85}>
          <Ionicons name="wallet" size={15} color="#fff" />
          <Text style={c.fundTxt}>{busy === 'fund' ? 'Funding…' : `Fund 70% balance (${formatUsd(Math.round(deal.client_price_cents * 0.7))})`}</Text>
        </TouchableOpacity>
      )}

      {showNcr ? (
        <View style={{ gap: 8 }}>
          <TextInput value={citation} onChangeText={setCitation} placeholder="Cite the specific Schedule A spec or ASME/API code deviation (min 20 chars)" placeholderTextColor={T.colors.textMuted} multiline style={c.objInput} />
          <View style={c.btnRow}>
            <TouchableOpacity style={[c.objectBtn, busy === 'ncr' && { opacity: 0.6 }]} disabled={busy === 'ncr'} onPress={submitNcr} activeOpacity={0.85}>
              <Ionicons name="warning" size={15} color={T.colors.error} />
              <Text style={c.objectTxt}>{busy === 'ncr' ? 'Submitting…' : 'Submit NCR'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={c.objectBtn} onPress={() => { setShowNcr(false); setCitation(''); }} activeOpacity={0.85}>
              <Text style={c.objectTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={c.ncrBtn} onPress={() => setShowNcr(true)} activeOpacity={0.85}>
          <Ionicons name="warning-outline" size={15} color={T.colors.error} />
          <Text style={c.objectTxt}>Report a non-conformance</Text>
        </TouchableOpacity>
      )}
      {!!err && <Text style={c.err}>{err}</Text>}
      <Text style={c.seal}>Silence for 10 business days after delivery is irrevocable acceptance and authorises release. A rejection must cite a specific Schedule A spec or ASME/API code deviation.</Text>
    </View>
  );
}

// ── Client selection: blinded A/B/C shortlist (client/agency picks the winner) ──
function InspectorShortlistCard({ dealId }: { dealId: string }) {
  const [cands, setCands] = useState<InspectorCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [vip, setVip] = useState<{ handle: string; tier: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchInspectorShortlist(dealId).then(setCands).catch(() => setCands([])).finally(() => setLoading(false));
  }, [dealId]);
  useEffect(() => { load(); }, [load]);

  const offered = cands.filter((x) => x.status === 'offered');
  const hasSelection = cands.some((x) => x.status === 'selected');
  if (loading || offered.length === 0 || hasSelection) return null;  // once selected, AssignedInspectorCard takes over

  const pick = async (candidateId: string) => {
    setBusy(candidateId); setErr(null);
    const { error } = await selectInspector(dealId, candidateId);
    setBusy(null);
    if (error) { setErr(error.message); return; }
    load();
  };

  return (
    <View style={c.wrap}>
      <View style={c.head}>
        <Ionicons name="people" size={16} color={T.colors.primaryLight} />
        <Text style={c.title}>Choose your inspector</Text>
      </View>
      <Text style={c.body}>NEXPEC shortlisted credential-verified, independent inspectors for your scope. Pick one; their identity is revealed on the admin-confirmed final report.</Text>
      {!!err && <Text style={c.err}>{err}</Text>}
      {offered.map((cd) => (
        <View key={cd.candidate_id} style={{ gap: 10 }}>
          <CredentialCertificate
            slot={cd.slot}
            data={{
              handle: cd.handle,
              competencies: cd.dossier?.competencies ?? [],
              certifications: cd.dossier?.certifications ?? [],
              region: cd.dossier?.region ?? null,
              scope: cd.dossier?.scope ?? null,
              tier: cd.transparency_tier,
              statement: cd.certificate?.statement ?? null,
              eoPolicyRef: cd.certificate?.eo_policy_ref ?? null,
              redactedCv: cd.dossier?.redacted_cv ?? null,
            }}
            onReveal={() => setVip({ handle: cd.handle, tier: cd.transparency_tier })}
          />
          <NeutralityBadge statement={cd.independence?.statement} supplierHandle={cd.independence?.supplier_handle} />
          <TouchableOpacity style={[c.fundBtn, !!busy && { opacity: 0.6 }]} disabled={!!busy} onPress={() => pick(cd.candidate_id)} activeOpacity={0.85}>
            <Ionicons name="checkmark-circle" size={15} color="#fff" />
            <Text style={c.fundTxt}>{busy === cd.candidate_id ? 'Selecting…' : `Select Option ${cd.slot}`}</Text>
          </TouchableOpacity>
        </View>
      ))}
      <VipDisclosureGate open={!!vip} onClose={() => setVip(null)} tier={vip?.tier ?? ''} handle={vip?.handle ?? ''} />
    </View>
  );
}

const c = StyleSheet.create({
  card: { backgroundColor: T.colors.cardBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.lg, padding: T.spacing.md, marginTop: 16 },
  candHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  slotChip: { color: T.colors.primaryLight, fontSize: 11, fontWeight: '800', backgroundColor: T.colors.inputBackground, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  schedRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  schedLabel: { color: T.colors.textSecondary, fontSize: 12, flex: 1 },
  schedAmt: { color: T.colors.text, fontSize: 12, fontWeight: '700' },
  fundBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: 12 },
  fundTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  ncrBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderColor: T.colors.error, borderWidth: 1, borderRadius: T.borderRadius.md, paddingVertical: 11 },
  wrap: { backgroundColor: T.colors.cardBackground, borderColor: T.colors.primary, borderWidth: 1, borderRadius: T.borderRadius.lg, padding: T.spacing.md, marginTop: 16, gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: T.colors.text, fontSize: 15, fontWeight: '800', flex: 1 },
  handle: { color: T.colors.primaryLight, fontSize: 13, fontWeight: '700' },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', overflow: 'hidden' },
  sect: { backgroundColor: T.colors.inputBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, padding: 12, gap: 4 },
  sectLabel: { color: T.colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginBottom: 2 },
  cv: { color: T.colors.text, fontSize: 13, fontStyle: 'italic', marginBottom: 4 },
  kv: { color: T.colors.text, fontSize: 13, lineHeight: 19 },
  k: { color: T.colors.textMuted },
  body: { color: T.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  seal: { color: T.colors.textMuted, fontSize: 11, marginTop: 4 },
  h: { color: T.colors.text, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  objInput: { backgroundColor: T.colors.background, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, color: T.colors.text, padding: 10, fontSize: 13, marginTop: 8, minHeight: 64, textAlignVertical: 'top' },
  err: { color: T.colors.error, fontSize: 13, marginTop: 8 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.colors.success, borderRadius: T.borderRadius.md, paddingHorizontal: 14, paddingVertical: 10 },
  approveTxt: { color: '#0b0b0f', fontWeight: '800', fontSize: 13 },
  objectBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderColor: T.colors.error, borderWidth: 1, borderRadius: T.borderRadius.md, paddingHorizontal: 14, paddingVertical: 10 },
  objectTxt: { color: T.colors.error, fontWeight: '800', fontSize: 13 },
  note: { color: T.colors.textSecondary, fontSize: 13, lineHeight: 19, padding: 12, backgroundColor: T.colors.inputBackground, borderRadius: T.borderRadius.md },
  vipBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 10, borderWidth: 1, borderColor: 'rgba(251,191,36,0.4)', backgroundColor: 'rgba(251,191,36,0.10)', borderRadius: T.borderRadius.md, paddingHorizontal: 12, paddingVertical: 9 },
  vipBtnTxt: { color: '#fbbf24', fontSize: 12, fontWeight: '800' },
});
