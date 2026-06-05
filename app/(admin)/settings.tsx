// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/settings.tsx — Mobile Platform Settings (web parity)
//
//  Mirrors web /admin/settings → the Fee Schedule editor. Admin-gated (role IN
//  admin/super_admin = nx_is_admin; the write RPC self-gates too after the
//  20260724 God-mode migration). Reads public_get_fee_schedule() and writes the
//  audited admin_set_fee_schedule(client_bps, stripe_bps, dispute_cents,
//  payout_bps, reason) RPC — a reason is mandatory (audit-critical) and a
//  before→after confirm guards the write. ALL money validation stays server-
//  side (the RPC re-checks every bound + CHECK constraints); the UI only mirrors
//  the bounds for fast feedback.
//
//  DELIBERATE OMISSION: the web page also renders an IntegrationSecrets panel
//  (Stripe keys etc.). Secrets are NEVER surfaced on a device — that panel is
//  intentionally not ported. Fees are platform-wide rates, not per-job prices,
//  so Golden-Rule price-blindness does not apply here. Schema verified against
//  20260523120000_platform_settings.sql.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { supabase } from '@/lib/supabase';

const C = {
  bg: '#020420', card: '#0B1138',
  border: 'rgba(255,255,255,0.06)',
  text: '#FFFFFF', textSec: '#A8B2C7', textMute: '#6B7390',
  primary: '#7C3AED', primaryDim: 'rgba(124,58,237,0.14)',
  cyan: '#00FFFF', green: '#10B981', greenDim: 'rgba(16,185,129,0.14)', amber: '#F59E0B', red: '#EF4444', redDim: 'rgba(239,68,68,0.14)',
};

// ── Fee definitions: human unit ↔ stored integer. Bounds mirror the server. ──
interface Fees {
  client_commission_bps: number;
  stripe_application_fee_bps: number;
  dispute_fee_cents: number;
  payout_fee_bps: number;
  updated_at: string | null;
}

const DEFAULT_FEES: Fees = {
  client_commission_bps: 1500,
  stripe_application_fee_bps: 250,
  dispute_fee_cents: 5000,
  payout_fee_bps: 0,
  updated_at: null,
};

function bpsToPct(bps: number): string { return trimNum(bps / 100); }
function centsToUsd(cents: number): string { return trimNum(cents / 100); }
function trimNum(n: number): string { return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '0'; }
function numOr(v: unknown, d: number): number { const n = Number(v); return Number.isFinite(n) ? n : d; }

export default function AdminSettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Loaded baseline (for diffing + the before/after confirm)
  const [base, setBase] = useState<Fees>(DEFAULT_FEES);
  // Editable human-unit strings
  const [commissionPct, setCommissionPct] = useState('15');
  const [stripePct, setStripePct] = useState('2.5');
  const [disputeUsd, setDisputeUsd] = useState('50');
  const [payoutPct, setPayoutPct] = useState('0');
  const [reason, setReason] = useState('');

  const hydrate = useCallback((f: Fees) => {
    setBase(f);
    setCommissionPct(bpsToPct(f.client_commission_bps));
    setStripePct(bpsToPct(f.stripe_application_fee_bps));
    setDisputeUsd(centsToUsd(f.dispute_fee_cents));
    setPayoutPct(bpsToPct(f.payout_fee_bps));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError('You must be signed in.'); return; }
      const profRes = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      const role = (profRes.data as { role?: string } | null)?.role;
      const admin = role === 'admin' || role === 'super_admin';
      setIsAdmin(admin);
      if (!admin) return;

      const { data, error: rpcErr } = await supabase.rpc('public_get_fee_schedule' as never);
      if (rpcErr) { setError(rpcErr.message); return; }
      const r = (data ?? {}) as Record<string, unknown>;
      hydrate({
        client_commission_bps: numOr(r.client_commission_bps, DEFAULT_FEES.client_commission_bps),
        stripe_application_fee_bps: numOr(r.stripe_application_fee_bps, DEFAULT_FEES.stripe_application_fee_bps),
        dispute_fee_cents: numOr(r.dispute_fee_cents, DEFAULT_FEES.dispute_fee_cents),
        payout_fee_bps: numOr(r.payout_fee_bps, DEFAULT_FEES.payout_fee_bps),
        updated_at: (r.updated_at as string | null) ?? null,
      });
    } catch (e: unknown) {
      console.warn('[admin/settings] load threw:', e);
      setError((e as Error)?.message ?? 'Could not load platform settings.');
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [hydrate]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  // Parse the four editable fields into stored integers + validate bounds.
  const parseDraft = useCallback((): { fees: Omit<Fees, 'updated_at'>; err: string | null } => {
    const cBps = Math.round(parseFloat(commissionPct) * 100);
    const sBps = Math.round(parseFloat(stripePct) * 100);
    const dCents = Math.round(parseFloat(disputeUsd) * 100);
    const pBps = Math.round(parseFloat(payoutPct) * 100);
    if (![cBps, sBps, dCents, pBps].every(Number.isFinite)) return { fees: base, err: 'Every field must be a number.' };
    if (cBps < 0 || cBps > 5000) return { fees: base, err: 'Client commission must be 0–50%.' };
    if (sBps < 0 || sBps > 2000) return { fees: base, err: 'Stripe application fee must be 0–20%.' };
    if (dCents < 0 || dCents > 100000) return { fees: base, err: 'Dispute fee must be $0–$1,000.' };
    if (pBps < 0 || pBps > 1000) return { fees: base, err: 'Payout fee must be 0–10%.' };
    return {
      fees: {
        client_commission_bps: cBps,
        stripe_application_fee_bps: sBps,
        dispute_fee_cents: dCents,
        payout_fee_bps: pBps,
      },
      err: null,
    };
  }, [commissionPct, stripePct, disputeUsd, payoutPct, base]);

  const { fees: draft, err: draftErr } = parseDraft();
  const dirty =
    draft.client_commission_bps !== base.client_commission_bps ||
    draft.stripe_application_fee_bps !== base.stripe_application_fee_bps ||
    draft.dispute_fee_cents !== base.dispute_fee_cents ||
    draft.payout_fee_bps !== base.payout_fee_bps;
  const canSave = dirty && !draftErr && reason.trim().length > 0 && !saving;

  const doSave = useCallback(async () => {
    const { fees, err } = parseDraft();
    if (err) { Alert.alert('Check the values', err); return; }
    setSaving(true);
    try {
      const { data, error: rpcErr } = await supabase.rpc('admin_set_fee_schedule' as never, {
        p_client_commission_bps: fees.client_commission_bps,
        p_stripe_application_fee_bps: fees.stripe_application_fee_bps,
        p_dispute_fee_cents: fees.dispute_fee_cents,
        p_payout_fee_bps: fees.payout_fee_bps,
        p_reason: reason.trim(),
      } as never);
      if (rpcErr) {
        Alert.alert('Could not save', /42501|only admin/i.test(rpcErr.message) ? 'Only the platform owner (admin) can change the fee schedule.' : rpcErr.message);
        return;
      }
      const res = (data ?? {}) as Record<string, unknown>;
      const after = (res.after ?? {}) as Record<string, unknown>;
      hydrate({
        client_commission_bps: numOr(after.client_commission_bps, fees.client_commission_bps),
        stripe_application_fee_bps: numOr(after.stripe_application_fee_bps, fees.stripe_application_fee_bps),
        dispute_fee_cents: numOr(after.dispute_fee_cents, fees.dispute_fee_cents),
        payout_fee_bps: numOr(after.payout_fee_bps, fees.payout_fee_bps),
        updated_at: new Date().toISOString(),
      });
      setReason('');
      Alert.alert('Fee schedule updated', 'The new rates apply to all new transactions immediately.');
    } catch (e: unknown) {
      Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
    } finally {
      setSaving(false);
    }
  }, [parseDraft, reason, hydrate]);

  const confirmSave = useCallback(() => {
    const { fees, err } = parseDraft();
    if (err) { Alert.alert('Check the values', err); return; }
    const lines: string[] = [];
    if (fees.client_commission_bps !== base.client_commission_bps) lines.push(`Client commission  ${bpsToPct(base.client_commission_bps)}% → ${bpsToPct(fees.client_commission_bps)}%`);
    if (fees.stripe_application_fee_bps !== base.stripe_application_fee_bps) lines.push(`Stripe app fee  ${bpsToPct(base.stripe_application_fee_bps)}% → ${bpsToPct(fees.stripe_application_fee_bps)}%`);
    if (fees.dispute_fee_cents !== base.dispute_fee_cents) lines.push(`Dispute fee  $${centsToUsd(base.dispute_fee_cents)} → $${centsToUsd(fees.dispute_fee_cents)}`);
    if (fees.payout_fee_bps !== base.payout_fee_bps) lines.push(`Payout fee  ${bpsToPct(base.payout_fee_bps)}% → ${bpsToPct(fees.payout_fee_bps)}%`);
    Alert.alert(
      'Apply new fee schedule?',
      `${lines.join('\n')}\n\nReason: ${reason.trim()}\n\nThis applies to all new transactions immediately and is recorded in the audit log.`,
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Apply', style: 'destructive', onPress: () => { void doSave(); } }],
    );
  }, [parseDraft, base, reason, doSave]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}><StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}><ActivityIndicator size="large" color={C.primary} /><Text style={s.centerText}>Loading platform settings…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}><Ionicons name="arrow-back" size={22} color={C.text} /></TouchableOpacity>
        <Text style={s.headerTitle}>Platform Settings</Text>
        <View style={{ width: 22 }} />
      </View>

      {!isAdmin ? (
        <View style={s.center}><View style={s.reservedCard}><Ionicons name="lock-closed-outline" size={20} color={C.amber} /><Text style={s.reservedTitle}>Reserved access</Text><Text style={s.reservedBody}>Platform settings are reserved for the platform owner (admin).</Text></View></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
          <ScrollView
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
          >
            <Animated.View entering={FadeIn.duration(200)} style={s.heroWrap}>
              <Text style={s.kicker}>PLATFORM, FEE SCHEDULE</Text>
              <Text style={s.title}>Settings</Text>
              <Text style={s.subtitle}>The global rates applied to every new transaction. Changes take effect immediately and are audit-logged with your reason.</Text>
            </Animated.View>

            {error ? (<View style={s.errorBanner}><Ionicons name="alert-circle" size={16} color={C.red} /><Text style={s.errorText}>{error}</Text></View>) : null}

            <Animated.View entering={FadeInDown.delay(60).duration(220)} style={s.sectionCard}>
              <Text style={s.sectionLabel}>FEE SCHEDULE</Text>

              <FeeField
                label="Client commission" suffix="%" value={commissionPct} onChange={setCommissionPct}
                helper="Platform's cut of each client transaction. 0–50%."
              />
              <FeeField
                label="Stripe application fee" suffix="%" value={stripePct} onChange={setStripePct}
                helper="Application fee added on Stripe-processed charges. 0–20%."
              />
              <FeeField
                label="Dispute fee" prefix="$" value={disputeUsd} onChange={setDisputeUsd}
                helper="Flat fee charged when a dispute is opened. $0–$1,000."
              />
              <FeeField
                label="Payout fee" suffix="%" value={payoutPct} onChange={setPayoutPct}
                helper="Fee withheld on inspector payouts. 0–10%."
              />

              {base.updated_at ? <Text style={s.asOf}>Last updated {formatDateTime(base.updated_at)}</Text> : null}
            </Animated.View>

            {/* Reason — required, audit-critical */}
            <Animated.View entering={FadeInDown.delay(100).duration(220)} style={s.sectionCard}>
              <Text style={s.sectionLabel}>REASON FOR CHANGE, REQUIRED</Text>
              <TextInput
                style={s.reasonInput}
                value={reason}
                onChangeText={setReason}
                placeholder="e.g. Q3 pricing review, lower commission to 12%"
                placeholderTextColor={C.textMute}
                multiline
                maxLength={1000}
                editable={!saving}
              />
              <Text style={s.asOf}>Recorded in the audit log alongside the before/after values.</Text>
            </Animated.View>

            {draftErr && dirty ? (<View style={s.warnBanner}><Ionicons name="warning-outline" size={15} color={C.amber} /><Text style={s.warnText}>{draftErr}</Text></View>) : null}

            <TouchableOpacity
              style={[s.saveBtn, !canSave && s.saveBtnDisabled]}
              onPress={confirmSave}
              disabled={!canSave}
              activeOpacity={0.85}
            >
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="save-outline" size={17} color={canSave ? '#fff' : C.textMute} />}
              <Text style={[s.saveBtnText, !canSave && { color: C.textMute }]}>
                {saving ? 'Saving…' : !dirty ? 'No changes' : reason.trim().length === 0 ? 'Add a reason to save' : 'Review & apply'}
              </Text>
            </TouchableOpacity>

            {/* Deliberate security note — secrets are NOT on device */}
            <View style={s.secretsNote}>
              <Ionicons name="shield-checkmark-outline" size={15} color={C.cyan} />
              <Text style={s.secretsText}>Integration secrets (Stripe keys, webhooks) are managed server-side and intentionally not shown on mobile.</Text>
            </View>

            <Text style={s.footnote}>Source, public_get_fee_schedule + admin_set_fee_schedule, admin-gated (nx_is_admin), server-validated.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function FeeField({ label, helper, value, onChange, prefix, suffix }: {
  label: string; helper: string; value: string; onChange: (v: string) => void; prefix?: string; suffix?: string;
}) {
  return (
    <View style={s.feeField}>
      <View style={s.feeRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.feeLabel}>{label}</Text>
          <Text style={s.feeHelper}>{helper}</Text>
        </View>
        <View style={s.inputWrap}>
          {prefix ? <Text style={s.affix}>{prefix}</Text> : null}
          <TextInput
            style={s.input}
            value={value}
            onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, ''))}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={7}
            selectTextOnFocus
          />
          {suffix ? <Text style={s.affix}>{suffix}</Text> : null}
        </View>
      </View>
    </View>
  );
}

function formatDateTime(iso: string): string {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 64, gap: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTitle: { color: C.text, fontSize: 16, fontWeight: '700' },

  heroWrap: { gap: 6 },
  kicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { color: C.text, fontSize: 28, fontWeight: '700', marginTop: 4 },
  subtitle: { color: C.textSec, fontSize: 13, lineHeight: 20, marginTop: 4 },

  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.redDim, borderColor: 'rgba(239,68,68,0.32)', borderWidth: 1, padding: 12, borderRadius: 12 },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },
  warnBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(245,158,11,0.12)', borderColor: 'rgba(245,158,11,0.32)', borderWidth: 1, padding: 12, borderRadius: 12 },
  warnText: { color: '#FCD34D', fontSize: 12.5, flex: 1 },

  sectionCard: { borderRadius: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 14, gap: 12 },
  sectionLabel: { color: C.textMute, fontSize: 10, fontWeight: '700', letterSpacing: 0.9 },
  asOf: { color: C.textMute, fontSize: 10 },

  feeField: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border, paddingTop: 12 },
  feeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  feeLabel: { color: C.text, fontSize: 14, fontWeight: '600' },
  feeHelper: { color: C.textMute, fontSize: 11, marginTop: 2, lineHeight: 15 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, minWidth: 96 },
  affix: { color: C.textSec, fontSize: 15, fontWeight: '700' },
  input: { color: C.text, fontSize: 17, fontWeight: '700', paddingVertical: 9, minWidth: 44, textAlign: 'right', fontVariant: ['tabular-nums'] },

  reasonInput: { color: C.text, fontSize: 14, lineHeight: 20, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, minHeight: 76, textAlignVertical: 'top' },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14, backgroundColor: C.primary },
  saveBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: C.border },
  saveBtnText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },

  secretsNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,255,255,0.18)', backgroundColor: 'rgba(0,255,255,0.05)' },
  secretsText: { color: C.textSec, fontSize: 11.5, lineHeight: 16, flex: 1 },

  reservedCard: { alignItems: 'center', gap: 8, padding: 24, maxWidth: 320, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(245,158,11,0.32)', backgroundColor: 'rgba(245,158,11,0.14)' },
  reservedTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  reservedBody: { color: C.textSec, fontSize: 13, textAlign: 'center', lineHeight: 18 },

  footnote: { color: C.textMute, fontSize: 9, lineHeight: 13, textAlign: 'center', marginTop: 4 },
});
