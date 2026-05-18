// ════════════════════════════════════════════════════════════════════════════
//  src/components/CountryPicker.tsx
//  NEXPEC — Country selector (premium-UX refactor).
//
//  Trigger + modal pattern, matching SpecialtyPicker's visual language:
//
//    Single mode
//      • Main screen: one trigger showing the chosen country (or placeholder).
//        A subtle "✕" affordance appears next to the chip when something is
//        chosen — taps clear the selection without opening the modal.
//      • Modal: search + flat list. Tapping a row selects + auto-dismisses
//        (single mode has no multi-step intent).
//
//    Multi mode
//      • Main screen: one trigger showing the selected count, then a row of
//        selected chips below (X-to-remove).
//      • Modal: search + region-bundle quick-adds (EU / EU+EEA / GCC / USMCA)
//        + flat list with tick-state. "Done" dismisses.
//
//  Public API unchanged. `capHeight` retained for prop compatibility, ignored.
// ════════════════════════════════════════════════════════════════════════════

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Modal,
  FlatList,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, X, Check, Plus, ChevronRight, Globe } from 'lucide-react-native';

import {
  loadCountryCodes,
  searchCountries,
  expandBundle,
  REGION_BUNDLES,
  type CountryCode,
} from '@/src/data/countryCodes';

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

// ─── Discriminated-union props (unchanged from caller's POV) ──────────────

type CommonProps = {
  label?: string;
  helperText?: string;
  capHeight?: boolean;
  searchPlaceholder?: string;
};

type SingleProps = CommonProps & {
  mode: 'single';
  value: string | null;
  onChange: (next: string | null) => void;
};

type MultiProps = CommonProps & {
  mode: 'multi';
  value: string[];
  onChange: (next: string[]) => void;
  maxSelections?: number | null;
  showRegionBundles?: boolean;
};

export type CountryPickerProps = SingleProps | MultiProps;

// ─── Top-level shared state for the country list ──────────────────────────

interface ListState {
  loading: boolean;
  error: string | null;
  countries: CountryCode[];
}

function useCountryList(): ListState {
  const [state, setState] = useState<ListState>({
    loading: true,
    error: null,
    countries: [],
  });

  useEffect(() => {
    let cancelled = false;
    loadCountryCodes()
      .then((list) => {
        if (cancelled) return;
        setState({ loading: false, error: null, countries: list });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: err?.message ?? 'Failed to load country list.',
          countries: [],
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

// ─── Public component ────────────────────────────────────────────────────

export default function CountryPicker(props: CountryPickerProps) {
  const { loading, error, countries } = useCountryList();
  const [modalOpen, setModalOpen] = useState(false);

  const selectedCountries: CountryCode[] = useMemo(() => {
    if (loading || error) return [];
    if (props.mode === 'single') {
      const c = countries.find((x) => x.code === props.value);
      return c ? [c] : [];
    }
    return countries.filter((c) => props.value.includes(c.code));
  }, [props.mode, props.mode === 'single' ? props.value : props.value, countries, loading, error]);

  const summary = (() => {
    if (loading) return 'Loading countries…';
    if (error) return 'Tap to retry — couldn’t load countries';
    if (props.mode === 'single') {
      if (selectedCountries.length === 0) return 'Search & select a country…';
      const s = selectedCountries[0];
      return `${s.code} · ${s.name}`;
    }
    if (props.value.length === 0) return 'Search & add countries…';
    const cap =
      typeof props.maxSelections === 'number' ? ` / ${props.maxSelections}` : '';
    return `${props.value.length} selected${cap} — tap to edit`;
  })();

  const handleClearSingle = (e: any) => {
    if (props.mode !== 'single') return;
    e?.stopPropagation?.();
    props.onChange(null);
  };

  const handleRemoveMulti = (code: string) => {
    if (props.mode !== 'multi') return;
    props.onChange(props.value.filter((c) => c !== code));
  };

  return (
    <View style={styles.root}>
      {props.label ? <Text style={styles.label}>{props.label}</Text> : null}

      <TouchableOpacity
        style={styles.trigger}
        onPress={() => !loading && setModalOpen(true)}
        activeOpacity={0.7}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator size="small" color={C.primary} />
        ) : (
          <Globe size={16} color={C.primary} strokeWidth={2.2} />
        )}
        <Text style={styles.triggerText} numberOfLines={1}>
          {summary}
        </Text>

        {/* Single-mode quick-clear ✕ inside the trigger. */}
        {props.mode === 'single' && props.value ? (
          <TouchableOpacity
            onPress={handleClearSingle}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            style={styles.triggerClear}
          >
            <X size={14} color={C.textMuted} strokeWidth={2.4} />
          </TouchableOpacity>
        ) : (
          <ChevronRight size={16} color={C.textMuted} strokeWidth={2} />
        )}
      </TouchableOpacity>

      {props.helperText ? (
        <Text style={styles.helper}>{props.helperText}</Text>
      ) : null}

      {/* Multi-mode selected chips. Single-mode shows its choice inside the trigger. */}
      {props.mode === 'multi' && selectedCountries.length > 0 ? (
        <View style={styles.selectedChipsRow}>
          {selectedCountries.map((c) => (
            <TouchableOpacity
              key={c.code}
              style={styles.selectedChip}
              onPress={() => handleRemoveMulti(c.code)}
              activeOpacity={0.7}
              accessibilityLabel={`Remove ${c.name}`}
            >
              <Text style={styles.selectedChipTxt} numberOfLines={1}>
                {c.code} · {c.name}
              </Text>
              <X size={12} color={C.primary} strokeWidth={2.6} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <CountryPickerModal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        countries={countries}
        props={props}
      />
    </View>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  countries: CountryCode[];
  props: CountryPickerProps;
}

function CountryPickerModal({ visible, onClose, countries, props }: ModalProps) {
  const [query, setQuery] = useState('');

  // Reset search on open so each modal session starts clean.
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);

  const selectedSet = useMemo(() => {
    if (props.mode === 'single') {
      return new Set(props.value ? [props.value] : []);
    }
    return new Set(props.value);
  }, [props.mode, props.mode === 'single' ? props.value : props.value]);

  const filtered = useMemo(
    () => searchCountries(countries, query),
    [countries, query],
  );

  const capReached =
    props.mode === 'multi' &&
    typeof props.maxSelections === 'number' &&
    props.value.length >= props.maxSelections;

  const toggle = (code: string) => {
    if (props.mode === 'single') {
      const next = props.value === code ? null : code;
      props.onChange(next);
      // Auto-dismiss on selection — single mode has no batch intent.
      if (next !== null) onClose();
      return;
    }
    if (selectedSet.has(code)) {
      props.onChange(props.value.filter((c) => c !== code));
      return;
    }
    if (capReached) return;
    props.onChange([...props.value, code]);
  };

  const addBundle = (slug: string) => {
    if (props.mode !== 'multi') return;
    const bundle = REGION_BUNDLES.find((b) => b.slug === slug);
    if (!bundle) return;
    const expanded = expandBundle(bundle, countries);
    const merged = new Set<string>([...props.value, ...expanded]);
    let next = Array.from(merged);
    if (typeof props.maxSelections === 'number' && next.length > props.maxSelections) {
      next = next.slice(0, props.maxSelections);
    }
    props.onChange(next);
  };

  const showBundles =
    props.mode === 'multi' && props.showRegionBundles !== false;

  const renderItem = ({ item }: { item: CountryCode }) => {
    const isOn = selectedSet.has(item.code);
    const disabled = !isOn && capReached;
    return (
      <TouchableOpacity
        style={[styles.listRow, isOn && styles.listRowOn, disabled && styles.listRowDisabled]}
        onPress={() => toggle(item.code)}
        disabled={disabled}
        activeOpacity={0.7}
      >
        {props.mode === 'multi' ? (
          <View style={[styles.listRowCheck, isOn && styles.listRowCheckOn]}>
            {isOn ? <Check size={14} color={C.text} strokeWidth={3} /> : null}
          </View>
        ) : (
          <View style={[styles.singleRadio, isOn && styles.singleRadioOn]}>
            {isOn ? <View style={styles.singleRadioDot} /> : null}
          </View>
        )}
        <View style={styles.listRowText}>
          <Text style={styles.listRowLabel} numberOfLines={1}>
            {item.code} · {item.name}
          </Text>
          {item.region_group ? (
            <Text style={styles.listRowSub}>{item.region_group}</Text>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  // Build the count badge string with explicit narrowing so TS doesn't
  // need a cast — single/multi access different fields.
  let headerCount: string;
  if (props.mode === 'single') {
    headerCount = props.value ? '1' : '0';
  } else {
    const cap = props.maxSelections ? `/${props.maxSelections}` : '';
    headerCount = `${props.value.length}${cap}`;
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'fullScreen'}
      onRequestClose={onClose}
      transparent={false}
    >
      <SafeAreaView style={styles.modalRoot} edges={['top']}>
        <View style={styles.modalHdr}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={24} color={C.text} strokeWidth={2} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>
            {props.mode === 'single' ? 'Select country' : 'Select countries'}
          </Text>
          <View style={styles.modalCountBadge}>
            <Text style={styles.modalCountTxt}>{headerCount}</Text>
          </View>
        </View>

        <View style={styles.modalSearchWrap}>
          <View style={styles.modalSearchBar}>
            <Search size={15} color={C.textMuted} strokeWidth={2} />
            <TextInput
              style={styles.modalSearchInput}
              placeholder={props.searchPlaceholder ?? 'Search countries…'}
              placeholderTextColor={C.textMuted}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="characters"
            />
            {query.length > 0 ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
                <X size={14} color={C.textMuted} strokeWidth={2.4} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {showBundles ? (
          <View style={styles.groupRowWrap}>
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.groupRow}
              data={REGION_BUNDLES.slice()}
              keyExtractor={(b) => b.slug}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.bundleChip}
                  onPress={() => addBundle(item.slug)}
                  activeOpacity={0.7}
                  disabled={capReached}
                >
                  <Plus size={12} color={C.primary} strokeWidth={2.6} />
                  <Text style={styles.bundleChipTxt}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        ) : null}

        <FlatList
          data={filtered}
          keyExtractor={(c) => c.code}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No countries match.</Text>
              <Text style={styles.emptyBody}>Try a different search term.</Text>
            </View>
          }
        />

        {/* Footer — only shown in multi mode (single auto-dismisses on tap). */}
        {props.mode === 'multi' ? (
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.modalDoneBtn}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={styles.modalDoneTxt}>
                Done · {props.value.length} selected
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { width: '100%' },

  label: { color: C.textSec, fontSize: 13, fontWeight: '600', marginBottom: 8 },

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
  triggerText: { flex: 1, color: C.text, fontSize: 14, fontWeight: '500' },
  triggerClear: {
    padding: 4,
    borderRadius: 12,
    backgroundColor: C.chipBg,
    borderWidth: 1,
    borderColor: C.chipBorder,
  },

  helper: { color: C.textMuted, fontSize: 12, marginTop: 6 },
  errorText: { color: '#F87171', fontSize: 12, marginTop: 6 },

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
  selectedChipTxt: { color: C.text, fontSize: 12, fontWeight: '600', maxWidth: 220 },

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
  modalSearchInput: { flex: 1, color: C.text, fontSize: 14, padding: 0 },

  groupRowWrap: { paddingBottom: 8 },
  groupRow: { paddingHorizontal: 16, paddingVertical: 6, gap: 8 },
  bundleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.primarySoft,
    borderWidth: 1,
    borderColor: C.primaryBorder,
    borderStyle: 'dashed',
  },
  bundleChipTxt: { color: C.text, fontSize: 12, fontWeight: '600' },

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
  listRowDisabled: { opacity: 0.45 },
  listRowCheck: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listRowCheckOn: { backgroundColor: C.primary, borderColor: C.primary },
  singleRadio: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  singleRadioOn: { borderColor: C.primary },
  singleRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: C.primary,
  },
  listRowText: { flex: 1 },
  listRowLabel: { color: C.text, fontSize: 14, fontWeight: '600' },
  listRowSub: { color: C.textMuted, fontSize: 12, marginTop: 2 },

  emptyState: { paddingHorizontal: 24, paddingVertical: 36, alignItems: 'center' },
  emptyTitle: { color: C.text, fontSize: 15, fontWeight: '600' },
  emptyBody: { color: C.textMuted, fontSize: 13, marginTop: 6, textAlign: 'center' },

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
