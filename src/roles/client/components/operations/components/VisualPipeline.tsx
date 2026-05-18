// ─────────────────────────────────────────────────────────────
// NEXPEC — Visual Pipeline Component
// Stage Timeline: Pending → In Progress → Reviewing → Finalized
// Active stage pulses with animated glow
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { PipelineStep } from '../types/operations.types';

interface VisualPipelineProps {
  steps: PipelineStep[];
}

// ── Icons as Unicode + styled circles (no external deps) ─────
const STAGE_ICONS: Record<string, string> = {
  pending: '⏳',
  in_progress: '⚡',
  reviewing: '🔍',
  finalized: '✅',
};

// ── Single Pipeline Node ─────────────────────────────────────
const PipelineNode: React.FC<{
  step: PipelineStep;
  isLast: boolean;
  index: number;
}> = ({ step, isLast, index }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;

  // Mount animation
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 60,
      friction: 8,
      delay: index * 150,
      useNativeDriver: true,
    }).start();
  }, [index, scaleAnim]);

  // Pulse animation for active stage
  useEffect(() => {
    if (!step.isActive) return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.12,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.3,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    pulse.start();
    glow.start();

    return () => {
      pulse.stop();
      glow.stop();
    };
  }, [step.isActive, pulseAnim, glowAnim]);

  const getNodeColor = () => {
    if (step.isActive) return '#06B6D4';     // Cyan for active
    if (step.isCompleted) return '#10B981';   // Green for completed
    return '#1E293B';                          // Dark for pending
  };

  const getBorderColor = () => {
    if (step.isActive) return '#06B6D4';
    if (step.isCompleted) return '#10B981';
    return '#334155';
  };

  const getConnectorColor = () => {
    if (step.isCompleted) return '#10B981';
    return '#1E293B';
  };

  const getLabelColor = () => {
    if (step.isActive) return '#F0F9FF';
    if (step.isCompleted) return '#94A3B8';
    return '#475569';
  };

  return (
    <View style={styles.pipelineNodeContainer}>
      <View style={styles.nodeRow}>
        {/* ── The Node Circle ── */}
        <Animated.View
          style={[
            styles.nodeWrapper,
            {
              transform: [
                { scale: Animated.multiply(scaleAnim, pulseAnim) },
              ],
            },
          ]}
        >
          {/* Glow ring for active state */}
          {step.isActive && (
            <Animated.View
              style={[
                styles.glowRing,
                {
                  opacity: glowAnim,
                  borderColor: '#06B6D4',
                },
              ]}
            />
          )}

          <View
            style={[
              styles.nodeCircle,
              {
                backgroundColor: getNodeColor(),
                borderColor: getBorderColor(),
              },
            ]}
          >
            <Text style={styles.nodeIcon}>
              {STAGE_ICONS[step.stage]}
            </Text>
          </View>
        </Animated.View>

        {/* ── Connector Line ── */}
        {!isLast && (
          <View style={styles.connectorContainer}>
            <View
              style={[
                styles.connectorLine,
                { backgroundColor: getConnectorColor() },
              ]}
            />
            {step.isCompleted && (
              <View style={styles.connectorProgress} />
            )}
          </View>
        )}
      </View>

      {/* ── Label Below ── */}
      <View style={styles.nodeLabelContainer}>
        <Text
          style={[
            styles.nodeLabel,
            { color: getLabelColor() },
            step.isActive && styles.nodeLabelActive,
          ]}
        >
          {step.label}
        </Text>
        <Text style={styles.nodeSubtitle}>{step.subtitle}</Text>
        {step.timestamp && (
          <Text style={styles.nodeTimestamp}>
            {new Date(step.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Text>
        )}
      </View>
    </View>
  );
};

// ── Main Pipeline Component ──────────────────────────────────
const VisualPipeline: React.FC<VisualPipelineProps> = ({ steps }) => {
  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionIcon}>🔄</Text>
        <View>
          <Text style={styles.sectionTitle}>Project Pipeline</Text>
          <Text style={styles.sectionSubtitle}>Real-time stage tracking</Text>
        </View>
      </View>

      {/* Pipeline Track */}
      <View style={styles.pipelineTrack}>
        {steps.map((step, index) => (
          <PipelineNode
            key={step.id}
            step={step}
            index={index}
            isLast={index === steps.length - 1}
          />
        ))}
      </View>
    </View>
  );
};

// ── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0B1120',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 12,
  },
  sectionIcon: {
    fontSize: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F9FF',
    letterSpacing: 0.3,
  },
  sectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  pipelineTrack: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  pipelineNodeContainer: {
    alignItems: 'center',
    flex: 1,
  },
  nodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    justifyContent: 'center',
  },
  nodeWrapper: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
  },
  nodeCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  nodeIcon: {
    fontSize: 18,
  },
  connectorContainer: {
    flex: 1,
    height: 3,
    backgroundColor: '#1E293B',
    borderRadius: 2,
    marginHorizontal: -4,
    position: 'relative',
  },
  connectorLine: {
    flex: 1,
    height: 3,
    borderRadius: 2,
  },
  connectorProgress: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#10B981',
    borderRadius: 2,
  },
  nodeLabelContainer: {
    alignItems: 'center',
    marginTop: 10,
    maxWidth: 80,
  },
  nodeLabel: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  nodeLabelActive: {
    fontSize: 12,
    fontWeight: '800',
    color: '#06B6D4',
  },
  nodeSubtitle: {
    fontSize: 9,
    color: '#475569',
    textAlign: 'center',
    marginTop: 2,
  },
  nodeTimestamp: {
    fontSize: 9,
    color: '#06B6D4',
    marginTop: 3,
    fontWeight: '500',
  },
});

export default React.memo(VisualPipeline);