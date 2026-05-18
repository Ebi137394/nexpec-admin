// ════════════════════════════════════════════════════════════════════════════
//  src/components/SpecialtyPicker.tsx
//  NEXPEC — Specialty selector (premium-UX refactor).
//
//  Main-screen footprint is tight:
//    • A single trigger button surfacing the selected count.
//    • A row of selected chips (X-to-remove), only if any are selected.
//
//  Browsing/searching happens inside a presentation-style modal:
//    • Header with title, selected count, and close affordance.
//    • Search bar — filters by name + synonyms.
//    • Horizontal group filter chips ("All" + each SpecialtyGroup).
//    • FlatList of available specialty rows with a check-tick on selected.
//    • Inline "Add custom: <query>" fallback row when no canonical match.
//    • Footer "Done" button to dismiss.
//
//  Public API is unchanged — wired screens don't need updates.
//  `capHeight` is kept for prop compatibility but ignored (the modal owns
//  its own scroll container).
// ════════════════════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, X, Check, Plus, ChevronRight } from 'lucide-react-native';

import {
  SPECIALTY_GROUPS,
  SPECIALTIES,
  searchSpecialties,
  prettifySlug,
  slugifyCustomLabel,
  isCustomSlug,
  type SpecialtyGroupSlug,
  type SpecialtyOption,
} from '@/src/data/specialties';

// NEXPEC palette — kept local to avoid theme-provider coupling.
const C = {
  bg: '#020420',
  card: '#0A0D2C',
  cardAlt: '#0F172A',
  border: '#1E293B',
  inputBg: '#0A0E2E',
  text: '#FFFFFF',
  textSec: '#94A3B8',
  textMuted: '#64748B',
  primary: '#7C3AED',
  primarySoft: 'rgba(124, 58, 237, 0.14)',
  primaryBorder: 'rgba(124, 58, 237, 0.40)',
  chipBg: 'rgba(255, 255, 255, 0.05)',
  chipBorder: 'rgba(255, 255, 255, 0.08)',
};

export interface SpecialtyPickerProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Hard cap on selection count. `null`/undefined = unlimited. */
  maxSelections?: number | null;
  label?: string;
  helperText?: string;
  /** Deprecated — kept for prop compatibility. The modal owns its scroll. */
  capHeight?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────

export default function SpecialtyPicker({
  value,
  onChange,
  maxSelections = null,
  label,
  helperText,
}: SpecialtyPickerProps) {
  const [modalOpen, setModalOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(value), [value]);
  const capReached =
    typeof maxSelections === 'number' && value.length >= maxSelections;

  const removeSlug = (slug: string) => {
    onChange(value.filter((s) => s !== slug));
  };

  return (
    <View style={styles.root}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      {/* Trigger button — the only thing that lives on the main screen. */}
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setModalOpen(true)}
        activeOpacity={0.7}
      >
        <Search size={16} color={C.primary} strokeWidth={2.2} />
        <Text style={styles.triggerText} numberOfLines={1}>
          {value.length === 0
            ? 'Search & add specialties…'
            : `${value.length} selected${
                maxSelections ? ` / ${maxSelections}` : ''
              } — tap to edit`}
        </Text>
        <ChevronRight size={16} color={C.textMuted} strokeWidth={2} />
      </TouchableOpacity>

      {helperText ? <Text style={styles.helper}>{helperText}</Text> : null}

      {/* Selected chips — only rendered when there's something to show. */}
      {value.length > 0 ? (
        <View style={styles.selectedChipsRow}>
          {value.map((slug) => {
            const display = prettifySlug(slug);
            const custom = isCustomSlug(slug);
            return (
              <TouchableOpacity
                key={slug}
                style={[styles.selectedChip, custom && styles.selectedChipCustom]}
                onPress={() => removeSlug(slug)}
                activeOpacity={0.7}
                accessibilityLabel={`Remove ${display}`}
              >
                <Text style={styles.selectedChipTxt} numberOfLines={1}>
                  {display}
                </Text>
                <X size={12} color={C.primary} strokeWidth={2.6} />
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      <SpecialtyPickerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        value={value}
        onChange={onChange}
        selectedSet={selectedSet}
        capReached={capReached}
        maxSelections={maxSelections}
      />
    </View>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  value: string[];
  onChange: (next: string[]) => void;
  selectedSet: Set<string>;
  capReached: boolean;
  maxSelections: number | null;
}

interface ListRow {
  kind: 'specialty' | 'custom';
  slug: string;          // for 'specialty' rows
  label: string;         // display name
  groupName?: string;    // canonical only
  customLabel?: string;  // 'custom' rows: the raw query they typed
}

const MAX_INLINE_RESULTS = 60;

function SpecialtyPickerModal({
  visible,
  onClose,
  value,
  onChange,
  selectedSet,
  capReached,
  maxSelections,
}: ModalProps) {
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] =
    useState<SpecialtyGroupSlug | null>(null);

  const results: SpecialtyOption[] = useMemo(
    () => searchSpecialties(query, groupFilter).slice(0, MAX_INLINE_RESULTS),
    [query, groupFilter],
  );

  // Custom row eligibility — same rules as the earlier version: non-empty
  // query, no canonical exact-name collision, sanitised slug non-empty,
  // not already in the selection.
  const customCandidate = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const lower = q.toLowerCase();
    const collides = SPECIALTIES.some((s) => s.name.toLowerCase() === lower);
    if (collides) return null;
    const slug = slugifyCustomLabel(q);
    if (!slug) return null;
    if (selectedSet.has(slug)) return null;
    return { slug, label: q };
  }, [query, selectedSet]);

  const rows: ListRow[] = useMemo(() => {
    const r: ListRow[] = results.map((s) => ({
      kind: 'specialty',
      slug: s.slug,
      label: s.name,
      groupName:
        SPECIALTY_GROUPS.find((g) => g.slug === s.group)?.name ?? undefined,
    }));
    if (customCandidate) {
      r.push({
        kind: 'custom',
        slug: customCandidate.slug,
        label: `Add custom: “${customCandidate.label}”`,
        customLabel: customCandidate.label,
      });
    }
    return r;
  }, [results, customCandidate]);

  const toggle = (slug: string) => {
    if (selectedSet.has(slug)) {
      onChange(value.filter((s) => s !== slug));
      return;
    }
    if (capReached) return;
    onChange([...value, slug]);
  };

  const handleAddCustom = (slug: string) => {
    if (capReached) return;
    if (selectedSet.has(slug)) return;
    onChange([...value, slug]);
    setQuery('');
  };

  const renderItem = ({ item }: { item: ListRow }) => {
    const isOn = selectedSet.has(item.slug);
    const disabled = !isOn && capReached;

    if (item.kind === 'custom') {
      return (
        <TouchableOpacity
          style={[styles.listRow, styles.listRowCustom, disabled && styles.listRowDisabled]}
          onPress={() => handleAddCustom(item.slug)}
          disabled={disabled}
          activeOpacity={0.7}
        >
          <View style={[styles.listRowCheck, styles.listRowCheckCustom]}>
            <Plus size={14} color={C.primary} strokeWidth={2.6} />
          </View>
          <View style={styles.listRowText}>
            <Text style={styles.listRowLabel} numberOfLines={1}>
              {item.label}
            </Text>
            <Text style={styles.listRowSub}>Add as a custom specialty</Text>
          </View>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        style={[styles.listRow, isOn && styles.listRowOn, disabled && styles.listRowDisabled]}
        onPress={() => toggle(item.slug)}
        disabled={disabled}
        activeOpacity={0.7}
      >
        <View style={[styles.listRowCheck, isOn && styles.listRowCheckOn]}>
          {isOn ? <Check size={14} color={C.text} strokeWidth={3} /> : null}
        </View>
        <View style={styles.listRowText}>
          <Text style={styles.listRowLabel} numberOfLines={1}>
            {item.label}
          </Text>
          {item.groupName ? (
            <Text style={styles.listRowSub}>{item.groupName}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
      transparent={false}
    >
      <SafeAreaView style={styles.modalRoot} edges={['top']}>
        {/* Header */}
        <View style={styles.modalHdr}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={24} color={C.text} strokeWidth={2} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Specialties</Text>
          <View style={styles.modalCountBadge}>
            <Text style={styles.modalCountTxt}>
              {value.length}
              {maxSelections ? `/${maxSelections}` : ''}
            </Text>
          </View>
        </View>

        {/* Search */}
        <View style={styles.modalSearchWrap}>
          <View style={styles.modalSearchBar}>
            <Search size={15} color={C.textMuted} strokeWidth={2} />
            <TextInput
              style={styles.modalSearchInput}
              placeholder="Search specialties…"
              placeholderTextColor={C.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {query.length > 0 ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <X size={14} color={C.textMuted} strokeWidth={2.4} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Group filter chips */}
        <View style={styles.groupRowWrap}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.groupRow}
            data={[
              { slug: null as SpecialtyGroupSlug | null, name: 'All' },
              ...SPECIALTY_GROUPS.map((g) => ({ slug: g.slug, name: g.name })),
            ]}
            keyExtractor={(g) => g.slug ?? '__all'}
            renderItem={({ item }) => {
              const active = groupFilter === item.slug;
              return (
                <TouchableOpacity
                  style={[styles.groupChip, active && styles.groupChipOn]}
                  onPress={() =>
                    setGroupFilter(groupFilter === item.slug ? null : item.slug)
                  }
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.groupChipTxt,
                      active && styles.groupChipTxtOn,
                    ]}
                  >
                    {item.name}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {/* Results list */}
        <FlatList
          data={rows}
          keyExtractor={(item) => `${item.kind}__${item.slug}`}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No specialties match.</Text>
              <Text style={styles.emptyBody}>
                Try a different search term, or type your own specialty to
                add it as a custom entry.
              </Text>
            </View>
          }
        />

        {/* Footer */}
        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={styles.modalDoneBtn}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Text style={styles.modalDoneTxt}>
              Done · {value.length} selected
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { width: '100%' },

  label: {
    color: C.textSec,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },

  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
  },
  triggerText: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    fontWeight: '500',
  },
  helper: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 6,
  },

  selectedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  selectedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: C.primarySoft,
    borderWidth: 1,
    borderColor: C.primaryBorder,
    borderRadius: 999,
  },
  selectedChipCustom: { borderStyle: 'dashed' },
  selectedChipTxt: {
    color: C.text,
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 220,
  },

  // ── Modal ──
  modalRoot: { flex: 1, backgroundColor: C.bg },
  modalHdr: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 4 : 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  modalTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  modalCountBadge: {
    minWidth: 32,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: C.primarySoft,
    borderWidth: 1,
    borderColor: C.primaryBorder,
    alignItems: 'center',
  },
  modalCountTxt: { color: C.text, fontSize: 12, fontWeight: '700' },

  modalSearchWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  modalSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
  },
  modalSearchInput: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    padding: 0,
  },

  groupRowWrap: { paddingBottom: 8 },
  groupRow: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
  },
  groupChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.chipBg,
    borderWidth: 1,
    borderColor: C.chipBorder,
  },
  groupChipOn: {
    backgroundColor: C.primarySoft,
    borderColor: C.primaryBorder,
  },
  groupChipTxt: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  groupChipTxtOn: { color: C.text },

  listContent: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 96 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: C.card,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  listRowOn: {
    backgroundColor: 'rgba(124, 58, 237, 0.10)',
    borderColor: C.primaryBorder,
  },
  listRowCustom: {
    borderStyle: 'dashed',
    backgroundColor: C.primarySoft,
    borderColor: C.primaryBorder,
  },
  listRowDisabled: { opacity: 0.45 },
  listRowCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  listRowCheckOn: {
    backgroundColor: C.primary,
    borderColor: C.primary,
  },
  listRowCheckCustom: {
    backgroundColor: 'transparent',
    borderColor: C.primaryBorder,
  },
  listRowText: { flex: 1 },
  listRowLabel: { color: C.text, fontSize: 14, fontWeight: '600' },
  listRowSub: { color: C.textMuted, fontSize: 12, marginTop: 2 },

  emptyState: { paddingHorizontal: 24, paddingVertical: 36, alignItems: 'center' },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '600' },
  emptyBody: {
    color: C.textMuted,
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },

  modalFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    backgroundColor: C.bg,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  modalDoneBtn: {
    backgroundColor: C.primary,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
  },
  modalDoneTxt: { color: C.text, fontSize: 15, fontWeight: '700' },
});
