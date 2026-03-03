import { useState, useRef, useCallback, useEffect } from 'react';
import { Animated, Easing } from 'react-native';
import {
  VoiceDrafterState,
  VoiceDraftResult,
} from '../types/inspectorTools.types';
import { MOCK_TRANSCRIPTIONS } from '../utils/calibrationEngine';

interface UseVoiceRecorderReturn {
  state: VoiceDrafterState;
  recordingDuration: number;
  waveformAnim: Animated.Value[];
  pulseAnim: Animated.Value;
  startRecording: () => void;
  stopRecording: () => Promise<VoiceDraftResult>;
  cancelRecording: () => void;
  reset: () => void;
}

const WAVEFORM_BAR_COUNT = 24;

export function useVoiceRecorder(
  targetFieldId?: string
): UseVoiceRecorderReturn {
  const [state, setState] = useState<VoiceDrafterState>('idle');
  const [recordingDuration, setRecordingDuration] = useState(0);

  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveAnimTimersRef = useRef<ReturnType<typeof setInterval>[]>([]);

  // Waveform bars animation values
  const waveformAnim = useRef<Animated.Value[]>(
    Array.from({ length: WAVEFORM_BAR_COUNT }, () => new Animated.Value(0.15))
  ).current;

  // Pulse animation for the record button
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      waveAnimTimersRef.current.forEach(clearInterval);
    };
  }, []);

  /**
   * Animate waveform bars randomly to simulate live audio visualization
   */
  const startWaveformAnimation = useCallback(() => {
    // Each bar gets its own random animation loop
    waveAnimTimersRef.current = waveformAnim.map((animValue, index) => {
      return setInterval(() => {
        const randomHeight = 0.15 + Math.random() * 0.85;
        Animated.timing(animValue, {
          toValue: randomHeight,
          duration: 80 + Math.random() * 120,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }).start();
      }, 100 + index * 15);
    });
  }, [waveformAnim]);

  const stopWaveformAnimation = useCallback(() => {
    waveAnimTimersRef.current.forEach(clearInterval);
    waveAnimTimersRef.current = [];

    // Animate all bars back to minimum
    waveformAnim.forEach((animValue) => {
      Animated.timing(animValue, {
        toValue: 0.15,
        duration: 300,
        useNativeDriver: false,
      }).start();
    });
  }, [waveformAnim]);

  /**
   * Start the pulse animation on the record button
   */
  const startPulseAnimation = useCallback(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.25,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const stopPulseAnimation = useCallback(() => {
    pulseAnim.stopAnimation();
    Animated.timing(pulseAnim, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [pulseAnim]);

  /**
   * Start recording
   */
  const startRecording = useCallback(() => {
    setState('recording');
    setRecordingDuration(0);

    // Start duration counter
    durationTimerRef.current = setInterval(() => {
      setRecordingDuration((prev) => prev + 1);
    }, 1000);

    startWaveformAnimation();
    startPulseAnimation();
  }, [startWaveformAnimation, startPulseAnimation]);

  /**
   * Stop recording, simulate processing, return mock result
   */
  const stopRecording = useCallback(async (): Promise<VoiceDraftResult> => {
    // Stop timers and animations
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    stopWaveformAnimation();
    stopPulseAnimation();

    // Transition to processing
    setState('processing');

    // Simulate AI processing delay (1.5 – 3 seconds)
    const processingTime = 1500 + Math.random() * 1500;
    await new Promise((resolve) => setTimeout(resolve, processingTime));

    // Pick a random mock transcription
    const pool = MOCK_TRANSCRIPTIONS.general;
    const transcribedText = pool[Math.floor(Math.random() * pool.length)];

    const result: VoiceDraftResult = {
      id: `vd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      rawDuration: recordingDuration,
      transcribedText,
      confidence: 0.87 + Math.random() * 0.12, // 87-99%
      timestamp: Date.now(),
      fieldTarget: targetFieldId,
    };

    setState('completed');
    return result;
  }, [recordingDuration, targetFieldId, stopWaveformAnimation, stopPulseAnimation]);

  /**
   * Cancel recording without producing output
   */
  const cancelRecording = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    stopWaveformAnimation();
    stopPulseAnimation();
    setRecordingDuration(0);
    setState('idle');
  }, [stopWaveformAnimation, stopPulseAnimation]);

  /**
   * Reset to idle after completed
   */
  const reset = useCallback(() => {
    setRecordingDuration(0);
    setState('idle');
  }, []);

  return {
    state,
    recordingDuration,
    waveformAnim,
    pulseAnim,
    startRecording,
    stopRecording,
    cancelRecording,
    reset,
  };
}