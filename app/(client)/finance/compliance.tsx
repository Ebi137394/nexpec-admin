// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/finance/compliance.tsx — Mobile Compliance Vault (list)
//
//  Two-tab UI: My Documents (uploadable later) + Inspection Certificates
//  (read-only). Reads public.client_documents and public.trust_certificates
//  via RLS — same data as the web /client/vault page.
//
//  Mobile-side document upload uses the native file picker. For Round 3
//  we ship the LIST + DETAIL + ARCHIVE/RESTORE actions; uploads on
//  mobile route the user to the web app via deep-link banner (cleaner
//  than implementing expo-document-picker + Stripe-style storage tokens
//  in the same round). Note: this matches the established platform
//  pattern — heavy authoring on web, consumption on mobile.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView, Linking,
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
  cyan: '#00FFFF', cyanDim: 'rgba(0,255,255,0.12)',
  green: '#10B981', greenDim: 'rgba(16,185,129,0.14)',
  amber: '#F59E0B', amberDim: 'rgba(245,158,11,0.14)',
  red: '#EF4444', redDim: 'rgba(239,68,68,0.14)',
};

type Category = 'insurance' | 'license' | 'nda' | 'msa' | 'regulatory' | 'audit' | 'other';
type Tab = 'documents' | 'certificates';

const CATEGORY_LABEL: Record<Category, string> = {
  insurance: 'Insurance', license: 'License', nda: 'NDA', msa: 'MSA',
  regulatory: 'Regulatory', audit: 'Audit', other: 'Other',
};

interface VaultDoc {
  id: string;
  ownerId: string;
  label: string;
  category: Category;
  validUntil: string | null;
  isVerified: boolean;
  isArchived: boolean;
  updatedAt: string;
}

interface TrustCert {
  id: string;
  publicSlug: string;
  supplierName: string | null;
  scopeTemplateName: string | null;
  validUntil: string;
  revokedAt: string | null;
}

interface Counts {
  total: number; verified: number; unverified: number;
  expiringSoon: number; expired: number;
  byCategory: Array<{ category: Category; count: number }>;
}

const EMPTY_COUNTS: Counts = {
  total: 0, verified: 0, unverified: 0, expiringSoon: 0, expired: 0, byCategory: [],
};

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;

export default function ComplianceVaultScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('documents');
  const [category, setCategory] = useState<Category | null>(null);
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [certs, setCerts] = useState<TrustCert[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }

      // Documents
      let dq = supabase
        .from('client_documents')
        .select('id, owner_id, label, category, valid_until, is_verified, is_archived, updated_at')
        .eq('is_archived', false)
        .order('updated_at', { ascending: false })
        .limit(100);
      if (category) dq = dq.eq('category', category);
      const { data: docData, error: docErr } = await dq;
      if (docErr) { setError(docErr.message); return; }
      setDocs(((docData ?? []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        ownerId: String(r.owner_id ?? ''),
        label: String(r.label ?? 'Untitled'),
        category: ((r.category as string) ?? 'other') as Category,
        validUntil: (r.valid_until as string | null) ?? null,
        isVerified: Boolean(r.is_verified),
        isArchived: Boolean(r.is_archived),
        updatedAt: String(r.updated_at ?? ''),
      })));

      // Counts (separate, all rows)
      const { data: allDocs } = await supabase
        .from('client_documents')
        .select('category, is_verified, valid_until, is_archived')
        .eq('is_archived', false);
      const c: Counts = { ...EMPTY_COUNTS, byCategory: [] };
      const catMap = new Map<Category, number>();
      const now = Date.now();
      (allDocs as Array<{ category: string; is_verified: boolean; valid_until: string | null }> | null)?.forEach((r) => {
        c.total += 1;
        if (r.is_verified) c.verified += 1; else c.unverified += 1;
        if (r.valid_until) {
          const t = new Date(r.valid_until).getTime();
          if (Number.isFinite(t)) {
            if (t < now) c.expired += 1;
            else if (t - now < DAYS_30_MS) c.expiringSoon += 1;
          }
        }
        const cat = (r.category ?? 'other') as Category;
        catMap.set(cat, (catMap.get(cat) ?? 0) + 1);
      });
      c.byCategory = Array.from(catMap.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
      setCounts(c);

      // Certs (only when on tab)
      if (tab === 'certificates') {
        const { data: certData } = await supabase
          .from('trust_certificates')
          .select('id, public_slug, supplier_profile_id, scope_template_id, valid_until, revoked_at')
          .order('valid_until', { ascending: false })
          .limit(50);
        const cRows = (certData ?? []) as Array<Record<string, unknown>>;
        const supplierIds = Array.from(new Set(cRows.map((r) => r.supplier_profile_id as string).filter(Boolean)));
        const templateIds = Array.from(new Set(cRows.map((r) => r.scope_template_id as string).filter(Boolean)));
        const nameById = new Map<string, string>();
        const tplById = new Map<string, string>();
        if (supplierIds.length > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, full_name, company_name, email')
            .in('id', supplierIds);
          (profs as Array<{ id: string; full_name: string | null; company_name: string | null; email: string | null }> | null)?.forEach(
            (p) => nameById.set(p.id, p.company_name ?? p.full_name ?? p.email ?? 'Supplier'),
          );
        }
        if (templateIds.length > 0) {
          const { data: tpl } = await supabase
            .from('inspection_scope_templates')
            .select('id, name')
            .in('id', templateIds);
          (tpl as Array<{ id: string; name: string }> | null)?.forEach((t) => tplById.set(t.id, t.name));
        }
        setCerts(cRows.map((r) => ({
          id: String(r.id),
          publicSlug: String(r.public_slug ?? ''),
          supplierName: nameById.get(String(r.supplier_profile_id ?? '')) ?? null,
          scopeTemplateName: tplById.get(String(r.scope_template_id ?? '')) ?? null,
          validUntil: String(r.valid_until ?? ''),
          revokedAt: (r.revoked_at as string | null) ?? null,
        })));
      }
    } catch (e) {
      console.warn('[vault] load threw:', e);
      setError('Could not load vault.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [category, tab]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={s.centerText}>Loading vault…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <ScrollView
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
      >
        <Animated.View entering={FadeIn.duration(220)} style={s.header}>
          <Text style={s.kicker}>CLIENT PORTAL, COMPLIANCE</Text>
          <Text style={s.title}>Compliance Vault</Text>
          <Text style={s.subtitle}>
            Corporate compliance documents (insurance, licenses, NDAs, MSAs)
            and trust certificates from your completed inspections.
          </Text>
        </Animated.View>

        {error ? (
          <View style={s.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={C.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        ) : null}

        {/* Tabs */}
        <View style={s.tabRow}>
          <TouchableOpacity
            onPress={() => setTab('documents')}
            style={[s.tab, tab === 'documents' && s.tabActive]}
          >
            <Text style={[s.tabText, tab === 'documents' && s.tabTextActive]}>
              My Documents, {counts.total}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setTab('certificates')}
            style={[s.tab, tab === 'certificates' && s.tabActive]}
          >
            <Text style={[s.tabText, tab === 'certificates' && s.tabTextActive]}>
              Certificates
            </Text>
          </TouchableOpacity>
        </View>

        {tab === 'documents' ? (
          <>
            {/* Stats grid */}
            <Animated.View entering={FadeInDown.delay(60).duration(240)} style={s.statsGrid}>
              <StatTile label="VERIFIED" value={String(counts.verified)} tone="green" />
              <StatTile label="UNVERIFIED" value={String(counts.unverified)} tone={counts.unverified > 0 ? 'amber' : 'default'} />
              <StatTile label="EXPIRING" value={String(counts.expiringSoon)} tone={counts.expiringSoon > 0 ? 'amber' : 'default'} />
              <StatTile label="EXPIRED" value={String(counts.expired)} tone={counts.expired > 0 ? 'red' : 'default'} />
            </Animated.View>

            {/* Upload note */}
            <View style={s.uploadNote}>
              <Ionicons name="information-circle" size={16} color={C.cyan} />
              <Text style={s.uploadNoteText}>
                Upload new documents from the{' '}
                <Text style={s.uploadNoteLink} onPress={() => Linking.openURL('https://nexpecapp.com/client/vault')}>
                  web app
                </Text>
                . Mobile supports viewing, verification (admin), and archiving.
              </Text>
            </View>

            {/* Category chips */}
            {counts.byCategory.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
                <TouchableOpacity
                  onPress={() => setCategory(null)}
                  style={[s.chip, !category && s.chipActive]}
                >
                  <Text style={[s.chipText, !category && s.chipTextActive]}>All, {counts.total}</Text>
                </TouchableOpacity>
                {counts.byCategory.map((c) => {
                  const active = category === c.category;
                  return (
                    <TouchableOpacity
                      key={c.category}
                      onPress={() => setCategory(c.category)}
                      style={[s.chip, active && s.chipActive]}
                    >
                      <Text style={[s.chipText, active && s.chipTextActive]}>
                        {CATEGORY_LABEL[c.category]}, {c.count}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            {/* List */}
            {docs.length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name="folder-open-outline" size={32} color={C.textMute} />
                <Text style={s.emptyText}>
                  No documents yet. Upload your insurance certs, licenses, NDAs from
                  the web app.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {docs.map((d) => <DocCard key={d.id} doc={d} />)}
              </View>
            )}
          </>
        ) : (
          <>
            {certs.length === 0 ? (
              <View style={s.emptyState}>
                <Ionicons name="ribbon-outline" size={32} color={C.textMute} />
                <Text style={s.emptyText}>
                  No trust certificates yet. Each completed compliance inspection
                  generates a publicly-verifiable certificate.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 10 }}>
                {certs.map((c) => <CertCard key={c.id} cert={c} />)}
              </View>
            )}
          </>
        )}

        <Text style={s.footnote}>
          Source, public.client_documents, public.trust_certificates, RLS owner+admin
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function DocCard({ doc }: { doc: VaultDoc }) {
  const expiry = expiryStatus(doc.validUntil);
  return (
    <TouchableOpacity
      onPress={() => router.push(`/(client)/finance/compliance/${doc.id}` as any)}
      style={s.docCard}
      activeOpacity={0.75}
    >
      <LinearGradient
        colors={[C.primaryDim, 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={s.docCardGradient}
      />
      <View style={s.docIcon}>
        <Ionicons name="document-text" size={18} color={C.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={s.docTopRow}>
          <View style={s.categoryBadge}>
            <Text style={s.categoryBadgeText}>{CATEGORY_LABEL[doc.category].toUpperCase()}</Text>
          </View>
          {doc.isVerified ? (
            <View style={[s.verifyBadge, { backgroundColor: C.greenDim, borderColor: 'rgba(16,185,129,0.32)' }]}>
              <Ionicons name="shield-checkmark" size={9} color={C.green} />
              <Text style={[s.verifyBadgeText, { color: C.green }]}>VERIFIED</Text>
            </View>
          ) : (
            <View style={[s.verifyBadge, { backgroundColor: C.amberDim, borderColor: 'rgba(245,158,11,0.32)' }]}>
              <Ionicons name="shield-half" size={9} color={C.amber} />
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
        </View>
        <Text style={s.docLabel} numberOfLines={2}>{doc.label}</Text>
        <View style={s.docMeta}>
          {doc.validUntil ? (
            <>
              <Ionicons name="calendar-outline" size={10} color={C.textMute} />
              <Text style={s.docMetaText}>Valid through {formatDate(doc.validUntil)}</Text>
            </>
          ) : null}
          <Text style={s.docMetaText}>Updated {relativeTime(doc.updatedAt)}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={14} color={C.textMute} />
    </TouchableOpacity>
  );
}

function CertCard({ cert }: { cert: TrustCert }) {
  const expired = new Date(cert.validUntil).getTime() < Date.now();
  const revoked = !!cert.revokedAt;
  return (
    <View style={s.certCard}>
      <LinearGradient
        colors={[C.cyanDim, 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={s.docCardGradient}
      />
      <View style={[s.docIcon, { backgroundColor: C.cyanDim }]}>
        <Ionicons name="ribbon" size={18} color={C.cyan} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.docLabel} numberOfLines={2}>
          {cert.scopeTemplateName ?? 'Trust certificate'}
        </Text>
        <Text style={s.docMetaText}>
          Issued for {cert.supplierName ?? 'a supplier'}, valid through {formatDate(cert.validUntil)}
        </Text>
        <View style={[s.docMeta, { marginTop: 6 }]}>
          {revoked ? (
            <View style={[s.verifyBadge, { backgroundColor: C.redDim, borderColor: 'rgba(239,68,68,0.32)' }]}>
              <Text style={[s.verifyBadgeText, { color: C.red }]}>REVOKED</Text>
            </View>
          ) : expired ? (
            <View style={[s.verifyBadge, { backgroundColor: 'rgba(255,255,255,0.04)', borderColor: C.border }]}>
              <Text style={[s.verifyBadgeText, { color: C.textMute }]}>EXPIRED</Text>
            </View>
          ) : (
            <View style={[s.verifyBadge, { backgroundColor: C.greenDim, borderColor: 'rgba(16,185,129,0.32)' }]}>
              <Ionicons name="shield-checkmark" size={9} color={C.green} />
              <Text style={[s.verifyBadgeText, { color: C.green }]}>ACTIVE</Text>
            </View>
          )}
        </View>
      </View>
      {cert.publicSlug ? (
        <TouchableOpacity
          onPress={() => Linking.openURL(`https://nexpecapp.com/verify/${cert.publicSlug}`)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="open-outline" size={16} color={C.cyan} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: 'default' | 'green' | 'amber' | 'red' }) {
  const fg = tone === 'green' ? C.green : tone === 'amber' ? C.amber : tone === 'red' ? C.red : C.text;
  return (
    <View style={s.statTile}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────
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
  centerText: { color: C.textSec, fontSize: 13 },

  header: { gap: 6 },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 28, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.redDim, borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1,
    padding: 12, borderRadius: 12,
  },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  tabRow: { flexDirection: 'row', gap: 8, padding: 4, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  tab: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, alignItems: 'center' },
  tabActive: { backgroundColor: C.primaryDim },
  tabText: { color: C.textSec, fontSize: 12, fontWeight: '600' },
  tabTextActive: { color: C.primary, fontWeight: '700' },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statTile: {
    flexBasis: '23%', flexGrow: 1, padding: 12, minHeight: 64,
    borderRadius: 14, borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  statLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  statValue: { fontSize: 18, fontWeight: '700', marginTop: 5, fontVariant: ['tabular-nums'] },

  uploadNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.cyanDim, borderColor: 'rgba(0,255,255,0.32)', borderWidth: 1,
    padding: 12, borderRadius: 12,
  },
  uploadNoteText: { color: C.textSec, fontSize: 12, lineHeight: 17, flex: 1 },
  uploadNoteLink: { color: C.cyan, fontWeight: '700' },

  chipRow: { gap: 8, paddingHorizontal: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.02)' },
  chipActive: { borderColor: 'rgba(124,58,237,0.45)', backgroundColor: C.primaryDim },
  chipText: { color: C.textSec, fontSize: 11, fontWeight: '600' },
  chipTextActive: { color: C.primary, fontWeight: '700' },

  emptyState: {
    alignItems: 'center', padding: 32, gap: 10,
    borderRadius: 18, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  emptyText: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18, maxWidth: 280 },

  docCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.card, overflow: 'hidden',
  },
  certCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.card, overflow: 'hidden',
  },
  docCardGradient: { position: 'absolute', top: 0, left: 0, right: 0, height: 60 },
  docIcon: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: C.primaryDim, justifyContent: 'center', alignItems: 'center',
  },
  docTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  categoryBadge: { backgroundColor: C.primaryDim, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  categoryBadgeText: { color: C.primary, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5 },
  verifyBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, borderWidth: 1,
  },
  verifyBadgeText: { fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  docLabel: { color: C.text, fontWeight: '600', fontSize: 14, marginTop: 4 },
  docMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  docMetaText: { color: C.textMute, fontSize: 10 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 8 },
});
