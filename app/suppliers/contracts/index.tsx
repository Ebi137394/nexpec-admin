// ════════════════════════════════════════════════════════════════════════════
//  app/suppliers/contracts/index.tsx — Supplier Agreements hub (mobile)
//
//  Mobile parity with web /suppliers/contracts. Lists every NEXPEC Supplier
//  Agreement addressed to this supplier (RLS scopes to supplier_id = auth.uid()).
//  Agreements awaiting the supplier's signature float to the top.
// ════════════════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  FileSignature,
  ShieldCheck,
  PenLine,
  Clock,
  ChevronRight,
} from 'lucide-react-native';
import {
  useMySupplierContracts,
  type SupplierContract,
  type SupplierContractStatus,
} from '@/src/hooks/useSupplierContracts';
import { formatUsd } from '@/src/core/utils/money';

const C = {
  bg: '#020420',
  bgElev: '#070A24',
  card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF',
  textSecondary: '#A8B2C7',
  textMuted: '#6B7390',
  primary: '#7C3AED',
  primaryGlow: 'rgba(124, 58, 237, 0.18)',
  cyan: '#00FFFF',
  ok: '#10F995',
  okGlow: 'rgba(16, 249, 149, 0.12)',
  warn: '#F59E0B',
  warnDim: 'rgba(245, 158, 11, 0.14)',
};

const STATUS_META: Record<
  SupplierContractStatus,
  { label: string; tone: string; toneDim: string }
> = {
  draft: { label: 'DRAFT', tone: C.textMuted, toneDim: 'rgba(255,255,255,0.06)' },
  pending_supplier_signature: {
    label: 'SIGN NOW',
    tone: C.primary,
    toneDim: C.primaryGlow,
  },
  pending_admin_countersignature: {
    label: 'AWAITING NEXPEC',
    tone: C.warn,
    toneDim: C.warnDim,
  },
  executed: { label: 'EXECUTED', tone: C.ok, toneDim: C.okGlow },
  voided: { label: 'VOIDED', tone: '#EF4444', toneDim: 'rgba(239,68,68,0.14)' },
};

export default function SupplierContractsListScreen() {
  const router = useRouter();
  const { items, loading, refetch } = useMySupplierContracts();
  const [refreshing, setRefreshing] = React.useState(false);

  const { actionNeeded, inFlight, executed } = useMemo(
    () => ({
      actionNeeded: items.filter((c) => c.status === 'pending_supplier_signature'),
      inFlight: items.filter(
        (c) =>
          c.status === 'pending_admin_countersignature' || c.status === 'draft',
      ),
      executed: items.filter((c) => c.status === 'executed'),
    }),
    [items],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glow} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.header}>
          <Pressable onPress={() => router.back()} style={s.headerBtn} hitSlop={10}>
            <ArrowLeft size={18} color={C.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.headerKicker}>SUPPLIER &amp; LEGAL</Text>
            <Text style={s.headerTitle}>Agreements</Text>
          </View>
          <View style={{ width: 38 }} />
        </View>

        {loading ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.loadingText}>LOADING AGREEMENTS…</Text>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 48 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={C.primary}
                colors={[C.primary]}
              />
            }
          >
            <Text style={s.lede}>
              When you win a bid, NEXPEC issues a formal agreement here. E-sign it
              and we counter-sign to execute. A signed agreement is required
              before funds are released.
            </Text>

            {items.length === 0 ? (
              <View style={s.empty}>
                <FileSignature size={26} color={C.primary} strokeWidth={1.5} />
                <Text style={s.emptyTitle}>No agreements yet</Text>
                <Text style={s.emptyBody}>
                  When your quote is awarded on an RFQ, NEXPEC issues a supplier
                  agreement and it appears here ready to sign.
                </Text>
              </View>
            ) : (
              <>
                {actionNeeded.length > 0 && (
                  <Section
                    icon={<PenLine size={13} color={C.primary} />}
                    label="Awaiting your signature"
                    tint={C.primary}
                  >
                    {actionNeeded.map((c) => (
                      <ContractRow key={c.id} c={c} router={router} />
                    ))}
                  </Section>
                )}
                {inFlight.length > 0 && (
                  <Section
                    icon={<Clock size={13} color={C.warn} />}
                    label="In progress"
                    tint={C.warn}
                  >
                    {inFlight.map((c) => (
                      <ContractRow key={c.id} c={c} router={router} />
                    ))}
                  </Section>
                )}
                {executed.length > 0 && (
                  <Section
                    icon={<ShieldCheck size={13} color={C.ok} />}
                    label="Executed"
                    tint={C.ok}
                  >
                    {executed.map((c) => (
                      <ContractRow key={c.id} c={c} router={router} />
                    ))}
                  </Section>
                )}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function Section({
  icon,
  label,
  tint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  tint: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 18 }}>
      <View style={s.sectionHeader}>
        <View style={[s.sectionIcon, { backgroundColor: tint + '18' }]}>{icon}</View>
        <Text style={[s.sectionLabel, { color: tint }]}>{label.toUpperCase()}</Text>
      </View>
      <View style={{ gap: 10, paddingHorizontal: 20 }}>{children}</View>
    </View>
  );
}

function ContractRow({
  c,
  router,
}: {
  c: SupplierContract;
  router: ReturnType<typeof useRouter>;
}) {
  const meta = STATUS_META[c.status];
  return (
    <Pressable
      onPress={() => router.push(`/suppliers/contracts/${c.id}` as any)}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.85 }]}
    >
      <View style={s.rowIcon}>
        <FileSignature size={17} color={C.primary} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.rowTitle} numberOfLines={1}>
          {c.rfq_title ?? 'Awarded agreement'}
        </Text>
        <Text style={s.rowMeta} numberOfLines={1}>
          {formatUsd(c.amount_cents)}, issued{' '}
          {new Date(c.created_at).toLocaleDateString()}
        </Text>
      </View>
      <View style={[s.badge, { backgroundColor: meta.toneDim }]}>
        <Text style={[s.badgeText, { color: meta.tone }]}>{meta.label}</Text>
      </View>
      <ChevronRight size={16} color={C.textMuted} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  glow: {
    position: 'absolute',
    top: -160,
    left: -100,
    width: 360,
    height: 360,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: C.bgElev,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerKicker: {
    color: C.cyan,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 1,
  },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { color: C.textMuted, fontSize: 11, letterSpacing: 1.4, fontWeight: '700' },
  lede: {
    color: C.textMuted,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 20,
    marginTop: 6,
  },
  empty: {
    margin: 20,
    marginTop: 28,
    padding: 28,
    borderRadius: 18,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 4 },
  emptyBody: { color: C.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sectionIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: C.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: C.text, fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  rowMeta: { color: C.textMuted, fontSize: 11, fontWeight: '500', marginTop: 2 },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});
