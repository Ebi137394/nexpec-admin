// src/components/shared/SOSButton.tsx

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Vibration,
  Platform,
  Alert,
} from 'react-native';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import { Ionicons } from '@expo/vector-icons';
import { getGoogleMapsLink } from '../../utils/navigationHelper';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SOSButtonProps {
  emergencyContacts?: EmergencyContact[];
  holdDurationMs?: number;           // Default 3000 (3 seconds)
  disabled?: boolean;
  onSOSTriggered?: () => void;
  onSOSCancelled?: () => void;
}

interface EmergencyContact {
  name: string;
  phone: string;
}

// ─── Default Config ──────────────────────────────────────────────────────────

const DEFAULT_CONTACTS: EmergencyContact[] = [
  { name: 'Safety Officer', phone: '+966500000000' },
];

const HOLD_DURATION = 3000;

// ─── Component ───────────────────────────────────────────────────────────────

const SOSButton: React.FC<SOSButtonProps> = ({
  emergencyContacts = DEFAULT_CONTACTS,
  holdDurationMs = HOLD_DURATION,
  disabled = false,
  onSOSTriggered,
  onSOSCancelled,
}) => {
  const [isHolding, setIsHolding] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);

  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);

  // ── Idle Pulse Animation ─────────────────────────────────────────────────

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // ── Cleanup ──────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
      if (triggerTimeoutRef.current) clearTimeout(triggerTimeoutRef.current);
    };
  }, []);

  // ── SOS Trigger Logic ────────────────────────────────────────────────────

  const triggerSOS = useCallback(async () => {
    setIsTriggering(true);

    try {
      // Haptic burst feedback
      Vibration.vibrate([0, 200, 100, 200, 100, 400]);

      // ── 1. Check SMS Availability ──────────────────────────────────────
      const isAvailable = await SMS.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert(
          'SMS Not Available',
          'This device cannot send SMS. Please call emergency services directly.',
          [{ text: 'OK' }]
        );
        setIsTriggering(false);
        return;
      }

      // ── 2. Get Current Location ────────────────────────────────────────
      let locationLink = 'Location unavailable';

      try {
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          const { latitude, longitude } = location.coords;
          locationLink = getGoogleMapsLink(latitude, longitude);
        }
      } catch (locError) {
        console.warn('[SOS] Location error:', locError);
        // Continue without location — safety first
      }

      // ── 3. Compose & Send SMS ──────────────────────────────────────────
      const phoneNumbers = emergencyContacts.map((c) => c.phone);
      const messageBody =
        `🆘 SOS! I need help.\n\n` +
        `Inspector is requesting emergency assistance.\n\n` +
        `📍 My current location:\n${locationLink}\n\n` +
        `Sent via NEXPEC Safety System\n` +
        `Time: ${new Date().toLocaleString()}`;

      const { result } = await SMS.sendSMSAsync(phoneNumbers, messageBody);

      if (result === 'sent') {
        onSOSTriggered?.();
      }
    } catch (error: any) {
      console.error('[SOS] Error:', error);
      Alert.alert(
        'SOS Error',
        'Failed to send SOS. Please call emergency services directly.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsTriggering(false);
    }
  }, [emergencyContacts, onSOSTriggered]);

  // ── Press Handlers ───────────────────────────────────────────────────────

  const handlePressIn = useCallback(() => {
    if (disabled || isTriggering) return;

    setIsHolding(true);
    setHoldProgress(0);
    startTimeRef.current = Date.now();

    // Subtle initial vibration
    Vibration.vibrate(50);

    // Scale down
    Animated.spring(scaleAnim, {
      toValue: 0.9,
      useNativeDriver: true,
    }).start();

    // Progress animation
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: holdDurationMs,
      useNativeDriver: false,
    }).start();

    // Update progress percentage for visual feedback
    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const progress = Math.min(elapsed / holdDurationMs, 1);
      setHoldProgress(Math.round(progress * 100));
    }, 50);

    // Trigger after hold duration
    triggerTimeoutRef.current = setTimeout(() => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
      setHoldProgress(100);
      setIsHolding(false);
      triggerSOS();
    }, holdDurationMs);
  }, [disabled, isTriggering, holdDurationMs, triggerSOS]);

  const handlePressOut = useCallback(() => {
    if (!isHolding) return;

    setIsHolding(false);
    setHoldProgress(0);

    // Clear timers
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (triggerTimeoutRef.current) {
      clearTimeout(triggerTimeoutRef.current);
      triggerTimeoutRef.current = null;
    }

    // Reset animations
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
    }).start();

    progressAnim.setValue(0);

    onSOSCancelled?.();
  }, [isHolding, onSOSCancelled]);

  // ── Render ───────────────────────────────────────────────────────────────

  const progressInterpolation = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Pulse ring (idle) */}
      {!isHolding && !isTriggering && (
        <Animated.View
          style={[
            styles.pulseRing,
            { transform: [{ scale: pulseAnim }] },
          ]}
        />
      )}

      {/* Progress ring (holding) */}
      {isHolding && (
        <Animated.View
          style={[
            styles.progressRing,
            {
              transform: [{ rotate: progressInterpolation }],
            },
          ]}
        />
      )}

      {/* Main Button */}
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || isTriggering}
        style={({ pressed }) => [
          styles.button,
          isHolding && styles.buttonActive,
          isTriggering && styles.buttonTriggering,
        ]}
      >
        <Animated.View
          style={[
            styles.buttonInner,
            { transform: [{ scale: scaleAnim }] },
          ]}
        >
          {isTriggering ? (
            <Text style={styles.triggeringText}>SENDING…</Text>
          ) : isHolding ? (
            <View style={styles.holdingContent}>
              <Ionicons name="hand-left" size={18} color="#FFF" />
              <Text style={styles.holdingText}>{holdProgress}%</Text>
            </View>
          ) : (
            <View style={styles.idleContent}>
              <Ionicons name="alert-circle" size={20} color="#FFF" />
              <Text style={styles.sosText}>SOS</Text>
            </View>
          )}
        </Animated.View>
      </Pressable>

      {/* Hold instruction */}
      {!isHolding && !isTriggering && (
        <View style={styles.instructionBadge}>
          <Text style={styles.instructionText}>HOLD 3s</Text>
        </View>
      )}
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const BUTTON_SIZE = 10; // Same size as online status green dot

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 100 : 80,
    left: 20,
    width: BUTTON_SIZE + 20,
    height: BUTTON_SIZE + 30,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },

  // Pulse ring (idle animation)
  pulseRing: {
    position: 'absolute',
    width: BUTTON_SIZE + 16,
    height: BUTTON_SIZE + 16,
    borderRadius: (BUTTON_SIZE + 16) / 2,
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },

  // Progress ring (holding animation)
  progressRing: {
    position: 'absolute',
    width: BUTTON_SIZE + 16,
    height: BUTTON_SIZE + 16,
    borderRadius: (BUTTON_SIZE + 16) / 2,
    borderWidth: 3,
    borderColor: 'transparent',
    borderTopColor: '#FFF',
    borderRightColor: '#FFF',
  },

  // Button
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    backgroundColor: '#DC2626',
    justifyContent: 'center',
    alignItems: 'center',
    // Shadow
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  buttonActive: {
    backgroundColor: '#991B1B',
  },
  buttonTriggering: {
    backgroundColor: '#7F1D1D',
  },
  buttonInner: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Content states
  idleContent: {
    alignItems: 'center',
    gap: 2,
  },
  sosText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  holdingContent: {
    alignItems: 'center',
    gap: 2,
  },
  holdingText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '800',
  },
  triggeringText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },

  // Instruction badge
  instructionBadge: {
    marginTop: 4,
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  instructionText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
});

export default SOSButton;