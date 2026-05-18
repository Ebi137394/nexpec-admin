// ════════════════════════════════════════════════════════════════════════════
//  src/components/legal/LegalDocumentCard.tsx
//
//  Preview card for a single legal document, used in the Terms & Privacy
//  and Legal & Compliance section lists on the profile tab. Style matches
//  the existing NEXPEC card pattern: borderRadius: 16, subtle border at
//  0.08 opacity, icon circle with 15-20% tint.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LegalDocument } from '@/src/legal/types';
import { formatLegalDocumentDisplayId } from '@/src/legal/registry';

type ThemePalette = {
  text: string;
  textSecondary: string;
  card: string;
  cardBorder?: string;
  primary: string;
  background: string;
  isDarkMode?: boolean;
};

interface Props {
  document: LegalDocument;
  /** Optional "Accepted vX.Y · 2026-MM-DD" badge when the user has accepted this version. */
  acceptedAt?: string | null;
  /** Icon (Ionicons name) overrides the tier-default icon. */
  iconOverride?: keyof typeof Ionicons.glyphMap;
  onPress: (document: LegalDocument) => void;
  colors: ThemePalette;
  style?: ViewStyle;
}

// Tier-to-icon mapping. Keeps the card visually informative even before the
// title is read.
const TIER_ICON: Record<number, keyof typeof Ionicons.glyphMap> = {
  0: 'globe-outline',          // Framework
  1: 'document-text-outline',  // Platform-level
  2: 'people-outline',         // Role agreement
  3: 'briefcase-outline',      // Per-Job
};

// Tier-to-label for the small ribbon above the title.
const TIER_LABEL: Record<number, string> = {
  0: 'Framework',
  1: 'Platform',
  2: 'Role Agreement',
  3: 'Job-Level',
};

export const LegalDocumentCard: React.FC<Props> = ({
  document,
  acceptedAt,
  iconOverride,
  onPress,
  colors,
  style,
}) => {
  const isDark = colors.isDarkMode ?? true;
  const iconName = iconOverride ?? TIER_ICON[document.tier] ?? 'document-outline';
  // ★ LEGAL-WIRING-003 — Prefer the per-doc displayCategoryOverride
  //   ("Country Addendum", "Data Processing", "Enterprise Template")
  //   over the generic tier label where set. Falls back to the tier
  //   label for the original 10 docs that don't have an override.
  const tierLabel = document.displayCategoryOverride ?? TIER_LABEL[document.tier] ?? 'Document';

  const surfaceBg = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)';
  const surfaceBorder = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onPress(document)}
      style={[
        styles.container,
        { backgroundColor: surfaceBg, borderColor: surfaceBorder },
        style,
      ]}
    >
      {/* Icon circle */}
      <View
        style={[
          styles.iconCircle,
          { backgroundColor: colors.primary + '22', borderColor: colors.primary + '40' },
        ]}
      >
        <Ionicons name={iconName} size={20} color={colors.primary} />
      </View>

      {/* Body */}
      <View style={styles.body}>
        {/* ★ LEGAL-WIRING-002 — Display alias for ADDENDUM-FRAMEWORK-001
            (renders as ADDENDUM-FW-001 in this single visual slot;
            canonical ID preserved in URL paths, acceptance ledger,
            and `incorporates` arrays). numberOfLines lifted to 2 as
            defensive headroom for any future longer IDs. */}
        <Text style={[styles.tier, { color: colors.textSecondary }]} numberOfLines={2}>
          {tierLabel} · v{document.version} · {formatLegalDocumentDisplayId(document.id)}
        </Text>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>
          {document.title}
        </Text>
        <Text style={[styles.summary, { color: colors.textSecondary }]} numberOfLines={3}>
          {document.plainEnglishSummary}
        </Text>
        {acceptedAt ? (
          <View style={[styles.acceptedPill, { backgroundColor: colors.primary + '18' }]}>
            <Ionicons name="checkmark-circle" size={12} color={colors.primary} />
            <Text style={[styles.acceptedText, { color: colors.primary }]}>
              Accepted v{document.version} · {formatAcceptedDate(acceptedAt)}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Chevron */}
      <Ionicons
        name="chevron-forward"
        size={20}
        color={colors.textSecondary}
        style={styles.chevron}
      />
    </TouchableOpacity>
  );
};

function formatAcceptedDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    marginTop: 2,
  },
  body: { flex: 1 },
  tier: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: {
    fontSize: 15.5,
    fontWeight: '700',
    marginBottom: 4,
  },
  summary: {
    fontSize: 13,
    lineHeight: 18,
  },
  acceptedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    marginTop: 8,
    gap: 4,
  },
  acceptedText: {
    fontSize: 11,
    fontWeight: '700',
  },
  chevron: {
    marginLeft: 8,
    marginTop: 12,
  },
});

export default LegalDocumentCard;
