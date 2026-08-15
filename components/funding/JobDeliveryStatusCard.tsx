// ════════════════════════════════════════════════════════════════════════════
//  components/funding/JobDeliveryStatusCard.tsx — Mobile delivery-policy card
//
//  Shows the CLIENT where a job stands on final-report delivery: Strict Prepay
//  (balance due before delivery) or Approved Credit Release (report already
//  released, balance invoiced on Net terms).
//
//  ── FUNDING IS INTENTIONALLY WEB-ONLY ──────────────────────────────────────
//  There is no in-app payment here and none should be added. Card entry lives
//  on the Web funding page, which already carries the Stripe integration, the
//  RLS-scoped reads and the audit trail. This card therefore READS state and
//  hands off through a link — it never collects payment details, and adding an
//  in-app payment sheet would duplicate a money path that exists once on
//  purpose.
//
//  ── WORDING COMES FROM THE SHARED CONTRACT ─────────────────────────────────
//  Every sentence is produced by deliveryStatusCopy() in
//  @nexpec/shared-core/domain — the same function the Web client uses. Mobile
//  cannot say "Final delivery blocked" for a credit-released job, and cannot
//  say it for an OVERDUE one either, because the contract does not emit that
//  string in those states. Composing copy locally is exactly the drift this
//  module exists to prevent.
//
//  ── PRIVACY ────────────────────────────────────────────────────────────────
//  Reads only the client-visible columns of job_funding_stages. RLS policy
//  job_funding_stages_client_read scopes rows to the buyer's own jobs, and no
//  inspector payout or platform spread column is selected or rendered.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, ActivityIndicator } from 'react-native';
import { AlertTriangle, CheckCircle, Clock, ExternalLink } from 'lucide-react-native';

//  Package ROOT, not the /domain subpath: Metro does not resolve this
//  package's subpath exports, and every other mobile screen imports the root.
import {
  deliveryStatusCopy,
  formatCents,
  invoiceStatusLabel,
  type InvoiceStatus,
} from '@nexpec/shared-core';

import { supabase } from '@/lib/supabase';

/* Same fallback convention as GlobalSearchModal: the public web base, used
   because funding deliberately has no native screen. */
const WEB_BASE =
  (process.env.EXPO_PUBLIC_WEB_URL && process.env.EXPO_PUBLIC_WEB_URL.replace(/\/$/, '')) ||
  'https://nexpec.com';

interface StageRow {
  code: string;
  status: string;
  amount_cents: number | null;
  gates_delivery: boolean | null;
  net_term_days: number | null;
  invoice_due_at: string | null;
}

/** Mirrors nx_funding_invoice_status so one vocabulary governs every surface. */
function deriveStatus(status: string, dueAt: string | null): InvoiceStatus {
  if (status === 'funded') return 'paid';
  if (status === 'waived') return 'waived';
  if (!dueAt) return 'open';
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  if (now > due) return 'overdue';
  if (now > due - 7 * 24 * 60 * 60 * 1000) return 'due_soon';
  return 'open';
}

export function JobDeliveryStatusCard({ jobId }: { jobId: string }) {
  const [stages, setStages] = useState<StageRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('job_funding_stages')
      .select('code, status, amount_cents, gates_delivery, net_term_days, invoice_due_at')
      .eq('job_id', jobId);
    if (error) {
      setFailed(true);
      return;
    }
    setStages((data ?? []) as StageRow[]);
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    //  Say the read failed. Rendering nothing would be indistinguishable from
    //  "fully funded", which is the opposite of the truth.
    return (
      <View style={[styles.card, styles.warn]}>
        <Text style={styles.headline}>Funding status unavailable</Text>
        <Text style={styles.detail}>
          We could not load this job&apos;s funding position. This is not a
          confirmation that nothing is outstanding.
        </Text>
      </View>
    );
  }

  if (stages === null) {
    return (
      <View style={styles.card}>
        <ActivityIndicator />
      </View>
    );
  }

  const finalStage = stages.find((s) => s.code === 'final');
  if (!finalStage) return null;

  const outstandingCents = stages
    .filter((s) => s.status !== 'funded' && s.status !== 'waived')
    .reduce((sum, s) => sum + (s.amount_cents ?? 0), 0);

  const invoiceStatus = deriveStatus(finalStage.status, finalStage.invoice_due_at);
  const copy = deliveryStatusCopy({
    gatesDelivery: finalStage.gates_delivery ?? true,
    remainingCents: outstandingCents,
    netTermDays: (finalStage.net_term_days as 15 | 30 | 60 | null) ?? null,
    invoiceDueAt: finalStage.invoice_due_at,
    invoiceStatus,
  });

  const Icon =
    copy.tone === 'blocked' ? AlertTriangle : copy.tone === 'settled' ? CheckCircle : Clock;
  const toneStyle =
    copy.tone === 'blocked' ? styles.warn : copy.tone === 'settled' ? styles.ok : styles.info;

  return (
    <View style={[styles.card, toneStyle]}>
      <View style={styles.row}>
        <Icon size={18} color="#e4e4e7" />
        <Text style={styles.headline}>{copy.headline}</Text>
      </View>

      {copy.detail ? <Text style={styles.detail}>{copy.detail}</Text> : null}

      {/* Exact figures, always shown when a balance is outstanding. */}
      {outstandingCents > 0 ? (
        <View style={styles.figures}>
          <Text style={styles.figure}>
            Remaining balance: {formatCents(outstandingCents)}
          </Text>
          {finalStage.invoice_due_at ? (
            <Text style={styles.figure}>
              Due:{' '}
              {new Date(finalStage.invoice_due_at).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </Text>
          ) : null}
          <Text style={styles.figure}>
            Invoice status: {invoiceStatusLabel(invoiceStatus)}
          </Text>
        </View>
      ) : null}

      {/* Funding is Web-only by design — hand off, never collect payment here. */}
      {outstandingCents > 0 ? (
        <TouchableOpacity
          accessibilityRole="link"
          accessibilityLabel="Open the secure funding page on the web"
          style={styles.link}
          onPress={() => {
            void Linking.openURL(`${WEB_BASE}/client/jobs/${jobId}/funding`);
          }}
        >
          <ExternalLink size={14} color="#c4b5fd" />
          <Text style={styles.linkText}>Open secure funding page</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  warn: { borderColor: 'rgba(251,191,36,0.35)', backgroundColor: 'rgba(251,191,36,0.06)' },
  info: { borderColor: 'rgba(167,139,250,0.35)', backgroundColor: 'rgba(167,139,250,0.06)' },
  ok: { borderColor: 'rgba(52,211,153,0.35)', backgroundColor: 'rgba(52,211,153,0.06)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headline: { color: '#fafafa', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  detail: { color: '#d4d4d8', fontSize: 13, marginTop: 6, lineHeight: 18 },
  figures: { marginTop: 10, gap: 2 },
  figure: { color: '#a1a1aa', fontSize: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  linkText: { color: '#c4b5fd', fontSize: 13, fontWeight: '600' },
});
