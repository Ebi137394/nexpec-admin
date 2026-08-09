// ════════════════════════════════════════════════════════════════════════════
//  src/components/chat/JobChatActions.tsx
//  Every two-party chat entry point for a job, in one self-resolving block.
//
//  ── WHY ONE COMPONENT INSTEAD OF BUTTONS PER SCREEN ────────────────────────
//  These entry points belong on the buyer job screen, the inspector job screen
//  and the supplier's job/contract screens — each of which holds a different
//  subset of ids in local state. Letting each screen derive the counterpart
//  ids is precisely how a Web/Mobile (or screen-to-screen) divergence starts:
//  one forgets agency_id, another reads a stale proposal row, and the same user
//  sees a button in one place and not another.
//
//  So this component derives NOTHING. It asks nx_job_chat_counterparts(job),
//  which returns only the ids the caller is already authorized to message and
//  says which side they are on. The web app calls the same function. One
//  answer, two platforms.
//
//  Renders nothing at all when no channel is open — no disabled placeholders,
//  because a greyed-out "Message Inspector" advertises a capability the viewer
//  is not supposed to have and invites lobbying an admin to flip the policy.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import DirectChatButton from './DirectChatButton';

interface Counterparts {
  buyer_id: string | null;
  inspector_id: string | null;
  supplier_id: string | null;
  can_chat_inspector: boolean;
  can_chat_supplier: boolean;
  viewer_side: 'buyer' | 'inspector' | 'supplier' | 'none';
}

interface Props {
  jobId?: string | null;
  /** Optional heading, shown only when at least one channel is available. */
  heading?: string;
  style?: object;
}

export default function JobChatActions({ jobId, heading, style }: Props) {
  const [cp, setCp] = useState<Counterparts | null>(null);

  // Re-resolve on focus: identity mode is live and admin-adjustable, contracts
  // get voided, suppliers get replaced. A button must disappear when the
  // relationship behind it does.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!jobId) { setCp(null); return; }
      (async () => {
        const { data, error } = await supabase.rpc('nx_job_chat_counterparts', {
          p_job_id: jobId,
        });
        if (cancelled) return;
        if (error) {
          console.warn('[JobChatActions] resolve failed:', error.message);
          setCp(null);
          return;
        }
        const row = Array.isArray(data) ? (data[0] as Counterparts | undefined) : null;
        setCp(row ?? null);
      })();
      return () => { cancelled = true; };
    }, [jobId]),
  );

  if (!jobId || !cp || cp.viewer_side === 'none') return null;

  const side = cp.viewer_side;

  // Buyer side: the inspector room (Full only) and the supplier room.
  const showBuyerInspector = side === 'buyer' && cp.can_chat_inspector && !!cp.inspector_id;
  const showBuyerSupplier = side === 'buyer' && cp.can_chat_supplier && !!cp.supplier_id && !!cp.buyer_id;
  // Inspector side: the supplier coordination room.
  const showInspectorSupplier = side === 'inspector' && cp.can_chat_supplier && !!cp.supplier_id;
  // Supplier side: the inspector coordination room, and the buyer commerce room.
  const showSupplierInspector = side === 'supplier' && cp.can_chat_supplier && !!cp.inspector_id;
  const showSupplierBuyer = side === 'supplier' && !!cp.buyer_id;

  const any =
    showBuyerInspector || showBuyerSupplier || showInspectorSupplier ||
    showSupplierInspector || showSupplierBuyer;
  if (!any) return null;

  return (
    <View style={style}>
      {heading ? <Text style={styles.heading}>{heading}</Text> : null}

      {showBuyerInspector && (
        <DirectChatButton
          channel="job_client_inspector"
          jobId={jobId}
          inspectorId={cp.inspector_id}
          label="Message Inspector"
        />
      )}

      {showBuyerSupplier && (
        <DirectChatButton
          channel="buyer_supplier"
          buyerId={cp.buyer_id}
          supplierId={cp.supplier_id}
          label="Message Supplier"
        />
      )}

      {showInspectorSupplier && (
        <DirectChatButton
          channel="job_supplier_inspector"
          jobId={jobId}
          inspectorId={cp.inspector_id}
          supplierId={cp.supplier_id}
          label="Message Supplier"
        />
      )}

      {showSupplierInspector && (
        <DirectChatButton
          channel="job_supplier_inspector"
          jobId={jobId}
          inspectorId={cp.inspector_id}
          supplierId={cp.supplier_id}
          label="Message Inspector"
        />
      )}

      {showSupplierBuyer && (
        <DirectChatButton
          channel="buyer_supplier"
          buyerId={cp.buyer_id}
          supplierId={cp.supplier_id}
          label="Message Buyer"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: {
    color: '#94A3B8', fontSize: 11, fontWeight: '800',
    letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 18,
  },
});
