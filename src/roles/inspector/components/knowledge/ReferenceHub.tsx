// src/components/inspector/knowledge/ReferenceHub.tsx

import React, { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  Animated,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useKnowledgeBase } from '@/src/hooks/useKnowledgeBase';
import type { KnowledgeDocument } from '@/src/types/resources';
import StandardCard from './StandardCard';
import GlossaryCard from './GlossaryCard';

type TabKey = 'standards' | 'glossary';

export default function ReferenceHub() {
  const { documents, docTypes, loading, error } = useKnowledgeBase();
  const [activeTab, setActiveTab] = useState<TabKey>('standards');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const tabIndicator = useRef(new Animated.Value(0)).current;

  // ---------- Search Filtering ----------
  const filteredStandards = useMemo(() => {
    if (!searchQuery.trim()) return documents.filter(d => d.type === 'Standard');
    const q = searchQuery.toLowerCase();
    return documents.filter(d => d.type === 'Standard').filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)) ||
        (s.file_size && s.file_size.toLowerCase().includes(q))
    );
  }, [documents, searchQuery]);

  const filteredGlossary = useMemo(() => {
    if (!searchQuery.trim()) return documents.filter(d => d.type === 'Article');
    const q = searchQuery.toLowerCase();
    return documents.filter(d => d.type === 'Article').filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        (g.description && g.description.toLowerCase().includes(q))
    );
  }, [documents, searchQuery]);

  // ---------- Tab Switch ----------
  const switchTab = (tab: TabKey) => {
    setActiveTab(tab);
    Animated.spring(tabIndicator, {
      toValue: tab === 'standards' ? 0 : 1,
      useNativeDriver: true,
      tension: 300,
      friction: 25,
    }).start();
  };

  const indicatorTranslateX = tabIndicator.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1], // We'll use percentage-based in style
  });

  const currentData = activeTab === 'standards' ? filteredStandards : filteredGlossary;
  const resultCount = currentData.length;
  const totalCount =
    activeTab === 'standards' ? filteredStandards.length : filteredGlossary.length;

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <View style={styles.sectionIconWrap}>
            <Ionicons name="library-outline" size={18} color="#0984E3" />
          </View>
          <View>
            <Text style={styles.sectionTitle}>Pocket Codebook</Text>
            <Text style={styles.sectionSubtitle}>
              Offline Reference • {documents.filter(d => d.type === 'Standard').length} Standards • {documents.filter(d => d.type === 'Article').length} Terms
            </Text>
          </View>
        </View>
      </View>

      {/* Search Bar */}
      <View
        style={[
          styles.searchContainer,
          isSearchFocused && styles.searchContainerFocused,
        ]}
      >
        <Ionicons
          name="search"
          size={17}
          color={isSearchFocused ? '#0984E3' : 'rgba(255,255,255,0.3)'}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search codes, terms, keywords..."
          placeholderTextColor="rgba(255,255,255,0.25)"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setIsSearchFocused(false)}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              setSearchQuery('');
              Keyboard.dismiss();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <View style={styles.clearButton}>
              <Ionicons name="close" size={13} color="rgba(255,255,255,0.6)" />
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'standards' && styles.tabActive]}
          onPress={() => switchTab('standards')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="document-text-outline"
            size={15}
            color={activeTab === 'standards' ? '#0984E3' : 'rgba(255,255,255,0.35)'}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === 'standards' && styles.tabTextActive,
            ]}
          >
            Standards
          </Text>
          <View
            style={[
              styles.tabCount,
              activeTab === 'standards' && styles.tabCountActive,
            ]}
          >
            <Text
              style={[
                styles.tabCountText,
                activeTab === 'standards' && styles.tabCountTextActive,
              ]}
            >
              {filteredStandards.length}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'glossary' && styles.tabActive]}
          onPress={() => switchTab('glossary')}
          activeOpacity={0.7}
        >
          <Ionicons
            name="text-outline"
            size={15}
            color={activeTab === 'glossary' ? '#0984E3' : 'rgba(255,255,255,0.35)'}
          />
          <Text
            style={[
              styles.tabText,
              activeTab === 'glossary' && styles.tabTextActive,
            ]}
          >
            Glossary
          </Text>
          <View
            style={[
              styles.tabCount,
              activeTab === 'glossary' && styles.tabCountActive,
            ]}
          >
            <Text
              style={[
                styles.tabCountText,
                activeTab === 'glossary' && styles.tabCountTextActive,
              ]}
            >
              {filteredGlossary.length}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Search Status */}
      {searchQuery.trim().length > 0 && (
        <View style={styles.searchStatus}>
          <Text style={styles.searchStatusText}>
            Showing {resultCount} of {totalCount} results for "
            <Text style={styles.searchStatusQuery}>{searchQuery}</Text>"
          </Text>
        </View>
      )}

      {/* Content List */}
      {activeTab === 'standards' ? (
        <FlatList
          data={filteredStandards}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <StandardCard 
              standard={{
                id: item.id,
                code: item.title,
                title: item.title,
                organization: 'API',
                version: '1.0',
                scope: item.description || '',
                tags: [],
                keyPoints: [],
                relatedCodes: [],
              }} 
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Ionicons
                  name="search-outline"
                  size={32}
                  color="rgba(255,255,255,0.15)"
                />
              </View>
              <Text style={styles.emptyTitle}>No Results Found</Text>
              <Text style={styles.emptySubtitle}>
                Try different keywords or check your spelling
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={filteredGlossary}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <GlossaryCard 
              term={{
                id: item.id,
                term: item.title,
                abbreviation: '',
                definition: item.description || '',
                category: 'process',
                relatedTerms: [],
                standardRefs: [],
              }} 
            />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Ionicons
                  name="search-outline"
                  size={32}
                  color="rgba(255,255,255,0.15)"
                />
              </View>
              <Text style={styles.emptyTitle}>No Results Found</Text>
              <Text style={styles.emptySubtitle}>
                Try different keywords or check your spelling
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sectionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(9,132,227,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  sectionSubtitle: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    marginHorizontal: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  searchContainerFocused: {
    borderColor: 'rgba(9,132,227,0.4)',
    backgroundColor: 'rgba(9,132,227,0.06)',
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
    padding: 0,
  },
  clearButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tabs
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 14,
    marginBottom: 4,
    gap: 8,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 7,
  },
  tabActive: {
    backgroundColor: 'rgba(9,132,227,0.1)',
    borderColor: 'rgba(9,132,227,0.25)',
  },
  tabText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#0984E3',
  },
  tabCount: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  tabCountActive: {
    backgroundColor: 'rgba(9,132,227,0.2)',
  },
  tabCountText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    fontWeight: '700',
  },
  tabCountTextActive: {
    color: '#0984E3',
  },

  // Search status
  searchStatus: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  searchStatusText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 12,
  },
  searchStatusQuery: {
    color: '#0984E3',
    fontWeight: '600',
  },

  // List
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 30,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
});