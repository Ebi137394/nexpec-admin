// app/(tabs)/resources.tsx

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ReferenceHub from '../../src/components/inspector/knowledge/ReferenceHub';
import MicroLearning from '../../src/components/inspector/academy/MicroLearning';

export default function ResourcesScreen() {
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#020617" />

      {/* Background Gradient Layer */}
      <LinearGradient
        colors={['#020617', '#0a0f2e', '#020617']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Screen Header */}
        <View style={styles.screenHeader}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIconContainer}>
              <Ionicons name="bulb-outline" size={20} color="#FDCB6E" />
            </View>
            <View>
              <Text style={styles.headerTitle}>Knowledge Engine</Text>
              <Text style={styles.headerSubtitle}>
                Reference • Learning • Growth
              </Text>
            </View>
          </View>
          <View style={styles.offlineBadge}>
            <View style={styles.offlineDot} />
            <Text style={styles.offlineText}>Offline Ready</Text>
          </View>
        </View>

        {/* Scrollable Content: Academy on top, then Reference below */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Academy Section */}
          <MicroLearning />

          {/* Divider */}
          <View style={styles.sectionDivider}>
            <View style={styles.dividerLine} />
            <View style={styles.dividerIcon}>
              <Ionicons
                name="library-outline"
                size={14}
                color="rgba(255,255,255,0.15)"
              />
            </View>
            <View style={styles.dividerLine} />
          </View>

          {/* Reference Hub Section */}
          <ReferenceHub />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#020617',
  },
  safeArea: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },

  // Screen Header
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 12 : 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(253,203,110,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(253,203,110,0.15)',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,184,148,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,184,148,0.15)',
  },
  offlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#00B894',
  },
  offlineText: {
    color: '#00B894',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // Divider
  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginVertical: 24,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  dividerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
});