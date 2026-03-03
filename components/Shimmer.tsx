// components/Shimmer.tsx
// ──────────────────────────────────────────────────────────────────
// Zero-dependency translateX shimmer effect
// Uses only React Native Animated API
// ──────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, ViewStyle } from 'react-native';

interface ShimmerProps {
  width?: number | string;
  height?: number;
  style?: any;
  children?: React.ReactNode;
}

export const Shimmer: React.FC<ShimmerProps> = ({ 
  width = '100%', 
  height = 20, 
  style, 
  children 
}) => {
  const translateX = useRef(new Animated.Value(-100)).current;

  useEffect(() => {
    const shimmerAnimation = Animated.loop(
      Animated.timing(translateX, {
        toValue: 100,
        duration: 1200,
        useNativeDriver: true,
      })
    );
    
    shimmerAnimation.start();
    
    return () => {
      shimmerAnimation.stop();
    };
  }, [translateX]);

  return (
    <View style={[styles.container, { width, height }, style]}>
      {children}
      <Animated.View
        style={[
          styles.shimmer,
          {
            transform: [{ translateX }],
          },
        ]}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    left: -100,
    width: 100,
    height: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 4,
  },
});