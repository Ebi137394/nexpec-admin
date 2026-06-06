// app/agreements/index.tsx — a counterparty's own agreements (supplier_supply /
//   inspector_engagement / client_supply). RLS scopes rows to the signed-in user,
//   so each party sees only theirs. Mirrors the web /agreements inbox.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { NEXPEC_THEME as T } from '../../src/components/DynamicForm/theme';
import { fetchMyAgreements, type MyAgreement } from '../../src/hooks/useSupplierEcosystem';
import { formatUsd } from '../../src/core/utils/money';

const KIND_LABEL: Record<string, string> = {
  client_supply: 'Supply & Inspection',
  supplier_supply: 'Supplier Supply',
  inspector_engagement: 'Inspector Engagement',
};
const ACTIONABLE = new Set(['presented']);

export default function AgreementsListScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<MyAgreement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    fetchMyAgreements().then((r) => { if (on) setRows(r); }).catch(() => {}).finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, []);

  const toSign = rows.filter((r) => ACTIONABLE.has(r.status));
  const rest = rows.filter((r) => !ACTIONABLE.has(r.status));

  const Row = ({ r }: { r: MyAgreement }) => (
    <TouchableOpacity style={s.row} activeOpacity={0.85} onPress={() => router.push(`/agreements/${r.id}/sign` as any)}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{KIND_LABEL[r.kind] ?? r.kind}</Text>
        <View style={s.rowMeta}>
          <Text style={s.rowAmt}>{formatUsd(r.amount_cents)}</Text>
          <Text style={s.statusChip}>{r.status}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={T.colors.textMuted} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={T.colors.background} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={s.back}><Ionicons name="arrow-back" size={24} color={T.colors.text} /></TouchableOpacity>
        <Text style={s.title} numberOfLines={1}>My agreements</Text>
        <View style={{ width: 32 }} />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={T.colors.primary} /></View>
      ) : rows.length === 0 ? (
        <View style={s.center}><Text style={s.muted}>No agreements yet. NEXPEC will present yours here to review and sign.</Text></View>
      ) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <Text style={s.sub}>Every agreement is between you and NEXPEC.</Text>
          {toSign.length > 0 && (
            <>
              <Text style={s.section}>AWAITING YOUR SIGNATURE</Text>
              {toSign.map((r) => <Row key={r.id} r={r} />)}
            </>
          )}
          {rest.length > 0 && (
            <>
              <Text style={[s.section, { marginTop: 18 }]}>ALL AGREEMENTS</Text>
              {rest.map((r) => <Row key={r.id} r={r} />)}
            </>
          )}
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
  muted: { color: T.colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  content: { paddingHorizontal: T.spacing.lg, paddingBottom: 40 },
  sub: { color: T.colors.textMuted, fontSize: 12, marginBottom: 14 },
  section: { color: T.colors.textMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: T.colors.cardBackground, borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: T.borderRadius.lg, padding: T.spacing.md, marginBottom: 8 },
  rowTitle: { color: T.colors.text, fontSize: 14, fontWeight: '700' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  rowAmt: { color: T.colors.textSecondary, fontSize: 13 },
  statusChip: { color: T.colors.textMuted, fontSize: 11, textTransform: 'capitalize', borderColor: T.colors.inputBorder, borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
});
