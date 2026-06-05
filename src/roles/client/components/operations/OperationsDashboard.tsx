// src/components/client/operations/OperationsDashboard.tsx

import React, { useEffect, useRef, useCallback, memo, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Animated,
  Easing,
  StyleSheet,
  Dimensions,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { useCriticalAlerts } from '@/src/hooks/useCriticalAlerts';
import { useOperationsData } from './hooks/useOperationsData';
import { SegmentedTabBar } from './components/SegmentedTabBar';

// ─── Enable LayoutAnimation on Android ──────────────────────────────
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ═══════════════════════════════════════════════════════════════════════
// ░░░  DESIGN TOKENS  ░░░
// ═══════════════════════════════════════════════════════════════════════
const TOKENS = {
  bg: '#020617',
  cardBg: 'rgba(255,255,255,0.05)',
  border: 'rgba(255,255,255,0.1)',
  borderFocus: 'rgba(255,255,255,0.2)',
  textPrimary: '#F8FAFC',
  textSecondary: 'rgba(248,250,252,0.6)',
  textTertiary: 'rgba(248,250,252,0.35)',
  primary: '#3B82F6',
  primaryGlow: 'rgba(59,130,246,0.3)',
  primaryFaint: 'rgba(59,130,246,0.1)',
  success: '#10B981',
  successGlow: 'rgba(16,185,129,0.3)',
  successFaint: 'rgba(16,185,129,0.08)',
  warning: '#F59E0B',
  warningGlow: 'rgba(245,158,11,0.3)',
  warningFaint: 'rgba(245,158,11,0.08)',
  critical: '#EF4444',
  criticalGlow: 'rgba(239,68,68,0.4)',
  criticalFaint: 'rgba(239,68,68,0.12)',
  criticalDeep: 'rgba(239,68,68,0.08)',
} as const;

// ═══════════════════════════════════════════════════════════════════════
// ░░░  TYPE DEFINITIONS  ░░░
// ═══════════════════════════════════════════════════════════════════════
type StageStatus = 'completed' | 'active' | 'pending';
type RiskLevel = 'low' | 'moderate' | 'high' | 'critical' | 'none';
type InspectorStatus = 'on-site' | 'in-transit' | 'idle' | 'offline';

interface PipelineStage {
  id: string;
  label: string;
  status: StageStatus;
  timestamp?: string;
}

interface Inspector {
  id: string;
  name: string;
  role: string;
  zone: string;
  status: InspectorStatus;
  signalStrength: number; // 0-100
  lastPing: string;
  avatar: string; // initials
}

interface HeatmapCell {
  row: number;
  col: number;
  zone: string;
  risk: RiskLevel;
  defectCount: number;
  label: string;
}

interface CriticalAlert {
  id: string;
  message: string;
  zone: string;
  severity: 'critical' | 'warning';
  timestamp: string;
}

interface OperationalMetric {
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down' | 'neutral';
  color: string;
}

// ═══════════════════════════════════════════════════════════════════════
// ░░░  DASHBOARD DATA — TO BE IMPLEMENTED  ░░░
// ═══════════════════════════════════════════════════════════════════════
// TODO: Replace with your new dashboard data structure
// Current data has been removed to make way for new implementation

// Example data structure for new implementation:
const PIPELINE_STAGES: PipelineStage[] = [];
const INSPECTORS: Inspector[] = [];
const HEATMAP_DATA: HeatmapCell[] = [];
const OPERATIONAL_METRICS: OperationalMetric[] = [];

// ═══════════════════════════════════════════════════════════════════════
// ░░░  UTILITY HOOKS  ░░░
// ═══════════════════════════════════════════════════════════════════════
const useLoopingAnimation = (
  duration: number,
  easing: (value: number) => number = Easing.inOut(Easing.ease),
  outputRange: [number, number] = [0, 1],
): Animated.AnimatedInterpolation<number> => {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: duration / 2,
          easing,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: duration / 2,
          easing,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, duration, easing]);

  return anim.interpolate({
    inputRange: [0, 1],
    outputRange,
  });
};

const useFadeIn = (delay: number = 0, duration: number = 600): Animated.Value => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [opacity, delay, duration]);

  return opacity;
};

const useSlideIn = (
  delay: number = 0,
  from: number = 30,
  duration: number = 600,
): { opacity: Animated.Value; translateY: Animated.AnimatedInterpolation<number> } => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, delay, duration]);

  return {
    opacity: progress,
    translateY: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [from, 0],
    }),
  };
};

// ═══════════════════════════════════════════════════════════════════════
// ░░░  SECTION HEADER COMPONENT  ░░░
// ═══════════════════════════════════════════════════════════════════════
const SectionHeader: React.FC<{ title: string; subtitle?: string; delay?: number }> = memo(
  ({ title, subtitle, delay = 0 }) => {
    const { opacity, translateY } = useSlideIn(delay, 20, 500);

    return (
      <Animated.View style={[styles.sectionHeader, { opacity, transform: [{ translateY }] }]}>
        <View style={styles.sectionHeaderAccent} />
        <View>
          <Text style={styles.sectionTitle}>{title}</Text>
          {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
        </View>
      </Animated.View>
    );
  },
);

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 1: OPERATIONAL METRICS BAR  ░░░
// ═══════════════════════════════════════════════════════════════════════
const MetricCard: React.FC<{ metric: OperationalMetric; index: number }> = memo(
  ({ metric, index }) => {
    const { opacity, translateY } = useSlideIn(index * 100 + 200, 25);

    return (
      <Animated.View
        style={[
          styles.metricCard,
          { opacity, transform: [{ translateY }] },
        ]}
      >
        <Text style={[styles.metricValue, { color: metric.color }]}>{metric.value}</Text>
        <Text style={styles.metricLabel}>{metric.label}</Text>
        {metric.delta !== '' && (
          <View style={styles.metricDeltaRow}>
            <Text style={styles.metricDeltaArrow}>
              {metric.trend === 'up' ? '▲' : metric.trend === 'down' ? '▼' : '●'}
            </Text>
            <Text
              style={[
                styles.metricDelta,
                {
                  color:
                    metric.trend === 'up' && metric.color === TOKENS.critical
                      ? TOKENS.critical
                      : metric.trend === 'up'
                        ? TOKENS.success
                        : TOKENS.textSecondary,
                },
              ]}
            >
              {metric.delta}
            </Text>
          </View>
        )}
      </Animated.View>
    );
  },
);

const MetricsBar: React.FC = memo(() => (
  <View>
    <SectionHeader title="OPERATIONAL OVERVIEW" subtitle="Live telemetry feed" delay={100} />
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.metricsRow}
    >
      {OPERATIONAL_METRICS.map((metric, i) => (
        <MetricCard key={metric.label} metric={metric} index={i} />
      ))}
    </ScrollView>
  </View>
));

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 2: STATUS PIPELINE (Animated Timeline)  ░░░
// ═══════════════════════════════════════════════════════════════════════
const PipelineNode: React.FC<{ stage: PipelineStage; index: number; total: number }> = memo(
  ({ stage, index, total }) => {
    const isActive = stage.status === 'active';
    const isCompleted = stage.status === 'completed';

    // Glow Pulse for Active stage
    const pulseAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(isCompleted ? 1 : 0)).current;

    useEffect(() => {
      // Entry animation
      Animated.spring(scaleAnim, {
        toValue: 1,
        delay: index * 120 + 300,
        friction: 6,
        tension: 60,
        useNativeDriver: true,
      }).start();

      if (isActive) {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 1200,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 0,
              duration: 1200,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ).start();
      }
    }, [isActive, index, pulseAnim, scaleAnim]);

    const glowOpacity = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    });

    const glowScale = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.6],
    });

    const nodeColor = isCompleted
      ? TOKENS.success
      : isActive
        ? TOKENS.primary
        : TOKENS.textTertiary;

    const lineColor = isCompleted ? TOKENS.success : TOKENS.border;

    return (
      <Animated.View
        style={[
          styles.pipelineNodeContainer,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        {/* Connector line BEFORE this node */}
        {index > 0 && (
          <View
            style={[
              styles.pipelineConnector,
              { backgroundColor: lineColor },
            ]}
          />
        )}

        {/* Node */}
        <View style={styles.pipelineNodeWrapper}>
          {/* Glow ring for active */}
          {isActive && (
            <Animated.View
              style={[
                styles.pipelineGlowRing,
                {
                  opacity: glowOpacity,
                  transform: [{ scale: glowScale }],
                  borderColor: TOKENS.primary,
                  backgroundColor: TOKENS.primaryFaint,
                },
              ]}
            />
          )}

          <View
            style={[
              styles.pipelineNode,
              {
                backgroundColor: isActive ? TOKENS.primary : isCompleted ? TOKENS.success : 'transparent',
                borderColor: nodeColor,
              },
            ]}
          >
            {isCompleted && <Text style={styles.pipelineCheckmark}>✓</Text>}
            {isActive && <View style={styles.pipelineActiveCore} />}
            {stage.status === 'pending' && (
              <View style={[styles.pipelinePendingDot, { backgroundColor: TOKENS.textTertiary }]} />
            )}
          </View>

          <Text
            style={[
              styles.pipelineLabel,
              { color: isActive ? TOKENS.textPrimary : isCompleted ? TOKENS.success : TOKENS.textTertiary },
            ]}
            numberOfLines={1}
          >
            {stage.label}
          </Text>

          {stage.timestamp && (
            <Text style={styles.pipelineTimestamp}>{stage.timestamp}</Text>
          )}
        </View>
      </Animated.View>
    );
  },
);

const StatusPipeline: React.FC = memo(() => (
  <View>
    <SectionHeader
      title="STATUS PIPELINE"
      subtitle="Operation lifecycle tracker"
      delay={400}
    />
    <View style={styles.glassCard}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pipelineScrollContent}
      >
        {PIPELINE_STAGES.map((stage, i) => (
          <PipelineNode key={stage.id} stage={stage} index={i} total={PIPELINE_STAGES.length} />
        ))}
      </ScrollView>
    </View>
  </View>
));

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 3: LIVE RADAR (Sonar) + INSPECTOR LIST  ░░░
// ═══════════════════════════════════════════════════════════════════════
const SonarRing: React.FC<{ delay: number; size: number }> = memo(({ delay, size }) => {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 2400,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1],
  });

  const opacity = anim.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.8, 0.5, 0],
  });

  return (
    <Animated.View
      style={[
        styles.sonarRing,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
});

const SonarIndicator: React.FC<{ size?: number }> = memo(({ size = 36 }) => (
  <View style={[styles.sonarContainer, { width: size, height: size }]}>
    <SonarRing delay={0} size={size} />
    <SonarRing delay={800} size={size} />
    <SonarRing delay={1600} size={size} />
    {/* Center dot */}
    <View
      style={[
        styles.sonarCenter,
        {
          width: size * 0.22,
          height: size * 0.22,
          borderRadius: size * 0.11,
        },
      ]}
    />
  </View>
));

const InspectorCard: React.FC<{ inspector: Inspector; index: number }> = memo(
  ({ inspector, index }) => {
    const { opacity, translateY } = useSlideIn(index * 100 + 500, 20);

    const statusColor =
      inspector.status === 'on-site'
        ? TOKENS.success
        : inspector.status === 'in-transit'
          ? TOKENS.warning
          : inspector.status === 'idle'
            ? TOKENS.primary
            : TOKENS.textTertiary;

    const statusLabel =
      inspector.status === 'on-site'
        ? 'ON-SITE'
        : inspector.status === 'in-transit'
          ? 'IN-TRANSIT'
          : inspector.status === 'idle'
            ? 'IDLE'
            : 'OFFLINE';

    return (
      <Animated.View
        style={[
          styles.inspectorCard,
          { opacity, transform: [{ translateY }] },
        ]}
      >
        {/* Avatar */}
        <View style={[styles.inspectorAvatar, { borderColor: statusColor }]}>
          <Text style={[styles.inspectorAvatarText, { color: statusColor }]}>
            {inspector.avatar}
          </Text>
        </View>

        {/* Info */}
        <View style={styles.inspectorInfo}>
          <Text style={styles.inspectorName}>{inspector.name}</Text>
          <Text style={styles.inspectorRole}>{inspector.role}</Text>
          <View style={styles.inspectorMeta}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.inspectorStatusText, { color: statusColor }]}>
              {statusLabel}
            </Text>
            <Text style={styles.inspectorSeparator}>│</Text>
            <Text style={styles.inspectorZone}>{inspector.zone}</Text>
          </View>
        </View>

        {/* Signal + Sonar */}
        <View style={styles.inspectorRight}>
          {inspector.status === 'on-site' && <SonarIndicator size={38} />}
          <View style={styles.signalContainer}>
            <Text style={styles.signalValue}>{inspector.signalStrength}%</Text>
            <Text style={styles.signalLabel}>{inspector.lastPing}</Text>
          </View>
        </View>
      </Animated.View>
    );
  },
);

const LiveRadar: React.FC = memo(() => (
  <View>
    <SectionHeader
      title="FIELD OPERATIVES"
      subtitle="Live personnel tracking"
      delay={600}
    />
    {INSPECTORS.map((inspector, i) => (
      <InspectorCard key={inspector.id} inspector={inspector} index={i} />
    ))}
  </View>
));

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 4: RISK HEATMAP (4×4 Grid)  ░░░
// ═══════════════════════════════════════════════════════════════════════
const getRiskColor = (risk: RiskLevel): string => {
  switch (risk) {
    case 'critical': return TOKENS.critical;
    case 'high': return TOKENS.warning;
    case 'moderate': return TOKENS.primary;
    case 'low': return TOKENS.success;
    case 'none': return TOKENS.textTertiary;
    default: return TOKENS.textTertiary;
  }
};

const getRiskBg = (risk: RiskLevel): string => {
  switch (risk) {
    case 'critical': return TOKENS.criticalFaint;
    case 'high': return TOKENS.warningFaint;
    case 'moderate': return TOKENS.primaryFaint;
    case 'low': return TOKENS.successFaint;
    case 'none': return 'rgba(255,255,255,0.02)';
    default: return 'rgba(255,255,255,0.02)';
  }
};

const HeatmapCellView: React.FC<{ cell: HeatmapCell; cellSize: number }> = memo(
  ({ cell, cellSize }) => {
    const isCritical = cell.risk === 'critical';
    const staggerDelay = (cell.row * 4 + cell.col) * 80 + 800;

    // Staggered entrance
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(0.7)).current;

    // Critical pulse
    const pulseAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 500,
          delay: staggerDelay,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          delay: staggerDelay,
          friction: 5,
          tension: 80,
          useNativeDriver: true,
        }),
      ]).start();

      if (isCritical) {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 1500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 0,
              duration: 1500,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ).start();
      }
    }, [fadeAnim, scaleAnim, pulseAnim, staggerDelay, isCritical]);

    const bgOpacity = isCritical
      ? pulseAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [0.6, 1],
        })
      : fadeAnim;

    const riskColor = getRiskColor(cell.risk);
    const riskBg = getRiskBg(cell.risk);

    return (
      <Animated.View
        style={[
          styles.heatmapCell,
          {
            width: cellSize,
            height: cellSize,
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          },
        ]}
      >
        <Animated.View
          style={[
            styles.heatmapCellInner,
            {
              backgroundColor: riskBg,
              borderColor: riskColor,
              opacity: bgOpacity,
            },
          ]}
        >
          <Text style={[styles.heatmapZoneLabel, { color: riskColor }]}>{cell.label}</Text>
          <Text style={[styles.heatmapDefectCount, { color: riskColor }]}>
            {cell.defectCount > 0 ? cell.defectCount : '—'}
          </Text>
          <Text style={[styles.heatmapRiskLabel, { color: riskColor }]}>
            {cell.risk.toUpperCase()}
          </Text>

          {/* Critical pulse overlay */}
          {isCritical && (
            <Animated.View
              style={[
                styles.heatmapCriticalOverlay,
                {
                  opacity: pulseAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 0.15],
                  }),
                  backgroundColor: TOKENS.critical,
                },
              ]}
            />
          )}
        </Animated.View>
      </Animated.View>
    );
  },
);

const RiskHeatmap: React.FC = memo(() => {
  const gridPadding = 32;
  const gap = 6;
  const cellSize = (SCREEN_WIDTH - gridPadding * 2 - gap * 3) / 4;

  const rows = [0, 1, 2, 3];

  return (
    <View>
      <SectionHeader
        title="RISK HEATMAP"
        subtitle="Defect density by zone"
        delay={800}
      />
      <View style={styles.glassCard}>
        {/* Legend */}
        <View style={styles.heatmapLegend}>
          {(['none', 'low', 'moderate', 'high', 'critical'] as RiskLevel[]).map((risk) => (
            <View key={risk} style={styles.heatmapLegendItem}>
              <View
                style={[styles.heatmapLegendDot, { backgroundColor: getRiskColor(risk) }]}
              />
              <Text style={styles.heatmapLegendText}>{risk.toUpperCase()}</Text>
            </View>
          ))}
        </View>

        {/* Grid */}
        <View style={styles.heatmapGrid}>
          {rows.map((row) => (
            <View key={`row-${row}`} style={styles.heatmapRow}>
              {HEATMAP_DATA.filter((c) => c.row === row).map((cell) => (
                <HeatmapCellView key={cell.zone} cell={cell} cellSize={cellSize} />
              ))}
            </View>
          ))}
        </View>
      </View>
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 5: CRITICAL TICKER (Scrolling Marquee)  ░░░
// ═══════════════════════════════════════════════════════════════════════
const CriticalTicker: React.FC<{ tickerMessage: string }> = memo(({ tickerMessage }) => {
  const scrollX = useRef(new Animated.Value(0)).current;
  const bannerPulse = useRef(new Animated.Value(0)).current;

  // Approximate text width (each char ~7px at fontSize 12)
  const textWidth = tickerMessage.length * 7;

  useEffect(() => {
    // Marquee scroll
    Animated.loop(
      Animated.timing(scrollX, {
        toValue: -textWidth,
        duration: textWidth * 35, // Speed: ~35ms per pixel
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();

    // Banner glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(bannerPulse, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(bannerPulse, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, [scrollX, bannerPulse, textWidth]);

  const bannerOpacity = bannerPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1],
  });

  const borderOpacity = bannerPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.8],
  });

  const fadeIn = useFadeIn(1200, 800);

  return (
    <Animated.View style={[styles.tickerOuterContainer, { opacity: fadeIn }]}>
      {/* Glowing left accent */}
      <Animated.View
        style={[
          styles.tickerGlowAccent,
          { opacity: borderOpacity },
        ]}
      />

      <Animated.View
        style={[
          styles.tickerContainer,
          { borderColor: TOKENS.critical, opacity: bannerOpacity },
        ]}
      >
        {/* Alert badge */}
        <View style={styles.tickerBadge}>
          <Text style={styles.tickerBadgeText}>ALERT</Text>
        </View>

        {/* Scrolling text */}
        <View style={styles.tickerTextMask}>
          <Animated.Text
            style={[
              styles.tickerText,
              { transform: [{ translateX: scrollX }] },
            ]}
            numberOfLines={1}
          >
            {tickerMessage}{'   ◆   '}{tickerMessage}
          </Animated.Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
});

// ═══════════════════════════════════════════════════════════════════════
// ░░░  COMPONENT 6: ALERT FEED (Detailed Critical Log)  ░░░
// ═══════════════════════════════════════════════════════════════════════
const AlertItem: React.FC<{ alert: CriticalAlert; index: number }> = memo(
  ({ alert, index }) => {
    const { opacity, translateY } = useSlideIn(index * 120 + 1400, 15);
    const isCrit = alert.severity === 'critical';

    const pulseAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
      if (isCrit) {
        Animated.loop(
          Animated.sequence([
            Animated.timing(pulseAnim, {
              toValue: 1,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(pulseAnim, {
              toValue: 0,
              duration: 2000,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ).start();
      }
    }, [isCrit, pulseAnim]);

    const leftBarOpacity = isCrit
      ? pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] })
      : new Animated.Value(1);

    return (
      <Animated.View
        style={[
          styles.alertCard,
          { opacity, transform: [{ translateY }] },
        ]}
      >
        <Animated.View
          style={[
            styles.alertLeftBar,
            {
              backgroundColor: isCrit ? TOKENS.critical : TOKENS.warning,
              opacity: leftBarOpacity,
            },
          ]}
        />
        <View style={styles.alertContent}>
          <View style={styles.alertHeader}>
            <View
              style={[
                styles.alertSeverityBadge,
                {
                  backgroundColor: isCrit ? TOKENS.criticalDeep : TOKENS.warningFaint,
                  borderColor: isCrit ? TOKENS.critical : TOKENS.warning,
                },
              ]}
            >
              <Text
                style={[
                  styles.alertSeverityText,
                  { color: isCrit ? TOKENS.critical : TOKENS.warning },
                ]}
              >
                {alert.severity.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.alertZone}>Zone {alert.zone}</Text>
            <Text style={styles.alertTimestamp}>{alert.timestamp}</Text>
          </View>
          <Text style={styles.alertMessage}>{alert.message}</Text>
        </View>
      </Animated.View>
    );
  },
);

const AlertFeed: React.FC<{ alerts: CriticalAlert[] }> = memo(({ alerts }) => (
  <View>
    <SectionHeader
      title="ALERT FEED"
      subtitle="Critical & warning notifications"
      delay={1300}
    />
    {alerts.map((alert, i) => (
      <AlertItem key={alert.id} alert={alert} index={i} />
    ))}
  </View>
));

// ═══════════════════════════════════════════════════════════════════════
// ░░░  MAIN DASHBOARD COMPONENT  ░░░
// ═══════════════════════════════════════════════════════════════════════
const OperationsDashboard: React.FC = () => {
  const headerFade = useFadeIn(0, 400);
  const { alerts, loading } = useCriticalAlerts();
  const { data, isLoading } = useOperationsData();

  // Update ticker message logic to handle empty alerts
  const tickerMessage = alerts.length > 0 
    ? alerts.map(a => `⚠ ${a.severity.toUpperCase()}: ${a.message}`).join('   ◆   ')
    : "✅ ALL SYSTEMS OPERATIONAL, NO CRITICAL DEFECTS DETECTED";

  // Create operational metrics from the live data
  const operationalMetrics = [
    {
      label: 'Active Projects',
      value: data.summary?.totalInspections?.toString() || '0',
      delta: '',
      trend: 'neutral' as const,
      color: TOKENS.primary,
    },
    {
      label: 'Avg Risk Score',
      value: `${data.summary?.complianceRate || 0}%`,
      delta: '',
      trend: 'neutral' as const,
      color: TOKENS.warning,
    },
    {
      label: 'Budget Utilization',
      value: '45%', // This would come from a get_utilization RPC call
      delta: '+2.1%',
      trend: 'up' as const,
      color: TOKENS.critical,
    },
    {
      label: 'Time Elapsed',
      value: data.summary?.timeElapsed || '0h 0m',
      delta: '',
      trend: 'neutral' as const,
      color: TOKENS.textSecondary,
    },
  ];

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Dashboard Header ── */}
        <Animated.View style={[styles.dashboardHeader, { opacity: headerFade }]}>
          <View>
            <Text style={styles.dashboardTitle}>OPERATIONS</Text>
            <Text style={styles.dashboardSubtitle}>COMMAND CENTER</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.liveIndicator}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
            <Text style={styles.headerTimestamp}>
              {new Date().toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </Text>
          </View>
        </Animated.View>

        {/* ── Critical Ticker ── */}
        <CriticalTicker tickerMessage={tickerMessage} />

        {/* ── Metrics Bar ── */}
        <View>
          <SectionHeader title="OPERATIONAL OVERVIEW" subtitle="Live telemetry feed" delay={100} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.metricsRow}
          >
            {operationalMetrics.map((metric, i) => (
              <Animated.View
                key={metric.label}
                style={[
                  styles.metricCard,
                  { opacity: useSlideIn(i * 100 + 200, 25).opacity, transform: [{ translateY: useSlideIn(i * 100 + 200, 25).translateY }] },
                ]}
              >
                <Text style={[styles.metricValue, { color: metric.color }]}>{metric.value}</Text>
                <Text style={styles.metricLabel}>{metric.label}</Text>
                {metric.delta !== '' && (
                  <View style={styles.metricDeltaRow}>
                    <Text style={styles.metricDeltaArrow}>
                      {metric.trend === 'up' ? '▲' : metric.trend === 'down' ? '▼' : '●'}
                    </Text>
                    <Text
                      style={[
                        styles.metricDelta,
                        {
                          color:
                            metric.trend === 'up' && metric.color === TOKENS.critical
                              ? TOKENS.critical
                              : metric.trend === 'up'
                                ? TOKENS.success
                                : TOKENS.textSecondary,
                        },
                      ]}
                    >
                      {metric.delta}
                    </Text>
                  </View>
                )}
              </Animated.View>
            ))}
          </ScrollView>
        </View>

        {/* ── Status Pipeline ── */}
        <View>
          <SectionHeader
            title="STATUS PIPELINE"
            subtitle="Operation lifecycle tracker"
            delay={400}
          />
          <View style={styles.glassCard}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pipelineScrollContent}
            >
              {data.pipelineStages?.map((stage, i) => {
                const isActive = stage.status === 'active';
                const isCompleted = stage.status === 'completed';
                const pulseAnim = useRef(new Animated.Value(0)).current;
                const scaleAnim = useRef(new Animated.Value(isCompleted ? 1 : 0)).current;

                useEffect(() => {
                  Animated.spring(scaleAnim, {
                    toValue: 1,
                    delay: i * 120 + 300,
                    friction: 6,
                    tension: 60,
                    useNativeDriver: true,
                  }).start();

                  if (isActive) {
                    Animated.loop(
                      Animated.sequence([
                        Animated.timing(pulseAnim, {
                          toValue: 1,
                          duration: 1200,
                          easing: Easing.inOut(Easing.ease),
                          useNativeDriver: true,
                        }),
                        Animated.timing(pulseAnim, {
                          toValue: 0,
                          duration: 1200,
                          easing: Easing.inOut(Easing.ease),
                          useNativeDriver: true,
                        }),
                      ]),
                    ).start();
                  }
                }, [isActive, i, pulseAnim, scaleAnim]);

                const glowOpacity = pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.3, 1],
                });

                const glowScale = pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1.6],
                });

                const nodeColor = isCompleted
                  ? TOKENS.success
                  : isActive
                    ? TOKENS.primary
                    : TOKENS.textTertiary;

                const lineColor = isCompleted ? TOKENS.success : TOKENS.border;

                return (
                  <Animated.View
                    key={stage.id}
                    style={[
                      styles.pipelineNodeContainer,
                      { transform: [{ scale: scaleAnim }] },
                    ]}
                  >
                    {/* Connector line BEFORE this node */}
                    {i > 0 && (
                      <View
                        style={[
                          styles.pipelineConnector,
                          { backgroundColor: lineColor },
                        ]}
                      />
                    )}

                    {/* Node */}
                    <View style={styles.pipelineNodeWrapper}>
                      {/* Glow ring for active */}
                      {isActive && (
                        <Animated.View
                          style={[
                            styles.pipelineGlowRing,
                            {
                              opacity: glowOpacity,
                              transform: [{ scale: glowScale }],
                              borderColor: TOKENS.primary,
                              backgroundColor: TOKENS.primaryFaint,
                            },
                          ]}
                        />
                      )}

                      <View
                        style={[
                          styles.pipelineNode,
                          {
                            backgroundColor: isActive ? TOKENS.primary : isCompleted ? TOKENS.success : 'transparent',
                            borderColor: nodeColor,
                          },
                        ]}
                      >
                        {isCompleted && <Text style={styles.pipelineCheckmark}>✓</Text>}
                        {isActive && <View style={styles.pipelineActiveCore} />}
                        {stage.status === 'pending' && (
                          <View style={[styles.pipelinePendingDot, { backgroundColor: TOKENS.textTertiary }]} />
                        )}
                      </View>

                      <Text
                        style={[
                          styles.pipelineLabel,
                          { color: isActive ? TOKENS.textPrimary : isCompleted ? TOKENS.success : TOKENS.textTertiary },
                        ]}
                        numberOfLines={1}
                      >
                        {stage.label}
                      </Text>

                      {stage.timestamp && (
                        <Text style={styles.pipelineTimestamp}>{stage.timestamp}</Text>
                      )}
                    </View>
                  </Animated.View>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {/* ── Risk Heatmap ── */}
        <View>
          <SectionHeader
            title="RISK HEATMAP"
            subtitle="Defect density by zone"
            delay={800}
          />
          <View style={styles.glassCard}>
            {/* Legend */}
            <View style={styles.heatmapLegend}>
              {(['none', 'low', 'moderate', 'high', 'critical'] as any).map((risk) => (
                <View key={risk} style={styles.heatmapLegendItem}>
                  <View
                    style={[styles.heatmapLegendDot, { backgroundColor: getRiskColor(risk) }]}
                  />
                  <Text style={styles.heatmapLegendText}>{risk.toUpperCase()}</Text>
                </View>
              ))}
            </View>

            {/* Grid */}
            <View style={styles.heatmapGrid}>
              {data.heatmapData?.map((cell) => {
                const isCritical = cell.risk === 'critical';
                const staggerDelay = (cell.row * 4 + cell.col) * 80 + 800;
                const fadeAnim = useRef(new Animated.Value(0)).current;
                const scaleAnim = useRef(new Animated.Value(0.7)).current;
                const pulseAnim = useRef(new Animated.Value(0)).current;

                useEffect(() => {
                  Animated.parallel([
                    Animated.timing(fadeAnim, {
                      toValue: 1,
                      duration: 500,
                      delay: staggerDelay,
                      easing: Easing.out(Easing.cubic),
                      useNativeDriver: true,
                    }),
                    Animated.spring(scaleAnim, {
                      toValue: 1,
                      delay: staggerDelay,
                      friction: 5,
                      tension: 80,
                      useNativeDriver: true,
                    }),
                  ]).start();

                  if (isCritical) {
                    Animated.loop(
                      Animated.sequence([
                        Animated.timing(pulseAnim, {
                          toValue: 1,
                          duration: 1500,
                          easing: Easing.inOut(Easing.ease),
                          useNativeDriver: true,
                        }),
                        Animated.timing(pulseAnim, {
                          toValue: 0,
                          duration: 1500,
                          easing: Easing.inOut(Easing.ease),
                          useNativeDriver: true,
                        }),
                      ]),
                    ).start();
                  }
                }, [fadeAnim, scaleAnim, pulseAnim, staggerDelay, isCritical]);

                const bgOpacity = isCritical
                  ? pulseAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.6, 1],
                    })
                  : fadeAnim;

                const riskColor = getRiskColor(cell.risk);
                const riskBg = getRiskBg(cell.risk);

                return (
                  <Animated.View
                    key={cell.zone}
                    style={[
                      styles.heatmapCell,
                      {
                        width: (SCREEN_WIDTH - 32 * 2 - 6 * 3) / 4,
                        height: (SCREEN_WIDTH - 32 * 2 - 6 * 3) / 4,
                        opacity: fadeAnim,
                        transform: [{ scale: scaleAnim }],
                      },
                    ]}
                  >
                    <Animated.View
                      style={[
                        styles.heatmapCellInner,
                        {
                          backgroundColor: riskBg,
                          borderColor: riskColor,
                          opacity: bgOpacity,
                        },
                      ]}
                    >
                      <Text style={[styles.heatmapZoneLabel, { color: riskColor }]}>{cell.label}</Text>
                      <Text style={[styles.heatmapDefectCount, { color: riskColor }]}>
                        {cell.defectCount > 0 ? cell.defectCount : '—'}
                      </Text>
                      <Text style={[styles.heatmapRiskLabel, { color: riskColor }]}>
                        {cell.risk.toUpperCase()}
                      </Text>

                      {/* Critical pulse overlay */}
                      {isCritical && (
                        <Animated.View
                          style={[
                            styles.heatmapCriticalOverlay,
                            {
                              opacity: pulseAnim.interpolate({
                                inputRange: [0, 1],
                                outputRange: [0, 0.15],
                              }),
                              backgroundColor: TOKENS.critical,
                            },
                          ]}
                        />
                      )}
                    </Animated.View>
                  </Animated.View>
                );
              })}
            </View>
          </View>
        </View>

        {/* ── Live Radar + Inspectors ── */}
        <View>
          <SectionHeader
            title="FIELD OPERATIVES"
            subtitle="Live personnel tracking"
            delay={600}
          />
          {data.inspectors?.map((inspector, i) => {
            const { opacity, translateY } = useSlideIn(i * 100 + 500, 20);

            const statusColor =
              inspector.status === 'on-site'
                ? TOKENS.success
                : inspector.status === 'in-transit'
                  ? TOKENS.warning
                  : inspector.status === 'idle'
                    ? TOKENS.primary
                    : TOKENS.textTertiary;

            const statusLabel =
              inspector.status === 'on-site'
                ? 'ON-SITE'
                : inspector.status === 'in-transit'
                  ? 'IN-TRANSIT'
                  : inspector.status === 'idle'
                    ? 'IDLE'
                    : 'OFFLINE';

            return (
              <Animated.View
                key={inspector.id}
                style={[
                  styles.inspectorCard,
                  { opacity, transform: [{ translateY }] },
                ]}
              >
                {/* Avatar */}
                <View style={[styles.inspectorAvatar, { borderColor: statusColor }]}>
                  <Text style={[styles.inspectorAvatarText, { color: statusColor }]}>
                    {inspector.avatar}
                  </Text>
                </View>

                {/* Info */}
                <View style={styles.inspectorInfo}>
                  <Text style={styles.inspectorName}>{inspector.name}</Text>
                  <Text style={styles.inspectorRole}>{inspector.role}</Text>
                  <View style={styles.inspectorMeta}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                    <Text style={[styles.inspectorStatusText, { color: statusColor }]}>
                      {statusLabel}
                    </Text>
                    <Text style={styles.inspectorSeparator}>│</Text>
                    <Text style={styles.inspectorZone}>{inspector.zone}</Text>
                  </View>
                </View>

                {/* Signal + Sonar */}
                <View style={styles.inspectorRight}>
                  {inspector.status === 'on-site' && <SonarIndicator size={38} />}
                  <View style={styles.signalContainer}>
                    <Text style={styles.signalValue}>{inspector.signalStrength}%</Text>
                    <Text style={styles.signalLabel}>{inspector.lastPing}</Text>
                  </View>
                </View>
              </Animated.View>
            );
          })}
        </View>

        {/* ── Alert Feed ── */}
        <View>
          <SectionHeader
            title="ALERT FEED"
            subtitle="Critical & warning notifications"
            delay={1300}
          />
          {alerts.map((alert, i) => {
            const { opacity, translateY } = useSlideIn(i * 120 + 1400, 15);
            const isCrit = alert.severity === 'critical';
            const pulseAnim = useRef(new Animated.Value(0)).current;

            useEffect(() => {
              if (isCrit) {
                Animated.loop(
                  Animated.sequence([
                    Animated.timing(pulseAnim, {
                      toValue: 1,
                      duration: 2000,
                      easing: Easing.inOut(Easing.ease),
                      useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                      toValue: 0,
                      duration: 2000,
                      easing: Easing.inOut(Easing.ease),
                      useNativeDriver: true,
                    }),
                  ]),
                ).start();
              }
            }, [isCrit, pulseAnim]);

            const leftBarOpacity = isCrit
              ? pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] })
              : new Animated.Value(1);

            return (
              <Animated.View
                key={alert.id}
                style={[
                  styles.alertCard,
                  { opacity, transform: [{ translateY }] },
                ]}
              >
                <Animated.View
                  style={[
                    styles.alertLeftBar,
                    {
                      backgroundColor: isCrit ? TOKENS.critical : TOKENS.warning,
                      opacity: leftBarOpacity,
                    },
                  ]}
                />
                <View style={styles.alertContent}>
                  <View style={styles.alertHeader}>
                    <View
                      style={[
                        styles.alertSeverityBadge,
                        {
                          backgroundColor: isCrit ? TOKENS.criticalDeep : TOKENS.warningFaint,
                          borderColor: isCrit ? TOKENS.critical : TOKENS.warning,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.alertSeverityText,
                          { color: isCrit ? TOKENS.critical : TOKENS.warning },
                        ]}
                      >
                        {alert.severity.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.alertZone}>Zone {alert.zone}</Text>
                    <Text style={styles.alertTimestamp}>{alert.timestamp}</Text>
                  </View>
                  <Text style={styles.alertMessage}>{alert.message}</Text>
                </View>
              </Animated.View>
            );
          })}
        </View>

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <View style={styles.footerLine} />
          <Text style={styles.footerText}>NEXPEC OPS v2.7.1, ENCRYPTED CHANNEL</Text>
          <View style={styles.footerLine} />
        </View>
      </ScrollView>
    </View>
  );
};

// ═══════════════════════════════════════════════════════════════════════
// ░░░  STYLES  ░░░
// ═══════════════════════════════════════════════════════════════════════
const styles = StyleSheet.create({
  // ── Root ──
  root: {
    flex: 1,
    backgroundColor: TOKENS.bg,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 60,
  },

  // ── Dashboard Header ──
  dashboardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },
  dashboardTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: TOKENS.textPrimary,
    letterSpacing: 4,
  },
  dashboardSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: TOKENS.primary,
    letterSpacing: 6,
    marginTop: 2,
  },
  headerRight: {
    alignItems: 'flex-end',
    paddingTop: 4,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16,185,129,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.3)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: TOKENS.success,
    marginRight: 6,
  },
  liveText: {
    fontSize: 10,
    fontWeight: '800',
    color: TOKENS.success,
    letterSpacing: 2,
  },
  headerTimestamp: {
    fontSize: 11,
    color: TOKENS.textTertiary,
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },

  // ── Section Header ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 28,
    marginBottom: 14,
  },
  sectionHeaderAccent: {
    width: 3,
    height: 32,
    backgroundColor: TOKENS.primary,
    borderRadius: 2,
    marginRight: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: TOKENS.textPrimary,
    letterSpacing: 3,
  },
  sectionSubtitle: {
    fontSize: 10,
    color: TOKENS.textTertiary,
    letterSpacing: 1.5,
    marginTop: 2,
  },

  // ── Glass Card ──
  glassCard: {
    marginHorizontal: 16,
    backgroundColor: TOKENS.cardBg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: TOKENS.border,
    padding: 16,
    overflow: 'hidden',
  },

  // ── Metrics ──
  metricsRow: {
    paddingHorizontal: 16,
    gap: 10,
  },
  metricCard: {
    backgroundColor: TOKENS.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TOKENS.border,
    paddingVertical: 16,
    paddingHorizontal: 20,
    minWidth: 120,
    alignItems: 'center',
  },
  metricValue: {
    fontSize: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: TOKENS.textSecondary,
    letterSpacing: 1,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  metricDeltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  metricDeltaArrow: {
    fontSize: 8,
    color: TOKENS.textTertiary,
    marginRight: 3,
  },
  metricDelta: {
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },

  // ── Pipeline ──
  pipelineScrollContent: {
    paddingHorizontal: 4,
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  pipelineNodeContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  pipelineConnector: {
    width: 28,
    height: 2,
    marginTop: 17,
    borderRadius: 1,
  },
  pipelineNodeWrapper: {
    alignItems: 'center',
    width: 72,
  },
  pipelineGlowRing: {
    position: 'absolute',
    top: -2,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
  },
  pipelineNode: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pipelineCheckmark: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  pipelineActiveCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  pipelinePendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pipelineLabel: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 8,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  pipelineTimestamp: {
    fontSize: 8,
    color: TOKENS.textTertiary,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  // ── Sonar / Radar ──
  sonarContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  sonarRing: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: TOKENS.success,
  },
  sonarCenter: {
    backgroundColor: TOKENS.success,
  },

  // ── Inspector Cards ──
  inspectorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: TOKENS.cardBg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: TOKENS.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  inspectorAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  inspectorAvatarText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  inspectorInfo: {
    flex: 1,
    marginLeft: 14,
  },
  inspectorName: {
    fontSize: 14,
    fontWeight: '700',
    color: TOKENS.textPrimary,
  },
  inspectorRole: {
    fontSize: 10,
    color: TOKENS.textTertiary,
    marginTop: 1,
    letterSpacing: 0.5,
  },
  inspectorMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  inspectorStatusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  inspectorSeparator: {
    fontSize: 9,
    color: TOKENS.textTertiary,
    marginHorizontal: 6,
  },
  inspectorZone: {
    fontSize: 9,
    color: TOKENS.textSecondary,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  inspectorRight: {
    alignItems: 'center',
    gap: 6,
  },
  signalContainer: {
    alignItems: 'center',
  },
  signalValue: {
    fontSize: 12,
    fontWeight: '800',
    color: TOKENS.success,
    fontVariant: ['tabular-nums'],
  },
  signalLabel: {
    fontSize: 8,
    color: TOKENS.textTertiary,
    marginTop: 1,
  },

  // ── Heatmap ──
  heatmapLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  heatmapLegendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heatmapLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  heatmapLegendText: {
    fontSize: 8,
    fontWeight: '700',
    color: TOKENS.textTertiary,
    letterSpacing: 1,
  },
  heatmapGrid: {
    gap: 6,
  },
  heatmapRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  heatmapCell: {
    // width and height set dynamically
  },
  heatmapCellInner: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 6,
    overflow: 'hidden',
  },
  heatmapZoneLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heatmapDefectCount: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  heatmapRiskLabel: {
    fontSize: 7,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginTop: 2,
  },
  heatmapCriticalOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 10,
  },

  // ── Critical Ticker ──
  tickerOuterContainer: {
    marginHorizontal: 16,
    marginTop: 20,
  },
  tickerGlowAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: TOKENS.critical,
    borderRadius: 2,
  },
  tickerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TOKENS.criticalDeep,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    height: 38,
  },
  tickerBadge: {
    backgroundColor: TOKENS.critical,
    paddingHorizontal: 12,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tickerBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 2,
  },
  tickerTextMask: {
    flex: 1,
    overflow: 'hidden',
    height: '100%',
    justifyContent: 'center',
  },
  tickerText: {
    color: TOKENS.critical,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    paddingLeft: 12,
    width: 10000, // Oversized to allow scrolling
  },

  // ── Alert Feed ──
  alertCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: TOKENS.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TOKENS.border,
    overflow: 'hidden',
  },
  alertLeftBar: {
    width: 3,
  },
  alertContent: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  alertSeverityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  alertSeverityText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  alertZone: {
    fontSize: 10,
    fontWeight: '700',
    color: TOKENS.textSecondary,
  },
  alertTimestamp: {
    fontSize: 9,
    color: TOKENS.textTertiary,
    marginLeft: 'auto',
    fontVariant: ['tabular-nums'],
  },
  alertMessage: {
    fontSize: 11,
    color: TOKENS.textSecondary,
    lineHeight: 16,
    letterSpacing: 0.2,
  },

  // ── Footer ──
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
    gap: 12,
  },
  footerLine: {
    flex: 1,
    height: 1,
    backgroundColor: TOKENS.border,
  },
  footerText: {
    fontSize: 8,
    fontWeight: '600',
    color: TOKENS.textTertiary,
    letterSpacing: 3,
  },
});

export default OperationsDashboard;