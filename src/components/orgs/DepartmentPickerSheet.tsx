// ════════════════════════════════════════════════════════════════════════════
//  src/components/orgs/DepartmentPickerSheet.tsx
//
//  Bottom-sheet department picker for the mobile buyer flow. Drop-in
//  component the post-new-job form (or any other form that needs cost-
//  center attribution) can mount with one line.
//
//  STRICT TOKENS — locked per UI rules: bg #020420, primary #7C3AED.
//
//  USAGE
//  ─────
//    const sheetRef = useRef<BottomSheetModal>(null);
//    const [picked, setPicked] = useState<string | null>(null);
//
//    <Pressable onPress={() => sheetRef.current?.present()}>
//      <Text>Pick department</Text>
//    </Pressable>
//    <DepartmentPickerSheet
//      sheetRef={sheetRef}
//      orgId={activeOrg?.org_id ?? null}
//      orgName={activeOrg?.org_name ?? null}
//      selectedDepartmentId={picked}
//      onSelect={(d) => setPicked(d?.id ?? null)}
//      allowUnattributed
//    />
//
//  Must be rendered inside a <BottomSheetModalProvider>.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useMemo, useState } from 'react';
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
import {
  Check,
  Search,
  FolderTree,
  Hash,
  AlertCircle,
  FolderOpen,
  Folder,
  Slash,
} from 'lucide-react-native';

import { useDepartments, type MobileDepartment } from './useDepartments';

const TOKENS = {
  bg: '#020420',
  surface: '#0B0F2E',
  surfaceHi: '#11163A',
  primary: '#7C3AED',
  primaryGlow: '#A78BFA',
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
  /** Org whose departments are being picked. Null = hides the list with a hint. */
  orgId: string | null;
  /** Org display name for the empty/null states. */
  orgName: string | null;
  /** Currently-selected department id; used for the checkmark. */
  selectedDepartmentId: string | null;
  /** Fires when the user picks. `null` = chose Unattributed. */
  onSelect: (dept: MobileDepartment | null) => void;
  /** Whether to render the "Unattributed" choice at the top. Default true. */
  allowUnattributed?: boolean;
}

export function DepartmentPickerSheet({
  sheetRef,
  orgId,
  orgName,
  selectedDepartmentId,
  onSelect,
  allowUnattributed = true,
}: Props) {
  const { loading, error, departments } = useDepartments(orgId);
  const [query, setQuery] = useState('');

  const snapPoints = useMemo(() => {
    if (departments.length === 0) return ['45%'];
    if (departments.length <= 4) return ['55%'];
    return ['80%'];
  }, [departments.length]);

  const filtered = useMemo(() => {
    if (!query.trim()) return departments;
    const q = query.trim().toLowerCase();
    return departments.filter((d) => {
      const hay = `${d.name} ${d.cost_center ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [departments, query]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.78}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handlePick = useCallback(
    (dept: MobileDepartment | null) => {
      onSelect(dept);
      (sheetRef as React.MutableRefObject<BottomSheetModal | null>)
        ?.current?.dismiss();
    },
    [onSelect, sheetRef],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      index={0}
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
      enablePanDownToClose
      enableDynamicSizing={false}
    >
      <BottomSheetView style={styles.content}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerIconWrap}>
            <FolderTree
              size={14}
              color={TOKENS.primaryGlow}
              strokeWidth={1.75}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.headerLabel}>CHARGE TO</Text>
            {orgName && (
              <Text style={styles.headerSub} numberOfLines={1}>
                {orgName}
              </Text>
            )}
          </View>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{departments.length}</Text>
          </View>
        </View>

        {!orgId ? (
          <View style={styles.centeredState}>
            <Slash
              size={24}
              color={TOKENS.textMuted}
              strokeWidth={1.5}
            />
            <Text style={styles.centeredStateText}>
              Pick a workspace first to see its departments.
            </Text>
          </View>
        ) : (
          <>
            {/* Search */}
            {departments.length >= 5 && (
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
                  placeholder="Search department or cost-center…"
                  placeholderTextColor={TOKENS.textMuted}
                  style={styles.searchInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
            )}

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

            {/* Unattributed option */}
            {allowUnattributed && (
              <UnattributedRow
                isSelected={selectedDepartmentId === null}
                onPress={() => handlePick(null)}
              />
            )}

            {/* List */}
            {loading ? (
              <View style={styles.centeredState}>
                <ActivityIndicator color={TOKENS.primaryGlow} />
                <Text style={styles.centeredStateText}>
                  Loading departments…
                </Text>
              </View>
            ) : departments.length === 0 ? (
              <View style={styles.centeredState}>
                <Text style={styles.centeredStateTitle}>
                  No departments configured
                </Text>
                <Text style={styles.centeredStateText}>
                  {orgName ?? 'This organization'} hasn&apos;t set up
                  department structure yet. Spend will roll up under
                  &ldquo;Unattributed&rdquo;.
                </Text>
              </View>
            ) : filtered.length === 0 ? (
              <Text style={styles.noMatchText}>No departments match.</Text>
            ) : (
              <View style={styles.list}>
                {filtered.map((d) => (
                  <DepartmentRow
                    key={d.id}
                    dept={d}
                    isSelected={selectedDepartmentId === d.id}
                    onPress={() => handlePick(d)}
                  />
                ))}
              </View>
            )}
          </>
        )}

        {/* Footer */}
        <Text style={styles.footerCopy}>
          ATTRIBUTION SNAPSHOTS THE COST-CENTER, IMMUNE TO RENAMES
        </Text>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

/* ─── rows ─────────────────────────────────────────────────────────── */

function UnattributedRow({
  isSelected,
  onPress,
}: {
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(124,58,237,0.15)' }}
      style={({ pressed }) => [
        styles.row,
        styles.rowUnattributed,
        isSelected && styles.rowSelected,
        pressed && Platform.OS === 'ios' && styles.rowPressed,
      ]}
    >
      <View style={[styles.rowIconWrap, styles.rowIconWrapMuted]}>
        <Slash size={14} color={TOKENS.textTertiary} strokeWidth={1.75} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName}>— Leave unattributed —</Text>
        <Text style={styles.rowMeta}>
          Rolls up under the synthetic Unattributed bucket
        </Text>
      </View>
      {isSelected && (
        <Check size={16} color={TOKENS.primaryGlow} strokeWidth={2.5} />
      )}
    </Pressable>
  );
}

function DepartmentRow({
  dept,
  isSelected,
  onPress,
}: {
  dept: MobileDepartment;
  isSelected: boolean;
  onPress: () => void;
}) {
  const Icon = dept.depth === 0 ? FolderOpen : Folder;
  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: 'rgba(124,58,237,0.15)' }}
      style={({ pressed }) => [
        styles.row,
        isSelected && styles.rowSelected,
        pressed && Platform.OS === 'ios' && styles.rowPressed,
        { paddingLeft: 10 + Math.max(0, dept.depth) * 14 },
      ]}
    >
      <View style={styles.rowIconWrap}>
        <Icon
          size={14}
          color={dept.depth === 0 ? TOKENS.primaryGlow : TOKENS.textTertiary}
          strokeWidth={1.75}
        />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowNameRow}>
          <Text style={styles.rowName} numberOfLines={1}>
            {dept.depth > 0 ? `↳ ${dept.name}` : dept.name}
          </Text>
          {dept.cost_center && (
            <View style={styles.costCenterChip}>
              <Hash size={9} color={TOKENS.textSecondary} strokeWidth={2} />
              <Text style={styles.costCenterText}>{dept.cost_center}</Text>
            </View>
          )}
        </View>
        {dept.member_count > 0 && (
          <Text style={styles.rowMeta}>
            {dept.member_count} member{dept.member_count === 1 ? '' : 's'}
          </Text>
        )}
      </View>
      {isSelected && (
        <Check size={16} color={TOKENS.primaryGlow} strokeWidth={2.5} />
      )}
    </Pressable>
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
    gap: 10,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TOKENS.border,
    marginBottom: 12,
  },
  headerIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(124,58,237,0.15)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(124,58,237,0.30)',
  },
  headerLabel: {
    color: TOKENS.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  headerSub: {
    color: TOKENS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
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
    alignItems: 'flex-start',
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
  list: { gap: 4, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  rowPressed: { opacity: 0.6 },
  rowSelected: {
    backgroundColor: 'rgba(124,58,237,0.10)',
  },
  rowUnattributed: {
    backgroundColor: 'rgba(245,158,11,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(245,158,11,0.18)',
    borderStyle: 'dashed',
    marginBottom: 8,
  },
  rowIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
  },
  rowIconWrapMuted: {
    backgroundColor: 'rgba(245,158,11,0.06)',
    borderColor: 'rgba(245,158,11,0.20)',
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
    fontSize: 13,
    fontWeight: '600',
  },
  rowMeta: {
    color: TOKENS.textTertiary,
    fontSize: 10,
    marginTop: 2,
  },
  costCenterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: TOKENS.border,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  costCenterText: {
    color: TOKENS.textSecondary,
    fontSize: 9,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
  },

  /* centered states */
  centeredState: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
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
    paddingHorizontal: 16,
    lineHeight: 17,
  },
  noMatchText: {
    color: TOKENS.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 24,
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
