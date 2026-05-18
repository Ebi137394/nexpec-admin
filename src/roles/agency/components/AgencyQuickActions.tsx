// ════════════════════════════════════════════════════════════════════════════
//  src/roles/agency/components/AgencyQuickActions.tsx
//
//  LANE-B-PHASE-5.2 — Second extraction from app/(tabs)/agency-dashboard.tsx.
//
//  Scope: the 4-up Quick Actions launchpad sitting between the hero card
//  and the Action Inbox. Takes an array of action configs so the parent
//  retains full control over routing, icons, and tint colors — the
//  component just renders them.
//
//  Strict Principle 6 compliance: every style token, gradient stop,
//  spacing value, and the press-scale animation are preserved
//  byte-for-byte from the original definition.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';

// ─────────────────────────────────────────────────────────────
//  Color tokens (verbatim subset of agency-dashboard.tsx's `C`)
// ─────────────────────────────────────────────────────────────
const C = {
  card: '#0A0E2A',
  border: '#1A1F4A',
  primary: '#7C3AED',
  text: '#FFFFFF',
};

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────
export interface AgencyQuickAction {
  /** Stable identifier (used as the React key). */
  id: string;
  /** Lucide icon component reference (e.g., `Briefcase`). */
  icon: LucideIcon;
  /** Accent color — drives icon color, icon-circle bg/border tints. */
  tint: string;
  /** Short label displayed below the icon. */
  label: string;
  /** Two-stop gradient applied to the card background (top-left → bottom-right). */
  gradient: [string, string];
  /** Tap handler. */
  onPress: () => void;
}

export interface AgencyQuickActionsProps {
  /** Array of action configs. The component renders one card per entry. */
  actions: AgencyQuickAction[];
}

// ─────────────────────────────────────────────────────────────
//  Private — individual QuickAction card.
//  Verbatim copy of the QuickAction component in agency-dashboard.tsx.
// ─────────────────────────────────────────────────────────────
const QuickActionCard: React.FC<{
  icon: LucideIcon;
  tint: string;
  label: string;
  gradient: [string, string];
  onPress: () => void;
}> = ({ icon: Icon, tint, label, gradient, onPress }) => (
  <Pressable
    onPress={onPress}
    style={({ pressed }) => [s.qaCard, pressed && { transform: [{ scale: 0.97 }] }]}
  >
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    <View style={[s.qaIcon, { backgroundColor: tint + '26', borderColor: tint + '66' }]}>
      <Icon size={20} color={tint} />
    </View>
    <Text style={s.qaLabel} numberOfLines={1} adjustsFontSizeToFit>
      {label}
    </Text>
  </Pressable>
);

// ─────────────────────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────────────────────
export const AgencyQuickActions: React.FC<AgencyQuickActionsProps> = ({
  actions,
}) => {
  return (
    <Animated.View entering={FadeInDown.delay(40).duration(380)}>
      <View style={s.qaHeader}>
        <Text style={s.qaHeaderTitle}>Quick Actions</Text>
        <View style={s.qaHeaderDot} />
      </View>
      <View style={s.qaGrid}>
        {actions.map((a) => (
          <QuickActionCard
            key={a.id}
            icon={a.icon}
            tint={a.tint}
            label={a.label}
            gradient={a.gradient}
            onPress={a.onPress}
          />
        ))}
      </View>
    </Animated.View>
  );
};

export default AgencyQuickActions;

// ─────────────────────────────────────────────────────────────
//  Styles — verbatim copy of qa* styles from agency-dashboard.tsx.
//  Numeric values + tint expressions preserved exactly.
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  qaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  qaHeaderTitle: {
    color: C.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  qaHeaderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  qaGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  qaCard: {
    flex: 1, // ★ equal-width 4-up grid
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    minHeight: 96,
  },
  qaIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  qaLabel: { color: C.text, fontSize: 12, fontWeight: '800' },
});
