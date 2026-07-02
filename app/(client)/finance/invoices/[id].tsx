// ════════════════════════════════════════════════════════════════════════════
//  app/(client)/finance/invoices/[id].tsx — Mobile invoice detail + approval
//
//  Single-invoice surface for client/agency/enterprise. Mirrors the web
//  /client/invoices/[id] page exactly: header, line items, totals, status
//  banner, Approve + Dispute actions.
//
//  Both mutations call supabase.from('invoices').update(...) directly.
//  RLS gates writes (admin-only at the SQL layer) but our defensive flow:
//    - For 'approved' (buyer action): set approved_at + approved_by
//    - For 'disputed' (buyer action): set disputed_at + disputed_by + reason
//  Buyer writes are permitted by the existing `invoices_read_own_client`
//  policy — wait, that's read only. For writes we need a server-side path.
//  Solution: the mobile UI calls supabase.rpc('client_action_on_invoice')
//  which we'd add… but since we already have RLS admin-only on writes,
//  the cleanest mobile path is to call a SECURITY DEFINER RPC.
//
//  PRAGMATIC CHOICE: For this round, mobile renders read-only with a clear
//  "open the web app to approve/dispute" callout. Round 3 will add the
//  RPC + mobile mutation buttons. This keeps mobile parity COMPLETE on
//  the READ surface (every account type can see their invoices), defers
//  the mutation parity by one round for safety.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, StatusBar, SafeAreaView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
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

type InvoiceStatus = 'pending_review' | 'approved' | 'disputed' | 'paid' | 'voided';

interface LineItem {
  kind: string;
  description: string;
  amount_cents: number;
  contract_id?: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  jobId: string;
  jobTitle: string | null;
  clientAmountCents: number;
  platformFeeCents: number;
  totalCents: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string;
  dueDate: string | null;
  approvedAt: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
  paidAt: string | null;
  notes: string | null;
  lineItems: LineItem[];
  isOwn: boolean;
}

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  disputed: 'Disputed',
  paid: 'Paid',
  voided: 'Voided',
};

export default function InvoiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setError('No invoice id provided.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be signed in.');
        return;
      }

      const { data, error: qErr } = await supabase
        .from('invoices')
        .select('id, invoice_number, job_id, client_id, client_amount_cents, platform_fee_cents, total_cents, currency, status, issued_at, due_date, approved_at, disputed_at, dispute_reason, paid_at, notes, line_items_json')
        .eq('id', id)
        .maybeSingle();
      if (qErr || !data) {
        setError(qErr?.message ?? 'Invoice not found.');
        return;
      }

      const r = data as Record<string, unknown>;

      // Hydrate job title
      let jobTitle: string | null = null;
      const jobId = r.job_id as string;
      if (jobId) {
        const { data: jrow } = await supabase
          .from('jobs').select('title').eq('id', jobId).maybeSingle();
        jobTitle = (jrow as { title?: string | null } | null)?.title ?? null;
      }

      setInvoice({
        id: String(r.id),
        invoiceNumber: String(r.invoice_number ?? ''),
        jobId,
        jobTitle,
        clientAmountCents: numberOr(r.client_amount_cents, 0),
        platformFeeCents: numberOr(r.platform_fee_cents, 0),
        totalCents: numberOr(r.total_cents, 0),
        currency: String(r.currency ?? 'USD'),
        status: ((r.status as InvoiceStatus) ?? 'pending_review') as InvoiceStatus,
        issuedAt: String(r.issued_at ?? ''),
        dueDate: (r.due_date as string | null) ?? null,
        approvedAt: (r.approved_at as string | null) ?? null,
        disputedAt: (r.disputed_at as string | null) ?? null,
        disputeReason: (r.dispute_reason as string | null) ?? null,
        paidAt: (r.paid_at as string | null) ?? null,
        notes: (r.notes as string | null) ?? null,
        lineItems: parseLineItems(r.line_items_json),
        isOwn: (r.client_id as string) === user.id,
      });
    } catch (e) {
      console.warn('[invoice] load threw:', e);
      setError('Could not load invoice.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const onRefresh = useCallback(() => { setRefreshing(true); void load(); }, [load]);

  // #QA — admin role detection (mirrors the web `isAdmin` helper: profiles.role ∈
  // {admin, super_admin}). Gates the admin invoice actions below; RLS still
  // enforces the writes server-side via invoices_write_admin_only.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      const role = (data as { role?: string | null } | null)?.role ?? '';
      setIsAdmin(role === 'admin' || role === 'super_admin');
    })();
  }, []);

  const handleApprove = useCallback(async () => {
    if (!invoice) return;
    Alert.alert(
      'Approve invoice?',
      `You're confirming ${formatCents(invoice.totalCents, invoice.currency)} is correct and ready for payment processing. Continue?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          style: 'default',
          onPress: async () => {
            setActing(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) {
                Alert.alert('Sign in required', 'Please sign in to approve invoices.');
                return;
              }
              // .select('id') so an RLS-filtered 0-row update surfaces as an
              // empty result instead of a silent fake success.
              const { data: updRows, error: updErr } = await supabase
                .from('invoices')
                .update({
                  status: 'approved',
                  approved_at: new Date().toISOString(),
                  approved_by: user.id,
                })
                .eq('id', invoice.id)
                .select('id');
              if (updErr || !updRows || updRows.length === 0) {
                Alert.alert(
                  'Could not approve',
                  'This action requires NEXPEC review — please contact support',
                );
                return;
              }
              await load();
              Alert.alert('Approved', 'Invoice approved. Admin will process payment next.');
            } catch (e: unknown) {
              Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
            } finally {
              setActing(false);
            }
          },
        },
      ],
    );
  }, [invoice, load]);

  const handleDispute = useCallback(() => {
    if (!invoice) return;
    Alert.prompt(
      'Dispute this invoice',
      'Briefly describe what is wrong. Admin will mediate.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'File dispute',
          style: 'destructive',
          onPress: async (reason?: string) => {
            const trimmed = (reason ?? '').trim();
            if (trimmed.length < 10) {
              Alert.alert('Reason too short', 'Please give at least 10 characters of detail.');
              return;
            }
            setActing(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) { Alert.alert('Sign in required'); return; }
              // .select('id') so an RLS-filtered 0-row update surfaces as an
              // empty result instead of a silent fake success.
              const { data: updRows, error: updErr } = await supabase
                .from('invoices')
                .update({
                  status: 'disputed',
                  disputed_at: new Date().toISOString(),
                  disputed_by: user.id,
                  dispute_reason: trimmed,
                })
                .eq('id', invoice.id)
                .select('id');
              if (updErr || !updRows || updRows.length === 0) {
                Alert.alert(
                  'Could not file dispute',
                  'This action requires NEXPEC review — please contact support',
                );
                return;
              }
              await load();
              Alert.alert('Dispute filed', 'Admin will adjudicate shortly.');
            } catch (e: unknown) {
              Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
            } finally {
              setActing(false);
            }
          },
        },
      ],
      'plain-text',
      '',
      'default',
    );
  }, [invoice, load]);

  // ── Admin actions — mirror the web server actions (markInvoicePaid / void /
  //    adjudicate). Each is IDEMPOTENT via a status precondition (.eq('status',…)):
  //    a replay on an already-transitioned invoice matches 0 rows → no double effect.
  //    RLS (invoices_write_admin_only) is the real gate; isAdmin only hides the UI.
  const handleMarkPaid = useCallback(() => {
    if (!invoice) return;
    Alert.prompt(
      'Mark invoice as paid',
      `Confirm ${formatCents(invoice.totalCents, invoice.currency)} has been settled. Optional payment reference:`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark paid',
          style: 'default',
          onPress: async (reference?: string) => {
            setActing(true);
            try {
              const { data, error: updErr } = await supabase
                .from('invoices') // outbox-exempt: online admin invoice action (status-guarded, idempotent)
                .update({
                  status: 'paid',
                  paid_at: new Date().toISOString(),
                  paid_reference: (reference ?? '').trim() || null,
                })
                .eq('id', invoice.id)
                .eq('status', 'approved')
                .select('id');
              if (updErr) {
                Alert.alert('Could not mark paid', updErr.message.includes('row-level security') ? 'Admin permission required for this action.' : updErr.message);
                return;
              }
              if (!data || data.length === 0) {
                Alert.alert('Not settled', 'Only an approved invoice can be marked paid (it may already be paid).');
                return;
              }
              await load();
              Alert.alert('Marked paid', 'The invoice is settled.');
            } catch (e: unknown) {
              Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
            } finally {
              setActing(false);
            }
          },
        },
      ],
      'plain-text',
      '',
      'default',
    );
  }, [invoice, load]);

  const handleVoid = useCallback(() => {
    if (!invoice) return;
    Alert.prompt(
      'Void invoice',
      'Give a reason (min 5 characters). A paid invoice cannot be voided.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void',
          style: 'destructive',
          onPress: async (reason?: string) => {
            const trimmed = (reason ?? '').trim();
            if (trimmed.length < 5) { Alert.alert('Reason too short', 'Please give at least 5 characters.'); return; }
            setActing(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) { Alert.alert('Sign in required'); return; }
              const { data, error: updErr } = await supabase
                .from('invoices') // outbox-exempt: online admin invoice action (status-guarded, idempotent)
                .update({
                  status: 'voided',
                  voided_at: new Date().toISOString(),
                  voided_by: user.id,
                  voided_reason: trimmed,
                })
                .eq('id', invoice.id)
                .neq('status', 'paid')
                .select('id');
              if (updErr) {
                Alert.alert('Could not void', updErr.message.includes('row-level security') ? 'Admin permission required for this action.' : updErr.message);
                return;
              }
              if (!data || data.length === 0) { Alert.alert('Cannot void', 'A paid invoice cannot be voided.'); return; }
              await load();
              Alert.alert('Voided', 'The invoice has been voided.');
            } catch (e: unknown) {
              Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
            } finally {
              setActing(false);
            }
          },
        },
      ],
      'plain-text',
      '',
      'default',
    );
  }, [invoice, load]);

  const handleResolveApprove = useCallback(() => {
    if (!invoice) return;
    Alert.alert(
      'Resolve dispute',
      'Approve this disputed invoice for payment?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setActing(true);
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) { Alert.alert('Sign in required'); return; }
              const { data, error: updErr } = await supabase
                .from('invoices') // outbox-exempt: online admin invoice action (status-guarded, idempotent)
                .update({
                  status: 'approved',
                  approved_at: new Date().toISOString(),
                  approved_by: user.id,
                })
                .eq('id', invoice.id)
                .eq('status', 'disputed')
                .select('id');
              if (updErr) {
                Alert.alert('Could not resolve', updErr.message.includes('row-level security') ? 'Admin permission required for this action.' : updErr.message);
                return;
              }
              if (!data || data.length === 0) { Alert.alert('Cannot resolve', 'Only a disputed invoice can be resolved this way.'); return; }
              await load();
              Alert.alert('Dispute resolved', 'Invoice approved for payment.');
            } catch (e: unknown) {
              Alert.alert('Error', (e as Error)?.message ?? 'Unknown error.');
            } finally {
              setActing(false);
            }
          },
        },
      ],
    );
  }, [invoice, load]);

  if (loading) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={s.centerText}>Loading invoice…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !invoice) {
    return (
      <SafeAreaView style={s.safe}>
        <StatusBar barStyle="light-content" backgroundColor={C.bg} />
        <View style={s.center}>
          <Ionicons name="alert-circle-outline" size={36} color={C.red} />
          <Text style={s.centerText}>{error ?? 'Invoice not found.'}</Text>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Text style={s.backBtnText}>← Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canAct =
    invoice.isOwn &&
    (invoice.status === 'pending_review' || invoice.status === 'approved');

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
        {/* Hero */}
        <Animated.View entering={FadeIn.duration(220)}>
          <LinearGradient
            colors={[C.primaryDim, 'rgba(0,0,0,0)']}
            start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
            style={s.hero}
          >
            <Text style={s.heroKicker}>CLIENT PORTAL, INVOICE</Text>
            <Text style={s.heroNumber}>{invoice.invoiceNumber}</Text>
            <Text style={s.heroJob} numberOfLines={2}>
              {invoice.jobTitle ?? '(untitled job)'}
            </Text>
            <View style={s.heroBottomRow}>
              <StatusPill status={invoice.status} />
              <Text style={s.heroMeta}>
                Issued {formatDate(invoice.issuedAt)}
                {invoice.dueDate ? `, Due ${formatDate(invoice.dueDate)}` : ''}
              </Text>
            </View>

            <View style={s.heroAmountBox}>
              <Text style={s.heroAmountLabel}>TOTAL DUE</Text>
              <Text style={s.heroAmountValue}>
                {formatCents(invoice.totalCents, invoice.currency)}
              </Text>
            </View>
          </LinearGradient>
        </Animated.View>

        {/* Status banners */}
        {invoice.status === 'disputed' && invoice.disputeReason && (
          <Banner tone="red" icon="alert-circle">
            <Text style={s.bannerTitle}>In dispute</Text>
            <Text style={s.bannerBody}>{invoice.disputeReason}</Text>
          </Banner>
        )}
        {invoice.status === 'approved' && invoice.approvedAt && (
          <Banner tone="violet" icon="checkmark-circle">
            <Text style={s.bannerBody}>
              Approved on {formatDate(invoice.approvedAt)}, awaiting payment processing.
            </Text>
          </Banner>
        )}
        {invoice.status === 'paid' && invoice.paidAt && (
          <Banner tone="green" icon="checkmark-done-circle">
            <Text style={s.bannerBody}>
              Paid on {formatDate(invoice.paidAt)}. Thank you.
            </Text>
          </Banner>
        )}
        {invoice.status === 'voided' && (
          <Banner tone="zinc" icon="close-circle">
            <Text style={s.bannerBody}>This invoice has been voided. No payment due.</Text>
          </Banner>
        )}

        {/* Line items */}
        <Animated.View entering={FadeInDown.delay(60).duration(240)} style={s.section}>
          <View style={s.sectionHeader}>
            <Ionicons name="document-text" size={14} color={C.primary} />
            <Text style={s.sectionTitle}>Line items</Text>
          </View>
          {invoice.lineItems.length === 0 ? (
            <Text style={s.empty}>No line items.</Text>
          ) : (
            <View style={{ marginTop: 12 }}>
              {invoice.lineItems.map((item, i) => (
                <View
                  key={i}
                  style={[s.lineItem, i > 0 && s.lineItemDivider]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.lineItemKind}>{item.kind.replace(/_/g, ' ').toUpperCase()}</Text>
                    <Text style={s.lineItemDesc}>{item.description}</Text>
                    {item.contract_id ? (
                      <Text style={s.lineItemContract}>
                        Contract, {item.contract_id.slice(0, 8)}…
                      </Text>
                    ) : null}
                  </View>
                  <Text style={s.lineItemAmount}>
                    {formatCents(item.amount_cents, invoice.currency)}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {/* Totals */}
          <View style={s.totalsBlock}>
            <TotalRow label="Subtotal" value={formatCents(invoice.clientAmountCents, invoice.currency)} />
            {invoice.platformFeeCents > 0 ? (
              <TotalRow
                label="Platform fee"
                value={formatCents(invoice.platformFeeCents, invoice.currency)}
              />
            ) : null}
            <View style={s.totalDivider} />
            <TotalRow
              label="Total"
              value={formatCents(invoice.totalCents, invoice.currency)}
              bold
            />
          </View>
        </Animated.View>

        {/* Actions */}
        {canAct && (
          <Animated.View entering={FadeInDown.delay(120).duration(240)} style={s.section}>
            <View style={s.sectionHeader}>
              <Ionicons name="cash" size={14} color={C.cyan} />
              <Text style={s.sectionTitle}>Your action</Text>
            </View>
            <Text style={s.sectionHint}>
              Approve to release into the payment queue, or dispute if
              anything is wrong.
            </Text>
            <View style={{ marginTop: 14, gap: 10 }}>
              {invoice.status === 'pending_review' && (
                <TouchableOpacity
                  onPress={handleApprove}
                  disabled={acting}
                  style={[s.approveBtn, acting && s.btnDisabled]}
                  activeOpacity={0.85}
                >
                  {acting ? (
                    <ActivityIndicator color="#04150C" size="small" />
                  ) : (
                    <Ionicons name="thumbs-up" size={16} color="#04150C" />
                  )}
                  <Text style={s.approveBtnText}>
                    {acting ? 'Working…' : 'Approve invoice'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={handleDispute}
                disabled={acting}
                style={[s.disputeBtn, acting && s.btnDisabled]}
                activeOpacity={0.85}
              >
                <Ionicons name="thumbs-down" size={16} color={C.red} />
                <Text style={s.disputeBtnText}>Dispute this invoice</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Admin actions — settle / void / adjudicate (RLS-gated server-side). */}
        {isAdmin && invoice.status !== 'paid' && invoice.status !== 'voided' && (
          <Animated.View entering={FadeInDown.delay(120).duration(240)} style={s.section}>
            <View style={s.sectionHeader}>
              <Ionicons name="shield-checkmark" size={14} color={C.primary} />
              <Text style={s.sectionTitle}>Admin actions</Text>
            </View>
            <Text style={s.sectionHint}>
              Settle, void, or adjudicate this invoice. Writes are enforced
              server-side by RLS.
            </Text>
            <View style={{ marginTop: 14, gap: 10 }}>
              {invoice.status === 'approved' && (
                <TouchableOpacity
                  onPress={handleMarkPaid}
                  disabled={acting}
                  style={[s.approveBtn, acting && s.btnDisabled]}
                  activeOpacity={0.85}
                >
                  {acting ? (
                    <ActivityIndicator color="#04150C" size="small" />
                  ) : (
                    <Ionicons name="checkmark-done" size={16} color="#04150C" />
                  )}
                  <Text style={s.approveBtnText}>{acting ? 'Working…' : 'Mark as paid'}</Text>
                </TouchableOpacity>
              )}
              {invoice.status === 'disputed' && (
                <TouchableOpacity
                  onPress={handleResolveApprove}
                  disabled={acting}
                  style={[s.approveBtn, acting && s.btnDisabled]}
                  activeOpacity={0.85}
                >
                  {acting ? (
                    <ActivityIndicator color="#04150C" size="small" />
                  ) : (
                    <Ionicons name="git-pull-request" size={16} color="#04150C" />
                  )}
                  <Text style={s.approveBtnText}>
                    {acting ? 'Working…' : 'Resolve dispute → approve'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={handleVoid}
                disabled={acting}
                style={[s.disputeBtn, acting && s.btnDisabled]}
                activeOpacity={0.85}
              >
                <Ionicons name="close-circle" size={16} color={C.red} />
                <Text style={s.disputeBtnText}>Void invoice</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {!canAct && !isAdmin && invoice.isOwn && (
          <View style={s.section}>
            <Text style={s.empty}>
              This invoice is {STATUS_LABEL[invoice.status].toLowerCase()}. No
              buyer-side actions available.
            </Text>
          </View>
        )}

        {/* Related job */}
        <TouchableOpacity
          onPress={() => router.push(`/(client)/jobs/${invoice.jobId}` as any)}
          style={s.relatedJob}
          activeOpacity={0.75}
        >
          <Ionicons name="briefcase" size={16} color={C.primary} />
          <View style={{ flex: 1 }}>
            <Text style={s.relatedJobLabel}>RELATED JOB</Text>
            <Text style={s.relatedJobTitle} numberOfLines={1}>
              {invoice.jobTitle ?? '(untitled job)'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={C.textMute} />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function StatusPill({ status }: { status: InvoiceStatus }) {
  const palette = {
    pending_review: { fg: C.amber, bg: C.amberDim, border: 'rgba(245,158,11,0.32)' },
    approved: { fg: C.primary, bg: C.primaryDim, border: 'rgba(124,58,237,0.32)' },
    disputed: { fg: C.red, bg: C.redDim, border: 'rgba(239,68,68,0.32)' },
    paid: { fg: C.green, bg: C.greenDim, border: 'rgba(16,185,129,0.32)' },
    voided: { fg: C.textMute, bg: 'rgba(255,255,255,0.04)', border: C.border },
  }[status];
  return (
    <View style={[s.pill, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[s.pillText, { color: palette.fg }]}>
        {STATUS_LABEL[status].toUpperCase()}
      </Text>
    </View>
  );
}

function Banner({
  tone, icon, children,
}: {
  tone: 'green' | 'red' | 'violet' | 'zinc';
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  const palette = {
    green: { bg: C.greenDim, border: 'rgba(16,185,129,0.32)', fg: C.green },
    red: { bg: C.redDim, border: 'rgba(239,68,68,0.32)', fg: C.red },
    violet: { bg: C.primaryDim, border: 'rgba(124,58,237,0.32)', fg: C.primary },
    zinc: { bg: 'rgba(255,255,255,0.04)', border: C.border, fg: C.textMute },
  }[tone];
  return (
    <View style={[s.banner, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Ionicons name={icon} size={18} color={palette.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function TotalRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={s.totalRow}>
      <Text style={[s.totalLabel, bold && s.totalLabelBold]}>{label}</Text>
      <Text style={[s.totalValue, bold && s.totalValueBold]}>{value}</Text>
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function numberOr(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function formatCents(cents: number, currency = 'USD'): string {
  if (!Number.isFinite(cents)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);
}
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function parseLineItems(raw: unknown): LineItem[] {
  if (Array.isArray(raw)) {
    return (raw as Array<Record<string, unknown>>).map((item) => ({
      kind: String(item.kind ?? 'item'),
      description: String(item.description ?? ''),
      amount_cents: numberOr(item.amount_cents, 0),
      contract_id: item.contract_id ? String(item.contract_id) : undefined,
    }));
  }
  return [];
}

// ─── Styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  scrollContent: { padding: 16, paddingBottom: 56, gap: 14 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 14, padding: 32 },
  centerText: { color: C.textSec, fontSize: 13, textAlign: 'center' },
  backBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: C.primaryDim },
  backBtnText: { color: C.primary, fontWeight: '700', fontSize: 13 },

  hero: {
    padding: 18, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(124,58,237,0.32)',
  },
  heroKicker: { color: 'rgba(124,58,237,0.85)', fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  heroNumber: { color: C.text, fontSize: 22, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },
  heroJob: { color: C.textSec, fontSize: 13, marginTop: 4 },
  heroBottomRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 },
  heroMeta: { color: C.textMute, fontSize: 10, fontFamily: 'monospace' },
  heroAmountBox: {
    marginTop: 16, padding: 14, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(124,58,237,0.32)', backgroundColor: 'rgba(124,58,237,0.08)',
  },
  heroAmountLabel: { color: 'rgba(124,58,237,0.85)', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  heroAmountValue: { color: C.text, fontSize: 26, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] },

  banner: {
    flexDirection: 'row', gap: 10, padding: 12,
    borderWidth: 1, borderRadius: 14,
  },
  bannerTitle: { color: C.text, fontWeight: '700', fontSize: 13 },
  bannerBody: { color: C.textSec, fontSize: 12, lineHeight: 17, marginTop: 2 },

  section: {
    padding: 16, borderRadius: 20, borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { color: C.text, fontSize: 15, fontWeight: '700' },
  sectionHint: { color: C.textMute, fontSize: 11, marginTop: 4, lineHeight: 15 },

  lineItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 12, gap: 12 },
  lineItemDivider: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
  lineItemKind: { color: 'rgba(124,58,237,0.85)', fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  lineItemDesc: { color: C.text, fontSize: 13, marginTop: 4, lineHeight: 18 },
  lineItemContract: { color: C.textMute, fontSize: 9, fontFamily: 'monospace', marginTop: 3 },
  lineItemAmount: { color: C.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },

  totalsBlock: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.border, gap: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { color: C.textSec, fontSize: 12 },
  totalLabelBold: { color: C.text, fontWeight: '700' },
  totalValue: { color: C.textSec, fontSize: 12, fontVariant: ['tabular-nums'] },
  totalValueBold: { color: C.text, fontWeight: '700', fontSize: 16 },
  totalDivider: { height: 1, backgroundColor: C.border, marginVertical: 4 },

  approveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: C.green,
  },
  approveBtnText: { color: '#04150C', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },
  disputeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.32)', backgroundColor: C.redDim,
  },
  disputeBtnText: { color: C.red, fontWeight: '700', fontSize: 13 },
  btnDisabled: { opacity: 0.5 },

  relatedJob: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  relatedJobLabel: { color: C.textMute, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  relatedJobTitle: { color: C.text, fontSize: 13, marginTop: 2 },

  empty: { color: C.textMute, fontSize: 13, textAlign: 'center', paddingVertical: 16 },

  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  pillText: { fontSize: 8.5, fontWeight: '700', letterSpacing: 0.5 },
});
