// ============================================================
// FinancialsMiniView – Monthly Spend Chart + Milestone List
// Custom bar chart (no external chart library required).
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { CLIENT_THEME as T } from './theme';
import type { Payment, MonthlySpend, PaymentStatus } from './types';

interface Props {
  clientId: string;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const STATUS_CONFIG: Record<PaymentStatus, { color: string; icon: string; label: string }> = {
  pending:  { color: T.amber,  icon: 'time-outline',       label: 'Pending' },
  approved: { color: T.blue,   icon: 'checkmark-outline',  label: 'Approved' },
  paid:     { color: T.green,  icon: 'checkmark-done',     label: 'Paid' },
};

export default function FinancialsMiniView({ clientId }: Props) {
  const [monthlySpend, setMonthlySpend] = useState<MonthlySpend[]>([]);
  const [milestones, setMilestones] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    // Fetch payments
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*, project:projects(title)')
      .eq('client_id', clientId)
      .order('due_date', { ascending: false });

    if (error) {
      console.error('[Financials] fetch error:', error.message);
      setLoading(false);
      return;
    }

    const allPayments = (payments ?? []) as Payment[];

    // ── Build monthly aggregation (last 6 months) ──
    const now = new Date();
    const monthMap = new Map<string, number>();

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthMap.set(key, 0);
    }

    allPayments
      .filter((p) => p.status === 'paid')
      .forEach((p) => {
        const d = new Date(p.due_date);
        const key = `${d.getFullYear()}-${d.getMonth()}`;
        if (monthMap.has(key)) {
          monthMap.set(key, (monthMap.get(key) ?? 0) + p.amount);
        }
      });

    const spend: MonthlySpend[] = [];
    monthMap.forEach((amount, key) => {
      const [, mStr] = key.split('-');
      spend.push({ month: MONTH_NAMES[parseInt(mStr)], amount });
    });
    setMonthlySpend(spend);

    // ── Milestones (pending / approved only, most recent) ──
    setMilestones(
      allPayments.filter((p) => p.status !== 'paid').slice(0, 5),
    );

    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <View style={styles.loaderWrap}>
        <ActivityIndicator color={T.blue} size="small" />
      </View>
    );
  }

  const maxSpend = Math.max(...monthlySpend.map((m) => m.amount), 1);
  const totalSpend = monthlySpend.reduce((s, m) => s + m.amount, 0);

  return (
    <View style={styles.container}>
      <View style={styles.sectionHeader}>
        <Ionicons name="wallet-outline" size={20} color={T.purple} />
        <Text style={styles.sectionTitle}>Financial Overview</Text>
      </View>

      {/* ── Spend Chart ─────────────────────────────────── */}
      <View style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>Monthly Spend</Text>
          <Text style={styles.chartTotal}>
            SAR {formatCurrency(totalSpend)}
          </Text>
        </View>

        <View style={styles.chartArea}>
          {monthlySpend.map((m, i) => {
            const barHeight = maxSpend > 0
              ? Math.max((m.amount / maxSpend) * 120, 4)
              : 4;
            const isHighest = m.amount === maxSpend && m.amount > 0;

            return (
              <View key={m.month + i} style={styles.barGroup}>
                <Text style={styles.barValue}>
                  {m.amount > 0 ? formatCompact(m.amount) : '–'}
                </Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      {
                        height: barHeight,
                        backgroundColor: isHighest ? T.blue : T.blueDim,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.barLabel}>{m.month}</Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* ── Milestones List ─────────────────────────────── */}
      {milestones.length > 0 && (
        <View style={styles.milestonesCard}>
          <Text style={styles.milestonesTitle}>Payment Milestones</Text>

          {milestones.map((ms) => {
            const cfg = STATUS_CONFIG[ms.status] ?? STATUS_CONFIG.pending;

            return (
              <View key={ms.id} style={styles.msRow}>
                <View style={[styles.msIconWrap, { backgroundColor: cfg.color + '22' }]}>
                  <Ionicons name={cfg.icon as any} size={14} color={cfg.color} />
                </View>

                <View style={styles.msInfo}>
                  <Text style={styles.msDesc} numberOfLines={1}>
                    {ms.description}
                  </Text>
                  <Text style={styles.msProject} numberOfLines={1}>
                    {ms.project?.title ?? 'Unknown Project'}
                  </Text>
                </View>

                <View style={styles.msRight}>
                  <Text style={styles.msAmount}>
                    SAR {formatCurrency(ms.amount)}
                  </Text>
                  <Text style={[styles.msStatus, { color: cfg.color }]}>
                    {cfg.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ── Helpers ──────────────────────────────────────────────

function formatCurrency(n: number): string {
  return n.toLocaleString('en-SA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

// ── Styles ───────────────────────────────────────────────

const BAR_WIDTH = 36;

const styles = StyleSheet.create({
  container: { marginBottom: 24 },

  loaderWrap: { height: 120, justifyContent: 'center', alignItems: 'center' },

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

  // ── Chart ──
  chartCard: {
    backgroundColor: T.card,
    borderRadius: T.radiusLg,
    borderWidth: 1,
    borderColor: T.border,
    padding: 16,
    marginBottom: 12,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  chartTitle: {
    color: T.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  chartTotal: {
    color: T.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  chartArea: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 160,
  },
  barGroup: {
    alignItems: 'center',
    width: BAR_WIDTH,
  },
  barValue: {
    color: T.textMuted,
    fontSize: 9,
    fontWeight: '600',
    marginBottom: 4,
  },
  barTrack: {
    width: BAR_WIDTH - 8,
    height: 120,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    borderRadius: 4,
  },
  barLabel: {
    color: T.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 6,
  },

  // ── Milestones ──
  milestonesCard: {
    backgroundColor: T.card,
    borderRadius: T.radiusLg,
    borderWidth: 1,
    borderColor: T.border,
    padding: 16,
  },
  milestonesTitle: {
    color: T.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  msRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
    gap: 10,
  },
  msIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msInfo: { flex: 1 },
  msDesc: {
    color: T.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  msProject: {
    color: T.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  msRight: { alignItems: 'flex-end' },
  msAmount: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  msStatus: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
});