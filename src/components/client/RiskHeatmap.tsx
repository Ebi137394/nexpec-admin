// ============================================================
// RiskHeatmap – Compliance summary by category
// Shows high-risk categories first, color-coded bars.
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../../lib/supabase';
import { CLIENT_THEME as T } from './theme';
import type { RiskCategory, Finding } from './types';

interface Props {
  clientId: string;
}

// Weight multipliers for risk score
const SEVERITY_WEIGHT = {
  critical: 10,
  high: 5,
  medium: 2,
  low: 1,
};

const RISK_BAR_COLORS: Record<string, string> = {
  critical: T.red,
  high: T.amber,
  medium: T.blue,
  low: T.green,
};

export default function RiskHeatmap({ clientId }: Props) {
  const [categories, setCategories] = useState<RiskCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFindings = useCallback(async () => {
    // Fetch all findings for this client's projects
    const { data, error } = await supabase
      .from('findings')
      .select('id, category, severity, project:projects!inner(client_id)')
      .eq('project.client_id', clientId);

    if (error) {
      console.error('[RiskHeatmap] fetch error:', error.message);
      setLoading(false);
      return;
    }

    // Aggregate by category
    const map = new Map<string, RiskCategory>();

    (data ?? []).forEach((f: any) => {
      const cat = f.category || 'Uncategorized';
      const sev = f.severity as keyof typeof SEVERITY_WEIGHT;

      if (!map.has(cat)) {
        map.set(cat, {
          category: cat,
          total: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          riskScore: 0,
        });
      }

      const entry = map.get(cat)!;
      entry.total++;
      entry[sev]++;
      entry.riskScore += SEVERITY_WEIGHT[sev] ?? 1;
    });

    // Sort by riskScore descending
    const sorted = Array.from(map.values()).sort(
      (a, b) => b.riskScore - a.riskScore,
    );

    setCategories(sorted);
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    fetchFindings();
  }, [fetchFindings]);

  const maxScore = categories.length > 0
    ? Math.max(...categories.map((c) => c.riskScore))
    : 1;

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Ionicons name="shield-checkmark-outline" size={20} color={T.amber} />
        <Text style={styles.sectionTitle}>Compliance Heatmap</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={T.amber} size="small" style={{ padding: 20 }} />
      ) : categories.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="checkmark-done-circle" size={32} color={T.green} />
          <Text style={styles.emptyTitle}>All Clear</Text>
          <Text style={styles.emptySubtitle}>No findings recorded yet.</Text>
        </View>
      ) : (
        <View style={styles.heatmapCard}>
          {categories.map((cat, idx) => {
            const barPct = (cat.riskScore / maxScore) * 100;
            const riskLevel = getRiskLevel(cat);

            return (
              <View key={cat.category} style={styles.row}>
                {/* Category label */}
                <View style={styles.labelCol}>
                  <Text style={styles.catName} numberOfLines={1}>
                    {cat.category}
                  </Text>
                  <Text style={[styles.riskLabel, { color: riskLevel.color }]}>
                    {riskLevel.label}
                  </Text>
                </View>

                {/* Stacked bar */}
                <View style={styles.barCol}>
                  <View style={styles.barBg}>
                    {/* Stacked segments */}
                    <View style={styles.barStack}>
                      {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
                        const count = cat[sev];
                        if (count === 0) return null;
                        const segPct = (count / cat.total) * barPct;
                        return (
                          <View
                            key={sev}
                            style={[
                              styles.barSegment,
                              {
                                backgroundColor: RISK_BAR_COLORS[sev],
                                width: `${segPct}%`,
                              },
                            ]}
                          />
                        );
                      })}
                    </View>
                  </View>
                </View>

                {/* Count */}
                <Text style={styles.countLabel}>{cat.total}</Text>
              </View>
            );
          })}

          {/* Legend */}
          <View style={styles.legendRow}>
            {Object.entries(RISK_BAR_COLORS).map(([sev, color]) => (
              <View key={sev} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: color }]} />
                <Text style={styles.legendText}>
                  {sev.charAt(0).toUpperCase() + sev.slice(1)}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────

function getRiskLevel(cat: RiskCategory): { label: string; color: string } {
  if (cat.critical > 0) return { label: 'Critical Risk', color: T.red };
  if (cat.high > 2)     return { label: 'High Risk',     color: T.amber };
  if (cat.medium > 3)   return { label: 'Moderate',      color: T.blue };
  return                        { label: 'Low Risk',      color: T.green };
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

  heatmapCard: {
    backgroundColor: T.card,
    borderRadius: T.radiusLg,
    borderWidth: 1,
    borderColor: T.border,
    padding: 16,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },

  labelCol: {
    width: 100,
  },
  catName: {
    color: T.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  riskLabel: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },

  barCol: {
    flex: 1,
  },
  barBg: {
    height: 14,
    backgroundColor: T.cardElevated,
    borderRadius: 7,
    overflow: 'hidden',
  },
  barStack: {
    flexDirection: 'row',
    height: '100%',
  },
  barSegment: {
    height: '100%',
  },

  countLabel: {
    color: T.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    width: 32,
    textAlign: 'right',
  },

  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: T.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: T.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },

  emptyState: {
    alignItems: 'center',
    backgroundColor: T.card,
    borderRadius: T.radiusMd,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 28,
    gap: 4,
  },
  emptyTitle: {
    color: T.green,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  emptySubtitle: {
    color: T.textMuted,
    fontSize: 12,
  },
});