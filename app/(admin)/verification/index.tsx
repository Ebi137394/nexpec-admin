// app/(admin)/verification/index.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Inspector KYC & Certification verification queue.
// Approve or reject documents with notes.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Image, TextInput, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { SA, ago, statusColor } from '@/lib/super-admin/theme';
import { signedUrls, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';
import type { VerificationDoc } from '@/lib/super-admin/types';

type DocFilter = 'pending' | 'approved' | 'rejected' | 'all';

export default function VerificationCenter() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<VerificationDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DocFilter>('pending');

  // document_url holds a storage PATH (inspector-docs is owner+admin-only).
  // Admin is authorized, so we batch-mint signed URLs (keyed by path) after
  // each fetch and render/open from this cache. Never mint in render.
  const [docUrlCache, setDocUrlCache] = useState<Record<string, string | null>>({});

  // Rejection notes
  const [notesFor, setNotesFor] = useState<string | null>(null);
  const [notesText, setNotesText] = useState('');
  const [processing, setProcessing] = useState<string | null>(null);

  /* ── Fetch ──────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      setError(null);
      
      // Step 1: Fetch documents
      let query = supabase
        .from('inspector_documents')
        // inspector_documents columns are inspector_id/doc_name/file_url — alias to
        // the names this screen reads (user_id/document_type/document_url) so the
        // phantom-column reads resolve. reviewed_* added in migration 202000.
        .select('id, user_id:inspector_id, document_type:doc_name, document_url:file_url, status, created_at, reviewed_at, reviewed_by, notes, expiry_date')
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('status', filter);
      }

      const { data: docsData, error: docsError } = await query;
      if (docsError) throw docsError;
      const docsList = (docsData as VerificationDoc[]) ?? [];

      // Step 2: Extract unique user IDs
      const uniqueIds = Array.from(new Set(docsList.map(d => d.user_id).filter(Boolean)));

      // Step 3: Fetch profiles in batch
      let profilesMap = new Map();
      if (uniqueIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name, email, phone, avatar_url')
          .in('id', uniqueIds);

        if (profilesError) throw profilesError;
        
        profilesMap = new Map(profilesData?.map(p => [p.id, p]) || []);
      }

      // Step 4: Map profiles back to documents
      const docsWithProfiles = docsList.map(doc => ({
        ...doc,
        user: doc.user_id ? profilesMap.get(doc.user_id) : null,
      }));

      setDocs(docsWithProfiles);

      // Batch-mint signed URLs for the doc paths (admin is authorized).
      const paths = Array.from(
        new Set(docsList.map(d => d.document_url).filter(Boolean) as string[]),
      );
      if (paths.length > 0) {
        const minted = await signedUrls('inspector-docs', paths, SIGNED_URL_TTL.VIEW);
        setDocUrlCache(prev => ({ ...prev, ...minted }));
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load documents');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  /* ── Approve ────────────────────────────────── */
  const approve = useCallback(async (docId: string) => {
    Alert.alert('Approve', 'Verify this document as authentic?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          setProcessing(docId);
          try {
            const { error: e } = await supabase
              .from('inspector_documents')
              .update({
                status: 'approved',
                reviewed_at: new Date().toISOString(),
                reviewed_by: user?.id,
              })
              .eq('id', docId);
            if (e) throw e;
            load();
          } catch (err: any) {
            Alert.alert('Error', err.message);
          } finally {
            setProcessing(null);
          }
        },
      },
    ]);
  }, [user, load]);

  /* ── Reject ─────────────────────────────────── */
  const reject = useCallback(async (docId: string) => {
    if (!notesText.trim()) {
      Alert.alert('Required', 'Please provide a reason for rejection.');
      return;
    }
    setProcessing(docId);
    try {
      const { error: e } = await supabase
        .from('inspector_documents')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user?.id,
          notes: notesText.trim(),
        })
        .eq('id', docId);
      if (e) throw e;
      setNotesFor(null);
      setNotesText('');
      load();
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setProcessing(null);
    }
  }, [notesText, user, load]);

  /* ── Open Document ──────────────────────────── */
  const openDoc = useCallback((url: string) => {
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Cannot open document URL'));
  }, []);

  /* ── Filter Tab ─────────────────────────────── */
  const Tab = ({ f, label }: { f: DocFilter; label: string }) => (
    <TouchableOpacity
      style={[s.tab, filter === f && s.tabActive]}
      onPress={() => { setFilter(f); setLoading(true); }}
    >
      <Text style={[s.tabText, filter === f && s.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );

  /* ── Card ───────────────────────────────────── */
  const renderDoc = ({ item }: { item: VerificationDoc }) => {
    const profile = item.user as any;
    const isImg = /\.(jpg|jpeg|png|webp|gif)$/i.test(item.document_url ?? '');
    const showNotes = notesFor === item.id;
    const signedDocUrl = item.document_url ? docUrlCache[item.document_url] : null;

    return (
      <View style={s.card}>
        {/* Inspector info */}
        <View style={s.cardHeader}>
          {profile?.avatar_url ? (
            <Image source={{ uri: profile.avatar_url }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, s.avatarFallback]}>
              <Ionicons name="person" size={18} color={SA.textMuted} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.inspectorName}>{profile?.full_name ?? 'Unknown'}</Text>
            <Text style={s.inspectorEmail}>{profile?.email ?? '—'}</Text>
          </View>
          <View style={[s.statusBadge, { backgroundColor: statusColor(item.status) + '20' }]}>
            <Text style={[s.statusText, { color: statusColor(item.status) }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>

        {/* Document info */}
        <View style={s.docInfo}>
          <View style={s.docTypeWrap}>
            <Ionicons name="document-text-outline" size={16} color={SA.accent} />
            <Text style={s.docType}>{item.document_type.replace(/_/g, ' ').toUpperCase()}</Text>
          </View>
          <Text style={s.docDate}>Submitted {ago(item.created_at)}</Text>
        </View>

        {/* Document preview */}
        <TouchableOpacity
          style={s.previewWrap}
          onPress={() => signedDocUrl && openDoc(signedDocUrl)}
          disabled={!signedDocUrl}
        >
          {isImg && signedDocUrl ? (
            <Image source={{ uri: signedDocUrl }} style={s.previewImg} resizeMode="cover" />
          ) : (
            <View style={s.previewFile}>
              <Ionicons name="open-outline" size={24} color={SA.accent} />
              <Text style={s.previewText}>{signedDocUrl ? 'Open Document' : 'Loading…'}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Existing notes */}
        {item.notes && (
          <View style={s.notesDisplay}>
            <Text style={s.notesLabel}>Review Notes:</Text>
            <Text style={s.notesContent}>{item.notes}</Text>
          </View>
        )}

        {/* Actions (only for pending) */}
        {item.status === 'pending' && (
          <View style={s.actionArea}>
            {/* Reject notes input */}
            {showNotes && (
              <View style={s.notesInputWrap}>
                <TextInput
                  style={s.notesInput}
                  placeholder="Reason for rejection (required)…"
                  placeholderTextColor={SA.textMuted}
                  value={notesText}
                  onChangeText={setNotesText}
                  multiline
                  autoFocus
                />
              </View>
            )}

            <View style={s.actionRow}>
              <TouchableOpacity
                style={[s.rejectBtn, showNotes && notesText.trim() && s.rejectBtnActive]}
                onPress={() => {
                  if (showNotes) {
                    reject(item.id);
                  } else {
                    setNotesFor(item.id);
                    setNotesText('');
                  }
                }}
                disabled={processing === item.id}
              >
                {processing === item.id && notesFor === item.id ? (
                  <ActivityIndicator size="small" color={SA.danger} />
                ) : (
                  <>
                    <Ionicons name={showNotes ? 'send' : 'close-circle-outline'} size={16} color={SA.danger} />
                    <Text style={s.rejectText}>{showNotes ? 'Confirm Reject' : 'Reject'}</Text>
                  </>
                )}
              </TouchableOpacity>

              {showNotes && (
                <TouchableOpacity
                  style={s.cancelBtn}
                  onPress={() => { setNotesFor(null); setNotesText(''); }}
                >
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={s.approveBtn}
                onPress={() => approve(item.id)}
                disabled={processing === item.id}
              >
                {processing === item.id && notesFor !== item.id ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={16} color="#fff" />
                    <Text style={s.approveText}>Approve</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  };

  /* ── Render ─────────────────────────────────── */
  return (
    <View style={s.root}>
      <View style={s.tabs}>
        <Tab f="pending"  label="Pending" />
        <Tab f="approved" label="Approved" />
        <Tab f="rejected" label="Rejected" />
        <Tab f="all"      label="All" />
      </View>

      {error && (
        <TouchableOpacity style={s.errorBanner} onPress={load}>
          <Text style={s.errorText}>{error}</Text>
          <Text style={s.retryText}>Retry</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={SA.accent} />
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={i => i.id}
          renderItem={renderDoc}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={SA.accent} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="shield-outline" size={48} color={SA.textMuted} />
              <Text style={s.emptyText}>No {filter !== 'all' ? filter : ''} documents</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

/* ── Styles ──────────────────────────────────── */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: SA.bg, paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: SA.surface, borderWidth: 1, borderColor: SA.border,
  },
  tabActive: { backgroundColor: SA.accent, borderColor: SA.accent },
  tabText: { color: SA.textSec, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: '#fff' },

  card: {
    backgroundColor: SA.surface, borderRadius: SA.radius,
    padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: SA.border,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  avatar: { width: 42, height: 42, borderRadius: 21 },
  avatarFallback: {
    backgroundColor: SA.bg, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: SA.border,
  },
  inspectorName: { color: SA.text, fontSize: 15, fontWeight: '700', marginBottom: 1 },
  inspectorEmail: { color: SA.textMuted, fontSize: 12 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  docInfo: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  },
  docTypeWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docType: { color: SA.accent, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  docDate: { color: SA.textMuted, fontSize: 11 },

  previewWrap: { marginBottom: 12 },
  previewImg: { width: '100%', height: 180, borderRadius: SA.radiusSm },
  previewFile: {
    height: 80, borderRadius: SA.radiusSm, backgroundColor: SA.bg,
    justifyContent: 'center', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: SA.border,
  },
  previewText: { color: SA.accent, fontSize: 13, fontWeight: '600' },

  notesDisplay: {
    backgroundColor: SA.bg, borderRadius: SA.radiusSm, padding: 10, marginBottom: 12,
  },
  notesLabel: { color: SA.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 4 },
  notesContent: { color: SA.textSec, fontSize: 13, lineHeight: 18 },

  actionArea: { marginTop: 4 },
  notesInputWrap: { marginBottom: 10 },
  notesInput: {
    backgroundColor: SA.bg, borderRadius: SA.radiusSm,
    borderWidth: 1, borderColor: SA.danger + '50',
    padding: 12, color: SA.text, fontSize: 14,
    minHeight: 60, textAlignVertical: 'top',
  },
  actionRow: { flexDirection: 'row', gap: 10 },
  approveBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: SA.success, borderRadius: SA.radiusSm, paddingVertical: 12,
  },
  approveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  rejectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: SA.dangerSoft, borderRadius: SA.radiusSm, paddingVertical: 12,
    borderWidth: 1, borderColor: SA.danger + '30',
  },
  rejectBtnActive: { backgroundColor: SA.danger + '30' },
  rejectText: { color: SA.danger, fontSize: 14, fontWeight: '700' },
  cancelBtn: { justifyContent: 'center', paddingHorizontal: 12 },
  cancelText: { color: SA.textMuted, fontSize: 13, fontWeight: '600' },

  errorBanner: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: SA.dangerSoft, padding: 12, borderRadius: SA.radiusSm, marginBottom: 12,
  },
  errorText: { color: SA.danger, fontSize: 13 },
  retryText: { color: SA.danger, fontWeight: '700' },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: { color: SA.textMuted, fontSize: 14 },
});