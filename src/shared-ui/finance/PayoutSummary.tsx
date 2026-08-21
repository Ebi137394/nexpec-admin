// ════════════════════════════════════════════════════════════════════════════
//  PayoutSummary — the provider's payout picture (Inspector)
//
//  Answers: "What have I earned? What has NEXPEC paid me? What is still due —
//  and per job, where does each engagement stand?"
//
//  Real data only, from the role-scoped secure views (provider side ONLY —
//  no buyer price, no spread, pgTAP-proven):
//    my_earnings_view        per-job earned / paid / due + payout_status
//    my_settlement_activity  the provider's own payout records
//
//  Payouts are settled manually by the NEXPEC team (bank/Wise) and recorded
//  by an admin — this component states that as the product's model, because
//  it is.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#0F172A', border: '#1F2937', text: '#F1F5F9', sub: '#94A3B8', mut: '#64748B',
  green: '#10B981', amber: '#F59E0B', violet: '#8B5CF6', blue: '#3B82F6',
};

type EarningsRow = {
  job_id: string; title: string; earned_cents: number; paid_cents: number;
  pending_cents: number; due_cents: number; payout_status: string; last_payout_on: string | null;
};
type ActivityRow = {
  id: string; job_title: string; amount_cents: number; method: string;
  reference: string | null; status: string; paid_on: string | null;
};

const usd = (cents: number) =>
  `$${(Math.abs(Number(cents || 0)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_META: Record<string, { label: string; color: string }> = {
  in_progress:      { label: 'In progress',       color: C.blue },
  due:              { label: 'Due',               color: C.amber },
  payout_scheduled: { label: 'Payout scheduled',  color: C.violet },
  part_paid:        { label: 'Partially paid',    color: C.violet },
  paid:             { label: 'Paid',              color: C.green },
  not_set:          { label: '—',                 color: C.mut },
};

export function PayoutSummary({ t }: { t: (s: string) => string }) {
  const [rows, setRows] = useState<EarningsRow[] | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);

  const load = useCallback(async () => {
    const [{ data: e }, { data: a }] = await Promise.all([
      supabase.from('my_earnings_view').select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('my_settlement_activity').select('*').eq('direction', 'inspector_payout')
        .order('recorded_at', { ascending: false }).limit(10),
    ]);
    setRows((e as EarningsRow[]) ?? []);
    setActivity((a as ActivityRow[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (rows === null) return <View style={s.center}><ActivityIndicator color={C.violet} /></View>;

  const priced = rows.filter((r) => Number(r.earned_cents) > 0);
  const earned = priced.reduce((n, r) => n + Number(r.earned_cents), 0);
  const paid = priced.reduce((n, r) => n + Number(r.paid_cents), 0);
  const due = priced.reduce((n, r) => n + Number(r.due_cents), 0);

  return (
    <View>
      <View style={s.cardsRow}>
        <SummaryCard color={C.violet} icon="trending-up-outline" label={t('Earned')} value={usd(earned)} />
        <SummaryCard color={C.green} icon="checkmark-done-outline" label={t('Paid out')} value={usd(paid)} />
        <SummaryCard color={due > 0 ? C.amber : C.mut} icon="hourglass-outline" label={t('Due')} value={usd(due)} />
      </View>

      <View style={s.explainer}>
        <Ionicons name="business-outline" size={16} color={C.sub} />
        <Text style={s.explainerText}>
          {t('Payouts are settled by the NEXPEC team after approval — by bank transfer or Wise — and confirmed here with the date and reference.')}
        </Text>
      </View>

      {priced.length > 0 && (
        <>
          <Text style={s.section}>{t('PER JOB')}</Text>
          {priced.map((r) => {
            const meta = STATUS_META[r.payout_status] ?? STATUS_META.not_set;
            return (
              <View key={r.job_id} style={s.jobRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.jobTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={s.jobSub}>
                    {t('Earned')} {usd(Number(r.earned_cents))} · {t('Paid')} {usd(Number(r.paid_cents))}
                  </Text>
                </View>
                <View style={[s.chip, { borderColor: meta.color }]}>
                  <Text style={[s.chipText, { color: meta.color }]}>{t(meta.label)}</Text>
                </View>
              </View>
            );
          })}
        </>
      )}

      <Text style={s.section}>{t('PAYOUT HISTORY')}</Text>
      {activity.length === 0 ? (
        <View style={s.empty}>
          <Ionicons name="cash-outline" size={26} color={C.mut} />
          <Text style={s.emptyText}>{t('Payouts NEXPEC sends you will appear here with date and reference.')}</Text>
        </View>
      ) : (
        activity.map((a) => (
          <View key={a.id} style={s.txRow}>
            <View style={[s.txIcon, { backgroundColor: 'rgba(16,185,129,0.12)' }]}>
              <Ionicons name="arrow-down-outline" size={15} color={C.green} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.txTitle} numberOfLines={1}>{a.job_title}</Text>
              <Text style={s.txSub} numberOfLines={1}>
                {a.method.replace('_', ' ')}{a.reference ? ` · ${a.reference}` : ''}{a.paid_on ? ` · ${a.paid_on}` : ''}
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
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <Text style={s.cardValue}>{value}</Text>
      <Text style={s.cardLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { paddingVertical: 30, alignItems: 'center' },
  cardsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  card: { flex: 1, backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 14, padding: 12 },
  cardIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  cardValue: { color: C.text, fontSize: 15, fontWeight: '800' },
  cardLabel: { color: C.sub, fontSize: 10, marginTop: 2 },
  explainer: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: 'rgba(148,163,184,0.06)', borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 6 },
  explainerText: { flex: 1, color: C.sub, fontSize: 12, lineHeight: 17 },
  section: { color: C.mut, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  jobRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 6 },
  jobTitle: { color: C.text, fontSize: 13, fontWeight: '600' },
  jobSub: { color: C.mut, fontSize: 11, marginTop: 2 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 10, fontWeight: '800' },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 22, backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 14 },
  emptyText: { color: C.mut, fontSize: 12, textAlign: 'center', paddingHorizontal: 24 },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg, borderColor: C.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 6 },
  txIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  txTitle: { color: C.text, fontSize: 13, fontWeight: '600' },
  txSub: { color: C.mut, fontSize: 11, marginTop: 1 },
  txAmount: { color: C.text, fontSize: 13, fontWeight: '800' },
});

export default PayoutSummary;
