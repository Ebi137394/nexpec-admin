// ───────────────────────────────────────────────────────────────────
//  app/(admin)/financial/active-jobs.tsx
//
//  Active Jobs — dedicated detail screen for jobs in `assigned` /
//  `in_progress` status. Shows start → end dates, inspector / client,
//  payout status, and amount. Tap a row to open the job detail.
//
//  ★ FlatList virtualization. Rows are memoized; the row's onPress
//    receives the item id and dispatches to a stable handler in this
//    screen — no per-render arrow allocations.
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
  ActiveJobRow,
  SectionHeader,
  type ActiveJobItem,
} from './_shared';

export default function ActiveJobsScreen() {
  const router = useRouter();
  const [data, setData] = useState<ActiveJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchOperationalData();
      setData(result.activeJobs);
    } catch (err) {
      console.error('[financial/active-jobs] fetch error:', err);
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

  const keyExtractor = useCallback((item: ActiveJobItem) => item.id, []);

  const renderItem: ListRenderItem<ActiveJobItem> = useCallback(
    ({ item }) => (
      <View style={ss.listRowPad}>
        <ActiveJobRow item={item} onPress={goToJob} />
      </View>
    ),
    [goToJob],
  );

  const totalPayout = useMemo(
    () => data.reduce((s, j) => s + j.payoutCents, 0),
    [data],
  );

  const ListHeader = useMemo(
    () => (
      <View style={ss.listHeaderArea}>
        <SectionHeader
          title="Active Jobs · Financials"
          subtitle={`${data.length} ${data.length === 1 ? 'job' : 'jobs'} in flight · start → end · payout status`}
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
          <Text style={ss.remainingFooterLabel}>Inspector payouts in flight</Text>
          <Text style={[ss.remainingFooterValue, { color: C.amber }]}>
            ${(totalPayout / 100).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </Text>
        </View>
      </View>
    );
  }, [data.length, totalPayout]);

  const ListEmpty = useMemo(
    () => (
      <View style={ss.emptyState}>
        <Ionicons name="calendar-outline" size={32} color={C.textMuted} />
        <Text style={ss.emptyStateText}>No active jobs</Text>
      </View>
    ),
    [],
  );

  if (loading && !refreshing) {
    return (
      <View style={ss.loadingWrap}>
        <Stack.Screen options={{ title: 'Active Jobs' }} />
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={ss.screenRoot} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Active Jobs' }} />
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
