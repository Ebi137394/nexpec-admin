import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

// ─── CONSTANTS ────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const NUM_BARS = 40;
const SPECTRUM_BARS = 60;
const BAR_WIDTH = (SCREEN_WIDTH - 80) / NUM_BARS - 2;
const SPECTRUM_BAR_WIDTH = (SCREEN_WIDTH - 80) / SPECTRUM_BARS - 1;

const COLORS = {
  bg: '#020617',
  bgCard: '#0a1628',
  bgCardBorder: '#0e2a4d',
  cyan: '#00f0ff',
  cyanDim: '#00f0ff40',
  cyanGlow: '#00f0ff20',
  green: '#00ff88',
  greenDim: '#00ff8840',
  red: '#ff003c',
  redDim: '#ff003c30',
  amber: '#ffaa00',
  amberDim: '#ffaa0030',
  white: '#e0e6f0',
  whiteDim: '#e0e6f060',
  gridLine: '#0e2a4d40',
  scanLine: '#00f0ff08',
};

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// ─── TYPES ────────────────────────────────────────────────
type Phase = 'idle' | 'listening' | 'processing' | 'result';

interface DiagnosisResult {
  fault: string;
  confidence: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  frequency: string;
  rpmAnomaly: string;
  recommendation: string;
  signalSNR: string;
  harmonics: number[];
}

// ─── MOCK DATA ────────────────────────────────────────────
const MOCK_DIAGNOSIS: DiagnosisResult = {
  fault: 'Bearing Failure Detected',
  confidence: 94,
  severity: 'CRITICAL',
  frequency: '1247 Hz',
  rpmAnomaly: '+340 RPM deviation',
  recommendation: 'Immediate replacement required within 72 hours',
  signalSNR: '34.2 dB',
  harmonics: [0.3, 0.7, 1.0, 0.85, 0.6, 0.4, 0.9, 0.5, 0.35, 0.2],
};

const MOCK_SPECTRUM_DATA: number[] = Array.from({ length: SPECTRUM_BARS }, (_, i) => {
  const x = i / SPECTRUM_BARS;
  // Create a realistic-looking frequency spectrum with peaks
  const base = Math.random() * 0.15 + 0.05;
  const peak1 = Math.exp(-Math.pow((x - 0.25) * 8, 2)) * 0.9;
  const peak2 = Math.exp(-Math.pow((x - 0.55) * 12, 2)) * 0.7;
  const peak3 = Math.exp(-Math.pow((x - 0.78) * 10, 2)) * 0.5;
  return Math.min(base + peak1 + peak2 + peak3, 1.0);
});

// ─── COMPONENT ────────────────────────────────────────────
const AudioDiagnose: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [decibelLevel, setDecibelLevel] = useState(0);

  // Waveform bar animations
  const barAnims = useRef<Animated.Value[]>(
    Array.from({ length: NUM_BARS }, () => new Animated.Value(0.05))
  ).current;

  // Spectrum bar animations for result
  const spectrumAnims = useRef<Animated.Value[]>(
    Array.from({ length: SPECTRUM_BARS }, () => new Animated.Value(0))
  ).current;

  // HUD animations
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const fadeInResult = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const ringScale = useRef(new Animated.Value(0.8)).current;
  const ringOpacity = useRef(new Animated.Value(0)).current;
  const processingDots = useRef(new Animated.Value(0)).current;
  const confidenceAnim = useRef(new Animated.Value(0)).current;
  const headerGlow = useRef(new Animated.Value(0)).current;

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dbTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── IDLE PULSING ANIMATION ───────────────────────────
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();

    // Header glow loop
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(headerGlow, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(headerGlow, {
          toValue: 0.3,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    );
    glowLoop.start();

    return () => {
      loop.stop();
      glowLoop.stop();
    };
  }, []);

  // ─── SCAN LINE ANIMATION ─────────────────────────────
  useEffect(() => {
    if (phase === 'listening') {
      const loop = Animated.loop(
        Animated.timing(scanLineAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      loop.start();
      return () => loop.stop();
    }
  }, [phase]);

  // ─── WAVEFORM ANIMATION ──────────────────────────────
  const animateWaveform = useCallback(() => {
    const animate = () => {
      const animations = barAnims.map((anim) => {
        const target = Math.random() * 0.85 + 0.15;
        return Animated.timing(anim, {
          toValue: target,
          duration: 80 + Math.random() * 60,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        });
      });
      Animated.parallel(animations).start();
    };

    const interval = setInterval(animate, 100);
    return interval;
  }, [barAnims]);

  // ─── LISTENING RING PULSE ────────────────────────────
  const animateRingPulse = useCallback(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 1.6,
            duration: 1000,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0,
            duration: 1000,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(ringScale, {
            toValue: 0.8,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(ringOpacity, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    loop.start();
    return loop;
  }, [ringScale, ringOpacity]);

  // ─── SPECTRUM ANIMATION ───────────────────────────────
  const animateSpectrum = useCallback(() => {
    const animations = spectrumAnims.map((anim, i) =>
      Animated.timing(anim, {
        toValue: MOCK_SPECTRUM_DATA[i],
        duration: 600 + i * 15,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      })
    );
    Animated.stagger(8, animations).start();
  }, [spectrumAnims]);

  // ─── GLOW LOOP ────────────────────────────────────────
  const startGlowLoop = useCallback(() => {
    return Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0.3,
          duration: 800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
  }, [glowAnim]);

  // ─── RESET ────────────────────────────────────────────
  const resetAll = useCallback(() => {
    barAnims.forEach((a) => a.setValue(0.05));
    spectrumAnims.forEach((a) => a.setValue(0));
    fadeInResult.setValue(0);
    confidenceAnim.setValue(0);
    ringScale.setValue(0.8);
    ringOpacity.setValue(0);
    setElapsedMs(0);
    setDecibelLevel(0);
    if (timerRef.current) clearInterval(timerRef.current);
    if (dbTimerRef.current) clearInterval(dbTimerRef.current);
  }, []);

  // ─── MAIN TAP HANDLER ────────────────────────────────
  const handleTap = useCallback(() => {
    if (phase !== 'idle') return;

    resetAll();
    setPhase('listening');

    // Start waveform animation
    const waveInterval = animateWaveform();
    timerRef.current = waveInterval;

    // Animate ring pulse
    const ringLoop = animateRingPulse();

    // Simulate elapsed time
    let ms = 0;
    const elapsed = setInterval(() => {
      ms += 50;
      setElapsedMs(ms);
    }, 50);

    // Simulate decibel fluctuation
    const dbInterval = setInterval(() => {
      setDecibelLevel(Math.floor(Math.random() * 30 + 55));
    }, 150);
    dbTimerRef.current = dbInterval;

    // After 3 seconds, go to processing
    setTimeout(() => {
      clearInterval(waveInterval);
      clearInterval(elapsed);
      clearInterval(dbInterval);
      ringLoop.stop();
      ringOpacity.setValue(0);

      // Flatten bars
      const flattenAnims = barAnims.map((anim) =>
        Animated.timing(anim, {
          toValue: 0.05,
          duration: 300,
          useNativeDriver: true,
        })
      );
      Animated.parallel(flattenAnims).start();

      setPhase('processing');

      // Start processing dots animation
      const dotsLoop = Animated.loop(
        Animated.timing(processingDots, {
          toValue: 3,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: false,
        })
      );
      dotsLoop.start();

      // After 2 seconds, show result
      setTimeout(() => {
        dotsLoop.stop();
        setPhase('result');

        // Animate spectrum bars
        animateSpectrum();

        // Fade in result
        Animated.timing(fadeInResult, {
          toValue: 1,
          duration: 800,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();

        // Animate confidence counter
        Animated.timing(confidenceAnim, {
          toValue: MOCK_DIAGNOSIS.confidence,
          duration: 1200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }).start();

        // Start glow loop for alert
        startGlowLoop().start();
      }, 2000);
    }, 3000);
  }, [phase, resetAll, animateWaveform, animateRingPulse, animateSpectrum, startGlowLoop]);

  // ─── RESET HANDLER ───────────────────────────────────
  const handleReset = useCallback(() => {
    resetAll();
    glowAnim.setValue(0);
    setPhase('idle');
  }, [resetAll]);

  // ─── RENDER: CORNER BRACKETS ──────────────────────────
  const renderCornerBrackets = (color: string = COLORS.cyan) => (
    <>
      {/* Top-Left */}
      <View style={[styles.cornerBracket, styles.cornerTL]}>
        <View style={[styles.cornerH, { backgroundColor: color }]} />
        <View style={[styles.cornerV, { backgroundColor: color }]} />
      </View>
      {/* Top-Right */}
      <View style={[styles.cornerBracket, styles.cornerTR]}>
        <View style={[styles.cornerH, { backgroundColor: color }]} />
        <View style={[styles.cornerV, { backgroundColor: color, alignSelf: 'flex-end' }]} />
      </View>
      {/* Bottom-Left */}
      <View style={[styles.cornerBracket, styles.cornerBL]}>
        <View style={[styles.cornerV, { backgroundColor: color }]} />
        <View style={[styles.cornerH, { backgroundColor: color }]} />
      </View>
      {/* Bottom-Right */}
      <View style={[styles.cornerBracket, styles.cornerBR]}>
        <View style={[styles.cornerV, { backgroundColor: color, alignSelf: 'flex-end' }]} />
        <View style={[styles.cornerH, { backgroundColor: color }]} />
      </View>
    </>
  );

  // ─── RENDER: GRID LINES ───────────────────────────────
  const renderGridLines = () => (
    <View style={styles.gridContainer} pointerEvents="none">
      {Array.from({ length: 5 }).map((_, i) => (
        <View
          key={`h-${i}`}
          style={[
            styles.gridLineH,
            { top: `${(i + 1) * 16.6}%` },
          ]}
        />
      ))}
      {Array.from({ length: 8 }).map((_, i) => (
        <View
          key={`v-${i}`}
          style={[
            styles.gridLineV,
            { left: `${(i + 1) * 11.1}%` },
          ]}
        />
      ))}
    </View>
  );

  // ─── RENDER: WAVEFORM VISUALIZER ──────────────────────
  const renderWaveform = () => (
    <View style={styles.waveformContainer}>
      {renderGridLines()}
      <View style={styles.waveformBars}>
        {barAnims.map((anim, i) => (
          <Animated.View
            key={i}
            style={[
              styles.waveformBar,
              {
                width: BAR_WIDTH,
                transform: [{ scaleY: anim }],
                backgroundColor:
                  i % 5 === 0 ? COLORS.cyan : COLORS.cyanDim,
                shadowColor: COLORS.cyan,
                shadowOpacity: i % 5 === 0 ? 0.8 : 0.2,
                shadowRadius: i % 5 === 0 ? 6 : 2,
              },
            ]}
          />
        ))}
      </View>

      {/* Scan line overlay during listening */}
      {phase === 'listening' && (
        <Animated.View
          style={[
            styles.scanLine,
            {
              transform: [
                {
                  translateX: scanLineAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-(SCREEN_WIDTH - 80), SCREEN_WIDTH - 80],
                  }),
                },
              ],
            },
          ]}
        />
      )}

      {/* Center line */}
      <View style={styles.centerLine} />
    </View>
  );

  // ─── RENDER: SPECTRUM GRAPH ───────────────────────────
  const renderSpectrumGraph = () => (
    <Animated.View style={[styles.spectrumContainer, { opacity: fadeInResult }]}>
      <View style={styles.spectrumHeader}>
        <Text style={styles.spectrumTitle}>▸ FREQUENCY SPECTRUM ANALYSIS</Text>
        <Text style={styles.spectrumSubtitle}>FFT 2048 | SR: 44.1kHz</Text>
      </View>
      <View style={styles.spectrumGraph}>
        {renderGridLines()}
        <View style={styles.spectrumBars}>
          {spectrumAnims.map((anim, i) => {
            const isPeak = MOCK_SPECTRUM_DATA[i] > 0.65;
            return (
              <Animated.View
                key={i}
                style={[
                  styles.spectrumBar,
                  {
                    width: SPECTRUM_BAR_WIDTH,
                    transform: [{ scaleY: anim }],
                    backgroundColor: isPeak ? COLORS.red : COLORS.green,
                    shadowColor: isPeak ? COLORS.red : COLORS.green,
                    shadowOpacity: isPeak ? 0.8 : 0.3,
                    shadowRadius: isPeak ? 6 : 2,
                  },
                ]}
              />
            );
          })}
        </View>

        {/* Frequency axis labels */}
        <View style={styles.axisLabels}>
          <Text style={styles.axisLabel}>0 Hz</Text>
          <Text style={styles.axisLabel}>5.5 kHz</Text>
          <Text style={styles.axisLabel}>11 kHz</Text>
          <Text style={styles.axisLabel}>16.5 kHz</Text>
          <Text style={styles.axisLabel}>22 kHz</Text>
        </View>

        {/* Anomaly marker */}
        <View style={[styles.anomalyMarker, { left: '24%' }]}>
          <View style={styles.anomalyLine} />
          <Text style={styles.anomalyLabel}>▼ 1247 Hz</Text>
        </View>
      </View>
    </Animated.View>
  );

  // ─── RENDER: DIAGNOSIS CARD ───────────────────────────
  const renderDiagnosisCard = () => (
    <Animated.View
      style={[
        styles.diagnosisCard,
        {
          opacity: fadeInResult,
          transform: [
            {
              translateY: fadeInResult.interpolate({
                inputRange: [0, 1],
                outputRange: [30, 0],
              }),
            },
          ],
        },
      ]}
    >
      {renderCornerBrackets(COLORS.red)}

      {/* Alert header */}
      <Animated.View
        style={[
          styles.alertHeader,
          {
            opacity: glowAnim.interpolate({
              inputRange: [0, 0.3, 1],
              outputRange: [0.6, 0.8, 1],
            }),
          },
        ]}
      >
        <Text style={styles.alertIcon}>⚠️</Text>
        <View style={styles.alertTextContainer}>
          <Text style={styles.alertTitle}>{MOCK_DIAGNOSIS.fault}</Text>
          <View style={styles.severityBadge}>
            <Animated.View
              style={[
                styles.severityDot,
                {
                  opacity: glowAnim,
                  backgroundColor: COLORS.red,
                },
              ]}
            />
            <Text style={styles.severityText}>{MOCK_DIAGNOSIS.severity}</Text>
          </View>
        </View>
      </Animated.View>

      {/* Confidence gauge */}
      <View style={styles.confidenceContainer}>
        <Text style={styles.confidenceLabel}>CONFIDENCE LEVEL</Text>
        <View style={styles.confidenceBarBg}>
          <Animated.View
            style={[
              styles.confidenceBarFill,
              {
                width: confidenceAnim.interpolate({
                  inputRange: [0, 100],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
          <View style={styles.confidenceMarkers}>
            {[25, 50, 75].map((m) => (
              <View
                key={m}
                style={[styles.confidenceMarker, { left: `${m}%` }]}
              />
            ))}
          </View>
        </View>
        <ConfidenceCounter anim={confidenceAnim} />
      </View>

      {/* Data grid */}
      <View style={styles.dataGrid}>
        <DataRow label="FREQUENCY" value={MOCK_DIAGNOSIS.frequency} />
        <DataRow label="RPM ANOMALY" value={MOCK_DIAGNOSIS.rpmAnomaly} accent />
        <DataRow label="SIGNAL SNR" value={MOCK_DIAGNOSIS.signalSNR} />
        <DataRow
          label="HARMONICS"
          value={MOCK_DIAGNOSIS.harmonics
            .slice(0, 5)
            .map((h) => h.toFixed(1))
            .join(' | ')}
        />
      </View>

      {/* Recommendation */}
      <View style={styles.recommendationBox}>
        <Text style={styles.recommendationLabel}>▸ RECOMMENDATION</Text>
        <Text style={styles.recommendationText}>
          {MOCK_DIAGNOSIS.recommendation}
        </Text>
      </View>
    </Animated.View>
  );

  // ─── RENDER: MAIN ─────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <Animated.View style={[styles.header, { opacity: headerGlow }]}>
        <Text style={styles.headerTag}>SYS://AUDIO_DIAGNOSTICS</Text>
      </Animated.View>
      <Text style={styles.headerTitle}>Industrial Audio Shazam</Text>
      <Text style={styles.headerSubtitle}>
        Acoustic Fault Detection Engine v3.2.1
      </Text>

      {/* ── Telemetry bar ── */}
      {phase === 'listening' && (
        <View style={styles.telemetryBar}>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>ELAPSED</Text>
            <Text style={styles.telemetryValue}>
              {(elapsedMs / 1000).toFixed(1)}s
            </Text>
          </View>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>LEVEL</Text>
            <Text style={styles.telemetryValue}>{decibelLevel} dB</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>SAMPLE RATE</Text>
            <Text style={styles.telemetryValue}>44.1 kHz</Text>
          </View>
          <View style={styles.telemetryItem}>
            <Text style={styles.telemetryLabel}>CHANNELS</Text>
            <Text style={styles.telemetryValue}>STEREO</Text>
          </View>
        </View>
      )}

      {/* ── Waveform Visualizer ── */}
      <View style={styles.visualizerFrame}>
        {renderCornerBrackets()}
        {renderWaveform()}

        {/* Status indicator */}
        <View style={styles.statusIndicator}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  phase === 'listening'
                    ? COLORS.green
                    : phase === 'processing'
                    ? COLORS.amber
                    : phase === 'result'
                    ? COLORS.red
                    : COLORS.whiteDim,
              },
            ]}
          />
          <Text style={styles.statusText}>
            {phase === 'idle'
              ? 'STANDBY'
              : phase === 'listening'
              ? 'RECORDING'
              : phase === 'processing'
              ? 'ANALYZING'
              : 'COMPLETE'}
          </Text>
        </View>
      </View>

      {/* ── Idle Button ── */}
      {phase === 'idle' && (
        <TouchableOpacity
          style={styles.listenButton}
          onPress={handleTap}
          activeOpacity={0.7}
        >
          <Animated.View
            style={[
              styles.listenButtonRing,
              {
                transform: [
                  {
                    scale: pulseAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.15],
                    }),
                  },
                ],
                opacity: pulseAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.4, 0.9],
                }),
              },
            ]}
          />
          <View style={styles.listenButtonInner}>
            <Text style={styles.listenButtonIcon}>🎧</Text>
            <Text style={styles.listenButtonText}>TAP TO LISTEN</Text>
          </View>
        </TouchableOpacity>
      )}

      {/* ── Listening Ring Pulse ── */}
      {phase === 'listening' && (
        <View style={styles.listeningContainer}>
          <Animated.View
            style={[
              styles.listeningRing,
              {
                transform: [{ scale: ringScale }],
                opacity: ringOpacity,
              },
            ]}
          />
          <Text style={styles.listeningText}>◉ LISTENING...</Text>
          <Text style={styles.listeningSubText}>
            Capturing acoustic signature
          </Text>
        </View>
      )}

      {/* ── Processing ── */}
      {phase === 'processing' && (
        <View style={styles.processingContainer}>
          <View style={styles.processingSpinner}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.processingDot,
                  {
                    transform: [
                      { rotate: `${i * 45}deg` },
                      { translateY: -20 },
                    ],
                    opacity: 0.3 + (i / 8) * 0.7,
                  },
                ]}
              />
            ))}
          </View>
          <Text style={styles.processingText}>ANALYZING SIGNAL</Text>
          <Text style={styles.processingSubText}>
            Running FFT decomposition & pattern matching...
          </Text>
        </View>
      )}

      {/* ── Result: Spectrum + Diagnosis ── */}
      {phase === 'result' && (
        <>
          {renderSpectrumGraph()}
          {renderDiagnosisCard()}

          <TouchableOpacity
            style={styles.resetButton}
            onPress={handleReset}
            activeOpacity={0.7}
          >
            <Text style={styles.resetButtonText}>↻ NEW SCAN</Text>
          </TouchableOpacity>
        </>
      )}

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          NEXPEC FRONTIER // AUDIO_ENGINE v3.2.1 // {new Date().toISOString().slice(0, 10)}
        </Text>
      </View>
    </View>
  );
};

// ─── SUB-COMPONENTS ─────────────────────────────────────
const ConfidenceCounter: React.FC<{ anim: Animated.Value }> = ({ anim }) => {
  const [val, setVal] = useState(0);

  useEffect(() => {
    const id = anim.addListener(({ value }) => setVal(Math.round(value)));
    return () => anim.removeListener(id);
  }, [anim]);

  return (
    <Text style={styles.confidenceValue}>
      {val}
      <Text style={styles.confidenceUnit}>%</Text>
    </Text>
  );
};

const DataRow: React.FC<{
  label: string;
  value: string;
  accent?: boolean;
}> = ({ label, value, accent }) => (
  <View style={styles.dataRow}>
    <Text style={styles.dataLabel}>{label}</Text>
    <Text style={[styles.dataValue, accent && styles.dataValueAccent]}>
      {value}
    </Text>
  </View>
);

// ─── STYLES ─────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 20,
    paddingTop: 16,
  },

  // Header
  header: {
    marginBottom: 4,
  },
  headerTag: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: COLORS.cyan,
    letterSpacing: 2,
  },
  headerTitle: {
    fontFamily: MONO_FONT,
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.white,
    marginBottom: 2,
  },
  headerSubtitle: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: COLORS.whiteDim,
    marginBottom: 16,
    letterSpacing: 0.5,
  },

  // Telemetry
  telemetryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgCardBorder,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  telemetryItem: {
    alignItems: 'center',
  },
  telemetryLabel: {
    fontFamily: MONO_FONT,
    fontSize: 8,
    color: COLORS.whiteDim,
    letterSpacing: 1,
  },
  telemetryValue: {
    fontFamily: MONO_FONT,
    fontSize: 13,
    color: COLORS.cyan,
    fontWeight: '700',
    marginTop: 2,
  },

  // Visualizer Frame
  visualizerFrame: {
    height: 160,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgCardBorder,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 16,
    position: 'relative',
  },

  // Corner brackets
  cornerBracket: {
    position: 'absolute',
    width: 16,
    height: 16,
    zIndex: 10,
  },
  cornerTL: { top: 4, left: 4 },
  cornerTR: { top: 4, right: 4 },
  cornerBL: { bottom: 4, left: 4 },
  cornerBR: { bottom: 4, right: 4 },
  cornerH: {
    width: 16,
    height: 1,
  },
  cornerV: {
    width: 1,
    height: 16,
  },

  // Grid
  gridContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.gridLine,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: COLORS.gridLine,
  },

  // Waveform
  waveformContainer: {
    flex: 1,
    justifyContent: 'center',
    position: 'relative',
  },
  waveformBars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 120,
    gap: 2,
  },
  waveformBar: {
    height: 120,
    borderRadius: 1,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  centerLine: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 1,
    backgroundColor: COLORS.cyanDim,
    top: '50%',
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: COLORS.cyan,
    shadowColor: COLORS.cyan,
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 10,
  },

  // Status
  statusIndicator: {
    position: 'absolute',
    top: 8,
    right: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: COLORS.whiteDim,
    letterSpacing: 1,
  },

  // Listen Button
  listenButton: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    width: 160,
    height: 160,
    marginVertical: 24,
  },
  listenButtonRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: COLORS.cyan,
  },
  listenButtonInner: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listenButtonIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  listenButtonText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: COLORS.cyan,
    fontWeight: '700',
    letterSpacing: 2,
  },

  // Listening
  listeningContainer: {
    alignItems: 'center',
    marginVertical: 16,
  },
  listeningRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: COLORS.green,
    position: 'absolute',
    top: -20,
  },
  listeningText: {
    fontFamily: MONO_FONT,
    fontSize: 16,
    color: COLORS.green,
    fontWeight: '700',
    letterSpacing: 2,
  },
  listeningSubText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: COLORS.whiteDim,
    marginTop: 4,
  },

  // Processing
  processingContainer: {
    alignItems: 'center',
    marginVertical: 24,
  },
  processingSpinner: {
    width: 60,
    height: 60,
    marginBottom: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  processingDot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.amber,
  },
  processingText: {
    fontFamily: MONO_FONT,
    fontSize: 14,
    color: COLORS.amber,
    fontWeight: '700',
    letterSpacing: 2,
  },
  processingSubText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: COLORS.whiteDim,
    marginTop: 4,
    textAlign: 'center',
  },

  // Spectrum
  spectrumContainer: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgCardBorder,
    borderRadius: 6,
    padding: 12,
    marginBottom: 12,
  },
  spectrumHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  spectrumTitle: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: COLORS.green,
    letterSpacing: 1,
  },
  spectrumSubtitle: {
    fontFamily: MONO_FONT,
    fontSize: 8,
    color: COLORS.whiteDim,
    letterSpacing: 1,
  },
  spectrumGraph: {
    height: 100,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 2,
  },
  spectrumBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 80,
    gap: 1,
    paddingHorizontal: 2,
  },
  spectrumBar: {
    height: 80,
    borderRadius: 0.5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  axisLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  axisLabel: {
    fontFamily: MONO_FONT,
    fontSize: 7,
    color: COLORS.whiteDim,
    letterSpacing: 0.5,
  },
  anomalyMarker: {
    position: 'absolute',
    top: 0,
    bottom: 20,
    alignItems: 'center',
  },
  anomalyLine: {
    width: 1,
    flex: 1,
    backgroundColor: COLORS.red,
  },
  anomalyLabel: {
    fontFamily: MONO_FONT,
    fontSize: 7,
    color: COLORS.red,
    fontWeight: '700',
    marginTop: 1,
  },

  // Diagnosis Card
  diagnosisCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.red,
    borderRadius: 6,
    padding: 16,
    marginBottom: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  alertIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  alertTextContainer: {
    flex: 1,
  },
  alertTitle: {
    fontFamily: MONO_FONT,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.red,
    letterSpacing: 0.5,
  },
  severityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  severityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  severityText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: COLORS.red,
    fontWeight: '700',
    letterSpacing: 2,
  },

  // Confidence
  confidenceContainer: {
    marginBottom: 16,
  },
  confidenceLabel: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: COLORS.whiteDim,
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  confidenceBarBg: {
    height: 8,
    backgroundColor: COLORS.redDim,
    borderRadius: 4,
    overflow: 'hidden',
    position: 'relative',
  },
  confidenceBarFill: {
    height: '100%',
    backgroundColor: COLORS.red,
    borderRadius: 4,
    shadowColor: COLORS.red,
    shadowOpacity: 0.6,
    shadowRadius: 6,
  },
  confidenceMarkers: {
    ...StyleSheet.absoluteFillObject,
  },
  confidenceMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: COLORS.bg,
    opacity: 0.4,
  },
  confidenceValue: {
    fontFamily: MONO_FONT,
    fontSize: 28,
    fontWeight: '700',
    color: COLORS.red,
    marginTop: 4,
  },
  confidenceUnit: {
    fontSize: 14,
    color: COLORS.whiteDim,
  },

  // Data grid
  dataGrid: {
    borderTopWidth: 1,
    borderTopColor: COLORS.bgCardBorder,
    paddingTop: 12,
    marginBottom: 12,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgCardBorder,
  },
  dataLabel: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: COLORS.whiteDim,
    letterSpacing: 1,
  },
  dataValue: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: COLORS.white,
    fontWeight: '600',
  },
  dataValueAccent: {
    color: COLORS.amber,
  },

  // Recommendation
  recommendationBox: {
    backgroundColor: COLORS.redDim,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.red,
    padding: 10,
    borderRadius: 2,
  },
  recommendationLabel: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: COLORS.red,
    letterSpacing: 1,
    marginBottom: 4,
  },
  recommendationText: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: COLORS.white,
    lineHeight: 16,
  },

  // Reset button
  resetButton: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderWidth: 1,
    borderColor: COLORS.cyan,
    borderRadius: 4,
    backgroundColor: COLORS.cyanGlow,
    marginBottom: 12,
  },
  resetButtonText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    color: COLORS.cyan,
    fontWeight: '700',
    letterSpacing: 2,
  },

  // Footer
  footer: {
    paddingVertical: 12,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.bgCardBorder,
  },
  footerText: {
    fontFamily: MONO_FONT,
    fontSize: 8,
    color: COLORS.whiteDim,
    letterSpacing: 1.5,
  },
});

export default AudioDiagnose;