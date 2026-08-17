// ───────────────────────────────────────────────────────────────────
//  app/(admin)/financial/pending-payouts.tsx
//
//  Pending Inspector Payouts — dedicated detail screen.
//  Lists every completed job where payout_status='unpaid', sorted by
//  amount desc. Footer rollup shows total amount owed. Tap a row to
//  open the job detail and disburse from there.
//
//  ★ FlatList virtualization. Memoized rows + stable id-based
//    onPress callback ensure smooth scrolling even with thousands
//    of pending payouts in a payout backlog.
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
  RemainingPayoutRow,
  SectionHeader,
  formatUSD,
  type RemainingPayoutItem,
} from '@/src/features/financial/adminFinancialShared';

export default function PendingPayoutsScreen() {
  const router = useRouter();
  const [data, setData] = useState<RemainingPayoutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchOperationalData();
      setData(result.remainingPayouts);
    } catch (err) {
      console.error('[financial/pending-payouts] fetch error:', err);
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

  const goToJob = useCallback(
    (jobId: string) => router.push(`/(admin)/jobs/${jobId}` as any),
    [router],
  );

  const keyExtractor = useCallback((item: RemainingPayoutItem) => item.id, []);

  const renderItem: ListRenderItem<RemainingPayoutItem> = useCallback(
    ({ item }) => (
      <View style={ss.listRowPad}>
        <RemainingPayoutRow item={item} onPress={goToJob} />
      </View>
    ),
    [goToJob],
  );

  const totalOwed = useMemo(
    () => data.reduce((s, r) => s + r.payoutCents, 0),
    [data],
  );

  const ListHeader = useMemo(
    () => (
      <View style={ss.listHeaderArea}>
        <SectionHeader
          title="Pending Inspector Payouts"
          subtitle={`${data.length} ${data.length === 1 ? 'payment' : 'payments'} owed, sorted by amount`}
        />
      </View>
    ),
    [data.length],
  );

  const ListFooter = useMemo(() => {
    if (data.length === 0) return null;
    return (
      <View style={ss.listFooterArea}>
        <View style={ss.remainingFooter}>
          <Text style={ss.remainingFooterLabel}>Total owed</Text>
          <Text style={ss.remainingFooterValue}>{formatUSD(totalOwed)}</Text>
        </View>
      </View>
    );
  }, [data.length, totalOwed]);

  const ListEmpty = useMemo(
    () => (
      <View style={ss.emptyState}>
        <Ionicons
          name="checkmark-done-circle-outline"
          size={32}
          color={C.green}
        />
        <Text style={ss.emptyStateText}>All payouts caught up</Text>
      </View>
    ),
    [],
  );

  if (loading && !refreshing) {
    return (
      <View style={ss.loadingWrap}>
        <Stack.Screen options={{ title: 'Pending Payouts' }} />
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={ss.screenRoot} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Pending Payouts' }} />
      <FlatList
        style={ss.listCard}
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
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
