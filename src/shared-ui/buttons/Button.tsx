import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// ============================================================================
// TYPES
// ============================================================================

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'small' | 'medium' | 'large';
  isLoading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SIZE_STYLES = {
  small: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 14,
    iconSize: 16,
  },
  medium: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    fontSize: 16,
    iconSize: 20,
  },
  large: {
    paddingHorizontal: 32,
    paddingVertical: 18,
    fontSize: 18,
    iconSize: 24,
  },
} as const;

const GRADIENT_COLORS = {
  primary: ['#3B82F6', '#1D4ED8'],
  secondary: ['#8B5CF6', '#6D28D9'],
  danger: ['#EF4444', '#DC2626'],
} as const;

// ============================================================================
// COMPONENT
// ============================================================================

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  isLoading = false,
  disabled = false,
  icon,
  style,
  textStyle,
  fullWidth = false,
}) => {
  const isDisabled = disabled || isLoading;
  const sizeConfig = SIZE_STYLES[size];

  // ========================================
  // RENDER CONTENT
  // ========================================

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="small"
            color={variant === 'outline' || variant === 'ghost' ? '#3B82F6' : '#FFFFFF'}
          />
        </View>
      );
    }

    return (
      <View style={styles.contentContainer}>
        {icon && <View style={styles.iconContainer}>{icon}</View>}
        <Text
          style={[
            styles.text,
            styles[`${variant}Text`],
            { fontSize: sizeConfig.fontSize },
            textStyle,
          ]}
        >
          {title}
        </Text>
      </View>
    );
  };

  // ========================================
  // RENDER BY VARIANT
  // ========================================

  // Primary & Secondary & Danger (Gradient)
  if (variant === 'primary' || variant === 'secondary' || variant === 'danger') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        style={[
          { opacity: isDisabled ? 0.6 : 1 },
          fullWidth && styles.fullWidth,
          style,
        ]}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={GRADIENT_COLORS[variant]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[
            styles.button,
            styles.gradientButton,
            {
              paddingHorizontal: sizeConfig.paddingHorizontal,
              paddingVertical: sizeConfig.paddingVertical,
            },
          ]}
        >
          {renderContent()}
        </LinearGradient>
      </TouchableOpacity>
    );
  }

  // Outline
  if (variant === 'outline') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        style={[
          styles.button,
          styles.outlineButton,
          {
            paddingHorizontal: sizeConfig.paddingHorizontal,
            paddingVertical: sizeConfig.paddingVertical,
            opacity: isDisabled ? 0.6 : 1,
          },
          fullWidth && styles.fullWidth,
          style,
        ]}
        activeOpacity={0.7}
      >
        {renderContent()}
      </TouchableOpacity>
    );
  }

  // Ghost
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      style={[
        styles.button,
        styles.ghostButton,
        {
          paddingHorizontal: sizeConfig.paddingHorizontal,
          paddingVertical: sizeConfig.paddingVertical,
          opacity: isDisabled ? 0.6 : 1,
        },
        fullWidth && styles.fullWidth,
        style,
      ]}
      activeOpacity={0.7}
    >
      {renderContent()}
    </TouchableOpacity>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    minHeight: 48,
  },
  gradientButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  outlineButton: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#3B82F6',
  },
  ghostButton: {
    backgroundColor: 'transparent',
  },
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  iconContainer: {
    marginRight: 0,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: '600',
    textAlign: 'center',
  },
  primaryText: {
    color: '#FFFFFF',
  },
  secondaryText: {
    color: '#FFFFFF',
  },
  dangerText: {
    color: '#FFFFFF',
  },
  outlineText: {
    color: '#3B82F6',
  },
  ghostText: {
    color: '#3B82F6',
  },
  fullWidth: {
    width: '100%',
  },
});

