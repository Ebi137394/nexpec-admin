// ════════════════════════════════════════════════════════════════════════════
//  app/ai-coinspector.tsx — the standalone AI Co-Inspector capture-review flow
//
//  pick/capture image → EXPLICITLY select a model (Corrosion / Weld) → run the
//  on-device YOLO26-seg model for that domain (SegModelManager, offline) → review
//  the segmentation overlay. Tap a polygon to refine, long-press to remove; each
//  edit persists a Provable-AI feedback record tied to the SAME shared-registry
//  model identity (slug + version + SHA-256) used by the web app — no placeholder,
//  no silent fallback. Pass ?jobId=… to make the overlay editable + persist.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { ML_RUNTIME_ENABLED } from '@/src/core/ml';
import { SegModelManager, type SegMode } from '@/src/core/ml/vision/segModelManager';
import { SegOverlay, type SegOverlayDetection } from '@/src/core/ml/vision/SegOverlay';
import { enabledModels } from '@nexpec/shared-core';

const COLORS = {
  bg: '#0B1020', card: '#161C36', border: '#2A3354', primary: '#8B5CF6',
  mint: '#34D399', red: '#F87171', text: '#F1F5F9', muted: '#9AA8C7', dim: '#64748B',
};

// The launch-enabled segmentation models, from the SHARED registry, that map to
// an on-device seg mode. Adding one to the registry surfaces it here + on web.
const SEG_MODELS = enabledModels().filter(
  (m) => m.task === 'instance-segmentation' && (m.mode === 'corrosion' || m.mode === 'weld'),
);

export default function AiCoInspectorScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId?: string }>();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [mode, setMode] = useState<SegMode>((SEG_MODELS[0]?.mode as SegMode) ?? 'corrosion');
  const [segDetections, setSegDetections] = useState<SegOverlayDetection[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const activeModel = useMemo(() => SEG_MODELS.find((m) => m.mode === mode), [mode]);

  const pickImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setNote('Media-library permission denied.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
      if (!res.canceled && res.assets?.[0]?.uri) {
        setImageUri(res.assets[0].uri);
        setSegDetections([]); setNote(null);
      }
    } catch (e) { setNote((e as Error)?.message ?? 'image pick failed'); }
  }, []);

  const analyze = useCallback(async () => {
    if (!imageUri) { setNote('Pick an image first.'); return; }
    if (!SegModelManager.available()) {
      setNote('On-device model needs a dev build with the ML runtime (fast-tflite + Skia).');
      return;
    }
    setAnalyzing(true); setNote(null); setSegDetections([]);
    try {
      const r = await SegModelManager.analyze(imageUri, mode);
      setSegDetections(r.detections);
      const n = r.detections.length;
      setNote(
        n
          ? `${n} region${n === 1 ? '' : 's'} detected by ${activeModel?.displayName ?? mode}` +
            (jobId ? '. Tap a polygon to refine, long-press to remove.' : '.')
          : 'No regions above the confidence threshold.',
      );
    } catch (e) { setNote((e as Error)?.message ?? 'analysis failed'); }
    finally { setAnalyzing(false); }
  }, [imageUri, mode, activeModel, jobId]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>AI Co-Inspector</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {!ML_RUNTIME_ENABLED ? (
          <View style={[styles.card, { borderColor: COLORS.red }]}>
            <Text style={styles.cardTitle}>Runtime disabled</Text>
            <Text style={styles.cardBody}>Start a dev build with EXPO_PUBLIC_ML_RUNTIME=1 and the signing pubkey set.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.subtitle}>
              {jobId ? `Job ${String(jobId).slice(0, 8)}…, edits are sealed` : 'Demo mode, no job linked (overlay is read-only)'}
            </Text>

            {/* Explicit model selection — drives which on-device seg model runs. */}
            <Text style={styles.selLabel}>Model</Text>
            <View style={styles.selRow}>
              {SEG_MODELS.map((m) => {
                const on = m.mode === mode;
                return (
                  <TouchableOpacity
                    key={m.slug}
                    onPress={() => { setMode(m.mode as SegMode); setSegDetections([]); }}
                    style={[styles.chip, on && styles.chipOn]}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{m.displayName}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {activeModel && (
              <Text style={styles.hint}>{activeModel.slug} v{activeModel.version} · {activeModel.inputSize}px · on-device</Text>
            )}

            <TouchableOpacity style={styles.pick} onPress={pickImage} activeOpacity={0.85}>
              {imageUri ? (
                <View style={StyleSheet.absoluteFill}>
                  <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                  <SegOverlay
                    imageUri={imageUri}
                    detections={segDetections}
                    jobId={jobId ? String(jobId) : undefined}
                    captureId={null}
                    mode={mode}
                  />
                </View>
              ) : (
                <View style={styles.pickEmpty}>
                  <Ionicons name="camera-outline" size={28} color={COLORS.muted} />
                  <Text style={styles.pickText}>Tap to pick an inspection photo</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, (analyzing || !imageUri) && { opacity: 0.5 }]}
              onPress={analyze}
              disabled={analyzing || !imageUri}
              activeOpacity={0.85}
            >
              {analyzing ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Analyze with AI Co-Inspector</Text>}
            </TouchableOpacity>

            {!!note && <Text style={styles.note}>{note}</Text>}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  body: { padding: 16, paddingBottom: 48 },
  subtitle: { color: COLORS.muted, fontSize: 13, marginBottom: 14 },
  selLabel: { color: COLORS.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  selRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card },
  chipOn: { borderColor: COLORS.primary, backgroundColor: 'rgba(139,92,246,0.18)' },
  chipText: { color: COLORS.muted, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: COLORS.text },
  hint: { color: COLORS.dim, fontSize: 11, marginBottom: 14 },
  pick: { height: 300, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, overflow: 'hidden', marginBottom: 14 },
  pickEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  pickText: { color: COLORS.muted, fontSize: 13 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 4 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginTop: 12 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  cardBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  note: { color: COLORS.muted, fontSize: 12, marginTop: 8 },
});
