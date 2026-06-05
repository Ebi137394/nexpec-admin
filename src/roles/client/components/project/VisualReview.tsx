// src/components/client/project/VisualReview.tsx
import React, { useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Image,
  TouchableOpacity,
  TextInput,
  FlatList,
  Dimensions,
  ScrollView,
  ActivityIndicator,
  Alert,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface Pin {
  id: string;
  x: number; // 0–1 ratio relative to image width
  y: number; // 0–1 ratio relative to image height
  note: string;
  createdAt: string;
}

interface InspectionPhoto {
  id: string;
  uri: string;
  label: string;
  takenAt: string;
  pins: Pin[];
}

type ReviewVerdict = "approved" | "rejected" | "conditional";

interface VisualReviewProps {
  projectId: string;
  onVerdictSubmit?: (verdict: ReviewVerdict, notes: string) => void;
}

// ──────────────────────────────────────────────
// Seed Data
// ──────────────────────────────────────────────

const SEED_PHOTOS: InspectionPhoto[] = [
  {
    id: "photo-001",
    uri: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800",
    label: "Hull, Port Side",
    takenAt: "2025-06-20T09:30:00Z",
    pins: [],
  },
  {
    id: "photo-002",
    uri: "https://images.unsplash.com/photo-1559128010-7c1ad6e1b6a5?w=800",
    label: "Deck Surface, Forward",
    takenAt: "2025-06-20T09:45:00Z",
    pins: [],
  },
  {
    id: "photo-003",
    uri: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800",
    label: "Engine Bay, Overview",
    takenAt: "2025-06-20T10:00:00Z",
    pins: [],
  },
  {
    id: "photo-004",
    uri: "https://images.unsplash.com/photo-1575992254942-80e739fc81d3?w=800",
    label: "Keel, Starboard",
    takenAt: "2025-06-20T10:15:00Z",
    pins: [],
  },
  {
    id: "photo-005",
    uri: "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=800",
    label: "Stern Thruster Mount",
    takenAt: "2025-06-20T10:30:00Z",
    pins: [],
  },
  {
    id: "photo-006",
    uri: "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?w=800",
    label: "Waterline, Bow",
    takenAt: "2025-06-20T10:45:00Z",
    pins: [],
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const GALLERY_GAP = 10;
const GALLERY_PADDING = 16;
const THUMB_SIZE = (SCREEN_WIDTH - GALLERY_PADDING * 2 - GALLERY_GAP * 2) / 3;
const MODAL_IMAGE_WIDTH = SCREEN_WIDTH - 32;
const MODAL_IMAGE_HEIGHT = MODAL_IMAGE_WIDTH * 0.65;

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

const PinMarker: React.FC<{
  pin: Pin;
  imageWidth: number;
  imageHeight: number;
  onPress: (pin: Pin) => void;
}> = ({ pin, imageWidth, imageHeight, onPress }) => (
  <TouchableOpacity
    activeOpacity={0.7}
    onPress={() => onPress(pin)}
    style={[
      styles.pinMarker,
      {
        left: pin.x * imageWidth - 12,
        top: pin.y * imageHeight - 24,
      },
    ]}
    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
  >
    <Text style={styles.pinEmoji}>📍</Text>
  </TouchableOpacity>
);

const PinNoteInput: React.FC<{
  visible: boolean;
  onSubmit: (note: string) => void;
  onCancel: () => void;
}> = ({ visible, onSubmit, onCancel }) => {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (!text.trim()) {
      Alert.alert("Required", "Please enter a note for this pin.");
      return;
    }
    onSubmit(text.trim());
    setText("");
  };

  const handleCancel = () => {
    setText("");
    onCancel();
  };

  if (!visible) return null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.pinNoteOverlay}
    >
      <View style={styles.pinNoteCard}>
        <Text style={styles.pinNoteTitle}>📍 Add Observation</Text>
        <TextInput
          style={styles.pinNoteInput}
          placeholder='e.g. "Corrosion detected on weld seam"'
          placeholderTextColor="#8896AB"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={200}
          autoFocus
        />
        <View style={styles.pinNoteActions}>
          <TouchableOpacity style={styles.pinNoteCancelBtn} onPress={handleCancel}>
            <Text style={styles.pinNoteCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pinNoteSaveBtn} onPress={handleSubmit}>
            <Text style={styles.pinNoteSaveText}>Save Pin</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const VerdictBar: React.FC<{
  onVerdict: (verdict: ReviewVerdict) => void;
  disabled: boolean;
}> = ({ onVerdict, disabled }) => (
  <View style={styles.verdictBar}>
    <TouchableOpacity
      style={[styles.verdictBtn, styles.verdictApprove, disabled && styles.verdictDisabled]}
      onPress={() => onVerdict("approved")}
      disabled={disabled}
    >
      <Text style={styles.verdictBtnText}>✓ Approve</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.verdictBtn, styles.verdictConditional, disabled && styles.verdictDisabled]}
      onPress={() => onVerdict("conditional")}
      disabled={disabled}
    >
      <Text style={styles.verdictBtnTextDark}>⚠ Conditional</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.verdictBtn, styles.verdictReject, disabled && styles.verdictDisabled]}
      onPress={() => onVerdict("rejected")}
      disabled={disabled}
    >
      <Text style={styles.verdictBtnText}>✕ Reject</Text>
    </TouchableOpacity>
  </View>
);

// ──────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────

const VisualReview: React.FC<VisualReviewProps> = ({ projectId, onVerdictSubmit }) => {
  const [photos, setPhotos] = useState<InspectionPhoto[]>(SEED_PHOTOS);
  const [selectedPhoto, setSelectedPhoto] = useState<InspectionPhoto | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null);
  const [showPinInput, setShowPinInput] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPinDetail, setSelectedPinDetail] = useState<Pin | null>(null);

  // ── Gallery tap ──
  const openPhoto = useCallback((photo: InspectionPhoto) => {
    setSelectedPhoto(photo);
    setModalVisible(true);
    setSelectedPinDetail(null);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setSelectedPhoto(null);
    setPendingPin(null);
    setShowPinInput(false);
    setSelectedPinDetail(null);
  }, []);

  // ── Pin drop ──
  const handleImageTap = useCallback(
    (evt: any) => {
      if (showPinInput) return; // don't allow while input is open

      const { locationX, locationY } = evt.nativeEvent;
      const ratioX = locationX / MODAL_IMAGE_WIDTH;
      const ratioY = locationY / MODAL_IMAGE_HEIGHT;

      // Clamp
      const x = Math.max(0, Math.min(1, ratioX));
      const y = Math.max(0, Math.min(1, ratioY));

      setPendingPin({ x, y });
      setShowPinInput(true);
      setSelectedPinDetail(null);
    },
    [showPinInput]
  );

  const handlePinNoteSubmit = useCallback(
    (note: string) => {
      if (!pendingPin || !selectedPhoto) return;

      const newPin: Pin = {
        id: `pin-${Date.now()}`,
        x: pendingPin.x,
        y: pendingPin.y,
        note,
        createdAt: new Date().toISOString(),
      };

      setPhotos((prev) =>
        prev.map((p) => (p.id === selectedPhoto.id ? { ...p, pins: [...p.pins, newPin] } : p))
      );

      // Also update local selected photo so pin renders immediately
      setSelectedPhoto((prev) => (prev ? { ...prev, pins: [...prev.pins, newPin] } : prev));

      setPendingPin(null);
      setShowPinInput(false);
    },
    [pendingPin, selectedPhoto]
  );

  const handlePinNoteCancel = useCallback(() => {
    setPendingPin(null);
    setShowPinInput(false);
  }, []);

  // ── Pin tap (show detail) ──
  const handleExistingPinTap = useCallback((pin: Pin) => {
    setSelectedPinDetail((prev) => (prev?.id === pin.id ? null : pin));
  }, []);

  // ── Verdict ──
  const handleVerdict = useCallback(
    (verdict: ReviewVerdict) => {
      setSubmitting(true);
      // Simulate API
      setTimeout(() => {
        setSubmitting(false);
        const labels: Record<ReviewVerdict, string> = {
          approved: "Approved ✓",
          rejected: "Rejected ✕",
          conditional: "Approved with Conditions ⚠",
        };
        Alert.alert("Review Submitted", `Verdict: ${labels[verdict]}`, [
          { text: "OK", onPress: closeModal },
        ]);

        // Aggregate all pin notes as the "notes" payload
        const allNotes = photos
          .flatMap((p) => p.pins.map((pin) => `[${p.label}] ${pin.note}`))
          .join("\n");
        onVerdictSubmit?.(verdict, allNotes);
      }, 1500);
    },
    [closeModal, onVerdictSubmit, photos]
  );

  // ── Render helpers ──
  const renderThumbnail = ({ item }: { item: InspectionPhoto }) => (
    <TouchableOpacity
      activeOpacity={0.8}
      style={styles.thumbContainer}
      onPress={() => openPhoto(item)}
    >
      <Image source={{ uri: item.uri }} style={styles.thumbImage} />
      {item.pins.length > 0 && (
        <View style={styles.pinBadge}>
          <Text style={styles.pinBadgeText}>{item.pins.length}</Text>
        </View>
      )}
      <Text style={styles.thumbLabel} numberOfLines={1}>
        {item.label}
      </Text>
    </TouchableOpacity>
  );

  // Count total pins
  const totalPins = photos.reduce((sum, p) => sum + p.pins.length, 0);

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Visual Review</Text>
        <View style={styles.sectionMeta}>
          <Text style={styles.metaText}>
            {photos.length} photos • {totalPins} pins
          </Text>
        </View>
      </View>

      <Text style={styles.instruction}>Tap a photo to inspect and annotate.</Text>

      {/* Gallery Grid */}
      <FlatList
        data={photos}
        renderItem={renderThumbnail}
        keyExtractor={(item) => item.id}
        numColumns={3}
        scrollEnabled={false}
        columnWrapperStyle={styles.galleryRow}
        contentContainerStyle={styles.galleryContainer}
      />

      {/* ── Full-Screen Review Modal ── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <View style={styles.modalRoot}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeModal} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.modalTitle} numberOfLines={1}>
              {selectedPhoto?.label ?? "Review"}
            </Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView
            style={styles.modalScroll}
            contentContainerStyle={styles.modalScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Image with pins */}
            <View style={styles.imageWrapper}>
              <Pressable onPress={handleImageTap}>
                <Image
                  source={{ uri: selectedPhoto?.uri }}
                  style={styles.modalImage}
                  resizeMode="cover"
                />

                {/* Existing pins */}
                {selectedPhoto?.pins.map((pin) => (
                  <PinMarker
                    key={pin.id}
                    pin={pin}
                    imageWidth={MODAL_IMAGE_WIDTH}
                    imageHeight={MODAL_IMAGE_HEIGHT}
                    onPress={handleExistingPinTap}
                  />
                ))}

                {/* Pending pin (ghost) */}
                {pendingPin && (
                  <View
                    style={[
                      styles.pinMarker,
                      styles.pinGhost,
                      {
                        left: pendingPin.x * MODAL_IMAGE_WIDTH - 12,
                        top: pendingPin.y * MODAL_IMAGE_HEIGHT - 24,
                      },
                    ]}
                  >
                    <Text style={styles.pinEmoji}>📍</Text>
                  </View>
                )}
              </Pressable>

              <Text style={styles.tapHint}>Tap on the image to drop a pin</Text>
            </View>

            {/* Pin Detail Tooltip */}
            {selectedPinDetail && (
              <View style={styles.pinDetailCard}>
                <Text style={styles.pinDetailLabel}>📍 Pin Note</Text>
                <Text style={styles.pinDetailNote}>{selectedPinDetail.note}</Text>
                <Text style={styles.pinDetailTime}>
                  {new Date(selectedPinDetail.createdAt).toLocaleTimeString()}
                </Text>
              </View>
            )}

            {/* Pin list for this photo */}
            {selectedPhoto && selectedPhoto.pins.length > 0 && (
              <View style={styles.pinListSection}>
                <Text style={styles.pinListTitle}>
                  Annotations ({selectedPhoto.pins.length})
                </Text>
                {selectedPhoto.pins.map((pin, idx) => (
                  <TouchableOpacity
                    key={pin.id}
                    style={styles.pinListItem}
                    onPress={() => handleExistingPinTap(pin)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.pinListIndex}>{idx + 1}</Text>
                    <View style={styles.pinListContent}>
                      <Text style={styles.pinListNote}>{pin.note}</Text>
                      <Text style={styles.pinListCoords}>
                        x: {(pin.x * 100).toFixed(0)}%, y: {(pin.y * 100).toFixed(0)}%
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Verdict Buttons */}
            <View style={styles.verdictSection}>
              <Text style={styles.verdictSectionTitle}>Submit Review Decision</Text>
              {submitting ? (
                <View style={styles.verdictLoading}>
                  <ActivityIndicator size="large" color="#0A84FF" />
                  <Text style={styles.verdictLoadingText}>Submitting verdict…</Text>
                </View>
              ) : (
                <VerdictBar onVerdict={handleVerdict} disabled={submitting} />
              )}
            </View>
          </ScrollView>

          {/* Pin Note Input Overlay */}
          <PinNoteInput
            visible={showPinInput}
            onSubmit={handlePinNoteSubmit}
            onCancel={handlePinNoteCancel}
          />
        </View>
      </Modal>
    </View>
  );
};

// ──────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  sectionMeta: {
    backgroundColor: "rgba(10,132,255,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  metaText: {
    fontSize: 12,
    color: "#0A84FF",
    fontWeight: "600",
  },
  instruction: {
    fontSize: 13,
    color: "#8896AB",
    marginBottom: 12,
  },

  // Gallery
  galleryContainer: {
    gap: GALLERY_GAP,
  },
  galleryRow: {
    gap: GALLERY_GAP,
  },
  thumbContainer: {
    width: THUMB_SIZE,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#1C2A3A",
  },
  thumbImage: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 10,
  },
  thumbLabel: {
    fontSize: 11,
    color: "#C8D2DD",
    paddingHorizontal: 6,
    paddingVertical: 5,
    fontWeight: "500",
  },
  pinBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "#FF3B30",
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  pinBadgeText: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "700",
  },

  // Modal
  modalRoot: {
    flex: 1,
    backgroundColor: "#0D1B2A",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 56 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  modalClose: {
    fontSize: 20,
    color: "#8896AB",
    fontWeight: "600",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    flex: 1,
    textAlign: "center",
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  // Image
  imageWrapper: {
    position: "relative",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#1C2A3A",
    marginBottom: 16,
  },
  modalImage: {
    width: MODAL_IMAGE_WIDTH,
    height: MODAL_IMAGE_HEIGHT,
    borderRadius: 12,
  },
  tapHint: {
    textAlign: "center",
    fontSize: 12,
    color: "#5A6A7E",
    paddingVertical: 8,
    fontStyle: "italic",
  },

  // Pin markers
  pinMarker: {
    position: "absolute",
    zIndex: 10,
  },
  pinGhost: {
    opacity: 0.5,
  },
  pinEmoji: {
    fontSize: 22,
  },

  // Pin detail tooltip
  pinDetailCard: {
    backgroundColor: "#1C2A3A",
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    borderLeftWidth: 3,
    borderLeftColor: "#FF3B30",
  },
  pinDetailLabel: {
    fontSize: 13,
    color: "#FF6B6B",
    fontWeight: "700",
    marginBottom: 4,
  },
  pinDetailNote: {
    fontSize: 14,
    color: "#FFFFFF",
    lineHeight: 20,
  },
  pinDetailTime: {
    fontSize: 11,
    color: "#5A6A7E",
    marginTop: 6,
  },

  // Pin list
  pinListSection: {
    marginBottom: 24,
  },
  pinListTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#C8D2DD",
    marginBottom: 10,
  },
  pinListItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#1C2A3A",
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  pinListIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255,59,48,0.15)",
    color: "#FF3B30",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 24,
    marginRight: 10,
    overflow: "hidden",
  },
  pinListContent: {
    flex: 1,
  },
  pinListNote: {
    fontSize: 13,
    color: "#FFFFFF",
    marginBottom: 2,
  },
  pinListCoords: {
    fontSize: 11,
    color: "#5A6A7E",
  },

  // Pin note input overlay
  pinNoteOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    padding: 16,
    paddingBottom: Platform.OS === "ios" ? 34 : 16,
  },
  pinNoteCard: {
    backgroundColor: "#1C2A3A",
    borderRadius: 14,
    padding: 16,
  },
  pinNoteTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 10,
  },
  pinNoteInput: {
    backgroundColor: "#0D1B2A",
    borderRadius: 10,
    padding: 12,
    color: "#FFFFFF",
    fontSize: 14,
    minHeight: 60,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 12,
  },
  pinNoteActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  pinNoteCancelBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  pinNoteCancelText: {
    color: "#8896AB",
    fontSize: 14,
    fontWeight: "600",
  },
  pinNoteSaveBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#0A84FF",
  },
  pinNoteSaveText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },

  // Verdict
  verdictSection: {
    marginTop: 8,
  },
  verdictSectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 14,
  },
  verdictBar: {
    flexDirection: "row",
    gap: 8,
  },
  verdictBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  verdictApprove: {
    backgroundColor: "#30D158",
  },
  verdictConditional: {
    backgroundColor: "#FFD60A",
  },
  verdictReject: {
    backgroundColor: "#FF3B30",
  },
  verdictDisabled: {
    opacity: 0.4,
  },
  verdictBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  verdictBtnTextDark: {
    color: "#1C1C1E",
    fontSize: 13,
    fontWeight: "700",
  },
  verdictLoading: {
    alignItems: "center",
    paddingVertical: 20,
  },
  verdictLoadingText: {
    color: "#8896AB",
    fontSize: 13,
    marginTop: 10,
  },
});

export default VisualReview;