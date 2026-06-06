// src/components/contracts/CommercialRevision.tsx — mobile Commercial Revision Ledger
//   (party side; NEXPEC arbitration is web-only). A formal, sealed price-revision
//   docket — request / respond to counter / withdraw + the audit timeline.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NEXPEC_THEME as T } from '../DynamicForm/theme';
import { formatUsd } from '../../core/utils/money';
import {
  fetchRevisionForAgreement, fetchRevisionEvents, requestPriceRevision, respondToCounter, withdrawRevision,
  REVISION_REASONS, type Revision, type RevisionEvent,
} from '../../hooks/useSupplierEcosystem';

const usd = (c: number | null | undefined) => (c == null ? '—' : formatUsd(c));
const STATUS_COLOR: Record<string, string> = {
  requested: '#fbbf24', countered: T.colors.primaryLight, applied: T.colors.success, rejected: T.colors.error, withdrawn: T.colors.textMuted,
};
const ACTION_LABEL: Record<string, string> = {
  propose: 'Proposed', counter: 'NEXPEC countered', accept: 'Accepted', reject: 'Declined', withdraw: 'Withdrawn', apply: 'Contract superseded',
};
const REASON_KEYS = Object.keys(REVISION_REASONS);

export function CommercialRevision({ agreementId, currency = 'USD' }: { agreementId: string; currency?: string }) {
  const [rev, setRev] = useState<Revision | null>(null);
  const [events, setEvents] = useState<RevisionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'idle' | 'request' | 'counter'>('idle');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('scope_change');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetchRevisionForAgreement(agreementId);
    setRev(r);
    setEvents(r ? await fetchRevisionEvents(r.id) : []);
    setLoading(false);
  }, [agreementId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={s.card}><ActivityIndicator color={T.colors.primary} /></View>;

  const cents = () => Math.round(parseFloat(amount || '0') * 100);
  const open = rev && (rev.status === 'requested' || rev.status === 'countered');
  const run = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(key); setErr(null);
    const { error } = await fn();
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setMode('idle'); setAmount(''); setNote(''); await load();
  };

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <View style={s.headLeft}><Ionicons name="swap-horizontal" size={16} color={T.colors.primaryLight} /><Text style={s.title}>Commercial revision</Text></View>
        {!!rev && <Text style={[s.statusPill, { color: STATUS_COLOR[rev.status], borderColor: STATUS_COLOR[rev.status] }]}>{rev.status}</Text>}
      </View>

      {!open && mode !== 'request' && (
        <>
          <Text style={s.body}>Request a formal, reason-coded price revision. NEXPEC reviews and may accept, decline, or counter — every step is a sealed record.</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => setMode('request')} activeOpacity={0.85}>
            <Ionicons name="document-text-outline" size={15} color="#fff" /><Text style={s.primaryTxt}>Request a revision</Text>
          </TouchableOpacity>
        </>
      )}

      {mode === 'request' && (
        <View style={s.form}>
          <Text style={s.label}>Proposed amount ({currency})</Text>
          <TextInput value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" placeholderTextColor={T.colors.textMuted} style={s.input} />
          <Text style={s.label}>Reason</Text>
          <View style={s.chipRow}>
            {REASON_KEYS.map((k) => (
              <TouchableOpacity key={k} onPress={() => setReason(k)} style={[s.chip, reason === k && s.chipOn]} activeOpacity={0.8}>
                <Text style={[s.chipTxt, reason === k && s.chipTxtOn]}>{REVISION_REASONS[k]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.label}>Formal justification</Text>
          <TextInput value={note} onChangeText={setNote} placeholder="State the specific, substantive basis (min 20 characters)." placeholderTextColor={T.colors.textMuted} multiline style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} />
          {!!err && <Text style={s.err}>{err}</Text>}
          <View style={s.btnRow}>
            <TouchableOpacity style={[s.primaryBtn, { flex: 1 }, (busy === 'req' || !amount.trim() || note.trim().length < 20) && { opacity: 0.6 }]} disabled={busy === 'req' || !amount.trim() || note.trim().length < 20} onPress={() => run('req', () => requestPriceRevision(agreementId, cents(), reason, note.trim()))} activeOpacity={0.85}>
              <Ionicons name="shield-checkmark" size={15} color="#fff" /><Text style={s.primaryTxt}>Submit sealed request</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.ghostBtn} onPress={() => { setMode('idle'); setErr(null); }} activeOpacity={0.85}><Text style={s.ghostTxt}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      )}

      {!!rev && rev.status === 'requested' && (
        <View style={[s.banner, { borderColor: 'rgba(251,191,36,0.3)', backgroundColor: 'rgba(251,191,36,0.07)' }]}>
          <Text style={s.bannerTxt}>Submitted ({usd(rev.proposed_amount_cents)}) — awaiting NEXPEC review.</Text>
          <TouchableOpacity disabled={busy === 'wd'} onPress={() => run('wd', () => withdrawRevision(rev.id))}><Text style={s.linkTxt}>Withdraw</Text></TouchableOpacity>
        </View>
      )}

      {!!rev && rev.status === 'countered' && mode !== 'counter' && (
        <View style={[s.banner, { flexDirection: 'column', alignItems: 'stretch', borderColor: T.colors.primary, backgroundColor: T.colors.inputBackground }]}>
          <Text style={s.bannerTxt}>NEXPEC countered at <Text style={s.strong}>{usd(rev.counter_amount_cents)}</Text> (your proposal: {usd(rev.proposed_amount_cents)}).</Text>
          {!!err && <Text style={s.err}>{err}</Text>}
          <View style={[s.btnRow, { marginTop: 10, flexWrap: 'wrap' }]}>
            <TouchableOpacity style={[s.approveBtn, !!busy && { opacity: 0.6 }]} disabled={!!busy} onPress={() => run('acc', () => respondToCounter(rev.id, 'accept'))} activeOpacity={0.85}><Ionicons name="checkmark-circle" size={15} color="#0b0b0f" /><Text style={s.approveTxt}>Accept</Text></TouchableOpacity>
            <TouchableOpacity style={s.counterBtn} disabled={!!busy} onPress={() => setMode('counter')} activeOpacity={0.85}><Ionicons name="arrow-forward" size={15} color={T.colors.primaryLight} /><Text style={s.counterTxt}>Counter</Text></TouchableOpacity>
            <TouchableOpacity style={s.declineBtn} disabled={!!busy} onPress={() => run('dec', () => respondToCounter(rev.id, 'reject'))} activeOpacity={0.85}><Ionicons name="close-circle" size={15} color={T.colors.error} /><Text style={s.declineTxt}>Decline</Text></TouchableOpacity>
          </View>
        </View>
      )}

      {!!rev && rev.status === 'countered' && mode === 'counter' && (
        <View style={s.form}>
          <Text style={s.label}>Your counter-proposal ({currency})</Text>
          <TextInput value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" placeholderTextColor={T.colors.textMuted} style={s.input} />
          <TextInput value={note} onChangeText={setNote} placeholder="Optional note for the record." placeholderTextColor={T.colors.textMuted} style={s.input} />
          {!!err && <Text style={s.err}>{err}</Text>}
          <View style={s.btnRow}>
            <TouchableOpacity style={[s.primaryBtn, { flex: 1 }, (busy === 'cb' || !amount.trim()) && { opacity: 0.6 }]} disabled={busy === 'cb' || !amount.trim()} onPress={() => run('cb', () => respondToCounter(rev.id, 'counter', cents(), note.trim() || undefined))} activeOpacity={0.85}><Ionicons name="shield-checkmark" size={15} color="#fff" /><Text style={s.primaryTxt}>Send counter</Text></TouchableOpacity>
            <TouchableOpacity style={s.ghostBtn} onPress={() => { setMode('idle'); setErr(null); }} activeOpacity={0.85}><Text style={s.ghostTxt}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      )}

      {!!rev && rev.status === 'applied' && (
        <View style={[s.banner, { borderColor: 'rgba(34,197,94,0.3)', backgroundColor: 'rgba(34,197,94,0.07)' }]}>
          <Text style={s.bannerTxt}>Revision applied at <Text style={s.strong}>{usd(rev.agreed_amount_cents)}</Text>; a superseding contract was issued and sealed.</Text>
        </View>
      )}

      {events.length > 0 && (
        <View style={{ marginTop: 10, gap: 8 }}>
          {events.map((e) => (
            <View key={e.id} style={s.event}>
              <View style={[s.eventDot, { backgroundColor: e.actor_role === 'nexpec' ? 'rgba(124,58,237,0.18)' : T.colors.inputBackground }]}>
                <Ionicons name={e.action === 'apply' ? 'hammer' : e.action === 'counter' ? 'arrow-forward' : e.action === 'reject' ? 'close' : e.action === 'accept' ? 'checkmark' : e.action === 'withdraw' ? 'arrow-undo' : 'document-text'} size={12} color={e.actor_role === 'nexpec' ? T.colors.primaryLight : T.colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.eventHead}>
                  <Text style={s.eventTitle}>{ACTION_LABEL[e.action] ?? e.action}{e.amount_cents != null ? `  ${usd(e.amount_cents)}` : ''}</Text>
                  <Text style={s.eventTime}>{new Date(e.created_at).toLocaleDateString()}</Text>
                </View>
                {!!e.reason_code && <Text style={s.eventReason}>{REVISION_REASONS[e.reason_code] ?? e.reason_code}</Text>}
                {!!e.note && <Text style={s.eventNote}>{e.note}</Text>}
                {!!e.content_sha256 && <Text style={s.sealTxt}>sealed:{e.content_sha256.slice(0, 16)}…</Text>}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: T.colors.cardBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.lg, padding: T.spacing.md, marginTop: 16 },
  wrap: { backgroundColor: T.colors.cardBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.lg, padding: T.spacing.md, marginTop: 16, gap: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: T.colors.text, fontSize: 15, fontWeight: '800' },
  statusPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontSize: 10, fontWeight: '800', textTransform: 'capitalize', overflow: 'hidden' },
  body: { color: T.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: 11, paddingHorizontal: 14, alignSelf: 'flex-start' },
  primaryTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  ghostBtn: { borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: T.borderRadius.md, paddingVertical: 11, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  ghostTxt: { color: T.colors.textSecondary, fontWeight: '700', fontSize: 13 },
  form: { gap: 8, backgroundColor: T.colors.inputBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, padding: 12 },
  label: { color: T.colors.textSecondary, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: T.colors.background, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, color: T.colors.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { borderColor: T.colors.primary, backgroundColor: 'rgba(124,58,237,0.12)' },
  chipTxt: { color: T.colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTxtOn: { color: T.colors.primaryLight },
  btnRow: { flexDirection: 'row', gap: 8 },
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderRadius: T.borderRadius.md, padding: 12 },
  bannerTxt: { color: T.colors.text, fontSize: 13, lineHeight: 19, flex: 1 },
  strong: { fontWeight: '800', color: T.colors.text },
  linkTxt: { color: T.colors.textSecondary, fontSize: 12, fontWeight: '700' },
  err: { color: T.colors.error, fontSize: 13 },
  approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: T.colors.success, borderRadius: T.borderRadius.md, paddingHorizontal: 14, paddingVertical: 10 },
  approveTxt: { color: '#0b0b0f', fontWeight: '800', fontSize: 13 },
  counterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingHorizontal: 14, paddingVertical: 10 },
  counterTxt: { color: T.colors.primaryLight, fontWeight: '800', fontSize: 13 },
  declineBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: T.colors.error, borderRadius: T.borderRadius.md, paddingHorizontal: 14, paddingVertical: 10 },
  declineTxt: { color: T.colors.error, fontWeight: '800', fontSize: 13 },
  event: { flexDirection: 'row', gap: 10, borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: T.borderRadius.md, padding: 10 },
  eventDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  eventHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eventTitle: { color: T.colors.text, fontSize: 13, fontWeight: '700', flex: 1 },
  eventTime: { color: T.colors.textMuted, fontSize: 11 },
  eventReason: { color: T.colors.textMuted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  eventNote: { color: T.colors.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 3 },
  sealTxt: { color: T.colors.textMuted, fontSize: 10, marginTop: 3 },
});
