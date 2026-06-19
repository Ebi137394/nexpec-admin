// ════════════════════════════════════════════════════════════════════════════
//  src/components/shared/InspectionDomainBadge.tsx
//
//  Mobile passive badge — single source of truth for slug → label + icon
//  is `@nexpec/shared-core/schemas/inspectionDomain`. The only thing
//  this file does locally is map an `iconKey` to the Lucide React Native
//  component, because mobile and web use different Lucide packages.
//
//  GATING (two modes)
//  ──────────────────
//    Default (admin surfaces):
//      Renders for any domain EXCEPT 'industrial_ndt'.
//      Pass `showAlways` to force-render including 'industrial_ndt'
//      (used by the /admin/domains management page).
//
//    Strict (inspector / consumer surfaces):
//      Pass `requireLaunched={true}` together with the set of currently-
//      launched domain slugs. The badge then renders ONLY when:
//        domain ∈ launchedDomains  AND  domain !== 'industrial_ndt'
//      This is the contract the Inspector portal uses so future
//      domains stay invisible until `inspection_domains.is_launched` is
//      flipped to true at the database layer.
//
//  Locked-palette compliant. Sized for typical pill placement.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Shield, Building2, Zap, Wrench, FlaskConical, type LucideIcon } from 'lucide-react-native';
import {
  getInspectionDomainMeta,
  type InspectionDomainIconKey,
} from '@nexpec/shared-core';

// Map the abstract iconKey from shared-core → concrete Lucide RN component.
const ICON_BY_KEY: Record<
  InspectionDomainIconKey,
  LucideIcon
> = {
  shield: Shield,
  building: Building2,
  zap: Zap,
  wrench: Wrench,
  flask: FlaskConical,
};

// Locked-palette tokens — sampled from the same #7C3AED used everywhere else.
const COLORS = {
  bg: 'rgba(124, 58, 237, 0.16)',
  border: 'rgba(124, 58, 237, 0.32)',
  text: '#A78BFA',
  icon: '#7C3AED',
} as const;

export interface InspectionDomainBadgeProps {
  /** The job's `domain` column value, or null/undefined while loading. */
  domain: string | null | undefined;
  /**
   * Default false. When true, renders even for industrial_ndt (the platform
   * default). Used by the /admin/domains management page.
   */
  showAlways?: boolean;
  /**
   * Default false. When true, renders ONLY if `launchedDomains` includes
   * the given slug. Set this on every inspector / consumer surface so
   * future domains stay invisible until they're publicly launched.
   */
  requireLaunched?: boolean;
  /**
   * Active launched-domain slugs (typically fetched via the React Query
   * `useLaunchedInspectionDomains` hook on mobile). Ignored unless
   * `requireLaunched` is true.
   */
  launchedDomains?: readonly string[];
  /** Visual size. Default 'sm'. */
  size?: 'sm' | 'md';
}

export function InspectionDomainBadge({
  domain,
  showAlways = false,
  requireLaunched = false,
  launchedDomains,
  size = 'sm',
}: InspectionDomainBadgeProps) {
  if (!domain) return null;

  const meta = getInspectionDomainMeta(domain);
  if (!meta) return null; // unknown future slug — render nothing rather than ugly fallback

  // Default gating: hide industrial_ndt unless showAlways.
  if (meta.slug === 'industrial_ndt' && !showAlways) return null;

  // Strict gating: consumer surfaces require an active launch.
  if (requireLaunched) {
    const launched = launchedDomains ?? [];
    if (!launched.includes(meta.slug)) return null;
    // industrial_ndt is excluded here even if it appears in launchedDomains —
    // consumer surfaces never show the badge for the platform default.
    if (meta.slug === 'industrial_ndt') return null;
  }

  const Icon = ICON_BY_KEY[meta.iconKey];
  const isSm = size === 'sm';

  return (
    <View
      style={[styles.badge, isSm ? styles.badgeSm : styles.badgeMd]}
      accessibilityRole="text"
      accessibilityLabel={`Inspection domain: ${meta.label}`}
    >
      <Icon size={isSm ? 12 : 14} color={COLORS.icon} />
      <Text style={[styles.label, isSm ? styles.labelSm : styles.labelMd]}>
        {meta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: COLORS.bg,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 999,
  },
  badgeSm: { paddingHorizontal: 8, paddingVertical: 3 },
  badgeMd: { paddingHorizontal: 10, paddingVertical: 5 },
  label: {
    color: COLORS.text,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  labelSm: { fontSize: 11 },
  labelMd: { fontSize: 13 },
});
