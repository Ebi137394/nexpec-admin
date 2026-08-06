// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/disputes.tsx — Admin dispute resolution board (Mobile)
//
//  Mirrors the web /admin/disputes board. Lists every job currently in
//  status='disputed' with its frozen escrow, the originating dispute,
//  and the resolution drawer that calls admin_resolve_dispute(uuid, text, text).
//
//  Routing model:
//    /(admin)/disputes — board listing
//    Tap row → resolution sheet with 3-option picker:
//      - completed:  resolve in client's favour, release escrow
//      - cancelled:  resolve in inspector's favour, refund escrow
//      - in_progress: send back to mediation, keep escrow frozen
//
//  RPC contract:
//    admin_resolve_dispute(p_job_id uuid, p_resolution text, p_reason text)
//    Returns jsonb. p_resolution ∈ {completed, cancelled, in_progress}.
//    p_reason is required (audit annotation). FOR UPDATE lock prevents
//    concurrent resolutions.
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
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, Easing } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';
import { ADMIN_JOB_FIELDS } from '@/lib/jobsProjection';

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
  primaryDim: 'rgba(124, 58, 237, 0.14)',
  amber: '#F59E0B',
  amberDim: 'rgba(245,158,11,0.14)',
  amberBorder: 'rgba(245,158,11,0.32)',
  danger: '#EF4444',
  dangerDim: 'rgba(239,68,68,0.14)',
  dangerBorder: 'rgba(239,68,68,0.40)',
  ok: '#10F995',
  okDim: 'rgba(16,249,149,0.12)',
  okBorder: 'rgba(16,249,149,0.32)',
  info: '#3B82F6',
  infoDim: 'rgba(59,130,246,0.14)',
  infoBorder: 'rgba(59,130,246,0.32)',
};

const RESOLUTIONS = [
  {
    value: 'completed',
    label: "Client's favour, release funds",
    description: 'Job is marked complete and the inspector is paid out. Use when work was delivered as agreed.',
    icon: 'checkmark-circle',
    tone: C.ok,
    toneDim: C.okDim,
    toneBorder: C.okBorder,
  },
  {
    value: 'cancelled',
    label: "Inspector's favour, refund client",
    description: 'Job is cancelled and the Secured Funds are refunded to the client. Use when the inspector failed to deliver.',
    icon: 'close-circle',
    tone: C.danger,
    toneDim: C.dangerDim,
    toneBorder: C.dangerBorder,
  },
  {
    value: 'in_progress',
    label: 'Back to mediation, keep frozen',
    description: 'Reopen the job for further negotiation. Secured Funds stay frozen. Use when more evidence is needed.',
    icon: 'sync',
    tone: C.info,
    toneDim: C.infoDim,
    toneBorder: C.infoBorder,
  },
] as const;

interface DisputedJob {
  id: string;
  title: string | null;
  status: string;
  client_id: string | null;
  contractor_id: string | null;
  client_price_cents: number | null;
  payout_amount_cents: number | null;
  escrow_status: string | null;
  updated_at: string | null;
}

interface DisputeRow {
  id: string;
  job_id: string;
  filed_by: string;
  category: string;
  body: string;
  status: string;
  created_at: string;
}

interface ProfileLite {
  id: string;
  full_name: string | null;
  company_name: string | null;
  avatar_url: string | null;
  role: string | null;
}

// Pulse animation for the count badge — these are blocking money.
const PulseDot: React.FC<{ size?: number }> = ({ size = 8 }) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.7);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(2.3, { duration: 1100, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1100, easing: Easing.out(Easing.quad) }),
        withTiming(0.7, { duration: 0 }),
      ),
      -1,
    );
  }, [opacity, scale]);
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View
        style={[
          { position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: C.danger },
          ring,
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.danger }} />
    </View>
  );
};

export default function AdminDisputesScreen() {
  const router = useRouter();

  const [jobs, setJobs] = useState<DisputedJob[]>([]);
  const [disputes, setDisputes] = useState<Map<string, DisputeRow>>(new Map());
  const [profiles, setProfiles] = useState<Map<string, ProfileLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Resolution sheet state
  const [resolving, setResolving] = useState<DisputedJob | null>(null);
  const [resolution, setResolution] = useState<string>('completed');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      // 1. Disputed jobs — ADMIN projection (admin can see both prices)
      const { data: jobRows, error: jobErr } = await supabase
        // ★ PRIVILEGE FIX (20260801312000): ADMIN_JOB_FIELDS names the buyer
        //   pricing columns, which were revoked from `authenticated` on the
        //   base table. Admins read them back through the row-gated
        //   jobs_secure_view (its filter includes nx_is_admin()).
        .from('jobs_secure_view')
        .select(ADMIN_JOB_FIELDS)
        .eq('status', 'disputed')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (jobErr) throw jobErr;
      const jobList = (jobRows ?? []) as unknown as DisputedJob[];
      setJobs(jobList);

      if (jobList.length === 0) {
        setDisputes(new Map());
        setProfiles(new Map());
        return;
      }

      const jobIds = jobList.map((j) => j.id);
      const partyIds = Array.from(
        new Set([
          ...jobList.map((j) => j.client_id).filter(Boolean),
          ...jobList.map((j) => j.contractor_id).filter(Boolean),
        ]),
      ) as string[];

      // 2. Dispute rows for these jobs
      const { data: dRows } = await supabase
        .from('disputes')
        .select('id, job_id, filed_by, category, body, status, created_at')
        .in('job_id', jobIds)
        .order('created_at', { ascending: false });
      const dMap = new Map<string, DisputeRow>();
      (dRows as DisputeRow[] | null)?.forEach((d) => {
        // Keep most recent per job
        if (!dMap.has(d.job_id)) dMap.set(d.job_id, d);
      });
      setDisputes(dMap);

      // 3. Profile labels for parties
      if (partyIds.length > 0) {
        const { data: pRows } = await supabase
          .from('profiles')
          .select('id, full_name, company_name, avatar_url, role')
          .in('id', partyIds);
        const pMap = new Map<string, ProfileLite>();
        (pRows as ProfileLite[] | null)?.forEach((p) => pMap.set(p.id, p));
        setProfiles(pMap);
      }
    } catch (err) {
      console.warn('[admin-disputes] fetch error:', (err as Error)?.message);
      setJobs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const totalEscrowCents = useMemo(
    () => jobs.reduce((sum, j) => sum + (j.client_price_cents ?? 0), 0),
    [jobs],
  );

  const openResolver = useCallback((job: DisputedJob) => {
    setResolving(job);
    setResolution('completed');
    setReason('');
  }, []);

  const handleResolve = useCallback(async () => {
    if (!resolving) return;
    if (reason.trim().length < 10) {
      Alert.alert('Reason required', 'Provide at least a one-sentence reason, this is audit-annotated.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('admin_resolve_dispute', {
        p_job_id: resolving.id,
        p_resolution: resolution,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      const verb =
        resolution === 'completed'
          ? 'Secured Funds released to the inspector.'
          : resolution === 'cancelled'
            ? 'Secured Funds refunded to the client.'
            : 'Secured Funds stay frozen, job back in mediation.';
      Alert.alert('Dispute resolved', verb);
      setResolving(null);
      await fetchAll();
    } catch (err: any) {
      const msg = err?.message ?? '';
      if (msg.includes('admin only')) {
        Alert.alert('Not allowed', 'Only super_admin can resolve disputes.');
      } else if (msg.includes('not disputed')) {
        Alert.alert('Already resolved', 'This job is no longer in disputed status.');
      } else {
        Alert.alert('Could not resolve', msg || 'Please try again in a moment.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [resolving, resolution, reason, fetchAll]);

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glow} />
      <SafeAreaView style={s.safeArea} edges={['top']}>
        <View style={s.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [s.iconBtn, pressed && { transform: [{ scale: 0.92 }] }]}
            hitSlop={10}
          >
            <Ionicons name="arrow-back" size={18} color={C.text} />
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={s.kicker}>COMMAND CONSOLE, LIVE</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.headerTitle}>Disputes Board</Text>
              {jobs.length > 0 && <PulseDot size={7} />}
            </View>
          </View>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void fetchAll();
              }}
              tintColor={C.primary}
              colors={[C.primary]}
            />
          }
        >
          {/* Aggregate strip */}
          <View style={s.statStrip}>
            <View style={{ flex: 1 }}>
              <Text style={[s.statValue, { color: C.danger }]}>{jobs.length}</Text>
              <Text style={s.statLabel}>Open</Text>
            </View>
            <View style={s.statDiv} />
            <View style={{ flex: 1.4 }}>
              <Text style={[s.statValue, { color: C.amber }]}>
                {new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: 'USD',
                  maximumFractionDigits: 0,
                  notation: 'compact',
                }).format(totalEscrowCents / 100)}
              </Text>
              <Text style={s.statLabel}>Funds frozen</Text>
            </View>
            <View style={s.statDiv} />
            <View style={{ flex: 1 }}>
              <Text style={[s.statValue, { color: C.textMuted }]}>—</Text>
              <Text style={s.statLabel}>Avg age</Text>
            </View>
          </View>

          {loading ? (
            <View style={{ paddingVertical: 60, alignItems: 'center', gap: 12 }}>
              <ActivityIndicator size="large" color={C.primary} />
              <Text style={s.loadingText}>LOADING DISPUTES…</Text>
            </View>
          ) : jobs.length === 0 ? (
            <View style={s.empty}>
              <View style={s.emptyIcon}>
                <Ionicons name="shield-checkmark" size={22} color={C.ok} />
              </View>
              <Text style={s.emptyTitle}>No open disputes</Text>
              <Text style={s.emptySub}>
                The platform is in good standing. New disputes surface here in real-time and freeze the Secured Funds until you resolve.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 10, marginTop: 12 }}>
              {jobs.map((job, i) => (
                <DisputedJobCard
                  key={job.id}
                  job={job}
                  dispute={disputes.get(job.id) ?? null}
                  client={job.client_id ? profiles.get(job.client_id) ?? null : null}
                  contractor={job.contractor_id ? profiles.get(job.contractor_id) ?? null : null}
                  delay={Math.min(i, 5) * 60}
                  onResolve={() => openResolver(job)}
                  onOpenJob={() => router.push(`/(admin)/jobs/${job.id}` as any)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      <ResolveSheet
        job={resolving}
        resolution={resolution}
        onChangeResolution={setResolution}
        reason={reason}
        onChangeReason={setReason}
        submitting={submitting}
        onClose={() => setResolving(null)}
        onSubmit={handleResolve}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function DisputedJobCard({
  job,
  dispute,
  client,
  contractor,
  delay,
  onResolve,
  onOpenJob,
}: {
  job: DisputedJob;
  dispute: DisputeRow | null;
  client: ProfileLite | null;
  contractor: ProfileLite | null;
  delay: number;
  onResolve: () => void;
  onOpenJob: () => void;
}) {
  const clientLabel =
    client?.company_name?.trim() || client?.full_name?.trim() || 'Client';
  const inspectorLabel =
    contractor?.company_name?.trim() || contractor?.full_name?.trim() || 'Inspector';
  const escrow = job.client_price_cents ?? 0;
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(300)}>
      <View style={s.card}>
        <View style={s.cardTopRow}>
          <Pressable onPress={onOpenJob} style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.cardTitle} numberOfLines={1}>
              {job.title ?? 'Untitled job'}
            </Text>
            <Text style={s.cardSubtitle} numberOfLines={1}>
              {clientLabel} <Text style={{ color: C.textDim }}>vs</Text> {inspectorLabel}
            </Text>
          </Pressable>
          <View style={s.escrowPill}>
            <Ionicons name="lock-closed" size={10} color={C.amber} />
            <Text style={s.escrowText}>
              {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              }).format(escrow / 100)}
            </Text>
          </View>
        </View>

        {dispute ? (
          <View style={s.disputeBox}>
            <View style={s.disputeTopRow}>
              <View style={s.disputeCatPill}>
                <Ionicons name="pricetag" size={9} color={C.danger} />
                <Text style={s.disputeCatText}>{dispute.category.toUpperCase()}</Text>
              </View>
              <Text style={s.disputeTime}>
                Filed {new Date(dispute.created_at).toLocaleDateString()}
              </Text>
            </View>
            <Text style={s.disputeBody} numberOfLines={3}>
              {dispute.body}
            </Text>
          </View>
        ) : (
          <Text style={s.noDisputeText}>No dispute row found, manual investigation needed.</Text>
        )}

        <Pressable
          onPress={onResolve}
          style={({ pressed }) => [s.resolveBtn, pressed && { transform: [{ scale: 0.98 }] }]}
        >
          <Ionicons name="hammer" size={14} color="#FFF" />
          <Text style={s.resolveBtnText}>Resolve dispute</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ResolveSheet({
  job,
  resolution,
  onChangeResolution,
  reason,
  onChangeReason,
  submitting,
  onClose,
  onSubmit,
}: {
  job: DisputedJob | null;
  resolution: string;
  onChangeResolution: (r: string) => void;
  reason: string;
  onChangeReason: (r: string) => void;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal visible={!!job} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.sheetBackdrop}>
        <View style={s.sheet}>
          <View style={s.sheetHandle} />
          <View style={s.sheetHeader}>
            <View style={s.sheetIconWrap}>
              <Ionicons name="hammer" size={18} color={C.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sheetKicker}>ADMIN RESOLUTION</Text>
              <Text style={s.sheetTitle} numberOfLines={1}>
                {job?.title ?? 'Resolve dispute'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={C.textSec} />
            </Pressable>
          </View>

          <Text style={s.sheetExplain}>
            Pick the outcome. Secured Funds move the moment you confirm, audit
            row + notifications to both parties are written atomically.
          </Text>

          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            <Text style={s.sheetLabel}>RESOLUTION</Text>
            <View style={{ gap: 8, marginBottom: 14 }}>
              {RESOLUTIONS.map((r) => {
                const sel = resolution === r.value;
                return (
                  <Pressable
                    key={r.value}
                    onPress={() => onChangeResolution(r.value)}
                    style={[
                      s.resOpt,
                      sel
                        ? { borderColor: r.toneBorder, backgroundColor: r.toneDim }
                        : { borderColor: C.border },
                    ]}
                  >
                    <View
                      style={[
                        s.resOptIcon,
                        { backgroundColor: sel ? r.tone + '33' : 'rgba(255,255,255,0.04)' },
                      ]}
                    >
                      <Ionicons name={r.icon as any} size={16} color={sel ? r.tone : C.textMuted} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[s.resOptLabel, { color: sel ? r.tone : C.text }]}>
                        {r.label}
                      </Text>
                      <Text style={s.resOptDesc}>{r.description}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={s.sheetLabel}>REASON (REQUIRED, AUDIT-ANNOTATED)</Text>
            <TextInput
              value={reason}
              onChangeText={onChangeReason}
              placeholder="Why this resolution? Cite evidence, dates, and any communication with the parties."
              placeholderTextColor={C.textDim}
              multiline
              maxLength={4000}
              editable={!submitting}
              style={s.bodyInput}
            />
            <Text style={s.bodyCounter}>{reason.length} / 4000</Text>
          </ScrollView>

          <Pressable
            onPress={onSubmit}
            disabled={submitting || reason.trim().length < 10}
            style={({ pressed }) => [
              s.submitBtn,
              (submitting || reason.trim().length < 10) && { opacity: 0.5 },
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Ionicons name="hammer" size={14} color="#FFF" />
            )}
            <Text style={s.submitBtnText}>
              {submitting ? 'Recording resolution…' : 'Confirm + move funds'}
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
    backgroundColor: C.danger,
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
  kicker: { color: C.danger, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  headerTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 1 },

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
    gap: 12,
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
    backgroundColor: C.okDim,
    borderWidth: 1,
    borderColor: C.okBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { color: C.text, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  emptySub: { color: C.textMuted, fontSize: 11.5, lineHeight: 16, textAlign: 'center' },

  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.dangerBorder,
    padding: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
  },
  cardTitle: { color: C.text, fontSize: 14, fontWeight: '800' },
  cardSubtitle: { color: C.textSec, fontSize: 11, fontWeight: '600', marginTop: 3 },
  escrowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: C.amberDim,
    borderWidth: 1,
    borderColor: C.amberBorder,
  },
  escrowText: { color: C.amber, fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },

  disputeBox: {
    backgroundColor: C.dangerDim,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.20)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  disputeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  disputeCatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    backgroundColor: 'rgba(239,68,68,0.18)',
    borderWidth: 1,
    borderColor: C.dangerBorder,
  },
  disputeCatText: { color: C.danger, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.6 },
  disputeTime: { color: C.textMuted, fontSize: 10, fontStyle: 'italic' },
  disputeBody: { color: C.text, fontSize: 12, lineHeight: 17 },
  noDisputeText: {
    color: C.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 10,
  },

  resolveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.primary,
    paddingVertical: 12,
    borderRadius: 12,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
  resolveBtnText: { color: '#FFF', fontSize: 12.5, fontWeight: '800', letterSpacing: 0.3 },

  // Sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(2, 4, 32, 0.92)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.32)',
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
    backgroundColor: C.primaryDim,
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetKicker: { color: C.primary, fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  sheetTitle: { color: C.text, fontSize: 15, fontWeight: '800', marginTop: 1 },
  sheetExplain: { color: C.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 8, marginBottom: 16 },
  sheetLabel: { color: C.primary, fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, marginBottom: 8 },

  resOpt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  resOptIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resOptLabel: { fontSize: 12.5, fontWeight: '800' },
  resOptDesc: { color: C.textMuted, fontSize: 10.5, lineHeight: 14, marginTop: 3 },

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
  bodyCounter: { color: C.textMuted, fontSize: 10, textAlign: 'right', marginTop: 4, marginBottom: 14 },

  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 8,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  submitBtnText: { color: '#FFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
});
