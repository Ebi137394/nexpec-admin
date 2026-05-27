// ════════════════════════════════════════════════════════════════════════════
//  src/components/procurement/ApprovalsScreen.tsx
//
//  Mobile approver dashboard. Mirrors web /client/approvals — same
//  RPC source (fetch_my_pending_approvals, SoD-filtered server-side),
//  same shared-core schemas, premium dark/violet UI honouring locked
//  tokens (bg #020420, primary #7C3AED).
//
//  USAGE — drop into Expo Router like:
//
//    // app/(client)/approvals.tsx
//    import { ApprovalsScreen } from '@/src/components/procurement';
//    export default function Approvals() {
//      return <ApprovalsScreen />;
//    }
//
//  Must be rendered inside a <BottomSheetModalProvider> — the project's
//  root layout already provides one.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Platform,
  SafeAreaView,
} from 'react-native';
import type { BottomSheetModal } from '@gorhom/bottom-sheet';
import {
  ShieldCheck,
  Building2,
  Clock,
  Hash,
  Users,
  Receipt,
  AlertCircle,
  ChevronRight,
} from 'lucide-react-native';

import type { PendingApprovalRow } from '@nexpec/shared-core';
import { useMyPendingApprovals } from './useMyPendingApprovals';
import { ApprovalDecisionSheet } from './ApprovalDecisionSheet';

const TOKENS = {
  bg: '#020420',
  surface: '#0B0F2E',
  surfaceHi: '#11163A',
  primary: '#7C3AED',
  primaryGlow: '#A78BFA',
  cyan: '#22D3EE',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.10)',
  textPrimary: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textTertiary: '#71717A',
  textMuted: '#52525B',
  rose: '#F43F5E',
} as const;

export function ApprovalsScreen() {
  const {
    loading,
    error,
    requests,
    pendingDecisionFor,
    refresh,
    submitDecision,
  } = useMyPendingApprovals();

  const [active, setActive] = useState<PendingApprovalRow | null>(null);
  const sheetRef = useRef<BottomSheetModal>(null);
  const [refreshing, setRefreshing] = useState(false);

  const openSheetFor = useCallback((row: PendingApprovalRow) => {
    setActive(row);
    // Tiny delay so the present() can render with the new state.
    setTimeout(() => sheetRef.current?.present(), 30);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onSubmit = useCallback(
    async (decision: 'approved' | 'rejected', comment?: string) => {
      if (!active) return { ok: false };
      const res = await submitDecision(active.job_id, decision, comment);
      return res;
    },
    [active, submitDecision],
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.eyebrow}>PROCUREMENT · APPROVALS</Text>
          <View style={styles.titleRow}>
            <View style={styles.titleIcon}>
              <ShieldCheck
                size={18}
                color={TOKENS.primaryGlow}
                strokeWidth={1.75}
              />
            </View>
            <Text style={styles.title}>Awaiting your decision</Text>
          </View>
          <Text style={styles.subtitle}>
            Jobs that triggered an approval gate land here. Self-approval is
            schema-blocked — requests you posted yourself never appear.
          </Text>
        </View>

        {/* Error banner */}
        {error && (
          <View style={styles.errorBanner}>
            <AlertCircle size={14} color={TOKENS.rose} strokeWidth={1.75} />
            <Text style={styles.errorText} numberOfLines={2}>
              {error}
            </Text>
          </View>
        )}

        {/* List body */}
        {loading ? (
          <View style={styles.centeredState}>
            <ActivityIndicator color={TOKENS.primaryGlow} />
            <Text style={styles.centeredStateText}>Loading approvals…</Text>
          </View>
        ) : requests.length === 0 ? (
          <EmptyState onRefresh={onRefresh} />
        ) : (
          <FlatList
            data={requests}
            keyExtractor={(r) => r.request_id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={TOKENS.primaryGlow}
              />
            }
            renderItem={({ item }) => (
              <ApprovalRow
                row={item}
                isPending={pendingDecisionFor === item.job_id}
                onPress={() => openSheetFor(item)}
              />
            )}
          />
        )}
      </View>

      {/* Decision sheet — always mounted; presented on demand */}
      <ApprovalDecisionSheet
        sheetRef={sheetRef}
        request={active}
        isSubmitting={pendingDecisionFor !== null}
        onSubmit={onSubmit}
      />
    </SafeAreaView>
  );
}

/* ─── row ─────────────────────────────────────────────────────────── */

function ApprovalRow({
  row,
  isPending,
  onPress,
}: {
  row: PendingApprovalRow;
  isPending: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={isPending}
      android_ripple={{ color: 'rgba(124,58,237,0.15)' }}
      style={({ pressed }) => [
        styles.card,
        pressed && Platform.OS === 'ios' && styles.cardPressed,
        isPending && styles.cardDisabled,
      ]}
    >
      <View style={styles.cardIconWrap}>
        <Receipt size={16} color={TOKENS.primaryGlow} strokeWidth={1.75} />
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTopRow}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {row.job_title}
          </Text>
          <View style={styles.cardAmountWrap}>
            <Text style={styles.cardAmount}>
              {formatMoney(row.amount_cents, row.currency)}
            </Text>
            <Text style={styles.cardAmountLabel}>REQUESTED</Text>
          </View>
        </View>

        <View style={styles.cardMetaRow}>
          <View style={styles.cardMetaItem}>
            <Building2
              size={10}
              color={TOKENS.textTertiary}
              strokeWidth={1.75}
            />
            <Text style={styles.cardMetaText} numberOfLines={1}>
              {row.org_name}
            </Text>
          </View>
          {row.department_name && (
            <Text style={styles.cardMetaText} numberOfLines={1}>
              · {row.department_name}
            </Text>
          )}
          {row.cost_center && (
            <View style={styles.cardCostCenterChip}>
              <Hash size={9} color={TOKENS.textSecondary} strokeWidth={2} />
              <Text style={styles.cardCostCenterText}>{row.cost_center}</Text>
            </View>
          )}
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.cardFooterItem}>
            <Users size={10} color={TOKENS.primaryGlow} strokeWidth={1.75} />
            <Text style={styles.cardFooterText}>
              By {row.requested_by_label}
            </Text>
          </View>
          <View style={styles.cardFooterItem}>
            <Clock size={10} color={TOKENS.textTertiary} strokeWidth={1.75} />
            <Text style={styles.cardFooterText}>
              {formatRelative(row.requested_at)}
            </Text>
          </View>
          <Text style={styles.cardQuorum}>
            {row.approved_count}/{row.min_approvers_required} APPROVALS
          </Text>
        </View>
      </View>

      <View style={styles.cardCta}>
        {isPending ? (
          <ActivityIndicator size="small" color={TOKENS.primaryGlow} />
        ) : (
          <ChevronRight
            size={16}
            color={TOKENS.textTertiary}
            strokeWidth={1.75}
          />
        )}
      </View>
    </Pressable>
  );
}

/* ─── empty state ─────────────────────────────────────────────────── */

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <View style={styles.emptyState}>
      <ShieldCheck
        size={28}
        color={TOKENS.primaryGlow}
        strokeWidth={1.5}
        style={{ opacity: 0.7 }}
      />
      <Text style={styles.emptyStateTitle}>You&apos;re all caught up</Text>
      <Text style={styles.emptyStateText}>
        New requests routed to your role will appear here. Requests you
        posted yourself are hidden by Segregation of Duties.
      </Text>
      <Pressable onPress={onRefresh} style={styles.emptyStateBtn}>
        <Text style={styles.emptyStateBtnText}>REFRESH</Text>
      </Pressable>
    </View>
  );
}

/* ─── formatters ─────────────────────────────────────────────────── */

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toLocaleString()}`;
  }
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  if (sec < 604800) return `${Math.round(sec / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/* ─── styles ─────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: TOKENS.bg },
  container: { flex: 1, backgroundColor: TOKENS.bg },

  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TOKENS.border,
  },
  eyebrow: {
    color: TOKENS.primaryGlow,
    opacity: 0.85,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  titleIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(124,58,237,0.30)',
  },
  title: {
    color: TOKENS.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: TOKENS.textTertiary,
    fontSize: 12,
    marginTop: 8,
    lineHeight: 17,
  },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,63,94,0.30)',
    backgroundColor: 'rgba(244,63,94,0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  errorText: {
    flex: 1,
    color: '#FECDD3',
    fontSize: 12,
    lineHeight: 16,
  },

  /* list */
  listContent: {
    padding: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: TOKENS.surface,
    padding: 14,
  },
  cardPressed: { opacity: 0.7 },
  cardDisabled: { opacity: 0.5 },
  cardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(124,58,237,0.30)',
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTitle: {
    flex: 1,
    color: TOKENS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  cardAmountWrap: { alignItems: 'flex-end' },
  cardAmount: {
    color: TOKENS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  cardAmountLabel: {
    color: TOKENS.textTertiary,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginTop: 2,
  },
  cardMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  cardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardMetaText: {
    color: TOKENS.textTertiary,
    fontSize: 11,
  },
  cardCostCenterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  cardCostCenterText: {
    color: TOKENS.textSecondary,
    fontSize: 9,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  cardFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TOKENS.border,
  },
  cardFooterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardFooterText: {
    color: TOKENS.textTertiary,
    fontSize: 10,
  },
  cardQuorum: {
    marginLeft: 'auto',
    color: TOKENS.primaryGlow,
    opacity: 0.95,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  cardCta: { alignSelf: 'center', paddingHorizontal: 4 },

  /* empty */
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 8,
  },
  emptyStateTitle: {
    color: TOKENS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 14,
  },
  emptyStateText: {
    color: TOKENS.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 17,
  },
  emptyStateBtn: {
    marginTop: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(124,58,237,0.18)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(124,58,237,0.40)',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  emptyStateBtnText: {
    color: TOKENS.primaryGlow,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  centeredStateText: {
    color: TOKENS.textTertiary,
    fontSize: 12,
  },
});
