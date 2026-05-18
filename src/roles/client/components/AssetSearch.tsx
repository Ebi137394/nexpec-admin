// ============================================================
// AssetSearch – Filter by Project Name OR Asset Tag
// Debounced search with result previews.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { CLIENT_THEME as T } from './theme';
import type { Project } from './types';

interface Props {
  clientId: string;
}

export default function AssetSearch({ clientId }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Project[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // ── Debounced search ───────────────────────────────────
  const search = useCallback(
    async (term: string) => {
      if (term.trim().length < 2) {
        setResults([]);
        setHasSearched(false);
        setSearching(false);
        return;
      }

      setSearching(true);
      setHasSearched(true);

      const pattern = `%${term.trim()}%`;

      const { data, error } = await supabase
        .from('projects')
        .select('*, inspector:profiles!inspector_id(id, full_name, avatar_url)')
        .eq('client_id', clientId)
        .or(`title.ilike.${pattern},asset_tag.ilike.${pattern},location.ilike.${pattern}`)
        .order('updated_at', { ascending: false })
        .limit(20);

      if (!error && data) {
        setResults(data as Project[]);
      }
      setSearching(false);
    },
    [clientId],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  // ── Status color helper ────────────────────────────────
  const statusColor = (s: string) => {
    switch (s) {
      case 'pending':     return T.stagePending;
      case 'in_progress': return T.stageInProgress;
      case 'reviewing':   return T.stageReviewing;
      case 'finalized':   return T.stageFinalized;
      default:            return T.textMuted;
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Ionicons name="search-outline" size={20} color={T.cyan} />
        <Text style={styles.sectionTitle}>Asset & Data Intelligence</Text>
      </View>

      {/* Search Input */}
      <View style={styles.inputWrap}>
        <Ionicons name="search" size={18} color={T.textMuted} />
        <TextInput
          style={styles.input}
          placeholder='Search by project, asset tag (e.g. "Tank-101"), or location…'
          placeholderTextColor={T.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={T.textMuted} />
          </Pressable>
        )}
      </View>

      {/* Results */}
      {searching ? (
        <Text style={styles.statusText}>Searching…</Text>
      ) : hasSearched && results.length === 0 ? (
        <View style={styles.noResults}>
          <Ionicons name="file-tray-outline" size={28} color={T.textMuted} />
          <Text style={styles.noResultsText}>No matches found</Text>
        </View>
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <Pressable style={styles.resultCard}>
              <View style={styles.resultLeft}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <View style={styles.resultMeta}>
                  <Ionicons name="location-outline" size={11} color={T.textMuted} />
                  <Text style={styles.resultMetaText} numberOfLines={1}>
                    {item.location}
                  </Text>
                </View>
                {item.asset_tag && (
                  <View style={styles.assetChip}>
                    <Ionicons name="pricetag" size={10} color={T.cyan} />
                    <Text style={styles.assetChipText}>{item.asset_tag}</Text>
                  </View>
                )}
              </View>
              <View style={styles.resultRight}>
                <View style={[styles.statusPill, { backgroundColor: statusColor(item.status) + '22' }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor(item.status) }]} />
                  <Text style={[styles.statusText2, { color: statusColor(item.status) }]}>
                    {formatStatus(item.status)}
                  </Text>
                </View>
              </View>
            </Pressable>
          )}
        />
      ) : null}
    </View>
  );
}

function formatStatus(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Styles ───────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { marginBottom: 24 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    color: T.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
  },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.card,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 10,
  },
  input: {
    flex: 1,
    color: T.textPrimary,
    fontSize: 14,
    padding: 0,
  },

  statusText: {
    color: T.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 12,
  },

  noResults: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 6,
  },
  noResultsText: {
    color: T.textMuted,
    fontSize: 13,
  },

  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.card,
    borderRadius: T.radiusSm,
    borderWidth: 1,
    borderColor: T.border,
    padding: 12,
    marginBottom: 6,
  },
  resultLeft: { flex: 1 },
  resultTitle: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 3,
  },
  resultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  resultMetaText: {
    color: T.textMuted,
    fontSize: 11,
    flex: 1,
  },
  assetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.cyanDim + '55',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    gap: 4,
  },
  assetChipText: {
    color: T.cyan,
    fontSize: 11,
    fontWeight: '600',
  },

  resultRight: { marginLeft: 10 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText2: {
    fontSize: 10,
    fontWeight: '700',
  },
});