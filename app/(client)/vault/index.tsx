// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/vault/index.tsx — Mobile CLIENT Evidence Vault (list + upload)
//
//  Web parity for /client/vault. The client browses + uploads their OWN
//  compliance documents. Source-of-truth = public.client_documents, scoped by
//  RLS policy `cdocs_owner_all` (FOR ALL where owner_id = auth.uid()) — so the
//  client only ever sees/writes their own rows; no admin gate.
//
//  Uses ONLY columns proven to exist on the live table (id, owner_id, job_id,
//  kind, label, file_path, external_url, notes, created_at, updated_at) — the
//  web's category/verify/expiry projection is dormant (no migration), matching
//  the existing (admin)/vault screen's discipline.
//
//  Upload: expo-document-picker → private `client_documents` bucket
//  (`${uid}/${ts}-${name}`) → INSERT row (owner_id = self). Read+write allowed
//  by RLS. Tap a card → /(client)/vault/[id].
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  green: '#10B981', amber: '#F59E0B', red: '#EF4444',
};

type DocKind = 'drawing' | 'spec_sheet' | 'nda' | 'prior_report' | 'regulatory' | 'vendor_doc' | 'photo_evidence' | 'other';
type FilterKey = 'all' | DocKind;

interface DocRow {
  id: string; kind: DocKind; label: string; jobTitle: string | null;
  hasFile: boolean; isLink: boolean; updatedAt: string;
}

const KIND_LABEL: Record<DocKind, string> = {
  drawing: 'Drawing', spec_sheet: 'Spec sheet', nda: 'NDA', prior_report: 'Prior report',
  regulatory: 'Regulatory', vendor_doc: 'Vendor doc', photo_evidence: 'Photo evidence', other: 'Other',
};
const KIND_ICON: Record<DocKind, keyof typeof Ionicons.glyphMap> = {
  drawing: 'create-outline', spec_sheet: 'list-outline', nda: 'lock-closed-outline', prior_report: 'document-text-outline',
  regulatory: 'business-outline', vendor_doc: 'cube-outline', photo_evidence: 'image-outline', other: 'folder-outline',
};
const KIND_ORDER: DocKind[] = ['regulatory', 'nda', 'drawing', 'spec_sheet', 'prior_report', 'vendor_doc', 'photo_evidence', 'other'];
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' }, ...KIND_ORDER.map((k) => ({ key: k, label: KIND_LABEL[k] })),
];

async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const resp = await fetch(uri);
  const blob = await resp.blob();
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new Error('read failed')));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export default function ClientVaultScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }
      const { data, error: qErr } = await supabase
        .from('client_documents')
        .select('id, owner_id, job_id, kind, label, file_path, external_url, updated_at')
        .eq('owner_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(300);
      if (qErr) { setError(qErr.message); return; }
      const docRows = (data ?? []) as Array<Record<string, unknown>>;
      const jobIds = Array.from(new Set(docRows.map((r) => String(r.job_id ?? '')).filter(Boolean)));
      const titleByJob = new Map<string, string | null>();
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase.from('jobs').select('id, title').in('id', jobIds);
        (jobs as Array<{ id: string; title: string | null }> | null)?.forEach((j) => titleByJob.set(j.id, j.title));
      }
      setRows(docRows.map((r) => ({
        id: String(r.id),
        kind: (KIND_LABEL[r.kind as DocKind] ? (r.kind as DocKind) : 'other'),
        label: String(r.label ?? '(untitled)'),
        jobTitle: r.job_id ? (titleByJob.get(String(r.job_id)) ?? null) : null,
        hasFile: Boolean(r.file_path),
        isLink: !r.file_path && Boolean(r.external_url),
        updatedAt: String(r.updated_at ?? ''),
      })));
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Could not load your vault.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const counts = useMemo(() => {
    let files = 0, links = 0, onJob = 0;
    const byKind = new Map<string, number>();
    rows.forEach((r) => {
      if (r.hasFile) files += 1;
      if (r.isLink) links += 1;
      if (r.jobTitle) onJob += 1;
      byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + 1);
    });
    return { total: rows.length, files, links, onJob, byKind };
  }, [rows]);

  const visible = useMemo(() => (filter === 'all' ? rows : rows.filter((r) => r.kind === filter)), [rows, filter]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>Loading your vault…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Document vault</Text>
        <TouchableOpacity onPress={() => setUploadOpen(true)} hitSlop={10}><Ionicons name="add-circle" size={24} color={C.primary} /></TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        <Animated.View entering={FadeIn.duration(220)} style={s.heroWrap}>
          <Text style={s.kicker}>YOUR, EVIDENCE VAULT</Text>
          <Text style={s.title}>Documents</Text>
          <Text style={s.subtitle}>
            Your compliance documents, drawings, specs, NDAs, regulatory and vendor
            evidence. Upload here and attach them to jobs. Tap to open a file.
          </Text>
        </Animated.View>

        {error ? (
          <View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>
        ) : null}

        <Animated.View entering={FadeInDown.delay(60).duration(240)} style={s.statsGrid}>
          <StatTile label="TOTAL" value={String(counts.total)} />
          <StatTile label="FILES" value={String(counts.files)} tone={C.green} />
          <StatTile label="LINKS" value={String(counts.links)} />
          <StatTile label="ON JOBS" value={String(counts.onJob)} />
        </Animated.View>

        <TouchableOpacity style={s.uploadCta} activeOpacity={0.85} onPress={() => setUploadOpen(true)}>
          <Ionicons name="cloud-upload-outline" size={18} color={C.primary} />
          <Text style={s.uploadCtaText}>Upload a document</Text>
        </TouchableOpacity>

        <Animated.View entering={FadeInDown.delay(120).duration(240)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
            {FILTERS.map((f) => {
              const active = filter === f.key;
              const n = f.key === 'all' ? counts.total : (counts.byKind.get(f.key) ?? 0);
              return (
                <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)} style={[s.filterChip, active && s.filterChipActive]} activeOpacity={0.7}>
                  <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{f.label}{n > 0 ? ` ${n}` : ''}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>

        {visible.length === 0 ? (
          <View style={s.emptyState}>
            <Ionicons name="folder-open-outline" size={32} color={C.textMute} />
            <Text style={s.emptyText}>{filter === 'all' ? 'No documents yet. Tap “Upload a document” to add your first.' : `No ${KIND_LABEL[filter as DocKind]} documents.`}</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>{visible.map((d) => <VaultCard key={d.id} d={d} />)}</View>
        )}

        <Text style={s.footnote}>Source, public.client_documents, RLS cdocs_owner_all (you see only your own).</Text>
      </ScrollView>

      <UploadModal visible={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={() => { setUploadOpen(false); void load(); }} />
    </SafeAreaView>
  );
}

function VaultCard({ d }: { d: DocRow }) {
  return (
    <TouchableOpacity onPress={() => router.push(`/(client)/vault/${d.id}` as any)} style={s.docCard} activeOpacity={0.75}>
      <LinearGradient colors={[C.primaryDim, 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.docCardGradient} />
      <View style={s.docIcon}><Ionicons name={KIND_ICON[d.kind]} size={18} color={C.primary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.docLabel} numberOfLines={1}>{d.label}</Text>
        <View style={s.docMeta}>
          <Text style={s.docKind}>{KIND_LABEL[d.kind].toUpperCase()}</Text>
          {d.jobTitle ? (<><Text style={s.dot}>·</Text><Ionicons name="briefcase-outline" size={10} color={C.textMute} /><Text style={s.docMetaText} numberOfLines={1}>{d.jobTitle}</Text></>) : null}
        </View>
      </View>
      <View style={s.docRight}>
        {d.hasFile ? <Ionicons name="document-attach-outline" size={13} color={C.textMute} /> : d.isLink ? <Ionicons name="link-outline" size={13} color={C.textMute} /> : null}
        <Ionicons name="chevron-forward" size={14} color={C.textMute} />
      </View>
    </TouchableOpacity>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={s.statTile}><Text style={s.statLabel}>{label}</Text><Text style={[s.statValue, { color: tone ?? C.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View>
  );
}

// ─── Upload modal ──────────────────────────────────────────────────────────
function UploadModal({ visible, onClose, onUploaded }: { visible: boolean; onClose: () => void; onUploaded: () => void }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<DocKind>('other');
  const [picked, setPicked] = useState<{ uri: string; name: string; mimeType?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (visible) { setLabel(''); setKind('other'); setPicked(null); } }, [visible]);

  const pick = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setPicked({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? undefined });
    if (!label.trim()) setLabel(a.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    if (!picked) { Alert.alert('Choose a file', 'Pick a document to upload first.'); return; }
    if (!label.trim()) { Alert.alert('Add a label', 'Give the document a name.'); return; }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in.');
      const ext = picked.name.includes('.') ? picked.name.split('.').pop() : 'bin';
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const buf = await uriToArrayBuffer(picked.uri);
      const up = await supabase.storage.from('client_documents').upload(path, buf, {
        contentType: picked.mimeType ?? 'application/octet-stream', upsert: false,
      });
      if (up.error) throw up.error;
      const ins = await supabase.from('client_documents').insert({
        owner_id: user.id, kind, label: label.trim(), file_path: path,
      });
      if (ins.error) throw ins.error;
      onUploaded();
    } catch (e) {
      Alert.alert('Upload failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Upload document</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={22} color={C.textSec} /></TouchableOpacity>
          </View>

          <Text style={s.fieldLabel}>LABEL</Text>
          <TextInput value={label} onChangeText={setLabel} placeholder="e.g. ISO 9001 certificate" placeholderTextColor={C.textMute} style={s.input} />

          <Text style={s.fieldLabel}>TYPE</Text>
          <View style={s.kindWrap}>
            {KIND_ORDER.map((k) => (
              <TouchableOpacity key={k} onPress={() => setKind(k)} style={[s.kindChip, kind === k && s.kindChipActive]} activeOpacity={0.7}>
                <Text style={[s.kindChipText, kind === k && s.kindChipTextActive]}>{KIND_LABEL[k]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={s.pickBtn} onPress={pick} activeOpacity={0.8}>
            <Ionicons name={picked ? 'document-attach' : 'attach'} size={18} color={C.primary} />
            <Text style={s.pickBtnText} numberOfLines={1}>{picked ? picked.name : 'Choose a file'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={[s.submitBtn, (busy || !picked) && { opacity: 0.5 }]} onPress={submit} disabled={busy || !picked} activeOpacity={0.85}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="cloud-upload-outline" size={18} color="#fff" />}
            <Text style={s.submitBtnText}>{busy ? 'Uploading…' : 'Upload'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  heroWrap: { gap: 6 },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 28, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(239,68,68,0.14)', borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1, padding: 12, borderRadius: 12 },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: { flexBasis: '23%', flexGrow: 1, padding: 12, minHeight: 64, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  statLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  statValue: { fontSize: 18, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },

  uploadCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)', backgroundColor: C.primaryDim },
  uploadCtaText: { color: C.primary, fontSize: 14, fontWeight: '700' },

  filterRow: { gap: 8, paddingHorizontal: 2 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  filterChipActive: { backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)' },
  filterChipText: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: C.primary, fontWeight: '700' },

  emptyState: { alignItems: 'center', padding: 32, gap: 10, borderRadius: 18, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.01)' },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },

  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, overflow: 'hidden' },
  docCardGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 60 },
  docIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center' },
  docLabel: { color: C.text, fontWeight: '600', fontSize: 14 },
  docMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4, flexWrap: 'wrap' },
  docKind: { color: C.primary, fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  docMetaText: { color: C.textMute, fontSize: 10, flexShrink: 1 },
  dot: { color: C.textMute, fontSize: 10 },
  docRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(2,4,32,0.8)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 36, borderWidth: 1, borderColor: C.border, gap: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  modalTitle: { color: C.text, fontSize: 17, fontWeight: '700' },
  fieldLabel: { color: C.textMute, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, marginTop: 6 },
  input: { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: C.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, color: C.text, fontSize: 14 },
  kindWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kindChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  kindChipActive: { backgroundColor: C.primaryDim, borderColor: 'rgba(124,58,237,0.45)' },
  kindChipText: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  kindChipTextActive: { color: C.primary, fontWeight: '700' },
  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(124,58,237,0.4)', backgroundColor: 'rgba(124,58,237,0.06)', marginTop: 4 },
  pickBtnText: { color: C.primary, fontSize: 13, fontWeight: '600', flex: 1 },
  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, marginTop: 6 },
  submitBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
