// ════════════════════════════════════════════════════════════════════════════
//  app/ml-vision-check.tsx — Phase B.1 on-device VISION pipeline proof
//
//  Proves the full chain on a real device with a throwaway stock model:
//    pick image → register vision backend (Skia + fast-tflite, dynamic import)
//    → resolve (RPC) → Ed25519 verify → cache → Skia preprocess → TFLite infer
//    → top-5 + timing.
//
//  DEV BUILD ONLY for the actual inference (Skia/fast-tflite are native). Safe in
//  Expo Go too: the vision backend loads via dynamic import behind a try/catch,
//  so if the native libs are absent the screen reports "needs a dev build"
//  instead of crashing. Gated by ML_RUNTIME_ENABLED; no existing screen links here.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { getModelRuntime, ML_RUNTIME_ENABLED, type ModelStage } from '@/src/core/ml';
import { registerVisionBackend } from '@/src/core/ml/vision/registerVision';
import type { VisionResult } from '@/src/core/ml/vision/tfliteVision';

const DEMO_KIND = 'image_classifier';
const DEMO_SLUG = 'mobilenet-v1';

const COLORS = {
  bg: '#0B1020',
  card: '#161C36',
  border: '#2A3354',
  primary: '#8B5CF6',
  mint: '#34D399',
  red: '#F87171',
  text: '#F1F5F9',
  muted: '#9AA8C7',
  dim: '#64748B',
};

const STAGE_LABEL: Record<ModelStage, string> = {
  resolving: 'Resolve from registry (RPC)',
  'cache-hit': 'Cache hit — served offline',
  downloading: 'Download via signed URL',
  hashing: 'SHA-256 over raw bytes',
  verifying: 'Verify integrity + Ed25519 signature',
  committing: 'Commit to cache',
  ready: 'Model ready',
};

interface LogRow {
  id: number;
  label: string;
  status: 'ok' | 'fail';
  ms?: number;
  detail?: string;
}

export default function MlVisionCheckScreen() {
  const router = useRouter();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pickImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError('Media-library permission denied.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 1,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        setImageUri(res.assets[0].uri);
        setResult(null);
        setLogs([]);
        setError(null);
      }
    } catch (e) {
      setError((e as Error)?.message ?? 'image pick failed');
    }
  }, []);

  const run = useCallback(async () => {
    if (!imageUri) {
      setError('Pick an image first.');
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    setLogs([]);
    const push = (row: Omit<LogRow, 'id'>) => setLogs((l) => [...l, { ...row, id: l.length }]);
    try {
      const reg = await registerVisionBackend();
      push({
        label: reg.ok ? 'Vision backend registered (Skia + fast-tflite)' : 'Vision backend unavailable',
        status: reg.ok ? 'ok' : 'fail',
        detail: reg.ok ? undefined : reg.reason,
      });
      if (!reg.ok) {
        setError(reg.reason ?? 'vision backend unavailable');
        setRunning(false);
        return;
      }

      const rt = getModelRuntime();
      let t = Date.now();
      await rt.ensure(DEMO_KIND, DEMO_SLUG, (stage) => {
        const now = Date.now();
        push({ label: STAGE_LABEL[stage] ?? stage, status: 'ok', ms: now - t });
        t = now;
      });

      const t0 = Date.now();
      const out = (await rt.infer(DEMO_KIND, { imageUri }, DEMO_SLUG)) as VisionResult;
      push({ label: 'On-device inference', status: 'ok', ms: Date.now() - t0 });
      setResult(out);
    } catch (e) {
      const err = e as Error;
      push({ label: 'Failed: ' + (err?.message ?? 'unknown'), status: 'fail' });
      setError(err?.message ?? 'unknown');
    } finally {
      setRunning(false);
    }
  }, [imageUri]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Vision Pipeline Check</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Phase B.1 · on-device inference proof ({DEMO_KIND}/{DEMO_SLUG})</Text>

        {!ML_RUNTIME_ENABLED ? (
          <View style={[styles.card, { borderColor: COLORS.red }]}>
            <Text style={styles.cardTitle}>Runtime disabled</Text>
            <Text style={styles.cardBody}>Start a dev build with EXPO_PUBLIC_ML_RUNTIME=1 and the signing pubkey set.</Text>
          </View>
        ) : (
          <>
            <TouchableOpacity style={styles.pick} onPress={pickImage} activeOpacity={0.85}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={styles.pickEmpty}>
                  <Ionicons name="image-outline" size={28} color={COLORS.muted} />
                  <Text style={styles.pickText}>Tap to pick an image</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, (running || !imageUri) && { opacity: 0.5 }]}
              onPress={run}
              disabled={running || !imageUri}
              activeOpacity={0.85}
            >
              {running ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Run on-device inference</Text>}
            </TouchableOpacity>
          </>
        )}

        {logs.length > 0 && (
          <View style={styles.card}>
            {logs.map((row) => (
              <View key={row.id} style={styles.logRow}>
                <Ionicons
                  name={row.status === 'ok' ? 'checkmark-circle' : 'close-circle'}
                  size={16}
                  color={row.status === 'ok' ? COLORS.mint : COLORS.red}
                  style={{ marginTop: 1 }}
                />
                <View style={styles.logTextWrap}>
                  <View style={styles.logTop}>
                    <Text style={styles.logLabel}>{row.label}</Text>
                    {typeof row.ms === 'number' && <Text style={styles.logMs}>{row.ms} ms</Text>}
                  </View>
                  {!!row.detail && <Text style={styles.logDetail}>{row.detail}</Text>}
                </View>
              </View>
            ))}
          </View>
        )}

        {!!result && (
          <View style={[styles.card, { borderColor: COLORS.mint }]}>
            <Text style={[styles.cardTitle, { color: COLORS.mint }]}>
              Top-5 (output dim {result.outputLength}, {result.inferenceMs} ms)
            </Text>
            {result.top5.map((r) => (
              <View key={r.index} style={styles.scoreRow}>
                <Text style={styles.scoreIdx}>#{r.index}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.max(2, Math.min(100, r.score * 100))}%` }]} />
                </View>
                <Text style={styles.scoreVal}>{r.score.toFixed(3)}</Text>
              </View>
            ))}
          </View>
        )}

        {!!error && error.includes('unavailable') && (
          <View style={[styles.card, { borderColor: COLORS.red }]}>
            <Text style={[styles.cardTitle, { color: COLORS.red }]}>Needs a dev build</Text>
            <Text style={styles.cardBody}>
              Skia + fast-tflite are native modules absent from Expo Go. Install them and run a dev build:
            </Text>
            <Text style={styles.code}>npx expo install @shopify/react-native-skia react-native-fast-tflite{'\n'}npx expo run:ios</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: { color: COLORS.text, fontSize: 17, fontWeight: '700' },
  body: { padding: 16, paddingBottom: 48 },
  subtitle: { color: COLORS.muted, fontSize: 13, marginBottom: 14 },
  pick: {
    height: 200,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    overflow: 'hidden',
    marginBottom: 14,
  },
  thumb: { width: '100%', height: '100%' },
  pickEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  pickText: { color: COLORS.muted, fontSize: 13 },
  btn: { backgroundColor: COLORS.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 14 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: COLORS.card, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 14 },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 8 },
  cardBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  code: { color: COLORS.mint, fontFamily: 'Courier', fontSize: 12, backgroundColor: '#0E1530', borderRadius: 8, padding: 10, marginTop: 8 },
  logRow: { flexDirection: 'row', gap: 10, paddingVertical: 7, alignItems: 'flex-start' },
  logTextWrap: { flex: 1 },
  logTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logLabel: { color: COLORS.text, fontSize: 13, flex: 1, paddingRight: 8 },
  logMs: { color: COLORS.dim, fontSize: 11, fontVariant: ['tabular-nums'] },
  logDetail: { color: COLORS.muted, fontSize: 11, marginTop: 2, fontFamily: 'Courier' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  scoreIdx: { color: COLORS.muted, fontSize: 12, width: 48, fontFamily: 'Courier' },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#0E1530', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: COLORS.primary },
  scoreVal: { color: COLORS.text, fontSize: 12, width: 52, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
