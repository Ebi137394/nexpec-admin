// ════════════════════════════════════════════════════════════════════════════
//  src/components/audit/AuditTimeline.tsx
//  NEXPEC — Industrial Black Box (Patch 3 / v1)
//
//  Reusable timeline component. One screen of code; three host surfaces:
//    1. Admin Command Center  — `<AuditTimeline asAdmin showHeader />`
//    2. Per-job drawer        — `<AuditTimeline jobId={id} asAdmin />`
//    3. Inspector/Client view — `<AuditTimeline jobId={id} />` (RLS-filtered)
//
//  Visual identity is "fintech command center":
//    • Dense full-bleed rows
//    • Severity color bar at the left edge of each row
//    • Icon-circle + summary + actor/role/time meta strip + chevron
//    • Filter strip on top (category chips + critical-only + search)
//    • Tap any row → EventDetailSheet slides up with the full diff
//
//  Theme is locked to NEXPEC (#020420 / #7C3AED).
// ════════════════════════════════════════════════════════════════════════════

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
  type ListRenderItem,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import {
  AuditEvent,
  EventCategory,
  CATEGORY_META,
  fetchAuditEvents,
  formatRelativeTime,
  getEventTypeMeta,
  getSeverityMeta,
} from '@/src/lib/audit';
import EventDetailSheet from './EventDetailSheet';

// ═══════════════════════════════════════════════════════════════════════════
//  THEME (NEXPEC — locked)
// ═══════════════════════════════════════════════════════════════════════════
const C = {
  bg:              '#020420',
  surface:         '#0A0E2E',
  surfaceElevated: '#111640',
  surfaceDeep:     '#070A24',
  border:          '#1A1F4E',
  borderSoft:      'rgba(26,31,78,0.5)',
  primary:         '#7C3AED',
  primaryLight:    '#8B5CF6',
  primaryBg:       'rgba(124, 58, 237, 0.12)',
  primaryBorder:   'rgba(124, 58, 237, 0.40)',
  blue:            '#3B82F6',
  green:           '#10B981',
  amber:           '#F59E0B',
  red:             '#EF4444',
  textPrimary:     '#F8FAFC',
  textSecondary:   '#94A3B8',
  textMuted:       '#64748B',
  textDim:         '#475569',
};

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

// ═══════════════════════════════════════════════════════════════════════════
//  PROPS
// ═══════════════════════════════════════════════════════════════════════════
export interface AuditTimelineProps {
  /** Limit to a single job (per-job drawer). */
  jobId?: string;
  /** Query unmasked audit_events (admin) vs audit_events_public (everyone). */
  asAdmin?: boolean;
  /** Show the filter strip + search bar. Default true. */
  showHeader?: boolean;
  /** Empty-state copy. */
  emptyTitle?: string;
  emptySubtitle?: string;
  /**
   * Inline mode: embed inside a parent ScrollView (job detail screens).
   *   - Disables FlatList scrolling (parent handles scroll)
   *   - Container sizes to content, not flex:1
   *   - Drops pull-to-refresh
   * Filter strip + detail sheet still work.
   */
  inline?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FILTER STATE
// ═══════════════════════════════════════════════════════════════════════════
type CategoryFilter = EventCategory | 'all';

const CATEGORY_ORDER: CategoryFilter[] = [
  'all',
  'status',
  'pricing',
  'hiring',
  'money',
  'reporting',
];

// ═══════════════════════════════════════════════════════════════════════════
//  ROW
// ═══════════════════════════════════════════════════════════════════════════
interface AuditRowProps {
  event: AuditEvent;
  onPress: (id: string) => void;
}

const AuditEventRow: React.FC<AuditRowProps> = React.memo(({ event, onPress }) => {
  const typeMeta = getEventTypeMeta(event.event_type);
  const sevMeta  = getSeverityMeta(event.severity);
  const handlePress = useCallback(() => onPress(event.id), [onPress, event.id]);

  return (
    <TouchableOpacity activeOpacity={0.78} onPress={handlePress} style={s.row}>
      {/* Left severity bar — the scannable rhythm */}
      <View style={[s.severityBar, { backgroundColor: sevMeta.color }]} />

      {/* Event-type icon */}
      <View
        style={[
          s.iconCircle,
          {
            backgroundColor: typeMeta.color + '1F',
            borderColor:    typeMeta.color + '4D',
          },
        ]}
      >
        <Ionicons name={typeMeta.icon as any} size={15} color={typeMeta.color} />
      </View>

      {/* Main content */}
      <View style={s.rowMain}>
        <Text style={s.rowSummary} numberOfLines={1}>{event.summary}</Text>
        <View style={s.rowMeta}>
          <Text style={s.rowActor} numberOfLines={1}>
            {event.actor_label ?? 'Unknown'}
            {event.actor_role && (
              <Text style={s.rowRole}>  ·  {event.actor_role}</Text>
            )}
          </Text>
          <Text style={s.rowTime}>{formatRelativeTime(event.created_at)}</Text>
        </View>
      </View>

      {event.severity === 'critical' && (
        <View style={s.criticalDot} />
      )}
      <Ionicons name="chevron-forward" size={14} color={C.textDim} style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
//  CATEGORY CHIP
// ═══════════════════════════════════════════════════════════════════════════
const CategoryChip: React.FC<{
  value: CategoryFilter;
  active: boolean;
  onPress: (v: CategoryFilter) => void;
}> = React.memo(({ value, active, onPress }) => {
  const meta = value === 'all'
    ? { label: 'All', icon: 'apps-outline' as const }
    : CATEGORY_META[value as EventCategory];

  return (
    <TouchableOpacity
      style={[s.chip, active && s.chipActive]}
      onPress={() => onPress(value)}
      activeOpacity={0.8}
    >
      <Ionicons
        name={(meta as any).icon}
        size={13}
        color={active ? '#FFF' : C.textMuted}
        style={{ marginRight: 5 }}
      />
      <Text style={[s.chipText, active && s.chipTextActive]}>{meta.label}</Text>
    </TouchableOpacity>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
const AuditTimeline: React.FC<AuditTimelineProps> = ({
  jobId,
  asAdmin = false,
  showHeader = true,
  emptyTitle,
  emptySubtitle,
  inline = false,
}) => {
  // ── Filter state ───────────────────────────────────────────────────────
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // ── Data state ────────────────────────────────────────────────────────
  const [events, setEvents]       = useState<AuditEvent[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // ── Detail-sheet state ────────────────────────────────────────────────
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const requestIdRef = useRef(0);

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // ── Fetch ─────────────────────────────────────────────────────────────
  const load = useCallback(
    async ({ isRefresh = false, append = false }: { isRefresh?: boolean; append?: boolean } = {}) => {
      const myReq = ++requestIdRef.current;

      if (isRefresh) setRefreshing(true);
      else if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const rows = await fetchAuditEvents({
          jobId,
          asAdmin,
          category,
          minSeverity: criticalOnly ? 'critical' : undefined,
          search: debouncedSearch || undefined,
          limit: PAGE_SIZE,
          offset: append ? events.length : 0,
        });

        if (myReq !== requestIdRef.current) return;

        setHasMore(rows.length === PAGE_SIZE);
        setEvents((prev) => (append ? [...prev, ...rows] : rows));
      } catch (e: any) {
        if (myReq !== requestIdRef.current) return;
        console.error('[AuditTimeline] fetch error:', e?.message ?? e);
        setError(e?.message ?? 'Failed to load events');
        if (!append) setEvents([]);
      } finally {
        if (myReq === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [jobId, asAdmin, category, criticalOnly, debouncedSearch, events.length],
  );

  // Initial + on-filter-change load
  useEffect(() => {
    load({ isRefresh: false, append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, asAdmin, category, criticalOnly, debouncedSearch]);

  // Refresh on screen focus (catches events created elsewhere in the app)
  useFocusEffect(
    useCallback(() => {
      load({ isRefresh: true, append: false });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobId, asAdmin, category, criticalOnly, debouncedSearch]),
  );

  const onRefresh = useCallback(() => load({ isRefresh: true }), [load]);
  const onLoadMore = useCallback(() => {
    if (loadingMore || !hasMore || loading) return;
    load({ append: true });
  }, [load, loadingMore, hasMore, loading]);

  // ── Tap row → open detail sheet ────────────────────────────────────────
  const handleRowPress = useCallback(
    (id: string) => {
      const ev = events.find((e) => e.id === id);
      if (ev) setSelected(ev);
    },
    [events],
  );
  const handleCloseSheet = useCallback(() => setSelected(null), []);

  // ── Filter strip ──────────────────────────────────────────────────────
  const FilterStrip = useMemo(() => {
    if (!showHeader) return null;
    return (
      <View style={s.filterStrip}>
        {/* Search */}
        <View style={s.searchWrap}>
          <Ionicons name="search" size={14} color={C.textMuted} />
          <TextInput
            style={s.searchInput}
            placeholder="Search audit events…"
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={14} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Chip row */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipScroll}
        >
          {/* Critical-only toggle — first, distinct purple-ring style */}
          <TouchableOpacity
            style={[s.chip, s.criticalChip, criticalOnly && s.criticalChipActive]}
            onPress={() => setCriticalOnly((v) => !v)}
            activeOpacity={0.8}
          >
            <Ionicons
              name="alert-circle"
              size={13}
              color={criticalOnly ? '#FFF' : C.red}
              style={{ marginRight: 5 }}
            />
            <Text style={[s.chipText, criticalOnly && s.chipTextActive, !criticalOnly && { color: C.red }]}>
              Critical Only
            </Text>
          </TouchableOpacity>

          {CATEGORY_ORDER.map((c) => (
            <CategoryChip
              key={c}
              value={c}
              active={category === c}
              onPress={setCategory}
            />
          ))}
        </ScrollView>
      </View>
    );
  }, [showHeader, search, criticalOnly, category]);

  // ── Renderers ─────────────────────────────────────────────────────────
  const keyExtractor = useCallback((item: AuditEvent) => item.id, []);

  const renderItem: ListRenderItem<AuditEvent> = useCallback(
    ({ item }) => <AuditEventRow event={item} onPress={handleRowPress} />,
    [handleRowPress],
  );

  const ListFooter = useMemo(() => {
    if (loadingMore) {
      return (
        <View style={s.footerLoader}>
          <ActivityIndicator size="small" color={C.primary} />
        </View>
      );
    }
    if (events.length > 0 && hasMore) {
      return (
        <TouchableOpacity
          style={s.loadMoreBtn}
          onPress={onLoadMore}
          activeOpacity={0.8}
        >
          <Text style={s.loadMoreText}>Load older events</Text>
          <Ionicons name="arrow-down" size={13} color={C.primaryLight} />
        </TouchableOpacity>
      );
    }
    return null;
  }, [loadingMore, hasMore, events.length, onLoadMore]);

  const ListEmpty = useMemo(() => {
    if (loading) {
      return (
        <View style={s.emptyWrap}>
          <ActivityIndicator size="large" color={C.primary} />
        </View>
      );
    }
    if (error) {
      return (
        <View style={s.emptyWrap}>
          <View style={[s.emptyIcon, { backgroundColor: 'rgba(239,68,68,0.12)' }]}>
            <Ionicons name="alert-circle-outline" size={28} color={C.red} />
          </View>
          <Text style={s.emptyTitle}>Couldn't load events</Text>
          <Text style={s.emptySubtitle}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => load()} activeOpacity={0.8}>
            <Ionicons name="refresh" size={14} color={C.primaryLight} />
            <Text style={s.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={s.emptyWrap}>
        <View style={s.emptyIcon}>
          <Ionicons name="document-text-outline" size={28} color={C.primaryLight} />
        </View>
        <Text style={s.emptyTitle}>{emptyTitle ?? 'No events yet'}</Text>
        <Text style={s.emptySubtitle}>
          {emptySubtitle ??
            (jobId
              ? 'No audit events for this job yet. Changes will appear here in real time.'
              : 'Audit events show up here as soon as something happens on the platform.')}
        </Text>
      </View>
    );
  }, [loading, error, emptyTitle, emptySubtitle, jobId, load]);

  return (
    <View style={inline ? s.containerInline : s.container}>
      {FilterStrip}

      <FlatList
        data={events}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListFooterComponent={ListFooter}
        ListEmptyComponent={ListEmpty}
        // In inline mode the parent ScrollView owns scrolling — disable
        // virtualization to prevent nested-scroll warnings and ensure
        // the full list lays out in natural height.
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
        showsVerticalScrollIndicator={false}
        initialNumToRender={inline ? 50 : 15}
        windowSize={inline ? 50 : 10}
        maxToRenderPerBatch={inline ? 50 : 10}
        removeClippedSubviews={!inline}
        contentContainerStyle={
          events.length === 0 ? s.emptyContent : s.listContent
        }
        ItemSeparatorComponent={ItemSep}
      />

      <EventDetailSheet event={selected} onClose={handleCloseSheet} />
    </View>
  );
};

const ItemSep = () => <View style={s.itemSep} />;

export default React.memo(AuditTimeline);

// ═══════════════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  // Inline mode: no flex:1, content sizes to its own height so it nests
  // safely inside a parent ScrollView (per-job drawer use cases).
  containerInline: { backgroundColor: 'transparent' },

  // ── Filter strip ─────────────────────────────────────────
  filterStrip: {
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.surfaceDeep,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: C.textPrimary,
    padding: 0,
  },
  chipScroll: {
    gap: 7,
    paddingHorizontal: 16,
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
  chipActive: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
    color: C.textSecondary,
    letterSpacing: 0.3,
  },
  chipTextActive: { color: '#FFF' },

  criticalChip: {
    borderColor: 'rgba(239,68,68,0.45)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  criticalChipActive: {
    borderColor: C.red,
    backgroundColor: C.red,
  },

  // ── Row ──────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bg,
    paddingRight: 14,
    paddingVertical: 13,
    paddingLeft: 0,
    overflow: 'hidden',
  },
  severityBar: {
    width: 3,
    alignSelf: 'stretch',
    marginRight: 11,
    marginLeft: 0,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginRight: 11,
  },
  rowMain: { flex: 1 },
  rowSummary: {
    fontSize: 13.5,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.1,
    marginBottom: 3,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowActor: {
    flex: 1,
    fontSize: 11.5,
    color: C.textSecondary,
    fontWeight: '500',
  },
  rowRole: {
    color: C.textMuted,
    fontWeight: '500',
  },
  rowTime: {
    fontSize: 10.5,
    color: C.textMuted,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
  criticalDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.red,
    marginLeft: 4,
  },

  itemSep: {
    height: 1,
    backgroundColor: C.borderSoft,
    marginLeft: 14 + 3 + 11,  // align with content past severity bar + icon
  },

  // ── List ─────────────────────────────────────────────────
  listContent: { paddingBottom: 32, paddingTop: 4 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },

  // ── Empty / loading / error ──────────────────────────────
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 28,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: C.primaryBg,
    borderWidth: 1,
    borderColor: C.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 12,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 280,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: C.primaryBg,
    borderWidth: 1,
    borderColor: C.primaryBorder,
  },
  retryText: {
    fontSize: 12,
    fontWeight: '700',
    color: C.primaryLight,
    letterSpacing: 0.3,
  },

  // ── Footer ───────────────────────────────────────────────
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
    marginTop: 14,
    marginBottom: 24,
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
