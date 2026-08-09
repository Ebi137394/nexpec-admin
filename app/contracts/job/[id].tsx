// ════════════════════════════════════════════════════════════════════════════
//  app/contracts/job/[id].tsx — V3 Job Contract Signing Surface (multi-role)
//
//  Mobile parity with the web's binding per-job contract experience:
//    web · /client/contracts/job/[id]
//    web · /inspector/contracts/job/[id]
//
//  Role-aware: this single screen dynamically picks the right blind-pricing
//  view based on the authenticated user's role and the contract's
//  client_id / inspector_id.
//
//  ─── GR2 (STRICT PRICE VISIBILITY) — THE RED LINE ─────────────────────────
//
//  The contract row is the most sensitive surface in the platform. The
//  buyer sees the price THEY pay; the inspector sees the payout THEY
//  receive; neither sees the other side. We enforce this in three layers:
//
//     1. DB layer — column-level RLS via two projected views:
//          client_job_contracts_view    — exposes client_price_cents
//          inspector_job_contracts_view — exposes inspector_payout_cents
//        The base table job_contracts is REVOKEd from authenticated.
//
//     2. Wire layer — this file picks the view that matches the caller's
//        actual relationship to the contract (client_id vs inspector_id).
//        The OPPOSING view is never queried.
//
//     3. UI layer — the blind-pricing card renders a SINGLE labelled
//        amount ("Your price" or "Your payout"). The other side's value
//        is not in component state, never rendered, never logged.
//
//  Even if an attacker bypassed (3) and (2), (1) at the DB layer would
//  still refuse the query — column-level RLS is the floor.
//
//  ─── Signing RPCs (SECURITY DEFINER, web migration 20260518390000) ───────
//
//    client_sign_job_contract(p_contract_id, p_typed_name, p_ip)
//       — only the client_id can call, only when status = pending_client_signature
//       — promotes jobs.status open → assigned
//
//    inspector_sign_job_contract(p_contract_id, p_typed_name, p_ip)
//       — only the inspector_id can call, only when status = pending_inspector_signature
//       — promotes jobs.status assigned → in_progress (defensively)
//
//  The RPCs perform every authorisation + state-machine check; this file's
//  client-side guards are UX hints, not security.
//
//  ─── Route ID accepts both shapes ────────────────────────────────────────
//
//  • Raw UUID — direct deep-link.
//  • `jc:<UUID>` — the prefix used by the Contracts Hub when it merges
//    v3 contracts into the legacy list. We strip it on parse.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import {
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  Clock,
  FileSignature,
  ExternalLink,
  FileText,
  Hourglass,
  Lock,
  Crown,
  AlertCircle,
  Sparkles,
  PenLine,
  MapPin,
  Calendar,
} from 'lucide-react-native';

import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { enqueueContractSign, isOnline, flushQueue, opStillQueued } from '@/lib/offline';
import { formatScheduledDate } from '@nexpec/shared-core';

// ─────────────────────────────────────────────────────────────────────────────
//  Theme — same vocabulary as enterprise dashboard + contracts hub
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg: '#020420',
  bgElev: '#070A24',
  card: '#0B1138',
  cardElev: '#0F1647',
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.32)',
  borderGold: 'rgba(244, 196, 48, 0.35)',
  borderGreen: 'rgba(16, 249, 149, 0.35)',

  text: '#FFFFFF',
  textSecondary: '#A8B2C7',
  textMuted: '#6B7390',
  textDim: '#475569',

  primary: '#7C3AED',
  primaryDeep: '#5B21B6',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',
  primaryDim: 'rgba(124, 58, 237, 0.10)',

  cyan: '#00FFFF',
  cyanDim: 'rgba(0, 255, 255, 0.12)',
  cyanBorder: 'rgba(0, 255, 255, 0.30)',

  gold: '#F4C430',
  goldGlow: 'rgba(244, 196, 48, 0.18)',

  ok: '#10F995',
  okGlow: 'rgba(16, 249, 149, 0.12)',
  warn: '#F59E0B',
  warnDim: 'rgba(245, 158, 11, 0.14)',
  danger: '#EF4444',
  dangerDim: 'rgba(239, 68, 68, 0.14)',
};

// ─────────────────────────────────────────────────────────────────────────────
//  Types — strict projections per role. Single side of the money each.
// ─────────────────────────────────────────────────────────────────────────────

type ContractStatus =
  | 'pending_client_signature'
  | 'pending_inspector_signature'
  | 'fully_executed'
  | 'voided';

type ContractRole = 'client' | 'inspector';

/**
 * BUYER-side contract row from client_job_contracts_view.
 * Column-level RLS guarantees this projection NEVER contains
 * inspector_payout_cents. We mirror that guarantee in the type so a
 * future dev can't accidentally reference it.
 */
interface ClientContractRow {
  id: string;
  job_id: string | null;
  client_id: string;
  inspector_id: string | null;
  status: ContractStatus;
  client_price_cents: number | null; // ← buyer's own price; never inspector's payout
  contract_text_md: string | null;
  custom_contract_url: string | null;
  client_signed_at: string | null;
  client_signed_name: string | null;
  inspector_signed_at: string | null;
  voided_at: string | null;
  voided_reason: string | null;
  created_at: string;
  updated_at: string | null;
  // ── Identity disclosure, resolved and gated in the DB ──────────────────
  //  The view returns NULL for every field the effective mode does not
  //  permit, so rendering these unconditionally cannot over-disclose.
  identity_mode: 'protected' | 'professional' | 'full' | null;
  inspector_display_name: string | null;
  inspector_headline: string | null;
  inspector_resume_summary: string | null;
  inspector_resume_url: string | null;
  inspector_certifications: string[] | null;
  inspector_qualifications: string[] | null;
  inspector_email: string | null;
  inspector_phone: string | null;
}

/**
 * INSPECTOR-side contract row from inspector_job_contracts_view.
 * Column-level RLS guarantees this projection NEVER contains
 * client_price_cents. Strict mirror.
 */
interface InspectorContractRow {
  id: string;
  job_id: string | null;
  client_id: string | null;
  inspector_id: string;
  status: ContractStatus;
  inspector_payout_cents: number | null; // ← inspector's own payout; never client price
  contract_text_md: string | null;
  custom_contract_url: string | null;
  client_signed_at: string | null;
  inspector_signed_at: string | null;
  inspector_signed_name: string | null;
  voided_at: string | null;
  voided_reason: string | null;
  created_at: string;
  updated_at: string | null;
}

interface JobLite {
  id: string;
  title: string | null;
  location: string | null;
  scheduled_date: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const dollars = (n: number | null | undefined) =>
  n == null ? '—' : USD.format(n / 100);

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strip the `jc:` prefix the Hub uses to disambiguate v3 ids from legacy. */
function normaliseId(raw: string | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.startsWith('jc:') ? raw.slice(3) : raw;
  return UUID_RX.test(stripped) ? stripped : null;
}

const STATUS_META: Record<
  ContractStatus,
  { label: string; tone: string; toneDim: string; icon: any }
> = {
  pending_client_signature: {
    label: 'Awaiting Client',
    tone: C.warn,
    toneDim: C.warnDim,
    icon: Hourglass,
  },
  pending_inspector_signature: {
    label: 'Awaiting Inspector',
    tone: C.cyan,
    toneDim: C.cyanDim,
    icon: Hourglass,
  },
  fully_executed: {
    label: 'Fully Executed',
    tone: C.ok,
    toneDim: C.okGlow,
    icon: CheckCircle2,
  },
  voided: {
    label: 'Voided',
    tone: C.danger,
    toneDim: C.dangerDim,
    icon: AlertCircle,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Atomic — live pulse used on the active timeline step
// ─────────────────────────────────────────────────────────────────────────────

const LivePulse: React.FC<{ color?: string; size?: number }> = ({
  color = C.warn,
  size = 8,
}) => {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(2.4, { duration: 1200, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1200, easing: Easing.out(Easing.quad) }),
        withTiming(0.6, { duration: 0 }),
      ),
      -1,
    );
  }, [opacity, scale]);
  const ring = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));
  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: color,
          },
          ring,
        ]}
      />
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────────────

export default function JobContractSigningScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const id = useMemo(() => normaliseId(rawId), [rawId]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [signing, setSigning] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Role + row are unioned by which view we hit. Only ONE of {clientRow,
  // inspectorRow} is ever populated — never both.
  const [role, setRole] = useState<ContractRole | null>(null);
  const [clientRow, setClientRow] = useState<ClientContractRow | null>(null);
  const [inspectorRow, setInspectorRow] = useState<InspectorContractRow | null>(
    null,
  );
  const [job, setJob] = useState<JobLite | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────
  const fetchContract = useCallback(async () => {
    if (!id) {
      setError('Invalid contract id.');
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('Sign-in required.');
        setLoading(false);
        return;
      }

      // ── GR2 GATE — try BOTH views by id. Whichever returns a row tells
      //    us which side of the contract the user actually IS. The DB
      //    enforces row-level RLS (client view filters client_id =
      //    auth.uid() OR admin; inspector view filters inspector_id =
      //    auth.uid() OR admin), so only the rightful side will see a row.
      //    The OPPOSING view stays null in this client state — that's the
      //    GR2 floor.
      const [clientRes, inspectorRes] = await Promise.all([
        supabase
          .from('client_job_contracts_view')
          .select(
            [
              'id',
              'job_id',
              'client_id',
              'inspector_id',
              'status',
              'client_price_cents',
              'contract_text_md',
              'custom_contract_url',
              'client_signed_at',
              'client_signed_name',
              'inspector_signed_at',
              'voided_at',
              'voided_reason',
              'created_at',
              'updated_at',
              // ── Identity disclosure (DB-gated) ──────────────────────────
              //  client_job_contracts_view resolves the effective mode itself
              //  (live jobs.identity_mode while the contract is active; the
              //  immutable snapshot once voided) and returns NULL for anything
              //  the mode does not permit. These columns were never selected,
              //  so raising the policy to "professional"/"full" in the admin
              //  console could never surface on mobile — no refresh would help,
              //  because the app never asked for the data.
              'identity_mode',
              'inspector_display_name',
              'inspector_headline',
              'inspector_resume_summary',
              'inspector_resume_url',
              'inspector_certifications',
              'inspector_qualifications',
              'inspector_email',
              'inspector_phone',
            ].join(', '),
          )
          .eq('id', id)
          .maybeSingle(),
        supabase
          .from('inspector_job_contracts_view')
          .select(
            [
              'id',
              'job_id',
              'client_id',
              'inspector_id',
              'status',
              'inspector_payout_cents',
              'contract_text_md',
              'custom_contract_url',
              'client_signed_at',
              'inspector_signed_at',
              'inspector_signed_name',
              'voided_at',
              'voided_reason',
              'created_at',
              'updated_at',
            ].join(', '),
          )
          .eq('id', id)
          .maybeSingle(),
      ]);

      const cData = (clientRes.data as ClientContractRow | null) ?? null;
      const iData = (inspectorRes.data as InspectorContractRow | null) ?? null;

      let resolvedRole: ContractRole | null = null;
      let jobId: string | null = null;

      if (cData && cData.client_id === user.id) {
        // Caller is the buyer side. Only client view populated.
        resolvedRole = 'client';
        setClientRow(cData);
        setInspectorRow(null);
        jobId = cData.job_id;
      } else if (iData && iData.inspector_id === user.id) {
        // Caller is the inspector side. Only inspector view populated.
        resolvedRole = 'inspector';
        setInspectorRow(iData);
        setClientRow(null);
        jobId = iData.job_id;
      } else if (cData || iData) {
        // Admin path — they get both. We don't render a buyer-or-inspector
        // sign panel for admins (they don't sign contracts). We still
        // show the document and pricing in admin-aware fashion later;
        // for now treat as read-only with the more complete row.
        resolvedRole = null;
        setClientRow(cData);
        setInspectorRow(iData);
        jobId = cData?.job_id ?? iData?.job_id ?? null;
      } else {
        setError('Contract not found or access denied.');
      }

      setRole(resolvedRole);

      // Job title / scheduled-date / location — narrow projection, no $.
      if (jobId) {
        const { data: jobRow } = await supabase
          .from('jobs')
          .select('id, title, location, scheduled_date')
          .eq('id', jobId)
          .maybeSingle();
        setJob((jobRow as JobLite | null) ?? null);
      }
    } catch (err: any) {
      console.warn('[contract-signing] fetch error:', err);
      setError(err?.message ?? 'Failed to load contract.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    void fetchContract();
  }, [fetchContract]);

  // Realtime: live-update when admin generates / the other side signs.
  const channelId = useId();
  useRealtimeSubscription({
    channelName: `contract-signing:${id ?? 'none'}:${channelId}`,
    bindings: [
      {
        event: '*',
        table: 'job_contracts',
        filter: id ? `id=eq.${id}` : undefined,
      },
    ],
    onChange: () => fetchContract(),
    onDesync: () => fetchContract(),
    enabled: !!id,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchContract();
    setRefreshing(false);
  }, [fetchContract]);

  // ── Derived state ──────────────────────────────────────────────────────
  const contract = clientRow ?? inspectorRow;
  const status = (contract?.status ?? 'pending_client_signature') as ContractStatus;
  const meta = STATUS_META[status] ?? STATUS_META.pending_client_signature;

  const isMyTurn = useMemo(() => {
    if (!role || !contract) return false;
    if (role === 'client') return status === 'pending_client_signature';
    if (role === 'inspector') return status === 'pending_inspector_signature';
    return false;
  }, [role, status, contract]);

  const myAmountCents: number | null = useMemo(() => {
    // Strict: client sees ONLY client_price_cents; inspector sees ONLY
    // inspector_payout_cents. Anything else is `null`.
    if (role === 'client') return clientRow?.client_price_cents ?? null;
    if (role === 'inspector') return inspectorRow?.inspector_payout_cents ?? null;
    return null;
  }, [role, clientRow, inspectorRow]);

  // ── Identity disclosure ────────────────────────────────────────────────
  //  Build the visible rows from whatever the DB view permitted. Every value is
  //  already mode-gated server-side, so an empty list means "protected" and no
  //  section renders.
  const identityFields = useMemo(() => {
    if (role !== 'client' || !clientRow) return [];
    const joinList = (v: string[] | null): string | null =>
      Array.isArray(v) && v.length > 0 ? v.join(', ') : null;
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Name', value: clientRow.inspector_display_name },
      { label: 'Title', value: clientRow.inspector_headline },
      { label: 'Summary', value: clientRow.inspector_resume_summary },
      { label: 'Certifications', value: joinList(clientRow.inspector_certifications) },
      { label: 'Qualifications', value: joinList(clientRow.inspector_qualifications) },
      { label: 'Email', value: clientRow.inspector_email },
      { label: 'Phone', value: clientRow.inspector_phone },
    ].flatMap(({ label, value }) =>
      value && String(value).trim() ? [{ label, value: String(value).trim() }] : [],
    );
    return rows;
  }, [role, clientRow]);

  // ── Sign handler ───────────────────────────────────────────────────────
  const handleSign = useCallback(async () => {
    if (!id || !role || !contract) return;
    const trimmed = typedName.trim();
    if (trimmed.length < 2) {
      Alert.alert('Type your full name', 'Enter your full legal name to sign.');
      return;
    }
    const rpcName =
      role === 'client'
        ? ('client_sign_job_contract' as const)
        : ('inspector_sign_job_contract' as const);
    setSigning(true);
    try {
      // Offline-durable: the signature is persisted to the outbox and drains on
      // reconnect (the sign RPC is idempotent on signer + contract state), so a
      // mid-tap network drop can never lose a binding signature. The server logs
      // the request IP from the connection.
      const opId = await enqueueContractSign({ rpcName, contractId: id, typedName: trimmed });
      setTypedName('');
      if (isOnline()) await flushQueue();
      await fetchContract();
      // Honest feedback: only claim "Signed" when the op actually left the queue.
      const queued = await opStillQueued(opId);
      if (queued) {
        Alert.alert(
          'Saved',
          'Your signature is saved and will be recorded automatically once you reconnect.',
        );
      } else {
        Alert.alert(
          'Signed',
          role === 'client'
            ? 'You signed. The inspector is now notified to counter-sign.'
            : 'You signed. The contract is fully executed and the job is in motion.',
        );
      }
    } catch (err: any) {
      Alert.alert(
        'Could not save signature',
        err?.message ?? 'Could not queue the signature. Please try again.',
      );
    } finally {
      setSigning(false);
    }
  }, [id, role, contract, typedName, fetchContract]);

  // ── Open document ─────────────────────────────────────────────────────
  const handleOpenDocument = useCallback(async () => {
    if (!contract?.custom_contract_url) {
      Alert.alert(
        'No PDF attached',
        'This contract has no external document. The terms below are the binding text.',
      );
      return;
    }
    try {
      await Linking.openURL(contract.custom_contract_url);
    } catch (err) {
      Alert.alert('Cannot open', 'The contract URL is not reachable from this device.');
    }
  }, [contract?.custom_contract_url]);

  // ── Render: loading ────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View pointerEvents="none" style={s.glowTopLeft} />
        <View pointerEvents="none" style={s.glowBottomRight} />
        <SafeAreaView style={s.safeArea} edges={['top']}>
          <View style={s.loadingCenter}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.loadingText}>OPENING CONTRACT…</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Render: error ──────────────────────────────────────────────────────
  if (error || !contract) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View pointerEvents="none" style={s.glowTopLeft} />
        <SafeAreaView style={s.safeArea} edges={['top']}>
          <Header onBack={() => router.back()} title="Contract" status={null} />
          <View style={s.errorWrap}>
            <Lock size={26} color={C.danger} strokeWidth={1.6} />
            <Text style={s.errorTitle}>Contract not accessible</Text>
            <Text style={s.errorBody}>
              {error ?? 'This contract no longer exists or you don\'t have permission to view it.'}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Render: main ───────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowBottomRight} />
      <View pointerEvents="none" style={s.glowMidLeft} />

      <SafeAreaView style={s.safeArea} edges={['top']}>
        <Header
          onBack={() => router.back()}
          title="Job Contract"
          status={meta}
        />

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 60 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={C.primary}
                colors={[C.primary]}
              />
            }
            keyboardShouldPersistTaps="handled"
          >
            {/* ── 1) Job context ─────────────────────────────────────── */}
            <Animated.View entering={FadeInDown.duration(360)} style={s.jobCard}>
              <View style={s.jobIconWrap}>
                <FileSignature size={18} color={C.primary} strokeWidth={1.8} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.jobKicker}>CONTRACT FOR</Text>
                <Text style={s.jobTitle} numberOfLines={2}>
                  {job?.title ?? 'Inspection engagement'}
                </Text>
                <View style={s.jobMetaRow}>
                  {job?.location ? (
                    <View style={s.jobMetaChip}>
                      <MapPin size={10} color={C.textMuted} />
                      <Text style={s.jobMetaText} numberOfLines={1}>
                        {job.location}
                      </Text>
                    </View>
                  ) : null}
                  {job?.scheduled_date ? (
                    <View style={s.jobMetaChip}>
                      <Calendar size={10} color={C.textMuted} />
                      <Text style={s.jobMetaText} numberOfLines={1}>
                        {formatScheduledDate(job.scheduled_date)}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Animated.View>

            {/* ── 2) 3-step signature timeline ───────────────────────── */}
            <SectionHeader
              icon={<Clock size={14} color={C.primary} />}
              kicker="STATE MACHINE"
              title="Signature timeline"
              tint={C.primary}
            />
            <Animated.View entering={FadeInDown.delay(80)} style={s.timelineCard}>
              <TimelineStep
                index={1}
                label="Pending Client"
                signedAt={contract.client_signed_at}
                signedName={(clientRow?.client_signed_name as string | null) ?? null}
                active={status === 'pending_client_signature'}
                done={
                  !!contract.client_signed_at ||
                  status === 'pending_inspector_signature' ||
                  status === 'fully_executed'
                }
              />
              <TimelineConnector
                done={
                  status === 'pending_inspector_signature' ||
                  status === 'fully_executed'
                }
              />
              <TimelineStep
                index={2}
                label="Pending Inspector"
                signedAt={contract.inspector_signed_at}
                signedName={
                  (inspectorRow?.inspector_signed_name as string | null) ?? null
                }
                active={status === 'pending_inspector_signature'}
                done={!!contract.inspector_signed_at || status === 'fully_executed'}
              />
              <TimelineConnector done={status === 'fully_executed'} />
              <TimelineStep
                index={3}
                label="Executed"
                signedAt={null}
                signedName={null}
                active={false}
                done={status === 'fully_executed'}
                isTerminal
              />
            </Animated.View>

            {/* ── 3) Blind-pricing card (role-isolated) ──────────────── */}
            {role && (
              <>
                <SectionHeader
                  icon={
                    role === 'client' ? (
                      <Crown size={14} color={C.gold} />
                    ) : (
                      <Sparkles size={14} color={C.cyan} />
                    )
                  }
                  kicker={role === 'client' ? 'YOUR PRICE' : 'YOUR PAYOUT'}
                  title={role === 'client' ? 'What you pay' : 'What you receive'}
                  tint={role === 'client' ? C.gold : C.cyan}
                />
                <Animated.View
                  entering={FadeInDown.delay(160)}
                  style={[
                    s.priceCard,
                    role === 'client'
                      ? { borderColor: C.borderGold }
                      : { borderColor: C.cyanBorder },
                  ]}
                >
                  <LinearGradient
                    colors={
                      role === 'client'
                        ? ['rgba(244,196,48,0.08)', 'rgba(124,58,237,0.04)']
                        : ['rgba(0,255,255,0.06)', 'rgba(124,58,237,0.04)']
                    }
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <View style={s.priceRow}>
                    <Text style={s.priceValue}>{dollars(myAmountCents)}</Text>
                    <View
                      style={[
                        s.blindBadge,
                        role === 'client'
                          ? { borderColor: C.borderGold, backgroundColor: C.goldGlow }
                          : { borderColor: C.cyanBorder, backgroundColor: C.cyanDim },
                      ]}
                    >
                      <Lock
                        size={10}
                        color={role === 'client' ? C.gold : C.cyan}
                        strokeWidth={2}
                      />
                      <Text
                        style={[
                          s.blindBadgeText,
                          { color: role === 'client' ? C.gold : C.cyan },
                        ]}
                      >
                        {role === 'client' ? 'SECURE FUNDING' : 'SECURE'}
                      </Text>
                    </View>
                  </View>
                  <Text style={s.priceCaption}>
                    {role === 'client'
                      ? 'This is the total amount you will be charged for this engagement.'
                      : 'This is the total payout you will receive for completing this engagement.'}
                  </Text>
                </Animated.View>
              </>
            )}

            {/* ── 3b) Inspector identity — disclosed per the project policy ──
                 The DB view resolves the effective mode (live jobs.identity_mode
                 while the contract is active; the frozen snapshot once voided)
                 and NULLs every field the mode forbids. So we simply render what
                 came back: nothing appears under "protected", contact details
                 only under "full". Previously these columns were never selected,
                 so raising the policy in the admin console had no visible effect
                 here no matter how many times the buyer refreshed. */}
            {role === 'client' && clientRow && identityFields.length > 0 && (
              <>
                <SectionHeader
                  icon={<ShieldCheck size={14} color={C.ok} />}
                  kicker="PROJECT POLICY"
                  title="Inspector details"
                  tint={C.ok}
                />
                <Animated.View entering={FadeInDown.delay(90)} style={s.identityCard}>
                  {identityFields.map(({ label, value }) => (
                    <View key={label} style={s.identityRow}>
                      <Text style={s.identityLabel}>{label}</Text>
                      <Text style={s.identityValue} selectable>
                        {value}
                      </Text>
                    </View>
                  ))}
                </Animated.View>
              </>
            )}

            {/* ── 4) Contract document ───────────────────────────────── */}
            <SectionHeader
              icon={<FileText size={14} color={C.cyan} />}
              kicker="THE DOCUMENT"
              title="Contract terms"
              tint={C.cyan}
              right={
                contract.custom_contract_url ? (
                  <Pressable
                    onPress={handleOpenDocument}
                    style={({ pressed }) => [
                      s.docCta,
                      pressed && { transform: [{ scale: 0.97 }] },
                    ]}
                  >
                    <ExternalLink size={11} color={C.cyan} strokeWidth={2} />
                    <Text style={s.docCtaText}>Open PDF</Text>
                  </Pressable>
                ) : null
              }
            />
            <Animated.View entering={FadeInDown.delay(220)} style={s.docCard}>
              {contract.contract_text_md ? (
                <ScrollView
                  style={s.docBodyScroll}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  <Text style={s.docBody}>{contract.contract_text_md}</Text>
                </ScrollView>
              ) : (
                <View style={s.docEmpty}>
                  <FileText size={20} color={C.textMuted} strokeWidth={1.5} />
                  <Text style={s.docEmptyText}>
                    Terms are attached as a PDF. Tap "Open PDF" above to review.
                  </Text>
                </View>
              )}
            </Animated.View>

            {/* ── 5) Sign panel — only when it's the caller's turn ───── */}
            {isMyTurn && status !== 'voided' && (
              <>
                <SectionHeader
                  icon={<PenLine size={14} color={C.warn} />}
                  kicker={role === 'client' ? 'YOUR TURN' : 'YOUR SIGNATURE'}
                  title="Sign to make this binding"
                  tint={C.warn}
                />
                <Animated.View entering={FadeIn.delay(280)} style={s.signCard}>
                  <Text style={s.signLabel}>Type your full legal name</Text>
                  <TextInput
                    style={s.signInput}
                    placeholder="e.g. Jane Q. Public"
                    placeholderTextColor={C.textDim}
                    value={typedName}
                    onChangeText={setTypedName}
                    autoCapitalize="words"
                    autoCorrect={false}
                    editable={!signing}
                    returnKeyType="done"
                  />
                  <Pressable
                    onPress={handleSign}
                    disabled={signing || typedName.trim().length < 2}
                    style={({ pressed }) => [
                      s.signCta,
                      (signing || typedName.trim().length < 2) && { opacity: 0.6 },
                      pressed && { transform: [{ scale: 0.98 }] },
                    ]}
                  >
                    <LinearGradient
                      colors={[C.primary, C.primaryBright]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={StyleSheet.absoluteFill}
                    />
                    {signing ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <PenLine size={15} color="#FFFFFF" strokeWidth={2} />
                    )}
                    <Text style={s.signCtaText}>
                      {signing ? 'Recording signature…' : 'Sign & record'}
                    </Text>
                  </Pressable>
                  <Text style={s.signFootnote}>
                    Your typed name, the current timestamp, your IP address,
                    and your device user-agent will be stored as evidence.
                    Equivalent to a typed e-signature.
                  </Text>
                </Animated.View>
              </>
            )}

            {/* ── 6) Executed state ──────────────────────────────────── */}
            {status === 'fully_executed' && (
              <Animated.View entering={FadeIn.delay(280)} style={s.executedCard}>
                <View style={s.executedIconWrap}>
                  <CheckCircle2 size={24} color={C.ok} strokeWidth={2} />
                </View>
                <Text style={s.executedTitle}>Contract is binding</Text>
                <Text style={s.executedBody}>
                  {/* ★ 20260801330000: counter-signing ASSIGNS the inspector;
                      it does not start field work. Saying "in-progress" here
                      contradicted Job Details, which correctly read jobs.status
                      as assigned. */}
                  Both parties have signed. You are now assigned to this job —
                  start it when you begin work on site. Use the messages tab to
                  coordinate with the admin
                  desk on scheduling and dispatch.
                </Text>
              </Animated.View>
            )}

            {/* ── 7) Voided state ─────────────────────────────────────── */}
            {status === 'voided' && (
              <Animated.View entering={FadeIn.delay(280)} style={s.voidedCard}>
                <AlertCircle size={20} color={C.danger} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={s.voidedTitle}>This contract was voided</Text>
                  {contract.voided_reason ? (
                    <Text style={s.voidedBody}>{contract.voided_reason}</Text>
                  ) : null}
                  {contract.voided_at ? (
                    <Text style={s.voidedTime}>
                      {new Date(contract.voided_at).toLocaleString()}
                    </Text>
                  ) : null}
                </View>
              </Animated.View>
            )}

            {/* ── 8) Trust footer ─────────────────────────────────────── */}
            <View style={s.trustRow}>
              <ShieldCheck size={11} color={C.textMuted} />
              <Text style={s.trustText}>
                Signing is authenticated by your account. All transitions are
                audited on the server.
              </Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

const Header: React.FC<{
  onBack: () => void;
  title: string;
  status: {
    label: string;
    tone: string;
    toneDim: string;
    icon: any;
  } | null;
}> = ({ onBack, title, status }) => {
  const Icon = status?.icon ?? ShieldCheck;
  return (
    <View style={s.header}>
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [
          s.headerBtn,
          pressed && { transform: [{ scale: 0.92 }] },
        ]}
        hitSlop={10}
      >
        <ArrowLeft size={18} color={C.text} />
      </Pressable>
      <View style={s.headerCenter}>
        <Text style={s.headerKicker}>V3, BINDING</Text>
        <Text style={s.headerTitle}>{title}</Text>
      </View>
      {status ? (
        <View
          style={[
            s.headerStatus,
            { backgroundColor: status.toneDim, borderColor: status.tone + '55' },
          ]}
        >
          <Icon size={11} color={status.tone} strokeWidth={2} />
          <Text style={[s.headerStatusText, { color: status.tone }]}>
            {status.label.toUpperCase()}
          </Text>
        </View>
      ) : (
        <View style={{ width: 38 }} />
      )}
    </View>
  );
};

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  kicker: string;
  title: string;
  tint: string;
  right?: React.ReactNode;
}> = ({ icon, kicker, title, tint, right }) => (
  <View style={s.sectionHeader}>
    <View style={[s.sectionIconWrap, { backgroundColor: tint + '14' }]}>
      {icon}
    </View>
    <View style={{ flex: 1 }}>
      <Text style={[s.sectionKicker, { color: tint }]}>{kicker}</Text>
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
    {right}
  </View>
);

const TimelineStep: React.FC<{
  index: number;
  label: string;
  signedAt: string | null;
  signedName: string | null;
  active: boolean;
  done: boolean;
  isTerminal?: boolean;
}> = ({ index, label, signedAt, signedName, active, done, isTerminal }) => {
  const tone = done ? C.ok : active ? C.warn : C.textMuted;
  const ringColor = done
    ? C.ok
    : active
      ? C.warn
      : 'rgba(255,255,255,0.10)';
  return (
    <View style={s.tlStep}>
      <View style={[s.tlDot, { borderColor: ringColor }]}>
        {done ? (
          <CheckCircle2 size={18} color={C.ok} strokeWidth={2.2} />
        ) : active ? (
          <LivePulse color={C.warn} size={8} />
        ) : isTerminal ? (
          <Sparkles size={14} color={C.textMuted} strokeWidth={1.8} />
        ) : (
          <Text style={[s.tlIndex, { color: tone }]}>{index}</Text>
        )}
      </View>
      {/* Two lines: "Pending Inspector" cannot fit one line in a 1/3-width
          column, so it wraps ("Pending" / "Inspector") instead of clipping to
          "Pending I…". tlLabel reserves the 2-line height so the meta row
          below stays aligned across all three steps. */}
      <Text style={[s.tlLabel, { color: tone }]} numberOfLines={2}>
        {label}
      </Text>
      {signedAt ? (
        <Text style={s.tlMeta} numberOfLines={2}>
          {signedName ? `${signedName}, ` : ''}
          {new Date(signedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      ) : active ? (
        <Text style={[s.tlMeta, { color: C.warn }]}>Awaiting</Text>
      ) : (
        <Text style={s.tlMeta}>—</Text>
      )}
    </View>
  );
};

const TimelineConnector: React.FC<{ done: boolean }> = ({ done }) => (
  <View
    style={[
      s.tlConnector,
      { backgroundColor: done ? C.ok : 'rgba(255,255,255,0.06)' },
    ]}
  />
);

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  safeArea: { flex: 1 },

  glowTopLeft: {
    position: 'absolute',
    top: -160,
    left: -100,
    width: 360,
    height: 360,
    borderRadius: 200,
    backgroundColor: C.primary,
    opacity: 0.20,
  },
  glowBottomRight: {
    position: 'absolute',
    bottom: -180,
    right: -100,
    width: 340,
    height: 340,
    borderRadius: 200,
    backgroundColor: C.gold,
    opacity: 0.05,
  },
  glowMidLeft: {
    position: 'absolute',
    top: 260,
    left: -120,
    width: 280,
    height: 280,
    borderRadius: 200,
    backgroundColor: C.cyan,
    opacity: 0.04,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  headerBtn: {
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
  headerKicker: {
    color: C.cyan,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 1,
  },
  headerTitle: {
    color: C.text,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  headerStatusText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingText: {
    color: C.textMuted,
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '700',
  },

  // Error
  errorWrap: {
    margin: 20,
    padding: 24,
    borderRadius: 16,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    gap: 12,
  },
  errorTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 4,
  },
  errorBody: {
    color: C.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },

  // Job card
  jobCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 8,
    marginBottom: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.borderStrong,
  },
  jobIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: C.primaryGlow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.borderStrong,
  },
  jobKicker: {
    color: C.primary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  jobTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 2,
    lineHeight: 19,
  },
  jobMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  jobMetaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: C.border,
  },
  jobMetaText: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 14,
    marginBottom: 10,
  },
  sectionIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionKicker: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  sectionTitle: {
    color: C.text,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginTop: 1,
  },

  // Timeline
  timelineCard: {
    marginHorizontal: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  tlStep: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  tlDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    backgroundColor: C.bgElev,
  },
  tlIndex: {
    fontSize: 13,
    fontWeight: '800',
  },
  tlLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
    textAlign: 'center',
    // Reserve exactly two lines so a 1-line step ("Executed") and a 2-line one
    // ("Pending Inspector") keep their meta rows on the same baseline.
    lineHeight: 13,
    minHeight: 26,
  },
  tlMeta: {
    color: C.textMuted,
    fontSize: 9,
    fontWeight: '500',
    lineHeight: 12,
    marginTop: 3,
    textAlign: 'center',
  },
  tlConnector: {
    height: 2,
    // 0.35 (was 0.5): the three step columns share the row with two connectors,
    // so a shorter connector buys each label ~7pt of width. marginTop 18 keeps
    // the line centred on the 36pt dot.
    flex: 0.35,
    marginTop: 18,
    borderRadius: 1,
  },

  // Price card
  identityCard: {
    marginHorizontal: 20,
    padding: 16,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderGreen,
    gap: 12,
  },
  identityRow: { gap: 3 },
  identityLabel: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  identityValue: { color: C.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },

  priceCard: {
    marginHorizontal: 20,
    padding: 18,
    borderRadius: 18,
    backgroundColor: C.card,
    borderWidth: 1,
    overflow: 'hidden',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  priceValue: {
    color: C.text,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.8,
  },
  blindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  blindBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  priceCaption: {
    color: C.textMuted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },

  // Doc
  docCard: {
    marginHorizontal: 20,
    borderRadius: 16,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
  },
  docBodyScroll: {
    maxHeight: 220,
    padding: 14,
  },
  docBody: {
    color: C.textSecondary,
    fontSize: 12.5,
    lineHeight: 18.5,
  },
  docEmpty: {
    padding: 22,
    alignItems: 'center',
    gap: 8,
  },
  docEmptyText: {
    color: C.textMuted,
    fontSize: 11.5,
    textAlign: 'center',
    lineHeight: 16,
  },
  docCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: C.cyanDim,
    borderWidth: 1,
    borderColor: C.cyanBorder,
  },
  docCtaText: {
    color: C.cyan,
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  // Sign panel
  signCard: {
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 18,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  signLabel: {
    color: C.warn,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  signInput: {
    backgroundColor: C.bgElev,
    color: C.text,
    fontSize: 15,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  signCta: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  signCtaText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  signFootnote: {
    color: C.textMuted,
    fontSize: 10.5,
    lineHeight: 14.5,
    marginTop: 10,
    paddingHorizontal: 2,
  },

  // Executed state
  executedCard: {
    marginHorizontal: 20,
    marginTop: 14,
    padding: 20,
    borderRadius: 18,
    backgroundColor: C.okGlow,
    borderWidth: 1,
    borderColor: C.borderGreen,
    alignItems: 'center',
  },
  executedIconWrap: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: 'rgba(16, 249, 149, 0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.borderGreen,
    marginBottom: 10,
  },
  executedTitle: {
    color: C.ok,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  executedBody: {
    color: C.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 4,
  },

  // Voided state
  voidedCard: {
    marginHorizontal: 20,
    marginTop: 14,
    padding: 16,
    borderRadius: 16,
    backgroundColor: C.dangerDim,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.32)',
    flexDirection: 'row',
    gap: 12,
  },
  voidedTitle: {
    color: C.danger,
    fontSize: 13,
    fontWeight: '800',
  },
  voidedBody: {
    color: C.textSecondary,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 3,
  },
  voidedTime: {
    color: C.textMuted,
    fontSize: 10,
    marginTop: 4,
    fontStyle: 'italic',
  },

  // Trust footer
  trustRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    marginHorizontal: 28,
  },
  trustText: {
    color: C.textMuted,
    fontSize: 10,
    lineHeight: 14,
    flex: 1,
  },
});
