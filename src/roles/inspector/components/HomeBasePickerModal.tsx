// ───────────────────────────────────────────────────────────────────
//  src/components/inspector/HomeBasePickerModal.tsx
//  Phase 5 — Inspector Job Feed / Discovery Engine (Step 3)
//
//  Modal that lets an inspector pick their home base via two paths:
//    (1) "Use Current Location" — requests OS location permission,
//        captures coords, reverse-geocodes to a city/region label.
//    (2) "Search City" — typeahead-ish: user types, we forward-geocode
//        via Expo Location, render up to 5 results, tap to commit.
//
//  Returns { lat, lng, label } via onSelect — parent persists it to
//  profiles.home_base_lat / home_base_lng / home_base_label.
//
//  Matches the codebase's modal pattern (RN <Modal animationType="slide">)
//  and the NEXPEC theme used in RadiusPickerSheet.
// ───────────────────────────────────────────────────────────────────

import React, { useCallback, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

// ═══════════════════════════════════════════════════════════════════
//  THEME (NEXPEC — locked)
// ═══════════════════════════════════════════════════════════════════
const C = {
  bg:              '#020420',
  surface:         '#0A0E2E',
  surfaceElevated: '#111640',
  border:          '#1A1F4E',
  primary:         '#7C3AED',
  primaryLight:    '#8B5CF6',
  primaryBg:       'rgba(124, 58, 237, 0.12)',
  blue:            '#3B82F6',
  blueBg:          'rgba(59, 130, 246, 0.12)',
  green:           '#10B981',
  amber:           '#F59E0B',
  red:             '#EF4444',
  textPrimary:     '#F8FAFC',
  textSecondary:   '#94A3B8',
  textMuted:       '#64748B',
  backdrop:        'rgba(0, 0, 0, 0.65)',
};

// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
function labelFromGeocode(g: Location.LocationGeocodedAddress | undefined): string {
  if (!g) return 'Unknown location';
  const city = g.city || g.subregion || (g as any).district || null;
  const region = g.region || (g as any).isoCountryCode || null;
  if (city && region) return `${city}, ${region}`;
  if (city) return city;
  if (region) return region;
  if (g.country) return g.country;
  return 'Unknown location';
}

// ═══════════════════════════════════════════════════════════════════
//  PROPS
// ═══════════════════════════════════════════════════════════════════
export interface HomeBasePickerModalProps {
  visible: boolean;
  currentLabel?: string | null;
  onSelect: (base: { lat: number; lng: number; label: string }) => void;
  onClose: () => void;
}

interface SearchResult {
  lat: number;
  lng: number;
  label: string;
}

// ═══════════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════════
const HomeBasePickerModal: React.FC<HomeBasePickerModalProps> = ({
  visible,
  currentLabel,
  onSelect,
  onClose,
}) => {
  const [mode, setMode] = useState<'main' | 'search'>('main');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [usingGps, setUsingGps] = useState(false);

  // Debounce geocode lookups while user types.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset internal state whenever the modal closes/opens.
  React.useEffect(() => {
    if (!visible) {
      setMode('main');
      setQuery('');
      setResults([]);
      setSearching(false);
      setUsingGps(false);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    }
  }, [visible]);

  // ─ Current Location path ─────────────────────────────────────────
  const handleUseCurrentLocation = useCallback(async () => {
    try {
      setUsingGps(true);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location permission denied',
          'Enable location access in Settings to use your current position, or pick a city instead.',
        );
        setUsingGps(false);
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      // Reverse-geocode to a human-readable label.
      let label = 'Current location';
      try {
        const rev = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        label = labelFromGeocode(rev?.[0]);
      } catch {
        // Reverse geocode failures aren't fatal — we still have coords.
      }

      onSelect({
        lat: Number(pos.coords.latitude.toFixed(6)),
        lng: Number(pos.coords.longitude.toFixed(6)),
        label,
      });
      onClose();
    } catch (e: any) {
      console.warn('[HomeBasePicker] GPS error:', e?.message);
      Alert.alert('Could not get your location', e?.message ?? 'Please try again.');
    } finally {
      setUsingGps(false);
    }
  }, [onSelect, onClose]);

  // ─ City Search path ──────────────────────────────────────────────
  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      // Expo Location forward-geocoding. Returns up to ~5 matches.
      const matches = await Location.geocodeAsync(trimmed);
      if (!matches?.length) {
        setResults([]);
        return;
      }

      // Reverse-geocode each match so we can present clean city/region
      // labels instead of raw coords. Cap at 5 to bound work.
      const enriched = await Promise.all(
        matches.slice(0, 5).map(async (m): Promise<SearchResult> => {
          let label = trimmed;
          try {
            const rev = await Location.reverseGeocodeAsync({
              latitude: m.latitude,
              longitude: m.longitude,
            });
            label = labelFromGeocode(rev?.[0]) || trimmed;
          } catch {
            // keep the raw query as the label if reverse geocode fails
          }
          return {
            lat: Number(m.latitude.toFixed(6)),
            lng: Number(m.longitude.toFixed(6)),
            label,
          };
        }),
      );

      // De-dupe by label so we don't show "Calgary, AB" five times.
      const dedup: SearchResult[] = [];
      const seen = new Set<string>();
      for (const r of enriched) {
        if (seen.has(r.label)) continue;
        seen.add(r.label);
        dedup.push(r);
      }
      setResults(dedup);
    } catch (e: any) {
      console.warn('[HomeBasePicker] geocode error:', e?.message);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleQueryChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => runSearch(text), 350);
    },
    [runSearch],
  );

  const handlePickResult = useCallback(
    (r: SearchResult) => {
      onSelect(r);
      onClose();
    },
    [onSelect, onClose],
  );

  // ─ Render ────────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={(e) => e.stopPropagation?.()}>
          <View style={s.handleRow}>
            <View style={s.handle} />
          </View>

          {/* Header */}
          <View style={s.header}>
            {mode === 'search' && (
              <TouchableOpacity
                style={s.backBtn}
                onPress={() => {
                  setMode('main');
                  setQuery('');
                  setResults([]);
                }}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={20} color={C.textSecondary} />
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.title}>
                {mode === 'main' ? 'Home Base' : 'Search by City'}
              </Text>
              <Text style={s.subtitle} numberOfLines={2}>
                {mode === 'main'
                  ? currentLabel
                    ? `Currently set to ${currentLabel}. Pick a new one or keep it.`
                    : 'Tell us where you typically work from. We sort jobs by distance from here.'
                  : 'Type a city, region, or address. We look up matches as you type.'}
              </Text>
            </View>
            <TouchableOpacity
              style={s.closeBtn}
              onPress={onClose}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Body — main mode */}
          {mode === 'main' && (
            <View style={s.body}>
              <TouchableOpacity
                style={[s.optionRow, usingGps && s.optionRowDisabled]}
                onPress={handleUseCurrentLocation}
                activeOpacity={0.8}
                disabled={usingGps}
              >
                <View style={[s.optionIcon, { backgroundColor: C.blueBg }]}>
                  {usingGps ? (
                    <ActivityIndicator size="small" color={C.blue} />
                  ) : (
                    <Ionicons name="locate" size={20} color={C.blue} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.optionTitle}>
                    {usingGps ? 'Getting your location…' : 'Use Current Location'}
                  </Text>
                  <Text style={s.optionSub}>
                    Uses your device's GPS. Asks for permission first.
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={s.optionRow}
                onPress={() => setMode('search')}
                activeOpacity={0.8}
              >
                <View style={[s.optionIcon, { backgroundColor: C.primaryBg }]}>
                  <Ionicons name="search" size={20} color={C.primaryLight} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.optionTitle}>Search by City</Text>
                  <Text style={s.optionSub}>
                    e.g. "Calgary, AB" or "Houston, TX"
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.textMuted} />
              </TouchableOpacity>

              <View style={s.footerHint}>
                <Ionicons
                  name="information-circle-outline"
                  size={13}
                  color={C.textMuted}
                />
                <Text style={s.footerHintText} numberOfLines={2}>
                  We store only the city you choose, never live location tracking.
                </Text>
              </View>
            </View>
          )}

          {/* Body — search mode */}
          {mode === 'search' && (
            <View style={s.body}>
              <View style={s.searchInputWrap}>
                <Ionicons name="search" size={16} color={C.textMuted} />
                <TextInput
                  style={s.searchInput}
                  value={query}
                  onChangeText={handleQueryChange}
                  placeholder="Calgary, Montreal, Houston…"
                  placeholderTextColor={C.textMuted}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="search"
                  onSubmitEditing={() => runSearch(query)}
                />
                {query.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setQuery('');
                      setResults([]);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close-circle" size={16} color={C.textMuted} />
                  </TouchableOpacity>
                )}
              </View>

              {searching && (
                <View style={s.searchingRow}>
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={s.searchingText}>Looking up matches…</Text>
                </View>
              )}

              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <View style={s.emptyRow}>
                  <Ionicons name="alert-circle-outline" size={16} color={C.textMuted} />
                  <Text style={s.emptyText}>
                    No matches. Try a different spelling or add a region.
                  </Text>
                </View>
              )}

              {results.length > 0 && (
                <ScrollView
                  style={{ maxHeight: 280 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {results.map((r, idx) => (
                    <TouchableOpacity
                      key={`${r.lat}-${r.lng}-${idx}`}
                      style={s.resultRow}
                      onPress={() => handlePickResult(r)}
                      activeOpacity={0.7}
                    >
                      <View style={s.resultIcon}>
                        <Ionicons name="location" size={16} color={C.primaryLight} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.resultLabel} numberOfLines={1}>
                          {r.label}
                        </Text>
                        <Text style={s.resultCoords}>
                          {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                        </Text>
                      </View>
                      <Ionicons
                        name="chevron-forward"
                        size={16}
                        color={C.textMuted}
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default React.memo(HomeBasePickerModal);

// ═══════════════════════════════════════════════════════════════════
//  STYLES
// ═══════════════════════════════════════════════════════════════════
const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: C.backdrop,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: Platform.select({ ios: 32, android: 24, default: 24 }),
    minHeight: 280,
  },

  handleRow: { alignItems: 'center', paddingVertical: 6 },
  handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: C.border },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 6,
    paddingBottom: 16,
    gap: 12,
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '800', color: C.textPrimary, letterSpacing: 0.2 },
  subtitle: { fontSize: 12, color: C.textSecondary, marginTop: 4, lineHeight: 17 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: { gap: 10 },

  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceElevated,
  },
  optionRowDisabled: { opacity: 0.7 },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: C.textPrimary,
  },
  optionSub: {
    fontSize: 11,
    color: C.textMuted,
    marginTop: 3,
    lineHeight: 15,
  },

  footerHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingTop: 12,
    paddingHorizontal: 2,
  },
  footerHintText: {
    flex: 1,
    fontSize: 11,
    color: C.textMuted,
    lineHeight: 15,
  },

  searchInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceElevated,
  },
  searchInput: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 14,
    padding: 0,
  },

  searchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  searchingText: { fontSize: 12, color: C.textSecondary },

  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  emptyText: { flex: 1, fontSize: 12, color: C.textMuted, lineHeight: 16 },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginTop: 6,
    backgroundColor: C.surfaceElevated,
    borderWidth: 1,
    borderColor: C.border,
  },
  resultIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: C.textPrimary,
  },
  resultCoords: {
    fontSize: 10,
    color: C.textMuted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
});
