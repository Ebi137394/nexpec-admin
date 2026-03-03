import React, { useCallback, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type PanResponderGestureState,
} from "react-native";
import Svg, { Path, Circle } from "react-native-svg";

/* ──────────────────────────── TYPES ──────────────────────────── */

interface Party {
  role: string;   // e.g. "Client", "Inspector", "Contractor"
  name: string;
  email?: string;
}

interface ContractClause {
  title: string;
  body: string;
}

export interface SmartContractProps {
  /** Controls modal visibility */
  visible: boolean;
  /** Project title */
  projectTitle: string;
  /** High‑level scope description */
  projectScope: string;
  /** Detailed clause list (optional) */
  clauses?: ContractClause[];
  /** Agreed price in display‑ready string e.g. "$12,500.00" */
  agreedPrice: string;
  /** Currency label shown next to price */
  currency?: string;
  /** Date string shown on the contract header */
  contractDate?: string;
  /** Unique contract / reference ID */
  contractId?: string;
  /** Parties involved */
  parties: Party[];
  /** Fires when the user successfully signs; receives base‑64 of SVG path data */
  onSigned: (signatureData: string) => void;
  /** Fires when the user dismisses without signing */
  onClose: () => void;
}

/* ────────────────────────── CONSTANTS ─────────────────────────── */

const { width: SCREEN_W } = Dimensions.get("window");
const PAD_HEIGHT = 160;
const ACCENT = "#1A73E8";
const DARK_BG = "#121217";
const PAPER_BG = "#FDFDFD";
const BORDER = "#D4D4D8";
const MUTED = "#71717A";
const ERROR_RED = "#EF4444";

/* ─────────────────── SIGNATURE PAD (sub‑component) ───────────── */

/**
 * A self‑contained drawing surface built entirely with PanResponder + SVG.
 * Collects an array of polyline paths and exposes them via `onEnd`.
 */
interface SigPadHandle {
  clear: () => void;
  toData: () => string;
  isEmpty: () => boolean;
}

const SignaturePad = React.forwardRef<SigPadHandle, { height?: number }>(
  ({ height = PAD_HEIGHT }, ref) => {
    const [paths, setPaths] = useState<string[]>([]);
    const currentPath = useRef<string>("");
    const [, forceRender] = useState(0);

    // Offset of the SVG container relative to screen so we can
    // translate page‑level touches → local coords.
    const layoutOffset = useRef({ x: 0, y: 0 });

    const handleLayout = (e: LayoutChangeEvent) => {
      // Measure position once (and on layout changes)
      (e.target as any)?.measureInWindow?.(
        (x: number, y: number) => {
          layoutOffset.current = { x, y };
        }
      );
    };

    /* ---- helpers ---- */
    const localCoords = (
      evt: GestureResponderEvent,
      _gs: PanResponderGestureState
    ) => {
      const x = evt.nativeEvent.locationX;
      const y = evt.nativeEvent.locationY;
      return { x, y };
    };

    /* ---- PanResponder ---- */
    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt, gs) => {
          const { x, y } = localCoords(evt, gs);
          currentPath.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
          forceRender((n) => n + 1);
        },
        onPanResponderMove: (evt, gs) => {
          const { x, y } = localCoords(evt, gs);
          currentPath.current += ` L${x.toFixed(1)},${y.toFixed(1)}`;
          forceRender((n) => n + 1);
        },
        onPanResponderRelease: () => {
          if (currentPath.current) {
            setPaths((p) => [...p, currentPath.current]);
            currentPath.current = "";
          }
        },
      })
    ).current;

    /* ---- Imperative handle ---- */
    React.useImperativeHandle(ref, () => ({
      clear: () => {
        setPaths([]);
        currentPath.current = "";
      },
      toData: () => JSON.stringify([...paths, currentPath.current].filter(Boolean)),
      isEmpty: () => paths.length === 0 && !currentPath.current,
    }));

    return (
      <View
        style={[styles.sigBox, { height }]}
        onLayout={handleLayout}
        {...panResponder.panHandlers}
      >
        {/* Placeholder label */}
        {paths.length === 0 && !currentPath.current && (
          <Text style={styles.sigPlaceholder}>Sign here ✍️</Text>
        )}

        <Svg style={StyleSheet.absoluteFill} height={height} width="100%">
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke="#1e1e1e"
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {currentPath.current ? (
            <Path
              d={currentPath.current}
              stroke="#1e1e1e"
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </Svg>
      </View>
    );
  }
);

/* ──────────────────── MAIN COMPONENT ─────────────────────────── */

const SmartContract: React.FC<SmartContractProps> = ({
  visible,
  projectTitle,
  projectScope,
  clauses = [],
  agreedPrice,
  currency = "USD",
  contractDate,
  contractId,
  parties,
  onSigned,
  onClose,
}) => {
  const sigRef = useRef<SigPadHandle>(null);
  const [signing, setSigning] = useState(false);
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  /* entrance animation */
  React.useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 60,
          friction: 9,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      scaleAnim.setValue(0.92);
      opacityAnim.setValue(0);
      setSigning(false);
    }
  }, [visible]);

  /* ---- Sign handler ---- */
  const handleSign = useCallback(() => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      setSigning(true);
      return; // show validation hint
    }
    const data = sigRef.current.toData();
    onSigned(data);
  }, [onSigned]);

  /* ---- helpers ---- */
  const today = contractDate ?? new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const refId = contractId ?? `SC-${Date.now().toString(36).toUpperCase()}`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.modalCard,
            { opacity: opacityAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* ── Close button ── */}
          <Pressable
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={12}
            accessibilityLabel="Close contract"
          >
            <Text style={styles.closeTxt}>✕</Text>
          </Pressable>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* ═══════ PAPER START ═══════ */}
            <View style={styles.paper}>
              {/* Header */}
              <View style={styles.paperHeader}>
                <View style={styles.seal}>
                  <Svg width={36} height={36} viewBox="0 0 36 36">
                    <Circle cx={18} cy={18} r={16} stroke={ACCENT} strokeWidth={2} fill="none" />
                    <Circle cx={18} cy={18} r={10} stroke={ACCENT} strokeWidth={1.2} fill="none" />
                    <Path d="M18 8 L20 16 L28 18 L20 20 L18 28 L16 20 L8 18 L16 16 Z" fill={ACCENT} />
                  </Svg>
                </View>
                <Text style={styles.paperTitle}>SMART CONTRACT</Text>
                <Text style={styles.refId}>Ref: {refId}</Text>
                <Text style={styles.dateLine}>{today}</Text>
              </View>

              <View style={styles.divider} />

              {/* Parties */}
              <Text style={styles.sectionLabel}>PARTIES</Text>
              {parties.map((p, i) => (
                <View key={i} style={styles.partyRow}>
                  <Text style={styles.partyRole}>{p.role}</Text>
                  <Text style={styles.partyName}>{p.name}</Text>
                  {p.email && <Text style={styles.partyEmail}>{p.email}</Text>}
                </View>
              ))}

              <View style={styles.divider} />

              {/* Scope */}
              <Text style={styles.sectionLabel}>PROJECT SCOPE</Text>
              <Text style={styles.bodyText}>{projectScope}</Text>

              {/* Clauses */}
              {clauses.length > 0 && (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.sectionLabel}>TERMS & CONDITIONS</Text>
                  {clauses.map((c, i) => (
                    <View key={i} style={styles.clauseBlock}>
                      <Text style={styles.clauseTitle}>
                        {i + 1}. {c.title}
                      </Text>
                      <Text style={styles.bodyText}>{c.body}</Text>
                    </View>
                  ))}
                </>
              )}

              <View style={styles.divider} />

              {/* Price */}
              <Text style={styles.sectionLabel}>AGREED COMPENSATION</Text>
              <View style={styles.priceBox}>
                <Text style={styles.priceLabel}>{currency}</Text>
                <Text style={styles.priceValue}>{agreedPrice}</Text>
              </View>

              <View style={styles.divider} />

              {/* Signature */}
              <Text style={styles.sectionLabel}>E‑SIGNATURE</Text>
              <Text style={styles.sigInstructions}>
                By signing below you acknowledge and accept all terms above.
              </Text>

              <SignaturePad ref={sigRef} />

              {signing && (
                <Text style={styles.validationHint}>
                  ⚠ Please provide your signature before accepting.
                </Text>
              )}

              {/* Clear / Sign buttons */}
              <View style={styles.actionRow}>
                <Pressable
                  style={styles.clearBtn}
                  onPress={() => {
                    sigRef.current?.clear();
                    setSigning(false);
                  }}
                >
                  <Text style={styles.clearBtnTxt}>Clear</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.signBtn,
                    pressed && styles.signBtnPressed,
                  ]}
                  onPress={handleSign}
                >
                  <Text style={styles.signBtnTxt}>Sign & Accept ✓</Text>
                </Pressable>
              </View>

              {/* Footer disclaimer */}
              <Text style={styles.disclaimer}>
                This digital agreement is generated for demonstration purposes.
                In a production environment, all signatures would be
                cryptographically verified and stored on‑chain.
              </Text>
            </View>
            {/* ═══════ PAPER END ═══════ */}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

export default SmartContract;

/* ──────────────────────── STYLES ──────────────────────────────── */

const styles = StyleSheet.create({
  /* overlay & modal */
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "92%",
    backgroundColor: DARK_BG,
    borderRadius: 18,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.45,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 8 },
      },
      android: { elevation: 24 },
    }),
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 14,
    zIndex: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeTxt: { color: "#aaa", fontSize: 16 },
  scrollContent: {
    padding: 18,
    paddingTop: 48,
    paddingBottom: 24,
  },

  /* paper */
  paper: {
    backgroundColor: PAPER_BG,
    borderRadius: 8,
    padding: 26,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.08,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
      },
      android: { elevation: 3 },
    }),
  },
  paperHeader: { alignItems: "center", marginBottom: 8 },
  seal: { marginBottom: 8 },
  paperTitle: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 3,
    color: "#1e1e1e",
    marginBottom: 4,
  },
  refId: { fontSize: 11, color: MUTED, letterSpacing: 1 },
  dateLine: { fontSize: 12, color: MUTED, marginTop: 2 },

  /* dividers */
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 18,
  },

  /* sections */
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.8,
    color: ACCENT,
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 13.5,
    lineHeight: 21,
    color: "#3f3f46",
  },

  /* parties */
  partyRow: {
    marginBottom: 10,
    paddingLeft: 8,
    borderLeftWidth: 3,
    borderLeftColor: ACCENT,
  },
  partyRole: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    color: MUTED,
    textTransform: "uppercase",
  },
  partyName: { fontSize: 14, fontWeight: "600", color: "#1e1e1e" },
  partyEmail: { fontSize: 12, color: MUTED },

  /* clauses */
  clauseBlock: { marginBottom: 12 },
  clauseTitle: { fontSize: 13, fontWeight: "700", color: "#27272a", marginBottom: 2 },

  /* price */
  priceBox: {
    flexDirection: "row",
    alignItems: "baseline",
    backgroundColor: "#F0F7FF",
    padding: 14,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  priceLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: ACCENT,
    marginRight: 6,
  },
  priceValue: {
    fontSize: 26,
    fontWeight: "800",
    color: "#1e1e1e",
  },

  /* signature pad */
  sigInstructions: {
    fontSize: 12,
    color: MUTED,
    marginBottom: 10,
    fontStyle: "italic",
  },
  sigBox: {
    borderWidth: 1.5,
    borderColor: BORDER,
    borderStyle: "dashed",
    borderRadius: 8,
    backgroundColor: "#FAFAFA",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  sigPlaceholder: {
    position: "absolute",
    color: "#ccc",
    fontSize: 16,
  },
  validationHint: {
    color: ERROR_RED,
    fontSize: 12,
    marginTop: 6,
  },

  /* actions */
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: 16,
    gap: 10,
  },
  clearBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  clearBtnTxt: { fontSize: 13, color: MUTED, fontWeight: "600" },
  signBtn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: ACCENT,
  },
  signBtnPressed: { opacity: 0.82 },
  signBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "700" },

  /* disclaimer */
  disclaimer: {
    marginTop: 20,
    fontSize: 10,
    color: "#a1a1aa",
    textAlign: "center",
    lineHeight: 15,
  },
});