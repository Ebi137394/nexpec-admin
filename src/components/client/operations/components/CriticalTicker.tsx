// src/components/client/operations/components/CriticalTicker.tsx

import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { useCriticalAlerts } from '../../hooks/useCriticalAlerts';

interface CriticalTickerProps {
  organizationId: string | null;
  style?: any;
}

export function CriticalTicker({ organizationId, style }: CriticalTickerProps) {
  const { alerts, acknowledgeAlert } = useCriticalAlerts(organizationId);
  const scrollAnim = useRef(new Animated.Value(0)).current;
  const panAnim = useRef(new Animated.Value(0)).current;
  const currentIndex = useRef(0);

  useEffect(() => {
    if (alerts.length === 0) return;

    const scrollDuration = 15000; // 15 seconds per alert
    const totalDuration = scrollDuration * alerts.length;

    // Reset animation
    scrollAnim.setValue(0);
    panAnim.setValue(0);

    // Start scrolling animation
    const animation = Animated.loop(
      Animated.timing(scrollAnim, {
        toValue: -alerts.length,
        duration: totalDuration,
        useNativeDriver: true,
      })
    );

    animation.start();

    return () => animation.stop();
  }, [alerts, scrollAnim, panAnim]);

  if (alerts.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, style]}>
      <View style={styles.tickerWrapper}>
        <Animated.View
          style={[
            styles.tickerContent,
            {
              transform: [
                {
                  translateX: scrollAnim.interpolate({
                    inputRange: [0, -alerts.length],
                    outputRange: [0, -alerts.length * 300],
                  }),
                },
              ],
            },
          ]}
        >
          {alerts.map((alert: any, index: number) => (
            <View key={alert.id} style={[styles.alertItem, getSeverityStyle(alert.severity)]}>
              <View style={styles.alertIcon}>
                <Text style={styles.alertIconText}>
                  {alert.severity === 'critical' ? '⚠️' : alert.severity === 'warning' ? '⚠️' : 'ℹ️'}
                </Text>
              </View>
              <View style={styles.alertContent}>
                <Text style={styles.alertTitle} numberOfLines={1}>
                  {alert.source}
                </Text>
                <Text style={styles.alertMessage} numberOfLines={2}>
                  {alert.message}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.dismissButton}
                onPress={() => acknowledgeAlert(alert.id)}
              >
                <Text style={styles.dismissText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

function getSeverityStyle(severity: string) {
  switch (severity) {
    case 'critical':
      return { borderColor: '#FF3B30', backgroundColor: 'rgba(255, 59, 48, 0.1)' };
    case 'warning':
      return { borderColor: '#FF9500', backgroundColor: 'rgba(255, 149, 0, 0.1)' };
    case 'info':
      return { borderColor: '#007AFF', backgroundColor: 'rgba(0, 122, 255, 0.1)' };
    default:
      return { borderColor: '#666', backgroundColor: 'rgba(102, 102, 102, 0.1)' };
  }
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  tickerWrapper: {
    height: 60,
    overflow: 'hidden',
  },
  tickerContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 280,
    maxWidth: 320,
  },
  alertIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  alertIconText: {
    fontSize: 16,
  },
  alertContent: {
    flex: 1,
    marginRight: 8,
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  alertMessage: {
    fontSize: 11,
    color: '#666',
    lineHeight: 14,
  },
  dismissButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 18,
    color: '#666',
    fontWeight: 'bold',
    lineHeight: 20,
  },
});