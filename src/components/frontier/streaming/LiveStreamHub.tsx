// src/components/frontier/streaming/LiveStreamHub.tsx
// ─────────────────────────────────────────────────────
// "Mission Control" HUD for Remote Live Inspections
// ─────────────────────────────────────────────────────

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Dimensions,
  TouchableOpacity,
  Platform,
} from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Theme Constants ──────────────────────────────────
const THEME = {
  bgPrimary: '#020617',
  bgSecondary: '#0f172a',
  bgTertiary: '#1e293b',
  accentCyan: '#00f0ff',
  accentRed: '#ff003c',
  accentGreen: '#00ff88',
  accentAmber: '#ffaa00',
  accentPurple: '#a855f7',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted: '#475569',
  gridLine: 'rgba(0, 240, 255, 0.06)',
  gridLineBright: 'rgba(0, 240, 255, 0.12)',
  hudBorder: 'rgba(0, 240, 255, 0.25)',
  hudBg: 'rgba(2, 6, 23, 0.85)',
  scanline: 'rgba(0, 240, 255, 0.03)',
};

// ── Telemetry Data Generator ─────────────────────────
const generateTelemetry = () => ({
  bitrate: (3.8 + Math.random() * 1.4).toFixed(1),
  latency: Math.floor(8 + Math.random() * 18),
  battery: Math.max(10, Math.floor(82 + Math.random() * 6)),
  fps: Math.floor(28 + Math.random() * 4),
  signal: Math.floor(85 + Math.random() * 15),
  temperature: (21 + Math.random() * 4).toFixed(1),
  resolution: '1920×1080',
  codec: 'H.265',
  uptime: '01:23:47',
});

// ── Client Requests Pool ─────────────────────────────
const CLIENT_REQUESTS = [
  'Zoom in on Flange B',
  'Pan left to valve assembly',
  'Check weld seam on joint C4',
  'Increase exposure — too dark',
  'Hold position for screenshot',
  'Rotate 45° clockwise',
  'Focus on corrosion near bracket',
  'Switch to thermal overlay',
  'Mark this frame for report',
  'Confirm serial number visibility',
];

// ── Blinking Dot Component ───────────────────────────
const BlinkingDot: React.FC<{ color?: string; size?: number }> = ({
  color = THEME.accentRed,
  size = 8,
}) => {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.15,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    blink.start();
    return () => blink.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity,
        },
      ]}
    />
  );
};

// ── Scanline Overlay ─────────────────────────────────
const ScanlineOverlay: React.FC = () => {
  const translateY = useRef(new Animated.Value(-SCREEN_HEIGHT)).current;

  useEffect(() => {
    const scan = Animated.loop(
      Animated.timing(translateY, {
        toValue: SCREEN_HEIGHT,
        duration: 4000,
        useNativeDriver: true,
      })
    );
    scan.start();
    return () => scan.stop();
  }, [translateY]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          transform: [{ translateY }],
        },
      ]}
    >
      <View
        style={{
          height: 2,
          width: '100%',
          backgroundColor: THEME.accentCyan,
          opacity: 0.3,
          shadowColor: THEME.accentCyan,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.8,
          shadowRadius: 10,
          elevation: 5,
        }}
      />
      <View
        style={{
          height: 40,
          width: '100%',
          backgroundColor: THEME.accentCyan,
          opacity: 0.02,
        }}
      />
    </Animated.View>
  );
};

// ── Camera Grid Placeholder ──────────────────────────
const CameraPlaceholder: React.FC = () => {
  const GRID_COLS = 16;
  const GRID_ROWS = 12;

  return (
    <View style={styles.cameraContainer}>
      {/* Dark base */}
      <View style={styles.cameraBase} />

      {/* Grid Lines - Vertical */}
      {Array.from({ length: GRID_COLS + 1 }).map((_, i) => (
        <View
          key={`v-${i}`}
          style={[
            styles.gridLineVertical,
            {
              left: `${(i / GRID_COLS) * 100}%`,
              backgroundColor:
                i === Math.floor(GRID_COLS / 2)
                  ? THEME.gridLineBright
                  : THEME.gridLine,
            },
          ]}
        />
      ))}

      {/* Grid Lines - Horizontal */}
      {Array.from({ length: GRID_ROWS + 1 }).map((_, i) => (
        <View
          key={`h-${i}`}
          style={[
            styles.gridLineHorizontal,
            {
              top: `${(i / GRID_ROWS) * 100}%`,
              backgroundColor:
                i === Math.floor(GRID_ROWS / 2)
                  ? THEME.gridLineBright
                  : THEME.gridLine,
            },
          ]}
        />
      ))}

      {/* Center Crosshair */}
      <View style={styles.crosshairContainer}>
        <View style={styles.crosshairH} />
        <View style={styles.crosshairV} />
        <View style={styles.crosshairCenter} />
      </View>

      {/* Corner Brackets */}
      <View style={[styles.cornerBracket, styles.cornerTL]} />
      <View style={[styles.cornerBracket, styles.cornerTR]} />
      <View style={[styles.cornerBracket, styles.cornerBL]} />
      <View style={[styles.cornerBracket, styles.cornerBR]} />

      {/* "NO SIGNAL" text if needed — we show grid as "connected" */}
      <View style={styles.cameraLabel}>
        <Text style={styles.cameraLabelText}>CAM-01 // MAIN FEED</Text>
      </View>

      {/* Scanline */}
      <ScanlineOverlay />
    </View>
  );
};

// ── Telemetry Row ────────────────────────────────────
const TelemetryItem: React.FC<{
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  warn?: boolean;
}> = ({ label, value, unit = '', color = THEME.accentCyan, warn = false }) => (
  <View style={styles.telemetryItem}>
    <Text style={styles.telemetryLabel}>{label}</Text>
    <View style={styles.telemetryValueRow}>
      <Text
        style={[
          styles.telemetryValue,
          { color: warn ? THEME.accentAmber : color },
        ]}
      >
        {value}
      </Text>
      {unit ? (
        <Text style={styles.telemetryUnit}>{unit}</Text>
      ) : null}
    </View>
  </View>
);

// ── Toast Notification ───────────────────────────────
const ClientRequestToast: React.FC<{
  message: string;
  visible: boolean;
  onDismiss: () => void;
}> = ({ message, visible, onDismiss }) => {
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          tension: 80,
          friction: 12,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -120,
            duration: 400,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }),
        ]).start(() => onDismiss());
      }, 4500);

      return () => clearTimeout(timer);
    }
  }, [visible, translateY, opacity, onDismiss]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.toastContainer,
        {
          transform: [{ translateY }],
          opacity,
        },
      ]}
    >
      <View style={styles.toastInner}>
        <View style={styles.toastHeader}>
          <BlinkingDot color={THEME.accentAmber} size={6} />
          <Text style={styles.toastTitle}>CLIENT REQUEST</Text>
          <Text style={styles.toastTimestamp}>
            {new Date().toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </Text>
        </View>
        <Text style={styles.toastMessage}>"{message}"</Text>
        <View style={styles.toastActions}>
          <TouchableOpacity style={styles.toastBtn} onPress={onDismiss}>
            <Text style={styles.toastBtnText}>ACKNOWLEDGE</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

// ── Signal Bars ──────────────────────────────────────
const SignalBars: React.FC<{ strength: number }> = ({ strength }) => {
  const bars = 5;
  const activeBars = Math.ceil((strength / 100) * bars);

  return (
    <View style={styles.signalBarsContainer}>
      {Array.from({ length: bars }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.signalBar,
            {
              height: 6 + i * 3,
              backgroundColor:
                i < activeBars ? THEME.accentGreen : THEME.textMuted,
              opacity: i < activeBars ? 1 : 0.3,
            },
          ]}
        />
      ))}
    </View>
  );
};

// ══════════════════════════════════════════════════════
// ██ MAIN COMPONENT: LiveStreamHub
// ══════════════════════════════════════════════════════
interface LiveStreamHubProps {
  onClose?: () => void;
}

const LiveStreamHub: React.FC<LiveStreamHubProps> = ({ onClose }) => {
  const [telemetry, setTelemetry] = useState(generateTelemetry());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [toastVisible, setToastVisible] = useState(false);
  const [currentRequest, setCurrentRequest] = useState(CLIENT_REQUESTS[0]);
  const requestIndexRef = useRef(0);
  const pulseAnim = useRef(new Animated.Value(0.5)).current;

  // ── Update telemetry every second ──
  useEffect(() => {
    const interval = setInterval(() => {
      setTelemetry(generateTelemetry());
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // ── Trigger client requests periodically ──
  useEffect(() => {
    const showRequest = () => {
      requestIndexRef.current =
        (requestIndexRef.current + 1) % CLIENT_REQUESTS.length;
      setCurrentRequest(CLIENT_REQUESTS[requestIndexRef.current]);
      setToastVisible(true);
    };

    // First request after 3 seconds
    const initialTimer = setTimeout(showRequest, 3000);
    // Subsequent requests every 12 seconds
    const interval = setInterval(showRequest, 12000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  // ── Border pulse animation ──
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.5,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const formatUptime = useCallback((seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const getBatteryColor = (level: number): string => {
    if (level > 50) return THEME.accentGreen;
    if (level > 20) return THEME.accentAmber;
    return THEME.accentRed;
  };

  return (
    <View style={styles.container}>
      {/* ── Top Status Bar ────────────────────────── */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <View style={styles.liveIndicator}>
            <BlinkingDot color={THEME.accentRed} size={8} />
            <Text style={styles.liveText}>LIVE</Text>
            <View style={styles.recBadge}>
              <Text style={styles.recText}>● REC</Text>
            </View>
          </View>
          <Text style={styles.uptimeText}>{formatUptime(elapsedSeconds)}</Text>
        </View>

        <View style={styles.topBarCenter}>
          <Text style={styles.sessionId}>SESSION: FLD-2024-0847</Text>
        </View>

        <View style={styles.topBarRight}>
          <View style={styles.viewerInfo}>
            <View style={styles.viewerDot} />
            <Text style={styles.viewerText}>Viewer: London HQ</Text>
          </View>
          <SignalBars strength={Number(telemetry.signal)} />
        </View>
      </View>

      {/* ── Camera Feed Area ──────────────────────── */}
      <View style={styles.feedArea}>
        <CameraPlaceholder />

        {/* ── Left Telemetry Panel ──────────────── */}
        <Animated.View
          style={[
            styles.telemetryPanelLeft,
            { opacity: pulseAnim },
          ]}
        >
          <View style={styles.telemetryPanelInner}>
            <Text style={styles.panelTitle}>◆ STREAM</Text>
            <TelemetryItem
              label="BITRATE"
              value={telemetry.bitrate}
              unit="Mbps"
            />
            <TelemetryItem
              label="LATENCY"
              value={telemetry.latency}
              unit="ms"
              warn={Number(telemetry.latency) > 20}
            />
            <TelemetryItem
              label="FPS"
              value={telemetry.fps}
              unit="f/s"
            />
            <TelemetryItem
              label="CODEC"
              value={telemetry.codec}
              color={THEME.textSecondary}
            />
          </View>
        </Animated.View>

        {/* ── Right Telemetry Panel ─────────────── */}
        <Animated.View
          style={[
            styles.telemetryPanelRight,
            { opacity: pulseAnim },
          ]}
        >
          <View style={styles.telemetryPanelInner}>
            <Text style={styles.panelTitle}>◆ DEVICE</Text>
            <TelemetryItem
              label="BATTERY"
              value={`${telemetry.battery}%`}
              color={getBatteryColor(Number(telemetry.battery))}
            />
            <TelemetryItem
              label="TEMP"
              value={telemetry.temperature}
              unit="°C"
              warn={Number(telemetry.temperature) > 24}
            />
            <TelemetryItem
              label="SIGNAL"
              value={`${telemetry.signal}%`}
              color={THEME.accentGreen}
            />
            <TelemetryItem
              label="RES"
              value={telemetry.resolution}
              color={THEME.textSecondary}
            />
          </View>
        </Animated.View>
      </View>

      {/* ── Bottom Controls Bar ───────────────────── */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomBarInner}>
          {/* Status Indicators */}
          <View style={styles.statusRow}>
            <View style={styles.statusChip}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: THEME.accentGreen },
                ]}
              />
              <Text style={styles.statusChipText}>CONNECTED</Text>
            </View>
            <View style={styles.statusChip}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: THEME.accentCyan },
                ]}
              />
              <Text style={styles.statusChipText}>ENCRYPTED</Text>
            </View>
            <View style={styles.statusChip}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: THEME.accentAmber },
                ]}
              />
              <Text style={styles.statusChipText}>RECORDING</Text>
            </View>
          </View>

          {/* Control Buttons */}
          <View style={styles.controlsRow}>
            <TouchableOpacity style={styles.controlBtn}>
              <Text style={styles.controlBtnIcon}>📸</Text>
              <Text style={styles.controlBtnLabel}>CAPTURE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlBtn}>
              <Text style={styles.controlBtnIcon}>🔦</Text>
              <Text style={styles.controlBtnLabel}>TORCH</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlBtn}>
              <Text style={styles.controlBtnIcon}>🔍</Text>
              <Text style={styles.controlBtnLabel}>ZOOM</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.controlBtn}>
              <Text style={styles.controlBtnIcon}>📐</Text>
              <Text style={styles.controlBtnLabel}>MEASURE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, styles.controlBtnDanger]}
              onPress={onClose}
            >
              <Text style={styles.controlBtnIcon}>⏹</Text>
              <Text
                style={[
                  styles.controlBtnLabel,
                  { color: THEME.accentRed },
                ]}
              >
                END
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Client Request Toast ──────────────────── */}
      <ClientRequestToast
        message={currentRequest}
        visible={toastVisible}
        onDismiss={() => setToastVisible(false)}
      />
    </View>
  );
};

// ══════════════════════════════════════════════════════
// ██ STYLES
// ══════════════════════════════════════════════════════
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bgPrimary,
  },

  // ── Top Bar ────────────────────────────────────
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 12,
    paddingBottom: 10,
    backgroundColor: THEME.hudBg,
    borderBottomWidth: 1,
    borderBottomColor: THEME.hudBorder,
  },
  topBarLeft: {
    flexDirection: 'column',
    gap: 4,
  },
  topBarCenter: {
    alignItems: 'center',
  },
  topBarRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  liveText: {
    color: THEME.accentRed,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
  },
  recBadge: {
    backgroundColor: 'rgba(255, 0, 60, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 0, 60, 0.3)',
  },
  recText: {
    color: THEME.accentRed,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  uptimeText: {
    color: THEME.textSecondary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  sessionId: {
    color: THEME.textMuted,
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
  viewerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  viewerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: THEME.accentGreen,
  },
  viewerText: {
    color: THEME.textSecondary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // ── Signal Bars ────────────────────────────────
  signalBarsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    height: 18,
  },
  signalBar: {
    width: 4,
    borderRadius: 1,
  },

  // ── Camera Feed ────────────────────────────────
  feedArea: {
    flex: 1,
    position: 'relative',
  },
  cameraContainer: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  cameraBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#050d1a',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  crosshairContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 60,
    height: 60,
    marginLeft: -30,
    marginTop: -30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crosshairH: {
    position: 'absolute',
    width: 60,
    height: 1,
    backgroundColor: 'rgba(0, 240, 255, 0.4)',
  },
  crosshairV: {
    position: 'absolute',
    width: 1,
    height: 60,
    backgroundColor: 'rgba(0, 240, 255, 0.4)',
  },
  crosshairCenter: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: THEME.accentCyan,
    backgroundColor: 'transparent',
  },
  cornerBracket: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderColor: THEME.accentCyan,
  },
  cornerTL: {
    top: 16,
    left: 16,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  cornerTR: {
    top: 16,
    right: 16,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  cornerBL: {
    bottom: 16,
    left: 16,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  cornerBR: {
    bottom: 16,
    right: 16,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
  cameraLabel: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  cameraLabelText: {
    color: 'rgba(0, 240, 255, 0.35)',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 3,
  },

  // ── Telemetry Panels ──────────────────────────
  telemetryPanelLeft: {
    position: 'absolute',
    left: 8,
    top: '15%',
    width: 110,
  },
  telemetryPanelRight: {
    position: 'absolute',
    right: 8,
    top: '15%',
    width: 110,
  },
  telemetryPanelInner: {
    backgroundColor: THEME.hudBg,
    borderWidth: 1,
    borderColor: THEME.hudBorder,
    borderRadius: 6,
    padding: 10,
    gap: 10,
  },
  panelTitle: {
    color: THEME.accentCyan,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
    marginBottom: 2,
  },
  telemetryItem: {
    gap: 2,
  },
  telemetryLabel: {
    color: THEME.textMuted,
    fontSize: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
  telemetryValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  telemetryValue: {
    color: THEME.accentCyan,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  telemetryUnit: {
    color: THEME.textMuted,
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // ── Bottom Bar ─────────────────────────────────
  bottomBar: {
    backgroundColor: THEME.hudBg,
    borderTopWidth: 1,
    borderTopColor: THEME.hudBorder,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  bottomBarInner: {
    gap: 12,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0, 240, 255, 0.05)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.1)',
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusChipText: {
    color: THEME.textSecondary,
    fontSize: 9,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  controlBtn: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 240, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.12)',
    minWidth: 60,
  },
  controlBtnDanger: {
    backgroundColor: 'rgba(255, 0, 60, 0.08)',
    borderColor: 'rgba(255, 0, 60, 0.2)',
  },
  controlBtnIcon: {
    fontSize: 18,
  },
  controlBtnLabel: {
    color: THEME.textSecondary,
    fontSize: 8,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },

  // ── Toast ──────────────────────────────────────
  toastContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 110 : 70,
    left: 16,
    right: 16,
    zIndex: 100,
  },
  toastInner: {
    backgroundColor: 'rgba(2, 6, 23, 0.95)',
    borderWidth: 1,
    borderColor: THEME.accentAmber,
    borderRadius: 10,
    padding: 14,
    gap: 8,
    shadowColor: THEME.accentAmber,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  toastHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toastTitle: {
    color: THEME.accentAmber,
    fontSize: 10,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
    flex: 1,
  },
  toastTimestamp: {
    color: THEME.textMuted,
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  toastMessage: {
    color: THEME.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  toastActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  toastBtn: {
    backgroundColor: 'rgba(255, 170, 0, 0.15)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 170, 0, 0.3)',
  },
  toastBtnText: {
    color: THEME.accentAmber,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
});

export default LiveStreamHub;