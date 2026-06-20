// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/disputes.tsx — Client disputes surface
//
//  Lists every dispute the client has filed + their resolution status, and
//  provides a "File a new dispute" bottom-sheet that calls the
//  file_dispute SECURITY DEFINER RPC. Mirrors the web client disputes page
//  feature-for-feature.
//
//  RPC contract:
//    file_dispute(p_job_id uuid, p_category text, p_body text) → uuid
//    Atomically: inserts dispute row, sets jobs.escrow_paused=true,
//    notifies every admin. All-or-nothing in a single transaction.
//
//  Filing eligibility — the RPC enforces: caller must be a party to the
//  job (client_id or contractor_id) AND job.status must be active.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// ─────────────────────────────────────────────────────────────────────────────
//  Theme
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#020420',
  bgElev: '#070A24',
  card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF',
  textSec: '#A8B2C7',
  textMuted: '#6B7390',
  textDim: '#475569',
  primary: '#7C3AED',
  primaryBright: '#9333EA',
  primaryDim: 'rgba(124, 58, 237, 0.14)',
  primaryBorder: 'rgba(124, 58, 237, 0.32)',
  amber: '#F59E0B',
  amberDim: 'rgba(245,158,11,0.14)',
  amberBorder: 'rgba(245,158,11,0.32)',
  danger: '#EF4444',
  dangerDim: 'rgba(239,68,68,0.14)',
  ok: '#10F995',
  okDim: 'rgba(16,249,149,0.12)',
};

const CATEGORIES = [
  { value: 'scope', label: 'Scope disagreement' },
  { value: 'quality', label: 'Quality concern' },
  { value: 'payment', label: 'Payment issue' },
  { value: 'communication', label: 'Communication breakdown' },
  { value: 'other', label: 'Other' },
] as const;

type DisputeStatus =
  | 'open'
  | 'investigating'
  | 'resolved'
  | 'rejected'
  | 'closed';

const STATUS_META: Record<DisputeStatus, { label: string; tone: string; toneDim: string }> = {
  open: { label: 'Open', tone: C.amber, toneDim: C.amberDim },
  investigating: { label: 'Investigating', tone: C.primary, toneDim: C.primaryDim },
  resolved: { label: 'Resolved', tone: C.ok, toneDim: C.okDim },
  rejected: { label: 'Rejected', tone: C.danger, toneDim: C.dangerDim },
  closed: { label: 'Closed', tone: C.textMuted, toneDim: 'rgba(107,115,144,0.14)' },
};

interface DisputeRow {
  id: string;
  job_id: string;
  job_title: string | null;
  category: string;
  body: string;
  status: DisputeStatus;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface EligibleJob {
  id: string;
  title: string | null;
  status: string;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function ClientDisputesScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [items, setItems] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filing, setFiling] = useState(false);

  // File-new modal state
  const [filerOpen, setFilerOpen] = useState(false);
  const [eligibleJobs, setEligibleJobs] = useState<EligibleJob[]>([]);
  const [eligibleLoading, setEligibleLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('scope');
  const [body, setBody] = useState('');

  // ── Fetch disputes filed by this client ─────────────────────────────────
  const fetchDisputes = useCallback(async () => {
    if (!user?.id) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('disputes')
        .select('id, job_id, category, body, status, resolution, created_at, resolved_at')
        .eq('filed_by', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []) as Omit<DisputeRow, 'job_title'>[];

      // Hydrate job titles in one batch
      const jobIds = Array.from(new Set(rows.map((r) => r.job_id)));
      const titles = new Map<string, string | null>();
      if (jobIds.length > 0) {
        const { data: jobRows } = await supabase
          .from('jobs')
          .select('id, title')
          .in('id', jobIds);
        (jobRows as Array<{ id: string; title: string | null }> | null)?.forEach((j) => {
          titles.set(j.id, j.title);
        });
      }
      setItems(
        rows.map((r) => ({ ...r, job_title: titles.get(r.job_id) ?? null })),
      );
    } catch (err) {
      console.warn('[client-disputes] fetch error:', (err as Error)?.message);
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void fetchDisputes();
  }, [fetchDisputes]);

  // ── Open the file-new sheet — load this client's active jobs ────────────
  const openFiler = useCallback(async () => {
    if (!user?.id) return;
    setFilerOpen(true);
    setSelectedJobId(null);
    setCategory('scope');
    setBody('');
    setEligibleLoading(true);
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('id, title, status')
        .eq('client_id', user.id)
        .in('status', ['assigned', 'in_progress', 'completed'])
        .order('updated_at', { ascending: false })
        .limit(30);
      if (error) throw error;
      setEligibleJobs((data ?? []) as EligibleJob[]);
    } catch (err) {
      console.warn('[client-disputes] jobs fetch error:', (err as Error)?.message);
      setEligibleJobs([]);
    } finally {
      setEligibleLoading(false);
    }
  }, [user?.id]);

  // ── Submit file_dispute RPC ─────────────────────────────────────────────
  const handleFile = useCallback(async () => {
    if (!selectedJobId) {
      Alert.alert('Pick a job', 'Select a job before filing a dispute.');
      return;
    }
    if (body.trim().length < 20) {
      Alert.alert('Describe the issue', 'Please use at least 20 characters so admin understands the situation.');
      return;
    }
    setFiling(true);
    try {
      const { error } = await supabase.rpc('file_dispute', {
        p_job_id: selectedJobId,
        p_category: category,
        p_body: body.trim(),
      });
      if (error) throw error;
      Alert.alert(
        'Dispute filed',
        'Funds on this job are now paused and admin has been notified. You\'ll get a notification when there\'s a resolution.',
      );
      setFilerOpen(false);
      await fetchDisputes();
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('already')) {
        Alert.alert('Already filed', 'A dispute on this job is already on file.');
      } else if (msg.includes('not a party') || msg.includes('only parties')) {
        Alert.alert('Not allowed', 'You can only file a dispute on jobs you own.');
      } else {
        Alert.alert('Could not file dispute', msg || 'Please try again in a moment.');
      }
    } finally {
      setFiling(false);
    }
  }, [selectedJobId, category, body, fetchDisputes]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const counts = useMemo(
    () => ({
      open: items.filter((i) => i.status === 'open' || i.status === 'investigating').length,
      resolved: items.filter((i) => i.status === 'resolved').length,
      other: items.filter((i) => i.status === 'rejected' || i.status === 'closed').length,
    }),
    [items],
  );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glow} />
      <SafeAreaView style={s.safeArea} edges={['top']}>
        <Header onBack={() => router.back()} onFileNew={openFiler} />

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void fetchDisputes();
              }}
              tintColor={C.primary}
              colors={[C.primary]}
            />
          }
        >
          {/* Stat strip */}
          <View style={s.statStrip}>
            <Stat label="Open" value={String(counts.open)} tone={C.amber} />
            <View style={s.statDiv} />
            <Stat label="Resolved" value={String(counts.resolved)} tone={C.ok} />
            <View style={s.statDiv} />
            <Stat label="Closed" value={String(counts.other)} tone={C.textMuted} />
          </View>

          {/* List */}
          {loading ? (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color={C.primary} />
              <Text style={s.loadingText}>LOADING DISPUTES…</Text>
            </View>
          ) : items.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="shield-checkmark" size={22} color={C.primary} />
              </View>
              <Text style={s.emptyTitle}>No disputes, clean record</Text>
              <Text style={s.emptySub}>
                When something goes wrong on a job, file a dispute here. Admin
                pauses the funds and mediates between you and the inspector.
              </Text>
              <Pressable
                onPress={openFiler}
                style={({ pressed }) => [
                  s.emptyCta,
                  pressed && { transform: [{ scale: 0.97 }] },
                ]}
              >
                <Ionicons name="alert-circle" size={14} color="#FFF" />
                <Text style={s.emptyCtaText}>File a dispute</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ gap: 10, marginTop: 12 }}>
              {items.map((item, i) => (
                <DisputeCard key={item.id} item={item} delay={Math.min(i, 6) * 60} />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <FileDisputeSheet
        visible={filerOpen}
        eligibleJobs={eligibleJobs}
        eligibleLoading={eligibleLoading}
        selectedJobId={selectedJobId}
        onSelectJob={setSelectedJobId}
        category={category}
        onChangeCategory={setCategory}
        body={body}
        onChangeBody={setBody}
        submitting={filing}
        onClose={() => setFilerOpen(false)}
        onSubmit={handleFile}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Header({ onBack, onFileNew }: { onBack: () => void; onFileNew: () => void }) {
  return (
    <View style={s.header}>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [s.iconBtn, pressed && { transform: [{ scale: 0.92 }] }]}
        hitSlop={10}
      >
        <Ionicons name="arrow-back" size={18} color={C.text} />
      </Pressable>
      <View style={s.headerCenter}>
        <Text style={s.kicker}>CLIENT PORTAL</Text>
        <Text style={s.headerTitle}>Disputes</Text>
      </View>
      <Pressable
        onPress={onFileNew}
        style={({ pressed }) => [s.filePill, pressed && { transform: [{ scale: 0.95 }] }]}
      >
        <Ionicons name="add" size={14} color="#FFF" />
        <Text style={s.filePillText}>File</Text>
      </Pressable>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[s.statValue, { color: tone }]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function DisputeCard({ item, delay }: { item: DisputeRow; delay: number }) {
  const meta = STATUS_META[item.status] ?? STATUS_META.open;
  const cat = CATEGORIES.find((c) => c.value === item.category)?.label ?? item.category;
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(300)}>
      <View style={s.card}>
        <View style={s.cardTopRow}>
          <Text style={s.cardJobTitle} numberOfLines={1}>
            {item.job_title ?? 'Untitled job'}
          </Text>
          <View
            style={[
              s.statusPill,
              { backgroundColor: meta.toneDim, borderColor: meta.tone + '55' },
            ]}
          >
            <Text style={[s.statusPillText, { color: meta.tone }]}>{meta.label}</Text>
          </View>
        </View>
        <View style={s.catRow}>
          <Ionicons name="pricetag" size={10} color={C.textMuted} />
          <Text style={s.catText}>{cat}</Text>
          <Text style={s.timeText}>{new Date(item.created_at).toLocaleDateString()}</Text>
        </View>
        <Text style={s.bodyText} numberOfLines={4}>
          {item.body}
        </Text>
        {item.resolution ? (
          <View style={s.resolutionBox}>
            <Text style={s.resolutionLabel}>RESOLUTION</Text>
            <Text style={s.resolutionText}>{item.resolution}</Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

function FileDisputeSheet(props: {
  visible: boolean;
  eligibleJobs: EligibleJob[];
  eligibleLoading: boolean;
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  category: string;
  onChangeCategory: (c: string) => void;
  body: string;
  onChangeBody: (b: string) => void;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal visible={props.visible} animationType="slide" transparent onRequestClose={props.onClose}>
      <View style={s.sheetBackdrop}>
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <View style={s.sheetIconWrap}>
              <Ionicons name="alert-circle" size={18} color={C.amber} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sheetKicker}>FILE A DISPUTE</Text>
              <Text style={s.sheetTitle}>Pause funds + alert admin</Text>
            </View>
            <Pressable onPress={props.onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={C.textSec} />
            </Pressable>
          </View>

          <Text style={s.sheetExplain}>
            Filing freezes payouts on this job and brings admin in as
            mediator. Be specific, admin needs context to resolve fairly.
          </Text>

          <Text style={s.sheetLabel}>JOB</Text>
          {props.eligibleLoading ? (
            <View style={{ paddingVertical: 14, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={C.primary} />
            </View>
          ) : props.eligibleJobs.length === 0 ? (
            <Text style={s.sheetEmptyText}>
              You don't have any active jobs that can be disputed right now.
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 140 }} showsVerticalScrollIndicator={false}>
              <View style={{ gap: 6 }}>
                {props.eligibleJobs.map((j) => {
                  const sel = props.selectedJobId === j.id;
                  return (
                    <Pressable
                      key={j.id}
                      onPress={() => props.onSelectJob(j.id)}
                      style={[
                        s.jobOpt,
                        sel
                          ? { borderColor: C.primaryBorder, backgroundColor: C.primaryDim }
                          : { borderColor: C.border },
                      ]}
                    >
                      <View
                        style={[
                          s.radio,
                          {
                            borderColor: sel ? C.primary : C.border,
                            backgroundColor: sel ? C.primary : 'transparent',
                          },
                        ]}
                      >
                        {sel ? <Ionicons name="checkmark" size={11} color="#FFF" /> : null}
                      </View>
                      <Text style={s.jobOptTitle} numberOfLines={1}>
                        {j.title ?? 'Untitled job'}
                      </Text>
                      <Text style={s.jobOptStatus}>{j.status}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}

          <Text style={[s.sheetLabel, { marginTop: 12 }]}>CATEGORY</Text>
          <View style={s.catGrid}>
            {CATEGORIES.map((c) => {
              const sel = props.category === c.value;
              return (
                <Pressable
                  key={c.value}
                  onPress={() => props.onChangeCategory(c.value)}
                  style={[
                    s.catChip,
                    sel
                      ? { borderColor: C.amberBorder, backgroundColor: C.amberDim }
                      : { borderColor: C.border },
                  ]}
                >
                  <Text
                    style={[
                      s.catChipText,
                      { color: sel ? C.amber : C.textSec },
                    ]}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[s.sheetLabel, { marginTop: 12 }]}>DETAILS</Text>
          <TextInput
            value={props.body}
            onChangeText={props.onChangeBody}
            placeholder="What went wrong? Be specific, dates, expectations, evidence references…"
            placeholderTextColor={C.textDim}
            multiline
            maxLength={8000}
            editable={!props.submitting}
            style={s.bodyInput}
          />
          <Text style={s.bodyCounter}>{props.body.length} / 8000</Text>

          <Pressable
            onPress={props.onSubmit}
            disabled={props.submitting || !props.selectedJobId}
            style={({ pressed }) => [
              s.submitBtn,
              (props.submitting || !props.selectedJobId) && { opacity: 0.5 },
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
          >
            {props.submitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="alert-circle" size={14} color="#FFF" />
            )}
            <Text style={s.submitBtnText}>
              {props.submitting ? 'Filing…' : 'File dispute, pause funds'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safeArea: { flex: 1 },
  glow: {
    position: 'absolute',
    top: -160,
    left: -100,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: C.amber,
    opacity: 0.05,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: C.bgElev,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  kicker: { color: C.amber, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 1 },
  filePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  filePillText: { color: '#FFF', fontSize: 12, fontWeight: '800' },

  statStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 6,
    gap: 16,
  },
  statValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: {
    color: C.textMuted,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 1,
  },
  statDiv: { width: 1, height: 28, backgroundColor: C.border },

  loadingWrap: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  loadingText: { color: C.textMuted, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4 },

  empty: {
    marginTop: 20,
    padding: 28,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    backgroundColor: C.card,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: C.primaryDim,
    borderWidth: 1,
    borderColor: C.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  emptySub: {
    color: C.textMuted,
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 11,
  },
  emptyCtaText: { color: '#FFF', fontSize: 12, fontWeight: '800', letterSpacing: 0.4 },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 10,
  },
  cardJobTitle: { color: C.text, fontSize: 14, fontWeight: '800', flex: 1 },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
  },
  statusPillText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },

  catRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  catText: { color: C.textSec, fontSize: 11, fontWeight: '600' },
  dotSep: { color: C.textDim, fontSize: 11 },
  timeText: { color: C.textMuted, fontSize: 10.5 },

  bodyText: { color: C.textSec, fontSize: 12.5, lineHeight: 18 },

  resolutionBox: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.okDim,
    borderWidth: 1,
    borderColor: 'rgba(16,249,149,0.30)',
  },
  resolutionLabel: { color: C.ok, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  resolutionText: { color: C.text, fontSize: 12, lineHeight: 16, marginTop: 4 },

  // Sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(2, 4, 32, 0.92)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: C.amberBorder,
    padding: 20,
    paddingBottom: 32,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.20)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  sheetIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: C.amberDim,
    borderWidth: 1,
    borderColor: C.amberBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetKicker: { color: C.amber, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  sheetTitle: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 1 },
  sheetExplain: {
    color: C.textMuted,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  sheetLabel: { color: C.amber, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  sheetEmptyText: { color: C.textMuted, fontSize: 11.5, fontStyle: 'italic', padding: 12 },

  jobOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobOptTitle: { flex: 1, color: C.text, fontSize: 12, fontWeight: '700' },
  jobOptStatus: {
    color: C.textMuted,
    fontSize: 9.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  catChipText: { fontSize: 11, fontWeight: '700' },

  bodyInput: {
    backgroundColor: C.bgElev,
    color: C.text,
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  bodyCounter: {
    color: C.textMuted,
    fontSize: 10,
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 14,
  },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.amber,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: C.amber,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  submitBtnText: { color: '#1F1300', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
});
