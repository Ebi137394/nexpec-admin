// ─────────────────────────────────────────────────────────────
// NEXPEC — Live Radar: Inspector Status Cards
// Green pulsing dot = "On-Site & Working"
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { Inspector } from '../types/operations.types';

interface LiveRadarProps {
  inspectors: Inspector[];
}

// ── Status Configuration ─────────────────────────────────────
const STATUS_CONFIG: Record<
  'on-site' | 'in-transit' | 'idle' | 'offline',
  { color: string; label: string; shouldPulse: boolean }
> = {
  'on-site': { color: '#10B981', label: 'On-Site & Working', shouldPulse: true },
  'in-transit': { color: '#F59E0B', label: 'In Transit', shouldPulse: false },
  idle: { color: '#06B6D4', label: 'Idle', shouldPulse: false },
  offline: { color: '#64748B', label: 'Offline', shouldPulse: false },
};

// ── Pulsing Status Dot ───────────────────────────────────────
const StatusDot: React.FC<{ status: 'on-site' | 'in-transit' | 'idle' | 'offline' }> = ({ status }) => {
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.6)).current;
  const config = STATUS_CONFIG[status];

  useEffect(() => {
    if (!config.shouldPulse) return;

    const scaleLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseScale, {
          toValue: 2.2,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseScale, {
          toValue: 1,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    const opacityLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 0,
          duration: 1200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.6,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );

    scaleLoop.start();
    opacityLoop.start();

    return () => {
      scaleLoop.stop();
      opacityLoop.stop();
    };
  }, [config.shouldPulse, pulseScale, pulseOpacity]);

  return (
    <View style={styles.dotContainer}>
      {/* Pulse ring (only for on_site) */}
      {config.shouldPulse && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              backgroundColor: config.color,
              transform: [{ scale: pulseScale }],
              opacity: pulseOpacity,
            },
          ]}
        />
      )}
      {/* Solid dot */}
      <View
        style={[
          styles.solidDot,
          { backgroundColor: config.color },
        ]}
      />
    </View>
  );
};

// ── Progress Bar ─────────────────────────────────────────────
const ProgressBar: React.FC<{
  completed: number;
  total: number;
}> = ({ completed, total }) => {
  const widthAnim = useRef(new Animated.Value(0)).current;
  const progress = total > 0 ? completed / total : 0;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: progress,
      duration: 1000,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, widthAnim]);

  const getBarColor = () => {
    if (progress >= 0.9) return '#10B981';
    if (progress >= 0.5) return '#06B6D4';
    return '#F59E0B';
  };

  return (
    <View style={styles.progressContainer}>
      <View style={styles.progressTrack}>
        <Animated.View
          style={[
            styles.progressFill,
            {
              backgroundColor: getBarColor(),
              width: widthAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>
      <Text style={styles.progressText}>
        {completed}/{total}
      </Text>
    </View>
  );
};

// ── Inspector Card ───────────────────────────────────────────
const InspectorCard: React.FC<{
  inspector: Inspector;
  index: number;
}> = ({ inspector, index }) => {
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const config = STATUS_CONFIG[inspector.status];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        delay: index * 100,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        delay: index * 100,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, slideAnim, fadeAnim]);

  return (
    <Animated.View
      style={[
        styles.inspectorCard,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
        {/* Avatar + Status Dot */}
        <View style={styles.avatarSection}>
          <View
            style={[
              styles.avatar,
              {
                borderColor:
                  inspector.status === 'on-site' ? '#10B981' : '#1E293B',
              },
            ]}
          >
            <Text style={styles.avatarText}>{inspector.avatar}</Text>
          </View>
          <View style={styles.statusDotPosition}>
            <StatusDot status={inspector.status} />
          </View>
        </View>

        {/* Info */}
        <View style={styles.inspectorInfo}>
          <Text style={styles.inspectorName} numberOfLines={1}>
            {inspector.name}
          </Text>
          <Text style={styles.inspectorRole}>{inspector.role}</Text>

          {/* Status Badge */}
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: config.color + '18' },
            ]}
          >
            <View
              style={[
                styles.statusBadgeDot,
                { backgroundColor: config.color },
              ]}
            />
            <Text style={[styles.statusBadgeText, { color: config.color }]}>
              {config.label}
            </Text>
          </View>

          {/* Current Zone */}
          <Text style={styles.zoneText} numberOfLines={1}>
            📍 {inspector.zone}
          </Text>

          <Text style={styles.lastSeen}>Last ping: {inspector.lastPing}</Text>
        </View>
    </Animated.View>
  );
};

// ── Main Live Radar ──────────────────────────────────────────
const LiveRadar: React.FC<LiveRadarProps> = ({ inspectors }) => {
  const onSiteCount = inspectors.filter(
    (i) => i.status === 'on-site',
  ).length;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionIcon}>📡</Text>
        <View style={styles.headerTextBlock}>
          <Text style={styles.sectionTitle}>Live Radar</Text>
          <Text style={styles.sectionSubtitle}>
            {onSiteCount} inspector{onSiteCount !== 1 ? 's' : ''} on-site
          </Text>
        </View>
        <View style={styles.liveIndicator}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* Inspector Cards */}
      {inspectors.map((inspector, index) => (
        <InspectorCard
          key={inspector.id}
          inspector={inspector}
          index={index}
        />
      ))}
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
    marginBottom: 18,
    gap: 12,
  },
  headerTextBlock: {
    flex: 1,
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
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#10B98115',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  liveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 1,
  },
  inspectorCard: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  avatarSection: {
    marginRight: 14,
    position: 'relative',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#CBD5E1',
  },
  statusDotPosition: {
    position: 'absolute',
    bottom: -2,
    right: -2,
  },
  dotContainer: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  solidDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#0F172A',
  },
  inspectorInfo: {
    flex: 1,
  },
  inspectorName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F9FF',
    marginBottom: 2,
  },
  inspectorRole: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 5,
    marginBottom: 6,
  },
  statusBadgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  zoneText: {
    fontSize: 11,
    color: '#94A3B8',
    marginBottom: 8,
  },
  checksRow: {
    marginBottom: 6,
  },
  checksLabel: {
    fontSize: 10,
    color: '#475569',
    marginBottom: 4,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: '#1E293B',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  progressText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
  },
  lastSeen: {
    fontSize: 9,
    color: '#475569',
    marginTop: 2,
  },
});

export default React.memo(LiveRadar);