// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/compliance/job/[id]/capture.tsx
//
//  STEP 5 — Inspector field-capture wizard.
//
//  Drives the assigned inspector through every evidence requirement on
//  a compliance job in scope-template-defined order. Per-requirement
//  capture surfaces:
//
//    • photo / photo_with_face / document_upload
//        → live camera (expo-camera CameraView). No gallery picker.
//        → on capture: GPS attached fresh, EXIF persisted, file +
//          metadata hashed, prev-hash chained, uploaded, row inserted.
//    • gps_pin
//        → captures Location.getCurrentPositionAsync at high accuracy,
//          inserts a row with no storage file (kind='gps_pin').
//    • text_input
//        → simple text entry, hashed and chained, no file.
//
//  Trust primitives implemented here:
//    – Camera-only capture (no ImagePicker import anywhere).
//    – Fresh GPS per shot (no cached fixes).
//    – EXIF preserved end-to-end (request `exif: true` at capture).
//    – capture_sha256 over canonical JSON of (file_sha + GPS + EXIF
//      subset + ids + ts), chained to the previous capture's hash.
//    – Upload to compliance/captures/<job_id>/<requirement_id>/<id>.<ext>
//      with RLS that only permits the assigned inspector to write.
//    – Server-side face detection / GPS-distance cross-check happens
//      in the STEP 6 validate-capture Edge Function; the capture row
//      starts at server_validation_status='pending'.
//
//  Out of scope for STEP 5 (deferred to subsequent steps):
//    – Video walkthrough, rep_interview, signed_statement kinds.
//    – On-device face detection (server-side validator in STEP 6).
//    – Resumable offline capture queue (Phase 3's outbox already
//      provides the spine; wiring is a STEP-5.5 follow-up).
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Location from 'expo-location';
import {
  Camera as CameraIcon,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSignature,
  Hash,
  MapPin,
  Navigation,
  RotateCcw,
  ShieldCheck,
  Type,
  X,
} from 'lucide-react-native';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import {
  deriveExifSubset,
  hashCaptureMetadata,
  hashLocalFile,
  newUuid,
  type CaptureExifSubset,
  type CaptureMetadataForHash,
} from '@/src/features/compliance/lib/capture';
// #QA — every capture/detection routes through the offline outbox (never a
// direct supabase mutation), so field captures survive zero-signal conditions.
import { enqueueCaptureSave, enqueueAiDetection } from '@/lib/offline';

// AI Co-Inspector (B.3) — on-device defect analysis of the just-captured photo.
// First-class in the real capture flow; runtime-flag-gated so it is completely
// inert (and the wizard byte-for-byte unchanged) until a signed model is
// published AND the app runs with the native ML runtime enabled.
import { useDefectAnalysis, ML_RUNTIME_ENABLED } from '@/src/core/ml';
import { DefectFindingsCard } from '@/src/shared-ui/ai/DefectFindingsCard';
import { buildAiAssist, aiAssistToRpcArgs, type DefectDetection } from '@nexpec/shared-core';

// ─────────────────────────────────────────────────────────────
//  Palette
// ─────────────────────────────────────────────────────────────
const C = {
  bg: '#020420', card: '#0A0E2A', cardLift: '#0F1538', border: '#1A1F4A',
  primary: '#7C3AED', primarySoft: '#A78BFA',
  primaryDim: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF', textSec: '#CBD5F5', textDim: '#64748B',
  ok: '#10B981', warn: '#F59E0B', danger: '#EF4444', amber: '#FBBF24',
  cyan: '#06B6D4',
};

type EvidenceKind =
  | 'photo' | 'photo_with_face' | 'gps_pin' | 'document_upload'
  | 'video_walkthrough' | 'rep_interview' | 'signed_statement' | 'text_input';

interface Requirement {
  id: string;
  template_id: string;
  sort_order: number;
  kind: EvidenceKind;
  label: string;
  hint: string | null;
  required: boolean;
  min_count: number;
  max_count: number;
  constraints_json: Record<string, unknown>;
}

interface CaptureRow {
  id: string;
  requirement_id: string;
  kind: EvidenceKind;
  storage_path: string | null;
  text_payload: string | null;
  capture_sha256: string | null;
  server_validation_status: string;
  created_at: string;
}

interface JobRow {
  id: string;
  contractor_id: string | null;
  inspection_type: string;
  scope_template_id: string | null;
  status: string;
  scope: { id: string; slug: string; name: string; version: number } | null;
}

// ─────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────
export default function ComplianceCaptureWizard() {
  const router = useRouter();
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [job, setJob] = useState<JobRow | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [captures, setCaptures] = useState<CaptureRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);

  // Camera modal state
  const [camOpen, setCamOpen] = useState(false);
  const [camFacing, setCamFacing] = useState<'back' | 'front'>('back');
  const [preview, setPreview] = useState<{ uri: string; exif: Record<string, unknown> | null } | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  // Active capture session metadata staged before save
  const [stagingText, setStagingText] = useState('');
  const [busy, setBusy] = useState(false);

  // ─── STEP 7.5 — VCA generation result + loading state ───
  //   When the inspector hits "Generate Affidavit", we POST the job_id
  //   to the generate-vca Edge Function. The function authorizes the
  //   caller (admin or the assigned inspector), re-validates every
  //   capture server-side, walks the chain, signs the canonical JSON
  //   with Ed25519, and returns the public verify URL.
  const [generating, setGenerating] = useState(false);
  const [vcaResult, setVcaResult] = useState<{
    public_verify_url: string;
    public_verify_token: string;
    affidavit_id: string;
    signing_key_id: string;
    chain: { intact: boolean; total: number };
  } | null>(null);

  // ─── AI Co-Inspector state ─────────────────────────────
  //   After a photo capture persists, we analyze it on-device and surface a
  //   DefectFindingsCard. The human accepts findings → pi_record_ai_detection
  //   ties each one to this job + the exact capture, and the seal folds them
  //   into its root (algorithm v3). The hook is safe to instantiate even when
  //   the runtime is disabled (it no-ops).
  const da = useDefectAnalysis({ kind: 'vision_defect', slug: 'universal-detector' });
  const [aiImageUri, setAiImageUri] = useState<string | null>(null);
  const [aiCaptureId, setAiCaptureId] = useState<string | null>(null);
  const [aiRecorded, setAiRecorded] = useState<string[]>([]);
  const [aiNote, setAiNote] = useState<string | null>(null);

  // ─── Load ──────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!jobId || !user?.id) return;
    try {
      const { data: j, error: jErr } = await supabase
        .from('jobs')
        .select(`
          id, contractor_id, inspection_type, scope_template_id, status,
          scope:inspection_scope_templates ( id, slug, name, version )
        `)
        .eq('id', jobId)
        .single();
      if (jErr) throw jErr;

      const scope = Array.isArray(j.scope) ? j.scope[0] : j.scope;
      setJob({ ...j, scope: scope ?? null } as JobRow);

      if (j.inspection_type !== 'compliance' || !j.scope_template_id) {
        Alert.alert('Not a compliance job', 'This wizard only runs on compliance-type jobs.');
        router.back();
        return;
      }
      if (j.contractor_id !== user.id) {
        Alert.alert('Not your job', 'Only the assigned inspector can capture evidence for this job.');
        router.back();
        return;
      }

      const { data: r, error: rErr } = await supabase
        .from('inspection_evidence_requirements')
        .select('*')
        .eq('template_id', j.scope_template_id)
        .order('sort_order', { ascending: true });
      if (rErr) throw rErr;
      setRequirements((r ?? []) as Requirement[]);

      const { data: c, error: cErr } = await supabase
        .from('inspection_captures')
        .select('id, requirement_id, kind, storage_path, text_payload, capture_sha256, server_validation_status, created_at')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });
      if (cErr) throw cErr;
      setCaptures((c ?? []) as CaptureRow[]);
    } catch (e: any) {
      console.error('[capture-wizard] load failed:', e);
      Alert.alert('Error', e?.message ?? 'Could not load capture session.');
    } finally {
      setLoading(false);
    }
  }, [jobId, user?.id, router]);

  useEffect(() => { load(); }, [load]);

  // Hide any stale AI card when the inspector switches requirements.
  useEffect(() => { setAiImageUri(null); setAiNote(null); }, [activeIdx]);

  // Active requirement + per-req capture progress
  const active = requirements[activeIdx];
  const capturesByReq = useMemo(() => {
    const m: Record<string, CaptureRow[]> = {};
    for (const cap of captures) {
      (m[cap.requirement_id] ??= []).push(cap);
    }
    return m;
  }, [captures]);
  const activeCount = active ? capturesByReq[active.id]?.length ?? 0 : 0;
  const requirementSatisfied = (req: Requirement): boolean => {
    const n = capturesByReq[req.id]?.length ?? 0;
    return !req.required || n >= req.min_count;
  };
  const allDone = requirements.every(requirementSatisfied);

  // ─── Camera flow ───────────────────────────────────────
  const openCamera = async () => {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        Alert.alert('Camera permission needed', 'Please enable camera access in Settings.');
        return;
      }
    }
    setPreview(null);
    setCamOpen(true);
  };

  const onShutter = async () => {
    try {
      if (!cameraRef.current) return;
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        exif: true,
        skipProcessing: false,
      });
      if (photo?.uri) {
        setPreview({ uri: photo.uri, exif: (photo.exif as any) ?? null });
      }
    } catch (e) {
      console.warn('[capture-wizard] shutter failed:', e);
    }
  };

  // ─── Persist capture ───────────────────────────────────
  const persistPhotoCapture = async () => {
    if (!preview || !job || !active || !user?.id) return;
    const capturedUri = preview.uri;
    setBusy(true);
    try {
      // 1) Fresh GPS at the moment of save (not at shutter — we want
      //    the location of the *act of submitting* this evidence).
      const { status: locStatus } = await Location.getForegroundPermissionsAsync();
      let gpsLat: number | null = null;
      let gpsLng: number | null = null;
      let gpsAcc: number | null = null;
      if (locStatus === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        gpsLat = loc.coords.latitude;
        gpsLng = loc.coords.longitude;
        gpsAcc = loc.coords.accuracy ?? null;
      } else {
        Alert.alert('GPS required', 'Compliance captures need a GPS fix. Enable location and retry.');
        setBusy(false);
        return;
      }

      // 2) File hash + base64
      const { sha256: fileSha } = await hashLocalFile(preview.uri);

      // 3) Capture metadata canonical form → capture_sha256
      const exifSubset = deriveExifSubset(preview.exif);
      const capturedAt = new Date().toISOString();
      const captureId = newUuid();
      const meta: CaptureMetadataForHash = {
        job_id: job.id,
        requirement_id: active.id,
        inspector_id: user.id,
        kind: active.kind,
        file_sha256: fileSha,
        gps_lat: gpsLat,
        gps_lng: gpsLng,
        gps_accuracy_m: gpsAcc,
        captured_at: capturedAt,
        exif_summary: exifSubset,
        text_payload: null,
      };
      const captureSha = await hashCaptureMetadata(meta);

      // 4) Chain link: previous capture's sha — derived from LOCAL state, not
      //    the server. `captures` loads oldest→newest, so the last entry is the
      //    prior capture. fetchPrevCaptureHash() hits the network and returns
      //    null offline, which would silently break the per-job hash chain. #QA
      const prevSha =
        captures.length > 0 ? captures[captures.length - 1].capture_sha256 ?? null : null;

      // 5) Storage path is deterministic — the outbox handler uploads the local
      //    file (preview.uri) to it when connectivity returns. No upload here.
      const storagePath = `captures/${job.id}/${active.id}/${captureId}.jpg`;

      // 6) Route through the offline outbox (never a direct mutation). The row
      //    inserts + the file uploads on drain; idempotent via the client PK. #QA
      await enqueueCaptureSave({
        capture: {
          id: captureId,
          job_id: job.id,
          requirement_id: active.id,
          inspector_id: user.id,
          kind: active.kind,
          sort_index: activeCount,
          storage_path: storagePath,
          mime_type: 'image/jpeg',
          exif_json: preview.exif ?? null,
          gps_lat: gpsLat,
          gps_lng: gpsLng,
          gps_accuracy_m: gpsAcc,
          captured_at: capturedAt,
          device_platform: Platform.OS,
          capture_sha256: captureSha,
          prev_capture_sha256: prevSha,
          text_payload: null,
          server_validation_status: 'pending',
        },
        bucket: 'compliance',
        localFilePath: preview.uri,
      });

      // Local optimistic add
      setCaptures((prev) => [
        ...prev,
        {
          id: captureId,
          requirement_id: active.id,
          kind: active.kind,
          storage_path: storagePath,
          text_payload: null,
          capture_sha256: captureSha,
          server_validation_status: 'pending',
          created_at: capturedAt,
        },
      ]);
      setPreview(null);
      setCamOpen(false);

      // ── AI Co-Inspector — analyze the photo we just sealed into the chain.
      //    Fire-and-forget: the trust-capture above already succeeded; nothing
      //    here can block or alter it. No-op unless the native runtime is on.
      if (ML_RUNTIME_ENABLED) {
        setAiImageUri(capturedUri);
        setAiCaptureId(captureId);
        setAiRecorded([]);
        setAiNote(null);
        da.reset();
        void da.analyze(capturedUri);
      }
    } catch (e: any) {
      console.error('[capture-wizard] persist photo failed:', e);
      Alert.alert('Capture failed', e?.message ?? 'Could not save capture.');
    } finally {
      setBusy(false);
    }
  };

  const persistGpsPin = async () => {
    if (!job || !active || !user?.id) return;
    setBusy(true);
    try {
      const { status: locStatus } = await Location.getForegroundPermissionsAsync();
      if (locStatus !== 'granted') {
        const r = await Location.requestForegroundPermissionsAsync();
        if (r.status !== 'granted') {
          Alert.alert('GPS required', 'Please enable location to capture a pin.');
          setBusy(false);
          return;
        }
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const capturedAt = new Date().toISOString();
      const captureId = newUuid();
      const meta: CaptureMetadataForHash = {
        job_id: job.id,
        requirement_id: active.id,
        inspector_id: user.id,
        kind: active.kind,
        file_sha256: null,
        gps_lat: loc.coords.latitude,
        gps_lng: loc.coords.longitude,
        gps_accuracy_m: loc.coords.accuracy ?? null,
        captured_at: capturedAt,
        exif_summary: null,
        text_payload: null,
      };
      const captureSha = await hashCaptureMetadata(meta);
      // prevSha from LOCAL state — offline-safe chain link (see persistPhoto). #QA
      const prevSha =
        captures.length > 0 ? captures[captures.length - 1].capture_sha256 ?? null : null;

      await enqueueCaptureSave({
        capture: {
          id: captureId,
          job_id: job.id,
          requirement_id: active.id,
          inspector_id: user.id,
          kind: active.kind,
          sort_index: activeCount,
          gps_lat: loc.coords.latitude,
          gps_lng: loc.coords.longitude,
          gps_accuracy_m: loc.coords.accuracy ?? null,
          captured_at: capturedAt,
          device_platform: Platform.OS,
          capture_sha256: captureSha,
          prev_capture_sha256: prevSha,
          server_validation_status: 'pending',
        },
      });

      setCaptures((prev) => [...prev, {
        id: captureId, requirement_id: active.id, kind: active.kind,
        storage_path: null, text_payload: null,
        capture_sha256: captureSha, server_validation_status: 'pending',
        created_at: capturedAt,
      }]);
    } catch (e: any) {
      console.error('[capture-wizard] gps pin failed:', e);
      Alert.alert('Error', e?.message ?? 'Could not capture GPS.');
    } finally {
      setBusy(false);
    }
  };

  const persistTextInput = async () => {
    if (!job || !active || !user?.id) return;
    const trimmed = stagingText.trim();
    if (trimmed.length === 0) {
      Alert.alert('Required', 'Type a value before saving.');
      return;
    }
    const maxLen = Number(active.constraints_json?.max_length ?? 256);
    if (trimmed.length > maxLen) {
      Alert.alert('Too long', `Maximum length is ${maxLen} characters.`);
      return;
    }
    setBusy(true);
    try {
      const capturedAt = new Date().toISOString();
      const captureId = newUuid();
      const meta: CaptureMetadataForHash = {
        job_id: job.id,
        requirement_id: active.id,
        inspector_id: user.id,
        kind: active.kind,
        file_sha256: null,
        gps_lat: null,
        gps_lng: null,
        gps_accuracy_m: null,
        captured_at: capturedAt,
        exif_summary: null,
        text_payload: trimmed,
      };
      const captureSha = await hashCaptureMetadata(meta);
      // prevSha from LOCAL state — offline-safe chain link (see persistPhoto). #QA
      const prevSha =
        captures.length > 0 ? captures[captures.length - 1].capture_sha256 ?? null : null;

      await enqueueCaptureSave({
        capture: {
          id: captureId,
          job_id: job.id,
          requirement_id: active.id,
          inspector_id: user.id,
          kind: active.kind,
          sort_index: activeCount,
          captured_at: capturedAt,
          device_platform: Platform.OS,
          capture_sha256: captureSha,
          prev_capture_sha256: prevSha,
          text_payload: trimmed,
          server_validation_status: 'pending',
        },
      });

      setCaptures((prev) => [...prev, {
        id: captureId, requirement_id: active.id, kind: active.kind,
        storage_path: null, text_payload: trimmed,
        capture_sha256: captureSha, server_validation_status: 'pending',
        created_at: capturedAt,
      }]);
      setStagingText('');
    } catch (e: any) {
      console.error('[capture-wizard] text save failed:', e);
      Alert.alert('Error', e?.message ?? 'Could not save text.');
    } finally {
      setBusy(false);
    }
  };

  // ─── STEP 7.5 — Trigger VCA generation ───────────────────
  const generateVca = async () => {
    if (!job?.id) return;
    setGenerating(true);
    try {
      // Interactive ONLINE finalization: the edge function validates that every
      // capture is already synced + the hash chain is intact server-side and
      // returns a verify URL the inspector acts on immediately. It cannot run
      // from queued/offline state, so it is intentionally not an outbox op.
      // outbox-exempt: interactive online affidavit generation, not a field write.
      const { data, error } = await supabase.functions.invoke('generate-vca', {
        body: { job_id: job.id },
      });
      if (error) throw error;
      if (!data?.ok) {
        // Edge Function refused to issue. Surface the most actionable reason.
        const reasons =
          data?.missing_requirements?.length
            ? ['Missing required captures:', ...data.missing_requirements].join('\n• ')
            : data?.chain_notes?.length
            ? ['Capture chain broken:', ...data.chain_notes].join('\n• ')
            : data?.error ?? 'Affidavit blocked. Re-check captures.';
        Alert.alert('Affidavit blocked', reasons);
        return;
      }

      // Server reloads validation statuses on captures; pull the latest
      // so the in-screen badges flip from "pending" to "valid".
      try {
        const { data: refreshed } = await supabase
          .from('inspection_captures')
          .select('id, requirement_id, kind, storage_path, text_payload, capture_sha256, server_validation_status, created_at')
          .eq('job_id', job.id)
          .order('created_at', { ascending: true });
        if (refreshed) setCaptures(refreshed as CaptureRow[]);
      } catch { /* non-fatal */ }

      setVcaResult({
        public_verify_url: data.public_verify_url,
        public_verify_token: data.public_verify_token,
        affidavit_id: data.affidavit_id,
        signing_key_id: data.signing_key_id,
        chain: data.chain,
      });

      Alert.alert(
        'Affidavit issued ✓',
        [
          `Captures chained: ${data.chain.total}`,
          `Signing key: ${data.signing_key_id}`,
          '',
          'Public verify URL:',
          data.public_verify_url,
        ].join('\n'),
        [
          {
            text: 'Open Verify Page',
            onPress: () => router.push(`/verify/${data.public_verify_token}` as any),
          },
          { text: 'OK', style: 'cancel' },
        ],
      );
    } catch (e: any) {
      console.error('[capture-wizard] generate-vca failed:', e);
      Alert.alert('Error', e?.message ?? 'Could not generate affidavit.');
    } finally {
      setGenerating(false);
    }
  };

  // ─── AI Co-Inspector — record an accepted finding ──────
  const acceptAiFinding = useCallback(async (d: DefectDetection) => {
    if (!job?.id) { setAiNote('No job context.'); return; }
    try {
      const assist = buildAiAssist(
        d,
        { slug: da.analysis?.modelSlug ?? 'universal-detector', version: da.analysis?.modelVersion ?? 1 },
        true,
      );
      const args = aiAssistToRpcArgs(assist, job.id, { captureId: aiCaptureId ?? undefined });
      // Route through the outbox — offline-safe + idempotent (client_op_id). #QA
      await enqueueAiDetection(args as Record<string, unknown>);
      setAiRecorded((r) => (r.includes(d.defectId) ? r : [...r, d.defectId]));
      setAiNote(`Recorded "${d.label}", provably tied to ${assist.modelSlug} v${assist.modelVersion}; it folds into this inspection's seal.`);
    } catch (e: any) {
      setAiNote('Save failed: ' + (e?.message ?? 'error'));
    }
  }, [job?.id, aiCaptureId, da.analysis]);

  // ─── Renderers ─────────────────────────────────────────
  if (loading) {
    return <SafeAreaView style={s.bg}><View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View></SafeAreaView>;
  }
  if (!job || !active) {
    return <SafeAreaView style={s.bg}><View style={s.center}><Text style={s.statusTitle}>No requirements to capture.</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.bg} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={s.backBtn}>
          <ChevronLeft size={22} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{job.scope?.name ?? 'Compliance Job'}</Text>
          <Text style={s.headerSub}>
            Req {activeIdx + 1} of {requirements.length}, {captures.length} captures
          </Text>
        </View>
        {allDone && (
          <View style={s.allDonePill}>
            <Check size={12} color={C.ok} />
            <Text style={s.allDonePillText}>All done</Text>
          </View>
        )}
      </View>

      {/* Requirement strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
        {requirements.map((r, idx) => {
          const done = requirementSatisfied(r);
          const cnt  = capturesByReq[r.id]?.length ?? 0;
          const on = idx === activeIdx;
          return (
            <Pressable key={r.id} onPress={() => setActiveIdx(idx)} style={[s.stripChip, on && s.stripChipOn, done && s.stripChipDone]}>
              <Text style={[s.stripChipNum, on && { color: '#FFF' }, done && !on && { color: C.ok }]}>{r.sort_order}</Text>
              <Text style={[s.stripChipMeta, on && { color: '#FFF' }, done && !on && { color: C.ok }]}>
                {cnt}/{r.min_count}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        {/* Active requirement card */}
        <View style={s.reqCard}>
          <Text style={s.reqKind}>{kindLabel(active.kind)}, {active.required ? 'Required' : 'Optional'}</Text>
          <Text style={s.reqLabel}>{active.label}</Text>
          {!!active.hint && <Text style={s.reqHint}>{active.hint}</Text>}
          <View style={s.reqMeta}>
            <Text style={s.reqMetaText}>
              {activeCount}/{active.min_count}–{active.max_count} captured
            </Text>
            {requirementSatisfied(active) && (
              <Text style={[s.reqMetaText, { color: C.ok }]}>requirement satisfied ✓</Text>
            )}
          </View>
        </View>

        {/* Per-kind capture surface */}
        {(active.kind === 'photo' || active.kind === 'photo_with_face' || active.kind === 'document_upload') && (
          <View style={s.captureCard}>
            <View style={s.captureHead}>
              <CameraIcon size={16} color={C.primarySoft} />
              <Text style={s.captureTitle}>Live Camera Capture</Text>
            </View>
            <Text style={s.captureBody}>
              No gallery uploads on compliance jobs. Tap below to open the camera; we attach a
              fresh GPS fix and the device's EXIF to every shot, then chain the SHA-256 to the
              previous capture for tamper-evidence.
            </Text>
            <Pressable
              onPress={openCamera}
              disabled={busy || activeCount >= active.max_count}
              style={[s.primaryBtn, (busy || activeCount >= active.max_count) && { opacity: 0.5 }]}
            >
              <CameraIcon size={16} color="#FFF" />
              <Text style={s.primaryBtnText}>
                {activeCount >= active.max_count ? 'Maximum reached' : `Open camera (${activeCount}/${active.max_count})`}
              </Text>
            </Pressable>
          </View>
        )}

        {active.kind === 'gps_pin' && (
          <View style={s.captureCard}>
            <View style={s.captureHead}>
              <MapPin size={16} color={C.cyan} />
              <Text style={s.captureTitle}>GPS Pin Capture</Text>
            </View>
            <Text style={s.captureBody}>
              Stand at the location and tap below. We request a high-accuracy fix and hash
              the resulting lat/lng into the chain.
            </Text>
            <Pressable
              onPress={persistGpsPin}
              disabled={busy || activeCount >= active.max_count}
              style={[s.primaryBtn, { backgroundColor: C.cyan }, (busy || activeCount >= active.max_count) && { opacity: 0.5 }]}
            >
              {busy
                ? <ActivityIndicator color="#FFF" />
                : <><Navigation size={16} color="#FFF" /><Text style={s.primaryBtnText}>Capture GPS Pin</Text></>}
            </Pressable>
          </View>
        )}

        {active.kind === 'text_input' && (
          <View style={s.captureCard}>
            <View style={s.captureHead}>
              <Type size={16} color={C.amber} />
              <Text style={s.captureTitle}>Text Input</Text>
            </View>
            <TextInput
              style={s.input}
              value={stagingText}
              onChangeText={setStagingText}
              placeholder={String(active.constraints_json?.placeholder ?? 'Type the required value')}
              placeholderTextColor={C.textDim}
              maxLength={Number(active.constraints_json?.max_length ?? 256)}
            />
            <Pressable
              onPress={persistTextInput}
              disabled={busy || activeCount >= active.max_count}
              style={[s.primaryBtn, { backgroundColor: C.amber }, (busy || activeCount >= active.max_count) && { opacity: 0.5 }]}
            >
              {busy ? <ActivityIndicator color="#FFF" /> : <Text style={s.primaryBtnText}>Save Value</Text>}
            </Pressable>
          </View>
        )}

        {/* Captures for this requirement (read-only list) */}
        {capturesByReq[active.id]?.length ? (
          <View style={s.capList}>
            <Text style={s.capListTitle}>Captured so far</Text>
            {capturesByReq[active.id].map((c, i) => (
              <View key={c.id} style={s.capRow}>
                <View style={[s.capDot, validationDot(c.server_validation_status)]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.capName}>#{i + 1}, {kindLabel(c.kind as EvidenceKind)}</Text>
                  <Text style={s.capSha}>
                    <Hash size={9} color={C.textDim} /> {(c.capture_sha256 ?? '').slice(0, 16)}…
                  </Text>
                </View>
                <Text style={s.capStatus}>{c.server_validation_status}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* AI Co-Inspector — review & accept on-device findings for the photo
            just captured. First-class in the wizard; inert unless the native
            runtime + a signed model are live. */}
        {ML_RUNTIME_ENABLED &&
          !!aiImageUri &&
          (active.kind === 'photo' || active.kind === 'photo_with_face' || active.kind === 'document_upload') && (
          <View style={s.aiWrap}>
            <View style={s.aiHead}>
              <ShieldCheck size={14} color={C.primarySoft} />
              <Text style={s.aiHeadText}>AI Co-Inspector, review &amp; accept</Text>
            </View>
            <DefectFindingsCard
              analysis={da.analysis}
              loading={da.status === 'analyzing'}
              onAddFinding={acceptAiFinding}
              onDismiss={() => { setAiImageUri(null); da.reset(); }}
            />
            {da.status === 'unavailable' && (
              <Text style={s.aiNote}>
                {da.error ?? 'Model unavailable, publish the universal-detector model and run a dev build with the ML runtime enabled.'}
              </Text>
            )}
            {!!aiRecorded.length && (
              <Text style={s.aiRecorded}>{aiRecorded.length} AI finding(s) recorded ✓, sealed with this inspection.</Text>
            )}
            {!!aiNote && <Text style={s.aiNote}>{aiNote}</Text>}
          </View>
        )}

        {/* Nav */}
        <View style={s.navRow}>
          <Pressable
            onPress={() => setActiveIdx((i) => Math.max(0, i - 1))}
            disabled={activeIdx === 0}
            style={[s.navBtn, activeIdx === 0 && { opacity: 0.4 }]}
          >
            <ChevronLeft size={16} color={C.text} />
            <Text style={s.navBtnText}>Previous</Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveIdx((i) => Math.min(requirements.length - 1, i + 1))}
            disabled={activeIdx >= requirements.length - 1}
            style={[s.navBtn, activeIdx >= requirements.length - 1 && { opacity: 0.4 }]}
          >
            <Text style={s.navBtnText}>Next</Text>
            <ChevronRight size={16} color={C.text} />
          </Pressable>
        </View>

        {allDone && (
          <View style={s.allDoneCard}>
            <ShieldCheck size={22} color={C.ok} />
            <Text style={s.allDoneTitle}>All requirements satisfied</Text>
            <Text style={s.allDoneBody}>
              Tap below to compile the Verified Compliance Affidavit. The server will
              re-validate every capture, walk the integrity chain, sign the canonical
              payload with Ed25519, and issue the public verify URL.
            </Text>
            <Pressable
              onPress={generateVca}
              disabled={generating}
              style={[s.generateBtn, generating && { opacity: 0.6 }]}
            >
              {generating
                ? <ActivityIndicator color="#FFF" />
                : <><FileSignature size={16} color="#FFF" /><Text style={s.generateBtnText}>Generate Affidavit</Text></>}
            </Pressable>
            {vcaResult && (
              <View style={s.vcaSuccessWrap}>
                <Text style={s.vcaSuccessLine}>
                  Issued, {vcaResult.chain.total} captures, key {vcaResult.signing_key_id}
                </Text>
                <Pressable
                  onPress={() => router.push(`/verify/${vcaResult.public_verify_token}` as any)}
                  style={s.openVerifyBtn}
                >
                  <ExternalLink size={14} color={C.ok} />
                  <Text style={s.openVerifyText}>Open public verify page</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ─── Camera modal ─────────────────────────────────────── */}
      <Modal visible={camOpen} animationType="slide" onRequestClose={() => setCamOpen(false)}>
        <View style={s.camBg}>
          {!preview ? (
            <>
              <CameraView
                ref={(r) => { cameraRef.current = r; }}
                style={{ flex: 1 }}
                facing={camFacing}
              />
              <View style={s.camControls}>
                <Pressable onPress={() => setCamOpen(false)} style={s.camIconBtn}>
                  <X size={22} color="#FFF" />
                </Pressable>
                <Pressable onPress={onShutter} style={s.shutter}>
                  <View style={s.shutterInner} />
                </Pressable>
                <Pressable
                  onPress={() => setCamFacing((f) => (f === 'back' ? 'front' : 'back'))}
                  style={s.camIconBtn}
                >
                  <RotateCcw size={22} color="#FFF" />
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Image source={{ uri: preview.uri }} style={{ flex: 1 }} resizeMode="contain" />
              <View style={s.camControls}>
                <Pressable onPress={() => setPreview(null)} style={[s.camIconBtn, { backgroundColor: 'rgba(239,68,68,0.18)' }]}>
                  <RotateCcw size={20} color="#FFF" />
                </Pressable>
                <Pressable
                  onPress={persistPhotoCapture}
                  disabled={busy}
                  style={[s.useBtn, busy && { opacity: 0.6 }]}
                >
                  {busy
                    ? <ActivityIndicator color="#FFF" />
                    : <><CheckCircle2 size={18} color="#FFF" /><Text style={s.useBtnText}>Use & Save</Text></>}
                </Pressable>
                <Pressable onPress={() => setCamOpen(false)} style={s.camIconBtn}>
                  <X size={20} color="#FFF" />
                </Pressable>
              </View>
            </>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
const kindLabel = (k: EvidenceKind): string => ({
  photo: 'Photo',
  photo_with_face: 'Photo + Face',
  gps_pin: 'GPS Pin',
  document_upload: 'Document',
  video_walkthrough: 'Video',
  rep_interview: 'Rep Interview',
  signed_statement: 'Signed Statement',
  text_input: 'Text',
}[k]);

const validationDot = (status: string) => ({
  backgroundColor: status === 'valid' ? C.ok : status === 'flagged' ? C.warn : status === 'rejected' ? C.danger : C.textDim,
});

// ─────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  bg: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  statusTitle: { color: C.text, fontSize: 14, fontWeight: '700' },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: C.text, fontSize: 15, fontWeight: '800' },
  headerSub: { color: C.textDim, fontSize: 11, marginTop: 1 },
  allDonePill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(16,185,129,0.14)', borderColor: 'rgba(16,185,129,0.45)',
    borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8,
  },
  allDonePillText: { color: C.ok, fontSize: 10, fontWeight: '800' },

  strip: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  stripChip: {
    width: 44, height: 44, borderRadius: 10,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
    justifyContent: 'center', alignItems: 'center',
  },
  stripChipOn:   { backgroundColor: C.primary, borderColor: C.primary },
  stripChipDone: { borderColor: C.ok },
  stripChipNum:  { color: C.text, fontSize: 13, fontWeight: '800' },
  stripChipMeta: { color: C.textDim, fontSize: 9, marginTop: 2 },

  reqCard: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 14, padding: 14, marginBottom: 14,
  },
  reqKind:  { color: C.primarySoft, fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 },
  reqLabel: { color: C.text, fontSize: 15, fontWeight: '800' },
  reqHint:  { color: C.textSec, fontSize: 12, marginTop: 6, fontStyle: 'italic', lineHeight: 17 },
  reqMeta:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  reqMetaText: { color: C.textDim, fontSize: 11 },

  captureCard: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 14, padding: 14, marginBottom: 14,
  },
  captureHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  captureTitle: { color: C.text, fontSize: 13, fontWeight: '800' },
  captureBody:  { color: C.textSec, fontSize: 12, lineHeight: 17, marginBottom: 12 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, borderRadius: 12, backgroundColor: C.primary,
  },
  primaryBtnText: { color: '#FFF', fontSize: 13, fontWeight: '800' },

  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, color: C.text, fontSize: 14, marginBottom: 12,
  },

  // Captured-so-far list
  capList: {
    backgroundColor: C.card, borderColor: C.border, borderWidth: 1,
    borderRadius: 14, padding: 12, marginBottom: 14, gap: 6,
  },
  capListTitle: { color: C.textDim, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  capRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  capDot: { width: 8, height: 8, borderRadius: 4 },
  capName: { color: C.text, fontSize: 12, fontWeight: '700' },
  capSha:  { color: C.textDim, fontSize: 10, marginTop: 1, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any },
  capStatus: { color: C.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },

  navRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  navBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  navBtnText: { color: C.text, fontSize: 12, fontWeight: '700' },

  allDoneCard: {
    backgroundColor: 'rgba(16,185,129,0.10)', borderColor: 'rgba(16,185,129,0.45)',
    borderWidth: 1, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6,
  },
  allDoneTitle: { color: C.ok, fontSize: 14, fontWeight: '800' },
  allDoneBody:  { color: C.textSec, fontSize: 12, textAlign: 'center', lineHeight: 17 },

  // STEP 7.5 — Generate Affidavit CTA + post-issue verify link
  generateBtn: {
    marginTop: 8, alignSelf: 'stretch',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, borderRadius: 12, backgroundColor: C.ok,
  },
  generateBtnText: { color: '#FFF', fontSize: 13, fontWeight: '800' },
  vcaSuccessWrap: { marginTop: 10, alignSelf: 'stretch', alignItems: 'center', gap: 8 },
  vcaSuccessLine: { color: C.textSec, fontSize: 11, fontStyle: 'italic' },
  openVerifyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: C.ok,
    backgroundColor: 'rgba(16,185,129,0.06)',
  },
  openVerifyText: { color: C.ok, fontSize: 12, fontWeight: '700' },

  // Camera modal
  camBg: { flex: 1, backgroundColor: '#000' },
  camControls: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    backgroundColor: '#000', paddingHorizontal: 24, paddingVertical: 18, paddingBottom: 36,
  },
  camIconBtn: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
    justifyContent: 'center', alignItems: 'center',
  },
  shutter: {
    width: 76, height: 76, borderRadius: 38,
    borderWidth: 4, borderColor: '#FFF',
    justifyContent: 'center', alignItems: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF' },
  useBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12,
    backgroundColor: C.ok,
  },
  useBtnText: { color: '#FFF', fontSize: 13, fontWeight: '800' },

  // AI Co-Inspector section
  aiWrap: { marginBottom: 14, gap: 8 },
  aiHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  aiHeadText: { color: C.primarySoft, fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },
  aiRecorded: { color: C.ok, fontSize: 12, fontWeight: '700' },
  aiNote: { color: C.textSec, fontSize: 11, lineHeight: 16 },
});
