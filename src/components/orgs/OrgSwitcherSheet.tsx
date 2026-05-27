// ════════════════════════════════════════════════════════════════════════════
//  src/components/orgs/OrgSwitcherSheet.tsx — Mobile workspace switcher
//
//  Mirrors the web OrgSwitcher (apps/web/src/components/orgs/OrgSwitcher.tsx)
//  experience but rendered as a bottom sheet on iOS / Android. Powered by
//  @gorhom/bottom-sheet v5 which is already a project dependency.
//
//  STRICT UI RULES — honored:
//    · background          = #020420  (root surface)
//    · primary             = #7C3AED  (violet)
//    · spacing + radii match existing ContractEditorModal / ReviewModal
//      patterns so the sheet feels native to the codebase.
//
//  STATE MODEL
//    · This component is fully presentational. All data fetching + the
//      RPC round-trip live in useOrgMemberships() so the same hook can
//      back any other surface (e.g. a settings screen) without coupling.
//
//  USAGE
//    const sheetRef = useRef<BottomSheetModal>(null);
//    <OrgSwitcherSheet sheetRef={sheetRef} />
//    sheetRef.current?.present();        // open
//    sheetRef.current?.dismiss();        // close
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Search, Users, AlertCircle } from 'lucide-react-native';
import type { OrgMembershipEntry } from '@nexpec/shared-core';

import { useOrgMemberships } from './useOrgMemberships';

/* ─── design tokens (locked per UI rules) ──────────────────────────── */

const TOKENS = {
  /** Root background. Locked. */
  bg: '#020420',
  /** Sheet surface. Slight elevation against bg. */
  surface: '#0B0F2E',
  /** Surface elevated. */
  surfaceHi: '#11163A',
  /** Primary violet. Locked. */
  primary: '#7C3AED',
  /** Primary glow. */
  primaryGlow: '#A78BFA',
  /** Cyan accent. */
  cyan: '#22D3EE',
  /** White at varying alphas. */
  border: 'rgba(255,255,255,0.08)',
  borderStrong: 'rgba(255,255,255,0.12)',
  textPrimary: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textTertiary: '#71717A',
  textMuted: '#52525B',
  rose: '#F43F5E',
  emerald: '#34D399',
} as const;

interface Props {
  sheetRef: React.Ref<BottomSheetModal>;
}

export function OrgSwitcherSheet({ sheetRef }: Props) {
  const {
    loading,
    error,
    memberships,
    active,
    switching,
    pendingOrgId,
    setActiveOrg,
  } = useOrgMemberships();

  const [query, setQuery] = useState('');

  // Adaptive snap points — small list = 50%, big list = 85%.
  const snapPoints = useMemo(() => {
    if (memberships.length === 0) return ['40%'];
    if (memberships.length <= 3) return ['55%'];
    return ['80%'];
  }, [memberships.length]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.72}
        pressBehavior="close"
      />
    ),
    [],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return memberships;
    const q = query.trim().toLowerCase();
    return memberships.filter((m) => {
      const hay = `${m.org_name} ${m.org_slug ?? ''} ${m.role ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [memberships, query]);

  const onPick = useCallback(
    async (org: OrgMembershipEntry) => {
      if (org.org_id === active?.org_id) {
        // No-op when tapping the already-active org.
        return;
      }
      const res = await setActiveOrg(org.org_id);
      if (res.ok) {
        // Dismiss after a short delay so the user sees the green tick.
        setTimeout(() => {
          (sheetRef as React.MutableRefObject<BottomSheetModal | null>)
            ?.current?.dismiss();
        }, 320);
      }
    },
    [active?.org_id, setActiveOrg, sheetRef],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
      // Keep the sheet itself sitting cleanly above the safe area on
      // iOS; the inner content provides its own padding so we keep this
      // tight and uniform.
      enablePanDownToClose
      enableDynamicSizing={false}
    >
      <BottomSheetView style={styles.content}>
        {/* ─── Header ─── */}
        <View style={styles.headerRow}>
          <View style={styles.headerLabelRow}>
            <Users size={14} color={TOKENS.primaryGlow} strokeWidth={1.75} />
            <Text style={styles.headerLabel}>SWITCH WORKSPACE</Text>
          </View>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{memberships.length}</Text>
          </View>
        </View>

        {/* ─── Search (5+ memberships) ─── */}
        {memberships.length >= 5 && (
          <View style={styles.searchWrap}>
            <Search
              size={14}
              color={TOKENS.textTertiary}
              strokeWidth={1.75}
              style={styles.searchIcon}
            />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search organizations…"
              placeholderTextColor={TOKENS.textMuted}
              style={styles.searchInput}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
          </View>
        )}

        {/* ─── Error banner ─── */}
        {error && (
          <View style={styles.errorBanner}>
            <AlertCircle
              size={14}
              color={TOKENS.rose}
              strokeWidth={1.75}
            />
            <Text style={styles.errorText} numberOfLines={2}>
              {error}
            </Text>
          </View>
        )}

        {/* ─── List body ─── */}
        {loading ? (
          <View style={styles.centeredState}>
            <ActivityIndicator color={TOKENS.primaryGlow} />
            <Text style={styles.centeredStateText}>Loading workspaces…</Text>
          </View>
        ) : memberships.length === 0 ? (
          <View style={styles.centeredState}>
            <Text style={styles.centeredStateTitle}>
              No organizations linked
            </Text>
            <Text style={styles.centeredStateText}>
              Once an enterprise owner invites you, your workspaces will
              appear here.
            </Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.centeredState}>
            <Text style={styles.centeredStateText}>
              No workspaces match your search.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {filtered.map((org) => (
              <OrgRow
                key={org.org_id}
                org={org}
                isActive={org.org_id === active?.org_id}
                isPending={pendingOrgId === org.org_id && switching}
                disabled={switching}
                onPress={() => onPick(org)}
              />
            ))}
          </View>
        )}

        {/* ─── Footer microcopy ─── */}
        <Text style={styles.footerCopy}>
          PINNED ON PROFILE · SYNCS ACROSS WEB + MOBILE
        </Text>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

/* ─── Row ─────────────────────────────────────────────────────────── */

function OrgRow({
  org,
  isActive,
  isPending,
  disabled,
  onPress,
}: {
  org: OrgMembershipEntry;
  isActive: boolean;
  isPending: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(124,58,237,0.15)' }}
      style={({ pressed }) => [
        styles.row,
        isActive && styles.rowActive,
        pressed && Platform.OS === 'ios' && styles.rowPressed,
      ]}
    >
      <OrgAvatar org={org} ringed={isActive} />
      <View style={styles.rowBody}>
        <View style={styles.rowNameRow}>
          <Text style={styles.rowName} numberOfLines={1}>
            {org.org_name}
          </Text>
          {isActive && (
            <View style={styles.activePill}>
              <Text style={styles.activePillText}>ACTIVE</Text>
            </View>
          )}
        </View>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {(org.org_kind || '').toUpperCase()}
          {org.role ? `  ·  ${prettyRole(org.role)}` : ''}
        </Text>
      </View>
      <View style={styles.rowTrailing}>
        {isPending ? (
          <ActivityIndicator
            size="small"
            color={TOKENS.primaryGlow}
          />
        ) : isActive ? (
          <Check size={16} color={TOKENS.primaryGlow} strokeWidth={2.5} />
        ) : null}
      </View>
    </Pressable>
  );
}

/* ─── Avatar (deterministic gradient per org id) ─────────────────── */

const AVATAR_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ['#7C3AED', '#22D3EE'], // violet → cyan
  ['#D946EF', '#7C3AED'], // fuchsia → violet
  ['#22D3EE', '#34D399'], // cyan → emerald
  ['#F59E0B', '#F43F5E'], // amber → rose
  ['#6366F1', '#A78BFA'], // indigo → violet-glow
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

function OrgAvatar({
  org,
  ringed,
}: {
  org: OrgMembershipEntry;
  ringed: boolean;
}) {
  const [start, end] = gradientForOrg(org.org_id);
  const initials = orgInitials(org.org_name);

  return (
    <View
      style={[
        styles.avatarOuter,
        ringed && styles.avatarOuterActive,
      ]}
    >
      <LinearGradient
        colors={[start, end]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.avatarGradient}
      >
        <Text style={styles.avatarInitials}>{initials}</Text>
      </LinearGradient>
    </View>
  );
}

/* ─── styles ──────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: TOKENS.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: TOKENS.borderStrong,
  },
  handleIndicator: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    width: 36,
    height: 4,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
    backgroundColor: TOKENS.surface,
  },

  /* header */
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TOKENS.border,
    marginBottom: 12,
  },
  headerLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerLabel: {
    color: TOKENS.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  countPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  countPillText: {
    color: TOKENS.textTertiary,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    fontSize: 10,
  },

  /* search */
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 36,
    marginBottom: 12,
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    color: TOKENS.textPrimary,
    fontSize: 13,
    padding: 0,
  },

  /* error */
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(244,63,94,0.30)',
    backgroundColor: 'rgba(244,63,94,0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  errorText: {
    flex: 1,
    color: '#FECDD3',
    fontSize: 12,
  },

  /* list */
  list: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: TOKENS.surfaceHi,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
  },
  rowActive: {
    backgroundColor: 'rgba(124,58,237,0.10)',
    borderColor: 'rgba(124,58,237,0.40)',
  },
  rowPressed: {
    opacity: 0.65,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowName: {
    flex: 1,
    color: TOKENS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  rowMeta: {
    color: TOKENS.textTertiary,
    fontSize: 10,
    letterSpacing: 0.6,
    marginTop: 2,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
  rowTrailing: { width: 20, alignItems: 'center' },
  activePill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(124,58,237,0.40)',
    backgroundColor: 'rgba(124,58,237,0.18)',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  activePillText: {
    color: TOKENS.primaryGlow,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },

  /* avatar */
  avatarOuter: {
    width: 36,
    height: 36,
    borderRadius: 10,
    padding: 1,
    backgroundColor: TOKENS.border,
  },
  avatarOuterActive: {
    backgroundColor: 'rgba(124,58,237,0.45)',
  },
  avatarGradient: {
    flex: 1,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.6,
  },

  /* centered states */
  centeredState: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 6,
  },
  centeredStateTitle: {
    color: TOKENS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  centeredStateText: {
    color: TOKENS.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: 12,
  },

  /* footer */
  footerCopy: {
    marginTop: 18,
    textAlign: 'center',
    color: TOKENS.textMuted,
    fontSize: 9,
    letterSpacing: 1.4,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },
});
