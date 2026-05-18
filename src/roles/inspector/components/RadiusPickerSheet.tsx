// ───────────────────────────────────────────────────────────────────
//  src/components/inspector/RadiusPickerSheet.tsx
//  Phase 5 — Inspector Job Feed / Discovery Engine (Step 2)
//
//  Shared bottom-sheet radius picker. Used in two places:
//
//    (1) Profile screen — "Discovery Preferences" card. The user
//        opens it, taps a segment, the parent persists the choice to
//        profiles.travel_radius_km.
//
//    (2) Job feed — "Within X km" pill. The user opens it, taps a
//        segment, the parent applies it as a SESSION-ONLY override
//        (does not persist; in-feed UX contract from the blueprint).
//
//  Six segments: 25 / 50 / 100 / 250 / 500 / ∞ (Unlimited).
//  `null` = Unlimited everywhere in this component's contract.
//
//  Behavior choices baked in:
//    • Tap-to-apply (no separate "Apply" button) — fewer taps, no
//      stale UI state if the user backs out.
//    • Tapping the same segment that's already selected just closes.
//    • Tapping the backdrop closes without changing anything.
//    • Uses plain React Native <Modal animationType="slide"> to match
//      the rest of the codebase's modal pattern (ReviewModal,
//      SignaturePadModal, ContractEditorModal). Zero new providers,
//      zero new native deps.
//
//  Theme strictly locked to NEXPEC palette:
//    background #020420, primary #7C3AED.
// ───────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ═══════════════════════════════════════════════════════════════════
//  THEME (NEXPEC dark/purple — locked)
// ═══════════════════════════════════════════════════════════════════
const C = {
  bg:              '#020420',
  surface:         '#0A0E2E',
  surfaceElevated: '#111640',
  border:          '#1A1F4E',
  primary:         '#7C3AED',
  primaryLight:    '#8B5CF6',
  primaryBg:       'rgba(124, 58, 237, 0.12)',
  primaryBorder:   'rgba(124, 58, 237, 0.40)',
  textPrimary:     '#F8FAFC',
  textSecondary:   '#94A3B8',
  textMuted:       '#64748B',
  backdrop:        'rgba(0, 0, 0, 0.65)',
};

// ═══════════════════════════════════════════════════════════════════
//  OPTIONS
// ═══════════════════════════════════════════════════════════════════
//   value === null is the canonical "Unlimited".
//   Order is significant — drawn left→right, top→bottom.
interface RadiusOption {
  value: number | null;     // null = Unlimited
  label: string;            // primary text on the segment
  caption: string;          // secondary text below
}

const OPTIONS: RadiusOption[] = [
  { value: 25,   label: '25',   caption: 'km' },
  { value: 50,   label: '50',   caption: 'km' },
  { value: 100,  label: '100',  caption: 'km' },
  { value: 250,  label: '250',  caption: 'km' },
  { value: 500,  label: '500',  caption: 'km' },
  { value: null, label: '∞',    caption: 'Unlimited' },
];

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
export function formatRadiusLabel(km: number | null | undefined): string {
  if (km === null) return 'Unlimited';
  if (km === undefined) return '—';
  return `${km} km`;
}

function radiusEqual(a: number | null, b: number | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a === b;
}

// ═══════════════════════════════════════════════════════════════════
//  PROPS
// ═══════════════════════════════════════════════════════════════════
export interface RadiusPickerSheetProps {
  /** Whether the sheet is visible. */
  visible: boolean;
  /** Currently selected radius (null = Unlimited). */
  currentRadiusKm: number | null;
  /** Optional label for the home base (e.g. "Montreal, QC"). */
  homeBaseLabel?: string | null;
  /** Called when the user taps a segment. `null` = Unlimited. */
  onSelect: (km: number | null) => void;
  /** Called when the user dismisses without changing (backdrop / close icon). */
  onClose: () => void;
  /** Header title. Defaults to "Travel Radius". */
  title?: string;
  /**
   * Optional helper line shown above the segments. If not provided,
   * a default is built from `homeBaseLabel`.
   */
  subtitle?: string;
}

// ═══════════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════════
const RadiusPickerSheet: React.FC<RadiusPickerSheetProps> = ({
  visible,
  currentRadiusKm,
  homeBaseLabel,
  onSelect,
  onClose,
  title = 'Travel Radius',
  subtitle,
}) => {
  const computedSubtitle = useMemo(() => {
    if (subtitle) return subtitle;
    const base = homeBaseLabel?.trim();
    if (base) return `Show me jobs within range of ${base}`;
    return 'Show me jobs within range of your home base';
  }, [subtitle, homeBaseLabel]);

  const handleSelect = useCallback(
    (km: number | null) => {
      onSelect(km);
      // Close after applying — single-tap commit.
      onClose();
    },
    [onSelect, onClose],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Backdrop — tap to dismiss */}
      <Pressable style={s.backdrop} onPress={onClose}>
        {/* Sheet body — stopPropagation so taps inside don't dismiss */}
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation?.()}>
          {/* Drag handle (visual only — RN Modal doesn't gesture-dismiss) */}
          <View style={s.handleRow}>
            <View style={s.handle} />
          </View>

          {/* Header */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{title}</Text>
              <Text style={s.subtitle} numberOfLines={2}>
                {computedSubtitle}
              </Text>
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

          {/* Segments — 3 columns × 2 rows */}
          <View style={s.grid}>
            {OPTIONS.map((opt) => {
              const isActive = radiusEqual(opt.value, currentRadiusKm);
              return (
                <TouchableOpacity
                  key={String(opt.value)}
                  style={[s.segment, isActive && s.segmentActive]}
                  onPress={() => handleSelect(opt.value)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      s.segmentLabel,
                      isActive && s.segmentLabelActive,
                      opt.value === null && s.segmentLabelInfinity,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  <Text
                    style={[s.segmentCaption, isActive && s.segmentCaptionActive]}
                  >
                    {opt.caption}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Footer hint */}
          <View style={s.footer}>
            <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
            <Text style={s.footerText} numberOfLines={2}>
              Closer jobs are sorted to the top. Choose Unlimited to see every
              open job, sorted by distance when possible.
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default React.memo(RadiusPickerSheet);

// ═══════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: C.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: Platform.select({ ios: 32, android: 24, default: 24 }),
  },

  handleRow: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 6,
    paddingBottom: 16,
    gap: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.2,
  },
  subtitle: {
    fontSize: 12,
    color: C.textSecondary,
    marginTop: 4,
    lineHeight: 17,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // 3×2 grid. Each segment is ~1/3 of the available row.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  segment: {
    // 3 columns: each = (total - 2*gap) / 3. We use flexBasis.
    flexBasis: '31.5%',
    flexGrow: 1,
    minHeight: 72,
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: C.primaryBg,
    borderColor: C.primary,
  },
  segmentLabel: {
    fontSize: 18,
    fontWeight: '800',
    color: C.textPrimary,
    letterSpacing: 0.2,
  },
  segmentLabelActive: {
    color: C.primaryLight,
  },
  segmentLabelInfinity: {
    fontSize: 24,            // ∞ glyph gets a little extra weight
    lineHeight: 24,
  },
  segmentCaption: {
    fontSize: 10,
    color: C.textMuted,
    marginTop: 4,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  segmentCaptionActive: {
    color: C.primary,
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingTop: 16,
    paddingHorizontal: 2,
  },
  footerText: {
    flex: 1,
    fontSize: 11,
    color: C.textMuted,
    lineHeight: 15,
  },
});
