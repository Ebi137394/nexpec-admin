import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Text,
  Dimensions,
  PanResponder,
  TextInput,
  Alert,
  Platform,
  Image,
  ScrollView,
  StatusBar,
} from 'react-native';
import Svg, {
  Path,
  Circle,
  Line,
  G,
  Defs,
  Marker,
  Polygon,
  Text as SvgText,
  Rect,
} from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

// ─── Types ───────────────────────────────────────────────────────────
type Tool = 'pen' | 'arrow' | 'circle' | 'text';

interface Point {
  x: number;
  y: number;
}

interface PenAnnotation {
  type: 'pen';
  id: string;
  pathData: string;
  color: string;
  strokeWidth: number;
}

interface ArrowAnnotation {
  type: 'arrow';
  id: string;
  start: Point;
  end: Point;
  color: string;
  strokeWidth: number;
}

interface CircleAnnotation {
  type: 'circle';
  id: string;
  center: Point;
  radius: number;
  color: string;
  strokeWidth: number;
}

interface TextAnnotation {
  type: 'text';
  id: string;
  position: Point;
  content: string;
  color: string;
  fontSize: number;
}

type Annotation = PenAnnotation | ArrowAnnotation | CircleAnnotation | TextAnnotation;

interface PhotoEditorProps {
  visible: boolean;
  imageUri: string;
  onSave: (annotations: Annotation[], imageUri: string) => void;
  onClose: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const CANVAS_PADDING = 0;
const TOOLBAR_HEIGHT = 72;
const TOP_BAR_HEIGHT = 56;
const COLORS = ['#FF0000', '#FF6600', '#FFCC00', '#00FF66', '#00CCFF', '#FFFFFF'];
const STROKE_WIDTHS = [2, 4, 6, 8];

const THEME = {
  bg: '#020617',
  surface: 'rgba(2, 6, 23, 0.92)',
  glass: 'rgba(255, 255, 255, 0.06)',
  glassBorder: 'rgba(255, 255, 255, 0.10)',
  accent: '#FF0000',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.6)',
};

const generateId = (): string => `ann_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// ─── Component ───────────────────────────────────────────────────────
const PhotoEditor: React.FC<PhotoEditorProps> = ({
  visible,
  imageUri,
  onSave,
  onClose,
}) => {
  // State
  const [activeTool, setActiveTool] = useState<Tool>('pen');
  const [activeColor, setActiveColor] = useState<string>(COLORS[0]);
  const [activeStrokeWidth, setActiveStrokeWidth] = useState<number>(4);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [drawingStart, setDrawingStart] = useState<Point | null>(null);
  const [drawingEnd, setDrawingEnd] = useState<Point | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showStrokePicker, setShowStrokePicker] = useState(false);
  const [textInputVisible, setTextInputVisible] = useState(false);
  const [textInputValue, setTextInputValue] = useState('');
  const [textPosition, setTextPosition] = useState<Point>({ x: 0, y: 0 });
  const [imageLayout, setImageLayout] = useState({ width: SCREEN_W, height: SCREEN_H - TOOLBAR_HEIGHT - TOP_BAR_HEIGHT });

  const svgRef = useRef<any>(null);

  // Compute image dimensions to maintain aspect ratio
  const [imageDims, setImageDims] = useState({ width: SCREEN_W, height: SCREEN_H * 0.75 });

  React.useEffect(() => {
    if (imageUri) {
      Image.getSize(
        imageUri,
        (w, h) => {
          const availableW = SCREEN_W;
          const availableH = SCREEN_H - TOOLBAR_HEIGHT - TOP_BAR_HEIGHT - 40;
          const ratio = Math.min(availableW / w, availableH / h);
          setImageDims({
            width: w * ratio,
            height: h * ratio,
          });
        },
        () => {
          // fallback
          setImageDims({ width: SCREEN_W, height: SCREEN_H * 0.65 });
        }
      );
    }
  }, [imageUri]);

  // ─── Path building helper ────────────────────────────────────────
  const pointsToSvgPath = useCallback((points: Point[]): string => {
    if (points.length < 2) return '';
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const midX = ((prev.x + curr.x) / 2).toFixed(1);
      const midY = ((prev.y + curr.y) / 2).toFixed(1);
      d += ` Q ${prev.x.toFixed(1)} ${prev.y.toFixed(1)} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
    return d;
  }, []);

  // ─── PanResponder ────────────────────────────────────────────────
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const point: Point = { x: locationX, y: locationY };

          if (activeTool === 'text') {
            setTextPosition(point);
            setTextInputVisible(true);
            return;
          }

          setIsDrawing(true);
          setDrawingStart(point);
          setDrawingEnd(point);

          if (activeTool === 'pen') {
            setCurrentPoints([point]);
            setCurrentPath(`M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`);
          }
        },

        onPanResponderMove: (evt) => {
          if (!isDrawing && activeTool !== 'text') return;

          const { locationX, locationY } = evt.nativeEvent;
          const point: Point = { x: locationX, y: locationY };

          if (activeTool === 'pen') {
            setCurrentPoints((prev) => {
              const newPoints = [...prev, point];
              setCurrentPath(pointsToSvgPath(newPoints));
              return newPoints;
            });
          } else if (activeTool === 'arrow' || activeTool === 'circle') {
            setDrawingEnd(point);
          }
        },

        onPanResponderRelease: () => {
          if (!isDrawing) return;
          setIsDrawing(false);

          if (activeTool === 'pen' && currentPath) {
            const annotation: PenAnnotation = {
              type: 'pen',
              id: generateId(),
              pathData: currentPath,
              color: activeColor,
              strokeWidth: activeStrokeWidth,
            };
            setAnnotations((prev) => [...prev, annotation]);
            setCurrentPath('');
            setCurrentPoints([]);
          } else if (activeTool === 'arrow' && drawingStart && drawingEnd) {
            const dx = drawingEnd.x - drawingStart.x;
            const dy = drawingEnd.y - drawingStart.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 10) {
              const annotation: ArrowAnnotation = {
                type: 'arrow',
                id: generateId(),
                start: drawingStart,
                end: drawingEnd,
                color: activeColor,
                strokeWidth: activeStrokeWidth,
              };
              setAnnotations((prev) => [...prev, annotation]);
            }
          } else if (activeTool === 'circle' && drawingStart && drawingEnd) {
            const dx = drawingEnd.x - drawingStart.x;
            const dy = drawingEnd.y - drawingStart.y;
            const radius = Math.sqrt(dx * dx + dy * dy);
            if (radius > 8) {
              const annotation: CircleAnnotation = {
                type: 'circle',
                id: generateId(),
                center: drawingStart,
                radius,
                color: activeColor,
                strokeWidth: activeStrokeWidth,
              };
              setAnnotations((prev) => [...prev, annotation]);
            }
          }

          setDrawingStart(null);
          setDrawingEnd(null);
        },
      }),
    [activeTool, activeColor, activeStrokeWidth, isDrawing, currentPath, drawingStart, drawingEnd, pointsToSvgPath]
  );

  // ─── Actions ─────────────────────────────────────────────────────
  const handleUndo = useCallback(() => {
    setAnnotations((prev) => {
      if (prev.length === 0) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const handleClear = useCallback(() => {
    Alert.alert(
      'Clear All Markups',
      'Are you sure you want to remove all annotations? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: () => setAnnotations([]),
        },
      ]
    );
  }, []);

  const handleSave = useCallback(() => {
    onSave(annotations, imageUri);
  }, [annotations, imageUri, onSave]);

  const handleTextSubmit = useCallback(() => {
    if (textInputValue.trim()) {
      const annotation: TextAnnotation = {
        type: 'text',
        id: generateId(),
        position: textPosition,
        content: textInputValue.trim(),
        color: activeColor,
        fontSize: 16,
      };
      setAnnotations((prev) => [...prev, annotation]);
    }
    setTextInputValue('');
    setTextInputVisible(false);
  }, [textInputValue, textPosition, activeColor]);

  // ─── Render Annotations SVG ──────────────────────────────────────
  const renderAnnotation = useCallback((ann: Annotation) => {
    switch (ann.type) {
      case 'pen':
        return (
          <Path
            key={ann.id}
            d={ann.pathData}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );

      case 'arrow': {
        const dx = ann.end.x - ann.start.x;
        const dy = ann.end.y - ann.start.y;
        const angle = Math.atan2(dy, dx);
        const headLen = 18;
        const p1x = ann.end.x - headLen * Math.cos(angle - Math.PI / 6);
        const p1y = ann.end.y - headLen * Math.sin(angle - Math.PI / 6);
        const p2x = ann.end.x - headLen * Math.cos(angle + Math.PI / 6);
        const p2y = ann.end.y - headLen * Math.sin(angle + Math.PI / 6);

        return (
          <G key={ann.id}>
            <Line
              x1={ann.start.x}
              y1={ann.start.y}
              x2={ann.end.x}
              y2={ann.end.y}
              stroke={ann.color}
              strokeWidth={ann.strokeWidth}
              strokeLinecap="round"
            />
            <Polygon
              points={`${ann.end.x},${ann.end.y} ${p1x},${p1y} ${p2x},${p2y}`}
              fill={ann.color}
            />
          </G>
        );
      }

      case 'circle':
        return (
          <Circle
            key={ann.id}
            cx={ann.center.x}
            cy={ann.center.y}
            r={ann.radius}
            stroke={ann.color}
            strokeWidth={ann.strokeWidth}
            fill="none"
          />
        );

      case 'text':
        return (
          <G key={ann.id}>
            <Rect
              x={ann.position.x - 4}
              y={ann.position.y - ann.fontSize - 2}
              width={ann.content.length * ann.fontSize * 0.6 + 8}
              height={ann.fontSize + 8}
              rx={4}
              fill="rgba(0,0,0,0.7)"
            />
            <SvgText
              x={ann.position.x}
              y={ann.position.y}
              fill={ann.color}
              fontSize={ann.fontSize}
              fontWeight="bold"
            >
              {ann.content}
            </SvgText>
          </G>
        );

      default:
        return null;
    }
  }, []);

  // ─── Render live preview while drawing ───────────────────────────
  const renderLivePreview = useCallback(() => {
    if (!isDrawing) return null;

    if (activeTool === 'pen' && currentPath) {
      return (
        <Path
          d={currentPath}
          stroke={activeColor}
          strokeWidth={activeStrokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.8}
        />
      );
    }

    if (activeTool === 'arrow' && drawingStart && drawingEnd) {
      const dx = drawingEnd.x - drawingStart.x;
      const dy = drawingEnd.y - drawingStart.y;
      const angle = Math.atan2(dy, dx);
      const headLen = 18;
      const p1x = drawingEnd.x - headLen * Math.cos(angle - Math.PI / 6);
      const p1y = drawingEnd.y - headLen * Math.sin(angle - Math.PI / 6);
      const p2x = drawingEnd.x - headLen * Math.cos(angle + Math.PI / 6);
      const p2y = drawingEnd.y - headLen * Math.sin(angle + Math.PI / 6);

      return (
        <G opacity={0.7}>
          <Line
            x1={drawingStart.x}
            y1={drawingStart.y}
            x2={drawingEnd.x}
            y2={drawingEnd.y}
            stroke={activeColor}
            strokeWidth={activeStrokeWidth}
            strokeLinecap="round"
          />
          <Polygon
            points={`${drawingEnd.x},${drawingEnd.y} ${p1x},${p1y} ${p2x},${p2y}`}
            fill={activeColor}
          />
        </G>
      );
    }

    if (activeTool === 'circle' && drawingStart && drawingEnd) {
      const dx = drawingEnd.x - drawingStart.x;
      const dy = drawingEnd.y - drawingStart.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      return (
        <Circle
          cx={drawingStart.x}
          cy={drawingStart.y}
          r={radius}
          stroke={activeColor}
          strokeWidth={activeStrokeWidth}
          fill="none"
          opacity={0.7}
        />
      );
    }

    return null;
  }, [isDrawing, activeTool, currentPath, drawingStart, drawingEnd, activeColor, activeStrokeWidth]);

  // ─── Tool Button ─────────────────────────────────────────────────
  const ToolButton: React.FC<{
    tool: Tool;
    icon: string;
    label: string;
  }> = ({ tool, icon, label }) => (
    <TouchableOpacity
      style={[
        styles.toolButton,
        activeTool === tool && styles.toolButtonActive,
      ]}
      onPress={() => {
        setActiveTool(tool);
        setShowColorPicker(false);
        setShowStrokePicker(false);
      }}
      activeOpacity={0.7}
    >
      <Ionicons
        name={icon as any}
        size={22}
        color={activeTool === tool ? '#020617' : THEME.textPrimary}
      />
      <Text
        style={[
          styles.toolLabel,
          activeTool === tool && styles.toolLabelActive,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  // ─── Main Render ─────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <StatusBar barStyle="light-content" backgroundColor={THEME.bg} />
      <View style={styles.container}>
        {/* ── Top Bar ── */}
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.topBarButton}
            onPress={onClose}
            activeOpacity={0.7}
          >
            <Ionicons name="close" size={24} color={THEME.textPrimary} />
          </TouchableOpacity>

          <Text style={styles.topBarTitle}>
            Photo Markup
            {annotations.length > 0 && (
              <Text style={styles.topBarCount}> · {annotations.length}</Text>
            )}
          </Text>

          <View style={styles.topBarActions}>
            <TouchableOpacity
              style={[styles.topBarButton, annotations.length === 0 && styles.disabledButton]}
              onPress={handleUndo}
              disabled={annotations.length === 0}
              activeOpacity={0.7}
            >
              <Ionicons
                name="arrow-undo"
                size={22}
                color={annotations.length > 0 ? '#00CCFF' : THEME.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.topBarButton, annotations.length === 0 && styles.disabledButton]}
              onPress={handleClear}
              disabled={annotations.length === 0}
              activeOpacity={0.7}
            >
              <Ionicons
                name="trash-outline"
                size={22}
                color={annotations.length > 0 ? '#FF4444' : THEME.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleSave}
              activeOpacity={0.7}
            >
              <Ionicons name="checkmark" size={20} color="#020617" />
              <Text style={styles.saveButtonText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Canvas Area ── */}
        <View style={styles.canvasContainer}>
          <View
            style={[
              styles.imageWrapper,
              { width: imageDims.width, height: imageDims.height },
            ]}
          >
            <Image
              source={{ uri: imageUri }}
              style={[styles.image, { width: imageDims.width, height: imageDims.height }]}
              resizeMode="contain"
            />

            {/* SVG Overlay */}
            <View
              style={[styles.svgOverlay, { width: imageDims.width, height: imageDims.height }]}
              {...panResponder.panHandlers}
            >
              <Svg
                ref={svgRef}
                width={imageDims.width}
                height={imageDims.height}
                style={StyleSheet.absoluteFill}
              >
                {annotations.map(renderAnnotation)}
                {renderLivePreview()}
              </Svg>
            </View>
          </View>
        </View>

        {/* ── Color Picker Flyout ── */}
        {showColorPicker && (
          <View style={styles.pickerFlyout}>
            <Text style={styles.pickerLabel}>Color</Text>
            <View style={styles.colorRow}>
              {COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: color },
                    activeColor === color && styles.colorSwatchActive,
                  ]}
                  onPress={() => {
                    setActiveColor(color);
                    setShowColorPicker(false);
                  }}
                />
              ))}
            </View>
          </View>
        )}

        {/* ── Stroke Picker Flyout ── */}
        {showStrokePicker && (
          <View style={styles.pickerFlyout}>
            <Text style={styles.pickerLabel}>Stroke Width</Text>
            <View style={styles.colorRow}>
              {STROKE_WIDTHS.map((sw) => (
                <TouchableOpacity
                  key={sw}
                  style={[
                    styles.strokeOption,
                    activeStrokeWidth === sw && styles.strokeOptionActive,
                  ]}
                  onPress={() => {
                    setActiveStrokeWidth(sw);
                    setShowStrokePicker(false);
                  }}
                >
                  <View
                    style={[
                      styles.strokePreview,
                      {
                        height: sw,
                        backgroundColor: activeColor,
                      },
                    ]}
                  />
                  <Text style={styles.strokeLabel}>{sw}px</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── Bottom Toolbar ── */}
        <View style={styles.toolbar}>
          <View style={styles.toolRow}>
            <ToolButton tool="pen" icon="pencil" label="Pen" />
            <ToolButton tool="arrow" icon="arrow-forward" label="Arrow" />
            <ToolButton tool="circle" icon="ellipse-outline" label="Circle" />
            <ToolButton tool="text" icon="text" label="Text" />

            {/* Divider */}
            <View style={styles.toolDivider} />

            {/* Color Button */}
            <TouchableOpacity
              style={styles.toolButton}
              onPress={() => {
                setShowColorPicker(!showColorPicker);
                setShowStrokePicker(false);
              }}
              activeOpacity={0.7}
            >
              <View style={[styles.colorIndicator, { backgroundColor: activeColor }]} />
              <Text style={styles.toolLabel}>Color</Text>
            </TouchableOpacity>

            {/* Stroke Button */}
            <TouchableOpacity
              style={styles.toolButton}
              onPress={() => {
                setShowStrokePicker(!showStrokePicker);
                setShowColorPicker(false);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.strokeIndicatorWrapper}>
                <View
                  style={[
                    styles.strokeIndicatorLine,
                    {
                      height: activeStrokeWidth,
                      backgroundColor: activeColor,
                    },
                  ]}
                />
              </View>
              <Text style={styles.toolLabel}>{activeStrokeWidth}px</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Text Input Modal ── */}
        <Modal
          visible={textInputVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setTextInputVisible(false)}
        >
          <TouchableOpacity
            style={styles.textInputOverlay}
            activeOpacity={1}
            onPress={() => setTextInputVisible(false)}
          >
            <View style={styles.textInputContainer}>
              <Text style={styles.textInputTitle}>Add Text Annotation</Text>
              <TextInput
                style={styles.textInput}
                value={textInputValue}
                onChangeText={setTextInputValue}
                placeholder="Type annotation text..."
                placeholderTextColor={THEME.textSecondary}
                autoFocus
                maxLength={100}
                returnKeyType="done"
                onSubmitEditing={handleTextSubmit}
              />
              <View style={styles.textInputActions}>
                <TouchableOpacity
                  style={styles.textInputCancel}
                  onPress={() => {
                    setTextInputValue('');
                    setTextInputVisible(false);
                  }}
                >
                  <Text style={styles.textInputCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.textInputConfirm,
                    !textInputValue.trim() && styles.disabledButton,
                  ]}
                  onPress={handleTextSubmit}
                  disabled={!textInputValue.trim()}
                >
                  <Text style={styles.textInputConfirmText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    </Modal>
  );
};

// ─── Styles ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 54 : StatusBar.currentHeight ? StatusBar.currentHeight + 8 : 36,
    paddingBottom: 10,
    backgroundColor: THEME.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.glassBorder,
  },
  topBarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: THEME.glass,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: THEME.textPrimary,
    letterSpacing: 0.3,
  },
  topBarCount: {
    fontSize: 14,
    fontWeight: '500',
    color: THEME.textSecondary,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#00FF66',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 4,
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#020617',
  },
  canvasContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
  },
  imageWrapper: {
    position: 'relative',
    overflow: 'hidden',
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  svgOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  toolbar: {
    backgroundColor: THEME.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.glassBorder,
    paddingBottom: Platform.OS === 'ios' ? 30 : 12,
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  toolButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    minWidth: 48,
  },
  toolButtonActive: {
    backgroundColor: '#00FF66',
  },
  toolLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: THEME.textSecondary,
    marginTop: 2,
  },
  toolLabelActive: {
    color: '#020617',
  },
  toolDivider: {
    width: 1,
    height: 32,
    backgroundColor: THEME.glassBorder,
    marginHorizontal: 6,
  },
  colorIndicator: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: THEME.textPrimary,
  },
  strokeIndicatorWrapper: {
    width: 24,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  strokeIndicatorLine: {
    width: 20,
    borderRadius: 4,
  },
  pickerFlyout: {
    position: 'absolute',
    bottom: TOOLBAR_HEIGHT + (Platform.OS === 'ios' ? 30 : 12) + 10,
    left: 16,
    right: 16,
    backgroundColor: THEME.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: THEME.glassBorder,
  },
  pickerLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.textSecondary,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  colorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorSwatchActive: {
    borderColor: '#FFFFFF',
    transform: [{ scale: 1.15 }],
  },
  strokeOption: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: THEME.glass,
  },
  strokeOptionActive: {
    backgroundColor: 'rgba(0, 255, 102, 0.2)',
    borderWidth: 1,
    borderColor: '#00FF66',
  },
  strokePreview: {
    width: 30,
    borderRadius: 4,
    marginBottom: 4,
  },
  strokeLabel: {
    fontSize: 11,
    color: THEME.textSecondary,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.4,
  },
  // Text Input Modal
  textInputOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  textInputContainer: {
    width: '100%',
    backgroundColor: THEME.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: THEME.glassBorder,
  },
  textInputTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.textPrimary,
    marginBottom: 16,
  },
  textInput: {
    backgroundColor: THEME.glass,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: THEME.textPrimary,
    borderWidth: 1,
    borderColor: THEME.glassBorder,
    marginBottom: 16,
  },
  textInputActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  textInputCancel: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  textInputCancelText: {
    fontSize: 15,
    fontWeight: '600',
    color: THEME.textSecondary,
  },
  textInputConfirm: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#00FF66',
  },
  textInputConfirmText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#020617',
  },
});

export default PhotoEditor;