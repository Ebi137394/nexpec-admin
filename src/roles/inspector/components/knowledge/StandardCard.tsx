// src/components/inspector/knowledge/StandardCard.tsx

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Standard, ORG_COLORS } from './constants/referenceData';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface StandardCardProps {
  standard: Standard;
}

export default function StandardCard({ standard }: StandardCardProps) {
  const [expanded, setExpanded] = useState(false);
  const orgColor = ORG_COLORS[standard.organization];

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={toggleExpand}
      style={styles.card}
    >
      {/* Top Bar Accent */}
      <View style={[styles.accentBar, { backgroundColor: orgColor }]} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.orgBadge, { backgroundColor: `${orgColor}20` }]}>
            <Text style={[styles.orgBadgeText, { color: orgColor }]}>
              {standard.organization}
            </Text>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.codeText}>{standard.code}</Text>
            <Text style={styles.titleText} numberOfLines={expanded ? 5 : 2}>
              {standard.title}
            </Text>
          </View>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="rgba(255,255,255,0.4)"
        />
      </View>

      {/* Version pill */}
      <View style={styles.versionRow}>
        <Ionicons name="calendar-outline" size={11} color="rgba(255,255,255,0.35)" />
        <Text style={styles.versionText}>{standard.version}</Text>
      </View>

      {/* Expanded Content */}
      {expanded && (
        <View style={styles.expandedContent}>
          {/* Scope */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="telescope-outline" size={13} color={orgColor} />
              <Text style={[styles.sectionLabel, { color: orgColor }]}>Scope</Text>
            </View>
            <Text style={styles.scopeText}>{standard.scope}</Text>
          </View>

          {/* Key Points */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="checkmark-circle-outline" size={13} color={orgColor} />
              <Text style={[styles.sectionLabel, { color: orgColor }]}>Key Points</Text>
            </View>
            {standard.keyPoints.map((point, idx) => (
              <View key={idx} style={styles.bulletRow}>
                <View style={[styles.bulletDot, { backgroundColor: orgColor }]} />
                <Text style={styles.bulletText}>{point}</Text>
              </View>
            ))}
          </View>

          {/* Related Codes */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="link-outline" size={13} color="rgba(255,255,255,0.5)" />
              <Text style={styles.sectionLabelMuted}>Related Codes</Text>
            </View>
            <View style={styles.chipRow}>
              {standard.relatedCodes.map((code, idx) => (
                <View key={idx} style={styles.codeChip}>
                  <Text style={styles.codeChipText}>{code}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Tags */}
          <View style={styles.tagRow}>
            {standard.tags.map((tag, idx) => (
              <View key={idx} style={styles.tag}>
                <Text style={styles.tagText}>#{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  accentBar: {
    height: 3,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: 16,
    paddingBottom: 0,
  },
  headerLeft: {
    flexDirection: 'row',
    flex: 1,
    marginRight: 8,
  },
  orgBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 12,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  orgBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  titleBlock: {
    flex: 1,
  },
  codeText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  titleText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12.5,
    lineHeight: 18,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  versionText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10.5,
    fontWeight: '500',
  },
  expandedContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
    paddingTop: 14,
  },
  section: {
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionLabelMuted: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: 'rgba(255,255,255,0.4)',
  },
  scopeText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 6,
    paddingRight: 4,
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 7,
    marginRight: 10,
    opacity: 0.7,
  },
  bulletText: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12.5,
    lineHeight: 19,
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  codeChip: {
    backgroundColor: 'rgba(9,132,227,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(9,132,227,0.2)',
  },
  codeChipText: {
    color: '#0984E3',
    fontSize: 11,
    fontWeight: '600',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  tag: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tagText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10.5,
    fontWeight: '500',
  },
});