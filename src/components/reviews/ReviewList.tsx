// ════════════════════════════════════════════════════════════════════════════
//  src/components/reviews/ReviewList.tsx
//  NEXPEC — Premium Review & Reputation Engine
//
//  Paginated list of reviews ABOUT a user. Used on profile screens.
//  Supports two modes:
//    • inline=false (default) — owns scroll via FlatList. Use as a screen.
//    • inline=true — embeds inside a parent ScrollView. No nested scroll.
//
//  Loads first page on mount, debounces refresh on focus, has "Load
//  older reviews" CTA at the bottom when more pages exist.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import {
  fetchReviewsAboutUser,
  ReviewWithParties,
} from '@/src/lib/reviews';
import ReviewItem from './ReviewItem';

const C = {
  bg:            '#020420',
  surface:       '#0A0E2E',
  border:        '#1A1F4E',
  borderSoft:    'rgba(26,31,78,0.55)',
  primary:       '#7C3AED',
  primaryLight:  '#8B5CF6',
  primaryBg:     'rgba(124,58,237,0.12)',
  primaryBorder: 'rgba(124,58,237,0.40)',
  textPrimary:   '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted:     '#64748B',
};

const PAGE_SIZE = 20;

export interface ReviewListProps {
  /** Whose reviews to show. */
  revieweeId: string;
  /** Admin-grade visibility (unmasked metadata). Default false. */
  asAdmin?: boolean;
  /** Embed inside a parent ScrollView. Default false. */
  inline?: boolean;
  /** Empty-state title. */
  emptyTitle?: string;
  /** Empty-state subtitle. */
  emptySubtitle?: string;
}

const ReviewList: React.FC<ReviewListProps> = ({
  revieweeId,
  asAdmin = false,
  inline = false,
  emptyTitle,
  emptySubtitle,
}) => {
  const [items, setItems]         = useState<ReviewWithParties[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const reqIdRef = useRef(0);

  const load = useCallback(
    async ({ isRefresh = false, append = false }: { isRefresh?: boolean; append?: boolean } = {}) => {
      if (!revieweeId) return;
      const myReq = ++reqIdRef.current;
      if (isRefresh)      setRefreshing(true);
      else if (append)    setLoadingMore(true);
      else                setLoading(true);
      setError(null);
      try {
        const rows = await fetchReviewsAboutUser(revieweeId, {
          asAdmin,
          limit: PAGE_SIZE,
          offset: append ? items.length : 0,
        });
        if (myReq !== reqIdRef.current) return;
        setHasMore(rows.length === PAGE_SIZE);
        setItems((prev) => (append ? [...prev, ...rows] : rows));
      } catch (e: any) {
        if (myReq !== reqIdRef.current) return;
        console.error('[ReviewList] fetch error:', e?.message);
        setError(e?.message ?? 'Failed to load reviews');
        if (!append) setItems([]);
      } finally {
        if (myReq === reqIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [revieweeId, asAdmin, items.length],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revieweeId, asAdmin]);

  useFocusEffect(
    useCallback(() => {
      load({ isRefresh: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revieweeId, asAdmin]),
  );

  const onRefresh = useCallback(() => load({ isRefresh: true }), [load]);
  const onLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    load({ append: true });
  }, [hasMore, loadingMore, loading, load]);

  const keyExtractor = useCallback((r: ReviewWithParties) => r.id, []);
  const renderItem: ListRenderItem<ReviewWithParties> = useCallback(
    ({ item }) => <ReviewItem review={item} />,
    [],
  );
  const ItemSep = useCallback(() => <View style={s.itemSep} />, []);

  const ListFooter = useMemo(() => {
    if (loadingMore) {
      return (
        <View style={s.footerLoader}>
          <ActivityIndicator size="small" color={C.primary} />
        </View>
      );
    }
    if (items.length > 0 && hasMore) {
      return (
        <TouchableOpacity style={s.loadMoreBtn} onPress={onLoadMore} activeOpacity={0.8}>
          <Text style={s.loadMoreText}>Load older reviews</Text>
          <Ionicons name="arrow-down" size={13} color={C.primaryLight} />
        </TouchableOpacity>
      );
    }
    return null;
  }, [loadingMore, hasMore, items.length, onLoadMore]);

  const ListEmpty = useMemo(() => {
    if (loading) {
      return (
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={s.empty}>
          <View style={[s.emptyIcon, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
            <Ionicons name="alert-circle-outline" size={26} color="#EF4444" />
          </View>
          <Text style={s.emptyTitle}>Couldn't load reviews</Text>
          <Text style={s.emptySubtitle}>{error}</Text>
        </View>
      );
    }
    return (
      <View style={s.empty}>
        <View style={s.emptyIcon}>
          <Ionicons name="chatbubble-ellipses-outline" size={26} color={C.primaryLight} />
        </View>
        <Text style={s.emptyTitle}>{emptyTitle ?? 'No reviews yet'}</Text>
        <Text style={s.emptySubtitle}>
          {emptySubtitle ?? 'Reviews from completed jobs will appear here.'}
        </Text>
      </View>
    );
  }, [loading, error, emptyTitle, emptySubtitle]);

  return (
    <View style={inline ? s.containerInline : s.container}>
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={ItemSep}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
        scrollEnabled={!inline}
        refreshControl={
          inline ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
              colors={[C.primary]}
            />
          )
        }
        contentContainerStyle={
          items.length === 0 ? s.emptyContent : s.listContent
        }
        showsVerticalScrollIndicator={false}
        initialNumToRender={inline ? PAGE_SIZE : 10}
        windowSize={inline ? PAGE_SIZE : 10}
        removeClippedSubviews={!inline}
      />
    </View>
  );
};

export default React.memo(ReviewList);

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: C.bg },
  containerInline: { backgroundColor: 'transparent' },

  listContent:  { paddingVertical: 4 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },

  itemSep: {
    height: 1,
    backgroundColor: C.borderSoft,
    marginLeft: 16 + 36 + 12, // align with content past the avatar
  },

  center: {
    paddingVertical: 50,
    alignItems: 'center',
  },

  empty: {
    alignItems: 'center',
    paddingVertical: 50,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 52, height: 52, borderRadius: 14,
    backgroundColor: C.primaryBg,
    borderWidth: 1, borderColor: C.primaryBorder,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.1,
    marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 280,
  },

  footerLoader: {
    paddingVertical: 22,
    alignItems: 'center',
  },
  loadMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginVertical: 16,
    paddingVertical: 10,
    borderRadius: 11,
    backgroundColor: C.primaryBg,
    borderWidth: 1,
    borderColor: C.primaryBorder,
  },
  loadMoreText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.primaryLight,
    letterSpacing: 0.4,
  },
});
