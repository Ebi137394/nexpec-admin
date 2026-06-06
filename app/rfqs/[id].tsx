// app/rfqs/[id].tsx — role-aware RFQ detail (mirrors web /rfqs/[id]).
//   CLIENT (owner): sees ONLY admin-curated offers (marked-up price + NX- handle);
//     the raw supplier price is unreachable (RLS + offers view). Accept = award.
//   SUPPLIER: sees their OWN bid (raw, their own number) + submit form.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StatusBar, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { useRfqDetail, submitQuote, awardAndDispatch, type ClientOffer } from '../../src/hooks/useSupplierEcosystem';
import { toCents, formatUsd } from '../../src/core/utils/money';

const BID_STATUS: Record<string, string> = {
  submitted: 'Under NEXPEC review', shortlisted: 'Shortlisted', presented: 'With the client',
  accepted: 'Awarded', declined: 'Not selected', withdrawn: 'Withdrawn',
};

export default function RfqDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { rfq, offers, myQuote, isOwner, loading, refetch } = useRfqDetail(id);

  const [amount, setAmount] = useState('');
  const [lead, setLead] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [awarding, setAwarding] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const awardable = !!rfq && (rfq.status === 'open' || rfq.status === 'quoted') && !rfq.spawned_job_id;

  const doSubmit = async () => {
    if (amount.trim() === '') { Alert.alert('Enter a quote amount'); return; }
    setBusy(true);
    try {
      const quote: any = { amount_cents: toCents(amount) };
      if (lead.trim()) quote.lead_time = lead.trim();
      if (note.trim()) quote.note = note.trim();
      const { error } = await submitQuote(id!, quote);
      if (error) { Alert.alert('Could not submit', error.message); return; }
      setAmount(''); setLead(''); setNote('');
      await refetch();
      Alert.alert('Quote submitted', 'NEXPEC will review your bid and broker the award.');
    } finally { setBusy(false); }
  };

  const doAccept = (offer: ClientOffer) => {
    Alert.alert('Accept this offer?', 'You will review and sign the NEXPEC supply agreement, then we hold your payment in escrow and dispatch the inspection.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Review & sign', style: 'default', onPress: async () => {
        setAwarding(offer.id);
        try {
          const { data, error } = await awardAndDispatch(offer.id);
          if (error) { Alert.alert('Could not proceed', error.message); return; }
          const dealId = (data as { deal_id?: string } | null)?.deal_id;
          if (dealId) { router.push(`/deals/${dealId}/sign` as any); return; }
          await refetch();
        } finally { setAwarding(null); }
      } }]);
  };

  if (loading || !rfq) {
    return <SafeAreaView style={s.root} edges={['top']}><View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>RFQ</Text>
        <View style={{ width: 32 }} />
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={s.rfqTitle}>{rfq.title}</Text>
        {!!rfq.spec?.details && <Text style={s.rfqDetails}>{rfq.spec.details}</Text>}
        <View style={s.metaRow}>
          {!!rfq.spec?.quantity && <View style={s.tag}><Ionicons name="cube-outline" size={11} color={T.colors.textMuted} /><Text style={s.tagTxt}>{rfq.spec.quantity}</Text></View>}
          <View style={s.tag}><Ionicons name="pricetag-outline" size={11} color={T.colors.textMuted} /><Text style={s.tagTxt}>{rfq.status}</Text></View>
          {rfq.requires_source_inspection && <View style={[s.tag, { borderColor: T.colors.primary }]}><Ionicons name="shield-checkmark-outline" size={11} color={T.colors.primaryLight} /><Text style={[s.tagTxt, { color: T.colors.primaryLight }]}>Source / FAT</Text></View>}
        </View>

        {!!rfq.spawned_job_id && (
          <View style={s.dispatched}>
            <Ionicons name="rocket" size={18} color={T.colors.success} />
            <View style={{ flex: 1 }}>
              <Text style={s.dispatchedTitle}>Inspection dispatched</Text>
              <Text style={s.dispatchedSub}>A source/FAT job is in admin dispatch for the awarded engagement.</Text>
            </View>
          </View>
        )}

        {/* ───────────── SUPPLIER VIEW ───────────── */}
        {!isOwner && (
          <>
            {awardable && (
              <View style={s.bidCard}>
                <Text style={s.bidTitle}>{myQuote ? 'Update your quote' : 'Submit a quote'}</Text>
                <Text style={s.fieldLabel}>Amount (USD)</Text>
                <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="e.g. 4200" placeholderTextColor={T.colors.textMuted} style={s.input} />
                <Text style={s.fieldLabel}>Lead time</Text>
                <TextInput value={lead} onChangeText={setLead} placeholder="e.g. 3 weeks" placeholderTextColor={T.colors.textMuted} style={s.input} />
                <Text style={s.fieldLabel}>Note</Text>
                <TextInput value={note} onChangeText={setNote} placeholder="Compliance, incoterms…" placeholderTextColor={T.colors.textMuted} style={[s.input, s.area]} multiline />
                <TouchableOpacity style={[s.submit, busy && { opacity: 0.6 }]} onPress={doSubmit} disabled={busy} activeOpacity={0.85}>
                  {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={16} color="#fff" />}
                  <Text style={s.submitTxt}>{busy ? 'Submitting…' : myQuote ? 'Resubmit quote' : 'Submit quote'}</Text>
                </TouchableOpacity>
              </View>
            )}
            <Text style={s.section}>Your quote</Text>
            {!myQuote ? <Text style={s.empty}>You haven&rsquo;t quoted yet.</Text> : (
              <View style={s.quoteCard}>
                <View style={s.quoteTop}>
                  <Text style={s.quoteAmount}>{myQuote.quote?.amount_cents != null ? formatUsd(myQuote.quote.amount_cents) : (myQuote.quote?.amount != null ? formatUsd(toCents(myQuote.quote.amount)) : '—')}</Text>
                  <View style={[s.qBadge, { backgroundColor: T.colors.inputBackground }]}>
                    <Text style={[s.qBadgeTxt, { color: T.colors.textSecondary }]}>{BID_STATUS[myQuote.status] ?? myQuote.status}</Text>
                  </View>
                </View>
                {!!myQuote.quote?.lead_time && <Text style={s.quoteMeta}>Lead time {myQuote.quote.lead_time}</Text>}
                {!!myQuote.quote?.note && <Text style={s.quoteNote}>{myQuote.quote.note}</Text>}
              </View>
            )}
            <Text style={s.footnote}>NEXPEC reviews every quote and brokers the award. You&rsquo;ll be notified if yours is selected.</Text>
          </>
        )}

        {/* ───────────── CLIENT (OWNER) VIEW — curated offers only ───────────── */}
        {isOwner && (
          <>
            <Text style={s.section}>Offers</Text>
            {offers.length === 0 ? (
              <View style={s.sourcing}>
                <Ionicons name="hourglass-outline" size={18} color={T.colors.primaryLight} />
                <View style={{ flex: 1 }}>
                  <Text style={s.sourcingTitle}>NEXPEC is sourcing your offer</Text>
                  <Text style={s.sourcingSub}>Our team is reviewing the market and preparing a curated offer for your approval.</Text>
                </View>
              </View>
            ) : offers.map((o) => {
              const won = o.status === 'accepted';
              const label = o.status === 'presented' ? 'Offer ready' : o.status === 'accepted' ? 'Accepted' : 'Closed';
              return (
                <View key={o.id} style={[s.quoteCard, won && { borderColor: T.colors.success }]}>
                  <View style={s.quoteTop}>
                    <Text style={s.quoteAmount}>{o.price_cents != null ? formatUsd(o.price_cents) : '—'}</Text>
                    <View style={[s.qBadge, won ? { backgroundColor: 'rgba(16,185,129,0.16)' } : { backgroundColor: 'rgba(124,58,237,0.16)' }]}>
                      <Text style={[s.qBadgeTxt, { color: won ? T.colors.success : T.colors.primaryLight }]}>{label}</Text>
                    </View>
                  </View>
                  <View style={s.offerMetaRow}>
                    {!!o.supplier_handle && <Text style={s.offerHandle}>{o.supplier_handle}</Text>}
                    {!!o.lead_time && <Text style={s.quoteMeta}>Lead time {o.lead_time}</Text>}
                  </View>
                  {o.status === 'presented' && awardable && (
                    <TouchableOpacity style={[s.awardBtn, awarding === o.id && { opacity: 0.6 }]} onPress={() => doAccept(o)} disabled={!!awarding} activeOpacity={0.85}>
                      {awarding === o.id ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="ribbon-outline" size={16} color="#fff" />}
                      <Text style={s.awardTxt}>{awarding === o.id ? 'Processing…' : 'Accept & proceed'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
            <Text style={s.footnote}>Pricing is brokered by NEXPEC. Accepting an offer authorizes us to proceed and (where required) dispatch a source/FAT inspection.</Text>
          </>
        )}
        <View style={{ height: 28 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.sm, paddingBottom: T.spacing.md, borderBottomWidth: 1, borderBottomColor: T.colors.inputBorder },
  back: { padding: 4, marginLeft: -4 },
  title: { color: T.colors.text, fontSize: T.fontSize.lg, fontWeight: '700' },
  content: { padding: T.spacing.lg },
  rfqTitle: { color: T.colors.text, fontSize: T.fontSize.xl, fontWeight: '700' },
  rfqDetails: { color: T.colors.textSecondary, fontSize: T.fontSize.sm, marginTop: 8, lineHeight: 20 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: T.borderRadius.full, paddingHorizontal: 8, paddingVertical: 3 },
  tagTxt: { color: T.colors.textSecondary, fontSize: 10, fontWeight: '600' },
  dispatched: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: T.spacing.md, marginTop: T.spacing.md, backgroundColor: 'rgba(16,185,129,0.10)', borderWidth: 1, borderColor: T.colors.success, borderRadius: T.borderRadius.lg },
  dispatchedTitle: { color: T.colors.success, fontSize: T.fontSize.sm, fontWeight: '700' },
  dispatchedSub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 2, lineHeight: 16 },
  sourcing: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: T.spacing.md, backgroundColor: T.colors.cardBackground, borderWidth: 1, borderColor: T.colors.inputBorder, borderRadius: T.borderRadius.lg },
  sourcingTitle: { color: T.colors.text, fontSize: T.fontSize.sm, fontWeight: '700' },
  sourcingSub: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, marginTop: 2, lineHeight: 16 },
  bidCard: { padding: T.spacing.md, marginTop: T.spacing.lg, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  bidTitle: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700', marginBottom: T.spacing.sm },
  fieldLabel: { color: T.colors.textSecondary, fontSize: T.fontSize.xs, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: T.colors.inputBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.md, paddingHorizontal: 12, paddingVertical: 12, color: T.colors.text, fontSize: T.fontSize.sm },
  area: { minHeight: 70, textAlignVertical: 'top' },
  submit: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: T.spacing.md, marginTop: T.spacing.md },
  submitTxt: { color: '#fff', fontSize: T.fontSize.sm, fontWeight: '700' },
  section: { color: T.colors.text, fontSize: T.fontSize.md, fontWeight: '700', marginTop: T.spacing.xl, marginBottom: T.spacing.sm },
  empty: { color: T.colors.textMuted, fontSize: T.fontSize.sm, paddingVertical: 12 },
  footnote: { color: T.colors.textMuted, fontSize: T.fontSize.xs, marginTop: 12, lineHeight: 16 },
  quoteCard: { padding: T.spacing.md, marginBottom: 10, backgroundColor: T.colors.cardBackground, borderRadius: T.borderRadius.lg, borderWidth: 1, borderColor: T.colors.inputBorder },
  quoteTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quoteAmount: { color: T.colors.text, fontSize: T.fontSize.lg, fontWeight: '800' },
  qBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: T.borderRadius.full },
  qBadgeTxt: { fontSize: 10, fontWeight: '700' },
  quoteMeta: { color: T.colors.textSecondary, fontSize: T.fontSize.xs },
  quoteNote: { color: T.colors.textSecondary, fontSize: T.fontSize.sm, marginTop: 6, lineHeight: 18 },
  offerMetaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 6 },
  offerHandle: { color: T.colors.primaryLight, fontSize: T.fontSize.xs, fontWeight: '700' },
  awardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: T.colors.primary, borderRadius: T.borderRadius.md, paddingVertical: T.spacing.md, marginTop: T.spacing.md },
  awardTxt: { color: '#fff', fontSize: T.fontSize.sm, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
