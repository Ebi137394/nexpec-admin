// ════════════════════════════════════════════════════════════════════════════
//  app/ml-pipeline-check.tsx — Phase A.5 end-to-end pipeline diagnostic
//
//  A DEV/DIAGNOSTIC screen. It drives a published `noop` model through the FULL
//  runtime pipeline — resolve (RPC) → signed-URL download → SHA-256 (expo-crypto)
//  → integrity/signature verify → content-addressed cache (expo-file-system) →
//  inference (a dummy echo backend) — and prints each stage with timings.
//
//  SAFE BY CONSTRUCTION:
//   • Gated by ML_RUNTIME_ENABLED — with the flag off this screen renders a
//     notice and does nothing (no network, no IO).
//   • No existing screen links here; it's reachable only by explicit navigation
//     / deep link, so mounting it changes nothing in the app.
//   • Registers a dummy 'noop' backend on mount so infer() returns a result
//     instead of the safe "no backend" error.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  getModelRuntime,
  registerInferenceBackend,
  ML_RUNTIME_ENABLED,
  ML_ALLOW_UNSIGNED,
  type ModelStage,
} from '@/src/core/ml';
import { installMlSignatureVerifier } from '@/src/core/ml/verifier.noble';

const DEMO_KIND = 'demo_echo';
const DEMO_SLUG = 'pipeline-check';

const COLORS = {
  bg: '#0B1020',
  card: '#161C36',
  plum: '#1A1140',
  border: '#2A3354',
  primary: '#8B5CF6',
  mint: '#34D399',
  amber: '#FBBF24',
  red: '#F87171',
  text: '#F1F5F9',
  muted: '#9AA8C7',
  dim: '#64748B',
};

const STAGE_LABEL: Record<ModelStage, string> = {
  resolving: 'Resolve from registry (RPC)',
  'cache-hit': 'Cache hit, served offline',
  downloading: 'Download via signed URL',
  hashing: 'SHA-256 over raw bytes (expo-crypto)',
  verifying: 'Verify integrity + signature',
  committing: 'Commit to content-addressed cache',
  ready: 'Ready',
};

interface LogRow {
  id: number;
  label: string;
  status: 'ok' | 'fail';
  ms?: number;
  detail?: string;
}

export default function MlPipelineCheckScreen() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [runCount, setRunCount] = useState(0);

  // Enforce on-device Ed25519 verification (pure-JS, $0). With this active and
  // ML_ALLOW_UNSIGNED off, tampered/unsigned models are rejected before load.
  // Register the dummy echo backend for the `noop` runtime (mount-scoped).
  useEffect(() => {
    installMlSignatureVerifier();
    registerInferenceBackend({
      runtimes: ['noop'],
      async load() {
        return {
          async run(input: unknown) {
            return { backend: 'demo-noop-echo', receivedAt: new Date().toISOString(), echo: input };
          },
          release() {
            /* noop */
          },
        };
      },
    });
  }, []);

  const runPipeline = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setLogs([]);
    const rt = getModelRuntime();
    const t0 = Date.now();
    let stageStart = Date.now();
    const push = (row: Omit<LogRow, 'id'>) => setLogs((l) => [...l, { ...row, id: l.length }]);

    try {
      const handle = await rt.ensure(DEMO_KIND, DEMO_SLUG, (stage) => {
        const now = Date.now();
        push({ label: STAGE_LABEL[stage] ?? stage, status: 'ok', ms: now - stageStart });
        stageStart = now;
      });
      push({
        label: `Artifact verified, ${handle.artifact.slug} v${handle.artifact.version}`,
        status: 'ok',
        detail: `sha256 ${handle.artifact.sha256.slice(0, 16)}…  •  ${(handle.artifact.sizeBytes / 1024).toFixed(1)} KB  •  ${handle.artifact.runtime}`,
      });

      const inferStart = Date.now();
      const out = await rt.infer(DEMO_KIND, { ping: Date.now(), run: runCount + 1 }, DEMO_SLUG);
      push({ label: 'Inference, noop echo backend', status: 'ok', ms: Date.now() - inferStart });
      setResult(out);
      push({ label: `Pipeline complete`, status: 'ok', ms: Date.now() - t0 });
      setRunCount((c) => c + 1);
    } catch (e) {
      const err = e as Error;
      push({ label: 'Failed: ' + (err?.message ?? 'unknown'), status: 'fail' });
      setError(err?.message ?? 'unknown');
    } finally {
      setRunning(false);
    }
  }, [runCount]);

  return (
    <View style={styles.root}>
      {/* header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ML Pipeline Check</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>Phase A.5, end-to-end runtime diagnostic</Text>

        {/* flag chips */}
        <View style={styles.chipRow}>
          <Chip label={ML_RUNTIME_ENABLED ? 'runtime: ENABLED' : 'runtime: DISABLED'} color={ML_RUNTIME_ENABLED ? COLORS.mint : COLORS.red} />
          <Chip label={ML_ALLOW_UNSIGNED ? 'unsigned: allowed' : 'unsigned: blocked'} color={ML_ALLOW_UNSIGNED ? COLORS.amber : COLORS.mint} />
        </View>

        {!ML_RUNTIME_ENABLED ? (
          <View style={[styles.card, { borderColor: COLORS.red }]}>
            <Text style={styles.cardTitle}>Runtime is disabled</Text>
            <Text style={styles.cardBody}>
              Start the app with the flag on to run this check:
            </Text>
            <Text style={styles.code}>EXPO_PUBLIC_ML_RUNTIME=1 \{'\n'}EXPO_PUBLIC_ML_ALLOW_UNSIGNED=1 npx expo start -c</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Target model</Text>
              <Text style={styles.cardBody}>
                kind <Text style={styles.mono}>{DEMO_KIND}</Text>, slug <Text style={styles.mono}>{DEMO_SLUG}</Text>, runtime <Text style={styles.mono}>noop</Text>
              </Text>
              <Text style={[styles.cardBody, { color: COLORS.dim, marginTop: 4 }]}>
                Publish it once with scripts/ml/register-model.mjs (see terminal block), then run the pipeline.
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.btn, running && { opacity: 0.6 }]}
              onPress={runPipeline}
              disabled={running}
              activeOpacity={0.85}
            >
              {running ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>{runCount === 0 ? 'Run pipeline end-to-end' : 'Run again (expect cache hit)'}</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* logs */}
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

        {/* result */}
        {!!result && (
          <View style={[styles.card, { borderColor: COLORS.mint }]}>
            <Text style={[styles.cardTitle, { color: COLORS.mint }]}>Inference output</Text>
            <Text style={styles.mono}>{JSON.stringify(result, null, 2)}</Text>
          </View>
        )}

        {/* contextual hints */}
        {error?.includes('no_artifact') && (
          <View style={[styles.card, { borderColor: COLORS.amber }]}>
            <Text style={[styles.cardTitle, { color: COLORS.amber }]}>No published artifact found</Text>
            <Text style={styles.cardBody}>Publish the demo model first (run once on your machine):</Text>
            <Text style={styles.code}>
              printf 'NEXPEC-NOOP-DEMO-v1' &gt; demo-noop.bin{'\n'}
              node scripts/ml/register-model.mjs --file ./demo-noop.bin \{'\n'}
              {'  '}--kind demo_echo --slug pipeline-check --version 1 \{'\n'}
              {'  '}--runtime noop --tier student --device-min-tier low --os any
            </Text>
          </View>
        )}
        {error?.includes('signature_required') && (
          <View style={[styles.card, { borderColor: COLORS.amber }]}>
            <Text style={[styles.cardTitle, { color: COLORS.amber }]}>Signature required</Text>
            <Text style={styles.cardBody}>
              The demo model is unsigned. Restart with EXPO_PUBLIC_ML_ALLOW_UNSIGNED=1 (dev only), or publish a signed model.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.chip, { borderColor: color }]}>
      <Text style={[styles.chipText, { color }]}>{label}</Text>
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
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 14,
  },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700', marginBottom: 6 },
  cardBody: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  code: {
    color: COLORS.mint,
    fontFamily: 'Courier',
    fontSize: 12,
    backgroundColor: '#0E1530',
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  mono: { color: COLORS.text, fontFamily: 'Courier', fontSize: 12 },
  btn: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 14,
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  logRow: { flexDirection: 'row', gap: 10, paddingVertical: 7, alignItems: 'flex-start' },
  logTextWrap: { flex: 1 },
  logTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logLabel: { color: COLORS.text, fontSize: 13, flex: 1, paddingRight: 8 },
  logMs: { color: COLORS.dim, fontSize: 11, fontVariant: ['tabular-nums'] },
  logDetail: { color: COLORS.muted, fontSize: 11, marginTop: 2, fontFamily: 'Courier' },
});
