// ════════════════════════════════════════════════════════════════════════════
//  src/components/orgs/OrgSwitcherTrigger.tsx — Compact pill that opens the
//  workspace switcher bottom sheet.
//
//  Mirrors the web trigger button — gradient avatar + name + kind/role +
//  chevron — within the locked mobile tokens (#020420 background, #7C3AED
//  primary). Designed to drop into any header or profile-screen banner
//  without touching surrounding layout.
//
//  USAGE
//  ─────
//    import { BottomSheetModalProvider, BottomSheetModal } from '@gorhom/bottom-sheet';
//    import { useRef } from 'react';
//    import { OrgSwitcherTrigger } from '@/src/components/orgs/OrgSwitcherTrigger';
//    import { OrgSwitcherSheet }   from '@/src/components/orgs/OrgSwitcherSheet';
//
//    function Screen() {
//      const sheetRef = useRef<BottomSheetModal>(null);
//      return (
//        <>
//          <OrgSwitcherTrigger onPress={() => sheetRef.current?.present()} />
//          <OrgSwitcherSheet sheetRef={sheetRef} />
//        </>
//      );
//    }
//
//  The trigger fetches its own active-org context via useOrgMemberships
//  so it can be mounted standalone — the host doesn't need to wire any
//  data. The sheet shares the same hook so both reflect the latest pin.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronDown } from 'lucide-react-native';
import type { OrgMembershipEntry } from '@nexpec/shared-core';

import { useOrgMemberships } from './useOrgMemberships';

const TOKENS = {
  bg: '#020420',
  surface: '#0B0F2E',
  surfaceHi: '#11163A',
  primary: '#7C3AED',
  primaryGlow: '#A78BFA',
  border: 'rgba(255,255,255,0.10)',
  textPrimary: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textTertiary: '#71717A',
} as const;

interface Props {
  /** Tap handler — usually `() => sheetRef.current?.present()`. */
  onPress: () => void;
  /** Slim mode for tight headers; default false. */
  compact?: boolean;
}

export function OrgSwitcherTrigger({ onPress, compact = false }: Props) {
  const { loading, memberships, active } = useOrgMemberships();

  // While loading, show a discreet skeleton so layout stays stable.
  if (loading) {
    return (
      <View style={[styles.trigger, compact && styles.triggerCompact]}>
        <View style={[styles.avatarOuter, styles.avatarOuterMuted]}>
          <View style={[styles.avatarGradient, styles.avatarSkeleton]}>
            <ActivityIndicator size="small" color={TOKENS.primaryGlow} />
          </View>
        </View>
        <View style={styles.triggerBody}>
          <Text style={styles.triggerName} numberOfLines={1}>
            Loading workspaces…
          </Text>
        </View>
      </View>
    );
  }

  // Zero memberships → render a static NEXPEC chip (matches web behaviour).
  if (memberships.length === 0) {
    return (
      <View style={[styles.trigger, compact && styles.triggerCompact]}>
        <LinearGradient
          colors={[TOKENS.primary, '#22D3EE']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.avatarStaticGradient}
        >
          <Text style={styles.avatarStaticInitials}>NX</Text>
        </LinearGradient>
        <View style={styles.triggerBody}>
          <Text style={styles.triggerName} numberOfLines={1}>
            NEXPEC, Platform
          </Text>
          <Text style={styles.triggerMeta} numberOfLines={1}>
            NO ORG LINKED
          </Text>
        </View>
        <View style={styles.liveDot} />
      </View>
    );
  }

  const current = active ?? memberships[0]!;
  const isInteractive = memberships.length > 1;

  return (
    <Pressable
      onPress={isInteractive ? onPress : undefined}
      disabled={!isInteractive}
      android_ripple={
        isInteractive ? { color: 'rgba(124,58,237,0.18)' } : undefined
      }
      style={({ pressed }) => [
        styles.trigger,
        compact && styles.triggerCompact,
        pressed && isInteractive && Platform.OS === 'ios' && styles.triggerPressed,
      ]}
      accessibilityRole={isInteractive ? 'button' : undefined}
      accessibilityLabel={
        isInteractive
          ? `Switch workspace. Current: ${current.org_name}`
          : `Active workspace: ${current.org_name}`
      }
    >
      <TriggerAvatar org={current} />
      <View style={styles.triggerBody}>
        <Text style={styles.triggerName} numberOfLines={1}>
          {current.org_name}
        </Text>
        <Text style={styles.triggerMeta} numberOfLines={1}>
          {(current.org_kind || '').toUpperCase()}
          {current.role ? `, ${prettyRole(current.role)}` : ''}
        </Text>
      </View>
      {isInteractive && (
        <ChevronDown
          size={14}
          color={TOKENS.textTertiary}
          strokeWidth={2}
        />
      )}
    </Pressable>
  );
}

/* ─── trigger avatar ────────────────────────────────────────────────── */

const AVATAR_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['#7C3AED', '#22D3EE'],
  ['#D946EF', '#7C3AED'],
  ['#22D3EE', '#34D399'],
  ['#F59E0B', '#F43F5E'],
  ['#6366F1', '#A78BFA'],
] as const;

function gradientForOrg(orgId: string): readonly [string, string] {
  let acc = 0;
  for (let i = 0; i < orgId.length; i++) {
    acc = (acc * 31 + orgId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_GRADIENTS[acc % AVATAR_GRADIENTS.length]!;
}

function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'NX';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function prettyRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function TriggerAvatar({ org }: { org: OrgMembershipEntry }) {
  const [start, end] = gradientForOrg(org.org_id);
  return (
    <View style={styles.avatarOuter}>
      <LinearGradient
        colors={[start, end]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.avatarGradient}
      >
        <Text style={styles.avatarInitials}>{orgInitials(org.org_name)}</Text>
      </LinearGradient>
    </View>
  );
}

/* ─── styles ────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignSelf: 'flex-start',
    maxWidth: 260,
  },
  triggerCompact: {
    maxWidth: 200,
  },
  triggerPressed: {
    opacity: 0.7,
  },
  triggerBody: { flex: 1, minWidth: 0 },
  triggerName: {
    color: TOKENS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 16,
  },
  triggerMeta: {
    color: TOKENS.textTertiary,
    fontSize: 9,
    letterSpacing: 0.8,
    marginTop: 1,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },

  /* avatar */
  avatarOuter: {
    width: 30,
    height: 30,
    borderRadius: 8,
    padding: 1,
    backgroundColor: TOKENS.border,
  },
  avatarOuterMuted: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  avatarGradient: {
    flex: 1,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSkeleton: {
    backgroundColor: TOKENS.surface,
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.5,
  },

  avatarStaticGradient: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarStaticInitials: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
    letterSpacing: 0.6,
  },

  /* live dot */
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#34D399',
    marginRight: 4,
  },
});
