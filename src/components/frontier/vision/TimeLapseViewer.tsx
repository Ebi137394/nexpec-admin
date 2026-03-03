import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  GestureResponderEvent,
  PanResponder,
  PanResponderGestureState,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

// ─── CONSTANTS ────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VIEWER_WIDTH = SCREEN_WIDTH - 40;
const VIEWER_HEIGHT = 260;
const HANDLE_WIDTH = 36;
const HALF_HANDLE = HANDLE_WIDTH / 2;

const COLORS = {
  bg: '#020617',
  bgCard: '#0a1628',
  bgCardBorder: '#0e2a4d',
  cyan: '#00f0ff',
  cyanDim: '#00f0ff40',
  cyanGlow: '#00f0ff20',
  green: '#00ff88',
  greenDim: '#00ff8830',
  red: '#ff003c',
  redBright: '#ff2d55',
  redDim: '#ff003c30',
  redGlow: '#ff003c60',
  amber: '#ffaa00',
  amberDim: '#ffaa0040',
  white: '#e0e6f0',
  whiteDim: '#e0e6f060',
  gridLine: '#0e2a4d40',
  pipeBase: '#1a3050',
  pipe2020: '#2a5080',
  pipe2024: '#1a3050',
  corrosion: '#8b4513',
  corrosionLight: '#b8651a',
  rust: '#a0522d',
  metal: '#4a6a8a',
};

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

// ─── MOCK CORROSION ZONES ────────────────────────────────
// These define where "corrosion" exists on the 2024 scan
interface CorrosionZone {
  x: number; // % from left
  y: number; // % from top
  width: number; // % width
  height: number; // % height
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  depth: string;
}

const CORROSION_ZONES: CorrosionZone[] = [
  {
    x: 28,
    y: 35,
    width: 18,
    height: 22,
    severity: 'CRITICAL',
    depth: '4.2mm',
  },
  {
    x: 55,
    y: 50,
    width: 12,
    height: 15,
    severity: 'HIGH',
    depth: '2.8mm',
  },
  {
    x: 72,
    y: 25,
    width: 10,
    height: 12,
    severity: 'MEDIUM',
    depth: '1.4mm',
  },
  {
    x: 15,
    y: 60,
    width: 8,
    height: 10,
    severity: 'LOW',
    depth: '0.6mm',
  },
];

// ─── MOCK STRUCTURAL ELEMENTS (for the pipe visualization) ─
interface PipeElement {
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'pipe' | 'flange' | 'weld' | 'joint';
}

const PIPE_ELEMENTS: PipeElement[] = [
  { x: 5, y: 38, width: 90, height: 24, type: 'pipe' },
  { x: 25, y: 30, width: 6, height: 40, type: 'flange' },
  { x: 60, y: 30, width: 6, height: 40, type: 'flange' },
  { x: 42, y: 42, width: 2, height: 16, type: 'weld' },
  { x: 80, y: 42, width: 2, height: 16, type: 'weld' },
];

// ─── PREDICTION DATA ────────────────────────────────────
const PREDICTION = {
  growthRate: '0.4mm/yr',
  criticalFailure: '6 Months',
  wallThickness: '12.1mm → 7.9mm',
  integrityScore: 62,
  lastInspection: '2024-01-15',
  nextRequired: '2024-07-15',
  method: 'ML Regression v2.1',
  dataSources: '847 scan points',
};

// ─── COMPONENT ────────────────────────────────────────────
const TimeLapseViewer: React.FC = () => {
  const [sliderPosition, setSliderPosition] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const pan = useRef(new Animated.Value(VIEWER_WIDTH * 0.5)).current;

  // Corrosion pulsing
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const scanLineAnim = useRef(new Animated.Value(0)).current;
  const headerGlow = useRef(new Animated.Value(0.5)).current;
  const dataFade = useRef(new Animated.Value(1)).current;

  // Zone pulse animations (one per zone)
  const zonePulses = useRef(
    CORROSION_ZONES.map(() => new Animated.Value(0))
  ).current;

  // ─── PULSE ANIMATIONS ────────────────────────────────
  useEffect(() => {
    // Corrosion zone pulsing
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();

    // Scan line
    const scanLoop = Animated.loop(
      Animated.timing(scanLineAnim, {
        toValue: 1,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    scanLoop.start();

    // Header glow
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(headerGlow, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(headerGlow, {
          toValue: 0.4,
          duration: 2000,
          useNativeDriver: true,
        }),
      ])
    );
    glowLoop.start();

    // Staggered zone pulses
    const zoneAnims = zonePulses.map((anim, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 300),
          Animated.timing(anim, {
            toValue: 1,
            duration: 800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(anim, {
            toValue: 0.2,
            duration: 800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ])
      )
    );
    zoneAnims.forEach((a) => a.start());

    return () => {
      loop.stop();
      scanLoop.stop();
      glowLoop.stop();
      zoneAnims.forEach((a) => a.stop());
    };
  }, []);

  // ─── PAN RESPONDER ────────────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (_: GestureResponderEvent, _gs: PanResponderGestureState) => {
        setIsDragging(true);
      },
      onPanResponderMove: (_: GestureResponderEvent, gs: PanResponderGestureState) => {
        // We get the absolute position from moveX, offset by container left margin
        const containerLeft = 20; // paddingHorizontal
        let x = gs.moveX - containerLeft;
        x = Math.max(0, Math.min(x, VIEWER_WIDTH));
        pan.setValue(x);
        setSliderPosition(x / VIEWER_WIDTH);
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
      },
    })
  ).current;

  // ─── COMPUTED VALUES ──────────────────────────────────
  const yearLabel = useCallback(
    (pos: number) => {
      const year = 2020 + pos * 4;
      return year.toFixed(1);
    },
    []
  );

  const corrosionIntensity = sliderPosition; // 0 = no corrosion, 1 = full

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'CRITICAL':
        return COLORS.red;
      case 'HIGH':
        return COLORS.redBright;
      case 'MEDIUM':
        return COLORS.amber;
      case 'LOW':
        return COLORS.green;
      default:
        return COLORS.white;
    }
  };

  // ─── RENDER: CORNER BRACKETS ──────────────────────────
  const renderCornerBrackets = (color: string = COLORS.cyan) => (
    <>
      <View style={[styles.cornerBracket, styles.cornerTL]}>
        <View style={[styles.cornerH, { backgroundColor: color }]} />
        <View style={[styles.cornerV, { backgroundColor: color }]} />
      </View>
      <View style={[styles.cornerBracket, styles.cornerTR]}>
        <View style={[styles.cornerH, { backgroundColor: color }]} />
        <View style={[styles.cornerV, { backgroundColor: color, alignSelf: 'flex-end' }]} />
      </View>
      <View style={[styles.cornerBracket, styles.cornerBL]}>
        <View style={[styles.cornerV, { backgroundColor: color }]} />
        <View style={[styles.cornerH, { backgroundColor: color }]} />
      </View>
      <View style={[styles.cornerBracket, styles.cornerBR]}>
        <View style={[styles.cornerV, { backgroundColor: color, alignSelf: 'flex-end' }]} />
        <View style={[styles.cornerH, { backgroundColor: color }]} />
      </View>
    </>
  );

  // ─── RENDER: PIPE VISUALIZATION ───────────────────────
  const renderPipeVisualization = () => (
    <View style={styles.pipeContainer}>
      {/* Grid overlay */}
      <View style={styles.gridOverlay} pointerEvents="none">
        {Array.from({ length: 6 }).map((_, i) => (
          <View
            key={`h-${i}`}
            style={[
              styles.gridH,
              { top: `${(i + 1) * 14.3}%` },
            ]}
          />
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <View
            key={`v-${i}`}
            style={[
              styles.gridV,
              { left: `${(i + 1) * 9.1}%` },
            ]}
          />
        ))}
      </View>

      {/* Base pipe structure */}
      {PIPE_ELEMENTS.map((el, i) => (
        <View
          key={`pipe-${i}`}
          style={[
            styles.pipeElement,
            {
              left: `${el.x}%`,
              top: `${el.y}%`,
              width: `${el.width}%`,
              height: `${el.height}%`,
              backgroundColor:
                el.type === 'pipe'
                  ? COLORS.pipe2020
                  : el.type === 'flange'
                  ? COLORS.metal
                  : el.type === 'weld'
                  ? COLORS.amber
                  : COLORS.metal,
              borderColor:
                el.type === 'weld'
                  ? COLORS.amberDim
                  : COLORS.cyanDim,
              borderWidth: el.type === 'weld' ? 1 : 0.5,
              borderRadius: el.type === 'pipe' ? 2 : el.type === 'flange' ? 3 : 1,
            },
          ]}
        />
      ))}

      {/* Pipe surface detail lines (2020 scan) */}
      {Array.from({ length: 12 }).map((_, i) => (
        <View
          key={`detail-${i}`}
          style={[
            styles.pipeDetail,
            {
              left: `${8 + i * 7.5}%`,
              top: '43%',
              height: '14%',
              opacity: 0.3,
            },
          ]}
        />
      ))}

      {/* Measurement markers */}
      <View style={[styles.measureMarker, { left: '10%', top: '28%' }]}>
        <Text style={styles.measureText}>◇ A1</Text>
      </View>
      <View style={[styles.measureMarker, { left: '45%', top: '28%' }]}>
        <Text style={styles.measureText}>◇ A2</Text>
      </View>
      <View style={[styles.measureMarker, { left: '75%', top: '28%' }]}>
        <Text style={styles.measureText}>◇ A3</Text>
      </View>

      {/* Corrosion zones - opacity tied to slider position */}
      {CORROSION_ZONES.map((zone, i) => {
        const zoneOpacity = Math.max(0, (corrosionIntensity - 0.2) * 1.25);
        const color = getSeverityColor(zone.severity);

        return (
          <Animated.View
            key={`corrosion-${i}`}
            style={[
              styles.corrosionZone,
              {
                left: `${zone.x}%`,
                top: `${zone.y}%`,
                width: `${zone.width}%`,
                height: `${zone.height}%`,
                opacity: Animated.multiply(
                  zonePulses[i],
                  new Animated.Value(zoneOpacity)
                ),
                borderColor: color,
                backgroundColor: `${color}20`,
              },
            ]}
          >
            {/* Inner glow */}
            <Animated.View
              style={[
                styles.corrosionInner,
                {
                  backgroundColor: `${color}30`,
                  opacity: pulseAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.3, 0.8],
                  }),
                },
              ]}
            />

            {/* Corrosion pattern dots */}
            {zone.severity === 'CRITICAL' &&
              Array.from({ length: 6 }).map((_, j) => (
                <View
                  key={`dot-${j}`}
                  style={[
                    styles.corrosionDot,
                    {
                      left: `${15 + Math.random() * 70}%`,
                      top: `${15 + Math.random() * 70}%`,
                      width: 3 + Math.random() * 4,
                      height: 3 + Math.random() * 4,
                      backgroundColor: COLORS.corrosion,
                      opacity: 0.7,
                    },
                  ]}
                />
              ))}

            {/* Depth label */}
            {zoneOpacity > 0.5 && (
              <View style={styles.depthLabel}>
                <Text
                  style={[styles.depthText, { color }]}
                >
                  {zone.depth}
                </Text>
              </View>
            )}
          </Animated.View>
        );
      })}

      {/* Scan line effect */}
      <Animated.View
        style={[
          styles.viewerScanLine,
          {
            transform: [
              {
                translateY: scanLineAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-10, VIEWER_HEIGHT + 10],
                }),
              },
            ],
          },
        ]}
        pointerEvents="none"
      />
    </View>
  );

  // ─── RENDER: SLIDER ───────────────────────────────────
  const renderSlider = () => (
    <View style={styles.sliderTrack}>
      {/* 2020 label */}
      <View style={styles.yearLabelContainer}>
        <Text style={styles.yearLabel}>2020</Text>
        <Text style={styles.yearSublabel}>BASELINE SCAN</Text>
      </View>

      {/* The clip mask effect: right side darkened to simulate transition */}
      <Animated.View
        style={[
          styles.sliderOverlay2024,
          {
            left: pan.interpolate({
              inputRange: [0, VIEWER_WIDTH],
              outputRange: [0, VIEWER_WIDTH],
              extrapolate: 'clamp',
            }),
            width: pan.interpolate({
              inputRange: [0, VIEWER_WIDTH],
              outputRange: [VIEWER_WIDTH, 0],
              extrapolate: 'clamp',
            }),
          },
        ]}
      />

      {/* Draggable handle */}
      <Animated.View
        style={[
          styles.handleContainer,
          {
            transform: [
              {
                translateX: Animated.subtract(pan, new Animated.Value(HALF_HANDLE)),
              },
            ],
          },
        ]}
        {...panResponder.panHandlers}
      >
        {/* Handle vertical line */}
        <View style={styles.handleLine} />

        {/* Handle grip */}
        <View
          style={[
            styles.handleGrip,
            isDragging && styles.handleGripActive,
          ]}
        >
          <View style={styles.handleArrows}>
            <Text style={styles.handleArrowText}>◂</Text>
            <View style={styles.handleDot} />
            <Text style={styles.handleArrowText}>▸</Text>
          </View>
        </View>

        {/* Year indicator tooltip */}
        <View style={styles.yearTooltip}>
          <Text style={styles.yearTooltipText}>
            {yearLabel(sliderPosition)}
          </Text>
        </View>
      </Animated.View>

      {/* 2024 label */}
      <View style={[styles.yearLabelContainer, styles.yearLabelRight]}>
        <Text style={styles.yearLabel}>2024</Text>
        <Text style={styles.yearSublabel}>CURRENT SCAN</Text>
      </View>
    </View>
  );

  // ─── RENDER: PREDICTION HUD ───────────────────────────
  const renderPredictionHUD = () => (
    <Animated.View style={[styles.hudContainer, { opacity: dataFade }]}>
      {renderCornerBrackets(COLORS.amber)}

      {/* Main prediction */}
      <View style={styles.hudHeader}>
        <Text style={styles.hudHeaderTag}>▸ PREDICTIVE ANALYSIS</Text>
        <Text style={styles.hudMethod}>{PREDICTION.method}</Text>
      </View>

      {/* Primary metrics row */}
      <View style={styles.hudMetricsRow}>
        <View style={styles.hudMetricPrimary}>
          <Text style={styles.hudMetricLabel}>GROWTH RATE</Text>
          <Text style={styles.hudMetricValueLarge}>
            {PREDICTION.growthRate}
          </Text>
        </View>
        <View style={styles.hudMetricDivider} />
        <View style={styles.hudMetricPrimary}>
          <Text style={styles.hudMetricLabel}>CRITICAL FAILURE</Text>
          <Text style={[styles.hudMetricValueLarge, { color: COLORS.red }]}>
            {PREDICTION.criticalFailure}
          </Text>
        </View>
      </View>

      {/* Integrity gauge */}
      <View style={styles.integrityContainer}>
        <View style={styles.integrityHeader}>
          <Text style={styles.integrityLabel}>STRUCTURAL INTEGRITY</Text>
          <Text
            style={[
              styles.integrityValue,
              {
                color:
                  PREDICTION.integrityScore > 70
                    ? COLORS.green
                    : PREDICTION.integrityScore > 40
                    ? COLORS.amber
                    : COLORS.red,
              },
            ]}
          >
            {PREDICTION.integrityScore}%
          </Text>
        </View>
        <View style={styles.integrityBar}>
          <View
            style={[
              styles.integrityFill,
              {
                width: `${PREDICTION.integrityScore}%`,
                backgroundColor:
                  PREDICTION.integrityScore > 70
                    ? COLORS.green
                    : PREDICTION.integrityScore > 40
                    ? COLORS.amber
                    : COLORS.red,
              },
            ]}
          />
          {/* Threshold markers */}
          <View style={[styles.thresholdMarker, { left: '40%' }]}>
            <View style={[styles.thresholdLine, { backgroundColor: COLORS.red }]} />
          </View>
          <View style={[styles.thresholdMarker, { left: '70%' }]}>
            <View style={[styles.thresholdLine, { backgroundColor: COLORS.amber }]} />
          </View>
        </View>
        <View style={styles.integrityLabels}>
          <Text style={[styles.thresholdLabel, { color: COLORS.red }]}>
            CRITICAL
          </Text>
          <Text style={[styles.thresholdLabel, { color: COLORS.amber }]}>
            WARNING
          </Text>
          <Text style={[styles.thresholdLabel, { color: COLORS.green }]}>
            NOMINAL
          </Text>
        </View>
      </View>

      {/* Data grid */}
      <View style={styles.hudDataGrid}>
        <HudDataRow
          label="WALL THICKNESS"
          value={PREDICTION.wallThickness}
        />
        <HudDataRow
          label="LAST INSPECTION"
          value={PREDICTION.lastInspection}
        />
        <HudDataRow
          label="NEXT REQUIRED"
          value={PREDICTION.nextRequired}
          accent
        />
        <HudDataRow
          label="DATA SOURCES"
          value={PREDICTION.dataSources}
        />
      </View>

      {/* Warning banner */}
      <Animated.View
        style={[
          styles.warningBanner,
          {
            opacity: pulseAnim.interpolate({
              inputRange: [0, 1],
              outputRange: [0.6, 1],
            }),
          },
        ]}
      >
        <Text style={styles.warningIcon}>⚠</Text>
        <Text style={styles.warningText}>
          Growth Rate: {PREDICTION.growthRate} | Critical Failure Predicted:{' '}
          {PREDICTION.criticalFailure}
        </Text>
      </Animated.View>
    </Animated.View>
  );

  // ─── RENDER: ZONE LEGEND ──────────────────────────────
  const renderZoneLegend = () => (
    <View style={styles.legendContainer}>
      <Text style={styles.legendTitle}>▸ DETECTED ZONES</Text>
      <View style={styles.legendGrid}>
        {CORROSION_ZONES.map((zone, i) => (
          <View key={i} style={styles.legendItem}>
            <View
              style={[
                styles.legendDot,
                { backgroundColor: getSeverityColor(zone.severity) },
              ]}
            />
            <Text style={styles.legendItemText}>
              Z{i + 1}: {zone.severity}
            </Text>
            <Text style={styles.legendDepth}>{zone.depth}</Text>
          </View>
        ))}
      </View>
    </View>
  );

  // ─── RENDER: TIMELINE BAR ─────────────────────────────
  const renderTimelineBar = () => {
    const markers = [2020, 2021, 2022, 2023, 2024];
    return (
      <View style={styles.timelineContainer}>
        <View style={styles.timelineLine} />
        {markers.map((year, i) => {
          const pos = i / (markers.length - 1);
          const isActive = sliderPosition >= pos - 0.05;
          return (
            <View
              key={year}
              style={[
                styles.timelineMarker,
                { left: `${pos * 100}%` },
              ]}
            >
              <View
                style={[
                  styles.timelineDot,
                  {
                    backgroundColor: isActive
                      ? COLORS.cyan
                      : COLORS.bgCardBorder,
                    shadowColor: isActive ? COLORS.cyan : 'transparent',
                    shadowOpacity: isActive ? 0.8 : 0,
                    shadowRadius: isActive ? 4 : 0,
                  },
                ]}
              />
              <Text
                style={[
                  styles.timelineYear,
                  isActive && { color: COLORS.cyan },
                ]}
              >
                {year}
              </Text>
            </View>
          );
        })}
        {/* Progress fill */}
        <View
          style={[
            styles.timelineProgress,
            { width: `${sliderPosition * 100}%` },
          ]}
        />
      </View>
    );
  };

  // ─── RENDER: MAIN ─────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <Animated.View style={[styles.header, { opacity: headerGlow }]}>
        <Text style={styles.headerTag}>SYS://VISION_TIMELAPSE</Text>
      </Animated.View>
      <Text style={styles.headerTitle}>4D Corrosion Time-Lapse</Text>
      <Text style={styles.headerSubtitle}>
        Temporal Defect Growth Analysis v2.1.0
      </Text>

      {/* ── Viewer ── */}
      <View style={styles.viewerFrame}>
        {renderCornerBrackets()}

        {/* The simulated pipe/structure images */}
        {renderPipeVisualization()}

        {/* The slider control */}
        {renderSlider()}

        {/* HUD overlay info */}
        <View style={styles.viewerHudTopLeft}>
          <Text style={styles.viewerHudText}>
            SCAN: {sliderPosition < 0.5 ? '2020' : '2024'}
          </Text>
          <Text style={styles.viewerHudText}>
            POS: {(sliderPosition * 100).toFixed(0)}%
          </Text>
        </View>
        <View style={styles.viewerHudTopRight}>
          <Text style={styles.viewerHudText}>
            RES: 2048×1536
          </Text>
          <Text style={styles.viewerHudText}>
            {isDragging ? '◉ DRAG' : '○ IDLE'}
          </Text>
        </View>
        <View style={styles.viewerHudBottomLeft}>
          <Text style={styles.viewerHudText}>
            DEFECTS: {CORROSION_ZONES.length}
          </Text>
        </View>
        <View style={styles.viewerHudBottomRight}>
          <Text style={styles.viewerHudText}>
            ZOOM: 1.0x
          </Text>
        </View>
      </View>

      {/* ── Timeline ── */}
      {renderTimelineBar()}

      {/* ── Zone Legend ── */}
      {renderZoneLegend()}

      {/* ── Prediction HUD ── */}
      {renderPredictionHUD()}

      {/* ── Footer ── */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          NEXPEC FRONTIER // VISION_ENGINE v2.1.0 // {new Date().toISOString().slice(0, 10)}
        </Text>
      </View>
    </View>
  );
};

// ─── SUB-COMPONENT ──────────────────────────────────────
const HudDataRow: React.FC<{
  label: string;
  value: string;
  accent?: boolean;
}> = ({ label, value, accent }) => (
  <View style={styles.hudDataRow}>
    <Text style={styles.hudDataLabel}>{label}</Text>
    <Text style={[styles.hudDataValue, accent && styles.hudDataValueAccent]}>
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
  header: { marginBottom: 4 },
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

  // Corner brackets
  cornerBracket: {
    position: 'absolute',
    width: 16,
    height: 16,
    zIndex: 20,
  },
  cornerTL: { top: 4, left: 4 },
  cornerTR: { top: 4, right: 4 },
  cornerBL: { bottom: 4, left: 4 },
  cornerBR: { bottom: 4, right: 4 },
  cornerH: { width: 16, height: 1 },
  cornerV: { width: 1, height: 16 },

  // Viewer Frame
  viewerFrame: {
    width: VIEWER_WIDTH,
    height: VIEWER_HEIGHT,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgCardBorder,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 8,
  },

  // Pipe visualization
  pipeContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: COLORS.gridLine,
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: COLORS.gridLine,
  },
  pipeElement: {
    position: 'absolute',
    zIndex: 2,
  },
  pipeDetail: {
    position: 'absolute',
    width: 1,
    backgroundColor: COLORS.cyanDim,
    zIndex: 3,
  },
  measureMarker: {
    position: 'absolute',
    zIndex: 5,
  },
  measureText: {
    fontFamily: MONO_FONT,
    fontSize: 7,
    color: COLORS.cyanDim,
    letterSpacing: 1,
  },

  // Corrosion zones
  corrosionZone: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 2,
    zIndex: 10,
    overflow: 'hidden',
  },
  corrosionInner: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 2,
  },
  corrosionDot: {
    position: 'absolute',
    borderRadius: 10,
  },
  depthLabel: {
    position: 'absolute',
    bottom: -14,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  depthText: {
    fontFamily: MONO_FONT,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Scan line
  viewerScanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: COLORS.cyanDim,
    zIndex: 15,
    shadowColor: COLORS.cyan,
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },

  // Slider
  sliderTrack: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  sliderOverlay2024: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: '#020617',
    opacity: 0.35,
    zIndex: 25,
  },
  handleContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  handleLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: COLORS.cyan,
    shadowColor: COLORS.cyan,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  handleGrip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.bgCard,
    borderWidth: 2,
    borderColor: COLORS.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: COLORS.cyan,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 50,
  },
  handleGripActive: {
    borderColor: COLORS.white,
    backgroundColor: COLORS.cyanGlow,
    shadowOpacity: 1,
    shadowRadius: 12,
  },
  handleArrows: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  handleArrowText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: COLORS.cyan,
  },
  handleDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.cyan,
  },
  yearTooltip: {
    position: 'absolute',
    top: -24,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.cyan,
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  yearTooltipText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: COLORS.cyan,
    fontWeight: '700',
  },

  // Year labels
  yearLabelContainer: {
    position: 'absolute',
    top: 8,
    left: 24,
    zIndex: 35,
  },
  yearLabelRight: {
    left: undefined,
    right: 24,
    alignItems: 'flex-end',
  },
  yearLabel: {
    fontFamily: MONO_FONT,
    fontSize: 14,
    color: COLORS.white,
    fontWeight: '700',
  },
  yearSublabel: {
    fontFamily: MONO_FONT,
    fontSize: 7,
    color: COLORS.whiteDim,
    letterSpacing: 1,
  },

  // Viewer HUD overlays
  viewerHudTopLeft: {
    position: 'absolute',
    top: 30,
    left: 8,
    zIndex: 35,
  },
  viewerHudTopRight: {
    position: 'absolute',
    top: 30,
    right: 8,
    zIndex: 35,
    alignItems: 'flex-end',
  },
  viewerHudBottomLeft: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    zIndex: 35,
  },
  viewerHudBottomRight: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    zIndex: 35,
  },
  viewerHudText: {
    fontFamily: MONO_FONT,
    fontSize: 7,
    color: COLORS.cyanDim,
    letterSpacing: 0.5,
    lineHeight: 12,
  },

  // Timeline
  timelineContainer: {
    height: 40,
    marginBottom: 12,
    position: 'relative',
    justifyContent: 'center',
    marginHorizontal: 10,
  },
  timelineLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: COLORS.bgCardBorder,
    top: 12,
  },
  timelineProgress: {
    position: 'absolute',
    left: 0,
    height: 2,
    backgroundColor: COLORS.cyan,
    top: 12,
    shadowColor: COLORS.cyan,
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  timelineMarker: {
    position: 'absolute',
    alignItems: 'center',
    top: 4,
    marginLeft: -10,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: COLORS.bgCardBorder,
    marginBottom: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  timelineYear: {
    fontFamily: MONO_FONT,
    fontSize: 8,
    color: COLORS.whiteDim,
    letterSpacing: 0.5,
  },

  // Zone Legend
  legendContainer: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgCardBorder,
    borderRadius: 4,
    padding: 10,
    marginBottom: 12,
  },
  legendTitle: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: COLORS.cyan,
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: '45%',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendItemText: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: COLORS.white,
    letterSpacing: 0.5,
  },
  legendDepth: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: COLORS.whiteDim,
  },

  // Prediction HUD
  hudContainer: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgCardBorder,
    borderRadius: 6,
    padding: 16,
    marginBottom: 12,
    position: 'relative',
  },
  hudHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  hudHeaderTag: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: COLORS.amber,
    letterSpacing: 1,
    fontWeight: '700',
  },
  hudMethod: {
    fontFamily: MONO_FONT,
    fontSize: 8,
    color: COLORS.whiteDim,
    letterSpacing: 0.5,
  },
  hudMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  hudMetricPrimary: {
    flex: 1,
    alignItems: 'center',
  },
  hudMetricLabel: {
    fontFamily: MONO_FONT,
    fontSize: 8,
    color: COLORS.whiteDim,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  hudMetricValueLarge: {
    fontFamily: MONO_FONT,
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.amber,
  },
  hudMetricDivider: {
    width: 1,
    height: 40,
    backgroundColor: COLORS.bgCardBorder,
    marginHorizontal: 12,
  },

  // Integrity gauge
  integrityContainer: {
    marginBottom: 14,
  },
  integrityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  integrityLabel: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: COLORS.whiteDim,
    letterSpacing: 1,
  },
  integrityValue: {
    fontFamily: MONO_FONT,
    fontSize: 16,
    fontWeight: '700',
  },
  integrityBar: {
    height: 8,
    backgroundColor: COLORS.redDim,
    borderRadius: 4,
    overflow: 'visible',
    position: 'relative',
  },
  integrityFill: {
    height: '100%',
    borderRadius: 4,
    shadowOpacity: 0.5,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  thresholdMarker: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    width: 2,
    alignItems: 'center',
  },
  thresholdLine: {
    width: 2,
    height: 12,
    borderRadius: 1,
    opacity: 0.6,
  },
  integrityLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  thresholdLabel: {
    fontFamily: MONO_FONT,
    fontSize: 7,
    letterSpacing: 0.5,
  },

  // HUD data grid
  hudDataGrid: {
    borderTopWidth: 1,
    borderTopColor: COLORS.bgCardBorder,
    paddingTop: 10,
    marginBottom: 12,
  },
  hudDataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgCardBorder,
  },
  hudDataLabel: {
    fontFamily: MONO_FONT,
    fontSize: 9,
    color: COLORS.whiteDim,
    letterSpacing: 1,
  },
  hudDataValue: {
    fontFamily: MONO_FONT,
    fontSize: 11,
    color: COLORS.white,
    fontWeight: '600',
  },
  hudDataValueAccent: {
    color: COLORS.amber,
  },

  // Warning banner
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.redDim,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.red,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 2,
    gap: 8,
  },
  warningIcon: {
    fontSize: 16,
    color: COLORS.red,
  },
  warningText: {
    fontFamily: MONO_FONT,
    fontSize: 10,
    color: COLORS.white,
    flex: 1,
    lineHeight: 14,
    letterSpacing: 0.3,
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

export default TimeLapseViewer;