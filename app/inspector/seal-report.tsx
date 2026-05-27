// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/seal-report.tsx
//
//  PROVABLE INSPECTION ENGINE — Sprint 1, leaf screen.
//
//  Isolated, deep-link reachable screen that lets an inspector compute and
//  store a cryptographic seal for an inspection report. Calls the
//  pi_seal_inspection_report RPC. If a seal already exists, renders it in
//  read-only mode.
//
//  ROUTING
//  ───────
//    Reachable at  /inspector/seal-report?report_id=<uuid>
//    Flat-folder pattern (matches submit-report.tsx, submit-findings.tsx,
//    my-jobs.tsx already living at app/inspector/*). No navigation entries,
//    headers, or layouts are modified to add this screen.
//
//  THEME
//  ─────
//    Background  #020420   (locked)
//    Primary     #7C3AED   (locked)
//    Matches the dark/purple language used by ApprovalsScreen,
//    DepartmentPickerSheet, OrgSwitcher, etc.
//
//  DEPENDENCIES
//  ────────────
//    All deps are already in package.json — this screen adds none:
//      expo-router, expo-clipboard, lucide-react-native,
//      @tanstack/react-query, @supabase/supabase-js
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  StatusBar,
  Alert,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  Camera,
  ListChecks,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Link as LinkIcon,
  Clock,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';

// ─────────────────────────────────────────────────────────────────────
// Locked theme tokens — DO NOT EDIT without sign-off.
// ─────────────────────────────────────────────────────────────────────
const COLORS = {
  background: '#020420',
  primary: '#7C3AED',
  primaryDark: '#5B21B6',
  card: '#0F172A',
  cardBorder: '#1E293B',
  cardElevated: '#1E293B',
  textPrimary: '#F1F5F9',
  textMuted: '#94A3B8',
  textSubtle: '#64748B',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  divider: '#334155',
  accent: '#A78BFA',
} as const;

// ─────────────────────────────────────────────────────────────────────
// Types — mirror the public.pi_report_seals row shape.
// ─────────────────────────────────────────────────────────────────────
interface ReportSummary {
  id: string;
  job_id: string;
  inspector_id: string;
  status: string | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
}

interface ReportSeal {
  id: string;
  created_at: string;
  updated_at: string;
  report_id: string;
  job_id: string;
  inspector_id: string;
  algorithm: string;
  root_sha256: string;
  captures_root_sha256: string;
  items_root_sha256: string;
  report_meta_sha256: string;
  captures_count: number;
  items_count: number;
  chain_verified: boolean;
  chain_break_at_capture_id: string | null;
  inspector_sealed_at: string;
  inspector_signature_sha256: string;
  client_signed_at: string | null;
  client_signed_by: string | null;
  client_signature_sha256: string | null;
  audit_event_id: string | null;
}

const VERIFIER_BASE_URL = 'https://app.nexpec.com/verify';

// ─────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────
export default function SealReportScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ report_id?: string }>();
  const reportId = typeof params.report_id === 'string' ? params.report_id : '';
  const queryClient = useQueryClient();

  // ── Fetch the report row ──
  const reportQuery = useQuery({
    queryKey: ['pi-seal:report', reportId],
    enabled: !!reportId,
    queryFn: async (): Promise<ReportSummary | null> => {
      const { data, error } = await supabase
        .from('inspection_reports')
        .select('id, job_id, inspector_id, status, notes, deleted_at, created_at')
        .eq('id', reportId)
        .maybeSingle();
      if (error) throw error;
      return (data as ReportSummary | null) ?? null;
    },
  });

  const report = reportQuery.data;
  const jobId = report?.job_id;

  // ── Counts: captures (by job) and items (by report) ──
  const capturesCountQuery = useQuery({
    queryKey: ['pi-seal:captures-count', jobId],
    enabled: !!jobId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('inspection_captures')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId as string);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const itemsCountQuery = useQuery({
    queryKey: ['pi-seal:items-count', reportId],
    enabled: !!reportId,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('inspection_items')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // ── Existing seal (if any) ──
  const sealQuery = useQuery({
    queryKey: ['pi-seal:seal', reportId],
    enabled: !!reportId,
    queryFn: async (): Promise<ReportSeal | null> => {
      const { data, error } = await supabase.rpc('pi_fetch_report_seal', {
        p_report_id: reportId,
      });
      if (error) throw error;
      // RPC returns one row; id IS NULL means "no seal".
      if (!data || (data as ReportSeal).id == null) return null;
      return data as ReportSeal;
    },
  });

  // ── Seal mutation ──
  const sealMutation = useMutation({
    mutationFn: async (): Promise<ReportSeal> => {
      const { data, error } = await supabase.rpc('pi_seal_inspection_report', {
        p_report_id: reportId,
      });
      if (error) throw error;
      return data as ReportSeal;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['pi-seal:seal', reportId], data);
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : 'Failed to seal the report.';
      Alert.alert('Sealing failed', message);
    },
  });

  // ─── Derived state ───
  const isLoading =
    reportQuery.isLoading ||
    sealQuery.isLoading ||
    (!!jobId && capturesCountQuery.isLoading) ||
    itemsCountQuery.isLoading;
  const loadError =
    reportQuery.error ?? sealQuery.error ?? capturesCountQuery.error ?? itemsCountQuery.error;
  const seal = sealQuery.data ?? null;

  const verifierUrl = useMemo(() => {
    if (!seal) return '';
    return `${VERIFIER_BASE_URL}?seal_id=${encodeURIComponent(
      seal.id,
    )}&hash=${encodeURIComponent(seal.root_sha256)}`;
  }, [seal]);

  // ── Actions ──
  const handleCopy = useCallback(async (value: string, label: string) => {
    try {
      await Clipboard.setStringAsync(value);
      Alert.alert('Copied', `${label} copied to clipboard.`);
    } catch {
      Alert.alert('Copy failed', 'Could not write to the clipboard.');
    }
  }, []);

  const handleSeal = useCallback(() => {
    if (!report) return;
    Alert.alert(
      'Seal this report?',
      'Sealing produces a cryptographic root hash that anchors every photo, every item, and the report metadata. This action is recorded in the immutable audit trail.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Seal & Sign',
          style: 'default',
          onPress: () => sealMutation.mutate(),
        },
      ],
    );
  }, [report, sealMutation]);

  // ─────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <Stack.Screen
        options={{
          title: 'Seal Inspection Report',
          headerStyle: { backgroundColor: COLORS.background },
          headerTintColor: COLORS.textPrimary,
          headerTitleStyle: { color: COLORS.textPrimary, fontWeight: '600' },
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [
                styles.headerBackBtn,
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={22} color={COLORS.textPrimary} />
            </Pressable>
          ),
        }}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Empty deep link ── */}
        {!reportId && (
          <View style={styles.emptyCard}>
            <AlertTriangle size={28} color={COLORS.warning} />
            <Text style={styles.emptyTitle}>No report specified</Text>
            <Text style={styles.emptyBody}>
              Open this screen with a deep link that includes a{' '}
              <Text style={styles.code}>?report_id=…</Text> query parameter.
            </Text>
          </View>
        )}

        {/* ── Loading ── */}
        {!!reportId && isLoading && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Loading inspection record…</Text>
          </View>
        )}

        {/* ── Error ── */}
        {!!reportId && !isLoading && loadError && (
          <View style={styles.errorCard}>
            <ShieldAlert size={28} color={COLORS.danger} />
            <Text style={styles.errorTitle}>Couldn’t load the report</Text>
            <Text style={styles.errorBody}>
              {loadError instanceof Error
                ? loadError.message
                : 'Unknown error fetching the inspection record.'}
            </Text>
          </View>
        )}

        {/* ── Missing report ── */}
        {!!reportId && !isLoading && !loadError && !report && (
          <View style={styles.emptyCard}>
            <AlertTriangle size={28} color={COLORS.warning} />
            <Text style={styles.emptyTitle}>Report not found</Text>
            <Text style={styles.emptyBody}>
              Either this report doesn’t exist or you’re not authorised to view
              it.
            </Text>
          </View>
        )}

        {/* ── Main content ── */}
        {!!report && !isLoading && (
          <>
            <ReportInfoCard
              report={report}
              capturesCount={capturesCountQuery.data ?? 0}
              itemsCount={itemsCountQuery.data ?? 0}
              alreadySealed={!!seal}
            />

            {seal ? (
              <SealedDisplayCard
                seal={seal}
                verifierUrl={verifierUrl}
                onCopyHash={() => handleCopy(seal.root_sha256, 'Root hash')}
                onCopyVerifier={() => handleCopy(verifierUrl, 'Verifier link')}
              />
            ) : (
              <PreSealCard
                onSeal={handleSeal}
                pending={sealMutation.isPending}
                disabled={
                  !!report.deleted_at ||
                  capturesCountQuery.isLoading ||
                  itemsCountQuery.isLoading
                }
                deleted={!!report.deleted_at}
              />
            )}

            <FooterNote />
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// ReportInfoCard
// ─────────────────────────────────────────────────────────────────────
function ReportInfoCard({
  report,
  capturesCount,
  itemsCount,
  alreadySealed,
}: {
  report: ReportSummary;
  capturesCount: number;
  itemsCount: number;
  alreadySealed: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerIconWrap}>
          <Lock size={18} color={COLORS.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Inspection record</Text>
          <Text style={styles.cardSubtitle}>
            {alreadySealed ? 'This report is already sealed.' : 'Ready to seal.'}
          </Text>
        </View>
      </View>

      <View style={styles.divider} />

      <KeyValueRow label="Report ID" value={shortenId(report.id)} mono />
      <KeyValueRow label="Job ID" value={shortenId(report.job_id)} mono />
      <KeyValueRow
        label="Status"
        value={report.status ?? '—'}
        valueColor={COLORS.textPrimary}
      />

      <View style={styles.statsRow}>
        <StatTile
          icon={<Camera size={18} color={COLORS.accent} />}
          label="Captures"
          value={String(capturesCount)}
        />
        <StatTile
          icon={<ListChecks size={18} color={COLORS.accent} />}
          label="Items"
          value={String(itemsCount)}
        />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// PreSealCard — the "Seal & Sign" action
// ─────────────────────────────────────────────────────────────────────
function PreSealCard({
  onSeal,
  pending,
  disabled,
  deleted,
}: {
  onSeal: () => void;
  pending: boolean;
  disabled: boolean;
  deleted: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.headerIconWrap}>
          <ShieldCheck size={18} color={COLORS.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>Cryptographic seal</Text>
          <Text style={styles.cardSubtitle}>
            Produces a SHA-256 root hash binding every photo, every item, and
            the report metadata into one verifiable anchor.
          </Text>
        </View>
      </View>

      {deleted ? (
        <View style={styles.inlineWarning}>
          <AlertTriangle size={16} color={COLORS.danger} />
          <Text style={styles.inlineWarningText}>
            This report is marked deleted and cannot be sealed.
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onSeal}
          disabled={disabled || pending}
          accessibilityRole="button"
          accessibilityLabel="Seal and sign this inspection report"
          style={({ pressed }) => [
            styles.primaryBtn,
            (disabled || pending) && styles.primaryBtnDisabled,
            pressed && !disabled && !pending && { opacity: 0.85 },
          ]}
        >
          {pending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <ShieldCheck size={18} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>Seal & Sign</Text>
            </>
          )}
        </Pressable>
      )}

      <Text style={styles.footerHint}>
        Sealing is recorded in the immutable audit trail and cannot be undone.
        It does not change the job’s status or any business state.
      </Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SealedDisplayCard — read-only display once sealed
// ─────────────────────────────────────────────────────────────────────
function SealedDisplayCard({
  seal,
  verifierUrl,
  onCopyHash,
  onCopyVerifier,
}: {
  seal: ReportSeal;
  verifierUrl: string;
  onCopyHash: () => void;
  onCopyVerifier: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.sealedBanner}>
        <CheckCircle2 size={20} color={COLORS.success} />
        <View style={{ flex: 1 }}>
          <Text style={styles.sealedTitle}>Sealed</Text>
          <Text style={styles.sealedSubtitle}>
            {formatTimestamp(seal.inspector_sealed_at)}
          </Text>
        </View>
      </View>

      {!seal.chain_verified && (
        <View style={styles.inlineWarning}>
          <AlertTriangle size={16} color={COLORS.warning} />
          <Text style={styles.inlineWarningText}>
            Capture chain has a break. The seal is valid for the rows that
            exist, but cryptographic continuity isn’t intact across every
            photo. Review the chain before sharing with auditors.
          </Text>
        </View>
      )}

      <KeyValueRow
        label="Algorithm"
        value={seal.algorithm}
        mono
        valueColor={COLORS.accent}
      />

      <View style={styles.statsRow}>
        <StatTile
          icon={<Camera size={18} color={COLORS.accent} />}
          label="Captures"
          value={String(seal.captures_count)}
        />
        <StatTile
          icon={<ListChecks size={18} color={COLORS.accent} />}
          label="Items"
          value={String(seal.items_count)}
        />
      </View>

      <View style={styles.hashBlock}>
        <Text style={styles.hashLabel}>Root SHA-256</Text>
        <Text style={styles.hashValue} selectable>
          {seal.root_sha256}
        </Text>
        <View style={styles.hashActionsRow}>
          <Pressable
            onPress={onCopyHash}
            hitSlop={6}
            style={({ pressed }) => [
              styles.ghostBtn,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Copy root hash"
          >
            <Copy size={14} color={COLORS.accent} />
            <Text style={styles.ghostBtnText}>Copy hash</Text>
          </Pressable>

          <Pressable
            onPress={onCopyVerifier}
            hitSlop={6}
            style={({ pressed }) => [
              styles.ghostBtn,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Copy verifier link"
          >
            <LinkIcon size={14} color={COLORS.accent} />
            <Text style={styles.ghostBtnText}>Copy verifier link</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.divider} />

      <Text style={styles.sectionHeader}>Sub-roots</Text>
      <KeyValueRow
        label="Captures root"
        value={shortenHash(seal.captures_root_sha256)}
        mono
      />
      <KeyValueRow
        label="Items root"
        value={shortenHash(seal.items_root_sha256)}
        mono
      />
      <KeyValueRow
        label="Report meta"
        value={shortenHash(seal.report_meta_sha256)}
        mono
      />

      <View style={styles.divider} />

      <Text style={styles.sectionHeader}>Signatures</Text>
      <View style={styles.signatureRow}>
        <View style={styles.signatureDot} />
        <View style={{ flex: 1 }}>
          <Text style={styles.signatureLabel}>Inspector</Text>
          <Text style={styles.signatureValue}>
            {formatTimestamp(seal.inspector_sealed_at)}
          </Text>
          <Text style={styles.signatureHash}>
            {shortenHash(seal.inspector_signature_sha256)}
          </Text>
        </View>
      </View>

      <View style={styles.signatureRow}>
        <View
          style={[
            styles.signatureDot,
            {
              backgroundColor: seal.client_signed_at
                ? COLORS.success
                : COLORS.textSubtle,
            },
          ]}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.signatureLabel}>Client</Text>
          {seal.client_signed_at && seal.client_signature_sha256 ? (
            <>
              <Text style={styles.signatureValue}>
                {formatTimestamp(seal.client_signed_at)}
              </Text>
              <Text style={styles.signatureHash}>
                {shortenHash(seal.client_signature_sha256)}
              </Text>
            </>
          ) : (
            <View style={styles.pendingPill}>
              <Clock size={12} color={COLORS.textMuted} />
              <Text style={styles.pendingPillText}>Awaiting countersign</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// FooterNote
// ─────────────────────────────────────────────────────────────────────
function FooterNote() {
  return (
    <Text style={styles.bottomNote}>
      Seals are stored in <Text style={styles.code}>public.pi_report_seals</Text>{' '}
      and recorded in the immutable audit trail. The integrity chain at the
      photo level is independently maintained by{' '}
      <Text style={styles.code}>inspection_captures.capture_sha256</Text>.
    </Text>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Small atoms
// ─────────────────────────────────────────────────────────────────────
function KeyValueRow({
  label,
  value,
  mono = false,
  valueColor,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueColor?: string;
}) {
  return (
    <View style={styles.kvRow}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text
        style={[
          styles.kvValue,
          mono && styles.monoValue,
          valueColor ? { color: valueColor } : undefined,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.statTile}>
      <View style={styles.statIconWrap}>{icon}</View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function shortenId(id: string): string {
  if (!id) return '—';
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function shortenHash(h: string | null | undefined): string {
  if (!h) return '—';
  if (h.length <= 18) return h;
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerBackBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 14,
  },

  // Loading / error / empty
  loadingCard: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  loadingText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  errorCard: {
    backgroundColor: COLORS.card,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  errorTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  errorBody: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyCard: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyBody: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },

  // Cards
  card: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: COLORS.textMuted,
    fontSize: 13,
    marginTop: 2,
    lineHeight: 19,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.divider,
    marginVertical: 14,
  },
  sectionHeader: {
    color: COLORS.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  // Key-value rows
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 12,
  },
  kvLabel: {
    color: COLORS.textSubtle,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  kvValue: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
    textAlign: 'right',
  },
  monoValue: {
    fontFamily: 'Menlo',
    fontSize: 12,
    color: COLORS.accent,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  statTile: {
    flex: 1,
    backgroundColor: COLORS.cardElevated,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: COLORS.cardBorder,
  },
  statIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 4,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
  },

  // Primary action
  primaryBtn: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 48,
  },
  primaryBtnDisabled: {
    backgroundColor: COLORS.primaryDark,
    opacity: 0.5,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  footerHint: {
    marginTop: 14,
    color: COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },

  // Inline warning
  inlineWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    borderColor: 'rgba(245, 158, 11, 0.25)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  inlineWarningText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    lineHeight: 19,
    flex: 1,
  },

  // Sealed banner
  sealedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderColor: 'rgba(16, 185, 129, 0.25)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  sealedTitle: {
    color: COLORS.success,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  sealedSubtitle: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },

  // Hash block
  hashBlock: {
    marginTop: 14,
    backgroundColor: COLORS.cardElevated,
    borderColor: COLORS.cardBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  hashLabel: {
    color: COLORS.textSubtle,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  hashValue: {
    color: COLORS.accent,
    fontSize: 12,
    fontFamily: 'Menlo',
    lineHeight: 18,
  },
  hashActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
    borderColor: 'rgba(124, 58, 237, 0.3)',
    borderWidth: 1,
  },
  ghostBtnText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: '600',
  },

  // Signatures
  signatureRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
    alignItems: 'flex-start',
  },
  signatureDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.success,
    marginTop: 6,
  },
  signatureLabel: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  signatureValue: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  signatureHash: {
    color: COLORS.accent,
    fontSize: 11,
    fontFamily: 'Menlo',
    marginTop: 4,
  },
  pendingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  pendingPillText: {
    color: COLORS.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },

  // Footer note
  bottomNote: {
    color: COLORS.textSubtle,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
    paddingHorizontal: 8,
    marginTop: 6,
  },
  code: {
    fontFamily: 'Menlo',
    color: COLORS.accent,
  },
});
