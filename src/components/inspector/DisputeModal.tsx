import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

/* ──────────────────────────── TYPES ──────────────────────────── */

export interface DisputeModalProps {
  visible: boolean;
  /** Optional pre‑filled project/contract reference */
  projectRef?: string;
  /** Called after successful submission with the generated dispute id */
  onSubmitted?: (disputeId: string) => void;
  /** Called when the modal is dismissed without submitting */
  onClose: () => void;
}

/* Dropdown reason options */
interface ReasonOption {
  key: string;
  label: string;
  icon: string;
}

const REASONS: ReasonOption[] = [
  { key: "unresponsive", label: "Client Unresponsive", icon: "📵" },
  { key: "payment",      label: "Payment Issue",       icon: "💳" },
  { key: "scope_creep",  label: "Scope Creep",         icon: "📐" },
  { key: "quality",      label: "Quality Concern",     icon: "🔍" },
  { key: "timeline",     label: "Missed Deadline",     icon: "⏰" },
  { key: "safety",       label: "Safety Violation",    icon: "⚠️" },
  { key: "other",        label: "Other",               icon: "📝" },
];

/* ────────────────────────── CONSTANTS ─────────────────────────── */

const ACCENT    = "#DC2626"; // red — serious / legal feel
const ACCENT_BG = "#FEF2F2";
const DARK_BG   = "#0F0F14";
const CARD_BG   = "#18181B";
const INPUT_BG  = "#27272A";
const BORDER    = "#3F3F46";
const MUTED     = "#A1A1AA";
const WHITE     = "#FAFAFA";

/* ───────────────── CUSTOM DROPDOWN (sub‑component) ───────────── */

const Dropdown: React.FC<{
  options: ReasonOption[];
  selected: ReasonOption | null;
  onSelect: (opt: ReasonOption) => void;
  error?: boolean;
}> = ({ options, selected, onSelect, error }) => {
  const [open, setOpen] = useState(false);
  const animHeight = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    Keyboard.dismiss();
    if (open) {
      Animated.timing(animHeight, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start(() => setOpen(false));
    } else {
      setOpen(true);
      Animated.timing(animHeight, {
        toValue: options.length * 48,
        duration: 250,
        useNativeDriver: false,
      }).start();
    }
  };

  const pick = (opt: ReasonOption) => {
    onSelect(opt);
    Animated.timing(animHeight, {
      toValue: 0,
      duration: 180,
      useNativeDriver: false,
    }).start(() => setOpen(false));
  };

  return (
    <View style={{ zIndex: 20 }}>
      <Pressable
        style={[
          styles.dropdownTrigger,
          open && styles.dropdownTriggerOpen,
          error && styles.inputError,
        ]}
        onPress={toggle}
      >
        <Text
          style={[
            styles.dropdownTriggerText,
            !selected && { color: MUTED },
          ]}
        >
          {selected ? `${selected.icon}  ${selected.label}` : "Select a reason…"}
        </Text>
        <Text style={styles.chevron}>{open ? "▲" : "▼"}</Text>
      </Pressable>

      {open && (
        <Animated.View style={[styles.dropdownList, { maxHeight: animHeight }]}>
          <ScrollView nestedScrollEnabled bounces={false}>
            {options.map((opt) => {
              const active = selected?.key === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                  onPress={() => pick(opt)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.dropdownIcon}>{opt.icon}</Text>
                  <Text
                    style={[
                      styles.dropdownItemText,
                      active && styles.dropdownItemTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {active && <Text style={styles.checkMark}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
};

/* ───────────────── FILE PICKER PLACEHOLDER ───────────────────── */

const EvidencePicker: React.FC<{
  files: string[];
  onAdd: () => void;
  onRemove: (idx: number) => void;
}> = ({ files, onAdd, onRemove }) => (
  <View>
    <Pressable style={styles.filePickerBtn} onPress={onAdd}>
      <Text style={styles.filePickerIcon}>📎</Text>
      <Text style={styles.filePickerText}>Attach Evidence (Screenshots / PDFs)</Text>
    </Pressable>

    {files.length > 0 && (
      <View style={styles.fileList}>
        {files.map((f, i) => (
          <View key={i} style={styles.fileChip}>
            <Text style={styles.fileChipText} numberOfLines={1}>
              📄 {f}
            </Text>
            <Pressable onPress={() => onRemove(i)} hitSlop={8}>
              <Text style={styles.fileRemove}>✕</Text>
            </Pressable>
          </View>
        ))}
      </View>
    )}
  </View>
);

/* ──────────────────── MAIN COMPONENT ─────────────────────────── */

const DisputeModal: React.FC<DisputeModalProps> = ({
  visible,
  projectRef,
  onSubmitted,
  onClose,
}) => {
  /* ── state ── */
  const [reason, setReason]       = useState<ReasonOption | null>(null);
  const [statement, setStatement] = useState("");
  const [files, setFiles]         = useState<string[]>([]);
  const [errors, setErrors]       = useState<{ reason?: boolean; statement?: boolean }>({});
  const [submitting, setSubmitting] = useState(false);

  /* ── animations ── */
  const slideAnim = useRef(new Animated.Value(60)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 10,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      slideAnim.setValue(60);
      fadeAnim.setValue(0);
      // reset form
      setReason(null);
      setStatement("");
      setFiles([]);
      setErrors({});
      setSubmitting(false);
    }
  }, [visible]);

  /* ── handlers ── */
  const handleAddFile = useCallback(() => {
    // Mock: in production hook up expo-document-picker / react-native-document-picker
    const mockNames = [
      "screenshot_2024-06-12.png",
      "invoice_final.pdf",
      "chat_log.pdf",
      "photo_evidence.jpg",
    ];
    const next = mockNames[files.length % mockNames.length];
    setFiles((f) => [...f, next]);
  }, [files]);

  const handleRemoveFile = useCallback((idx: number) => {
    setFiles((f) => f.filter((_, i) => i !== idx));
  }, []);

  const validate = (): boolean => {
    const e: typeof errors = {};
    if (!reason) e.reason = true;
    if (statement.trim().length < 10) e.statement = true;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = useCallback(() => {
    if (!validate()) return;

    setSubmitting(true);

    // Simulate network delay
    setTimeout(() => {
      const disputeId = `DSP-${Date.now().toString(36).toUpperCase()}`;

      // Close modal first, then show alert
      onClose();

      setTimeout(() => {
        Alert.alert(
          "Dispute Submitted",
          `Your case has been filed successfully.\n\nDispute ID: ${disputeId}\nReason: ${reason!.label}\nEvidence files: ${files.length}\n\nOur team will review your case within 48 hours.`,
          [{ text: "OK", style: "default" }]
        );
        onSubmitted?.(disputeId);
      }, 350);

      setSubmitting(false);
    }, 800);
  }, [reason, statement, files, onClose, onSubmitted]);

  /* ── urgency badge color derived from reason ── */
  const urgencyColor =
    reason?.key === "safety"
      ? "#EF4444"
      : reason?.key === "payment"
      ? "#F59E0B"
      : ACCENT;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View
          style={[
            styles.card,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* ── Header ── */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.headerDot, { backgroundColor: urgencyColor }]} />
              <View>
                <Text style={styles.headerTitle}>Open Dispute Case</Text>
                {projectRef && (
                  <Text style={styles.headerSub}>Project: {projectRef}</Text>
                )}
              </View>
            </View>
            <Pressable onPress={onClose} hitSlop={14} style={styles.headerClose}>
              <Text style={styles.headerCloseTxt}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.headerDivider} />

          {/* ── Scrollable form ── */}
          <ScrollView
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Reason */}
            <Text style={styles.fieldLabel}>
              REASON <Text style={styles.required}>*</Text>
            </Text>
            <Dropdown
              options={REASONS}
              selected={reason}
              onSelect={(opt) => {
                setReason(opt);
                setErrors((e) => ({ ...e, reason: false }));
              }}
              error={errors.reason}
            />
            {errors.reason && (
              <Text style={styles.errorText}>Please select a dispute reason.</Text>
            )}

            {/* Evidence */}
            <Text style={[styles.fieldLabel, { marginTop: 22 }]}>EVIDENCE</Text>
            <EvidencePicker
              files={files}
              onAdd={handleAddFile}
              onRemove={handleRemoveFile}
            />

            {/* Statement */}
            <Text style={[styles.fieldLabel, { marginTop: 22 }]}>
              YOUR STATEMENT <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={[
                styles.textArea,
                errors.statement && styles.inputError,
              ]}
              placeholder="Describe the issue in detail. Include dates, communications, and any relevant context…"
              placeholderTextColor="#52525B"
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              value={statement}
              onChangeText={(t) => {
                setStatement(t);
                if (t.trim().length >= 10) setErrors((e) => ({ ...e, statement: false }));
              }}
              maxLength={2000}
            />
            <Text style={styles.charCount}>{statement.length} / 2000</Text>
            {errors.statement && (
              <Text style={styles.errorText}>
                Statement must be at least 10 characters.
              </Text>
            )}

            {/* Disclaimer */}
            <View style={styles.disclaimerBox}>
              <Text style={styles.disclaimerIcon}>⚖️</Text>
              <Text style={styles.disclaimerText}>
                All dispute cases are reviewed by our mediation team within 48
                hours. False claims may result in account penalties.
              </Text>
            </View>
          </ScrollView>

          {/* ── Footer actions ── */}
          <View style={styles.footer}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnTxt}>Cancel</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.submitBtn,
                pressed && styles.submitBtnPressed,
                submitting && styles.submitBtnDisabled,
              ]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={styles.submitBtnTxt}>
                {submitting ? "Submitting…" : "Submit Case"}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default DisputeModal;

/* ──────────────────────── STYLES ──────────────────────────────── */

const styles = StyleSheet.create({
  /* overlay */
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 14,
  },

  /* card */
  card: {
    width: "100%",
    maxWidth: 500,
    maxHeight: "90%",
    backgroundColor: CARD_BG,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: BORDER,
    ...Platform.select({
      ios: {
        shadowColor: ACCENT,
        shadowOpacity: 0.15,
        shadowRadius: 30,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 20 },
    }),
  },

  /* header */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  headerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: WHITE,
  },
  headerSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  headerClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: INPUT_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCloseTxt: { color: MUTED, fontSize: 14 },
  headerDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: 20,
  },

  /* form */
  formContent: {
    padding: 20,
    paddingBottom: 10,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: MUTED,
    letterSpacing: 1.4,
    marginBottom: 8,
  },
  required: { color: ACCENT },

  /* dropdown */
  dropdownTrigger: {
    backgroundColor: INPUT_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownTriggerOpen: {
    borderColor: ACCENT,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  dropdownTriggerText: {
    fontSize: 14,
    color: WHITE,
  },
  chevron: { fontSize: 10, color: MUTED },
  dropdownList: {
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: ACCENT,
    borderBottomLeftRadius: 10,
    borderBottomRightRadius: 10,
    overflow: "hidden",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  dropdownItemActive: {
    backgroundColor: "rgba(220,38,38,0.1)",
  },
  dropdownIcon: { fontSize: 16 },
  dropdownItemText: { fontSize: 14, color: WHITE, flex: 1 },
  dropdownItemTextActive: { color: ACCENT, fontWeight: "600" },
  checkMark: { color: ACCENT, fontSize: 14, fontWeight: "700" },

  /* file picker */
  filePickerBtn: {
    borderWidth: 1.5,
    borderColor: BORDER,
    borderStyle: "dashed",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  filePickerIcon: { fontSize: 18 },
  filePickerText: { color: MUTED, fontSize: 13 },
  fileList: { marginTop: 10, gap: 6 },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: INPUT_BG,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    justifyContent: "space-between",
  },
  fileChipText: { color: WHITE, fontSize: 13, flex: 1, marginRight: 8 },
  fileRemove: { color: ACCENT, fontSize: 14, fontWeight: "700" },

  /* text area */
  textArea: {
    backgroundColor: INPUT_BG,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    color: WHITE,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 130,
  },
  charCount: {
    fontSize: 11,
    color: MUTED,
    textAlign: "right",
    marginTop: 4,
  },

  /* validation */
  inputError: { borderColor: ACCENT },
  errorText: { color: ACCENT, fontSize: 12, marginTop: 4 },

  /* disclaimer */
  disclaimerBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(220,38,38,0.06)",
    padding: 12,
    borderRadius: 8,
    marginTop: 20,
    gap: 10,
  },
  disclaimerIcon: { fontSize: 18, marginTop: 1 },
  disclaimerText: { flex: 1, fontSize: 12, color: MUTED, lineHeight: 18 },

  /* footer */
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    gap: 10,
  },
  cancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  cancelBtnTxt: { color: MUTED, fontSize: 14, fontWeight: "600" },
  submitBtn: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: ACCENT,
  },
  submitBtnPressed: { opacity: 0.85 },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnTxt: { color: "#fff", fontSize: 14, fontWeight: "700" },
});