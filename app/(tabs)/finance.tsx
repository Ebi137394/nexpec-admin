import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, SafeAreaView, StatusBar, Animated, Dimensions, Alert, RefreshControl, Platform, ActivityIndicator, Modal, Pressable, KeyboardAvoidingView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useStripe } from '@stripe/stripe-react-native';
// ★ Stripe Connect onboarding redirects via the device browser; we use
//   openAuthSessionAsync so the OS-level "auth session" presentation
//   lets Stripe's hosted onboarding redirect us back into the app.
import * as WebBrowser from 'expo-web-browser';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Rect, Defs, LinearGradient as SvgGrad, Stop, Text as SvgText, Line } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../src/contexts/AuthContext';
import { useEarnings, formatUSD } from '../../hooks/useEarnings';
import { formatDuration } from '../../utils/currency';
import { formatUsd, toCents } from '../../src/core/utils/money';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLORS = { background: '#020420', surface: '#0F172A', surfaceLight: '#1E293B', border: '#1F2937', borderLight: '#334155', primary: '#7C3AED', primaryLight: '#8B5CF6', primaryDark: '#6D28D9', primaryBg: 'rgba(124, 58, 237, 0.12)', blue: '#3B82F6', blueBg: 'rgba(59, 130, 246, 0.12)', green: '#10B981', greenBg: 'rgba(16, 185, 129, 0.12)', red: '#EF4444', redBg: 'rgba(239, 68, 68, 0.12)', amber: '#F59E0B', amberBg: 'rgba(245, 158, 11, 0.12)', cyan: '#06B6D4', cyanBg: 'rgba(6, 182, 212, 0.12)', white: '#F8FAFC', textPrimary: '#F1F5F9', textSecondary: '#94A3B8', textMuted: '#64748B', textDark: '#475569' };

type UserRole = 'inspector' | 'client' | 'agency' | 'enterprise' | 'supplier';
interface Transaction { id: string; type: 'earning' | 'withdrawal' | 'deposit' | 'escrow' | 'refund' | 'fee' | 'payout'; amount: number; description: string; status: 'completed' | 'pending' | 'failed' | 'processing'; created_at: string; reference_id?: string; metadata?: Record<string, any>; }
interface PaymentMethod { id: string; type: 'bank_account' | 'card' | 'paypal' | 'wise' | 'payoneer' | 'stripe'; label: string; last4: string; is_default: boolean; brand?: string; bank_name?: string; status: 'active' | 'pending' | 'expired'; }
interface WalletStats { availableBalance: number; totalEarned: number; pendingAmount: number; escrowAmount: number; totalSpent: number; totalVolume: number; agencyRevenue: number; pendingPayouts: number; }
interface DbTransaction { id: string; type: string; amount: number; description: string; status: string; created_at: string; reference_id?: string; metadata?: any; }
interface DbPaymentMethod { id: string; type: string; label: string; last_four: string; is_default: boolean; brand?: string; bank_name?: string; status: string; }
interface PaymentProviderOption { id: string; name: string; icon: keyof typeof Ionicons.glyphMap; color: string; description: string; targetRole: 'all' | 'inspector' | 'client'; }

const DEFAULT_STATS: WalletStats = { availableBalance: 0, totalEarned: 0, pendingAmount: 0, escrowAmount: 0, totalSpent: 0, totalVolume: 0, agencyRevenue: 0, pendingPayouts: 0 };

const PAYMENT_PROVIDERS: PaymentProviderOption[] = [
  { id: 'stripe', name: 'Credit / Debit Card', icon: 'card-outline', color: '#635BFF', description: 'Powered by Stripe', targetRole: 'client' },
  // ★ Stripe Connect Express for inspector payouts. Stripe handles KYC,
  //   bank verification, multi-currency, and tax forms. Replaces the
  //   old manual 'bank' option that bounced users to the Withdraw form.
  { id: 'stripe_connect', name: 'Bank Account (Stripe)', icon: 'business-outline', color: COLORS.green, description: 'Verified by Stripe, instant USD payouts', targetRole: 'inspector' },
  { id: 'paypal', name: 'PayPal', icon: 'logo-paypal', color: '#0070BA', description: 'Connect PayPal account', targetRole: 'all' },
  { id: 'wise', name: 'Wise', icon: 'globe-outline', color: '#00B9FF', description: 'International transfer', targetRole: 'all' },
  { id: 'payoneer', name: 'Payoneer', icon: 'cash-outline', color: '#FF4800', description: 'Global payout method', targetRole: 'inspector' }
];

const formatCurrency = (amount: number) => formatUsd(toCents(Math.abs(amount)), { fractionDigits: 2 });
const getStatusColor = (status: string) => { switch (status) { case 'completed': return COLORS.green; case 'pending': case 'processing': return COLORS.amber; case 'failed': return COLORS.red; default: return COLORS.textMuted; } };
const getTransactionIcon = (type: string): keyof typeof Ionicons.glyphMap => { switch (type) { case 'earning': return 'arrow-down-circle'; case 'withdrawal': return 'arrow-up-circle'; case 'deposit': return 'add-circle'; case 'escrow': return 'lock-closed'; case 'refund': return 'refresh-circle'; case 'fee': return 'remove-circle'; case 'payout': return 'send'; default: return 'swap-horizontal'; } };
const getTransactionColor = (type: string) => { switch (type) { case 'earning': case 'deposit': case 'refund': return COLORS.green; case 'withdrawal': case 'fee': case 'payout': return COLORS.red; case 'escrow': return COLORS.amber; default: return COLORS.textMuted; } };
const formatDate = (dateStr: string) => { const d = new Date(dateStr); const now = new Date(); const diffMs = now.getTime() - d.getTime(); const diffMins = Math.floor(diffMs / 60000); const diffHrs = Math.floor(diffMs / 3600000); const diffDays = Math.floor(diffMs / 86400000); if (diffMins < 1) return 'Just now'; if (diffMins < 60) return `${diffMins}m ago`; if (diffHrs < 24) return `${diffHrs}h ago`; if (diffDays < 7) return `${diffDays}d ago`; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

const MiniStat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => ( <View style={s.miniStat}><Text style={s.miniStatLabel}>{label}</Text><Text style={[s.miniStatValue, { color }]}>{value}</Text></View> );
const MiniStatDivider = () => <View style={s.miniStatDivider} />;

// ★ Stripe Connect status pill — small visual indicator shown next to
//   the role badge for inspectors. Renders nothing if status is
//   'not_connected' (the +Add option already invites onboarding) or if
//   user isn't an inspector.
type StripeConnectState = { status: string; payouts_enabled: boolean };

const STRIPE_STATUS_DISPLAY: Record<string, {
  label: string;
  color: string;
  bg: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = {
  verified: { label: 'Stripe Verified', color: '#10B981', bg: 'rgba(16,185,129,0.12)', icon: 'checkmark-circle' },
  pending: { label: 'Setup Pending', color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', icon: 'time' },
  restricted: { label: 'Action Needed', color: '#EF4444', bg: 'rgba(239,68,68,0.12)', icon: 'warning' },
  disabled: { label: 'Disconnected', color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', icon: 'close-circle' },
};

const BalanceHero: React.FC<{ stats: WalletStats; userRole: UserRole; stripeConnect: StripeConnectState; onWithdraw: () => void; onDeposit: () => void; }> = ({ stats, userRole, stripeConnect, onWithdraw, onDeposit }) => {
  const balanceAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.spring(balanceAnim, { toValue: 1, tension: 50, friction: 8, useNativeDriver: true }).start(); }, []);
  const roleLabel = userRole === 'inspector' ? 'Inspector'
    : userRole === 'client' ? 'Client'
    : userRole === 'enterprise' ? 'Enterprise'
    : userRole === 'supplier' ? 'Supplier'
    : 'Agency';
  const roleIcon: keyof typeof Ionicons.glyphMap = userRole === 'inspector' ? 'shield-checkmark'
    : userRole === 'client' ? 'briefcase'
    : userRole === 'enterprise' ? 'business-outline'
    : userRole === 'supplier' ? 'storefront-outline'
    : 'business';

  // Compute Stripe display from status — only show pill for inspectors
  // with a non-default status.
  const stripeDisplay =
    userRole === 'inspector' && stripeConnect.status !== 'not_connected'
      ? STRIPE_STATUS_DISPLAY[stripeConnect.status]
      : null;

  return (
    <View style={s.heroCard}>
      <LinearGradient colors={['rgba(124,58,237,0.18)', 'rgba(124,58,237,0.06)', 'transparent']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} />
      <View style={s.heroHeader}>
        <View>
          <Text style={s.heroLabel}>Available Balance</Text>
          <Animated.Text style={[ s.heroBalance, { opacity: balanceAnim, transform: [ { translateY: balanceAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) } ] } ]}>
            {formatCurrency(stats.availableBalance)}
          </Animated.Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <View style={s.roleBadge}><Ionicons name={roleIcon} size={14} color={COLORS.primary} /><Text style={s.roleText}>{roleLabel}</Text></View>
          {stripeDisplay && (
            <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: stripeDisplay.bg, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, gap: 4 }}>
              <Ionicons name={stripeDisplay.icon} size={11} color={stripeDisplay.color} />
              <Text style={{ fontSize: 10, fontWeight: '600', color: stripeDisplay.color, letterSpacing: 0.3 }}>{stripeDisplay.label}</Text>
            </View>
          )}
        </View>
      </View>
      {/* ★ FINANCE-FIELD-NAMING-001 — Render only the mini-stats backed
          by real schema. Pre-strike the inspector row exposed an "In
          Escrow" pill and the client/agency row exposed three pills
          ("In Escrow", "Total Spent", "Volume"), all hardcoded to 0 in
          fetchWalletStats because the underlying columns / tables do
          not exist in the live schema. Phantom zeros under suggestive
          labels mislead users into thinking the platform is tracking
          money it isn't.

          Inspector path: keep `Pending` (backed by inspector_earnings.
          pending_halalas) and `Total Earned` (backed by inspector_
          earnings.total_earned_halalas). Drop the unbacked "In Escrow".

          Client / Agency path: hide the row entirely — none of the
          three stats have backing schema. Once the broader wallet
          schema for clients/agencies lands (separate strike), restore
          the row with the same backed-only rule. */}
      {userRole === 'inspector' && (
        <View style={s.miniStatsRow}>
          <MiniStat label="Pending"      value={formatCurrency(stats.pendingAmount)} color={COLORS.amber} />
          <MiniStatDivider />
          <MiniStat label="Total Earned" value={formatCurrency(stats.totalEarned)}   color={COLORS.green} />
        </View>
      )}
      
      <View style={s.heroActions}>
        {userRole === 'inspector' && (
          <TouchableOpacity style={[s.heroBtn, s.heroBtnPrimary]} onPress={onWithdraw} activeOpacity={0.8}>
            <Ionicons name="arrow-up-circle" size={18} color="#FFF" />
            <Text style={s.heroBtnTextWhite}>Withdraw</Text>
          </TouchableOpacity>
        )}
        
        {(userRole === 'client' || userRole === 'agency' || userRole === 'enterprise') && (
          <TouchableOpacity style={[s.heroBtn, s.heroBtnOutline]} onPress={onDeposit} activeOpacity={0.8}>
            <Ionicons name="add-circle-outline" size={18} color={COLORS.primary} />
            <Text style={[s.heroBtnTextWhite, { color: COLORS.primary }]}>Deposit</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const PaymentMethodCard: React.FC<{ method: PaymentMethod; onSetDefault: (id: string) => void; onRemove: (id: string) => void; }> = ({ method, onSetDefault, onRemove }) => {
  let iconName: keyof typeof Ionicons.glyphMap = 'card-outline';
  let brandColor = COLORS.primary;

  if(method.type === 'paypal') { iconName = 'logo-paypal'; brandColor = '#0070BA'; }
  else if (method.type === 'bank_account') { iconName = 'business-outline'; brandColor = COLORS.green; }
  else if (method.type === 'stripe' || method.type === 'card' || method.type === 'visa') { iconName = 'card-outline'; brandColor = '#635BFF'; }
  else if (method.type === 'wise') { iconName = 'globe-outline'; brandColor = '#00B9FF'; }
  else if (method.type === 'payoneer') { iconName = 'cash-outline'; brandColor = '#FF4800'; }

  return (
    <View style={[s.methodCard, method.is_default && s.methodCardDefault]}>
      <View style={[s.methodIcon, { backgroundColor: `${brandColor}20` }]}><Ionicons name={iconName} size={22} color={brandColor} /></View>
      <View style={s.methodInfo}>
        <View style={s.methodLabelRow}><Text style={s.methodLabel}>{method.label}</Text>{method.is_default && ( <View style={s.defaultBadge}><Text style={s.defaultBadgeText}>Default</Text></View> )}</View>
        <Text style={s.methodLast4}>{method.type === 'bank_account' ? `Account ending in ${method.last4}` : `•••• ${method.last4}`}</Text>
      </View>
      <View style={s.methodActions}>
        {!method.is_default && ( <TouchableOpacity onPress={() => onSetDefault(method.id)} style={s.methodActionBtn}><Ionicons name="checkmark-circle-outline" size={20} color={COLORS.textMuted} /></TouchableOpacity> )}
        <TouchableOpacity onPress={() => onRemove(method.id)} style={s.methodActionBtn}><Ionicons name="trash-outline" size={18} color={COLORS.red} /></TouchableOpacity>
      </View>
    </View>
  );
};

const WalletTransactionItem: React.FC<{ tx: Transaction }> = ({ tx }) => {
  const isPositive = ['earning', 'deposit', 'refund'].includes(tx.type);
  const color = getTransactionColor(tx.type);
  const icon = getTransactionIcon(tx.type);
  return (
    <View style={s.txItem}>
      <View style={[s.txIcon, { backgroundColor: `${color}15` }]}><Ionicons name={icon} size={20} color={color} /></View>
      <View style={s.txInfo}>
        <Text style={s.txDesc} numberOfLines={1}>{tx.description}</Text>
        <View style={s.txMeta}><Text style={s.txDate}>{formatDate(tx.created_at)}</Text><View style={[s.txStatusDot, { backgroundColor: getStatusColor(tx.status) }]} /><Text style={[s.txStatus, { color: getStatusColor(tx.status) }]}>{(tx.status ?? '').charAt(0).toUpperCase() + (tx.status ?? '').slice(1)}</Text></View>
      </View>
      <Text style={[ s.txAmount, { color: isPositive ? COLORS.green : COLORS.textPrimary }, ]}>{isPositive ? '+' : '-'}{formatCurrency(tx.amount)}</Text>
    </View>
  );
};

const QuickStatCard: React.FC<{ icon: keyof typeof Ionicons.glyphMap; label: string; value: string; sub?: string; color: string; bgColor: string; }> = ({ icon, label, value, sub, color, bgColor }) => (
  <View style={[s.quickStatCard, { borderColor: `${color}20` }]}>
    <View style={[s.quickStatIcon, { backgroundColor: bgColor }]}><Ionicons name={icon} size={18} color={color} /></View>
    <Text style={s.quickStatValue}>{value}</Text>
    <Text style={s.quickStatLabel}>{label}</Text>
    {sub ? <Text style={[s.quickStatSub, { color }]}>{sub}</Text> : null}
  </View>
);

// ★ SVG-NAN-CRASH-001 — Bullet-proof numeric coercion for SVG props.
//   The Finance tab's GrowthChart was crashing the entire app with
//   `NSException` from `-[CALayer setPosition:]` (see iOS crash report)
//   when any element in `data[]` was NaN / undefined / null. The math
//   `val / maxVal * (chartH - 20)` propagates NaN straight into
//   `<Rect height={NaN}>`, which RNSVG hands to CALayer, which throws
//   because CALayer.setPosition rejects non-finite coordinates.
//
//   Three guards together make the chart crash-proof regardless of
//   upstream data quality:
//     1. `safeNum` — coerces any input to a finite number (0 fallback).
//        Applied to every value PULLED from the input array.
//     2. Sanitised `data[]` is used everywhere instead of the raw prop.
//     3. Every numeric attribute on every SVG primitive is wrapped
//        in `safeNum` as a defense-in-depth measure — even if the
//        math produces NaN through some other path, the final value
//        is forced to a finite number before it reaches CALayer.
const safeNum = (n: unknown, fallback = 0): number =>
  typeof n === 'number' && Number.isFinite(n) ? n : fallback;

const GrowthChart: React.FC<{ data: number[]; labels: string[] }> = ({ data, labels }) => {
  // Sanitise the entire input array up front.
  const safeData = (Array.isArray(data) ? data : []).map((v) => safeNum(v));
  const chartW = safeNum(SCREEN_WIDTH - 64, 320);
  const chartH = 160;
  const maxVal = Math.max(...safeData, 1); // safeData is all finite → max is finite
  const barCount = safeData.length || 1;
  const barW = safeNum(Math.min((chartW - (barCount - 1) * 8) / barCount, 40), 1);
  const barGap = safeNum((chartW - barW * barCount) / (barCount + 1), 0);
  return (
    <View style={s.chartWrap}>
      <Svg width={chartW} height={chartH + 30}>
        <Defs><SvgGrad id="finBarGrad" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={COLORS.primary} stopOpacity="1" /><Stop offset="1" stopColor={COLORS.primary} stopOpacity="0.35" /></SvgGrad></Defs>
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
          <Line
            key={`g${i}`}
            x1={0}
            y1={safeNum(chartH * (1 - pct))}
            x2={safeNum(chartW)}
            y2={safeNum(chartH * (1 - pct))}
            stroke={COLORS.border}
            strokeWidth={0.5}
            strokeDasharray="4,4"
          />
        ))}
        {safeData.map((val, i) => {
          const barH = safeNum(Math.max((val / maxVal) * (chartH - 20), 2), 2);
          const x = safeNum(barGap + i * (barW + barGap));
          const y = safeNum(chartH - barH);
          return (
            <React.Fragment key={`b${i}`}>
              <Rect x={x} y={y} width={safeNum(barW, 1)} height={safeNum(barH, 1)} rx={4} fill="url(#finBarGrad)" />
              <SvgText x={safeNum(x + barW / 2)} y={safeNum(chartH + 16)} fill={COLORS.textMuted} fontSize={10} textAnchor="middle">{labels[i] ?? ''}</SvgText>
              {val > 0 && (
                <SvgText x={safeNum(x + barW / 2)} y={safeNum(y - 6)} fill={COLORS.textSecondary} fontSize={9} textAnchor="middle">{formatUSD(val)}</SvgText>
              )}
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
};

const SmartBreakdownCard: React.FC<{ icon: keyof typeof Ionicons.glyphMap; label: string; amount: number; percentage: number; color: string; }> = ({ icon, label, amount, percentage, color }) => (
  <View style={s.breakdownRow}>
    <View style={s.breakdownLeft}><View style={[s.breakdownIcon, { backgroundColor: `${color}15` }]}><Ionicons name={icon} size={16} color={color} /></View><View><Text style={s.breakdownLabel}>{label}</Text><Text style={s.breakdownAmount}>{formatUSD(amount)}</Text></View></View>
    <View style={s.breakdownRight}><Text style={[s.breakdownPct, { color }]}>{percentage.toFixed(1)}%</Text><View style={s.breakdownBar}><View style={[ s.breakdownBarFill, { width: `${Math.min(percentage, 100)}%`, backgroundColor: color, }, ]} /></View></View>
  </View>
);

const TaxReserveCard: React.FC<{ totalEarned: number; taxRate?: number; }> = ({ totalEarned, taxRate = 0.25 }) => {
  const reserveAmount = totalEarned * taxRate;
  return (
    <View style={s.taxCard}>
      <View style={s.taxHeader}><View style={[s.taxIconWrap, { backgroundColor: COLORS.amberBg }]}><Ionicons name="calculator-outline" size={18} color={COLORS.amber} /></View><View style={{ flex: 1 }}><Text style={s.taxTitle}>Tax Reserve Estimate</Text><Text style={s.taxSub}>{(taxRate * 100).toFixed(0)}% of total earnings</Text></View><Text style={s.taxAmount}>{formatUSD(reserveAmount)}</Text></View>
      <Text style={s.taxDisclaimer}>This is an estimate only. Please consult your tax advisor.</Text>
    </View>
  );
};

const SectionHeader: React.FC<{ icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; color?: string; rightAction?: { label: string; onPress: () => void }; }> = ({ icon, title, subtitle, color = COLORS.primary, rightAction }) => (
  <View style={s.sectionHeader}>
    <View style={s.sectionHeaderLeft}><View style={[s.sectionIcon, { backgroundColor: `${color}15` }]}><Ionicons name={icon} size={18} color={color} /></View><View><Text style={s.sectionTitle}>{title}</Text>{subtitle ? ( <Text style={s.sectionSubtitle}>{subtitle}</Text> ) : null}</View></View>
    {rightAction && ( <TouchableOpacity onPress={rightAction.onPress} activeOpacity={0.7}><Text style={[s.sectionAction, { color }]}>{rightAction.label}</Text></TouchableOpacity> )}
  </View>
);

export default function FinanceScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [walletStats, setWalletStats] = useState<WalletStats>(DEFAULT_STATS);
  // ★ Stripe Connect onboarding state — used by BalanceHero to render
  //   the status pill. Populated by determineUserRole().
  const [stripeConnect, setStripeConnect] = useState<StripeConnectState>({
    status: 'not_connected',
    payouts_enabled: false,
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [userRole, setUserRole] = useState<UserRole>('inspector');
  const [walletLoading, setWalletLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showAddPaymentModal, setShowAddPaymentModal] = useState(false);
  const [showProviderForm, setShowProviderForm] = useState<PaymentProviderOption | null>(null);
  const [providerInputValue, setProviderInputValue] = useState('');

  const earnings = useEarnings();
  const scrollY = useRef(new Animated.Value(0)).current;

  const determineUserRole = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      // ★ Pull stripe_connect_* fields alongside role so we can render
      //   the status pill in BalanceHero. One query, no extra round-trip.
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, stripe_connect_status, stripe_connect_payouts_enabled')
        .eq('id', session.user.id)
        .single();
      if (profile?.role) {
        // Enterprise is a first-class role on mobile (no longer aliased to agency).
        setUserRole(profile.role as UserRole);
      }
      if (profile?.stripe_connect_status) {
        setStripeConnect({
          status: profile.stripe_connect_status,
          payouts_enabled: !!profile.stripe_connect_payouts_enabled,
        });
      }
    } catch (err) { console.error('Error fetching role:', err); }
  }, [session?.user?.id]);

  const fetchWalletStats = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      // ★ WALLET-COLUMN-001 — Pre-strike this read targeted a `wallets` table
      //   that does NOT exist (no migration creates it) and read columns
      //   like `available_balance` that don't exist either. Result: every
      //   user saw $0.00 across the board.
      //
      //   The real earnings schema is `public.inspector_earnings`
      //   (supabase/migrations/20250219120000_create_earnings_tables.sql)
      //   with `_halalas` (cents-equivalent) BIGINT columns keyed on
      //   `inspector_id`. We:
      //     • SELECT only what exists,
      //     • use maybeSingle() so newly-signed-up users (no row yet) don't
      //       throw,
      //     • divide halalas by 100 at the boundary so the rest of the UI
      //       continues to operate in dollars.
      //
      //   Fields not yet backed by schema (escrow, totalSpent, totalVolume,
      //   agencyRevenue, pendingPayouts) are intentionally surfaced as 0
      //   until their backing tables/views land. BalanceHero will need a
      //   follow-up patch to hide the agency-only mini-stats when those
      //   columns remain absent — tracked as FINANCE-FIELD-NAMING-001.
      // ★ WALLET-SCHEMA-DRIFT-001 — Live DB column is `user_id`, not
      //   `inspector_id`. The on-disk migration
      //   (supabase/migrations/20250219120000_create_earnings_tables.sql)
      //   declares inspector_id; an out-of-band ALTER renamed the column
      //   without a corresponding migration file. Confirmed via
      //   information_schema.columns probe.
      const { data: earnings, error } = await supabase
        .from('inspector_earnings')
        .select(
          'available_balance_halalas, pending_halalas, total_earned_halalas',
        )
        .eq('user_id', session.user.id)
        .maybeSingle();
      if (error) throw error;

      setWalletStats({
        availableBalance: (earnings?.available_balance_halalas ?? 0) / 100,
        pendingAmount:    (earnings?.pending_halalas ?? 0) / 100,
        totalEarned:      (earnings?.total_earned_halalas ?? 0) / 100,
        // Fields below have no backing schema yet — explicit 0 (not a
        // misleading garbage value). Re-evaluate in the next financial
        // strike that introduces the missing columns.
        escrowAmount:    0,
        totalSpent:      0,
        totalVolume:     0,
        agencyRevenue:   0,
        pendingPayouts:  0,
      });
    } catch (err) { console.error('Error fetching wallet stats:', err); }
  }, [session?.user?.id]);

  const fetchTransactions = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const { data, error } = await supabase.from('transactions').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      if (data) { setTransactions( data.map((tx: DbTransaction) => ({ id: tx.id, type: tx.type as Transaction['type'], amount: tx.amount, description: tx.description, status: tx.status as Transaction['status'], created_at: tx.created_at, reference_id: tx.reference_id, metadata: tx.metadata, })), ); }
    } catch (err) { console.error('Error fetching transactions:', err); }
  }, [session?.user?.id]);

  const fetchPaymentMethods = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const { data, error } = await supabase.from('payment_methods').select('*').eq('user_id', session.user.id).order('is_default', { ascending: false });
      if (error) throw error;
      if (data) { setPaymentMethods( data.map((pm: DbPaymentMethod) => ({ id: pm.id, type: pm.type as PaymentMethod['type'], label: pm.label, last4: pm.last_four, is_default: pm.is_default, brand: pm.brand, bank_name: pm.bank_name, status: pm.status as PaymentMethod['status'], })), ); }
    } catch (err) { console.error('Error fetching payment methods:', err); }
  }, [session?.user?.id]);

  const loadAllData = useCallback(async () => {
    setWalletLoading(true);
    await Promise.all([ determineUserRole(), fetchWalletStats(), fetchTransactions(), fetchPaymentMethods(), ]);
    setWalletLoading(false);
  }, [determineUserRole, fetchWalletStats, fetchTransactions, fetchPaymentMethods]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadAllData(), earnings.refresh?.()]);
    setRefreshing(false);
  }, [loadAllData, earnings]);

  useFocusEffect( useCallback(() => { loadAllData(); }, [loadAllData]), );

  const handleWithdraw = useCallback(async () => {
    // NX-STRIPE-004: automated Stripe Connect payouts are DISABLED. All
    // withdrawals now go through the manual flow — the withdraw form enqueues
    // request_withdrawal (reserves Available → pending_payouts), and an admin
    // settles it in the Treasury Control Tower (admin_mark_withdrawal_paid).
    // No client-initiated Stripe egress.
    if (!session?.user?.id) {
      Alert.alert('Not signed in', 'Please sign in again to withdraw.');
      return;
    }
    router.push('/(inspector)/wallet/withdraw');
  }, [session?.user?.id]);

  // 🌟 تابع ذخیره متدهای غیر از استرایپ (پی‌پال، بانک، وایز) تو دیتابیس
  const handleSaveProviderDetail = async () => {
    if (!providerInputValue.trim()) {
      Alert.alert('Required', 'Please enter your account details.');
      return;
    }
    setActionLoading(true);
    try {
      const newMethod = {
        user_id: session?.user?.id,
        type: showProviderForm?.id === 'bank' ? 'bank_account' : showProviderForm?.id,
        label: showProviderForm?.name,
        last_four: providerInputValue.slice(-4).padStart(4, '*'),
        is_default: paymentMethods.length === 0,
        status: 'active',
        metadata: { account_detail: providerInputValue }
      };

      const { error } = await supabase.from('payment_methods').insert([newMethod]);
      if (error) throw error;

      Alert.alert('Success', `${showProviderForm?.name} added successfully!`);
      setShowProviderForm(null);
      setProviderInputValue('');
      await fetchPaymentMethods();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save payment method.');
    } finally {
      setActionLoading(false);
    }
  };

  // ★ WALLET-DEPOSIT-001 — Re-enables the wallet top-up flow.
  //
  //   The legacy handler called `create-payment-intent` with a client-
  //   supplied `{ amount }`. That endpoint was hardened (STRIPE-003/004)
  //   to require a `{ job_id }` — top-ups have no job, so the flow was
  //   gated. This re-build wires through a dedicated Edge Function:
  //
  //     create-wallet-deposit-intent
  //         ├─ verifies the caller is an inspector (auth + role)
  //         ├─ validates amount_halalas (100 ≤ x ≤ 1,000,000)
  //         ├─ mints a Stripe PaymentIntent with metadata.kind='wallet_topup'
  //         └─ returns { clientSecret, ... }
  //
  //   The stripe-payments-webhook then routes payment_intent.succeeded
  //   events with that metadata into the wallet_credit_topup RPC, which
  //   increments inspector_earnings.available_balance_halalas atomically
  //   and writes a transactions row + audit event.
  //
  //   UI surface preserved: same Alert.prompt entry, same Payment Sheet
  //   flow, same success copy — only the network calls change.
  const handleDeposit = useCallback(async () => {
    if (Platform.OS !== 'ios') {
      Alert.alert('Deposit', 'Deposit flow will open.');
      return;
    }
    Alert.prompt(
      'Deposit Funds',
      'Enter amount in USD:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async (amountStr) => {
            const amountSar = parseFloat(amountStr || '0');
            if (isNaN(amountSar) || amountSar <= 0) {
              Alert.alert('Invalid Amount', 'Please enter a valid amount.');
              return;
            }
            const amountHalalas = Math.round(amountSar * 100);
            if (amountHalalas < 100 || amountHalalas > 1_000_000) {
              Alert.alert(
                'Out of range',
                'Deposit must be between $1 and $10,000 USD.',
              );
              return;
            }

            setActionLoading(true);
            try {
              // 1. Mint a wallet-topup PaymentIntent server-side.
              const { data, error: apiError } = await supabase.functions.invoke(
                'create-wallet-deposit-intent',
                { body: { amount_halalas: amountHalalas } },
              );
              if (apiError) {
                const fnErr =
                  (apiError as any).context?.error ?? (apiError as any).message;
                throw new Error(
                  typeof fnErr === 'string'
                    ? fnErr
                    : 'Failed to start the deposit.',
                );
              }
              const clientSecret = data?.clientSecret;
              if (!clientSecret) {
                throw new Error('Invalid response from payment server.');
              }

              // 2. Present the Stripe Payment Sheet.
              const { error: initError } = await initPaymentSheet({
                paymentIntentClientSecret: clientSecret,
                merchantDisplayName: 'NEXPEC',
              });
              if (initError) throw initError;

              const { error: presentError } = await presentPaymentSheet();
              if (presentError) {
                if (presentError.code !== 'Canceled') throw presentError;
                return;
              }

              // 3. The webhook credits the wallet asynchronously. We
              //    show the user a confirmation immediately and re-fetch
              //    stats — the new balance will appear within a few
              //    seconds once the webhook lands.
              Alert.alert(
                'Success',
                `Deposit of ${formatCurrency(amountSar)} submitted! Your balance will update once the payment clears.`,
              );
              await loadAllData();
            } catch (err: any) {
              Alert.alert(
                'Deposit Failed',
                err.message || 'An error occurred.',
              );
            } finally {
              setActionLoading(false);
            }
          },
        },
      ],
      'plain-text',
      '',
      'decimal-pad',
    );
  }, [initPaymentSheet, presentPaymentSheet, loadAllData]);

  const handleSetDefault = useCallback( async (methodId: string) => {
      try { await supabase .from('payment_methods') .update({ is_default: false }) .eq('user_id', session?.user?.id); await supabase .from('payment_methods') .update({ is_default: true }) .eq('id', methodId); await fetchPaymentMethods(); } catch (err: any) { Alert.alert('Error', err.message || 'Failed to update default method.'); }
    }, [session?.user?.id, fetchPaymentMethods], );

  const handleRemoveMethod = useCallback( (methodId: string) => {
      Alert.alert( 'Remove Payment Method', 'Are you sure you want to remove this payment method?', [ { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { try { await supabase .from('payment_methods') .delete() .eq('id', methodId); await fetchPaymentMethods(); } catch (err: any) { Alert.alert( 'Error', err.message || 'Failed to remove payment method.', ); } }, }, ], );
    }, [fetchPaymentMethods], );

  const handleAddPaymentMethod = useCallback( async (provider: PaymentProviderOption) => {
      setShowAddPaymentModal(false); setActionLoading(true);
      try { 
        if (provider.id === 'stripe') { 
          const { data, error: apiError } = await supabase.functions.invoke('create-setup-intent', {
            body: { user_id: session?.user?.id, email: session?.user?.email }, 
          });
          
          if (apiError) throw new Error(apiError.message || 'Failed to communicate with payment server.');

          // 🔴 THE FIX: Extracting the correct secret from the advanced backend
          const clientSecret = data?.setupIntentClientSecret || data?.clientSecret;
          const setupIntentId = data?.setupIntentId; // 👈 آی‌دی رو گرفتیم
          
          if (!clientSecret) throw new Error('Invalid response from payment server.');

          const { error: initError } = await initPaymentSheet({ setupIntentClientSecret: clientSecret, merchantDisplayName: 'NEXPEC', }); 
          if (initError) throw initError; 
          
          const { error: presentError } = await presentPaymentSheet(); 
          if (presentError) { if (presentError.code !== 'Canceled') throw presentError; return; } 
          
          // 🔴 THE FIX: Sync with Supabase using the professional backend sync function
          if (setupIntentId) {
            await supabase.functions.invoke('sync-payment-method', {
              body: { 
                user_id: session?.user?.id,
                setup_intent_id: setupIntentId 
              }
            });
          }
          
          Alert.alert('Success', 'Payment method added successfully!'); 
          await fetchPaymentMethods(); 
        } else if (provider.id === 'stripe_connect') {
          // ★ Phase B — Stripe Connect Express onboarding for inspectors.
          //   Calls the create-stripe-connect-link Edge Function which:
          //     1. Creates an Express account if one doesn't exist
          //        (country=CA, currency=USD, transfers capability)
          //     2. Returns a short-lived Stripe-hosted onboarding URL
          //   We open it via WebBrowser.openAuthSessionAsync so the OS
          //   handles the redirect back via the nexpec:// deep-link
          //   scheme. The stripe-connect-webhook then flips
          //   profiles.stripe_connect_status to 'verified' once Stripe
          //   confirms the account is fully onboarded.
          setShowAddPaymentModal(false);

          // ★ return_url / refresh_url are now built server-side from
          //   SUPABASE_URL — they point to the stripe-connect-redirect
          //   bridge EF (HTTPS), which JS-redirects to nexpec://...
          //   Stripe's SDK rejects custom schemes, so we can't pass
          //   them directly. The bridge handles the handoff.
          const { data, error: linkError } = await supabase.functions.invoke(
            'create-stripe-connect-link',
            { body: { user_id: session?.user?.id } },
          );

          if (linkError || !data?.url) {
            throw new Error(
              linkError?.message ?? 'Could not start Stripe onboarding.',
            );
          }

          await WebBrowser.openAuthSessionAsync(
            data.url,
            'nexpec://finance/connect-return',
          );

          // ★ Sync status with Stripe directly. Belt-and-braces against
          //   webhook misconfig: pulls live account state from Stripe
          //   and writes it into profiles, so the user sees their
          //   verified status immediately on return — regardless of
          //   whether the account.updated webhook has fired yet.
          try {
            await supabase.functions.invoke('sync-stripe-connect-status', {
              body: { user_id: session?.user?.id },
            });
          } catch (syncErr) {
            // Non-fatal — webhook will catch up eventually.
            console.warn('[finance] sync-stripe-connect-status failed:', syncErr);
          }

          await fetchPaymentMethods();
          await determineUserRole();
          Alert.alert(
            'Stripe Connect',
            'Onboarding complete. Your account is being verified, you\'re ready to receive payouts.',
          );
        } else {
          // 🌟 برای پی‌پال، وایز و پایونیر، همین مودالِ سریع رو باز می‌کنیم
          setShowAddPaymentModal(false);
          setShowProviderForm(provider);
          setProviderInputValue('');
        } 
      } catch (err: any) {
        Alert.alert('Error', err.message || 'Failed to add payment method.'); 
      } finally { 
        setActionLoading(false); 
      }
    }, [ session?.user?.id, session?.user?.email, initPaymentSheet, presentPaymentSheet, fetchPaymentMethods, ], );

  const earningsData = useMemo(() => {
    if (!earnings) return null;
    return { weeklyData: earnings.weeklyEarnings.map(d => d.net_cents), weeklyLabels: earnings.weeklyEarnings.map(d => d.day_label), totalEarnings: earnings.totalEarnedCents / 100, monthlyEarnings: earnings.monthlyBreakdown.net_cents / 100, weeklyEarnings: earnings.weeklyTotalCents / 100, avgPerJob: 0, completedJobs: 0, hoursWorked: 0, hourlyRate: earnings.effectiveHourlyRateCents / 100, growthPct: 0, breakdown: [], recentTransactions: earnings.transactions, };
  }, [earnings]);

  if (walletLoading && !refreshing) {
    return ( <SafeAreaView style={s.loadingWrap}><StatusBar barStyle="light-content" backgroundColor={COLORS.background} /><ActivityIndicator size="large" color={COLORS.primary} /><Text style={s.loadingText}>Loading Finance…</Text></SafeAreaView> );
  }

  const availableProviders = PAYMENT_PROVIDERS.filter(p =>
    p.targetRole === 'all' ||
    p.targetRole === userRole ||
    // Buyer-tier roles share the same client-targeted payment providers.
    (p.targetRole === 'client' && (userRole === 'agency' || userRole === 'enterprise'))
  );

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      {actionLoading && ( <View style={s.overlay}><View style={s.overlayBox}><ActivityIndicator size="large" color={COLORS.primary} /><Text style={s.overlayText}>Processing…</Text></View></View> )}
      <View style={s.header}><View><Text style={s.headerTitle}>Finance</Text><Text style={s.headerSub}>Wallet & Earnings</Text></View><TouchableOpacity style={s.headerBtn} onPress={() => router.push('/notifications')} activeOpacity={0.7}><Ionicons name="notifications-outline" size={22} color={COLORS.textSecondary} /></TouchableOpacity></View>
      <Animated.ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false} onScroll={Animated.event( [{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true }, )} scrollEventThrottle={16} refreshControl={ <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} /> }>
        <BalanceHero stats={walletStats} userRole={userRole} stripeConnect={stripeConnect} onWithdraw={handleWithdraw} onDeposit={handleDeposit} />
        {userRole === 'inspector' && earningsData && (
          <>
            <SectionHeader icon="trending-up" title="Earnings Overview" subtitle="Your performance at a glance" color={COLORS.green} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickStatsRow}>
              <QuickStatCard icon="cash-outline" label="This Month" value={formatUSD(earningsData.monthlyEarnings)} sub={`${earningsData.growthPct >= 0 ? '+' : ''}${earningsData.growthPct.toFixed(1)}%`} color={COLORS.green} bgColor={COLORS.greenBg} />
              <QuickStatCard icon="calendar-outline" label="This Week" value={formatUSD(earningsData.weeklyEarnings)} color={COLORS.primary} bgColor={COLORS.primaryBg} />
              <QuickStatCard icon="briefcase-outline" label="Avg / Job" value={formatUSD(earningsData.avgPerJob)} sub={`${earningsData.completedJobs} jobs`} color={COLORS.blue} bgColor={COLORS.blueBg} />
              <QuickStatCard icon="time-outline" label="Hourly Rate" value={formatUSD(earningsData.hourlyRate)} sub={formatDuration(earningsData.hoursWorked)} color={COLORS.amber} bgColor={COLORS.amberBg} />
            </ScrollView>
            {earningsData.weeklyData.length > 0 && ( <><SectionHeader icon="bar-chart-outline" title="Weekly Earnings" subtitle="Last 7 days performance" color={COLORS.primary} /><View style={s.card}><GrowthChart data={earningsData.weeklyData} labels={earningsData.weeklyLabels} /></View></> )}
            {earningsData.breakdown.length > 0 && ( <><SectionHeader icon="pie-chart-outline" title="Smart Breakdown" subtitle="Where your money comes from" color={COLORS.primary} /><View style={s.card}>{earningsData.breakdown.map((item: any, idx: number) => ( <SmartBreakdownCard key={`bd-${idx}`} icon={item.icon || 'ellipse'} label={item.label} amount={item.amount} percentage={item.percentage} color={item.color || COLORS.primary} /> ))}</View></> )}
            {earningsData.totalEarnings > 0 && ( <><SectionHeader icon="calculator-outline" title="Tax Planning" subtitle="Estimated tax reserve" color={COLORS.amber} /><TaxReserveCard totalEarned={earningsData.totalEarnings} /></> )}
          </>
        )}
        <SectionHeader icon="card-outline" title="Payment Methods" subtitle={`${paymentMethods.length} method${paymentMethods.length !== 1 ? 's' : ''}`} color={COLORS.primary} rightAction={{ label: '+ Add', onPress: () => setShowAddPaymentModal(true), }} />
        {paymentMethods.length === 0 ? ( <View style={s.emptyCard}><Ionicons name="card-outline" size={40} color={COLORS.textMuted} /><Text style={s.emptyTitle}>No Payment Methods</Text><Text style={s.emptySub}>Add a payment method to withdraw or deposit funds</Text><TouchableOpacity style={s.emptyBtn} onPress={() => setShowAddPaymentModal(true)} activeOpacity={0.8}><Ionicons name="add-circle-outline" size={18} color="#FFF" /><Text style={s.emptyBtnText}>Add Payment Method</Text></TouchableOpacity></View> ) : ( <View style={s.methodsList}>{paymentMethods.map((m) => ( <PaymentMethodCard key={m.id} method={m} onSetDefault={handleSetDefault} onRemove={handleRemoveMethod} /> ))}</View> )}
        <SectionHeader icon="receipt-outline" title="Recent Transactions" subtitle={`${transactions.length} transaction${transactions.length !== 1 ? 's' : ''}`} color={COLORS.primary} rightAction={ transactions.length > 5 ? { label: 'See All', onPress: () => router.push('/transactions'), } : undefined } />
        {transactions.length === 0 ? ( <View style={s.emptyCard}><Ionicons name="receipt-outline" size={40} color={COLORS.textMuted} /><Text style={s.emptyTitle}>No Transactions Yet</Text><Text style={s.emptySub}>Your transaction history will appear here</Text></View> ) : ( <View style={s.card}>{transactions.slice(0, 10).map((tx, idx) => ( <React.Fragment key={tx.id}><WalletTransactionItem tx={tx} />{idx < Math.min(transactions.length, 10) - 1 && ( <View style={s.txDivider} /> )}</React.Fragment> ))}</View> )}
        <View style={{ height: 120 }} />
      </Animated.ScrollView>
      <Modal visible={showAddPaymentModal} transparent animationType="slide" onRequestClose={() => setShowAddPaymentModal(false)}>
        <Pressable style={s.modalOverlay} onPress={() => setShowAddPaymentModal(false)}>
          <Pressable style={s.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.modalHandle} /><Text style={s.modalTitle}>Add Payment Method</Text><Text style={s.modalSub}>Choose how you want to receive or send payments</Text>
            {availableProviders.map((p) => ( <TouchableOpacity key={p.id} style={s.providerRow} onPress={() => handleAddPaymentMethod(p)} activeOpacity={0.7}><View style={[ s.providerIcon, { backgroundColor: `${p.color}20` }, ]}><Ionicons name={p.icon} size={24} color={p.color} /></View><View style={s.providerInfo}><Text style={s.providerName}>{p.name}</Text><Text style={s.providerDesc}>{p.description}</Text></View><Ionicons name="chevron-forward" size={20} color={COLORS.textMuted} /></TouchableOpacity> ))}
            <TouchableOpacity style={s.modalCancel} onPress={() => setShowAddPaymentModal(false)} activeOpacity={0.7}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 🌟 فرم جدید برای گرفتن اطلاعات پی‌پال و بانک با همون ظاهر استاندارد NEXPEC */}
      <Modal visible={!!showProviderForm} transparent animationType="slide" onRequestClose={() => setShowProviderForm(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.modalOverlay}>
          <Pressable style={s.modalOverlay} onPress={() => setShowProviderForm(null)}>
            <Pressable style={s.modalSheet} onPress={(e) => e.stopPropagation()}>
              <View style={s.modalHandle} />
              <Text style={s.modalTitle}>Add {showProviderForm?.name}</Text>
              <Text style={s.modalSub}>Enter your {showProviderForm?.id === 'paypal' ? 'PayPal email' : 'account details'}</Text>

              <TextInput
                style={{ backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, color: COLORS.textPrimary, fontSize: 15, marginBottom: 10 }}
                placeholder={showProviderForm?.id === 'paypal' ? "e.g., inspector@nexpec.com" : "Account Number or IBAN"}
                placeholderTextColor={COLORS.textMuted}
                value={providerInputValue}
                onChangeText={setProviderInputValue}
                autoCapitalize="none"
                keyboardType={showProviderForm?.id === 'paypal' ? "email-address" : "default"}
              />

              <TouchableOpacity style={[s.modalCancel, { backgroundColor: COLORS.primary, marginTop: 10 }]} onPress={handleSaveProviderDetail} activeOpacity={0.7}>
                <Text style={[s.modalCancelText, { color: '#FFF' }]}>Save Account</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={s.modalCancel} onPress={() => setShowProviderForm(null)} activeOpacity={0.7}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, }, loadingWrap: { flex: 1, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', }, loadingText: { color: COLORS.textSecondary, fontSize: 14, marginTop: 12, }, scroll: { flex: 1 }, scrollContent: { paddingHorizontal: 16, paddingTop: 8 },
  // ★ FINANCE-HEADER-BLEED-001 — Top header was rendering transparent, so
  //   ScrollView content slid visually *underneath* the "Finance / WALLET
  //   & EARNINGS" title as the user scrolled. Patch: give the header an
  //   opaque background, raise its stacking order with zIndex/elevation,
  //   and expand the Android paddingTop to clear the system status bar
  //   (SafeAreaView already covers iOS).
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) + 8 : 4, paddingBottom: 12, backgroundColor: COLORS.background, zIndex: 10, elevation: 10, }, headerTitle: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.5, }, headerSub: { fontSize: 13, color: COLORS.textMuted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.8, }, headerBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, },
  heroCard: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 20, marginBottom: 20, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', }, heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, }, heroLabel: { fontSize: 13, color: COLORS.textMuted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.8, }, heroBalance: { fontSize: 38, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -1, }, roleBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primaryBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 5, }, roleText: { fontSize: 12, fontWeight: '600', color: COLORS.primary, },
  miniStatsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: 12, marginBottom: 16, }, miniStat: { flex: 1, alignItems: 'center' }, miniStatLabel: { fontSize: 11, color: COLORS.textMuted, marginBottom: 4, }, miniStatValue: { fontSize: 15, fontWeight: '700' }, miniStatDivider: { width: 1, height: 28, backgroundColor: COLORS.border, },
  heroActions: { flexDirection: 'row', gap: 10, }, heroBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 14, gap: 8, }, heroBtnPrimary: { backgroundColor: COLORS.primary, }, heroBtnOutline: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: COLORS.primary, }, heroBtnTextWhite: { fontSize: 15, fontWeight: '700', color: '#FFF', },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 8, }, sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, }, sectionIcon: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', }, sectionTitle: { fontSize: 17, fontWeight: '700', color: COLORS.textPrimary, }, sectionSubtitle: { fontSize: 12, color: COLORS.textMuted, marginTop: 1, }, sectionAction: { fontSize: 14, fontWeight: '600', },
  card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: COLORS.border, },
  quickStatsRow: { paddingBottom: 16, gap: 10, }, quickStatCard: { width: 140, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, }, quickStatIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 10, }, quickStatValue: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 2, }, quickStatLabel: { fontSize: 12, color: COLORS.textMuted, }, quickStatSub: { fontSize: 12, fontWeight: '600', marginTop: 4, },
  chartWrap: { alignItems: 'center', paddingVertical: 4, },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, }, breakdownLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, }, breakdownIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', }, breakdownLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, }, breakdownAmount: { fontSize: 12, color: COLORS.textMuted, marginTop: 1, }, breakdownRight: { alignItems: 'flex-end', width: 90, }, breakdownPct: { fontSize: 13, fontWeight: '700', marginBottom: 4, }, breakdownBar: { width: '100%', height: 4, borderRadius: 2, backgroundColor: COLORS.border, }, breakdownBarFill: { height: '100%', borderRadius: 2, },
  taxCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: `${COLORS.amber}25`, }, taxHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, }, taxIconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', }, taxTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, }, taxSub: { fontSize: 12, color: COLORS.textMuted, marginTop: 1, }, taxAmount: { fontSize: 22, fontWeight: '800', color: COLORS.amber, marginBottom: 6, }, taxDisclaimer: { fontSize: 11, color: COLORS.textMuted, fontStyle: 'italic', },
  methodsList: { gap: 10, marginBottom: 20, }, methodCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: COLORS.border, }, methodCardDefault: { borderColor: `${COLORS.primary}40`, }, methodIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12, }, methodInfo: { flex: 1 }, methodLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, }, methodLabel: { fontSize: 15, fontWeight: '600', color: COLORS.textPrimary, }, defaultBadge: { backgroundColor: COLORS.primaryBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, }, defaultBadgeText: { fontSize: 10, fontWeight: '700', color: COLORS.primary, }, methodLast4: { fontSize: 13, color: COLORS.textMuted, marginTop: 2, }, methodActions: { flexDirection: 'row', gap: 6, }, methodActionBtn: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.04)', },
  txItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, }, txIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12, }, txInfo: { flex: 1 }, txDesc: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 3, }, txMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 }, txDate: { fontSize: 12, color: COLORS.textMuted }, txStatusDot: { width: 5, height: 5, borderRadius: 2.5, }, txStatus: { fontSize: 12, fontWeight: '500' }, txAmount: { fontSize: 15, fontWeight: '700', marginLeft: 8, }, txDivider: { height: 1, backgroundColor: COLORS.border, marginLeft: 52, },
  emptyCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 28, marginBottom: 20, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', }, emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginTop: 12, }, emptySub: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', marginTop: 4, marginBottom: 16, }, emptyBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 12, gap: 8, }, emptyBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF', },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,4,32,0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 999, }, overlayBox: { backgroundColor: COLORS.surface, borderRadius: 20, padding: 32, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, }, overlayText: { color: COLORS.textSecondary, fontSize: 14, marginTop: 14, },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(2,4,32,0.6)', justifyContent: 'flex-end', }, modalSheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, borderTopWidth: 1, borderColor: COLORS.border, }, modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: COLORS.borderLight, alignSelf: 'center', marginBottom: 20, }, modalTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 4, }, modalSub: { fontSize: 14, color: COLORS.textMuted, marginBottom: 20, }, providerRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surfaceLight, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border, }, providerIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 14, }, providerInfo: { flex: 1 }, providerName: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, }, providerDesc: { fontSize: 13, color: COLORS.textMuted, marginTop: 2, }, modalCancel: { marginTop: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: COLORS.surfaceLight, alignItems: 'center', }, modalCancelText: { fontSize: 16, fontWeight: '600', color: COLORS.textSecondary, },
});