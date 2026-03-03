// src/components/LegalConsent/ConsentCheckbox.tsx

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Check, AlertCircle } from 'lucide-react-native';

interface ConsentCheckboxProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  required: boolean;
  disabled: boolean;
  error?: string;
  onToggle: (checked: boolean) => void;
}

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export const ConsentCheckbox: React.FC<ConsentCheckboxProps> = ({
  id,
  label,
  description,
  checked,
  required,
  disabled,
  error,
  onToggle,
}) => {
  const scale = useSharedValue(1);
  const checkScale = useSharedValue(checked ? 1 : 0);

  React.useEffect(() => {
    checkScale.value = withSpring(checked ? 1 : 0, {
      damping: 15,
      stiffness: 300,
    });
  }, [checked, checkScale]);

  const handlePress = () => {
    if (disabled) return;
    
    scale.value = withSequence(
      withTiming(0.95, { duration: 100 }),
      withSpring(1, { damping: 15, stiffness: 400 })
    );
    
    onToggle(!checked);
  };

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const checkboxAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
    opacity: checkScale.value,
  }));

  return (
    <AnimatedTouchable
      style={[
        styles.container,
        containerAnimatedStyle,
        checked && styles.containerChecked,
        error && styles.containerError,
        disabled && styles.containerDisabled,
      ]}
      onPress={handlePress}
      activeOpacity={0.8}
      disabled={disabled}
    >
      <View style={styles.content}>
        {/* Checkbox */}
        <View
          style={[
            styles.checkbox,
            checked && styles.checkboxChecked,
            error && styles.checkboxError,
          ]}
        >
          <Animated.View style={checkboxAnimatedStyle}>
            <Check size={14} color="#FFFFFF" strokeWidth={3} />
          </Animated.View>
        </View>

        {/* Label and Description */}
        <View style={styles.textContainer}>
          <View style={styles.labelRow}>
            <Text style={[styles.label, disabled && styles.labelDisabled]}>
              {label}
            </Text>
            {required && (
              <View style={styles.requiredBadge}>
                <Text style={styles.requiredText}>Required</Text>
              </View>
            )}
          </View>
          {description && (
            <Text style={[styles.description, disabled && styles.descriptionDisabled]}>
              {description}
            </Text>
          )}
        </View>
      </View>

      {/* Error Message */}
      {error && (
        <View style={styles.errorContainer}>
          <AlertCircle size={14} color="#EF4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </AnimatedTouchable>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#334155',
  },
  containerChecked: {
    borderColor: '#7C3AED',
    backgroundColor: 'rgba(124, 58, 237, 0.1)',
  },
  containerError: {
    borderColor: '#EF4444',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  containerDisabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#475569',
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: '#7C3AED',
    borderColor: '#7C3AED',
  },
  checkboxError: {
    borderColor: '#EF4444',
  },
  textContainer: {
    flex: 1,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F1F5F9',
    marginRight: 8,
    flex: 1,
  },
  labelDisabled: {
    color: '#64748B',
  },
  requiredBadge: {
    backgroundColor: '#7C3AED20',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  requiredText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7C3AED',
    textTransform: 'uppercase',
  },
  description: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
  },
  descriptionDisabled: {
    color: '#475569',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#EF444440',
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    marginLeft: 6,
    fontWeight: '500',
  },
});