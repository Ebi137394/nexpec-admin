// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/vault/index.tsx — Mobile Evidence Vault (admin list)
//
//  Admin document browser over the REAL public.client_documents schema
//  (verified against migrations 20260518180000/190000): id, owner_id, job_id,
//  kind (enum), label, file_path, external_url, notes, created_at, updated_at.
//  NOTE: the web vault projects category/verify/expiry columns that no migration
//  creates (dormant) — this screen deliberately uses only columns that exist.
//  Admin-gated (role IN admin/super_admin = nx_is_admin); RLS cdocs_admin_all
//  lets the admin see every account's documents. Read-only; tap → /(admin)/vault/[id].
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
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
  id: string;
  kind: DocKind;
  label: string;
  ownerName: string | null;
  jobTitle: string | null;
  hasFile: boolean;
  isLink: boolean;
  updatedAt: string;
}

const KIND_LABEL: Record<DocKind, string> = {
  drawing: 'Drawing', spec_sheet: 'Spec sheet', nda: 'NDA', prior_report: 'Prior report',
  regulatory: 'Regulatory', vendor_doc: 'Vendor doc', photo_evidence: 'Photo evidence', other: 'Other',
};
const KIND_ICON: Record<DocKind, keyof typeof Ionicons.glyphMap> = {
  drawing: 'create-outline', spec_sheet: 'list-outline', nda: 'lock-closed-outline', prior_report: 'document-text-outline',
  regulatory: 'business-outline', vendor_doc: 'cube-outline', photo_evidence: 'image-outline', other: 'folder-outline',
};
const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'regulatory', label: 'Regulatory' },
  { key: 'nda', label: 'NDA' },
  { key: 'drawing', label: 'Drawing' },
  { key: 'spec_sheet', label: 'Spec' },
  { key: 'prior_report', label: 'Reports' },
  { key: 'vendor_doc', label: 'Vendor' },
  { key: 'photo_evidence', label: 'Photo' },
  { key: 'other', label: 'Other' },
];

export default function VaultListScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<DocRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }
      const profRes = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const role = (profRes.data as { role?: string } | null)?.role;
      // God-mode: single platform admin = full access (mirrors nx_is_admin RLS).
      const admin = role === 'admin' || role === 'super_admin';
      setIsAdmin(admin);
      if (!admin) return;

      const { data, error: qErr } = await supabase
        .from('client_documents')
        .select('id, owner_id, job_id, kind, label, file_path, external_url, updated_at')
        .order('updated_at', { ascending: false })
        .limit(300);
      if (qErr) { setError(qErr.message); return; }

      const docRows = (data ?? []) as Array<Record<string, unknown>>;
      const ownerIds = Array.from(new Set(docRows.map((r) => String(r.owner_id ?? '')).filter(Boolean)));
      const jobIds = Array.from(new Set(docRows.map((r) => String(r.job_id ?? '')).filter(Boolean)));
      const nameById = new Map<string, string | null>();
      if (ownerIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ownerIds);
        (profs as Array<{ id: string; full_name: string | null; email: string | null }> | null)?.forEach((p) =>
          nameById.set(p.id, p.full_name || p.email || null));
      }
      const titleByJob = new Map<string, string | null>();
      if (jobIds.length > 0) {
        const { data: jobs } = await supabase.from('jobs').select('id, title').in('id', jobIds);
        (jobs as Array<{ id: string; title: string | null }> | null)?.forEach((j) => titleByJob.set(j.id, j.title));
      }

      setRows(docRows.map((r) => ({
        id: String(r.id),
        kind: (KIND_LABEL[r.kind as DocKind] ? (r.kind as DocKind) : 'other'),
        label: String(r.label ?? '(untitled)'),
        ownerName: nameById.get(String(r.owner_id ?? '')) ?? null,
        jobTitle: r.job_id ? (titleByJob.get(String(r.job_id)) ?? null) : null,
        hasFile: Boolean(r.file_path),
        isLink: !r.file_path && Boolean(r.external_url),
        updatedAt: String(r.updated_at ?? ''),
      })));
    } catch (e: unknown) {
      console.warn('[vault] load threw:', e);
      setError((e as Error)?.message ?? 'Could not load the vault.');
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
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>Loading vault…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Evidence vault</Text>
        <View style={{ width: 22 }} />
      </View>

      {!isAdmin ? (
        <View style={s.center}><View style={s.reservedCard}><Ionicons name="lock-closed-outline" size={20} color={C.amber} /><Text style={s.reservedTitle}>Reserved access</Text><Text style={s.reservedBody}>The evidence vault is reserved for the platform owner (admin).</Text></View></View>
      ) : (
        <ScrollView
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
        >
          <Animated.View entering={FadeIn.duration(220)} style={s.heroWrap}>
            <Text style={s.kicker}>PLATFORM, EVIDENCE VAULT</Text>
            <Text style={s.title}>Documents</Text>
            <Text style={s.subtitle}>
              Every compliance document uploaded across the platform, drawings,
              specs, NDAs, regulatory and vendor evidence. Tap to open the file.
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
              <Text style={s.emptyText}>{filter === 'all' ? 'No documents in the vault yet.' : `No ${KIND_LABEL[filter as DocKind]} documents.`}</Text>
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              {visible.map((d) => <VaultCard key={d.id} d={d} />)}
            </View>
          )}

          <Text style={s.footnote}>Source, public.client_documents, RLS cdocs_admin_all (admin sees all).</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────
function VaultCard({ d }: { d: DocRow }) {
  return (
    <TouchableOpacity onPress={() => router.push(`/(admin)/vault/${d.id}` as any)} style={s.docCard} activeOpacity={0.75}>
      <LinearGradient colors={[C.primaryDim, 'rgba(0,0,0,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.docCardGradient} />
      <View style={s.docIcon}><Ionicons name={KIND_ICON[d.kind]} size={18} color={C.primary} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.docLabel} numberOfLines={1}>{d.label}</Text>
        <View style={s.docMeta}>
          <Text style={s.docKind}>{KIND_LABEL[d.kind].toUpperCase()}</Text>
          {d.ownerName && <><Text style={s.dot}>·</Text><Text style={s.docMetaText} numberOfLines={1}>{d.ownerName}</Text></>}
        </View>
        {d.jobTitle ? (
          <View style={s.docMeta}><Ionicons name="briefcase-outline" size={10} color={C.textMute} /><Text style={s.docMetaText} numberOfLines={1}>{d.jobTitle}</Text></View>
        ) : null}
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
    <View style={s.statTile}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, { color: tone ?? C.text }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
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

  reservedCard: { alignItems: 'center', gap: 8, padding: 24, maxWidth: 320, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', backgroundColor: 'rgba(245,158,11,0.14)' },
  reservedTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
