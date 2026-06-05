// ════════════════════════════════════════════════════════════════════════════
//  app/ai-coinspector.tsx — the AI Co-Inspector capture-review flow (B.3 UI)
//
//  pick/capture image → on-device universal defect analysis → human reviews the
//  DefectFindingsCard → "Add as finding" records a Provable-AI detection
//  (pi_record_ai_detection) tied to the job + signed model. AI drafts; the
//  human accepts. Flag-gated + additive route; pass ?jobId=… to persist.
//
//  To embed in the real capture screen, drop <DefectFindingsCard> + the
//  useDefectAnalysis().analyze(uri) call after a capture — same three lines.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { useDefectAnalysis, ML_RUNTIME_ENABLED } from '@/src/core/ml';
import { DefectFindingsCard } from '@/src/shared-ui/ai/DefectFindingsCard';
import { buildAiAssist, aiAssistToRpcArgs, type DefectDetection } from '@nexpec/shared-core';

const COLORS = {
  bg: '#0B1020', card: '#161C36', border: '#2A3354', primary: '#8B5CF6',
  mint: '#34D399', red: '#F87171', text: '#F1F5F9', muted: '#9AA8C7', dim: '#64748B',
};

export default function AiCoInspectorScreen() {
  const router = useRouter();
  const { jobId, reportId } = useLocalSearchParams<{ jobId?: string; reportId?: string }>();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<string[]>([]);
  const da = useDefectAnalysis({ kind: 'vision_defect', slug: 'universal-detector' });

  const pickImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setNote('Media-library permission denied.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
      if (!res.canceled && res.assets?.[0]?.uri) {
        setImageUri(res.assets[0].uri);
        setRecorded([]); setNote(null); da.reset();
      }
    } catch (e) { setNote((e as Error)?.message ?? 'image pick failed'); }
  }, [da]);

  const analyze = useCallback(async () => {
    if (!imageUri) { setNote('Pick an image first.'); return; }
    setNote(null);
    await da.analyze(imageUri);
  }, [imageUri, da]);

  const accept = useCallback(async (d: DefectDetection) => {
    if (!jobId) { setNote('Demo mode, open with ?jobId=… to persist findings.'); return; }
    try {
      const assist = buildAiAssist(
        d,
        { slug: da.analysis?.modelSlug ?? 'universal-detector', version: da.analysis?.modelVersion ?? 1 },
        true,
      );
      const args = aiAssistToRpcArgs(assist, jobId, { reportId: reportId ?? undefined });
      const { error } = await supabase.rpc('pi_record_ai_detection', args);
      if (error) throw error;
      setRecorded((r) => [...r, d.defectId]);
      setNote(`Recorded "${d.label}" as a finding (provably tied to ${assist.modelSlug} v${assist.modelVersion}).`);
    } catch (e) { setNote('Save failed: ' + ((e as Error)?.message ?? 'error')); }
  }, [jobId, reportId, da.analysis]);

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
              {jobId ? `Job ${String(jobId).slice(0, 8)}…, findings will be sealed` : 'Demo mode, no job linked'}
            </Text>

            <TouchableOpacity style={styles.pick} onPress={pickImage} activeOpacity={0.85}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={styles.pickEmpty}>
                  <Ionicons name="camera-outline" size={28} color={COLORS.muted} />
                  <Text style={styles.pickText}>Tap to pick an inspection photo</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, (da.status === 'analyzing' || !imageUri) && { opacity: 0.5 }]}
              onPress={analyze}
              disabled={da.status === 'analyzing' || !imageUri}
              activeOpacity={0.85}
            >
              {da.status === 'analyzing' ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Analyze with AI Co-Inspector</Text>}
            </TouchableOpacity>

            {(da.analysis || da.status === 'analyzing') && (
              <DefectFindingsCard
                analysis={da.analysis}
                loading={da.status === 'analyzing'}
                onAddFinding={accept}
                onDismiss={() => {}}
              />
            )}

            {da.status === 'unavailable' && (
              <View style={[styles.card, { borderColor: COLORS.red }]}>
                <Text style={styles.cardTitle}>Model unavailable</Text>
                <Text style={styles.cardBody}>{da.error ?? 'Publish the universal-detector model and run a dev build with Skia + fast-tflite.'}</Text>
              </View>
            )}

            {!!recorded.length && (
              <Text style={styles.recorded}>{recorded.length} finding(s) recorded ✓</Text>
            )}
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
  pick: { height: 220, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card, overflow: 'hidden', marginBottom: 14 },
  thumb: { width: '100%', height: '100%' },
  pickEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  pickText: { color: COLORS.muted, fontSize: 13 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 4 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginTop: 12 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  cardBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  recorded: { color: COLORS.mint, fontSize: 13, fontWeight: '700', marginTop: 12 },
  note: { color: COLORS.muted, fontSize: 12, marginTop: 8 },
});
