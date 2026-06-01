// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/vault/[id].tsx — Mobile Evidence Vault (admin detail)
//
//  Read-only detail over the REAL public.client_documents schema (id, owner_id,
//  job_id, kind, label, file_path, external_url, notes, created_at, updated_at).
//  Opens the file via a 5-min signed URL from the private `client_documents`
//  bucket, or the external_url link. Admin-gated (role IN admin/super_admin).
//  No verify/expiry actions — those columns do not exist on the live table.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, StatusBar, SafeAreaView, Alert, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  amber: '#F59E0B', red: '#EF4444',
};

type DocKind = 'drawing' | 'spec_sheet' | 'nda' | 'prior_report' | 'regulatory' | 'vendor_doc' | 'photo_evidence' | 'other';
const KIND_LABEL: Record<string, string> = {
  drawing: 'Drawing', spec_sheet: 'Spec sheet', nda: 'NDA', prior_report: 'Prior report',
  regulatory: 'Regulatory', vendor_doc: 'Vendor doc', photo_evidence: 'Photo evidence', other: 'Other',
};
const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  drawing: 'create-outline', spec_sheet: 'list-outline', nda: 'lock-closed-outline', prior_report: 'document-text-outline',
  regulatory: 'business-outline', vendor_doc: 'cube-outline', photo_evidence: 'image-outline', other: 'folder-outline',
};

interface VaultDoc {
  id: string;
  kind: string;
  label: string;
  ownerName: string | null;
  jobId: string | null;
  jobTitle: string | null;
  filePath: string | null;
  externalUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function VaultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [doc, setDoc] = useState<VaultDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }
      const profRes = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const role = (profRes.data as { role?: string } | null)?.role;
      const admin = role === 'admin' || role === 'super_admin';
      setIsAdmin(admin);
      if (!admin) return;

      const { data, error: qErr } = await supabase
        .from('client_documents')
        .select('id, owner_id, job_id, kind, label, file_path, external_url, notes, created_at, updated_at')
        .eq('id', String(id))
        .maybeSingle();
      if (qErr) { setError(qErr.message); return; }
      if (!data) { setError('Document not found.'); return; }
      const r = data as Record<string, unknown>;

      let ownerName: string | null = null;
      if (r.owner_id) {
        const { data: p } = await supabase.from('profiles').select('full_name, email').eq('id', String(r.owner_id)).maybeSingle();
        const pr = p as { full_name?: string | null; email?: string | null } | null;
        ownerName = pr?.full_name || pr?.email || null;
      }
      let jobTitle: string | null = null;
      if (r.job_id) {
        const { data: j } = await supabase.from('jobs').select('title').eq('id', String(r.job_id)).maybeSingle();
        jobTitle = (j as { title?: string | null } | null)?.title ?? null;
      }

      setDoc({
        id: String(r.id),
        kind: String(r.kind ?? 'other'),
        label: String(r.label ?? '(untitled)'),
        ownerName,
        jobId: r.job_id ? String(r.job_id) : null,
        jobTitle,
        filePath: (r.file_path as string | null) ?? null,
        externalUrl: (r.external_url as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        createdAt: String(r.created_at ?? ''),
        updatedAt: String(r.updated_at ?? ''),
      });
    } catch (e: unknown) {
      setError((e as Error)?.message ?? 'Could not load the document.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const openFile = useCallback(async () => {
    if (!doc) return;
    setOpening(true);
    try {
      if (doc.filePath) {
        const { data, error: sErr } = await supabase.storage.from('client_documents').createSignedUrl(doc.filePath, 300);
        if (sErr || !data?.signedUrl) { Alert.alert('Could not open', sErr?.message ?? 'No signed URL available.'); return; }
        await Linking.openURL(data.signedUrl);
      } else if (doc.externalUrl) {
        await Linking.openURL(doc.externalUrl);
      } else {
        Alert.alert('No file', 'This record has no attached file or link.');
      }
    } catch (e: unknown) {
      Alert.alert('Could not open', (e as Error)?.message ?? 'Unknown error.');
    } finally {
      setOpening(false);
    }
  }, [doc]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Document</Text>
        <View style={{ width: 22 }} />
      </View>

      {!isAdmin ? (
        <View style={s.center}><View style={s.reservedCard}><Ionicons name="lock-closed-outline" size={20} color={C.amber} /><Text style={s.reservedTitle}>Reserved access</Text><Text style={s.reservedBody}>Reserved for the platform owner (admin).</Text></View></View>
      ) : error || !doc ? (
        <View style={s.center}><Text style={s.centerText}>{error ?? 'Not found.'}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeIn.duration(200)} style={{ gap: 16 }}>
            <View>
              <View style={s.kindRow}>
                <View style={s.kindIcon}><Ionicons name={KIND_ICON[doc.kind] ?? 'folder-outline'} size={16} color={C.primary} /></View>
                <Text style={s.kicker}>{(KIND_LABEL[doc.kind] ?? 'Other').toUpperCase()}</Text>
              </View>
              <Text style={s.title}>{doc.label}</Text>
              {doc.ownerName && <Text style={s.owner}>{doc.ownerName}</Text>}
            </View>

            <View style={s.metaCard}>
              <MetaRow label="Type" value={KIND_LABEL[doc.kind] ?? 'Other'} />
              <MetaRow label="Uploaded" value={formatDate(doc.createdAt)} />
              <MetaRow label="Updated" value={formatDate(doc.updatedAt)} />
              <MetaRow label="Delivery" value={doc.filePath ? 'Uploaded file' : doc.externalUrl ? 'External link' : '—'} />
            </View>

            <TouchableOpacity style={[s.openBtn, !(doc.filePath || doc.externalUrl) && s.openBtnDisabled]} onPress={openFile} activeOpacity={0.8} disabled={opening || !(doc.filePath || doc.externalUrl)}>
              {opening ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name={doc.filePath || doc.externalUrl ? 'open-outline' : 'document-outline'} size={18} color="#fff" />}
              <Text style={s.openBtnText}>{doc.filePath ? 'Open file' : doc.externalUrl ? 'Open link' : 'No file attached'}</Text>
            </TouchableOpacity>

            {doc.notes ? (
              <View style={s.notesCard}><Text style={s.notesLabel}>NOTES</Text><Text style={s.notesText}>{doc.notes}</Text></View>
            ) : null}

            {doc.jobTitle ? (
              <TouchableOpacity style={s.jobCard} activeOpacity={0.8} onPress={() => doc.jobId && router.push(`/(admin)/jobs/${doc.jobId}` as any)}>
                <Ionicons name="briefcase-outline" size={16} color={C.primary} />
                <Text style={s.jobText} numberOfLines={1}>{doc.jobTitle}</Text>
                <Ionicons name="chevron-forward" size={14} color={C.textMute} />
              </TouchableOpacity>
            ) : null}

            <Text style={s.footnote}>Source · public.client_documents · file via signed URL (5 min) · RLS cdocs_admin_all.</Text>
          </Animated.View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaRowLabel}>{label}</Text>
      <Text style={s.metaRowValue}>{value}</Text>
    </View>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kindIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center' },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 24, fontWeight: '700', marginTop: 8 },
  owner: { color: C.textSec, fontSize: 12, marginTop: 6 },

  metaCard: { borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 4 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  metaRowLabel: { color: C.textMute, fontSize: 12 },
  metaRowValue: { color: C.text, fontSize: 13, fontWeight: '600' },

  openBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14 },
  openBtnDisabled: { opacity: 0.4 },
  openBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  notesCard: { borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)', padding: 14, gap: 6 },
  notesLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  notesText: { color: C.textSec, fontSize: 13, lineHeight: 19 },

  jobCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 14 },
  jobText: { color: C.text, fontSize: 13, fontWeight: '600', flex: 1 },

  reservedCard: { alignItems: 'center', gap: 8, padding: 24, maxWidth: 320, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', backgroundColor: 'rgba(245,158,11,0.14)' },
  reservedTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 4 },
});
