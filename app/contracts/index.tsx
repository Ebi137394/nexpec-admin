// app/contracts/index.tsx
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  NEXPEC — Smart Contracts Hub  (Pro upgrade)
//
//  • Real digital signature pad   → SignaturePadModal
//  • Real file upload (Storage)   → expo-document-picker → bucket "contracts"
//  • In-app contract editor       → ContractEditorModal
//  • Real-time updates over Supabase Realtime
//  • Haptic feedback on every binding action
//  • All press feedback is transform-based so layout animations
//    (FadeInDown) never fight an opacity style — kills the
//    "Property opacity may be overwritten" reanimated warning.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import React, {
  useEffect,
  useId,
  useState,
  useMemo,
  useCallback,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Image,
  StatusBar,
  Alert,
  Linking,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { fetchMyNativeSpineContracts, type NativeSpineContract } from '@/src/hooks/useSupplierEcosystem';
import { formatUsd as fmtUsdSpine } from '@/src/core/utils/money';
import { nxHandle } from '@/src/core/utils/handle';
import RNAnimated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { signedUrl } from '@/src/core/storage/signedUrls';
import {
  ArrowLeft,
  FilePlus,
  Link2,
  Edit3,
  PenLine,
  Upload,
  CheckCircle2,
  ChevronRight,
  ShieldCheck,
  ExternalLink,
  Eye,
  Download,
  Building2,
  Sparkles,
  BadgeCheck,
  XCircle,
  Hourglass,
  FileText,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import { useAuth } from '@/src/contexts/AuthContext';

import SignaturePadModal from './_components/SignaturePadModal';
import ContractEditorModal from './_components/ContractEditorModal';

// ─────────────────────────────────────────────────────────────
//  BRAND
// ─────────────────────────────────────────────────────────────
const C = {
  bg: '#020420',
  primary: '#7C3AED',
  primaryDeep: '#5B21B6',
  primaryBright: '#9333EA',
  primaryGlow: 'rgba(124, 58, 237, 0.22)',

  cyan: '#00FFFF',
  cyanGlow: 'rgba(0, 255, 255, 0.16)',
  cyanBorder: 'rgba(0, 255, 255, 0.30)',

  surfaceElev: '#0A0E2E',
  surfaceCard: '#0E1438',
  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(124, 58, 237, 0.32)',

  text: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  textDim: '#475569',

  success: '#10F995',
  warning: '#F59E0B',
  danger: '#EF4444',
  pink: '#F472B6',
};

const SCREEN_W = Dimensions.get('window').width;
const HPAD = 20;
const TABS_PADDING = 4;
const TAB_W = (SCREEN_W - HPAD * 2 - TABS_PADDING * 2) / 3;

// ─────────────────────────────────────────────────────────────
//  TYPES
// ─────────────────────────────────────────────────────────────
type ContractStatus =
  | 'draft'
  | 'pending_signature'
  | 'active'
  | 'completed'
  | 'cancelled';

type TabKey = 'pending' | 'active' | 'completed';

interface ProfileLite {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  company_name?: string | null;
  role?: string | null;
}

interface Contract {
  id: string;
  job_id?: string | null;
  client_id: string;
  contractor_id: string;
  status: ContractStatus | string;
  total_amount_cents?: number | null;     // ★ Task 4
  contract_text?: string | null;
  document_url?: string | null;
  external_link?: string | null;
  client_signature?: string | null;
  contractor_signature?: string | null;
  client_signed_at?: string | null;
  contractor_signed_at?: string | null;
  signed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  job?: { id: string; title?: string | null } | null;
  client?: ProfileLite | null;
  contractor?: ProfileLite | null;
  // ── V3 SYNC ───────────────────────────────────────────────────────
  //  When true, this Contract was projected from inspector_job_contracts_view
  //  (the blind-pricing-safe view introduced by web migration
  //  20260518370000). Signing/uploading these is gated to the web
  //  portal — mobile only READS them. See handleSign for the gate.
  //  We never store the source row's client_price_cents here because
  //  the SELECT below doesn't reference that column (GR2 — blind pricing).
  _isJobContract?: boolean;
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'pending',   label: 'Pending' },
  { key: 'active',    label: 'Active' },
  { key: 'completed', label: 'Completed' },
];

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────
// ★ Task 4: input is integer CENTS — divide by 100 first.
const formatMoney = (cents?: number | null): string => {
  if (cents == null || !Number.isFinite(Number(cents))) return '$0';
  const v = Number(cents) / 100;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${Math.round(v).toLocaleString()}`;
};

const initialsFor = (name?: string | null): string => {
  if (!name) return '○';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '○';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const formatTimeAgo = (iso?: string | null): string => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
};

const statusMeta = (s?: string | null) => {
  switch (s) {
    case 'draft':
      return { label: 'Draft', color: C.textMuted, icon: Edit3 };
    case 'pending_signature':
      return { label: 'Pending Signature', color: C.warning, icon: Hourglass };
    // V3 sub-states from job_contracts state machine (web migration
    // 20260518370000). Different labels so the inspector knows whether
    // they OR the client need to act.
    case 'pending_client_signature':
      return { label: 'Awaiting Client', color: C.warning, icon: Hourglass };
    case 'pending_inspector_signature':
      return { label: 'Your Signature', color: C.warning, icon: Hourglass };
    case 'active':
      return { label: 'Active', color: C.success, icon: BadgeCheck };
    // ★ Treat 'signed' and 'in_progress' visually like 'active' so System A
    //   contracts (Sign Job Agreement) render correctly in the Hub.
    case 'signed':
      return { label: 'Signed', color: C.success, icon: BadgeCheck };
    case 'in_progress':
      return { label: 'In Progress', color: C.success, icon: BadgeCheck };
    case 'fully_executed':
      return { label: 'Executed', color: C.success, icon: BadgeCheck };
    case 'completed':
      return { label: 'Completed', color: C.cyan, icon: CheckCircle2 };
    case 'cancelled':
      return { label: 'Cancelled', color: C.danger, icon: XCircle };
    default:
      return { label: 'Pending', color: C.textMuted, icon: Hourglass };
  }
};

/**
 * Project a row from `inspector_job_contracts_view` into the legacy
 * Contract shape used by the Hub. We do NOT touch the UI — instead we
 * adapt the data so the same render path applies.
 *
 * Critical: `total_amount_cents` is mapped from `inspector_payout_cents`.
 * The view never exposes `client_price_cents`, so the inspector seeing
 * this Hub never accidentally learns the client-side price. GR2 is
 * enforced at the projection layer above and at the DB view layer.
 */
function mapJobContractViewRow(r: {
  id: string;
  job_id: string | null;
  inspector_id: string;
  client_id: string;
  status: string | null;
  inspector_payout_cents: number | null;
  contract_text_md: string | null;
  client_signed_at: string | null;
  inspector_signed_at: string | null;
  inspector_signed_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}): Contract {
  return {
    // Prefix the id so it can never collide with a legacy contracts.id.
    // The card's keyExtractor uses this id; nothing else depends on
    // its exact shape.
    id: `jc:${r.id}`,
    job_id: r.job_id,
    client_id: r.client_id,
    contractor_id: r.inspector_id,
    status: (r.status ?? 'pending_signature') as string,
    // INSPECTOR-SAFE money. Web's inspector_job_contracts_view enforces
    // this projection at the DB layer; we honor it here.
    total_amount_cents: r.inspector_payout_cents ?? null,
    contract_text: r.contract_text_md ?? null,
    document_url: null,
    external_link: null,
    // V3 tracks signers as a typed name string. Surface the inspector
    // name as a stable truthy marker so the SigPiece shows "Signed".
    // The client side isn't exposed via this view's projection (the
    // view omits client_signed_name from the inspector projection on
    // purpose — inspector only needs to know the client signed, not
    // who typed); a non-null client_signed_at means signed.
    client_signature: r.client_signed_at ? '__signed__' : null,
    contractor_signature: r.inspector_signed_name ?? null,
    client_signed_at: r.client_signed_at,
    contractor_signed_at: r.inspector_signed_at,
    signed_at: r.inspector_signed_at ?? r.client_signed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    // job.title is fetched separately in the Hub via a second query
    // (the view doesn't expose it). Until that merge lands we show
    // the existing "Standalone agreement" fallback.
    job: r.job_id ? { id: r.job_id, title: null } : null,
    client: null,
    contractor: null,
    _isJobContract: true,
  };
}

/**
 * Project a row from `client_job_contracts_view` into the legacy Contract
 * shape. Mirror of mapJobContractViewRow for the BUYER side.
 *
 * Critical: `total_amount_cents` is mapped from `client_price_cents` —
 * the buyer's OWN budget, which they are allowed to see on their own
 * contracts. The view never exposes inspector_payout_cents, so the buyer
 * never accidentally learns the inspector's payout. GR2 enforced at the
 * projection layer (this row never carries the opposing key) and at the
 * DB view layer (column-level RLS).
 *
 * Used by the Hub fetcher when role ∈ { client, agency, enterprise }.
 */
function mapClientJobContractViewRow(r: {
  id: string;
  job_id: string | null;
  inspector_id: string | null;
  client_id: string;
  status: string | null;
  client_price_cents: number | null;
  contract_text_md: string | null;
  client_signed_at: string | null;
  client_signed_name: string | null;
  inspector_signed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}): Contract {
  return {
    // Same `jc:` prefix as the inspector mapper so the Hub keyExtractor
    // never collides with legacy contracts.id.
    id: `jc:${r.id}`,
    job_id: r.job_id,
    client_id: r.client_id,
    contractor_id: r.inspector_id ?? '',
    status: (r.status ?? 'pending_signature') as string,
    // BUYER-SAFE money. client_job_contracts_view exposes the caller's
    // own client_price_cents and nothing on the inspector payout side.
    total_amount_cents: r.client_price_cents ?? null,
    contract_text: r.contract_text_md ?? null,
    document_url: null,
    external_link: null,
    // V3 tracks signers as typed name strings. Surface the client's
    // typed name (the buyer's own signature) and a stable truthy
    // marker for the inspector side when they've signed. The inspector
    // typed name isn't projected by the client view — that's by design,
    // the buyer only needs to know the inspector signed, not what they
    // typed. A non-null inspector_signed_at means signed.
    client_signature: r.client_signed_name ?? null,
    contractor_signature: r.inspector_signed_at ? '__signed__' : null,
    client_signed_at: r.client_signed_at,
    contractor_signed_at: r.inspector_signed_at,
    signed_at: r.client_signed_at ?? r.inspector_signed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
    // job.title hydrated by the Hub's batch fetch (same code path as
    // the inspector mapper).
    job: r.job_id ? { id: r.job_id, title: null } : null,
    client: null,
    contractor: null,
    _isJobContract: true,
  };
}

const tabContains = (tab: TabKey, status?: string | null): boolean => {
  switch (tab) {
    case 'pending':
      // V3 (web migration 20260518370000) introduces two pending sub-states.
      // Both belong in the Pending lane — the inspector wants to see them
      // whether THEY need to sign or the client does.
      return (
        status === 'draft' ||
        status === 'pending_signature' ||
        status === 'pending_client_signature' ||
        status === 'pending_inspector_signature'
      );
    case 'active':
      // ★ System A (Sign Job Agreement) writes status='signed' on insert.
      //   Treat 'signed' and 'in_progress' as live/active so freshly-signed
      //   contracts land in the Active tab instead of disappearing.
      //   V3 'fully_executed' joins the same lane.
      return (
        status === 'active' ||
        status === 'signed' ||
        status === 'in_progress' ||
        status === 'fully_executed'
      );
    case 'completed':
      return status === 'completed' || status === 'cancelled';
  }
};

const counterpartFor = (
  contract: Contract,
  meIsClient: boolean,
): ProfileLite | null =>
  meIsClient ? contract.contractor ?? null : contract.client ?? null;

const counterpartLabel = (meIsClient: boolean): string =>
  meIsClient ? 'Inspector' : 'Client';

const roleColor = (role?: string | null): string => {
  const r = (role || '').toLowerCase();
  if (r.includes('inspector')) return C.primary;
  if (r.includes('client')) return '#3B82F6';
  if (r.includes('agency')) return C.success;
  return C.textMuted;
};

// ─────────────────────────────────────────────────────────────
//  Brokered-spine legs folded into the unified Contracts hub.
// ─────────────────────────────────────────────────────────────
function SpineHeader({
  legs,
  router,
}: {
  legs: NativeSpineContract[];
  router: ReturnType<typeof useRouter>;
}) {
  if (!legs || legs.length === 0) return null;
  const go = (sp: NativeSpineContract) => {
    if (sp.kind === 'client_supply' && sp.dealId) router.push(`/deals/${sp.dealId}/sign` as any);
    else router.push(`/contracts/agreement/${sp.contractId}` as any);
  };
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }}>
      <Text style={{ color: '#A78BFA', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 10 }}>
        TURNKEY (BROKERED) CONTRACTS
      </Text>
      <View style={{ gap: 10 }}>
        {legs.map((sp) => {
          const tone = sp.signable ? '#7C3AED' : sp.status === 'executed' ? '#10F995' : '#F59E0B';
          const label = sp.signable ? 'SIGN NOW' : sp.status === 'executed' ? 'EXECUTED' : sp.status.toUpperCase();
          const title =
            sp.kind === 'inspector_engagement'
              ? 'Inspector Engagement'
              : sp.kind === 'client_supply'
                ? 'Supply & Inspection Agreement'
                : 'Supplier Supply Agreement';
          return (
            <Pressable
              key={sp.contractId}
              onPress={() => go(sp)}
              style={({ pressed }) => [
                { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#0B1138', borderColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderRadius: 16, padding: 14 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>{title}</Text>
                <Text numberOfLines={1} style={{ color: '#A8B2C7', fontSize: 12, marginTop: 2 }}>{fmtUsdSpine(sp.amountCents)}</Text>
              </View>
              <View style={{ backgroundColor: tone + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ color: tone, fontSize: 10, fontWeight: '800' }}>{label}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
//  SCREEN
// ─────────────────────────────────────────────────────────────
export default function ContractsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, role } = useAuth() as any;
  const [spineLegs, setSpineLegs] = useState<NativeSpineContract[]>([]);

  // ★ Historically the codebase had two parallel auth providers
  //   (`providers/AuthProvider` shim + `src/contexts/AuthContext` canonical).
  //   They could disagree on hydration timing → this Hub's filter
  //   `eq('contractor_id', user.id)` would silently miss freshly-written
  //   rows. AUTH-DUAL-001 retired the shim, but we keep the defensive
  //   uid resolution below because supabase.auth.getUser() returns
  //   exactly what RLS evaluates as auth.uid() — that's the strongest
  //   guarantee of match across read/write sites and is worth the extra
  //   round trip.
  const [authUid, setAuthUid] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setAuthUid(data.user?.id ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);
  const userId: string | null = user?.id ?? authUid;

  const userRole = useMemo(
    () => String(role || user?.user_metadata?.role || '').toLowerCase(),
    [role, user],
  );
  const isClientRole = userRole === 'client';

  // Fold the brokered-spine legs into this unified Contracts hub (mirrors web).
  useEffect(() => {
    let on = true;
    const kind = userRole === 'inspector' ? 'inspector_engagement' : 'client_supply';
    fetchMyNativeSpineContracts(kind).then((r) => { if (on) setSpineLegs(r); }).catch(() => {});
    return () => { on = false; };
  }, [userRole]);

  // ── Data state ──
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('pending');

  // ── Modal state ──
  const [signTarget, setSignTarget] = useState<Contract | null>(null);
  const [editorTarget, setEditorTarget] = useState<Contract | null>(null);

  // ── Upload state (per-contract) ──
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  // ── Animated tab indicator ──
  const indicatorTx = useSharedValue(0);
  useEffect(() => {
    const idx = TABS.findIndex((t) => t.key === activeTab);
    indicatorTx.value = withSpring(idx * TAB_W, {
      damping: 18,
      stiffness: 220,
    });
  }, [activeTab, indicatorTx]);
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorTx.value }],
  }));

  // ── Data fetch ──
  const fetchContracts = useCallback(async () => {
    // If auth state is still hydrating, stay in loading without an error.
    // The "Not signed in" red banner only appears once we know definitively
    // there's no user, not on the first paint.
    if (userId === null && user === undefined) return;
    if (!userId) {
      setLoading(false);
      return;
    }
    try {
      setError(null);
      const filterCol = isClientRole ? 'client_id' : 'contractor_id';

      // ── 1) Legacy `contracts` table — DECOMMISSIONED ──
      //
      //   The V1 `public.contracts` table is no longer the source of truth
      //   for the Hub. As of the V3 cutover, this Hub renders ONLY rows
      //   from the V3 blind-pricing views (`inspector_job_contracts_view`
      //   / `client_job_contracts_view`).
      //
      //   The legacy table is kept in the database for audit history,
      //   but is never surfaced here — preventing the "two contracts per
      //   job" duplicate that occurred when both stacks were live in
      //   parallel.
      //
      //   To inspect legacy rows, see the web admin surface at
      //   /admin/contracts (read-only archive).
      //
      //   keep the binding so the Promise.all destructure below stays
      //   shaped the same; resolves to an empty result.
      const legacyPromise: Promise<{ data: Contract[] | null; error: any | null }> =
        Promise.resolve({ data: [], error: null });
      // Silence unused-variable lint while the surrounding code refers
      // to filterCol (V3 fetcher branches on role just below).
      void filterCol;

      // ── 2) V3 job_contracts (binding per-job agreement, blind pricing) ──
      //
      //   Web migration 20260518370000 ships TWO projected views over
      //   the job_contracts base table, each with column-level RLS that
      //   guarantees GR2 (Strict price visibility):
      //
      //     • inspector_job_contracts_view  →  inspector_payout_cents
      //                                       (no client_price_cents)
      //     • client_job_contracts_view     →  client_price_cents
      //                                       (no inspector_payout_cents)
      //     • job_contracts base table      →  admin-only at row level
      //
      //   Sync-bug fix 2026-05-20: the previous version of this fetcher
      //   only queried inspector_job_contracts_view, so signed-in
      //   client / agency / enterprise buyers saw an empty Hub even
      //   when they had live V3 contracts on the web. We now branch on
      //   role and hit the matching view. All three buyer roles share
      //   the same view (RLS filter is `client_id = auth.uid()`).
      //
      //   The projections below never name the opposing side's price
      //   column — that's the wire-layer GR2 enforcement.
      const isInspectorRole = userRole === 'inspector';
      const isBuyerRole =
        userRole === 'client' ||
        userRole === 'agency' ||
        userRole === 'enterprise';

      let viewPromise: Promise<{ data: any[] | null; error: any | null }>;
      if (isInspectorRole) {
        // inspector_job_contracts_view columns (no client_price_cents):
        //   id, job_id, application_id, client_id, inspector_id,
        //   inspector_payout_cents, status,
        //   contract_text_md, custom_contract_url,
        //   client_signed_at,
        //   inspector_signed_at, inspector_signed_name,
        //   voided_at, voided_reason, created_at, updated_at
        viewPromise = supabase
          .from('inspector_job_contracts_view')
          .select(
            [
              'id',
              'job_id',
              'inspector_id',
              'client_id',
              'status',
              'inspector_payout_cents',
              'contract_text_md',
              'client_signed_at',
              'inspector_signed_at',
              'inspector_signed_name',
              'created_at',
              'updated_at',
            ].join(', '),
          )
          .eq('inspector_id', userId)
          .order('updated_at', { ascending: false })
          .limit(100) as unknown as Promise<{ data: any[] | null; error: any | null }>;
      } else if (isBuyerRole) {
        // client_job_contracts_view columns (no inspector_payout_cents):
        //   id, job_id, application_id, client_id, inspector_id,
        //   client_price_cents, status,
        //   contract_text_md, custom_contract_url,
        //   client_signed_at, client_signed_name,
        //   inspector_signed_at,
        //   voided_at, voided_reason, created_at, updated_at
        //
        // Filter is `client_id = userId`. The view's row-level RLS
        // also enforces this (client_id = auth.uid() OR nx_is_admin()),
        // so the eq() is defense-in-depth, not a security gate.
        viewPromise = supabase
          .from('client_job_contracts_view')
          .select(
            [
              'id',
              'job_id',
              'inspector_id',
              'client_id',
              'status',
              'client_price_cents',
              'contract_text_md',
              'client_signed_at',
              'client_signed_name',
              'inspector_signed_at',
              'created_at',
              'updated_at',
            ].join(', '),
          )
          .eq('client_id', userId)
          .order('updated_at', { ascending: false })
          .limit(100) as unknown as Promise<{ data: any[] | null; error: any | null }>;
      } else {
        // Unknown role (admin / super_admin / null). Skip the v3 branch —
        // admins have their own surfaces; legacy contracts still render.
        viewPromise = Promise.resolve({ data: null, error: null });
      }

      const [legacyRes, viewRes] = await Promise.all([legacyPromise, viewPromise]);

      if (legacyRes.error) throw legacyRes.error;
      const legacyRows = (legacyRes.data ?? []) as Contract[];

      // The view query may be a no-op for unknown roles; tolerate either
      // shape and never let a view error break the legacy fetch.
      let viewRows: Contract[] = [];
      if (viewRes && !viewRes.error && Array.isArray(viewRes.data)) {
        // Dispatch to the right mapper. Inspector rows carry
        // inspector_payout_cents + inspector_signed_name; buyer rows
        // carry client_price_cents + client_signed_name. Each mapper
        // ONLY reads the keys that exist on its side — neither mapper
        // even type-accesses the opposing side's price column, so
        // there's no GR2 leak even if a malformed row somehow contained
        // both keys.
        const mapper = isInspectorRole
          ? mapJobContractViewRow
          : mapClientJobContractViewRow;
        viewRows = viewRes.data.map((r: any) => mapper(r));

        // The views don't include job_title (it lives on jobs). One small
        // batch fetch wires it in so the card shows the real job name
        // instead of "Standalone agreement".
        const jobIds = Array.from(
          new Set(viewRows.map((r) => r.job_id).filter(Boolean)),
        ) as string[];
        if (jobIds.length > 0) {
          const { data: jobRows, error: jobErr } = await supabase
            .from('jobs')
            .select('id, title')
            .in('id', jobIds);
          if (!jobErr && Array.isArray(jobRows)) {
            const titleById = new Map<string, string | null>();
            for (const j of jobRows as Array<{ id: string; title: string | null }>) {
              titleById.set(j.id, j.title);
            }
            viewRows = viewRows.map((r) =>
              r.job_id
                ? { ...r, job: { id: r.job_id, title: titleById.get(r.job_id) ?? null } }
                : r,
            );
          }
        }

        // ── Counterparty profile hydration ─────────────────────────────
        //
        //   The blind-pricing views (client_job_contracts_view +
        //   inspector_job_contracts_view) don't embed profile data — they
        //   only expose the COUNTERPARTY id. Without this batch hydration
        //   the Hub renders the generic "Inspector" / "Client" fallback
        //   label and a default avatar, even when the real profile
        //   exists. Mirrors the relational join the LEGACY contracts
        //   fetcher above already does inline.
        //
        //   System rule reminder: the inspector's user_id is referenced
        //   on `jobs` as `contractor_id`. After this mapper runs, the
        //   Contract row's `contractor_id` field holds that same UUID
        //   (mapped from view.inspector_id). Profile lookup is always
        //   `profiles.id IN (...)` — `profiles.id` is the user_id, and
        //   the contractor_id / inspector_id / client_id columns all
        //   reference it.
        //
        //   For inspector-role viewers, we hydrate the CLIENT profile
        //   (the counterparty). For buyer-role viewers, we hydrate the
        //   CONTRACTOR (inspector) profile. Both fetches are RLS-safe:
        //   the `profiles_authenticated_select_any` policy lets any
        //   signed-in user read public name + avatar of any profile.
        // ★ ANTI-POACHING (Hybrid Pseudonymous): ONLY inspector-role viewers
        //   hydrate the counterparty (CLIENT) profile. A BUYER (client / agency
        //   / enterprise) must NEVER receive the inspector's real name or photo,
        //   so we skip the fetch entirely and render the deterministic NX- handle
        //   (nxHandle) instead — see counterName in ContractCard. The real
        //   identity is revealed only via the paid Named-Disclosure unlock.
        if (isInspectorRole) {
          const counterpartyIds = Array.from(
            new Set(viewRows.map((r) => r.client_id).filter(Boolean)),
          ) as string[];
          if (counterpartyIds.length > 0) {
            const { data: profileRows, error: profileErr } = await supabase
              .from('profiles')
              .select('id, full_name, avatar_url, company_name, role')
              .in('id', counterpartyIds);
            if (!profileErr && Array.isArray(profileRows)) {
              const profileById = new Map<string, ProfileLite>();
              for (const p of profileRows as Array<ProfileLite & { id: string }>) {
                profileById.set(p.id, p);
              }
              viewRows = viewRows.map((r) =>
                r.client_id ? { ...r, client: profileById.get(r.client_id) ?? null } : r,
              );
            } else if (profileErr) {
              console.warn('[contracts] counterparty profile hydration failed:', profileErr.message);
            }
          }
        }
      } else if (viewRes && viewRes.error) {
        // The view might not be deployed in this environment yet (e.g.
        // dev pointing at a pre-v3 DB). Log it loudly but don't fail the
        // page — legacy rows still render.
        const which = isInspectorRole
          ? 'inspector_job_contracts_view'
          : 'client_job_contracts_view';
        console.warn(
          `[contracts] ${which} unavailable:`,
          (viewRes.error as { message?: string }).message,
        );
      }

      // Merge — view rows first (newest signing flow takes top), then legacy.
      // Sort by updated_at desc so the Hub always shows the freshest activity.
      const merged = [...viewRows, ...legacyRows].sort((a, b) => {
        const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return tb - ta;
      });
      setContracts(merged);
    } catch (err: any) {
      console.log('contracts fetch error:', err);
      setError(err?.message ?? 'Failed to load contracts');
    } finally {
      setLoading(false);
    }
  }, [userId, user, isClientRole, userRole]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      await fetchContracts();
      if (!alive) return;
    })();
    return () => {
      alive = false;
    };
  }, [fetchContracts]);

  // Realtime — refetch on any insert/update we can read.
  // Listen to BOTH the legacy `contracts` table and the v3 `job_contracts`
  // base table. Note: the base table is admin-only at row level, but
  // Realtime publication events fire regardless of RLS (the consumer
  // filter is up to us). The downstream fetchContracts() call hits the
  // inspector view, so we never leak base-table column values into the
  // wire payload.
  const channelId = useId();
  useRealtimeSubscription({
    channelName: `contracts:${userId ?? 'anon'}:${channelId}`,
    bindings: [
      { event: '*', table: 'contracts' },
      { event: '*', table: 'job_contracts' },
    ],
    onChange: () => fetchContracts(),
    onDesync: () => fetchContracts(),
    enabled: !!userId,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchContracts();
    setRefreshing(false);
  }, [fetchContracts]);

  // ── Derived ──
  const counts = useMemo(
    () => ({
      pending: contracts.filter((c) => tabContains('pending', c.status)).length,
      active: contracts.filter((c) => tabContains('active', c.status)).length,
      completed: contracts.filter((c) => tabContains('completed', c.status))
        .length,
    }),
    [contracts],
  );

  const visible = useMemo(
    () => contracts.filter((c) => tabContains(activeTab, c.status)),
    [contracts, activeTab],
  );

  // ── Nav helpers ──
  const safeNav = useCallback(
    (path: string) => {
      try {
        router.push(path as any);
      } catch (e) {
        console.log('nav error', e);
      }
    },
    [router],
  );

  const handleViewJob = useCallback(
    (contract: Contract) => {
      if (contract.job_id) safeNav(`/jobs/${contract.job_id}`);
    },
    [safeNav],
  );

  const handleOpenDocument = useCallback(
    async (contract: Contract) => {
      try {
        // V3 job-contract rows route to the premium signing surface —
        // it shows the 3-step timeline, the blind-pricing card, and
        // the typed-name sign panel. The screen accepts the `jc:`
        // prefix in the id and strips it on its end.
        if (contract._isJobContract) {
          router.push(`/contracts/job/${contract.id}` as any);
          return;
        }
        if (contract.external_link) {
          await Linking.openURL(contract.external_link);
          return;
        }
        if (contract.document_url) {
          const url = await signedUrl({ bucket: 'contracts', path: contract.document_url, ttl: 3600 });
          if (url) await Linking.openURL(url);
          return;
        }
        // ★ No file/link attached — common for digitally-signed Job Agreements.
        //   Open the contract detail page so the user can read the terms,
        //   see the signature, dates, and job info instead of hitting a
        //   "Nothing to open" dead end.
        router.push(`/contracts/${contract.id}` as any);
      } catch (e: any) {
        Alert.alert('Cannot open', e?.message ?? 'The contract document is not accessible.');
      }
    },
    [router],
  );

  // ── REAL upload — DocumentPicker + Supabase Storage ──
  const handleUploadFile = useCallback(
    async (contract: Contract) => {
      // V3 job_contracts don't accept addenda uploads via this Hub —
      // those go through the web admin surface. Block the upload to
      // avoid silently writing a document_url update against a contract
      // id that no longer exists in the legacy `contracts` table.
      if (contract._isJobContract) {
        Alert.alert(
          'Manage on the web',
          'Job-contract documents are managed by the admin team on the web portal.',
        );
        return;
      }
      try {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/*', 'application/msword',
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const file = result.assets[0];

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        setUploadingId(contract.id);

        const sanitized = encodeURIComponent(file.name);
        const path = `documents/${contract.id}/${Date.now()}_${sanitized}`;

        const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        const fileBytes = decode(base64);

        const { error: uploadErr } = await supabase.storage
          .from('contracts')
          .upload(path, fileBytes, {
            contentType: file.mimeType || 'application/octet-stream',
            upsert: false,
          });
        if (uploadErr) throw uploadErr;

        const { error: rowErr } = await supabase
          .from('contracts')
          .update({ document_url: path })
          .eq('id', contract.id);
        if (rowErr) throw rowErr;

        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
        Alert.alert('Uploaded ✓', `${file.name} attached to this contract.`);
        fetchContracts();
      } catch (e: any) {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Error,
        ).catch(() => {});
        Alert.alert(
          'Upload failed',
          e?.message ??
            'Could not upload the document. Make sure the contracts storage bucket exists.',
        );
      } finally {
        setUploadingId(null);
      }
    },
    [fetchContracts],
  );

  const handleAddLink = useCallback((_contract: Contract) => {
    // `/contracts/[id]/link` was never built — pushing it fell into the [id]
    // catch-all and dead-ended. Until an external-link editor ships, say so
    // honestly instead of navigating nowhere. Upload PDF / Fill Manually
    // remain the working paths.
    Alert.alert(
      'Coming Soon',
      'Linking an external contract (DocuSign, Adobe Sign, Google Drive, Dropbox) is not available yet. You can upload the PDF or fill the contract in-app instead.',
    );
  }, []);

  const handleFillManually = useCallback(
    (contract: Contract) => setEditorTarget(contract),
    [],
  );

  const handleSign = useCallback(
    (contract: Contract) => {
      if (!userId) return;
      // V3 job_contracts have their own premium signing surface at
      // /contracts/job/[id]. That screen reads from the blind-pricing
      // views, shows the 3-step signature timeline, and wires Sign &
      // record directly to the SECURITY DEFINER RPCs (mobile parity
      // 2026-05-20). The `_isJobContract` rows came from the Hub merge
      // and carry the `jc:` id prefix, which the signing screen accepts
      // and strips on its end.
      if (contract._isJobContract) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        router.push(`/contracts/job/${contract.id}` as any);
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setSignTarget(contract);
    },
    [userId, router],
  );

  // ── Loading ──
  if (loading) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View pointerEvents="none" style={s.glowTopLeft} />
        <View pointerEvents="none" style={s.glowMidRight} />
        <SafeAreaView style={s.flex1} edges={['top']}>
          <View style={s.loadingCenter}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={s.loadingText}>LOADING CONTRACTS HUB…</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View pointerEvents="none" style={s.glowTopLeft} />
      <View pointerEvents="none" style={s.glowMidRight} />
      <View pointerEvents="none" style={s.glowBottom} />

      <SafeAreaView style={s.flex1} edges={['top']}>
        {/* HEADER */}
        <View style={s.header}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              s.iconBtn,
              pressed && { transform: [{ scale: 0.92 }] },
            ]}
            hitSlop={8}
          >
            <ArrowLeft size={20} color={C.text} />
          </Pressable>

          <View style={s.headerCenter}>
            <Text style={s.headerKicker}>SMART CONTRACTS</Text>
            <View style={s.headerTitleRow}>
              <Text style={s.headerTitle}>Hub</Text>
              <View style={s.headerBadge}>
                <ShieldCheck size={10} color={C.cyan} />
                <Text style={s.headerBadgeText}>SECURE</Text>
              </View>
            </View>
          </View>

          {/* ★ Drafting custom agreements is a CLIENT/AGENCY action — they
                attach addenda or custom company contracts to a job they
                posted. Inspectors don't draft contracts; they sign the
                Job Agreement (System A) when hired, and that row appears
                in this Hub's Active tab via the tabContains patch. So the
                + button is hidden for the inspector role. */}
          {userRole !== 'inspector' && (
            <Pressable
              onPress={() => safeNav('/contracts/create')}
              style={({ pressed }) => [
                s.iconBtn,
                pressed && { transform: [{ scale: 0.92 }] },
              ]}
              hitSlop={8}
            >
              <FilePlus size={18} color={C.cyan} />
            </Pressable>
          )}
        </View>

        {/* SUMMARY STRIP */}
        <View style={s.summary}>
          <SummaryPiece
            icon={<Hourglass size={13} color={C.warning} />}
            value={String(counts.pending)}
            label="Awaiting"
            color={C.warning}
          />
          <View style={s.summaryDivider} />
          <SummaryPiece
            icon={<BadgeCheck size={13} color={C.success} />}
            value={String(counts.active)}
            label="Active"
            color={C.success}
          />
          <View style={s.summaryDivider} />
          <SummaryPiece
            icon={<CheckCircle2 size={13} color={C.cyan} />}
            value={String(counts.completed)}
            label="Closed"
            color={C.cyan}
          />
        </View>

        {/* TABS */}
        <View style={s.tabsContainer}>
          <RNAnimated.View
            style={[s.tabIndicator, { width: TAB_W }, indicatorStyle]}
          />
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            const count = counts[tab.key];
            return (
              <Pressable
                key={tab.key}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => {});
                  setActiveTab(tab.key);
                }}
                style={[s.tabBtn, { width: TAB_W }]}
              >
                <Text
                  style={[s.tabLabel, active && s.tabLabelActive]}
                  numberOfLines={1}
                >
                  {tab.label}
                </Text>
                <View style={[s.tabBadge, active && s.tabBadgeActive]}>
                  <Text
                    style={[s.tabBadgeText, active && s.tabBadgeTextActive]}
                  >
                    {count}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* ERROR */}
        {error ? (
          <View style={s.errorBanner}>
            <Text style={s.errorText}>{error}</Text>
            <Pressable onPress={onRefresh} hitSlop={6}>
              <Text style={s.errorRetry}>RETRY</Text>
            </Pressable>
          </View>
        ) : null}

        {/* LIST */}
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={<SpineHeader legs={spineLegs} router={router} />}
          renderItem={({ item, index }) => (
            <ContractCard
              contract={item}
              index={index}
              userId={userId}
              uploading={uploadingId === item.id}
              onUploadFile={() => handleUploadFile(item)}
              onAddLink={() => handleAddLink(item)}
              onFillManually={() => handleFillManually(item)}
              onSign={() => handleSign(item)}
              onOpenDocument={() => handleOpenDocument(item)}
              onViewJob={() => handleViewJob(item)}
            />
          )}
          contentContainerStyle={[
            s.listContent,
            { paddingBottom: insets.bottom + 32 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.primary}
              progressBackgroundColor={C.surfaceElev}
              colors={[C.primary]}
            />
          }
          ListEmptyComponent={() => (
            <View style={s.empty}>
              <View style={s.emptyIconWrap}>
                <Sparkles size={26} color={C.primary} />
              </View>
              <Text style={s.emptyTitle}>
                {activeTab === 'pending'
                  ? 'No contracts awaiting'
                  : activeTab === 'active'
                  ? 'No active engagements'
                  : 'No closed contracts'}
              </Text>
              <Text style={s.emptySub}>
                {activeTab === 'pending'
                  ? 'Contracts waiting for either party to sign will land here.'
                  : activeTab === 'active'
                  ? 'Once both parties sign, the deal will live here.'
                  : 'Your contract history will appear in this lane.'}
              </Text>
            </View>
          )}
        />
      </SafeAreaView>

      {/* MODALS */}
      <SignaturePadModal
        visible={!!signTarget}
        contract={signTarget}
        userId={userId}
        onClose={() => setSignTarget(null)}
        onSigned={fetchContracts}
      />
      <ContractEditorModal
        visible={!!editorTarget}
        contract={editorTarget}
        onClose={() => setEditorTarget(null)}
        onSaved={fetchContracts}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
//  SUBCOMPONENTS
// ─────────────────────────────────────────────────────────────

const SummaryPiece = ({
  icon,
  value,
  label,
  color,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  color: string;
}) => (
  <View style={s.summaryPiece}>
    <View style={[s.summaryIcon, { backgroundColor: color + '1F' }]}>
      {icon}
    </View>
    <View style={{ flex: 1 }}>
      <Text style={s.summaryValue}>{value}</Text>
      <Text style={s.summaryLabel}>{label}</Text>
    </View>
  </View>
);

const ContractCard = ({
  contract,
  index,
  userId,
  uploading,
  onUploadFile,
  onAddLink,
  onFillManually,
  onSign,
  onOpenDocument,
  onViewJob,
}: {
  contract: Contract;
  index: number;
  userId: string | null;
  uploading: boolean;
  onUploadFile: () => void;
  onAddLink: () => void;
  onFillManually: () => void;
  onSign: () => void;
  onOpenDocument: () => void;
  onViewJob: () => void;
}) => {
  const meIsClient = userId === contract.client_id;
  const counterpart = counterpartFor(contract, meIsClient);
  // ★ ANTI-POACHING: a buyer never sees the inspector's real name on a Hub card,
  //   only the deterministic NX- handle (matches the assigned-inspector card +
  //   web). Inspectors keep seeing their client counterparty's name.
  const counterName =
    meIsClient
      ? nxHandle(contract.contractor_id)
      : counterpart?.full_name ||
        counterpart?.company_name ||
        counterpartLabel(meIsClient);
  const counterRole = counterpart?.role || counterpartLabel(meIsClient);
  const counterColor = roleColor(counterRole);
  const meta = statusMeta(contract.status);

  const mySignature = meIsClient
    ? contract.client_signature
    : contract.contractor_signature;
  const theirSignature = meIsClient
    ? contract.contractor_signature
    : contract.client_signature;

  const hasFile = !!contract.document_url;
  const hasLink = !!contract.external_link;
  const hasDraft = !!contract.contract_text;

  const isPendingLane =
    contract.status === 'draft' ||
    contract.status === 'pending_signature';
  const isActiveLane = contract.status === 'active';

  const StatusIcon = meta.icon;

  // Indeterminate upload progress shimmer
  const uploadShimmer = useSharedValue(0);
  useEffect(() => {
    if (uploading) {
      uploadShimmer.value = 0;
      uploadShimmer.value = withRepeat(
        withTiming(1, { duration: 1100 }),
        -1,
        false,
      );
    } else {
      uploadShimmer.value = 0;
    }
  }, [uploading, uploadShimmer]);
  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: uploadShimmer.value * 240 - 80,
      },
    ],
  }));

  return (
    <RNAnimated.View
      entering={FadeInDown.delay(80 * Math.min(index, 5)).duration(400)}
    >
      <View style={s.card}>
        <LinearGradient
          colors={['rgba(124, 58, 237, 0.08)', 'rgba(0, 255, 255, 0.04)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />

        {/* Top — counterpart + status */}
        <View style={s.cardTopRow}>
          <View style={s.cardCounter}>
            {counterpart?.avatar_url ? (
              <Image
                source={{ uri: counterpart.avatar_url }}
                style={s.cardAvatar}
              />
            ) : (
              <View
                style={[
                  s.cardAvatar,
                  s.cardAvatarFallback,
                  { backgroundColor: counterColor + '33' },
                ]}
              >
                <Text style={s.cardAvatarText}>
                  {initialsFor(counterName)}
                </Text>
              </View>
            )}
            <View style={s.cardCounterInfo}>
              {/* ★ Tiny disambiguator — without this label the big name
                    + CLIENT pill looked like "the client signed this",
                    when actually the inspector is viewing their own
                    contract WITH that client. */}
              <Text style={s.cardCounterCaption}>Contract with</Text>
              <Text style={s.cardCounterName} numberOfLines={1}>
                {counterName}
              </Text>
              <View style={s.cardCounterMetaRow}>
                <View
                  style={[
                    s.rolePill,
                    {
                      backgroundColor: counterColor + '22',
                      borderColor: counterColor + '55',
                    },
                  ]}
                >
                  <Text style={[s.rolePillText, { color: counterColor }]}>
                    {String(counterRole).toUpperCase()}
                  </Text>
                </View>
                <Text style={s.cardUpdated}>
                  {formatTimeAgo(contract.updated_at || contract.created_at)}
                </Text>
              </View>
            </View>
          </View>

          <View
            style={[
              s.statusPill,
              {
                backgroundColor: meta.color + '1F',
                borderColor: meta.color + '55',
              },
            ]}
          >
            <StatusIcon size={11} color={meta.color} />
            <Text style={[s.statusText, { color: meta.color }]}>
              {meta.label}
            </Text>
          </View>
        </View>

        {/* Job + amount */}
        <View style={s.cardMidRow}>
          <Pressable
            onPress={onViewJob}
            disabled={!contract.job_id}
            style={s.cardJobWrap}
          >
            <Building2 size={13} color={C.textMuted} />
            <Text style={s.cardJobText} numberOfLines={1}>
              {contract.job?.title || 'Standalone agreement'}
            </Text>
            {contract.job_id ? (
              <ChevronRight size={12} color={C.textMuted} />
            ) : null}
          </Pressable>
          {/* ★ The amount is the VIEWER'S OWN figure: a buyer (client / agency /
                enterprise) sees their own client_price_cents (their payable
                total); an inspector sees their own agreed payout. The price-blind
                views + role-branched fetch mean neither side ever receives the
                other's number, so showing the buyer their own total is safe, and
                masking it only blinded them to their own invoice. Labelled so it
                is unambiguously their cost, not the inspector's payout. */}
          {meIsClient ? (
            <View style={s.cardAmountMasked}>
              <Text style={s.cardAmountMaskedText}>Your Total Cost</Text>
              <Text style={s.cardAmount}>{formatMoney(contract.total_amount_cents)}</Text>
            </View>
          ) : (
            <Text style={s.cardAmount}>{formatMoney(contract.total_amount_cents)}</Text>
          )}
        </View>

        {/* Content state chips */}
        <View style={s.contentChips}>
          <ContentChip
            icon={<FileText size={11} color={hasFile ? C.cyan : C.textMuted} />}
            label="File"
            active={hasFile}
            color={C.cyan}
          />
          <ContentChip
            icon={<Link2 size={11} color={hasLink ? C.primary : C.textMuted} />}
            label="Link"
            active={hasLink}
            color={C.primary}
          />
          <ContentChip
            icon={<Edit3 size={11} color={hasDraft ? C.pink : C.textMuted} />}
            label="Manual"
            active={hasDraft}
            color={C.pink}
          />
        </View>

        {/* Signature row — now with thumbnail when signed */}
        <View style={s.sigRow}>
          <SigPiece
            label={meIsClient ? 'You (Client)' : 'You'}
            signed={!!mySignature}
            signedAt={
              meIsClient
                ? contract.client_signed_at
                : contract.contractor_signed_at
            }
            signatureUri={mySignature}
          />
          <View style={s.sigDivider} />
          <SigPiece
            label={counterName.split(' ')[0] || 'Counterparty'}
            signed={!!theirSignature}
            signedAt={
              meIsClient
                ? contract.contractor_signed_at
                : contract.client_signed_at
            }
            signatureUri={theirSignature}
            // ★ Our canonical workflow only requires the inspector to sign
            //   the Job Agreement. The client side is finalized by the
            //   admin's Confirm & Dispatch — there is no client signature
            //   step. Showing "Awaiting signature" forever was misleading.
            //   This label is honest about the workflow.
            waitingLabel={meIsClient ? undefined : 'Confirmed via admin dispatch'}
          />
        </View>

        {/* Upload progress shimmer */}
        {uploading ? (
          <View style={s.uploadBar}>
            <RNAnimated.View style={[s.uploadShimmer, shimmerStyle]}>
              <LinearGradient
                colors={['transparent', C.cyan, 'transparent']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={StyleSheet.absoluteFill}
              />
            </RNAnimated.View>
            <Text style={s.uploadText}>Uploading document…</Text>
          </View>
        ) : null}

        {/* Actions */}
        {isPendingLane ? (
          <>
            <View style={s.actionRowSmall}>
              <SmallActionButton
                icon={<Upload size={14} color={C.cyan} />}
                label="Upload File"
                color={C.cyan}
                onPress={onUploadFile}
                disabled={uploading}
              />
              <SmallActionButton
                icon={<Link2 size={14} color={C.primary} />}
                label="Add Link"
                color={C.primary}
                onPress={onAddLink}
              />
              <SmallActionButton
                icon={<Edit3 size={14} color={C.pink} />}
                label="Fill Manually"
                color={C.pink}
                onPress={onFillManually}
              />
            </View>
            <Pressable
              onPress={onSign}
              disabled={!!mySignature}
              style={({ pressed }) => [
                s.signCta,
                !!mySignature && s.signCtaDone,
                pressed && { transform: [{ scale: 0.99 }] },
              ]}
            >
              {!mySignature ? (
                <LinearGradient
                  colors={[C.primary, C.primaryBright, C.primaryDeep]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              ) : null}
              {!!mySignature ? (
                <CheckCircle2 size={16} color={C.success} />
              ) : (
                <PenLine size={16} color="#FFFFFF" />
              )}
              <Text
                style={[
                  s.signCtaText,
                  !!mySignature && { color: C.success },
                ]}
              >
                {!!mySignature
                  ? theirSignature
                    ? 'Both parties signed'
                    : 'Awaiting counterparty'
                  : 'Sign Digitally'}
              </Text>
            </Pressable>
          </>
        ) : isActiveLane ? (
          <View style={s.actionRowSmall}>
            <SmallActionButton
              icon={<Eye size={14} color={C.cyan} />}
              label="View"
              color={C.cyan}
              onPress={onOpenDocument}
              flex={1.4}
            />
            <SmallActionButton
              icon={<Download size={14} color={C.primary} />}
              label="Download"
              color={C.primary}
              onPress={onOpenDocument}
              flex={1}
            />
            <SmallActionButton
              icon={<ExternalLink size={14} color={C.pink} />}
              label="Job"
              color={C.pink}
              onPress={onViewJob}
              flex={1}
            />
          </View>
        ) : (
          <View style={s.actionRowSmall}>
            <SmallActionButton
              icon={<Eye size={14} color={C.cyan} />}
              label="View"
              color={C.cyan}
              onPress={onOpenDocument}
              flex={1}
            />
            <SmallActionButton
              icon={<Download size={14} color={C.primary} />}
              label="Download"
              color={C.primary}
              onPress={onOpenDocument}
              flex={1}
            />
          </View>
        )}
      </View>
    </RNAnimated.View>
  );
};

const ContentChip = ({
  icon,
  label,
  active,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  color: string;
}) => (
  <View
    style={[
      s.contentChip,
      active
        ? { backgroundColor: color + '14', borderColor: color + '50' }
        : { backgroundColor: 'rgba(255,255,255,0.02)', borderColor: C.border },
    ]}
  >
    {icon}
    <Text
      style={[
        s.contentChipText,
        active ? { color } : { color: C.textMuted },
      ]}
    >
      {label}
    </Text>
  </View>
);

const SigPiece = ({
  label,
  signed,
  signedAt,
  signatureUri,
  waitingLabel,
}: {
  label: string;
  signed: boolean;
  waitingLabel?: string;
  signedAt?: string | null;
  signatureUri?: string | null;
}) => (
  <View style={s.sigPiece}>
    <View
      style={[
        s.sigDot,
        { backgroundColor: signed ? C.success : C.textDim },
      ]}
    />
    <View style={{ flex: 1, minWidth: 0 }}>
      <Text style={s.sigLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={s.sigSub} numberOfLines={1}>
        {signed
          ? `Signed ${formatTimeAgo(signedAt) || 'recently'}`
          : waitingLabel || 'Awaiting signature'}
      </Text>
    </View>
    {signed && signatureUri ? (
      <Image
        source={{ uri: signatureUri }}
        style={s.sigThumb}
        resizeMode="contain"
      />
    ) : null}
  </View>
);

const SmallActionButton = ({
  icon,
  label,
  color,
  onPress,
  flex = 1,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onPress: () => void;
  flex?: number;
  disabled?: boolean;
}) => (
  <Pressable
    onPress={onPress}
    disabled={disabled}
    style={({ pressed }) => [
      s.smallActionBtn,
      { borderColor: color + '38', flex },
      disabled && { opacity: 0.5 },
      pressed && !disabled && { transform: [{ scale: 0.97 }] },
    ]}
  >
    <LinearGradient
      colors={[color + '1F', color + '06']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
    {icon}
    <Text
      style={[s.smallActionLabel, { color }]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.85}
    >
      {label}
    </Text>
  </Pressable>
);

// ─────────────────────────────────────────────────────────────
//  STYLES
// ─────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  flex1: { flex: 1 },

  glowTopLeft: {
    position: 'absolute',
    top: -160, left: -120,
    width: 360, height: 360, borderRadius: 200,
    backgroundColor: C.primary, opacity: 0.20,
  },
  glowMidRight: {
    position: 'absolute',
    top: 280, right: -140,
    width: 320, height: 320, borderRadius: 200,
    backgroundColor: C.cyan, opacity: 0.06,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -200, left: -60,
    width: 380, height: 380, borderRadius: 200,
    backgroundColor: C.primary, opacity: 0.08,
  },

  loadingCenter: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14,
  },
  loadingText: {
    color: C.textMuted, fontSize: 11, letterSpacing: 1.4, fontWeight: '700',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: HPAD,
    paddingTop: 8,
    paddingBottom: 12,
  },
  iconBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.surfaceElev,
    borderWidth: 1, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerKicker: {
    color: C.cyan, fontSize: 9, fontWeight: '800',
    letterSpacing: 1.6, marginBottom: 2,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: {
    color: C.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.4,
  },
  headerBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 7, paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: C.cyanGlow,
    borderWidth: 1, borderColor: C.cyanBorder,
  },
  headerBadgeText: {
    color: C.cyan, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8,
  },

  summary: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: HPAD,
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: C.surfaceElev,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 12,
  },
  summaryPiece: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  summaryIcon: {
    width: 26, height: 26, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  summaryValue: {
    color: C.text, fontSize: 15, fontWeight: '800', letterSpacing: -0.2,
  },
  summaryLabel: {
    color: C.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 0.4,
  },
  summaryDivider: {
    width: 1, height: 26, backgroundColor: C.border, marginHorizontal: 6,
  },

  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: HPAD,
    padding: TABS_PADDING,
    borderRadius: 14,
    backgroundColor: C.surfaceElev,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 14,
    position: 'relative',
  },
  tabIndicator: {
    position: 'absolute',
    top: TABS_PADDING, bottom: TABS_PADDING, left: TABS_PADDING,
    borderRadius: 10,
    backgroundColor: C.primary,
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.5, shadowRadius: 8,
    elevation: 4,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    borderRadius: 10,
  },
  tabLabel: { color: C.textSecondary, fontSize: 13, fontWeight: '700' },
  tabLabelActive: { color: '#FFFFFF' },
  tabBadge: {
    minWidth: 22, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center', justifyContent: 'center',
  },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  tabBadgeText: {
    color: C.textSecondary, fontSize: 11, fontWeight: '800',
  },
  tabBadgeTextActive: { color: '#FFFFFF' },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: HPAD, marginBottom: 12,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
    borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.40)',
  },
  errorText: { flex: 1, color: C.danger, fontSize: 12, fontWeight: '600' },
  errorRetry: { color: C.danger, fontSize: 11, fontWeight: '800', letterSpacing: 1 },

  listContent: {
    paddingHorizontal: HPAD,
    paddingTop: 4,
  },

  // Card
  card: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: C.surfaceElev,
    borderWidth: 1, borderColor: C.border,
    marginBottom: 14,
    overflow: 'hidden',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 10,
  },
  cardCounter: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0,
  },
  cardAvatar: { width: 44, height: 44, borderRadius: 22 },
  cardAvatarFallback: { alignItems: 'center', justifyContent: 'center' },
  cardAvatarText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  cardCounterInfo: { flex: 1, minWidth: 0 },
  cardCounterCaption: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  cardCounterName: {
    color: C.text, fontSize: 15, fontWeight: '700', marginBottom: 4,
  },
  cardCounterMetaRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  rolePill: {
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 6, borderWidth: 1,
  },
  rolePillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  cardUpdated: { color: C.textMuted, fontSize: 11 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1,
  },
  statusText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  cardMidRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
  },
  cardJobWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  cardJobText: {
    flex: 1, color: C.textSecondary, fontSize: 13, fontWeight: '500',
  },
  cardAmount: {
    color: C.cyan, fontSize: 18, fontWeight: '800', letterSpacing: -0.3,
  },
  // Price-blind mask shown to buyer-party viewers in place of the amount.
  cardAmountMasked: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  cardAmountMaskedText: {
    color: C.textMuted, letterSpacing: 1,
  },

  contentChips: {
    flexDirection: 'row', gap: 6, marginBottom: 14,
  },
  contentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 5,
    borderRadius: 8, borderWidth: 1,
  },
  contentChipText: {
    fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4,
  },

  sigRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderWidth: 1, borderColor: C.border,
    marginBottom: 14,
  },
  sigPiece: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  sigDivider: {
    width: 1, height: 38, backgroundColor: C.border, marginHorizontal: 8,
  },
  sigDot: { width: 8, height: 8, borderRadius: 4 },
  sigLabel: { color: C.text, fontSize: 12, fontWeight: '700' },
  sigSub: {
    color: C.textMuted, fontSize: 10.5, fontWeight: '500', marginTop: 1,
  },
  sigThumb: {
    width: 56, height: 28,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },

  // Upload progress shimmer
  uploadBar: {
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 255, 255, 0.06)',
    borderWidth: 1, borderColor: C.cyanBorder,
    marginBottom: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadShimmer: {
    position: 'absolute',
    top: 0, bottom: 0, width: 80,
  },
  uploadText: {
    color: C.cyan, fontSize: 11, fontWeight: '800', letterSpacing: 1,
  },

  actionRowSmall: {
    flexDirection: 'row', gap: 8, marginBottom: 10,
  },
  smallActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9, paddingHorizontal: 8,
    borderRadius: 11,
    borderWidth: 1,
    overflow: 'hidden',
  },
  smallActionLabel: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.3 },

  signCta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8,
    paddingVertical: 13, paddingHorizontal: 16,
    borderRadius: 13,
    overflow: 'hidden',
    shadowColor: C.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 10,
    elevation: 6,
  },
  signCtaDone: {
    backgroundColor: 'rgba(16, 249, 149, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 249, 149, 0.4)',
    shadowOpacity: 0,
    elevation: 0,
  },
  signCtaText: {
    color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.2,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: 60, paddingHorizontal: 32,
    backgroundColor: C.surfaceElev,
    borderRadius: 20,
    borderWidth: 1, borderColor: C.border,
    borderStyle: 'dashed',
    marginTop: 8,
  },
  emptyIconWrap: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: C.primaryGlow,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    color: C.text, fontSize: 15, fontWeight: '700', marginBottom: 6,
  },
  emptySub: {
    color: C.textMuted, fontSize: 12, lineHeight: 17, textAlign: 'center',
  },
});
