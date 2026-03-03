// src/components/LegalConsent/PolicyScrollView.tsx

import React, { useRef, useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';

interface PolicyScrollViewProps {
  policyText: string;
  onScrolledToBottom: (hasReached: boolean) => void;
  hasScrolledToBottom: boolean;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SCROLL_THRESHOLD = 50; // Pixels from bottom to consider "scrolled to end"

export const PolicyScrollView: React.FC<PolicyScrollViewProps> = ({
  policyText,
  onScrolledToBottom,
  hasScrolledToBottom,
}) => {
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollProgress = useSharedValue(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollViewHeight, setScrollViewHeight] = useState(0);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
      
      const currentProgress = contentOffset.y / (contentSize.height - layoutMeasurement.height);
      scrollProgress.value = currentProgress;

      const distanceFromBottom = 
        contentSize.height - layoutMeasurement.height - contentOffset.y;

      if (distanceFromBottom <= SCROLL_THRESHOLD && !hasScrolledToBottom) {
        onScrolledToBottom(true);
      }
    },
    [hasScrolledToBottom, onScrolledToBottom, scrollProgress]
  );

  const handleContentSizeChange = useCallback((w: number, h: number) => {
    setContentHeight(h);
  }, []);

  const handleLayout = useCallback((event: any) => {
    setScrollViewHeight(event.nativeEvent.layout.height);
  }, []);

  // Animated fade gradient opacity - fades out when near bottom
  const fadeAnimatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollProgress.value,
      [0, 0.85, 1],
      [1, 0.3, 0],
      Extrapolation.CLAMP
    );
    return { opacity: withTiming(opacity, { duration: 200 }) };
  });

  // Progress indicator style
  const progressStyle = useAnimatedStyle(() => {
    const width = interpolate(
      scrollProgress.value,
      [0, 1],
      [0, 100],
      Extrapolation.CLAMP
    );
    return { width: `${width}%` as any };
  });

  const paragraphs = policyText.split('\n\n').filter(p => p.trim());

  return (
    <View style={styles.container}>
      {/* Progress Bar */}
      <View style={styles.progressContainer}>
        <Animated.View style={[styles.progressBar, progressStyle]} />
      </View>

      {/* Scroll Indicator */}
      <View style={styles.scrollIndicator}>
        <Text style={styles.scrollIndicatorText}>
          {hasScrolledToBottom ? '✓ Read Complete' : 'Scroll to continue reading'}
        </Text>
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onLayout={handleLayout}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={true}
        indicatorStyle="white"
      >
        {paragraphs.map((paragraph, index) => {
          const isHeading = paragraph === paragraph.toUpperCase() || 
                           /^\d+\./.test(paragraph) ||
                           paragraph.startsWith('a)') ||
                           paragraph.startsWith('b)') ||
                           paragraph.startsWith('c)') ||
                           paragraph.startsWith('d)');
          
          const isSubItem = /^[a-d]\)/.test(paragraph);
          const isSectionNumber = /^\d+\./.test(paragraph);

          return (
            <Text
              key={index}
              style={[
                styles.paragraph,
                isSectionNumber && styles.sectionHeading,
                isSubItem && styles.subItem,
                paragraph === paragraph.toUpperCase() && 
                  paragraph.length > 10 && styles.mainHeading,
              ]}
            >
              {paragraph}
            </Text>
          );
        })}
        
        {/* Bottom padding for scroll completion */}
        <View style={styles.bottomSpacer} />
      </ScrollView>

      {/* Fade Gradient Overlay */}
      <Animated.View style={[styles.fadeOverlay, fadeAnimatedStyle]} pointerEvents="none">
        <LinearGradient
          colors={['transparent', 'rgba(15, 23, 42, 0.8)', '#0F172A']}
          style={styles.gradient}
          locations={[0, 0.5, 1]}
        />
        {!hasScrolledToBottom && (
          <View style={styles.scrollHint}>
            <Text style={styles.scrollHintText}>↓ Scroll to read more ↓</Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  progressContainer: {
    height: 3,
    backgroundColor: '#1E293B',
    width: '100%',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#7C3AED',
  },
  scrollIndicator: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#1E293B',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  scrollIndicatorText: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 80,
  },
  paragraph: {
    color: '#E2E8F0',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 16,
    fontFamily: 'System',
  },
  mainHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 24,
    marginTop: 8,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F8FAFC',
    marginTop: 8,
    marginBottom: 12,
  },
  subItem: {
    marginLeft: 20,
    marginBottom: 12,
    color: '#CBD5E1',
  },
  bottomSpacer: {
    height: 40,
  },
  fadeOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
    justifyContent: 'flex-end',
  },
  gradient: {
    flex: 1,
  },
  scrollHint: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  scrollHintText: {
    color: '#7C3AED',
    fontSize: 13,
    fontWeight: '600',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
});