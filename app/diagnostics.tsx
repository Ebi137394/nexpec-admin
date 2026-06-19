// ════════════════════════════════════════════════════════════════════════════
//  app/diagnostics.tsx — Mobile Sprint 1 · Lane 4 · Pre-flight diagnostic
//
//  Read-only probe of the live Supabase backend, used to decide what
//  alignment work this mobile app actually needs against the web v3 schema.
//
//  What it checks (no writes anywhere):
//
//    1. Auth — session.user.id, email, profile.role. If the user isn't an
//       inspector, this app's primary job is to redirect them to the web
//       portal (we surface a hint here, but don't force-redirect from a
//       diagnostic screen).
//
//    2. Notifications shape — SELECTs one row of `notifications` and
//       reports which column set is live: legacy ({type, user_id, read,
//       message, link}) vs v3 ({kind, recipient_id, is_read, body,
//       link_href}). This is the canonical fingerprint of whether
//       migration 20260518400000 ("notifications nuke and rebuild") is
//       deployed.
//
//    3. RLS sanity — counts notifications the current user can see.
//       v3 policy is `recipient_id = auth.uid() OR nx_is_admin()`.
//
//    4. Contracts views — probes `inspector_job_contracts_view` (the
//       blind-pricing projection introduced in 20260518370000) and the
//       admin-only base `job_contracts` table. Inspector should be able
//       to read the view but be REVOKEd from the base.
//
//    5. Realtime — subscribes to the `notifications` channel and surfaces
//       the live state ('SUBSCRIBED' / 'CHANNEL_ERROR' / 'CLOSED'). This
//       is the same wire the web v3 bell uses.
//
//  How to open this screen: from any signed-in surface, navigate to
//  /diagnostics. It's in `allowedStandaloneRoutes` in app/_layout.tsx so
//  the AuthGate won't bounce it.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Database,
  Bell,
  User as UserIcon,
  Radio,
  FileText,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// ─────────────────────────────────────────────────────────────────────────────
// Theme — matches sign-in.tsx so the diagnostic feels native to the app
// ─────────────────────────────────────────────────────────────────────────────
const COLORS = {
  bg: '#070716',
  surface: '#0E0E22',
  surfaceLight: '#171732',
  border: 'rgba(255,255,255,0.08)',
  text: '#FFFFFF',
  textDim: '#9CA3B5',
  textMuted: '#5A6075',
  primary: '#B154F0',
  cyan: '#00FFFF',
  green: '#2ED573',
  amber: '#FFA502',
  red: '#FF4757',
};

// ─────────────────────────────────────────────────────────────────────────────
// Schema fingerprints — what the mobile code expects vs. what web v3 ships
// ─────────────────────────────────────────────────────────────────────────────
const V3_NOTIF_COLUMNS = ['kind', 'recipient_id', 'is_read', 'body', 'link_href'] as const;
const LEGACY_NOTIF_COLUMNS = ['type', 'user_id', 'read', 'message', 'link'] as const;

type ProbeStatus = 'pending' | 'ok' | 'warn' | 'fail';

interface ProbeResult {
  status: ProbeStatus;
  summary: string;
  detail?: string;
  rows?: Array<{ k: string; v: string; tone?: 'ok' | 'warn' | 'fail' | 'dim' }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe runners
// ─────────────────────────────────────────────────────────────────────────────

/** Probe #1 — Auth + profile.role */
async function probeAuth(): Promise<ProbeResult> {
  const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) {
    return {
      status: 'fail',
      summary: 'auth.getSession() errored',
      detail: sessErr.message,
    };
  }
  const session = sessionData.session;
  if (!session?.user) {
    return {
      status: 'warn',
      summary: 'No active session',
      detail: 'Sign in first, then re-run.',
    };
  }
  const user = session.user;

  const { data: profile, error: profErr } = await supabase
    .from('profiles')
    .select('id, role, full_name, email, onboarding_role')
    .eq('id', user.id)
    .maybeSingle();

  if (profErr) {
    return {
      status: 'fail',
      summary: 'profiles SELECT errored',
      detail: profErr.message,
      rows: [
        { k: 'user.id', v: user.id, tone: 'ok' },
        { k: 'user.email', v: user.email ?? '—', tone: 'ok' },
      ],
    };
  }

  const role = (profile?.role ?? '').toString().trim().toLowerCase();
  const isInspector = role === 'inspector';
  const isAdmin = role === 'admin' || role === 'super_admin';

  return {
    status: isInspector || isAdmin ? 'ok' : 'warn',
    summary: isInspector
      ? 'Inspector signed in'
      : isAdmin
        ? `Operator role: ${role}`
        : `Non-inspector role: ${role || '(empty)'}, this app is for inspectors`,
    rows: [
      { k: 'user.id', v: user.id, tone: 'dim' },
      { k: 'user.email', v: user.email ?? '—', tone: 'ok' },
      { k: 'profile.role', v: role || '(null)', tone: isInspector ? 'ok' : 'warn' },
      {
        k: 'onboarding_role',
        v: (profile?.onboarding_role ?? '').toString() || '(null)',
        tone: 'dim',
      },
      { k: 'full_name', v: profile?.full_name ?? '(null)', tone: 'dim' },
    ],
  };
}

/** Probe #2 — Notifications schema (which column set is live?) */
async function probeNotificationsSchema(): Promise<ProbeResult> {
  // SELECT * limit 1 — we don't need a real row, we need the column names
  // ordered by the server. If table is empty, fall back to a defensive HEAD.
  const { data, error } = await supabase.from('notifications').select('*').limit(1);

  if (error) {
    return {
      status: 'fail',
      summary: 'notifications SELECT errored',
      detail: error.message,
    };
  }

  if (!data || data.length === 0) {
    // Empty table — try inserting nothing and reading back the shape via
    // a column-existence test using filter on each candidate column.
    const probes = await Promise.all(
      [...V3_NOTIF_COLUMNS, ...LEGACY_NOTIF_COLUMNS].map(async (col) => {
        const { error: e } = await supabase
          .from('notifications')
          .select(col)
          .limit(1);
        return { col, exists: !e };
      }),
    );

    const v3Present = probes.filter((p) => V3_NOTIF_COLUMNS.includes(p.col as any) && p.exists);
    const legacyPresent = probes.filter(
      (p) => LEGACY_NOTIF_COLUMNS.includes(p.col as any) && p.exists,
    );

    const allV3 = v3Present.length === V3_NOTIF_COLUMNS.length;
    const someLegacy = legacyPresent.length > 0;

    return {
      status: allV3 && !someLegacy ? 'ok' : someLegacy ? 'warn' : 'fail',
      summary: allV3 && !someLegacy ? 'v3 columns present (table empty)' : someLegacy ? 'Legacy columns still reachable' : 'Cannot identify schema',
      rows: probes.map((p) => ({
        k: p.col,
        v: p.exists ? 'present' : 'missing',
        tone: p.exists
          ? (V3_NOTIF_COLUMNS.includes(p.col as any) ? 'ok' : 'warn')
          : (LEGACY_NOTIF_COLUMNS.includes(p.col as any) ? 'ok' : 'fail'),
      })),
    };
  }

  const sample = data[0] ?? {};
  const keys = Object.keys(sample);
  const v3Keys = keys.filter((k) => V3_NOTIF_COLUMNS.includes(k as any));
  const legacyKeys = keys.filter((k) => LEGACY_NOTIF_COLUMNS.includes(k as any));

  const allV3 = v3Keys.length === V3_NOTIF_COLUMNS.length;
  const anyLegacy = legacyKeys.length > 0;

  return {
    status: allV3 && !anyLegacy ? 'ok' : anyLegacy ? 'warn' : 'fail',
    summary: allV3 && !anyLegacy
      ? 'Web v3 schema confirmed'
      : anyLegacy
        ? `Legacy columns still present: ${legacyKeys.join(', ')}`
        : 'Schema mismatch',
    detail: `Live columns: ${keys.join(', ')}`,
    rows: [
      { k: 'v3 columns found', v: v3Keys.join(', ') || '(none)', tone: allV3 ? 'ok' : 'warn' },
      {
        k: 'legacy columns found',
        v: legacyKeys.join(', ') || '(none)',
        tone: anyLegacy ? 'warn' : 'ok',
      },
      { k: 'mobile NotificationCenter uses', v: 'type, is_read', tone: 'warn' },
    ],
  };
}

/** Probe #3 — RLS sanity (how many rows can I see?) */
async function probeNotificationsRls(userId: string | null): Promise<ProbeResult> {
  if (!userId) {
    return { status: 'warn', summary: 'No user id, sign in first' };
  }
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true });

  if (error) {
    return { status: 'fail', summary: 'COUNT failed', detail: error.message };
  }

  // Try with the v3 recipient_id column first; fall back to legacy user_id
  let mine: number | null = null;
  let filterUsed = 'recipient_id';
  const v3 = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', userId);
  if (!v3.error) {
    mine = v3.count ?? 0;
  } else {
    filterUsed = 'user_id';
    const legacy = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (!legacy.error) {
      mine = legacy.count ?? 0;
    }
  }

  return {
    status: 'ok',
    summary: `RLS reachable, ${mine ?? '?'} for me, ${count ?? '?'} total visible`,
    rows: [
      { k: 'total visible (RLS)', v: String(count ?? '?'), tone: 'ok' },
      { k: `for me via ${filterUsed}`, v: String(mine ?? '?'), tone: 'ok' },
    ],
  };
}

/** Probe #4 — Contracts: inspector_job_contracts_view + base table */
async function probeContractsViews(): Promise<ProbeResult> {
  // The view should be SELECT-able by inspectors (web v3 grants it).
  const view = await supabase
    .from('inspector_job_contracts_view')
    .select('id', { count: 'exact', head: true });

  // The base table should be REVOKEd from authenticated — we expect an error
  // or a "permission denied" / "relation does not exist" / empty result.
  const base = await supabase
    .from('job_contracts')
    .select('id', { count: 'exact', head: true });

  const viewOk = !view.error;
  const baseBlocked = !!base.error || (base.count ?? 0) === 0;

  const rows: ProbeResult['rows'] = [
    {
      k: 'inspector_job_contracts_view',
      v: viewOk ? `reachable (${view.count ?? 0} rows)` : `error: ${view.error?.message}`,
      tone: viewOk ? 'ok' : 'fail',
    },
    {
      k: 'job_contracts (base)',
      v: base.error
        ? `blocked: ${base.error.message}`
        : `reachable (${base.count ?? 0} rows)`,
      tone: base.error ? 'ok' : 'warn',
    },
  ];

  if (viewOk && baseBlocked) {
    return { status: 'ok', summary: 'Blind-pricing view live; base properly restricted', rows };
  }
  if (viewOk && !baseBlocked) {
    return {
      status: 'warn',
      summary: 'View reachable but base also exposed, GR2 leak risk',
      rows,
    };
  }
  return {
    status: 'fail',
    summary: 'inspector_job_contracts_view not reachable',
    detail: view.error?.message,
    rows,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen
// ─────────────────────────────────────────────────────────────────────────────

interface Section {
  id: string;
  title: string;
  icon: React.ComponentType<any>;
  result: ProbeResult;
}

export default function DiagnosticsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [running, setRunning] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [auth, setAuth] = useState<ProbeResult>({ status: 'pending', summary: '…' });
  const [notifSchema, setNotifSchema] = useState<ProbeResult>({ status: 'pending', summary: '…' });
  const [notifRls, setNotifRls] = useState<ProbeResult>({ status: 'pending', summary: '…' });
  const [contracts, setContracts] = useState<ProbeResult>({ status: 'pending', summary: '…' });
  const [realtime, setRealtime] = useState<ProbeResult>({
    status: 'pending',
    summary: 'Subscribing…',
  });
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const eventCountRef = useRef(0);

  const runAll = useCallback(async () => {
    setRunning(true);
    setAuth({ status: 'pending', summary: 'Probing…' });
    setNotifSchema({ status: 'pending', summary: 'Probing…' });
    setNotifRls({ status: 'pending', summary: 'Probing…' });
    setContracts({ status: 'pending', summary: 'Probing…' });

    const [a, n, c] = await Promise.all([
      probeAuth(),
      probeNotificationsSchema(),
      probeContractsViews(),
    ]);
    setAuth(a);
    setNotifSchema(n);
    setContracts(c);

    const r = await probeNotificationsRls(user?.id ?? null);
    setNotifRls(r);

    setRunning(false);
  }, [user?.id]);

  // Initial run
  useEffect(() => {
    void runAll();
  }, [runAll]);

  // Realtime probe — subscribe once, hold the channel for the lifetime
  useEffect(() => {
    const ch = supabase
      .channel(`diagnostics-notifications-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications' },
        () => {
          eventCountRef.current += 1;
          setRealtime((prev) => ({
            ...prev,
            summary: `${prev.summary.split(', ')[0]}, events: ${eventCountRef.current}`,
          }));
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtime({
            status: 'ok',
            summary: 'SUBSCRIBED, events: 0',
            rows: [{ k: 'channel state', v: 'SUBSCRIBED', tone: 'ok' }],
          });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtime({
            status: 'fail',
            summary: `Realtime: ${status}`,
            detail:
              'Did you ALTER PUBLICATION supabase_realtime ADD TABLE notifications? See migration 20260518400000.',
          });
        } else if (status === 'CLOSED') {
          setRealtime({ status: 'warn', summary: 'CLOSED' });
        }
      });

    channelRef.current = ch;
    return () => {
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await runAll();
    setRefreshing(false);
  }, [runAll]);

  const sections: Section[] = useMemo(
    () => [
      { id: 'auth', title: 'Authentication', icon: UserIcon, result: auth },
      { id: 'notif-schema', title: 'Notifications schema', icon: Bell, result: notifSchema },
      { id: 'notif-rls', title: 'Notifications RLS', icon: Database, result: notifRls },
      { id: 'contracts', title: 'Contracts views (GR2)', icon: FileText, result: contracts },
      { id: 'realtime', title: 'Realtime channel', icon: Radio, result: realtime },
    ],
    [auth, notifSchema, notifRls, contracts, realtime],
  );

  const overall: ProbeStatus = useMemo(() => {
    if (running) return 'pending';
    const states = sections.map((s) => s.result.status);
    if (states.includes('fail')) return 'fail';
    if (states.includes('warn')) return 'warn';
    if (states.every((s) => s === 'ok')) return 'ok';
    return 'pending';
  }, [running, sections]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ChevronLeft size={22} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Diagnostics</Text>
          <Text style={styles.headerSubtitle}>Sprint 1, Lane 4, Pre-flight</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => void runAll()}
          disabled={running}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          {running ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <RefreshCw size={18} color={COLORS.primary} />
          )}
        </TouchableOpacity>
      </View>

      {/* Overall banner */}
      <View style={[styles.overall, overallStyles[overall]]}>
        <StatusGlyph status={overall} size={18} />
        <Text style={[styles.overallText, { color: overallTextColor(overall) }]}>
          {overall === 'ok'
            ? 'All probes passing, mobile is aligned with web v3.'
            : overall === 'warn'
              ? 'Drift detected, see warnings below.'
              : overall === 'fail'
                ? 'Critical mismatch, see failures below.'
                : 'Probing live backend…'}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      >
        {sections.map((s) => (
          <SectionCard key={s.id} section={s} />
        ))}

        <View style={styles.footnote}>
          <Text style={styles.footnoteText}>
            Read-only diagnostics. No writes are issued from this screen.
          </Text>
          <Text style={styles.footnoteText}>
            User: {user?.email ?? '(anonymous)'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({ section }: { section: Section }) {
  const { icon: Icon, result, title } = section;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.cardIconWrap, { backgroundColor: `${statusColor(result.status)}1A` }]}>
            <Icon size={18} color={statusColor(result.status)} />
          </View>
          <Text style={styles.cardTitle}>{title}</Text>
        </View>
        <StatusGlyph status={result.status} size={16} />
      </View>

      <Text style={[styles.cardSummary, { color: statusColor(result.status) }]}>
        {result.summary}
      </Text>

      {result.detail && (
        <Text style={styles.cardDetail} numberOfLines={4}>
          {result.detail}
        </Text>
      )}

      {result.rows && result.rows.length > 0 && (
        <View style={styles.rows}>
          {result.rows.map((r, i) => (
            <View key={`${r.k}-${i}`} style={styles.row}>
              <Text style={styles.rowKey}>{r.k}</Text>
              <Text
                style={[
                  styles.rowVal,
                  r.tone === 'ok' && { color: COLORS.green },
                  r.tone === 'warn' && { color: COLORS.amber },
                  r.tone === 'fail' && { color: COLORS.red },
                  r.tone === 'dim' && { color: COLORS.textMuted },
                ]}
                numberOfLines={2}
              >
                {r.v}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function StatusGlyph({ status, size }: { status: ProbeStatus; size: number }) {
  if (status === 'ok') return <CheckCircle2 size={size} color={COLORS.green} />;
  if (status === 'warn') return <AlertTriangle size={size} color={COLORS.amber} />;
  if (status === 'fail') return <XCircle size={size} color={COLORS.red} />;
  return <ActivityIndicator size="small" color={COLORS.primary} />;
}

function statusColor(status: ProbeStatus): string {
  switch (status) {
    case 'ok':
      return COLORS.green;
    case 'warn':
      return COLORS.amber;
    case 'fail':
      return COLORS.red;
    default:
      return COLORS.textDim;
  }
}

function overallTextColor(status: ProbeStatus): string {
  return statusColor(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const overallStyles = StyleSheet.create({
  pending: {
    borderColor: 'rgba(177,84,240,0.3)',
    backgroundColor: 'rgba(177,84,240,0.08)',
  },
  ok: {
    borderColor: 'rgba(46,213,115,0.3)',
    backgroundColor: 'rgba(46,213,115,0.06)',
  },
  warn: {
    borderColor: 'rgba(255,165,2,0.3)',
    backgroundColor: 'rgba(255,165,2,0.06)',
  },
  fail: {
    borderColor: 'rgba(255,71,87,0.3)',
    backgroundColor: 'rgba(255,71,87,0.06)',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    marginTop: 1,
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.primary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  // Overall banner
  overall: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  overallText: { flex: 1, fontSize: 13, fontWeight: '600' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 32 },

  // Card
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    marginBottom: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: COLORS.text, letterSpacing: 0.2 },
  cardSummary: { marginTop: 4, fontSize: 13, fontWeight: '600' },
  cardDetail: { marginTop: 4, fontSize: 11, color: COLORS.textMuted, lineHeight: 16 },

  // Key/value rows
  rows: { marginTop: 10, gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowKey: {
    flexShrink: 0,
    minWidth: 110,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textDim,
    letterSpacing: 0.3,
  },
  rowVal: {
    flex: 1,
    textAlign: 'right',
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.text,
    fontFamily: 'Menlo',
  },

  // Footnote
  footnote: { marginTop: 8, paddingHorizontal: 4 },
  footnoteText: { fontSize: 11, color: COLORS.textMuted, marginTop: 2 },
});
