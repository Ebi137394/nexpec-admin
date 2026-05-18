// ───────────────────────────────────────────────────────────────────
//  app/(admin)/financial/clients.tsx
//
//  Client / Agency / Enterprise balances — dedicated detail screen.
//  Each row shows the account name (resolved through profiles, not
//  jobs.company_name), billed total, paid total, and outstanding.
//  Expandable to reveal per-job billing breakdown.
//
//  ★ FlatList virtualization. Rows are memoized; toggle / nav
//    callbacks are stable across renders. Designed for thousands of
//    accounts without dropping frames.
// ───────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  C,
  ss,
  fetchOperationalData,
  ClientBalanceRow,
  SectionHeader,
  type ClientBalanceItem,
} from './_shared';

export default function ClientsScreen() {
  const router = useRouter();
  const [data, setData] = useState<ClientBalanceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const result = await fetchOperationalData();
      setData(result.clientBalances);
    } catch (err) {
      console.error('[financial/clients] fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
    }, [load]),
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const goToJob = useCallback(
    (jobId: string) => router.push(`/(admin)/jobs/${jobId}` as any),
    [router],
  );

  const keyExtractor = useCallback((item: ClientBalanceItem) => item.id, []);

  const renderItem: ListRenderItem<ClientBalanceItem> = useCallback(
    ({ item }) => (
      <View style={ss.listRowPad}>
        <ClientBalanceRow
          item={item}
          expanded={expanded.has(item.id)}
          onToggle={toggle}
          onJobPress={goToJob}
        />
      </View>
    ),
    [expanded, toggle, goToJob],
  );

  const totals = useMemo(
    () =>
      data.reduce(
        (acc, c) => {
          acc.billed += c.billedCents;
          acc.paid += c.paidCents;
          acc.outstanding += c.outstandingCents;
          return acc;
        },
        { billed: 0, paid: 0, outstanding: 0 },
      ),
    [data],
  );

  const ListHeader = useMemo(
    () => (
      <View style={ss.listHeaderArea}>
        <SectionHeader
          title="Client / Agency / Enterprise Accounts"
          subtitle={`${data.length} ${data.length === 1 ? 'account' : 'accounts'} · billed · paid · outstanding · tap to expand`}
        />
      </View>
    ),
    [data.length],
  );

  const ListFooter = useMemo(() => {
    if (data.length === 0) return null;
    return (
      <View style={ss.listFooterArea}>
        <View
          style={[
            ss.remainingFooter,
            { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
          ]}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={ss.balanceStatLabel}>Total billed</Text>
            <Text style={ss.balanceStatValue}>
              ${(totals.billed / 100).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={ss.balanceStatLabel}>Total paid</Text>
            <Text style={[ss.balanceStatValue, { color: C.green }]}>
              ${(totals.paid / 100).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={ss.balanceStatLabel}>Total outstanding</Text>
            <Text
              style={[
                ss.balanceStatValue,
                {
                  color: totals.outstanding > 0 ? C.amber : C.green,
                  fontWeight: '800',
                },
              ]}
            >
              ${(totals.outstanding / 100).toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          </View>
        </View>
      </View>
    );
  }, [data.length, totals]);

  const ListEmpty = useMemo(
    () => (
      <View style={ss.emptyState}>
        <Ionicons name="business-outline" size={32} color={C.textMuted} />
        <Text style={ss.emptyStateText}>No client activity yet</Text>
      </View>
    ),
    [],
  );

  if (loading && !refreshing) {
    return (
      <View style={ss.loadingWrap}>
        <Stack.Screen options={{ title: 'Client Accounts' }} />
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={ss.screenRoot} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Client Accounts' }} />
      <FlatList
        style={ss.listCard}
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
        extraData={expanded}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.primary}
            colors={[C.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
        initialNumToRender={15}
        windowSize={10}
        maxToRenderPerBatch={10}
        removeClippedSubviews
      />
    </SafeAreaView>
  );
}
