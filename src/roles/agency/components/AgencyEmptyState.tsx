// ════════════════════════════════════════════════════════════════════════════
//  src/roles/agency/components/AgencyEmptyState.tsx
//
//  LANE-B-PHASE-5.2 — Ninth (and final) extraction from
//  app/(tabs)/agency-dashboard.tsx. Officially seals the dashboard's
//  100%-component-extraction milestone.
//
//  Scope: the zero-jobs empty-state card — gradient-tinted rounded
//  surface with a large Briefcase icon, a bold welcome title, a
//  descriptive sub-line, and a primary "Post your first job" CTA
//  that navigates to the post-new-job screen.
//
//  Props design: minimal — the parent passes a single `onCreate`
//  callback. Copy is locked because this is the agency-specific
//  welcome message; the labels are not configurable to keep the
//  component self-documenting (consistent with how the client
//  empty-state is treated elsewhere).
//
//  Strict Principle 6 compliance: every style token, gradient stop,
//  shadow value, and spacing token preserved byte-for-byte from the
//  original definition.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Briefcase, Plus } from 'lucide-react-native';

// ─────────────────────────────────────────────────────────────
//  Color tokens (verbatim subset of agency-dashboard.tsx's `C`)
// ─────────────────────────────────────────────────────────────
const C = {
  card: '#0A0E2A',
  border: '#1A1F4A',
  primary: '#7C3AED',
  primaryDim: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF',
  textDim: '#64748B',
};

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────
export interface AgencyEmptyStateProps {
  /**
   * Tap handler for the primary CTA. Typically routes to the
   * post-new-job screen.
   */
  onCreate: () => void;
}

// ─────────────────────────────────────────────────────────────
//  Public component
// ─────────────────────────────────────────────────────────────
export const AgencyEmptyState: React.FC<AgencyEmptyStateProps> = ({
  onCreate,
}) => {
  return (
    <Animated.View entering={FadeIn.duration(420)} style={s.emptyWrap}>
      <LinearGradient
        colors={['rgba(124,58,237,0.20)', 'rgba(124,58,237,0.04)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={s.emptyIcon}>
        <Briefcase size={36} color={C.primary} />
      </View>
      <Text style={s.emptyTitle}>Your command center is ready</Text>
      <Text style={s.emptySub}>
        Post your first inspection contract and watch live applicants, budget
        velocity, and inspector dispatch flow through here in real time.
      </Text>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={onCreate}
        style={s.emptyCta}
      >
        <Plus size={16} color="#FFFFFF" strokeWidth={3} />
        <Text style={s.emptyCtaText}>Post your first job</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

export default AgencyEmptyState;

// ─────────────────────────────────────────────────────────────
//  Styles — verbatim copy of the empty* styles from
//  agency-dashboard.tsx. The 80×80 icon ring, 22-radius card,
//  18-pt title, 13-pt sub, and shadowed primary CTA are all
//  preserved exactly to guarantee identical render output.
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  emptyWrap: {
    backgroundColor: C.card,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 22,
    padding: 28,
    alignItems: 'center',
    marginTop: 18,
    overflow: 'hidden',
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: C.primaryDim,
    borderColor: 'rgba(124,58,237,0.50)',
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '800' },
  emptySub: {
    color: C.textDim,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 19,
    paddingHorizontal: 14,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 18,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  emptyCtaText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
