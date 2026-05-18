// ═══════════════════════════════════════════════════════════
// src/components/shared/PhotoMarkupEditor.tsx
// Built-in Photo Markup — Freehand Annotation for Inspectors
// react-native-svg + PanResponder + react-native-view-shot
// ═══════════════════════════════════════════════════════════

import React, {
  useState,
  useRef,
  useCallback,
  useMemo,
  useEffect,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  PanResponder,
  Dimensions,
  ActivityIndicator,
  Platform,
  StatusBar,
  Alert,
  GestureResponderEvent,
  PanResponderGestureState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Theme ──────────────────────────────────────────────
const COLORS = {
  background: '#020420',
  surface: '#0F172A',
  surfaceLight: '#1E293B',
  surfaceElevated: '#162036',
  border: '#1F2937',
  borderLight: '#334155',
  primary: '#7C3AED',
  primaryLight: '#8B5CF6',
  primaryBg: 'rgba(124, 58, 237, 0.15)',
  green: '#10B981',
  greenBg: 'rgba(16, 185, 129, 0.15)',
  red: '#EF4444',
  redBg: 'rgba(239, 68, 68, 0.15)',
  amber: '#F59E0B',
  amberBg: 'rgba(245, 158, 11, 0.15)',
  blue: '#3B82F6',
  blueBg: 'rgba(59, 130, 246, 0.15)',
  white: '#FFFFFF',
  textPrimary: '#F1F5F9',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDark: '#334155',
};

// ── Types ──────────────────────────────────────────────
interface Point {
  x: number;
  y: number;
}

interface DrawnPath {
  id: string;
  d: string;
  points: Point[];
  color: string;
  strokeWidth: number;
}

interface PhotoMarkupEditorProps {
  /** URI of the photo to annotate (camera roll or freshly taken) */
  initialImageUri: string;
  /** Callback with the final flattened image URI (image + drawings merged) */
  onSave: (markedUpUri: string) => void;
  /** Callback when user cancels markup */
  onCancel: () => void;
}

// ── Pen Color Palette ──────────────────────────────────
const PEN_COLORS = [
  { id: 'red', color: '#EF4444', label: 'Red' },
  { id: 'yellow', color: '#F59E0B', label: 'Yellow' },
  { id: 'green', color: '#10B981', label: 'Green' },
  { id: 'blue', color: '#3B82F6', label: 'Blue' },
  { id: 'white', color: '#FFFFFF', label: 'White' },
  { id: 'purple', color: '#8B5CF6', label: 'Purple' },
];

// ── Stroke Widths ──────────────────────────────────────
const STROKE_WIDTHS = [
  { id: 'thin', width: 3, label: 'S' },
  { id: 'medium', width: 5, label: 'M' },
  { id: 'thick', width: 8, label: 'L' },
];

// ── Path Smoothing ─────────────────────────────────────

/**
 * Converts raw touch points into a smooth SVG path string
 * using quadratic Bézier curves for natural-looking freehand lines.
 */
function pointsToSmoothSvgPath(points: Point[]): string {
  if (points.length === 0) return '';

  // Single tap — draw a tiny dot
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x},${p.y} L ${p.x + 0.5},${p.y + 0.5}`;
  }

  // Two points — straight line
  if (points.length === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  // 3+ points — smooth quadratic Bézier interpolation
  let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;

  for (let i = 1; i < points.length - 1; i++) {
    const cpx = points[i].x;
    const cpy = points[i].y;
    // End point is midpoint between current and next (smoothing trick)
    const epx = (points[i].x + points[i + 1].x) / 2;
    const epy = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${cpx.toFixed(1)},${cpy.toFixed(1)} ${epx.toFixed(1)},${epy.toFixed(1)}`;
  }

  // Final segment — straight line to last point
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)},${last.y.toFixed(1)}`;

  return d;
}

/**
 * Reduces the number of points while preserving the visual shape.
 * Uses Ramer-Douglas-Peucker simplification with a very small epsilon
 * so it stays visually identical but reduces SVG path complexity.
 */
function simplifyPoints(points: Point[], epsilon: number = 1.5): Point[] {
  if (points.length <= 2) return points;

  // Find the point with the maximum distance from the line (first→last)
  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPoints(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

function perpendicularDistance(point: Point, lineStart: Point, lineEnd: Point): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2),
    );
  }

  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) /
    (dx * dx + dy * dy);
  const nearestX = lineStart.x + t * dx;
  const nearestY = lineStart.y + t * dy;

  return Math.sqrt(
    Math.pow(point.x - nearestX, 2) + Math.pow(point.y - nearestY, 2),
  );
}

// ════════════════════════════════════════════════════════
//  COMPONENT
// ════════════════════════════════════════════════════════

const PhotoMarkupEditor: React.FC<PhotoMarkupEditorProps> = ({
  initialImageUri,
  onSave,
  onCancel,
}) => {
  // ── State ───────────────────────────────────────────
  const [completedPaths, setCompletedPaths] = useState<DrawnPath[]>([]);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedColor, setSelectedColor] = useState('#EF4444');
  const [selectedStrokeWidth, setSelectedStrokeWidth] = useState(5);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canvasLayout, setCanvasLayout] = useState({ width: 0, height: 0 });

  // ── Refs ────────────────────────────────────────────
  const viewShotRef = useRef<View>(null);
  const currentPointsRef = useRef<Point[]>([]);
  const pathIdCounter = useRef(0);

  // ── Current live path string (for in-progress drawing) ──
  const currentPathD = useMemo(() => {
    if (currentPoints.length === 0) return '';
    return pointsToSmoothSvgPath(currentPoints);
  }, [currentPoints]);

  // ── PanResponder ────────────────────────────────────
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (evt: GestureResponderEvent) => {
          const { locationX, locationY } = evt.nativeEvent;
          const point: Point = { x: locationX, y: locationY };
          currentPointsRef.current = [point];
          setCurrentPoints([point]);
          setIsDrawing(true);
        },

        onPanResponderMove: (evt: GestureResponderEvent) => {
          const { locationX, locationY } = evt.nativeEvent;
          const point: Point = { x: locationX, y: locationY };

          // Throttle: only add point if moved > 2px from last
          const prev = currentPointsRef.current;
          if (prev.length > 0) {
            const last = prev[prev.length - 1];
            const dist = Math.sqrt(
              Math.pow(point.x - last.x, 2) + Math.pow(point.y - last.y, 2),
            );
            if (dist < 2) return; // Skip tiny movements
          }

          currentPointsRef.current = [...currentPointsRef.current, point];
          setCurrentPoints([...currentPointsRef.current]);
        },

        onPanResponderRelease: () => {
          const points = currentPointsRef.current;
          if (points.length > 0) {
            // Simplify and convert to final path
            const simplified = simplifyPoints(points);
            const d = pointsToSmoothSvgPath(simplified);
            const newPath: DrawnPath = {
              id: `path-${++pathIdCounter.current}-${Date.now()}`,
              d,
              points: simplified,
              color: selectedColor,
              strokeWidth: selectedStrokeWidth,
            };
            setCompletedPaths((prev) => [...prev, newPath]);
          }
          currentPointsRef.current = [];
          setCurrentPoints([]);
          setIsDrawing(false);
        },

        onPanResponderTerminate: () => {
          // If interrupted, still save what we have
          const points = currentPointsRef.current;
          if (points.length > 1) {
            const simplified = simplifyPoints(points);
            const d = pointsToSmoothSvgPath(simplified);
            const newPath: DrawnPath = {
              id: `path-${++pathIdCounter.current}-${Date.now()}`,
              d,
              points: simplified,
              color: selectedColor,
              strokeWidth: selectedStrokeWidth,
            };
            setCompletedPaths((prev) => [...prev, newPath]);
          }
          currentPointsRef.current = [];
          setCurrentPoints([]);
          setIsDrawing(false);
        },
      }),
    [selectedColor, selectedStrokeWidth],
  );

  // ── Actions ─────────────────────────────────────────

  const handleUndo = useCallback(() => {
    setCompletedPaths((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const handleClear = useCallback(() => {
    if (completedPaths.length === 0) return;
    Alert.alert(
      'Clear All Markups',
      'Remove all drawings from this photo?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => setCompletedPaths([]),
        },
      ],
    );
  }, [completedPaths.length]);

  const handleSave = useCallback(async () => {
    if (!viewShotRef.current) {
      Alert.alert('Error', 'Unable to capture the image. Please try again.');
      return;
    }

    setSaving(true);
    try {
      // Capture the combined Image + SVG overlay into one flat image
      const uri = await captureRef(viewShotRef, {
        format: 'jpg',
        quality: 0.85,
        result: 'tmpfile',
      });

      console.log('[PhotoMarkup] Captured markup image:', uri);

      if (!uri) {
        throw new Error('Capture returned empty URI');
      }

      onSave(uri);
    } catch (error: any) {
      console.error('[PhotoMarkup] Save failed:', error);
      Alert.alert(
        'Save Failed',
        'Could not save the marked-up photo. Please try again.',
        [{ text: 'OK' }],
      );
    } finally {
      setSaving(false);
    }
  }, [onSave]);

  const handleCancel = useCallback(() => {
    if (completedPaths.length > 0) {
      Alert.alert(
        'Discard Markups?',
        'You have unsaved annotations. Are you sure you want to discard them?',
        [
          { text: 'Keep Editing', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: onCancel,
          },
        ],
      );
    } else {
      onCancel();
    }
  }, [completedPaths.length, onCancel]);

  // ── Canvas layout handler ───────────────────────────
  const handleCanvasLayout = useCallback(
    (e: { nativeEvent: { layout: { width: number; height: number } } }) => {
      const { width, height } = e.nativeEvent.layout;
      setCanvasLayout({ width, height });
    },
    [],
  );

  // ════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════

  return (
    <SafeAreaView style={st.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />

      {/* ── Header Toolbar ─────────────────────────── */}
      <View style={st.header}>
        <TouchableOpacity
          style={st.headerBtn}
          onPress={handleCancel}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>

        <View style={st.headerCenter}>
          <Ionicons name="create-outline" size={18} color={COLORS.primary} />
          <Text style={st.headerTitle}>Mark Up Photo</Text>
          {completedPaths.length > 0 && (
            <View style={st.pathCountBadge}>
              <Text style={st.pathCountText}>{completedPaths.length}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[st.headerBtn, st.saveHeaderBtn]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.7}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.white} />
          ) : (
            <Ionicons name="checkmark" size={22} color={COLORS.white} />
          )}
        </TouchableOpacity>
      </View>

      {/* ── Canvas (Image + SVG overlay) ───────────── */}
      <View style={st.canvasContainer} onLayout={handleCanvasLayout}>
        {/* ViewShot wrapper — captures everything inside */}
        <View
          ref={viewShotRef}
          style={st.canvasInner}
          collapsable={false}
        >
          {/* Background Image */}
          <Image
            source={{ uri: initialImageUri }}
            style={st.backgroundImage}
            resizeMode="contain"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />

          {/* SVG Drawing Overlay — perfectly aligned on top of image */}
          {canvasLayout.width > 0 && canvasLayout.height > 0 && (
            <Svg
              width={canvasLayout.width}
              height={canvasLayout.height}
              style={StyleSheet.absoluteFill}
            >
              {/* Completed paths */}
              {completedPaths.map((path) => (
                <Path
                  key={path.id}
                  d={path.d}
                  stroke={path.color}
                  strokeWidth={path.strokeWidth}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}

              {/* Currently drawing path (live) */}
              {currentPathD !== '' && (
                <Path
                  d={currentPathD}
                  stroke={selectedColor}
                  strokeWidth={selectedStrokeWidth}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.9}
                />
              )}
            </Svg>
          )}
        </View>

        {/* Touch surface — PanResponder lives here */}
        <View
          style={StyleSheet.absoluteFill}
          {...panResponder.panHandlers}
        />

        {/* Loading / Error states */}
        {!imageLoaded && !imageError && (
          <View style={st.loadingOverlay}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={st.loadingText}>Loading photo…</Text>
          </View>
        )}

        {imageError && (
          <View style={st.loadingOverlay}>
            <Ionicons name="image-outline" size={48} color={COLORS.red} />
            <Text style={st.errorText}>Failed to load image</Text>
          </View>
        )}

        {/* Drawing indicator */}
        {isDrawing && (
          <View style={st.drawingIndicator}>
            <View style={[st.drawingDot, { backgroundColor: selectedColor }]} />
            <Text style={st.drawingText}>Drawing…</Text>
          </View>
        )}
      </View>

      {/* ── Bottom Toolbar ─────────────────────────── */}
      <View style={st.toolbar}>
        {/* Row 1 — Color Palette */}
        <View style={st.toolSection}>
          <Text style={st.toolLabel}>Color</Text>
          <View style={st.colorRow}>
            {PEN_COLORS.map((pen) => (
              <TouchableOpacity
                key={pen.id}
                style={[
                  st.colorDot,
                  { backgroundColor: pen.color },
                  selectedColor === pen.color && st.colorDotSelected,
                  pen.color === '#FFFFFF' && st.colorDotWhiteBorder,
                ]}
                onPress={() => setSelectedColor(pen.color)}
                activeOpacity={0.7}
              >
                {selectedColor === pen.color && (
                  <Ionicons
                    name="checkmark"
                    size={14}
                    color={
                      pen.color === '#FFFFFF' || pen.color === '#F59E0B'
                        ? '#000'
                        : '#FFF'
                    }
                  />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Row 2 — Stroke Width + Actions */}
        <View style={st.toolRow}>
          {/* Stroke width selector */}
          <View style={st.strokeSection}>
            <Text style={st.toolLabel}>Size</Text>
            <View style={st.strokeRow}>
              {STROKE_WIDTHS.map((sw) => (
                <TouchableOpacity
                  key={sw.id}
                  style={[
                    st.strokeBtn,
                    selectedStrokeWidth === sw.width && st.strokeBtnActive,
                  ]}
                  onPress={() => setSelectedStrokeWidth(sw.width)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      st.strokePreview,
                      {
                        width: sw.width * 3 + 6,
                        height: sw.width * 3 + 6,
                        borderRadius: (sw.width * 3 + 6) / 2,
                        backgroundColor:
                          selectedStrokeWidth === sw.width
                            ? selectedColor
                            : COLORS.textMuted,
                      },
                    ]}
                  />
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Divider */}
          <View style={st.toolDivider} />

          {/* Action buttons */}
          <View style={st.actionSection}>
            <TouchableOpacity
              style={[
                st.actionBtn,
                completedPaths.length === 0 && st.actionBtnDisabled,
              ]}
              onPress={handleUndo}
              disabled={completedPaths.length === 0}
              activeOpacity={0.7}
            >
              <Ionicons
                name="arrow-undo"
                size={20}
                color={
                  completedPaths.length > 0
                    ? COLORS.amber
                    : COLORS.textDark
                }
              />
              <Text
                style={[
                  st.actionBtnText,
                  {
                    color:
                      completedPaths.length > 0
                        ? COLORS.amber
                        : COLORS.textDark,
                  },
                ]}
              >
                Undo
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                st.actionBtn,
                completedPaths.length === 0 && st.actionBtnDisabled,
              ]}
              onPress={handleClear}
              disabled={completedPaths.length === 0}
              activeOpacity={0.7}
            >
              <Ionicons
                name="trash-outline"
                size={20}
                color={
                  completedPaths.length > 0 ? COLORS.red : COLORS.textDark
                }
              />
              <Text
                style={[
                  st.actionBtnText,
                  {
                    color:
                      completedPaths.length > 0
                        ? COLORS.red
                        : COLORS.textDark,
                  },
                ]}
              >
                Clear
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Save Button (prominent, bottom) */}
        <TouchableOpacity
          style={st.saveButton}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={
              saving
                ? [COLORS.surfaceLight, COLORS.surfaceLight]
                : [COLORS.primary, '#6D28D9']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {saving ? (
            <>
              <ActivityIndicator size="small" color={COLORS.white} />
              <Text style={st.saveButtonText}>Saving…</Text>
            </>
          ) : (
            <>
              <Ionicons name="save-outline" size={20} color={COLORS.white} />
              <Text style={st.saveButtonText}>
                Save Markup
                {completedPaths.length > 0
                  ? ` (${completedPaths.length} annotation${completedPaths.length !== 1 ? 's' : ''})`
                  : ''}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default React.memo(PhotoMarkupEditor);

// ════════════════════════════════════════════════════════
//  STYLES
// ════════════════════════════════════════════════════════

const st = StyleSheet.create({
  /* ── Layout ────────────────────────────────────── */
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  /* ── Header ────────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  headerBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  saveHeaderBtn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  pathCountBadge: {
    backgroundColor: COLORS.primaryBg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  pathCountText: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.primary,
  },

  /* ── Canvas ────────────────────────────────────── */
  canvasContainer: {
    flex: 1,
    backgroundColor: '#000',
    position: 'relative',
  },
  canvasInner: {
    flex: 1,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    gap: 12,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: COLORS.red,
    fontSize: 14,
    fontWeight: '600',
  },
  drawingIndicator: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 6,
  },
  drawingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  drawingText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },

  /* ── Toolbar ───────────────────────────────────── */
  toolbar: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 8 : 12,
  },
  toolSection: {
    marginBottom: 12,
  },
  toolLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorDotSelected: {
    borderColor: COLORS.white,
    ...Platform.select({
      ios: {
        shadowColor: '#FFF',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.4,
        shadowRadius: 6,
      },
      android: { elevation: 4 },
    }),
  },
  colorDotWhiteBorder: {
    borderColor: COLORS.borderLight,
  },

  /* ── Stroke + Actions Row ──────────────────────── */
  toolRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  strokeSection: {
    flex: 1,
  },
  strokeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  strokeBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  strokeBtnActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryBg,
  },
  strokePreview: {
    // Width/height/borderRadius set dynamically
  },
  toolDivider: {
    width: 1,
    height: 40,
    backgroundColor: COLORS.border,
    marginHorizontal: 14,
    marginTop: 22,
  },
  actionSection: {
    flex: 1,
    gap: 0,
  },

  /* ── Action Buttons (Undo, Clear) ──────────────── */
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 6,
  },
  actionBtnDisabled: {
    opacity: 0.4,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },

  /* ── Save Button ───────────────────────────────── */
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: COLORS.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: { elevation: 6 },
    }),
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.white,
  },
});