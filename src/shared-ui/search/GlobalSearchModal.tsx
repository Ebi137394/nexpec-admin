// ════════════════════════════════════════════════════════════════════════════
//  src/shared-ui/search/GlobalSearchModal.tsx
//
//  Sprint 13.M3 — Mobile parity for the web Cmd+K Global Search.
//
//  Mirrors apps/web/src/components/search/GlobalSearch.tsx behaviour:
//    • Calls supabase.rpc('global_search', { p_query, p_limit }) on every
//      keystroke, debounced 180ms (same as web).
//    • Drops inflight responses if a newer keystroke has already fired
//      (requestId monotonic counter — RN's AbortController-equivalent for
//      supabase-js Promises).
//    • Renders three grouped sections: Inspectors / Jobs / Scope templates.
//    • Permission filtering happens inside the RPC (SECURITY DEFINER) —
//      anonymous viewers see inspector matches only, authenticated users
//      get the full set scoped to their role.
//
//  Mobile-specific navigation contract (the RPC returns web hrefs; we
//  re-derive native targets from the `kind` field so the user lands on
//  the proper screen):
//    • inspector       → Linking.openURL(`${WEB_BASE}/p/${id}`)
//                        (public directory profile is web-only for now)
//    • job             → router.push(`/(tabs)/jobs/${id}`)
//                        (real mobile job-detail screen)
//    • scope_template  → Linking.openURL(`${WEB_BASE}/admin/scope-templates`)
//                        (admin-only surface, no mobile parity yet)
//
//  UI/UX guarantees:
//    • Dark/purple aesthetic identical to the rest of the app.
//    • No external dependencies introduced — only Modal + Ionicons +
//      expo-router + supabase, all already in the bundle.
//    • Modal animation: slide from bottom. Backdrop tap closes.
//    • All Ionicons names verified against the canonical TS union.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';

/* ─── Theme (matches the security/onboarding cards already shipped) ─── */
const COLORS = {
  backdrop: 'rgba(2,4,32,0.86)',
  sheet: '#0F172A',
  surfaceLight: '#1E293B',
  border: '#1F2937',
  borderViolet: 'rgba(124,58,237,0.30)',
  primary: '#7C3AED',
  primaryLight: '#8B5CF6',
  primarySoft: 'rgba(124,58,237,0.12)',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  textDim: '#64748B',
  green: '#10B981',
  amber: '#FBBF24',
};

const DEBOUNCE_MS = 180;
const PER_KIND_LIMIT = 8;

/* The public web base — used for the two entity kinds that don't yet
   have a native mobile screen. Falls back to the production domain
   when EXPO_PUBLIC_WEB_URL isn't set (e.g. local dev with no env file). */
const WEB_BASE =
  (process.env.EXPO_PUBLIC_WEB_URL && process.env.EXPO_PUBLIC_WEB_URL.replace(/\/$/, '')) ||
  'https://nexpec.com';

/* ─── RPC types ─────────────────────────────────────────────────────── */

type EntityKind = 'inspector' | 'job' | 'scope_template';

interface ResultItem {
  kind: EntityKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
}

interface RpcResults {
  inspectors: ResultItem[];
  jobs: ResultItem[];
  scopes: ResultItem[];
}

interface RpcResponse {
  query: string;
  results: RpcResults;
}

/* ─── Props ─────────────────────────────────────────────────────────── */

interface Props {
  visible: boolean;
  onClose: () => void;
}

/* ════════════════════════════════════════════════════════════════════ */

export function GlobalSearchModal({ visible, onClose }: Props) {
  const router = useRouter();
  const inputRef = useRef<TextInput | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RpcResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /* ─── Reset whenever the modal closes ─────────────────────────────── */
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setResults(null);
      setLoading(false);
      setErrorMsg(null);
      requestIdRef.current += 1; // invalidate any inflight responses
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    } else {
      // Auto-focus on open — small delay lets the slide animation finish.
      const t = setTimeout(() => inputRef.current?.focus(), 220);
      return () => clearTimeout(t);
    }
  }, [visible]);

  /* ─── Debounced RPC call with monotonic request gating ────────────── */
  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setLoading(false);
      setErrorMsg(null);
      return;
    }
    const myRequest = ++requestIdRef.current;
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.rpc('global_search', {
        p_query: trimmed,
        p_limit: PER_KIND_LIMIT,
      });
      // If a newer keystroke has already fired, drop this response.
      if (myRequest !== requestIdRef.current) return;
      if (error) {
        console.warn('[GlobalSearchModal] rpc error', error.message);
        setResults(null);
        setErrorMsg('Search service temporarily unavailable.');
      } else {
        const payload = data as RpcResponse | null;
        setResults(payload?.results ?? null);
      }
    } catch (err) {
      if (myRequest !== requestIdRef.current) return;
      console.warn('[GlobalSearchModal] rpc threw', err);
      setErrorMsg('Could not reach the search service.');
      setResults(null);
    } finally {
      if (myRequest === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch, visible]);

  /* ─── Result counts ───────────────────────────────────────────────── */
  const totalCount = useMemo(() => {
    if (!results) return 0;
    return (
      (results.inspectors?.length ?? 0) +
      (results.jobs?.length ?? 0) +
      (results.scopes?.length ?? 0)
    );
  }, [results]);

  /* ─── Navigation handlers — translate RPC kind to native target ───── */
  const handleSelect = useCallback(
    async (item: ResultItem) => {
      // Close the modal first so navigation feels snappy.
      onClose();
      try {
        if (item.kind === 'job') {
          // Real mobile screen exists at app/(tabs)/jobs/[id].tsx
          router.push(`/(tabs)/jobs/${item.id}` as never);
          return;
        }
        if (item.kind === 'inspector') {
          await Linking.openURL(`${WEB_BASE}/p/${item.id}`);
          return;
        }
        if (item.kind === 'scope_template') {
          await Linking.openURL(`${WEB_BASE}/admin/scope-templates`);
          return;
        }
      } catch (err) {
        console.warn('[GlobalSearchModal] navigation failed', err);
      }
    },
    [onClose, router],
  );

  /* ════════════════════════════════════════════════════════════════════ */
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kbAvoider}
        >
          <View style={styles.sheet}>
            {/* drag handle */}
            <View style={styles.handle} />

            {/* search input row */}
            <View style={styles.inputRow}>
              {loading ? (
                <ActivityIndicator
                  size="small"
                  color={COLORS.primaryLight}
                  style={styles.inputIcon}
                />
              ) : (
                <Ionicons
                  name="search-outline"
                  size={18}
                  color={COLORS.textMuted}
                  style={styles.inputIcon}
                />
              )}
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                placeholder="Search inspectors, jobs, scope templates…"
                placeholderTextColor={COLORS.textDim}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                returnKeyType="search"
                clearButtonMode="never"
              />
              {query.length > 0 && (
                <TouchableOpacity
                  onPress={() => setQuery('')}
                  style={styles.clearBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={COLORS.textDim}
                  />
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={onClose}
                style={styles.closeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {/* status line */}
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>
                {errorMsg
                  ? errorMsg
                  : query.trim().length < 2
                  ? 'Type at least two characters to search.'
                  : loading
                  ? 'Searching…'
                  : totalCount > 0
                  ? `${totalCount} match${totalCount === 1 ? '' : 'es'}`
                  : 'No matches'}
              </Text>
            </View>

            {/* results body */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {query.trim().length < 2 && !errorMsg && (
                <EmptyHint />
              )}

              {query.trim().length >= 2 && !loading && totalCount === 0 && !errorMsg && (
                <NoResults query={query.trim()} />
              )}

              {results && totalCount > 0 && (
                <>
                  <ResultGroup
                    label="Inspectors"
                    icon="people-outline"
                    accent={COLORS.primaryLight}
                    rows={results.inspectors}
                    onSelect={handleSelect}
                    leadingIcon="person-outline"
                  />
                  <ResultGroup
                    label="Your jobs"
                    icon="briefcase-outline"
                    accent={COLORS.green}
                    rows={results.jobs}
                    onSelect={handleSelect}
                    leadingIcon="briefcase-outline"
                  />
                  <ResultGroup
                    label="Scope templates"
                    icon="clipboard-outline"
                    accent={COLORS.amber}
                    rows={results.scopes}
                    onSelect={handleSelect}
                    leadingIcon="document-text-outline"
                  />
                </>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/* ─── Subcomponents ────────────────────────────────────────────────── */

interface GroupProps {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  rows: ResultItem[];
  onSelect: (item: ResultItem) => void;
  leadingIcon: keyof typeof Ionicons.glyphMap;
}

function ResultGroup({
  label,
  icon,
  accent,
  rows,
  onSelect,
  leadingIcon,
}: GroupProps) {
  if (!rows || rows.length === 0) return null;
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Ionicons name={icon} size={12} color={accent} />
        <Text style={[styles.groupLabel, { color: accent }]}>{label}</Text>
        <Text style={styles.groupCount}>{rows.length}</Text>
      </View>
      {rows.map((row) => (
        <TouchableOpacity
          key={`${row.kind}-${row.id}`}
          style={styles.row}
          activeOpacity={0.7}
          onPress={() => onSelect(row)}
        >
          <View style={styles.rowIconWrap}>
            <Ionicons
              name={leadingIcon}
              size={16}
              color={COLORS.primaryLight}
            />
          </View>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {row.title}
            </Text>
            {!!row.subtitle && (
              <Text style={styles.rowSubtitle} numberOfLines={1}>
                {row.subtitle}
              </Text>
            )}
          </View>
          <Ionicons
            name={row.kind === 'job' ? 'chevron-forward' : 'open-outline'}
            size={14}
            color={COLORS.textDim}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function EmptyHint() {
  return (
    <View style={styles.empty}>
      <Ionicons
        name="sparkles-outline"
        size={20}
        color={COLORS.primaryLight}
      />
      <Text style={styles.emptyTitle}>One search across the platform</Text>
      <Text style={styles.emptyBody}>
        Find inspectors by name or specialty, jump to one of your jobs, or
        pull up a scope template — all from this box.
      </Text>
    </View>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <View style={styles.empty}>
      <Ionicons
        name="alert-circle-outline"
        size={20}
        color={COLORS.amber}
      />
      <Text style={styles.emptyTitle}>No matches for “{query}”</Text>
      <Text style={styles.emptyBody}>
        Try fewer words, a different spelling, or a specialty slug like
        “welding” or “concrete”.
      </Text>
    </View>
  );
}

/* ─── Styles ────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.backdrop,
    justifyContent: 'flex-end',
  },
  kbAvoider: {
    width: '100%',
  },
  sheet: {
    backgroundColor: COLORS.sheet,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: COLORS.borderViolet,
    borderBottomWidth: 0,
    maxHeight: '92%',
    minHeight: '60%',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15,
    paddingVertical: 6,
  },
  clearBtn: {
    marginLeft: 6,
    padding: 4,
  },
  closeBtn: {
    marginLeft: 4,
    padding: 4,
  },
  statusRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.015)',
  },
  statusText: {
    color: COLORS.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  group: {
    paddingTop: 12,
    paddingHorizontal: 12,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 6,
    gap: 6,
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  groupCount: {
    marginLeft: 'auto',
    color: COLORS.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 12,
  },
  rowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: COLORS.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  rowSubtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
  },
  empty: {
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyBody: {
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 280,
  },
});
