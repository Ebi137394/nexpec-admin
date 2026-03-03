// src/components/client/operations/components/SegmentedTabBar.tsx

import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';

interface SegmentedTabBarProps {
  tabs: string[];
  selectedIndex: number;
  onTabPress: (index: number) => void;
  style?: any;
}

export function SegmentedTabBar({
  tabs,
  selectedIndex,
  onTabPress,
  style,
}: SegmentedTabBarProps) {
  return (
    <BlurView
      intensity={80}
      tint="light"
      style={[styles.container, style]}
    >
      <View style={styles.segmentedControl}>
        {tabs.map((tab, index) => (
          <TouchableOpacity
            key={index}
            style={[
              styles.tabButton,
              index === 0 && styles.firstTab,
              index === tabs.length - 1 && styles.lastTab,
              index === selectedIndex && styles.selectedTab,
            ]}
            onPress={() => onTabPress(index)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabText,
                index === selectedIndex && styles.selectedText,
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    marginHorizontal: 16,
    marginVertical: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  firstTab: {
    marginLeft: 0,
  },
  lastTab: {
    marginRight: 0,
  },
  selectedTab: {
    backgroundColor: '#007AFF',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
  selectedText: {
    color: '#fff',
    fontWeight: '700',
  },
});