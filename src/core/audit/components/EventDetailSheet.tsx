// ════════════════════════════════════════════════════════════════════════════
//  src/components/audit/EventDetailSheet.tsx
//  NEXPEC — Industrial Black Box (Patch 4 / v1)
//
//  Slide-up bottom sheet that displays the full payload of one AuditEvent:
//    • Header: event-type icon, severity badge, summary headline
//    • Meta:   actor, role, absolute timestamp, optional intent
//    • Diff:   field-by-field before/after, monospace, cents/date pretty
//    • Raw:    optional expand to see the full JSON payload
//
//  Uses the same React Native <Modal animationType="slide" /> pattern as
//  RadiusPickerSheet so it inherits NEXPEC theming + behavior with zero
//  new providers.
// ════════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  AuditEvent,
  formatAbsoluteTime,
  formatFieldValue,
  getEventTypeMeta,
  getSeverityMeta,
  isSensitivePricingField,
} from '@/src/lib/audit';

// ═══════════════════════════════════════════════════════════════════════════
//  THEME (NEXPEC dark/purple — locked)
// ═══════════════════════════════════════════════════════════════════════════
const C = {
  bg:              '#020420',
  surface:         '#0A0E2E',
  surfaceElevated: '#111640',
  surfaceDeep:     '#070A24',
  border:          '#1A1F4E',
  primary:         '#7C3AED',
  primaryLight:    '#8B5CF6',
  primaryBg:       'rgba(124, 58, 237, 0.12)',
  blue:            '#3B82F6',
  green:           '#10B981',
  amber:           '#F59E0B',
  red:             '#EF4444',
  textPrimary:     '#F8FAFC',
  textSecondary:   '#94A3B8',
  textMuted:       '#64748B',
  textDim:         '#475569',
  // diff colors
  diffMinus:       '#EF4444',
  diffMinusBg:     'rgba(239,68,68,0.08)',
  diffPlus:        '#10B981',
  diffPlusBg:      'rgba(16,185,129,0.08)',
  backdrop:        'rgba(0, 0, 0, 0.72)',
};

// ═══════════════════════════════════════════════════════════════════════════
//  PROPS
// ═══════════════════════════════════════════════════════════════════════════
export interface EventDetailSheetProps {
  /** Event to display. `null` means the sheet is closed. */
  event: AuditEvent | null;
  onClose: () => void;
  /**
   * Admin/privileged viewer. When false (default — every buyer, supplier and
   * inspector surface), sensitive pricing fields are filtered out of the diff
   * and the raw-payload section is hidden entirely. Price-blindness guard.
   */
  privileged?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DIFF ROW
// ═══════════════════════════════════════════════════════════════════════════
const DiffRow: React.FC<{
  fieldKey: string;
  before: any;
  after: any;
}> = React.memo(({ fieldKey, before, after }) => {
  const beforeUndefined = before === undefined;
  const afterUndefined  = after  === undefined;
  const beforeStr = beforeUndefined ? null : formatFieldValue(fieldKey, before);
  const afterStr  = afterUndefined  ? null : formatFieldValue(fieldKey, after);

  return (
    <View style={s.diffField}>
      <Text style={s.diffKey}>{fieldKey}</Text>
      {beforeStr !== null && (
        <View style={s.diffLine}>
          <Text style={[s.diffMarker, { color: C.diffMinus }]}>−</Text>
          <View style={[s.diffValueWrap, { backgroundColor: C.diffMinusBg }]}>
            <Text style={[s.diffValue, { color: C.diffMinus }]}>{beforeStr}</Text>
          </View>
        </View>
      )}
      {afterStr !== null && (
        <View style={s.diffLine}>
          <Text style={[s.diffMarker, { color: C.diffPlus }]}>+</Text>
          <View style={[s.diffValueWrap, { backgroundColor: C.diffPlusBg }]}>
            <Text style={[s.diffValue, { color: C.diffPlus }]}>{afterStr}</Text>
          </View>
        </View>
      )}
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
const EventDetailSheet: React.FC<EventDetailSheetProps> = ({ event, onClose, privileged = false }) => {
  const [showRaw, setShowRaw] = useState(false);

  // Compute the union of keys across delta.before + delta.after so we
  // render every changed field (insert-only events have only `after`,
  // delete-only have only `before`, updates have both).
  const diffEntries = useMemo(() => {
    if (!event) return [];
    const before = event.delta?.before ?? {};
    const after  = event.delta?.after  ?? {};
    let keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    // ★ PRICE-BLINDNESS — never render inspector payout or platform spread/margin
    //   to a non-privileged viewer, even if an unredacted event somehow reaches
    //   this sheet (the fetch layer already strips them; this is defense in depth).
    if (!privileged) keys = keys.filter((k) => !isSensitivePricingField(k));
    // Show summary-critical fields first
    const PRIORITY = [
      'status', 'contractor_id', 'client_id', 'agency_id',
      'client_price_cents', 'payout_amount_cents', 'platform_spread_cents',
      'inspector_payout_cents', 'payout_status', 'escrow_status',
      'scheduled_date', 'admin_confirmed_at', 'title', 'description',
    ];
    keys.sort((a, b) => {
      const ia = PRIORITY.indexOf(a);
      const ib = PRIORITY.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ key: k, before: before[k], after: after[k] }));
  }, [event, privileged]);

  if (!event) {
    // Render an inert Modal so animation state doesn't get stuck.
    return <Modal visible={false} transparent animationType="slide" onRequestClose={onClose} />;
  }

  const typeMeta = getEventTypeMeta(event.event_type);
  const sevMeta  = getSeverityMeta(event.severity);
  const intent   = event.metadata?.intent;
  const correlation = event.correlation_id;

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

          {/* ─── Header ─────────────────────────────────────── */}
          <View style={s.header}>
            <View style={[s.iconWrap, { backgroundColor: typeMeta.color + '22', borderColor: typeMeta.color + '55' }]}>
              <Ionicons name={typeMeta.icon as any} size={20} color={typeMeta.color} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={s.headerTopRow}>
                <Text style={s.eventType} numberOfLines={1}>{event.event_type}</Text>
                <View style={[s.severityBadge, { backgroundColor: sevMeta.bg }]}>
                  <Text style={[s.severityBadgeText, { color: sevMeta.color }]}>
                    {sevMeta.label.toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={s.summary} numberOfLines={3}>{event.summary}</Text>
            </View>
            <TouchableOpacity
              style={s.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.scroll}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* ─── Actor / timestamp meta strip ───────────────── */}
            <View style={s.metaCard}>
              <View style={s.metaRow}>
                <Ionicons name="person-circle-outline" size={14} color={C.textMuted} />
                <Text style={s.metaLabel}>Actor</Text>
                <Text style={s.metaValue} numberOfLines={1}>
                  {event.actor_label ?? 'Unknown'}
                  {event.actor_role && (
                    <Text style={s.metaRoleSuffix}>, {event.actor_role}</Text>
                  )}
                </Text>
              </View>
              <View style={s.metaSep} />
              <View style={s.metaRow}>
                <Ionicons name="time-outline" size={14} color={C.textMuted} />
                <Text style={s.metaLabel}>Time</Text>
                <Text style={s.metaValue} numberOfLines={1}>
                  {formatAbsoluteTime(event.created_at)}
                </Text>
              </View>
              <View style={s.metaSep} />
              <View style={s.metaRow}>
                <Ionicons name="cube-outline" size={14} color={C.textMuted} />
                <Text style={s.metaLabel}>Subject</Text>
                <Text style={s.metaValue} numberOfLines={1}>
                  {event.subject_table}, {event.subject_id.slice(0, 8)}…
                </Text>
              </View>
              {intent && (
                <>
                  <View style={s.metaSep} />
                  <View style={s.metaRow}>
                    <Ionicons name="bulb-outline" size={14} color={C.primary} />
                    <Text style={[s.metaLabel, { color: C.primary }]}>Intent</Text>
                    <Text style={[s.metaValue, { color: C.textPrimary }]} numberOfLines={2}>
                      {intent}
                    </Text>
                  </View>
                </>
              )}
              {correlation && (
                <>
                  <View style={s.metaSep} />
                  <View style={s.metaRow}>
                    <Ionicons name="git-network-outline" size={14} color={C.textMuted} />
                    <Text style={s.metaLabel}>Trace</Text>
                    <Text style={[s.metaValue, s.monoTiny]} numberOfLines={1}>
                      {correlation}
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* ─── Diff section ──────────────────────────────── */}
            {diffEntries.length > 0 && (
              <View style={s.sectionCard}>
                <View style={s.sectionHeaderRow}>
                  <Ionicons name="git-compare-outline" size={14} color={C.primaryLight} />
                  <Text style={s.sectionTitle}>Changes</Text>
                  <Text style={s.sectionCount}>{diffEntries.length}</Text>
                </View>
                {diffEntries.map((d) => (
                  <DiffRow
                    key={d.key}
                    fieldKey={d.key}
                    before={d.before}
                    after={d.after}
                  />
                ))}
              </View>
            )}

            {/* ─── Raw payload (collapsible) — ADMIN ONLY ─────── */}
            {/* The raw JSON dumps the full delta + metadata. For any non-admin
                viewer this is hidden entirely so internal pricing can never
                leak through the raw view (price-blindness / anti-poaching). */}
            {privileged && (
              <>
                <TouchableOpacity
                  style={s.rawToggle}
                  onPress={() => setShowRaw((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={showRaw ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={C.textSecondary}
                  />
                  <Text style={s.rawToggleText}>
                    {showRaw ? 'Hide raw payload' : 'Show raw payload'}
                  </Text>
                </TouchableOpacity>
                {showRaw && (
                  <View style={s.rawCard}>
                    <Text style={s.rawCode} selectable>
                      {JSON.stringify(
                        {
                          delta: event.delta,
                          metadata: event.metadata,
                        },
                        null,
                        2,
                      )}
                    </Text>
                  </View>
                )}
              </>
            )}

            <View style={{ height: 12 }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default React.memo(EventDetailSheet);

// ═══════════════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
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

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 8,
    paddingBottom: 14,
    gap: 0,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  eventType: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: C.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  severityBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  severityBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  summary: {
    fontSize: 15,
    fontWeight: '700',
    color: C.textPrimary,
    letterSpacing: 0.1,
    lineHeight: 20,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },

  scroll: { flexShrink: 1 },
  scrollContent: { paddingBottom: 8 },

  // ── Meta card ────────────────────────────────────────────
  metaCard: {
    backgroundColor: C.surfaceDeep,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    gap: 8,
  },
  metaSep: { height: 1, backgroundColor: C.border, marginHorizontal: -12 },
  metaLabel: {
    fontSize: 10,
    color: C.textMuted,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    width: 56,
  },
  metaValue: {
    flex: 1,
    fontSize: 13,
    color: C.textPrimary,
    fontWeight: '600',
    textAlign: 'right',
  },
  metaRoleSuffix: {
    color: C.textMuted,
    fontWeight: '500',
  },
  monoTiny: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 10,
    color: C.textMuted,
  },

  // ── Section / diff ───────────────────────────────────────
  sectionCard: {
    backgroundColor: C.surfaceDeep,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionCount: {
    fontSize: 11,
    fontWeight: '800',
    color: C.primaryLight,
    backgroundColor: C.primaryBg,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },

  diffField: {
    marginBottom: 8,
    paddingTop: 6,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  diffKey: {
    fontSize: 11,
    fontWeight: '700',
    color: C.primaryLight,
    letterSpacing: 0.3,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    marginBottom: 6,
  },
  diffLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 3,
  },
  diffMarker: {
    fontSize: 13,
    fontWeight: '800',
    width: 12,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  diffValueWrap: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  diffValue: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    lineHeight: 17,
  },

  // ── Raw payload toggle ───────────────────────────────────
  rawToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  rawToggleText: {
    fontSize: 12,
    color: C.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  rawCard: {
    backgroundColor: C.surfaceDeep,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    padding: 12,
  },
  rawCode: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 10.5,
    color: C.textSecondary,
    lineHeight: 15,
  },
});
