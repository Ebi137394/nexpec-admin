// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/finance/compliance/[id].tsx — Mobile vault document detail
//
//  Shows full metadata, opens a signed download URL in the system browser,
//  and exposes owner-archive + admin-verify actions.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView,
  Alert, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', cyanDim: 'rgba(0,255,255,0.12)',
  green: '#10B981', greenDim: 'rgba(16,185,129,0.14)',
  amber: '#F59E0B', amberDim: 'rgba(245,158,11,0.14)',
  red: '#EF4444', redDim: 'rgba(239,68,68,0.14)',
};

type Category = 'insurance' | 'license' | 'nda' | 'msa' | 'regulatory' | 'audit' | 'other';

const CATEGORY_LABEL: Record<Category, string> = {
  insurance: 'Insurance', license: 'License', nda: 'NDA', msa: 'MSA',
  regulatory: 'Regulatory', audit: 'Audit', other: 'Other',
};

interface VaultDoc {
  id: string;
  ownerId: string;
  jobId: string | null;
  jobTitle: string | null;
  label: string;
  category: Category;
  filePath: string | null;
  externalUrl: string | null;
  notes: string | null;
  validFrom: string | null;
  validUntil: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  isOwn: boolean;
}

export default function VaultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);
  const [doc, setDoc] = useState<VaultDoc | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) { setError('No document id provided.'); setLoading(false); return; }
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }

      // Resolve admin role in parallel with doc fetch
      const [profRes, docRes] = await Promise.all([
        supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
        supabase
          .from('client_documents')
          .select('id, owner_id, job_id, label, category, file_path, external_url, notes, valid_from, valid_until, is_verified, verified_at, is_archived, created_at, updated_at')
          .eq('id', id)
          .maybeSingle(),
      ]);
      const role = (profRes.data as { role?: string | null } | null)?.role ?? '';
      setIsAdmin(role === 'admin' || role === 'super_admin');

      if (docRes.error || !docRes.data) {
        setError(docRes.error?.message ?? 'Document not found.');
        return;
      }
      const r = docRes.data as Record<string, unknown>;
      let jobTitle: string | null = null;
      const jobId = (r.job_id as string | null) ?? null;
      if (jobId) {
        const { data: jrow } = await supabase
          .from('jobs').select('title').eq('id', jobId).maybeSingle();
        jobTitle = (jrow as { title?: string | null } | null)?.title ?? null;
      }
      setDoc({
        id: String(r.id),
        ownerId: String(r.owner_id ?? ''),
        jobId,
        jobTitle,
        label: String(r.label ?? 'Untitled'),
        category: ((r.category as string) ?? 'other') as Category,
        filePath: (r.file_path as string | null) ?? null,
        externalUrl: (r.external_url as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        validFrom: (r.valid_from as string | null) ?? null,
        validUntil: (r.valid_until as string | null) ?? null,
        isVerified: Boolean(r.is_verified),
        verifiedAt: (r.verified_at as string | null) ?? null,
        isArchived: Boolean(r.is_archived),
        createdAt: String(r.created_at ?? ''),
        updatedAt: String(r.updated_at ?? ''),
        isOwn: String(r.owner_id ?? '') === user.id,
      });
    } catch (e) {
      console.warn('[vault detail] load threw:', e);
      setError('Could not load document.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  const handleDownload = useCallback(async () => {
    if (!doc?.filePath) return;
    try {
      const { data, error: signErr } = await supabase.storage
        .from('client_documents')
        .createSignedUrl(doc.filePath, 300);
      if (signErr || !data?.signedUrl) {
        Alert.alert('Could not open file', signErr?.message ?? 'Try again.');
        return;
      }
      Linking.openURL(data.signedUrl);
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    }
  }, [doc?.filePath]);

  const handleVerifyToggle = useCallback(async () => {
    if (!doc || !isAdmin) return;
    const next = !doc.isVerified;
    Alert.alert(
      next ? 'Verify document?' : 'Revoke verification?',
      next
        ? 'You confirm this document is genuine and current.'
        : 'This will remove the verified mark.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next ? 'Verify' : 'Revoke',
          style: next ? 'default' : 'destructive',
          onPress: async () => {
            setActing(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;
              const { error: updErr } = await supabase
                .from('client_documents')
                .update({
                  is_verified: next,
                  verified_by: next ? user.id : null,
                  verified_at: next ? new Date().toISOString() : null,
                })
                .eq('id', doc.id);
              if (updErr) {
                Alert.alert('Error', updErr.message);
                return;
              }
              await load();
            } finally {
              setActing(false);
            }
          },
        },
      ],
    );
  }, [doc, isAdmin, load]);

  const handleArchiveToggle = useCallback(async () => {
    if (!doc || !doc.isOwn) return;
    const next = !doc.isArchived;
    Alert.alert(
      next ? 'Archive document?' : 'Restore document?',
      next ? 'It will be hidden from the default view but preserved.' : 'Document returns to the active list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next ? 'Archive' : 'Restore',
          onPress: async () => {
            setActing(true);
            try {
              const { error: updErr } = await supabase
                .from('client_documents')
                .update({ is_archived: next })
                .eq('id', doc.id);
              if (updErr) { Alert.alert('Error', updErr.message); return; }
              await load();
            } finally {
              setActing(false);
            }
          },
        },
      ],
    );
  }, [doc, load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={s.centerText}>Loading document…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !doc) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={36} color={C.red} />
          <Text style={s.centerText}>{error ?? 'Document not found.'}</Text>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backBtnText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const expiry = expiryStatus(doc.validUntil);

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        <Animated.View entering={FadeIn.duration(220)}>
          <LinearGradient
            colors={[C.primaryDim, 'rgba(0,0,0,0)']}
            start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <Text style={s.heroKicker}>CLIENT PORTAL, COMPLIANCE</Text>
            <Text style={s.heroLabel}>{doc.label}</Text>
            <View style={s.heroBadgeRow}>
              <View style={s.categoryBadge}>
                <Text style={s.categoryBadgeText}>{CATEGORY_LABEL[doc.category].toUpperCase()}</Text>
              </View>
              {doc.isVerified ? (
                <View style={[s.verifyBadge, { backgroundColor: C.greenDim, borderColor: 'rgba(16,185,129,0.32)' }]}>
                  <Ionicons name="shield-checkmark" size={10} color={C.green} />
                  <Text style={[s.verifyBadgeText, { color: C.green }]}>VERIFIED</Text>
                </View>
              ) : (
                <View style={[s.verifyBadge, { backgroundColor: C.amberDim, borderColor: 'rgba(245,158,11,0.32)' }]}>
                  <Ionicons name="shield-half" size={10} color={C.amber} />
                  <Text style={[s.verifyBadgeText, { color: C.amber }]}>UNVERIFIED</Text>
                </View>
              )}
              {expiry === 'expired' && (
                <View style={[s.verifyBadge, { backgroundColor: C.redDim, borderColor: 'rgba(239,68,68,0.32)' }]}>
                  <Text style={[s.verifyBadgeText, { color: C.red }]}>EXPIRED</Text>
                </View>
              )}
              {expiry === 'soon' && (
                <View style={[s.verifyBadge, { backgroundColor: C.amberDim, borderColor: 'rgba(245,158,11,0.32)' }]}>
                  <Text style={[s.verifyBadgeText, { color: C.amber }]}>EXPIRING</Text>
                </View>
              )}
              {doc.isArchived && (
                <View style={[s.verifyBadge, { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: C.border }]}>
                  <Text style={[s.verifyBadgeText, { color: C.textMute }]}>ARCHIVED</Text>
                </View>
              )}
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Metadata grid */}
        <Animated.View entering={FadeInDown.delay(60).duration(240)} style={s.metaGrid}>
          <MetaTile label="VALID FROM" value={formatDate(doc.validFrom)} />
          <MetaTile label="VALID UNTIL" value={formatDate(doc.validUntil)} />
          <MetaTile label="UPLOADED" value={relativeTime(doc.createdAt)} />
          <MetaTile label="UPDATED" value={relativeTime(doc.updatedAt)} />
        </Animated.View>

        {/* Download */}
        {doc.filePath ? (
          <TouchableOpacity onPress={handleDownload} style={s.downloadBtn} activeOpacity={0.85}>
            <Ionicons name="document-text" size={18} color={C.cyan} />
            <View style={{ flex: 1 }}>
              <Text style={s.downloadLabel}>FILE</Text>
              <Text style={s.downloadTitle}>Open document</Text>
              <Text style={s.downloadSub}>Signed URL, expires in 5 minutes</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={C.cyan} />
          </TouchableOpacity>
        ) : doc.externalUrl ? (
          <TouchableOpacity onPress={() => Linking.openURL(doc.externalUrl!)} style={s.downloadBtn} activeOpacity={0.85}>
            <Ionicons name="link" size={18} color={C.cyan} />
            <Text style={[s.downloadTitle, { flex: 1, marginLeft: 8 }]}>Open external link</Text>
          </TouchableOpacity>
        ) : null}

        {/* Notes */}
        {doc.notes ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>NOTES</Text>
            <Text style={s.sectionBody}>{doc.notes}</Text>
          </View>
        ) : null}

        {/* Linked job */}
        {doc.jobId ? (
          <TouchableOpacity
            onPress={() => router.push(`/(client)/jobs/${doc.jobId}` as any)}
            style={s.linkedJob}
            activeOpacity={0.75}
          >
            <Ionicons name="briefcase" size={16} color={C.primary} />
            <View style={{ flex: 1 }}>
              <Text style={s.linkedJobLabel}>LINKED JOB</Text>
              <Text style={s.linkedJobTitle} numberOfLines={1}>
                {doc.jobTitle ?? doc.jobId.slice(0, 8) + '…'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={C.textMute} />
          </TouchableOpacity>
        ) : null}

        {/* Actions */}
        {(isAdmin || doc.isOwn) && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Actions</Text>
            <Text style={s.sectionHint}>
              {isAdmin && doc.isOwn ? 'You own this AND have admin powers, both action sets available.'
                : isAdmin ? 'Admin powers: verify or revoke.'
                : 'You can archive this document.'}
            </Text>
            <View style={{ marginTop: 14, gap: 10 }}>
              {isAdmin && (
                <TouchableOpacity
                  onPress={handleVerifyToggle}
                  disabled={acting}
                  style={[
                    s.actionBtn,
                    {
                      backgroundColor: doc.isVerified ? 'rgba(255,255,255,0.04)' : C.greenDim,
                      borderColor: doc.isVerified ? C.border : 'rgba(16,185,129,0.32)',
                    },
                    acting && s.btnDisabled,
                  ]}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={doc.isVerified ? 'shield-half' : 'shield-checkmark'}
                    size={16}
                    color={doc.isVerified ? C.textSec : C.green}
                  />
                  <Text style={[s.actionBtnText, { color: doc.isVerified ? C.textSec : C.green }]}>
                    {doc.isVerified ? 'Revoke verification' : 'Verify document'}
                  </Text>
                </TouchableOpacity>
              )}
              {doc.isOwn && (
                <TouchableOpacity
                  onPress={handleArchiveToggle}
                  disabled={acting}
                  style={[
                    s.actionBtn,
                    {
                      backgroundColor: doc.isArchived ? C.primaryDim : 'rgba(255,255,255,0.04)',
                      borderColor: doc.isArchived ? 'rgba(124,58,237,0.32)' : C.border,
                    },
                    acting && s.btnDisabled,
                  ]}
                  activeOpacity={0.85}
                >
                  <Ionicons
                    name={doc.isArchived ? 'archive' : 'archive-outline'}
                    size={16}
                    color={doc.isArchived ? C.primary : C.textSec}
                  />
                  <Text style={[s.actionBtnText, { color: doc.isArchived ? C.primary : C.textSec }]}>
                    {doc.isArchived ? 'Restore document' : 'Archive document'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        <Text style={s.footnote}>
          Source, public.client_documents, client_documents bucket, RLS
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.metaTile}>
      <Text style={s.metaLabel}>{label}</Text>
      <Text style={s.metaValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;
function expiryStatus(iso: string | null): 'none' | 'ok' | 'soon' | 'expired' {
  if (!iso) return 'none';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 'none';
  const now = Date.now();
  if (t < now) return 'expired';
  if (t - now < DAYS_30_MS) return 'soon';
  return 'ok';
}
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13, textAlign: 'center' },
  backBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: C.primaryDim },
  backBtnText: { color: C.primary, fontWeight: '700', fontSize: 13 },

  hero: { padding: 18, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(124,58,237,0.32)' },
  heroKicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  heroLabel: { color: C.text, fontSize: 22, fontWeight: '800', marginTop: 6 },
  heroBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  categoryBadge: { backgroundColor: C.primaryDim, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  categoryBadgeText: { color: C.primary, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  verifyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, borderWidth: 1 },
  verifyBadgeText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5 },

  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaTile: {
    flexBasis: '47.5%', flexGrow: 1, padding: 12, minHeight: 60,
    borderRadius: 14, borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  metaLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  metaValue: { color: C.text, fontSize: 14, fontWeight: '600', marginTop: 4, fontVariant: ['tabular-nums'] },

  downloadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(0,255,255,0.32)', backgroundColor: C.cyanDim,
  },
  downloadLabel: { color: 'rgba(0,255,255,0.85)', fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  downloadTitle: { color: C.text, fontWeight: '700', fontSize: 14, marginTop: 2 },
  downloadSub: { color: C.textMute, fontSize: 10, fontFamily: 'monospace', marginTop: 2 },

  section: {
    padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  sectionLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  sectionBody: { color: C.textSec, fontSize: 13, lineHeight: 19, marginTop: 8 },
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  sectionHint: { color: C.textMute, fontSize: 11, marginTop: 4, lineHeight: 15 },

  linkedJob: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  linkedJobLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  linkedJobTitle: { color: C.text, fontSize: 13, marginTop: 2 },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14, borderWidth: 1,
  },
  actionBtnText: { fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.5 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
