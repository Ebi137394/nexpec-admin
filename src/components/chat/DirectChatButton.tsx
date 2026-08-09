// ════════════════════════════════════════════════════════════════════════════
//  src/components/chat/DirectChatButton.tsx
//  The ONLY entry point into Full-mode Client ↔ Inspector direct chat.
//
//  ── WHY A SHARED COMPONENT ─────────────────────────────────────────────────
//  Client and Inspector reach the same room from two different screens. If each
//  screen probed authorization on its own they would drift, and a drifted probe
//  is how a Protected job ends up rendering a "Message Inspector" button. One
//  component, one probe, one rule.
//
//  ── IT RENDERS NOTHING UNLESS THE SERVER SAYS YES ──────────────────────────
//  Product decision: Protected/Professional get NO disabled placeholder — the
//  affordance simply does not exist, because a greyed-out "Message Inspector"
//  advertises that direct contact is possible and invites the client to ask an
//  admin to flip the policy. `null` until nx_direct_chat_authorized() returns
//  true, and `null` again the moment it stops.
//
//  This is a CONVENIENCE gate, not a security gate. Rendering the button on a
//  job that does not qualify would still get 42501 from open_direct_conversation.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  isDirectChatAvailable, openDirectConversation,
  isSupplierInspectorChatAvailable, openSupplierInspectorConversation,
  isBuyerSupplierChatAvailable, openBuyerSupplierConversation,
  TWO_PARTY_ROUTE, type TwoPartyKind,
} from '@/lib/directChat';

interface Props {
  /** Which channel this button opens. Defaults to the Full-mode buyer↔inspector room. */
  channel?: TwoPartyKind;
  jobId?: string | null;
  inspectorId?: string | null;
  /** Required for job_supplier_inspector and buyer_supplier. */
  supplierId?: string | null;
  /** Required for buyer_supplier: the buyer principal, COALESCE(agency_id, client_id). */
  buyerId?: string | null;
  /** Viewer-appropriate copy. */
  label: string;
  style?: object;
}

export default function DirectChatButton({
  channel = 'job_client_inspector',
  jobId, inspectorId, supplierId, buyerId, label, style,
}: Props) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [opening, setOpening] = useState(false);

  // Re-probe on every focus. Identity mode is LIVE and admin-adjustable, so a
  // downgrade that happens while this screen sits in the navigation stack must
  // remove the button when the user comes back to it.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        let ok = false;
        if (channel === 'job_supplier_inspector') {
          if (jobId && inspectorId && supplierId) {
            ok = await isSupplierInspectorChatAvailable(jobId, inspectorId, supplierId);
          }
        } else if (channel === 'buyer_supplier') {
          if (buyerId && supplierId) {
            ok = await isBuyerSupplierChatAvailable(buyerId, supplierId);
          }
        } else if (jobId && inspectorId) {
          ok = await isDirectChatAvailable(jobId, inspectorId);
        }
        if (!cancelled) setAllowed(ok);
      })();
      return () => { cancelled = true; };
    }, [channel, jobId, inspectorId, supplierId, buyerId]),
  );

  const open = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    try {
      let conversationId: string | null = null;
      if (channel === 'job_supplier_inspector' && jobId && inspectorId && supplierId) {
        conversationId = await openSupplierInspectorConversation(jobId, inspectorId, supplierId);
      } else if (channel === 'buyer_supplier' && buyerId && supplierId) {
        conversationId = await openBuyerSupplierConversation(buyerId, supplierId);
      } else if (channel === 'job_client_inspector' && jobId && inspectorId) {
        conversationId = await openDirectConversation(jobId, inspectorId);
      }
      if (!conversationId) {
        setAllowed(false);
        Alert.alert('Unavailable', 'This conversation is not available.');
        return;
      }
      // Route segment matches the web path exactly, so the same link works on both.
      router.push(`/chat/${TWO_PARTY_ROUTE[channel]}/${conversationId}` as never);
    } finally {
      setOpening(false);
    }
  }, [channel, jobId, inspectorId, supplierId, buyerId, opening, router]);

  if (!allowed) return null;

  return (
    <TouchableOpacity
      style={[styles.button, style]}
      activeOpacity={0.85}
      onPress={open}
      disabled={opening}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {opening
        ? <ActivityIndicator size="small" color="#FFFFFF" />
        : <Ionicons name="chatbubble-ellipses-outline" size={18} color="#FFFFFF" />}
      <Text style={styles.text}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#7C3AED', borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16,
    marginTop: 12,
  },
  text: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
