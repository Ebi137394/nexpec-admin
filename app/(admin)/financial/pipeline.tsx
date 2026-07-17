// ───────────────────────────────────────────────────────────────────
//  app/(admin)/financial/pipeline.tsx
//
//  Pipeline by Job Status — dedicated detail screen.
//  Shows every status bucket (count + total client value), plus the
//  rollups for money locked in escrow and pending inspector payouts.
//
//  ★ FlatList virtualization. Pipeline rows are tiny but we still
//    use FlatList for consistency with the other detail screens and
//    to handle the (unlikely) case of many custom statuses.
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
import { Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  C,
  ss,
  fetchOperationalData,
  PipelineRow,
  SectionHeader,
  formatUSD,
  type PipelineItem,
} from './_shared';

export default function PipelineScreen() {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [escrowCents, setEscrowCents] = useState(0);
  const [pendingPayoutsCents, setPendingPayoutsCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await fetchOperationalData();
      setItems(result.pipeline);
      setEscrowCents(result.escrowCents);
      setPendingPayoutsCents(result.pendingPayoutsCents);
    } catch (err) {
      console.error('[financial/pipeline] fetch error:', err);
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

  const keyExtractor = useCallback((item: PipelineItem) => item.status, []);

  const renderItem: ListRenderItem<PipelineItem> = useCallback(
    ({ item }) => (
      <View style={ss.listRowPad}>
        <PipelineRow item={item} />
      </View>
    ),
    [],
  );

  const { totalJobs, totalValue } = useMemo(() => {
    let tJobs = 0;
    let tValue = 0;
    for (const i of items) {
      tJobs += i.count;
      tValue += i.valueCents;
    }
    return { totalJobs: tJobs, totalValue: tValue };
  }, [items]);

  const ListHeader = useMemo(
    () => (
      <View style={ss.listHeaderArea}>
        <SectionHeader
          title="Pipeline by Job Status"
          subtitle={`${totalJobs} ${totalJobs === 1 ? 'job' : 'jobs'} total, all historical states`}
        />
      </View>
    ),
    [totalJobs],
  );

  const ListFooter = useMemo(() => {
    if (items.length === 0) return null;
    return (
      <View style={ss.listFooterArea}>
        <View style={ss.remainingFooter}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Ionicons name="lock-closed" size={14} color={C.amber} />
            <Text style={[ss.balanceStatLabel, { fontWeight: '700' }]}>Locked for payout</Text>
          </View>
          <Text style={[ss.balanceStatValue, { fontWeight: '800' }]}>{formatUSD(escrowCents)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 }}>
          <Ionicons name="hourglass" size={14} color={C.blue} />
          <Text style={[ss.balanceStatLabel, { flex: 1, fontWeight: '700' }]}>
            Pending inspector payouts
          </Text>
          <Text style={[ss.balanceStatValue, { fontWeight: '800' }]}>{formatUSD(pendingPayoutsCents)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 }}>
          <Ionicons name="trending-up" size={14} color={C.green} />
          <Text style={[ss.balanceStatLabel, { flex: 1, fontWeight: '700' }]}>
            Total pipeline value
          </Text>
          <Text style={[ss.balanceStatValue, { fontWeight: '800', color: C.green }]}>
            {formatUSD(totalValue)}
          </Text>
        </View>
      </View>
    );
  }, [items.length, escrowCents, pendingPayoutsCents, totalValue]);

  const ListEmpty = useMemo(
    () => (
      <View style={ss.emptyState}>
        <Ionicons name="git-branch-outline" size={32} color={C.textMuted} />
        <Text style={ss.emptyStateText}>No jobs yet</Text>
      </View>
    ),
    [],
  );

  if (loading && !refreshing) {
    return (
      <View style={ss.loadingWrap}>
        <Stack.Screen options={{ title: 'Job Pipeline' }} />
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={ss.screenRoot} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Job Pipeline' }} />
      <FlatList
        style={ss.listCard}
        data={items}
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
