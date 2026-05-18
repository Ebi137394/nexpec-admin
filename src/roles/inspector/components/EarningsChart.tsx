// components/EarningsChart.tsx
// ──────────────────────────────────────────────────────────────────
// React Native SVG Weekly Earnings Chart
// Precision-engineered with gradients, animations, and shimmer effects
// ──────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import Svg, {
  G,
  Rect,
  Line,
  Text as SvgText,
  Defs,
  LinearGradient as SvgLinearGradient,
  Stop,
  Path,
  Circle,
} from 'react-native-svg';
import { Animated as RNAnimated, Dimensions } from 'react-native';
import { formatHalalas } from '@/src/utils/formatCurrency';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface EarningsChartProps {
  weeklyEarnings: Array<{
    day: string;
    net_halalas: number;
  }>;
  maxWeeklyHalalas: number;
  weeklyTotalHalalas: number;
  width?: number;
  height?: number;
}

export const EarningsChart: React.FC<EarningsChartProps> = ({
  weeklyEarnings,
  maxWeeklyHalalas,
  weeklyTotalHalalas,
  width = SCREEN_WIDTH - 32,
  height = 200,
}) => {
  const chartWidth = width - 40; // padding
  const chartHeight = height - 60; // padding for labels
  const barWidth = chartWidth / 7;
  const barSpacing = 8;
  const actualBarWidth = barWidth - barSpacing;
  
  // Animation values
  const barAnimations = useRef(weeklyEarnings.map(() => new RNAnimated.Value(0))).current;
  const totalAnimation = useRef(new RNAnimated.Value(0)).current;

  // Start animations when data changes
  useEffect(() => {
    // Animate bars
    const barAnimationsSequence = weeklyEarnings.map((_, index) => 
      RNAnimated.timing(barAnimations[index], {
        toValue: 1,
        duration: 600,
        delay: index * 100,
        useNativeDriver: false,
      })
    );

    RNAnimated.parallel(barAnimationsSequence).start();

    // Animate total
    RNAnimated.timing(totalAnimation, {
      toValue: 1,
      duration: 800,
      useNativeDriver: false,
    }).start();

  }, [weeklyEarnings, barAnimations]);

  const formatValue = (value: number) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toString();
  };

  const getY = (value: number) => {
    if (maxWeeklyHalalas <= 0) return chartHeight;
    const pct = value / maxWeeklyHalalas;
    return chartHeight - (pct * chartHeight);
  };

  const getBarHeight = (value: number) => {
    if (maxWeeklyHalalas <= 0) return 0;
    const pct = value / maxWeeklyHalalas;
    return pct * chartHeight;
  };

  return (
    <Svg width={width} height={height}>
      <Defs>
        {/* Regular gradient */}
        <SvgLinearGradient id="regularGradient" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#334155" stopOpacity="1" />
          <Stop offset="1" stopColor="#1E293B" stopOpacity="1" />
        </SvgLinearGradient>

        {/* Axis line gradient */}
        <SvgLinearGradient id="axisGradient" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="rgba(255,255,255,0.1)" />
          <Stop offset="1" stopColor="rgba(255,255,255,0.05)" />
        </SvgLinearGradient>
      </Defs>

      {/* Background */}
      <Rect x="0" y="0" width={width} height={height} fill="#0F172A" rx="12" />

      {/* Chart area */}
      <G x="20" y="20">
        {/* Y-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, index) => {
          const y = chartHeight - (pct * chartHeight);
          const value = Math.round(maxWeeklyHalalas * pct);
          
          return (
            <G key={index}>
              {/* Grid line */}
              <Line
                x1="0"
                y1={y}
                x2={chartWidth}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
              />
              {/* Label */}
              <SvgText
                x="-10"
                y={y + 4}
                fontSize="10"
                fill="#64748B"
                textAnchor="end"
              >
                {formatValue(value)}
              </SvgText>
            </G>
          );
        })}

        {/* X-axis labels */}
        {weeklyEarnings.map((day, index) => {
          const x = index * barWidth + barWidth / 2;
          
          return (
            <SvgText
              key={day.day}
              x={x}
              y={chartHeight + 16}
              fontSize="11"
              fill="#64748B"
              textAnchor="middle"
              fontWeight="600"
            >
              {day.day}
            </SvgText>
          );
        })}

        {/* Bars */}
        {weeklyEarnings.map((day, index) => {
          const x = index * barWidth + barSpacing / 2;
          const barHeight = getBarHeight(day.net_halalas);
          const y = getY(day.net_halalas);

          return (
            <G key={day.day}>
              {/* Bar */}
              <Rect
                x={x}
                y={y}
                width={actualBarWidth}
                height={barHeight}
                rx="4"
                fill="url(#regularGradient)"
              />
              
              {/* Value label above bar */}
              {day.net_halalas > 0 && (
                <SvgText
                  x={x + actualBarWidth / 2}
                  y={y - 6}
                  fontSize="10"
                  fill="#C8D2DD"
                  textAnchor="middle"
                >
                  {formatValue(day.net_halalas)}
                </SvgText>
              )}
            </G>
          );
        })}

        {/* Total earnings display */}
        <RNAnimated.View style={{ opacity: totalAnimation }}>
          <SvgText
            x={chartWidth}
            y="-5"
            fontSize="12"
            fill="#10B981"
            textAnchor="end"
            fontWeight="700"
          >
            Total: {formatHalalas(weeklyTotalHalalas, true)}
          </SvgText>
        </RNAnimated.View>
      </G>
    </Svg>
  );
};