// ─────────────────────────────────────────────────────────────────
//  /mldiag — QA-only ML self-test on the CONTROLLED image set.
//
//  Why this exists: the emulator/simulator camera cannot present controlled
//  CONTENT (virtualscene renders black under SwiftShader on the QA host; the
//  iOS Simulator has no camera at all), so model behaviour on known industrial
//  images is proven here by calling the PRODUCTION inference path —
//  SegModelManager.analyze(), the exact function the compliance capture flow
//  calls — on six documented, open-licensed images bundled as assets
//  (qa-artifacts/tflite-test-set/, SHA-256s in MANIFEST.md).
//
//  LAW 1: gated on ML_RUNTIME_ENABLED — with the flag off this screen renders
//  a static notice and performs no file I/O and no inference.
//
//  Evidence: each run prints one release-safe console.warn line
//    [seg-qa-diag] {file, sha256, mode, model, inferenceMs, detections, expected}
//  and renders the same facts on screen (screenshot = visible-output proof).
//  The on-device sha256 is recomputed from the bundled bytes so the screenshot
//  itself ties the image to the manifest row.
// ─────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { decode as b64decode } from 'base64-arraybuffer';

import { ML_RUNTIME_ENABLED } from '@/src/core/ml/flags';
import { SegModelManager, modeSlug, type SegMode } from '@/src/core/ml/vision/segModelManager';

type TestImage = {
  name: string;
  asset: number;
  expected: string;
  modes: SegMode[];
};

// The controlled set — provenance, licenses and SHA-256s in
// qa-artifacts/tflite-test-set/MANIFEST.md.
const TEST_IMAGES: TestImage[] = [
  { name: 'weld-defect-crack-1.jpg', asset: require('../qa-artifacts/tflite-test-set/weld-defect-crack-1.jpg'), expected: 'weld defect (crack)', modes: ['weld', 'weld-detect'] },
  { name: 'weld-defect-crack-2.jpg', asset: require('../qa-artifacts/tflite-test-set/weld-defect-crack-2.jpg'), expected: 'weld defect (crack)', modes: ['weld', 'weld-detect'] },
  { name: 'corrosion-1.jpg', asset: require('../qa-artifacts/tflite-test-set/corrosion-1.jpg'), expected: 'corrosion', modes: ['corrosion'] },
  { name: 'corrosion-2.jpg', asset: require('../qa-artifacts/tflite-test-set/corrosion-2.jpg'), expected: 'corrosion', modes: ['corrosion'] },
  { name: 'clean-weld.jpg', asset: require('../qa-artifacts/tflite-test-set/clean-weld.jpg'), expected: 'clean weld (no/low findings)', modes: ['weld', 'weld-detect'] },
  { name: 'negative-control-cat.jpg', asset: require('../qa-artifacts/tflite-test-set/negative-control-cat.jpg'), expected: 'negative control (no findings)', modes: ['weld', 'corrosion'] },
];

type RunRow = {
  file: string;
  sha12: string;
  mode: SegMode;
  model: string;
  inferenceMs: number;
  detections: Array<{ label: string; score: number }>;
  error?: string;
};

async function sha256OfAsset(localUri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = new Uint8Array(b64decode(b64));
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, '0')).join('');
}

export default function MlDiag() {
  const [rows, setRows] = useState<RunRow[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const runAll = useCallback(async () => {
    if (!ML_RUNTIME_ENABLED || running) return;
    setRunning(true);
    setDone(false);
    setRows([]);
    for (const img of TEST_IMAGES) {
      let localUri = '';
      let sha = '';
      try {
        const asset = Asset.fromModule(img.asset);
        if (!asset.localUri) await asset.downloadAsync();
        localUri = asset.localUri ?? asset.uri;
        sha = await sha256OfAsset(localUri);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setRows((r) => [...r, { file: img.name, sha12: 'asset-error', mode: img.modes[0], model: '-', inferenceMs: 0, detections: [], error: msg }]);
        continue;
      }
      for (const mode of img.modes) {
        try {
          // THE production path — identical call to capture.tsx.
          const res = await SegModelManager.analyze(localUri, mode);
          const row: RunRow = {
            file: img.name,
            sha12: sha.slice(0, 12),
            mode,
            model: modeSlug(res.mode),
            inferenceMs: res.inferenceMs,
            detections: res.detections.map((d) => ({ label: d.label, score: Math.round(d.score * 1000) / 1000 })),
          };
          console.warn('[seg-qa-diag]', JSON.stringify({ ...row, sha256: sha, expected: img.expected }));
          setRows((r) => [...r, row]);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn('[seg-qa-diag]', JSON.stringify({ file: img.name, sha256: sha, mode, error: msg, expected: img.expected }));
          setRows((r) => [...r, { file: img.name, sha12: sha.slice(0, 12), mode, model: '-', inferenceMs: 0, detections: [], error: msg }]);
        }
      }
    }
    setRunning(false);
    setDone(true);
    console.warn('[seg-qa-diag]', JSON.stringify({ done: true }));
  }, [running]);

  useEffect(() => {
    void runAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ML_RUNTIME_ENABLED) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }} testID="mldiag-disabled">
        <Text style={{ fontSize: 16 }}>ML runtime disabled (EXPO_PUBLIC_ML_RUNTIME != 1).</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }} testID="mldiag">
      <Text style={{ fontSize: 20, fontWeight: '700' }}>ML self-test — controlled image set</Text>
      <Text style={{ fontSize: 12, opacity: 0.7 }}>
        Production SegModelManager.analyze() on the documented images (MANIFEST.md). QA build only.
      </Text>
      {running ? <ActivityIndicator testID="mldiag-running" /> : null}
      {done ? <Text testID="mldiag-done" style={{ fontWeight: '700' }}>ALL RUNS COMPLETE ({rows.length} runs)</Text> : null}
      {TEST_IMAGES.map((img) => (
        <View key={img.name} style={{ borderWidth: 1, borderColor: '#8884', borderRadius: 8, padding: 10, gap: 6 }}>
          <Image source={img.asset} style={{ width: '100%', height: 140, borderRadius: 6 }} resizeMode="cover" />
          <Text style={{ fontWeight: '700' }}>{img.name}</Text>
          <Text style={{ fontSize: 12 }}>expected: {img.expected}</Text>
          {rows.filter((r) => r.file === img.name).map((r) => (
            <View key={img.name + r.mode} style={{ paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: r.error ? '#c33' : '#3a3' }}>
              <Text style={{ fontSize: 12, fontWeight: '600' }} testID={`mldiag-${img.name}-${r.mode}`}>
                {r.mode} · sha {r.sha12} · {r.error ? `ERROR: ${r.error}` : `${r.inferenceMs}ms · ${r.detections.length} detections`}
              </Text>
              {r.detections.slice(0, 5).map((d, i) => (
                <Text key={i} style={{ fontSize: 12 }}>
                  {'  '}{d.label}: {d.score}
                </Text>
              ))}
              {!r.error && r.detections.length === 0 ? <Text style={{ fontSize: 12, opacity: 0.7 }}>{'  '}(no detections)</Text> : null}
            </View>
          ))}
        </View>
      ))}
      <Pressable
        onPress={() => void runAll()}
        disabled={running}
        style={{ backgroundColor: '#7c3aec', borderRadius: 8, padding: 14, alignItems: 'center', opacity: running ? 0.5 : 1 }}
        testID="mldiag-rerun"
      >
        <Text style={{ color: 'white', fontWeight: '700' }}>Run again</Text>
      </Pressable>
    </ScrollView>
  );
}
