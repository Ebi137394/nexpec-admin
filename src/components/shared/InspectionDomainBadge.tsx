// ════════════════════════════════════════════════════════════════════════════
//  src/components/shared/InspectionDomainBadge.tsx
//
//  A passive, read-only pill that surfaces a job's `inspection_domain`.
//  Renders NOTHING when the domain is the platform default
//  ('industrial_ndt'), so mounting this component on existing screens
//  is a true no-op until additional domains are launched.
//
//  Design constraints honoured:
//    • Locked palette only (#020420 / #7C3AED — no new colour tokens).
//    • Existing dark/violet visual language matches every other surface.
//    • Pure presentation — no data fetching, no side effects, no haptics.
//    • showAlways=true lets admin/management screens display the badge
//      for industrial_ndt too (for the admin domains page).
//
//  USAGE
//  ─────
//    import { InspectionDomainBadge } from '@/src/components/shared/InspectionDomainBadge';
//    <InspectionDomainBadge domain={job.domain} />
//    <InspectionDomainBadge domain="civil_construction" size="md" />
//    <InspectionDomainBadge domain="industrial_ndt" showAlways />
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Shield, Building2, Zap, Wrench } from 'lucide-react-native';

type DomainSlug =
  | 'industrial_ndt'
  | 'civil_construction'
  | 'electrical'
  | 'mechanical_field';

interface DomainMeta {
  label: string;
  Icon: typeof Shield;
}

const DOMAIN_META: Record<DomainSlug, DomainMeta> = {
  industrial_ndt: { label: 'Industrial & NDT', Icon: Shield },
  civil_construction: { label: 'Civil', Icon: Building2 },
  electrical: { label: 'Electrical', Icon: Zap },
  mechanical_field: { label: 'Mechanical', Icon: Wrench },
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
   * When true, the badge renders even for industrial_ndt (the platform
   * default). Default false — most surfaces should treat industrial_ndt
   * as "no badge" since it'd otherwise appear on every existing job.
   */
  showAlways?: boolean;
  /** Visual size. Default 'sm'. */
  size?: 'sm' | 'md';
}

export function InspectionDomainBadge({
  domain,
  showAlways = false,
  size = 'sm',
}: InspectionDomainBadgeProps) {
  if (!domain) return null;
  if (domain === 'industrial_ndt' && !showAlways) return null;

  const meta = DOMAIN_META[domain as DomainSlug];
  if (!meta) return null; // unknown future slug — render nothing rather than ugly fallback

  const { Icon, label } = meta;
  const isSm = size === 'sm';

  return (
    <View
      style={[styles.badge, isSm ? styles.badgeSm : styles.badgeMd]}
      accessibilityRole="text"
      accessibilityLabel={`Inspection domain: ${label}`}
    >
      <Icon size={isSm ? 12 : 14} color={COLORS.icon} />
      <Text style={[styles.label, isSm ? styles.labelSm : styles.labelMd]}>
        {label}
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
