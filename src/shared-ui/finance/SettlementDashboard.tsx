// ════════════════════════════════════════════════════════════════════════════
//  SettlementDashboard — the buyer's Finance home (Client / Agency / Enterprise)
//
//  NEXPEC v1 settles manually, so the buyer's financial questions are:
//    "What is my total committed value? What have I paid? What is NEXPEC
//     still confirming? What remains outstanding — and on which job?"
//
//  Everything here is real data from two role-scoped secure views:
//    my_job_settlement_view  (per-job totals; buyer side ONLY — no payout,
//                             no spread, enforced and pgTAP-proven)
//    my_settlement_activity  (the buyer's own payment records)
//
//  There is deliberately no "wallet", no "balance", no "deposit" here: in the
//  manual model a buyer does not hold money inside NEXPEC. When online card
//  payment ships, the card rail reappears via the flag — this dashboard stays.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#0F172A', border: '#1F2937', text: '#F1F5F9', sub: '#94A3B8', mut: '#64748B',
  green: '#10B981', amber: '#F59E0B', red: '#EF4444', violet: '#8B5CF6', blue: '#3B82F6',
};

type SettlementRow = {
  job_id: string; title: string; job_status: string;
  total_cents: number; paid_cents: number; pending_cents: number;
  outstanding_cents: number; settlement_status: string; last_payment_on: string | null;
};
type ActivityRow = {
  id: string; job_title: string; amount_cents: number; method: string;
  reference: string | null; status: string; paid_on: string | null; recorded_at: string;
};

const usd = (cents: number) =>
  `$${(Math.abs(Number(cents || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_META: Record<string, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  payment_required:      { label: 'Payment required',      color: C.amber,  icon: 'alert-circle-outline' },
  awaiting_confirmation: { label: 'Awaiting confirmation', color: C.blue,   icon: 'time-outline' },
  part_paid:             { label: 'Partially paid',        color: C.violet, icon: 'pie-chart-outline' },
  paid:                  { label: 'Paid',                  color: C.green,  icon: 'checkmark-circle-outline' },
  not_priced:            { label: 'Not priced yet',        color: C.mut,    icon: 'ellipse-outline' },
};

export function SettlementDashboard({ t }: { t: (s: string) => string }) {
  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);

  const load = useCallback(async () => {
    const [{ data: s }, { data: a }] = await Promise.all([
      supabase.from('my_job_settlement_view').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('my_settlement_activity').select('*').eq('direction', 'client_payment')
        .order('recorded_at', { ascending: false }).limit(10),
    ]);
    setRows((s as SettlementRow[]) ?? []);
    setActivity((a as ActivityRow[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (rows === null) {
    return <View style={s.center}><ActivityIndicator color={C.violet} /></View>;
  }

  const priced = rows.filter((r) => Number(r.total_cents) > 0);
  const total = priced.reduce((n, r) => n + Number(r.total_cents), 0);
  const paid = priced.reduce((n, r) => n + Number(r.paid_cents), 0);
  const pending = priced.reduce((n, r) => n + Number(r.pending_cents), 0);
  const outstanding = priced.reduce((n, r) => n + Number(r.outstanding_cents), 0);
  const open = priced.filter((r) => r.settlement_status !== 'paid');

  return (
    <View>
      {/* ── summary ── */}
      <View style={s.cardsRow}>
        <SummaryCard icon="briefcase-outline" color={C.violet} label={t('Contract value')} value={usd(total)} />
        <SummaryCard icon="checkmark-done-outline" color={C.green} label={t('Paid')} value={usd(paid)} />
      </View>
      <View style={s.cardsRow}>
        <SummaryCard icon="time-outline" color={C.blue} label={t('Awaiting confirmation')} value={usd(pending)} />
        <SummaryCard icon="alert-circle-outline" color={outstanding > 0 ? C.amber : C.mut} label={t('Outstanding')} value={usd(outstanding)} />
      </View>

      {/* ── how settlement works: first-class, not an apology ── */}
      <View style={s.explainer}>
        <Ionicons name="business-outline" size={16} color={C.sub} />
        <Text style={s.explainerText}>
          {t('NEXPEC settles by bank transfer / invoice. Once your payment is received, our team confirms it here and your engagement continues automatically.')}
        </Text>
      </View>

      {/* ── per-job settlement ── */}
      {open.length > 0 && (
        <>
          <Text style={s.section}>{t('OPEN SETTLEMENTS')}</Text>
          {open.map((r) => {
            const meta = STATUS_META[r.settlement_status] ?? STATUS_META.not_priced;
            return (
              <View key={r.job_id} style={s.jobCard}>
                <View style={s.jobHead}>
                  <Text style={s.jobTitle} numberOfLines={1}>{r.title}</Text>
                  <View style={[s.chip, { borderColor: meta.color }]}>
                    <Ionicons name={meta.icon} size={11} color={meta.color} />
                    <Text style={[s.chipText, { color: meta.color }]}>{t(meta.label)}</Text>
                  </View>
                </View>
                <View style={s.jobAmounts}>
                  <JobAmount label={t('Total')} value={usd(Number(r.total_cents))} />
                  <JobAmount label={t('Paid')} value={usd(Number(r.paid_cents))} color={C.green} />
                  <JobAmount label={t('Outstanding')} value={usd(Number(r.outstanding_cents))} color={Number(r.outstanding_cents) > 0 ? C.amber : C.mut} />
                </View>
              </View>
            );
          })}
        </>
      )}

      {/* ── payment history ── */}
      <Text style={s.section}>{t('PAYMENT HISTORY')}</Text>
      {activity.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="receipt-outline" size={28} color={C.mut} />
          <Text style={s.emptyText}>{t('Payments you make to NEXPEC will appear here once recorded.')}</Text>
        </View>
      ) : (
        activity.map((a) => (
          <View key={a.id} style={s.txRow}>
            <View style={[s.txIcon, { backgroundColor: a.status === 'paid_manually' ? 'rgba(16,185,129,0.12)' : 'rgba(59,130,246,0.12)' }]}>
              <Ionicons name={a.status === 'paid_manually' ? 'checkmark-outline' : 'time-outline'} size={15}
                        color={a.status === 'paid_manually' ? C.green : C.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.txTitle} numberOfLines={1}>{a.job_title}</Text>
              <Text style={s.txSub} numberOfLines={1}>
                {a.method.replace('_', ' ')}{a.reference ? ` · ${a.reference}` : ''}
                {a.paid_on ? ` · ${a.paid_on}` : ''}
              </Text>
            </View>
            <Text style={s.txAmount}>{usd(Number(a.amount_cents))}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function SummaryCard({ icon, color, label, value }: {
  icon: keyof typeof Ionicons.glyphMap; color: string; label: string; value: string;
}) {
  return (
    <View style={s.card}>
      <View style={[s.cardIcon, { backgroundColor: `${color}1F` }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <Text style={s.cardValue}>{value}</Text>
      <Text style={s.cardLabel}>{label}</Text>
    </View>
  );
}

function JobAmount({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.jobAmountLabel}>{label}</Text>
      <Text style={[s.jobAmountValue, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { paddingVertical: 40, alignItems: 'center' },
  cardsRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  card: { flex: 1, backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 14 },
  cardIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  cardValue: { color: C.text, fontSize: 17, fontWeight: '800' },
  cardLabel: { color: C.sub, fontSize: 11, marginTop: 2 },
  explainer: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: 'rgba(148,163,184,0.06)', borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 6 },
  explainerText: { flex: 1, color: C.sub, fontSize: 12, lineHeight: 17 },
  section: { color: C.mut, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 18, marginBottom: 8 },
  jobCard: { backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 8 },
  jobHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  jobTitle: { flex: 1, color: C.text, fontSize: 14, fontWeight: '700' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 10, fontWeight: '800' },
  jobAmounts: { flexDirection: 'row', gap: 8, marginTop: 10 },
  jobAmountLabel: { color: C.mut, fontSize: 10 },
  jobAmountValue: { color: C.text, fontSize: 13, fontWeight: '700', marginTop: 1 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 24, backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 14 },
  emptyText: { color: C.mut, fontSize: 12, textAlign: 'center', paddingHorizontal: 24 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 6 },
  txIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  txTitle: { color: C.text, fontSize: 13, fontWeight: '600' },
  txSub: { color: C.mut, fontSize: 11, marginTop: 1 },
  txAmount: { color: C.text, fontSize: 13, fontWeight: '800' },
});

export default SettlementDashboard;
