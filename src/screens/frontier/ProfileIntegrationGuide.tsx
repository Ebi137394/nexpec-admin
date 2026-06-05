// ─────────────────────────────────────────────────────
// Profile Screen Integration Guide
// Hidden Dev Menu for Frontier Lab Access
// ─────────────────────────────────────────────────────

// This file demonstrates how to integrate the Frontier Lab
// as a hidden feature in your existing Profile screen.
// Add this code to your ProfileScreen.tsx or equivalent.

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import FrontierLab from './FrontierLab'; // Adjust path as needed

// ── Example Integration for ProfileScreen.tsx ────────────
// Add this code to your existing Profile screen component:

const ProfileScreen: React.FC = () => {
  // Track secret taps on the version label
  const [tapCount, setTapCount] = useState(0);
  const [labUnlocked, setLabUnlocked] = useState(false);
  const [showLab, setShowLab] = useState(false);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Secret Tap Handler ─────────────────────────
  // User must tap the version number 7 times within 3 seconds
  const handleSecretTap = useCallback(() => {
    const newCount = tapCount + 1;

    // Reset timer on each tap
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
    }

    if (newCount >= 7) {
      setLabUnlocked(true);
      setTapCount(0);
      // Optional: haptic feedback
      // Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    }

    setTapCount(newCount);

    // Reset count if no tap within 3 seconds
    tapTimerRef.current = setTimeout(() => {
      setTapCount(0);
    }, 3000);
  }, [tapCount]);

  // ── If Lab is open, render it full-screen ──────
  if (showLab) {
    return <FrontierLab onExit={() => setShowLab(false)} />;
  }

  // ── Your normal Profile screen content ─────────
  return (
    <View style={profileStyles.container}>
      {/* ... your existing profile UI ... */}

      {/* ── Version Label (Secret Tap Target) ──── */}
      <TouchableOpacity
        onPress={handleSecretTap}
        activeOpacity={1} // Keep it subtle — no visual feedback
        style={profileStyles.versionContainer}
      >
        <Text style={profileStyles.versionText}>
          Structura v2.4.0 (build 847)
        </Text>
        {tapCount > 0 && tapCount < 7 && (
          <Text style={profileStyles.tapHint}>
            {7 - tapCount} taps remaining...
          </Text>
        )}
      </TouchableOpacity>

      {/* ── Hidden Lab Button (appears after 7 taps) ── */}
      {labUnlocked && (
        <TouchableOpacity
          style={profileStyles.labButton}
          onPress={() => setShowLab(true)}
          activeOpacity={0.7}
        >
          <View style={profileStyles.labButtonInner}>
            <Text style={profileStyles.labButtonIcon}>🧪</Text>
            <View style={profileStyles.labButtonTextContainer}>
              <Text style={profileStyles.labButtonTitle}>
                Frontier Lab
              </Text>
              <Text style={profileStyles.labButtonSubtitle}>
                Experimental Features, Enter at your own risk
              </Text>
            </View>
            <Text style={profileStyles.labButtonArrow}>→</Text>
          </View>

          {/* Animated border glow */}
          <View style={profileStyles.labButtonGlow} />
        </TouchableOpacity>
      )}

      {/* ... rest of your profile UI ... */}
    </View>
  );
};

// ── Profile-specific Styles ──────────────────────────
const profileStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 20,
  },
  versionContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 4,
  },
  versionText: {
    color: '#475569',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tapHint: {
    color: '#ffaa00',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    opacity: 0.5,
  },
  labButton: {
    marginTop: 16,
    backgroundColor: 'rgba(168, 85, 247, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.25)',
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  labButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  labButtonIcon: {
    fontSize: 28,
  },
  labButtonTextContainer: {
    flex: 1,
    gap: 2,
  },
  labButtonTitle: {
    color: '#a855f7',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
  labButtonSubtitle: {
    color: '#475569',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 14,
  },
  labButtonArrow: {
    color: '#a855f7',
    fontSize: 20,
    fontWeight: '700',
  },
  labButtonGlow: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#a855f7',
    opacity: 0.4,
  },
});

export default ProfileScreen;

// ── Integration Steps ──────────────────────────────────
/*
1. Add the secret tap handler to your ProfileScreen component
2. Add the version label TouchableOpacity with handleSecretTap
3. Add the hidden lab button that appears when labUnlocked is true
4. Add the conditional render for FrontierLab when showLab is true
5. Import FrontierLab from the correct path
6. Test the 7-tap secret sequence on the version label
7. Verify the lab button appears and launches the Frontier Lab

Optional Enhancements:
- Add haptic feedback on successful unlock
- Add a subtle animation when the lab button appears
- Add a "Developer Mode" toggle in settings instead of secret tap
- Add a confirmation dialog before entering the lab
- Add analytics tracking for lab access

Security Notes:
- This is a hidden feature for development/testing
- Consider adding additional authentication for production
- The lab contains experimental features that may be unstable
- Users should be warned about potential data loss or bugs
*/