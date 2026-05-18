// ============================================================================
// LOADING OVERLAY COMPONENT
// ============================================================================
// A beautiful loading modal with spinner and gradient styling

import React from 'react';
import { StyleSheet, View, Text, Modal, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// ============================================================================
// TYPES
// ============================================================================

interface LoadingOverlayProps {
  visible: boolean;
  message?: string;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function LoadingOverlay({
  visible,
  message = 'Processing...',
}: LoadingOverlayProps) {
  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent={true} // ✅ FIX: Covers the status bar on Android
    >
      <View style={styles.overlay}>
        <LinearGradient
          colors={['#1E3A5F', '#0D1B2A']} // NEXPEC Dark Theme
          style={styles.container}
        >
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.message}>{message}</Text>
        </LinearGradient>
      </View>
    </Modal>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)', // Slightly darker for focus
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    padding: 32,
    borderRadius: 24, // Matches your other components
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    minWidth: 200,
    // Add shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  message: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
});

