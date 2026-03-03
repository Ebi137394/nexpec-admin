// src/components/inspector/knowledge/GlossaryCard.tsx

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
import {
  GlossaryTerm,
  CATEGORY_COLORS,
  SEVERITY_COLORS,
} from './constants/referenceData';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface GlossaryCardProps {
  term: GlossaryTerm;
}

const CATEGORY_ICONS: Record<GlossaryTerm['category'], keyof typeof Ionicons.glyphMap> = {
  defect: 'warning-outline',
  process: 'cog-outline',
  material: 'cube-outline',
  measurement: 'analytics-outline',
  safety: 'shield-checkmark-outline',
  method: 'scan-outline',
};

export default function GlossaryCard({ term }: GlossaryCardProps) {
  const [expanded, setExpanded] = useState(false);

  const catColor = CATEGORY_COLORS[term.category];
  const sevColor = term.severity ? SEVERITY_COLORS[term.severity] : '#0984E3';
  const catIcon = CATEGORY_ICONS[term.category];

  const toggleExpand = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded(!expanded);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={toggleExpand}
      style={[styles.card, { borderLeftColor: catColor }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconCircle, { backgroundColor: `${catColor}20` }]}>
            <Ionicons name={catIcon} size={16} color={catColor} />
          </View>
          <View style={styles.titleBlock}>
            <View style={styles.titleRow}>
              <Text style={styles.termText}>{term.term}</Text>
              {term.abbreviation && (
                <View style={[styles.abbrevBadge, { backgroundColor: `${catColor}25` }]}>
                  <Text style={[styles.abbrevText, { color: catColor }]}>
                    {term.abbreviation}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.metaRow}>
              <View style={[styles.categoryPill, { backgroundColor: `${catColor}15` }]}>
                <Text style={[styles.categoryText, { color: catColor }]}>
                  {term.category.charAt(0).toUpperCase() + term.category.slice(1)}
                </Text>
              </View>
              {term.severity && (
                <View style={[styles.severityDot, { backgroundColor: sevColor }]} />
              )}
            </View>
          </View>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color="rgba(255,255,255,0.4)"
        />
      </View>

      {/* Preview line when collapsed */}
      {!expanded && (
        <Text style={styles.previewText} numberOfLines={2}>
          {term.definition}
        </Text>
      )}

      {/* Expanded Content */}
      {expanded && (
        <View style={styles.expandedContent}>
          <Text style={styles.definitionText}>{term.definition}</Text>

          {/* Related Terms */}
          {term.relatedTerms.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Related Terms</Text>
              <View style={styles.chipRow}>
                {term.relatedTerms.map((rt, idx) => (
                  <View key={idx} style={styles.chip}>
                    <Text style={styles.chipText}>{rt}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* Standard References */}
          {term.standardRefs.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Referenced In</Text>
              <View style={styles.chipRow}>
                {term.standardRefs.map((ref, idx) => (
                  <View key={idx} style={[styles.chip, styles.refChip]}>
                    <Ionicons name="document-text-outline" size={10} color="#0984E3" />
                    <Text style={[styles.chipText, { color: '#0984E3', marginLeft: 4 }]}>
                      {ref}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderLeftWidth: 3,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    marginRight: 8,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  titleBlock: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  termText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  abbrevBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  abbrevText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    gap: 6,
  },
  categoryPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  previewText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12.5,
    lineHeight: 18,
    marginTop: 10,
  },
  expandedContent: {
    marginTop: 12,
  },
  definitionText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    lineHeight: 20,
  },
  section: {
    marginTop: 14,
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  refChip: {
    backgroundColor: 'rgba(9,132,227,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '500',
  },
});