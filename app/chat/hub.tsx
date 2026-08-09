// ════════════════════════════════════════════════════════════════════════════
//  app/chat/hub.tsx — the jobless two-party entry point (mobile).
//  Mirror of the web pages /chat/suppliers and /chat/buyers, merged into one
//  screen because mobile has less room for two near-identical destinations.
//
//  ── WHY A HUB IS REQUIRED, NOT A CONVENIENCE ───────────────────────────────
//  A buyer↔supplier relationship exists from the moment admin PRESENTS a quote,
//  which is long before any inspection job exists — and for a purely
//  procurement RFQ (requires_source_inspection = false) no job is EVER spawned.
//  A job-scoped button therefore physically cannot reach those relationships.
//
//  Both lists come from resolvers that filter through the same gates the
//  open_* RPCs enforce, so this screen can never offer a room the server would
//  refuse. It also cannot leak the brokered shortlist: nx_my_chattable_suppliers
//  requires a presented/accepted quote, never a merely submitted one.
// ════════════════════════════════════════════════════════════════════════════

import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import DirectChatButton from '@/src/components/chat/DirectChatButton';

const COLORS = {
  background: '#020420', card: '#0A0D2C', border: '#1A1D3C',
  primary: '#7C3AED', text: '#FFFFFF', textSecondary: '#94A3B8', textMuted: '#64748B',
};

interface BuyerSideRow {
  buyer_id: string;
  supplier_id: string;
  supplier_name: string | null;
  rfq_id: string | null;
  rfq_title: string | null;
  relationship: string | null;
}

interface SupplierSideRow {
  channel: 'buyer_supplier' | 'job_supplier_inspector';
  supplier_id: string;
  buyer_id: string | null;
  buyer_name: string | null;
  job_id: string | null;
  job_title: string | null;
  inspector_id: string | null;
  rfq_id: string | null;
  rfq_title: string | null;
}

export default function ChatHubScreen() {
  const router = useRouter();
  const [asBuyer, setAsBuyer] = useState<BuyerSideRow[]>([]);
  const [asSupplier, setAsSupplier] = useState<SupplierSideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    // Both resolvers are safe to call from any role: a non-buyer gets an empty
    // buyer list, a non-supplier gets an empty supplier list. No role check here.
    const [buyerRes, supplierRes] = await Promise.all([
      supabase.rpc('nx_my_chattable_suppliers'),
      supabase.rpc('nx_my_supplier_chat_targets'),
    ]);
    if (buyerRes.error) console.warn('[chatHub] buyer side:', buyerRes.error.message);
    if (supplierRes.error) console.warn('[chatHub] supplier side:', supplierRes.error.message);
    setAsBuyer((buyerRes.data as BuyerSideRow[] | null) ?? []);
    setAsSupplier((supplierRes.data as SupplierSideRow[] | null) ?? []);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const buyerRooms = asSupplier.filter((r) => r.channel === 'buyer_supplier');
  const inspections = asSupplier.filter((r) => r.channel === 'job_supplier_inspector');
  const empty = asBuyer.length === 0 && asSupplier.length === 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <Text style={styles.title}>Conversations</Text>
        <Text style={styles.sub}>Suppliers, buyers and inspection coordination</Text>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); }}
              tintColor={COLORS.primary}
            />
          }
        >
          {empty && (
            <View style={styles.center}>
              <Ionicons name="chatbubbles-outline" size={38} color={COLORS.textMuted} />
              <Text style={styles.emptyText}>
                No direct relationships yet. Suppliers appear once NEXPEC presents a
                quote; inspections appear once an inspector is assigned.
              </Text>
            </View>
          )}

          {asBuyer.length > 0 && (
            <>
              <Text style={styles.section}>Your suppliers</Text>
              {asBuyer.map((r) => (
                <View key={`b:${r.buyer_id}:${r.supplier_id}`} style={styles.card}>
                  <Text style={styles.cardTitle}>{r.supplier_name ?? 'Supplier'}</Text>
                  <Text style={styles.cardSub}>
                    {r.rfq_title ?? 'RFQ'} · {r.relationship ?? 'presented'}
                  </Text>
                  <DirectChatButton
                    channel="buyer_supplier"
                    buyerId={r.buyer_id}
                    supplierId={r.supplier_id}
                    label="Message Supplier"
                  />
                </View>
              ))}
            </>
          )}

          {buyerRooms.length > 0 && (
            <>
              <Text style={styles.section}>Your buyers</Text>
              {buyerRooms.map((r) => (
                <View key={`s:${r.buyer_id}:${r.rfq_id}`} style={styles.card}>
                  <Text style={styles.cardTitle}>{r.buyer_name ?? 'Buyer'}</Text>
                  <Text style={styles.cardSub}>{r.rfq_title ?? 'RFQ'}</Text>
                  <DirectChatButton
                    channel="buyer_supplier"
                    buyerId={r.buyer_id}
                    supplierId={r.supplier_id}
                    label="Message Buyer"
                  />
                </View>
              ))}
            </>
          )}

          {inspections.length > 0 && (
            <>
              <Text style={styles.section}>Inspections at your facility</Text>
              {inspections.map((r) => (
                <View key={`i:${r.job_id}`} style={styles.card}>
                  <Text style={styles.cardTitle}>{r.job_title ?? 'Inspection'}</Text>
                  <Text style={styles.cardSub}>{r.rfq_title ?? 'Source / FAT inspection'}</Text>
                  <DirectChatButton
                    channel="job_supplier_inspector"
                    jobId={r.job_id}
                    inspectorId={r.inspector_id}
                    supplierId={r.supplier_id}
                    label="Message Inspector"
                  />
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, backgroundColor: COLORS.card,
  },
  title: { color: COLORS.text, fontSize: 18, fontWeight: '700' },
  sub: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  list: { padding: 14, paddingBottom: 28, flexGrow: 1 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyText: { color: COLORS.textMuted, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  section: {
    color: COLORS.textSecondary, fontSize: 11, fontWeight: '800',
    letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 16, marginBottom: 8,
  },
  card: {
    backgroundColor: COLORS.card, borderRadius: 12, borderWidth: 1,
    borderColor: COLORS.border, padding: 14, marginBottom: 10,
  },
  cardTitle: { color: COLORS.text, fontSize: 15, fontWeight: '700' },
  cardSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2 },
});
