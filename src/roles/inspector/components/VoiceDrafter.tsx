import React, { useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Modal,
  Pressable,
  Vibration,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import {
  VoiceDrafterProps,
  VoiceDraftResult,
} from './types/inspectorTools.types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const VoiceDrafter: React.FC<VoiceDrafterProps> = ({
  targetFieldId,
  onTranscriptionReady,
  position = { bottom: 90, right: 20 },
  disabled = false,
}) => {
  const {
    state,
    recordingDuration,
    waveformAnim,
    pulseAnim,
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
  } = useVoiceRecorder(targetFieldId);

  const [showOverlay, setShowOverlay] = useState(false);
  const [lastResult, setLastResult] = useState<VoiceDraftResult | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // ─── Format seconds as "0:05" ───
  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ─── Handle long press start ───
  const handlePressIn = useCallback(() => {
    if (disabled || state !== 'idle') return;
    Vibration.vibrate(50);
    setShowOverlay(true);
    setLastResult(null);
    startRecording();

    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [disabled, state, startRecording, fadeAnim]);

  // ─── Handle release ───
  const handlePressOut = useCallback(async () => {
    if (state !== 'recording') return;
    Vibration.vibrate(30);

    try {
      const result = await stopRecording();
      setLastResult(result);
      onTranscriptionReady(result);
    } catch (err) {
      console.error('[VoiceDrafter] Error:', err);
    }
  }, [state, stopRecording, onTranscriptionReady]);

  // ─── Cancel ───
  const handleCancel = useCallback(() => {
    cancelRecording();
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowOverlay(false);
      setLastResult(null);
    });
  }, [cancelRecording, fadeAnim]);

  // ─── Dismiss completed overlay ───
  const handleDismiss = useCallback(() => {
    reset();
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setShowOverlay(false);
      setLastResult(null);
    });
  }, [reset, fadeAnim]);

  // ─── Confidence bar color ───
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.95) return '#22C55E';
    if (confidence >= 0.85) return '#3B82F6';
    return '#F59E0B';
  };

  return (
    <>
      {/* ─── Floating Microphone Button ─── */}
      <Animated.View
        style={[
          styles.floatingButton,
          {
            bottom: position.bottom,
            right: position.right,
            transform: [{ scale: pulseAnim }],
            opacity: disabled ? 0.4 : 1,
          },
        ]}
      >
        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          disabled={disabled || (state !== 'idle' && state !== 'completed')}
          style={({ pressed }) => [
            styles.micButton,
            state === 'recording' && styles.micButtonRecording,
            pressed && state === 'idle' && styles.micButtonPressed,
          ]}
          android_ripple={{ color: 'rgba(255,255,255,0.2)', borderless: true }}
        >
          <Text style={styles.micIcon}>
            {state === 'recording' ? '🔴' : state === 'processing' ? '⏳' : '🎤'}
          </Text>
        </Pressable>

        {/* Subtle label */}
        {state === 'idle' && (
          <View style={styles.labelBadge}>
            <Text style={styles.labelText}>Hold to speak</Text>
          </View>
        )}
      </Animated.View>

      {/* ─── Recording Overlay Modal ─── */}
      <Modal
        visible={showOverlay}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={handleCancel}
      >
        <Animated.View style={[styles.overlay, { opacity: fadeAnim }]}>
          <Pressable style={styles.overlayBackdrop} onPress={handleCancel} />

          <View style={styles.overlayContent}>
            {/* ─── RECORDING STATE ─── */}
            {state === 'recording' && (
              <View style={styles.recordingPanel}>
                <View style={styles.recordingHeader}>
                  <View style={styles.liveIndicator}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>RECORDING</Text>
                  </View>
                  <Text style={styles.durationText}>
                    {formatDuration(recordingDuration)}
                  </Text>
                </View>

                {/* Waveform Visualization */}
                <View style={styles.waveformContainer}>
                  {waveformAnim.map((animValue, index) => (
                    <Animated.View
                      key={`wave_${index}`}
                      style={[
                        styles.waveformBar,
                        {
                          height: animValue.interpolate({
                            inputRange: [0, 1],
                            outputRange: [4, 56],
                          }),
                          backgroundColor: animValue.interpolate({
                            inputRange: [0, 0.5, 1],
                            outputRange: [
                              '#64748B',
                              '#3B82F6',
                              '#2563EB',
                            ],
                          }),
                        },
                      ]}
                    />
                  ))}
                </View>

                <Text style={styles.instructionText}>
                  Release to process • Swipe down to cancel
                </Text>

                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleCancel}
                >
                  <Text style={styles.cancelButtonText}>✕ Cancel</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ─── PROCESSING STATE ─── */}
            {state === 'processing' && (
              <View style={styles.processingPanel}>
                <ActivityIndicator size="large" color="#3B82F6" />
                <Text style={styles.processingTitle}>
                  AI Processing Audio...
                </Text>
                <Text style={styles.processingSubtitle}>
                  Generating technical summary via Whisper AI
                </Text>

                {/* Simulated processing stages */}
                <View style={styles.stageList}>
                  {[
                    'Audio captured',
                    'Noise reduction applied',
                    'Speech-to-text conversion',
                    'Technical term enhancement',
                  ].map((stage, i) => (
                    <View key={i} style={styles.stageItem}>
                      <Text style={styles.stageCheck}>
                        {i < 2 ? '✅' : '⏳'}
                      </Text>
                      <Text style={styles.stageText}>{stage}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* ─── COMPLETED STATE ─── */}
            {state === 'completed' && lastResult && (
              <View style={styles.completedPanel}>
                <View style={styles.completedHeader}>
                  <Text style={styles.completedIcon}>✅</Text>
                  <Text style={styles.completedTitle}>
                    Transcription Ready
                  </Text>
                </View>

                {/* Confidence Meter */}
                <View style={styles.confidenceRow}>
                  <Text style={styles.confidenceLabel}>AI Confidence</Text>
                  <View style={styles.confidenceBarTrack}>
                    <View
                      style={[
                        styles.confidenceBarFill,
                        {
                          width: `${lastResult.confidence * 100}%`,
                          backgroundColor: getConfidenceColor(
                            lastResult.confidence
                          ),
                        },
                      ]}
                    />
                  </View>
                  <Text
                    style={[
                      styles.confidenceValue,
                      {
                        color: getConfidenceColor(lastResult.confidence),
                      },
                    ]}
                  >
                    {(lastResult.confidence * 100).toFixed(1)}%
                  </Text>
                </View>

                {/* Transcribed Text Preview */}
                <View style={styles.transcriptionBox}>
                  <Text style={styles.transcriptionText} numberOfLines={6}>
                    {lastResult.transcribedText}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>
                    ⏱ {formatDuration(lastResult.rawDuration)} recorded
                  </Text>
                  {lastResult.fieldTarget && (
                    <Text style={styles.metaText}>
                      📝 → {lastResult.fieldTarget}
                    </Text>
                  )}
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.secondaryButton}
                    onPress={handleCancel}
                  >
                    <Text style={styles.secondaryButtonText}>Discard</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleDismiss}
                  >
                    <Text style={styles.primaryButtonText}>
                      ✓ Insert into Form
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </Animated.View>
      </Modal>
    </>
  );
};

// ─── Styles ───
const styles = StyleSheet.create({
  // Floating button
  floatingButton: {
    position: 'absolute',
    zIndex: 1000,
    alignItems: 'center',
  },
  micButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#1E40AF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  micButtonRecording: {
    backgroundColor: '#DC2626',
  },
  micButtonPressed: {
    backgroundColor: '#1E3A8A',
  },
  micIcon: {
    fontSize: 26,
  },
  labelBadge: {
    marginTop: 4,
    backgroundColor: 'rgba(30,64,175,0.9)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  labelText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '600',
  },

  // Overlay
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlayContent: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },

  // Recording
  recordingPanel: {
    alignItems: 'center',
  },
  recordingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 24,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(220,38,38,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    marginRight: 8,
  },
  liveText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  durationText: {
    color: '#F8FAFC',
    fontSize: 28,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
  },

  // Waveform
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 60,
    width: '100%',
    gap: 3,
    marginBottom: 20,
  },
  waveformBar: {
    width: (SCREEN_WIDTH - 48 - 24 * 3) / 24, // dynamic bar width
    minWidth: 3,
    borderRadius: 2,
  },

  instructionText: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 16,
  },
  cancelButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#475569',
  },
  cancelButtonText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '500',
  },

  // Processing
  processingPanel: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  processingTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 4,
  },
  processingSubtitle: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 24,
  },
  stageList: {
    width: '100%',
    gap: 10,
  },
  stageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stageCheck: {
    fontSize: 16,
  },
  stageText: {
    color: '#CBD5E1',
    fontSize: 14,
  },

  // Completed
  completedPanel: {
    paddingVertical: 8,
  },
  completedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  completedIcon: {
    fontSize: 24,
  },
  completedTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '700',
  },

  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  confidenceLabel: {
    color: '#94A3B8',
    fontSize: 12,
    width: 90,
  },
  confidenceBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#1E293B',
    borderRadius: 3,
    overflow: 'hidden',
  },
  confidenceBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  confidenceValue: {
    fontSize: 13,
    fontWeight: '700',
    width: 50,
    textAlign: 'right',
  },

  transcriptionBox: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 3,
    borderLeftColor: '#3B82F6',
    marginBottom: 12,
  },
  transcriptionText: {
    color: '#E2E8F0',
    fontSize: 14,
    lineHeight: 22,
  },

  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  metaText: {
    color: '#64748B',
    fontSize: 12,
  },

  actionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#475569',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#CBD5E1',
    fontSize: 15,
    fontWeight: '600',
  },
  primaryButton: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});

export default VoiceDrafter;