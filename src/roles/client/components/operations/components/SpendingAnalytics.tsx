// src/components/client/operations/components/SpendingAnalytics.tsx

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Path, Rect, Line, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useSpendingDashboard } from '@/src/hooks/useSpendingDashboard';

interface SpendingAnalyticsProps {
  projectId: string | null;
  organizationId: string | null;
  style?: any;
}

interface BurnRateData {
  date: string;
  amount: number;
  budget: number;
}

export function SpendingAnalytics({ projectId, organizationId, style }: SpendingAnalyticsProps) {
  const { burnRate, utilization, totalBudget, totalSpent, pendingPayments } = useSpendingDashboard(
    projectId,
    organizationId
  );

  const chartWidth = 300;
  const chartHeight = 160;
  const padding = 20;

  // Calculate chart dimensions
  const innerWidth = chartWidth - padding * 2;
  const innerHeight = chartHeight - padding * 2;

  // Process data for chart
  const processedData = processBurnRateData(burnRate, chartWidth, chartHeight, padding);

  const renderLineChart = () => {
    if (!processedData.points || processedData.points.length < 2) {
      return null;
    }

    const pathData = processedData.points
      .map((point, index) => {
        if (index === 0) {
          return `M ${point.x} ${point.y}`;
        }
        return `L ${point.x} ${point.y}`;
      })
      .join(' ');

    return (
      <>
        {/* Budget line */}
        <Line
          x1={padding}
          y1={padding}
          x2={chartWidth - padding}
          y2={padding}
          stroke="#E5E7EB"
          strokeWidth={1}
          strokeDasharray="4,4"
        />
        
        {/* Budget label */}
        <Text style={styles.chartLabel} x={chartWidth - padding - 60} y={padding - 5}>
          Budget
        </Text>

        {/* Burn rate line */}
        <Path
          d={pathData}
          fill="none"
          stroke="#007AFF"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Gradient fill under the line */}
        <Path
          d={`${pathData} L ${chartWidth - padding} ${chartHeight - padding} L ${padding} ${chartHeight - padding} Z`}
          fill="url(#gradient)"
          opacity={0.3}
        />

        {/* Data points */}
        {processedData.points.map((point, index) => (
          <Circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={3}
            fill="#007AFF"
          />
        ))}
      </>
    );
  };

  const renderBudgetBreakdown = () => {
    const spentPercent = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
    const pendingPercent = totalBudget > 0 ? (pendingPayments / totalBudget) * 100 : 0;
    const remainingPercent = Math.max(0, 100 - spentPercent - pendingPercent);

    return (
      <View style={styles.breakdownContainer}>
        <View style={styles.breakdownRow}>
          <View style={[styles.breakdownBar, styles.spentBar]}>
            <Text style={styles.breakdownLabel}>Spent</Text>
            <Text style={styles.breakdownValue}>${totalSpent.toLocaleString()}</Text>
          </View>
          <Text style={styles.breakdownPercent}>{spentPercent.toFixed(0)}%</Text>
        </View>
        
        <View style={styles.breakdownRow}>
          <View style={[styles.breakdownBar, styles.pendingBar]}>
            <Text style={styles.breakdownLabel}>Pending</Text>
            <Text style={styles.breakdownValue}>${pendingPayments.toLocaleString()}</Text>
          </View>
          <Text style={styles.breakdownPercent}>{pendingPercent.toFixed(0)}%</Text>
        </View>
        
        <View style={styles.breakdownRow}>
          <View style={[styles.breakdownBar, styles.remainingBar]}>
            <Text style={styles.breakdownLabel}>Remaining</Text>
            <Text style={styles.breakdownValue}>
              ${(totalBudget - totalSpent - pendingPayments).toLocaleString()}
            </Text>
          </View>
          <Text style={styles.breakdownPercent}>{remainingPercent.toFixed(0)}%</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.title}>Spending Analytics</Text>
      
      {/* Chart */}
      <View style={styles.chartContainer}>
        <Svg width={chartWidth} height={chartHeight}>
          {/* Gradient definition */}
          <Defs>
            <LinearGradient id="gradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#007AFF" stopOpacity="0.5" />
              <Stop offset="100%" stopColor="#007AFF" stopOpacity="0.0" />
            </LinearGradient>
          </Defs>
          
          {/* Axes */}
          <Line
            x1={padding}
            y1={padding}
            x2={padding}
            y2={chartHeight - padding}
            stroke="#E5E7EB"
            strokeWidth={1}
          />
          <Line
            x1={padding}
            y1={chartHeight - padding}
            x2={chartWidth - padding}
            y2={chartHeight - padding}
            stroke="#E5E7EB"
            strokeWidth={1}
          />

          {renderLineChart()}
        </Svg>
      </View>

      {/* Summary */}
      <View style={styles.summaryContainer}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Budget</Text>
          <Text style={styles.summaryValue}>${totalBudget.toLocaleString()}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Utilization</Text>
          <Text style={[styles.summaryValue, utilization > 80 ? styles.warningText : styles.successText]}>
            {utilization}%
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Pending Payments</Text>
          <Text style={styles.summaryValue}>${pendingPayments.toLocaleString()}</Text>
        </View>
      </View>

      {/* Budget Breakdown */}
      {renderBudgetBreakdown()}

      {/* Actions */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionText}>View Details</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionText}>Export Report</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// Helper function to process burn rate data for chart rendering
function processBurnRateData(
  burnRate: BurnRateData[],
  width: number,
  height: number,
  padding: number
) {
  if (!burnRate || burnRate.length === 0) {
    return { points: [] };
  }

  const innerWidth = width - padding * 2;
  const innerHeight = height - padding * 2;

  // Find min and max values
  const maxAmount = Math.max(...burnRate.map(d => d.amount), ...burnRate.map(d => d.budget));
  const minAmount = 0;

  // Calculate points
  const points = burnRate.map((data, index) => {
    const x = padding + (index / (burnRate.length - 1)) * innerWidth;
    const y = padding + innerHeight - (data.amount / maxAmount) * innerHeight;
    
    return { x, y, data };
  });

  return { points };
}


const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    margin: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 16,
  },
  chartContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  chartLabel: {
    fontSize: 10,
    color: '#666',
  },
  summaryContainer: {
    backgroundColor: '#f8f9fa',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  successText: {
    color: '#22C55E',
  },
  warningText: {
    color: '#FF3B30',
  },
  breakdownContainer: {
    marginBottom: 16,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  breakdownBar: {
    flex: 1,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
    marginRight: 8,
  },
  spentBar: {
    backgroundColor: '#E3F2FD',
  },
  pendingBar: {
    backgroundColor: '#FFF3E0',
  },
  remainingBar: {
    backgroundColor: '#E8F5E9',
  },
  breakdownLabel: {
    fontSize: 10,
    color: '#666',
    textTransform: 'uppercase',
  },
  breakdownValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  breakdownPercent: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333',
    minWidth: 30,
    textAlign: 'right',
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  actionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});