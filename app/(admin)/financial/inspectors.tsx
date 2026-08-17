// ───────────────────────────────────────────────────────────────────
//  app/(admin)/financial/inspectors.tsx
//
//  Inspector Earnings Leaderboard — dedicated detail screen.
//  Pulls all-time data via fetchOperationalData(). Rows are
//  expandable to reveal per-job earnings; each job links to the
//  super-admin job detail screen.
//
//  ★ FlatList virtualization. Rows are memoized; toggle / nav
//    callbacks are stable across renders so React.memo skips
//    re-renders of off-screen items. Scales to thousands of rows.
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
  InspectorLeaderRow,
  SectionHeader,
  type InspectorLeaderItem,
} from '@/src/features/financial/adminFinancialShared';

export default function InspectorsScreen() {
  const router = useRouter();
  const [data, setData] = useState<InspectorLeaderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const result = await fetchOperationalData();
      setData(result.inspectorLeaderboard);
    } catch (err) {
      console.error('[financial/inspectors] fetch error:', err);
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

  // Stable id-based callbacks — these references never change, so
  // React.memo on InspectorLeaderRow correctly skips re-renders.
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

  const keyExtractor = useCallback((item: InspectorLeaderItem) => item.id, []);

  const renderItem: ListRenderItem<InspectorLeaderItem> = useCallback(
    ({ item, index }) => (
      <View style={ss.listRowPad}>
        <InspectorLeaderRow
          rank={index + 1}
          item={item}
          expanded={expanded.has(item.id)}
          onToggle={toggle}
          onJobPress={goToJob}
        />
      </View>
    ),
    [expanded, toggle, goToJob],
  );

  const totalPaid = useMemo(
    () => data.reduce((s, i) => s + i.totalEarningsCents, 0),
    [data],
  );

  const ListHeader = useMemo(
    () => (
      <View style={ss.listHeaderArea}>
        <SectionHeader
          title="Inspector Earnings Leaderboard"
          subtitle={`${data.length} ${data.length === 1 ? 'inspector' : 'inspectors'}, all-time totals, tap to expand`}
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
          <Text style={ss.remainingFooterLabel}>Total earned (all inspectors)</Text>
          <Text style={[ss.remainingFooterValue, { color: C.green }]}>
            ${(totalPaid / 100).toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </Text>
        </View>
      </View>
    );
  }, [data.length, totalPaid]);

  const ListEmpty = useMemo(
    () => (
      <View style={ss.emptyState}>
        <Ionicons name="trophy-outline" size={32} color={C.textMuted} />
        <Text style={ss.emptyStateText}>No inspector earnings yet</Text>
      </View>
    ),
    [],
  );

  if (loading && !refreshing) {
    return (
      <View style={ss.loadingWrap}>
        <Stack.Screen options={{ title: 'Inspector Earnings' }} />
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={ss.screenRoot} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Inspector Earnings' }} />
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
