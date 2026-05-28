// ════════════════════════════════════════════════════════════════════════════
//  src/shared-ui/search/GlobalSearchBar.tsx
//
//  Sprint 13.M3 — inline tap-to-open search bar.
//
//  This is the surface that lives at the top of each dashboard. It looks
//  like a real search input but is a single touchable that opens
//  GlobalSearchModal in slide-up mode. Keeping the trigger purely
//  visual avoids the need to host the input here AND in the modal —
//  the modal handles the actual TextInput so iOS doesn't get confused
//  about which field owns the keyboard.
//
//  Self-contained: holds modal visibility state internally so callers
//  can drop a single component anywhere without prop-drilling.
// ════════════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GlobalSearchModal } from './GlobalSearchModal';

const COLORS = {
  surface: 'rgba(30,41,59,0.55)',
  border: 'rgba(124,58,237,0.22)',
  primaryLight: '#8B5CF6',
  primarySoft: 'rgba(124,58,237,0.18)',
  text: '#F1F5F9',
  textDim: '#94A3B8',
  textMuted: '#64748B',
};

interface Props {
  /** Optional override placeholder. Defaults to the platform-wide copy. */
  placeholder?: string;
  /** Style override (margins, etc.) so callers can position the bar
   *  without modifying the component. */
  style?: StyleProp<ViewStyle>;
}

export function GlobalSearchBar({
  placeholder = 'Search inspectors, jobs, scope templates…',
  style,
}: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setVisible(true)}
        style={[styles.bar, style]}
        accessibilityRole="search"
        accessibilityLabel="Open global search"
      >
        <View style={styles.iconWrap}>
          <Ionicons name="search" size={14} color={COLORS.primaryLight} />
        </View>
        <Text style={styles.placeholder} numberOfLines={1}>
          {placeholder}
        </Text>
        <View style={styles.kbdHint}>
          <Text style={styles.kbdText}>SEARCH</Text>
        </View>
      </TouchableOpacity>

      <GlobalSearchModal
        visible={visible}
        onClose={() => setVisible(false)}
      />
    </>
  );
}

/* ─── Styles ────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: COLORS.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  placeholder: {
    flex: 1,
    color: COLORS.textDim,
    fontSize: 13,
  },
  kbdHint: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    marginLeft: 8,
  },
  kbdText: {
    color: COLORS.textMuted,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
});
