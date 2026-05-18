// ─────────────────────────────────────────────────────────────
// NEXPEC — Critical Alert Banner
// Soft-red glowing banner for critical findings
// ─────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
} from 'react-native';
import { CriticalAlert } from '../types/operations.types';

interface CriticalAlertBannerProps {
  alerts: CriticalAlert[];
  onDismiss: (alertId: string) => void;
  onViewDetails?: (alert: CriticalAlert) => void;
}

// ── Single Alert Banner ──────────────────────────────────────
const AlertBanner: React.FC<{
  alert: CriticalAlert;
  index: number;
  onDismiss: (alertId: string) => void;
  onViewDetails?: (alert: CriticalAlert) => void;
}> = ({ alert, index, onDismiss, onViewDetails }) => {
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0.4)).current;
  const borderGlow = useRef(new Animated.Value(0)).current;

  // Entrance animation
  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 40,
        friction: 8,
        delay: index * 200,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        delay: index * 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, slideAnim, fadeAnim]);

  // Continuous glow pulse for new alerts
  useEffect(() => {
    if (!alert.isNew) return;

    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 0.8,
          duration: 1500,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.3,
          duration: 1500,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
      ]),
    );

    const border = Animated.loop(
      Animated.sequence([
        Animated.timing(borderGlow, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
        Animated.timing(borderGlow, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.sine),
          useNativeDriver: true,
        }),
      ]),
    );

    glow.start();
    border.start();

    return () => {
      glow.stop();
      border.stop();
    };
  }, [alert.isNew, glowAnim, borderGlow]);

  const isCritical = alert.severity === 'critical';

  return (
    <Animated.View
      style={[
        styles.alertBanner,
        {
          transform: [{ translateY: slideAnim }],
          opacity: fadeAnim,
        },
      ]}
    >
      {/* Glow background layer */}
      {alert.isNew && (
        <Animated.View
          style={[
            styles.glowBackground,
            {
              opacity: glowAnim,
              backgroundColor: isCritical ? '#DC262610' : '#F59E0B10',
            },
          ]}
        />
      )}

      {/* Left severity bar */}
      <Animated.View
        style={[
          styles.severityBar,
          {
            backgroundColor: isCritical ? '#DC2626' : '#F59E0B',
            opacity: alert.isNew
              ? borderGlow.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.5, 1],
                })
              : 1,
          },
        ]}
      />

      <View style={styles.alertContent}>
        {/* Top row: Icon + Title + Dismiss */}
        <View style={styles.alertTopRow}>
          <View style={styles.alertTitleRow}>
            <Text style={styles.alertIcon}>
              {isCritical ? '🚨' : '⚠️'}
            </Text>
            <View style={styles.alertTitleBlock}>
              <View style={styles.alertTitleWithBadge}>
                <Text
                  style={styles.alertTitle}
                  numberOfLines={1}
                >
                  {alert.title}
                </Text>
                {alert.isNew && (
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>NEW</Text>
                  </View>
                )}
              </View>
              <Text style={styles.alertMeta}>
                Zone {alert.zone} • {alert.timestamp} • {alert.inspectorName}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => onDismiss(alert.id)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={styles.dismissButton}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Description */}
        <Text style={styles.alertDescription} numberOfLines={2}>
          {alert.description}
        </Text>

        {/* Footer row */}
        <View style={styles.alertFooter}>
          <View style={styles.findingTypeBadge}>
            <Text style={styles.findingTypeText}>
              {alert.findingType}
            </Text>
          </View>
          {onViewDetails && (
            <TouchableOpacity
              onPress={() => onViewDetails(alert)}
              style={styles.viewDetailsBtn}
            >
              <Text style={styles.viewDetailsText}>
                View Details →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Animated.View>
  );
};

// ── Main Component ───────────────────────────────────────────
const CriticalAlertBanner: React.FC<CriticalAlertBannerProps> = ({
  alerts,
  onDismiss,
  onViewDetails,
}) => {
  const newAlerts = alerts.filter((a) => a.isNew);

  if (newAlerts.length === 0) return null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.alertCountBadge}>
          <Text style={styles.alertCountText}>{newAlerts.length}</Text>
        </View>
        <Text style={styles.headerTitle}>Critical Findings</Text>
        <Text style={styles.headerSubtitle}>Immediate attention required</Text>
      </View>

      {/* Alert Banners */}
      {newAlerts.map((alert, index) => (
        <AlertBanner
          key={alert.id}
          alert={alert}
          index={index}
          onDismiss={onDismiss}
          onViewDetails={onViewDetails}
        />
      ))}
    </View>
  );
};

// ── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  alertCountBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#DC262630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertCountText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FCA5A5',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FCA5A5',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginLeft: 'auto',
  },
  alertBanner: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#DC262640',
    overflow: 'hidden',
    flexDirection: 'row',
  },
  glowBackground: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
  },
  severityBar: {
    width: 4,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  alertContent: {
    flex: 1,
    padding: 14,
  },
  alertTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  alertTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 8,
  },
  alertIcon: {
    fontSize: 16,
    marginTop: 1,
  },
  alertTitleBlock: {
    flex: 1,
  },
  alertTitleWithBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  alertTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FCA5A5',
    flexShrink: 1,
  },
  newBadge: {
    backgroundColor: '#DC262640',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  newBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#DC2626',
    letterSpacing: 0.5,
  },
  alertMeta: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 3,
  },
  dismissButton: {
    fontSize: 14,
    color: '#475569',
    padding: 4,
  },
  alertDescription: {
    fontSize: 12,
    color: '#94A3B8',
    lineHeight: 17,
    marginTop: 8,
    marginLeft: 24,
  },
  alertFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    marginLeft: 24,
  },
  findingTypeBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  findingTypeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  viewDetailsBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  viewDetailsText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#06B6D4',
  },
});

export default React.memo(CriticalAlertBanner);