// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/reviews-moderation.tsx
//  NEXPEC — Premium Review & Reputation Engine (Admin Moderation Dashboard)
//
//  Admin-only command center for reviewing review content. Surfaces:
//    • Filter chips: All / Visible / Hidden / Disputed / Flagged
//    • Dense rows: rating + reviewer→reviewee + comment + status pill
//    • Tap row → action sheet: Hide / Unhide / Dispute / Flag / Note
//
//  Every moderation action goes through the moderate_review RPC, which
//  recomputes reputation and fires an audit_event automatically.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  Alert,
  Platform,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  fetchReviewsForModeration,
  moderateReview,
  formatReviewerName,
  formatInitials,
  formatRoleLabel,
  formatRelativeTime,
  ReviewWithParties,
  ModerationStatus,
  ModerateAction,
  MODERATION_LABELS,
} from '@/src/lib/reviews';

const C = {
  bg:            '#020420',
  surface:       '#0A0E2E',
  surfaceDeep:   '#070A24',
  surfaceLight:  '#111640',
  border:        '#1A1F4E',
  borderSoft:    'rgba(26,31,78,0.6)',
  primary:       '#7C3AED',
  primaryLight:  '#8B5CF6',
  primaryBg:     'rgba(124,58,237,0.12)',
  primaryBorder: 'rgba(124,58,237,0.40)',
  amber:         '#F59E0B',
  green:         '#10B981',
  red:           '#EF4444',
  textPrimary:   '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted:     '#64748B',
  backdrop:      'rgba(0,0,0,0.72)',
};

const PAGE_SIZE = 50;

type FilterStatus = ModerationStatus | 'all';

const FILTERS: { value: FilterStatus; label: string; icon: string }[] = [
  { value: 'all',      label: 'All',      icon: 'apps-outline' },
  { value: 'visible',  label: 'Visible',  icon: 'eye-outline' },
  { value: 'hidden',   label: 'Hidden',   icon: 'eye-off-outline' },
  { value: 'disputed', label: 'Disputed', icon: 'alert-circle-outline' },
  { value: 'flagged',  label: 'Flagged',  icon: 'flag-outline' },
];

export default function ReviewsModerationScreen() {
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [items, setItems]   = useState<ReviewWithParties[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selected, setSelected]   = useState<ReviewWithParties | null>(null);
  const reqIdRef = useRef(0);

  const load = useCallback(
    async ({ isRefresh = false, append = false }: { isRefresh?: boolean; append?: boolean } = {}) => {
      const myReq = ++reqIdRef.current;
      if (isRefresh)   setRefreshing(true);
      else if (append) setLoadingMore(true);
      else             setLoading(true);
      setError(null);
      try {
        const rows = await fetchReviewsForModeration({
          status: filter,
          limit: PAGE_SIZE,
          offset: append ? items.length : 0,
        });
        if (myReq !== reqIdRef.current) return;
        setHasMore(rows.length === PAGE_SIZE);
        setItems((prev) => (append ? [...prev, ...rows] : rows));
      } catch (e: any) {
        if (myReq !== reqIdRef.current) return;
        console.error('[reviews-moderation] fetch error:', e?.message);
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
    [filter, items.length],
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const onRefresh = useCallback(() => load({ isRefresh: true }), [load]);
  const onLoadMore = useCallback(() => {
    if (!hasMore || loadingMore || loading) return;
    load({ append: true });
  }, [hasMore, loadingMore, loading, load]);

  const handleAction = useCallback(
    async (review: ReviewWithParties, action: ModerateAction, notes?: string) => {
      try {
        await moderateReview({ reviewId: review.id, action, notes });
        // Optimistic local update
        if (action === 'hide' || action === 'unhide' || action === 'dispute' || action === 'flag') {
          const newStatus: ModerationStatus =
            action === 'hide'   ? 'hidden'
            : action === 'unhide' ? 'visible'
            : action === 'dispute' ? 'disputed'
            : 'flagged';
          setItems((prev) =>
            prev.map((r) => (r.id === review.id ? { ...r, moderation_status: newStatus } : r)),
          );
        }
        setSelected(null);
      } catch (e: any) {
        Alert.alert('Moderation failed', e?.message ?? 'Try again');
      }
    },
    [],
  );

  const keyExtractor = useCallback((r: ReviewWithParties) => r.id, []);

  const renderItem: ListRenderItem<ReviewWithParties> = useCallback(
    ({ item }) => <ReviewModerationRow review={item} onPress={() => setSelected(item)} />,
    [],
  );

  const ListHeader = useMemo(
    () => (
      <View style={s.filterStrip}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filterStripContent}
        >
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <TouchableOpacity
                key={f.value}
                style={[s.chip, active && s.chipActive]}
                onPress={() => setFilter(f.value)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={f.icon as any}
                  size={13}
                  color={active ? '#FFF' : C.textMuted}
                  style={{ marginRight: 5 }}
                />
                <Text style={[s.chipText, active && s.chipTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    ),
    [filter],
  );

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
            <Ionicons name="alert-circle-outline" size={26} color={C.red} />
          </View>
          <Text style={s.emptyTitle}>Couldn't load</Text>
          <Text style={s.emptySubtitle}>{error}</Text>
        </View>
      );
    }
    return (
      <View style={s.empty}>
        <View style={s.emptyIcon}>
          <Ionicons name="shield-checkmark-outline" size={26} color={C.primaryLight} />
        </View>
        <Text style={s.emptyTitle}>Queue clear</Text>
        <Text style={s.emptySubtitle}>
          No reviews match this filter. Every moderation action is captured in the Audit Trail.
        </Text>
      </View>
    );
  }, [loading, error]);

  return (
    <SafeAreaView style={s.root} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Reviews Moderation' }} />
      <FlatList
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={s.sep} />}
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
        contentContainerStyle={items.length === 0 ? s.emptyContent : s.listContent}
        showsVerticalScrollIndicator={false}
        initialNumToRender={15}
        windowSize={10}
        removeClippedSubviews
      />

      <ModerationActionSheet
        review={selected}
        onClose={() => setSelected(null)}
        onAction={handleAction}
      />
    </SafeAreaView>
  );
}

// ── Row ──────────────────────────────────────────────────────────────────
const ReviewModerationRow: React.FC<{
  review: ReviewWithParties;
  onPress: () => void;
}> = React.memo(({ review, onPress }) => {
  const meta = MODERATION_LABELS[review.moderation_status];
  const reviewerName = formatReviewerName(review.reviewer);
  const reviewerInitials = formatInitials(review.reviewer);
  const reviewerRole = formatRoleLabel(review.reviewer?.role);
  const revieweeName = formatReviewerName(review.reviewee);
  const time = formatRelativeTime(review.created_at);

  return (
    <TouchableOpacity activeOpacity={0.78} onPress={onPress} style={s.row}>
      {/* Severity strip */}
      <View style={[s.severityBar, { backgroundColor: meta.color }]} />

      <View style={s.rowMain}>
        {/* Top: reviewer → reviewee */}
        <View style={s.topRow}>
          <View style={s.avatarFallback}>
            <Text style={s.avatarInitials}>{reviewerInitials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.fromLine} numberOfLines={1}>
              <Text style={s.fromName}>{reviewerName}</Text>
              {reviewerRole ? <Text style={s.roleMuted}>  ({reviewerRole})</Text> : null}
              <Text style={s.arrow}>  →  </Text>
              <Text style={s.toName}>{revieweeName}</Text>
            </Text>
            <View style={s.metaRow}>
              <View style={s.starsInline}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Ionicons
                    key={n}
                    name={review.rating >= n ? 'star' : 'star-outline'}
                    size={11}
                    color={C.amber}
                  />
                ))}
              </View>
              <Text style={s.timeText}>{time}</Text>
              {!review.is_public && (
                <>
                  <View style={s.metaDot} />
                  <Ionicons name="lock-closed" size={10} color={C.textMuted} />
                </>
              )}
              {review.private_admin_note && (
                <>
                  <View style={s.metaDot} />
                  <Ionicons name="bulb" size={10} color={C.amber} />
                </>
              )}
            </View>
          </View>
          <View style={[s.statusBadge, { backgroundColor: meta.bg }]}>
            <Text style={[s.statusBadgeText, { color: meta.color }]}>
              {meta.label.toUpperCase()}
            </Text>
          </View>
        </View>

        {review.comment && (
          <Text style={s.commentText} numberOfLines={2}>{review.comment}</Text>
        )}
      </View>

      <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
    </TouchableOpacity>
  );
});

// ── Action sheet ─────────────────────────────────────────────────────────
const ModerationActionSheet: React.FC<{
  review: ReviewWithParties | null;
  onClose: () => void;
  onAction: (review: ReviewWithParties, action: ModerateAction, notes?: string) => void;
}> = ({ review, onClose, onAction }) => {
  const [notesMode, setNotesMode] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!review) {
      setNotesMode(false);
      setNotes('');
    }
  }, [review]);

  if (!review) {
    return <Modal visible={false} transparent animationType="slide" onRequestClose={onClose} />;
  }

  const status = review.moderation_status;

  const actions: { action: ModerateAction; label: string; icon: string; color: string; hidden?: boolean }[] = [
    { action: 'hide',    label: 'Hide review',    icon: 'eye-off',        color: C.textSecondary, hidden: status === 'hidden' },
    { action: 'unhide',  label: 'Unhide review',  icon: 'eye',            color: C.green,          hidden: status !== 'hidden' },
    { action: 'dispute', label: 'Mark disputed',  icon: 'alert-circle',   color: C.amber,          hidden: status === 'disputed' },
    { action: 'flag',    label: 'Flag for review', icon: 'flag',          color: C.red,            hidden: status === 'flagged' },
  ];

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation?.()}>
          <View style={s.handleRow}>
            <View style={s.handle} />
          </View>

          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>Moderate Review</Text>
            <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.7}>
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Review summary */}
          <View style={s.sheetReviewBox}>
            <View style={s.sheetStarsRow}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Ionicons
                  key={n}
                  name={review.rating >= n ? 'star' : 'star-outline'}
                  size={14}
                  color={C.amber}
                />
              ))}
              <Text style={s.sheetRating}>{review.rating} / 5</Text>
            </View>
            <Text style={s.sheetFrom} numberOfLines={1}>
              {formatReviewerName(review.reviewer)} → {formatReviewerName(review.reviewee)}
            </Text>
            {review.comment && (
              <Text style={s.sheetComment} numberOfLines={4}>{review.comment}</Text>
            )}
            {review.private_admin_note && (
              <View style={s.privateBox}>
                <Ionicons name="bulb" size={11} color={C.amber} />
                <Text style={s.privateText} numberOfLines={4}>
                  Private to admin: {review.private_admin_note}
                </Text>
              </View>
            )}
            {review.moderator_notes && (
              <View style={s.modNotesBox}>
                <Text style={s.modNotesLabel}>Moderator notes</Text>
                <Text style={s.modNotesText}>{review.moderator_notes}</Text>
              </View>
            )}
          </View>

          {/* Notes input mode */}
          {notesMode ? (
            <View style={s.notesSection}>
              <TextInput
                style={s.notesInput}
                value={notes}
                onChangeText={setNotes}
                multiline
                numberOfLines={3}
                placeholder="Add a moderator note (required)…"
                placeholderTextColor={C.textMuted}
                textAlignVertical="top"
                autoFocus
                maxLength={500}
              />
              <View style={s.notesRow}>
                <TouchableOpacity
                  style={s.secondaryBtn}
                  onPress={() => { setNotesMode(false); setNotes(''); }}
                  activeOpacity={0.85}
                >
                  <Text style={s.secondaryBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.primaryBtn, !notes.trim() && s.primaryBtnDisabled]}
                  disabled={!notes.trim()}
                  onPress={() => onAction(review, 'note', notes.trim())}
                  activeOpacity={0.85}
                >
                  <Text style={s.primaryBtnText}>Save Note</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={s.actionsList}>
              {actions
                .filter((a) => !a.hidden)
                .map((a) => (
                  <TouchableOpacity
                    key={a.action}
                    style={s.actionRow}
                    onPress={() => onAction(review, a.action)}
                    activeOpacity={0.8}
                  >
                    <View style={[s.actionIcon, { backgroundColor: a.color + '22' }]}>
                      <Ionicons name={a.icon as any} size={16} color={a.color} />
                    </View>
                    <Text style={s.actionText}>{a.label}</Text>
                    <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
                  </TouchableOpacity>
                ))}
              <TouchableOpacity
                style={s.actionRow}
                onPress={() => setNotesMode(true)}
                activeOpacity={0.8}
              >
                <View style={[s.actionIcon, { backgroundColor: C.primaryBg }]}>
                  <Ionicons name="create-outline" size={16} color={C.primaryLight} />
                </View>
                <Text style={s.actionText}>Add moderator note</Text>
                <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  // Filter strip
  filterStrip: {
    backgroundColor: C.surfaceDeep,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingVertical: 10,
  },
  filterStripContent: {
    paddingHorizontal: 16,
    gap: 7,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    minHeight: 30,
  },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 11, fontWeight: '700', color: C.textSecondary, letterSpacing: 0.3 },
  chipTextActive: { color: '#FFF' },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bg,
    paddingRight: 14,
    paddingVertical: 13,
  },
  severityBar: {
    width: 3,
    alignSelf: 'stretch',
    marginRight: 11,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  rowMain: { flex: 1, gap: 6 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatarFallback: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.primaryBorder,
  },
  avatarInitials: {
    fontSize: 10,
    fontWeight: '800',
    color: C.primaryLight,
    letterSpacing: 0.4,
  },
  fromLine: {
    fontSize: 12,
    color: C.textPrimary,
  },
  fromName: { fontWeight: '800', color: C.textPrimary },
  toName:   { fontWeight: '800', color: C.textPrimary },
  arrow:    { color: C.textMuted },
  roleMuted: { color: C.textMuted, fontWeight: '500' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  starsInline: { flexDirection: 'row', gap: 1 },
  timeText: {
    fontSize: 10.5,
    color: C.textMuted,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },
  metaDot: {
    width: 2, height: 2, borderRadius: 1,
    backgroundColor: C.textMuted,
    marginHorizontal: 1,
  },
  statusBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  commentText: {
    fontSize: 12,
    color: C.textSecondary,
    lineHeight: 16,
    paddingLeft: 38,
  },
  sep: {
    height: 1,
    backgroundColor: C.borderSoft,
    marginLeft: 14,
  },

  listContent: { paddingBottom: 32 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },

  // Empty / loading / footer
  center: { paddingVertical: 60, alignItems: 'center' },
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
    fontSize: 14, fontWeight: '800', color: C.textPrimary,
    letterSpacing: 0.1, marginBottom: 4,
  },
  emptySubtitle: {
    fontSize: 12, color: C.textMuted,
    textAlign: 'center', lineHeight: 17, maxWidth: 280,
  },
  footerLoader: { paddingVertical: 22, alignItems: 'center' },
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

  // ── Action sheet ──────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: C.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: Platform.select({ ios: 28, android: 20, default: 20 }),
    maxHeight: '88%',
  },
  handleRow: { alignItems: 'center', paddingVertical: 6 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: C.border },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 12,
    gap: 12,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.1,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.surfaceLight,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetReviewBox: {
    backgroundColor: C.surfaceDeep,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  sheetStarsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheetRating: {
    fontSize: 12,
    fontWeight: '800',
    color: C.textPrimary,
    marginLeft: 4,
    letterSpacing: 0.2,
  },
  sheetFrom: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: '600',
  },
  sheetComment: {
    fontSize: 13,
    color: C.textPrimary,
    lineHeight: 18,
    marginTop: 2,
  },
  privateBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(245,158,11,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.30)',
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
  },
  privateText: {
    flex: 1,
    fontSize: 11,
    color: C.amber,
    lineHeight: 15,
    fontWeight: '600',
  },
  modNotesBox: {
    backgroundColor: 'rgba(124,58,237,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)',
    borderRadius: 8,
    padding: 8,
    marginTop: 4,
  },
  modNotesLabel: {
    fontSize: 9,
    color: C.primaryLight,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  modNotesText: {
    fontSize: 11,
    color: C.textSecondary,
    lineHeight: 15,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },

  // Actions list
  actionsList: { gap: 6 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: C.surfaceLight,
    borderWidth: 1,
    borderColor: C.border,
  },
  actionIcon: {
    width: 32, height: 32, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  actionText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.2,
  },

  // Notes mode
  notesSection: { gap: 10 },
  notesInput: {
    minHeight: 80,
    backgroundColor: C.surfaceDeep,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    color: C.textPrimary,
    fontSize: 13,
    padding: 11,
    lineHeight: 18,
  },
  notesRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryBtn: {
    flex: 1,
    backgroundColor: C.primary,
    borderRadius: 11,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  secondaryBtn: {
    flex: 1,
    backgroundColor: C.surfaceLight,
    borderRadius: 11,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  secondaryBtnText: {
    color: C.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
