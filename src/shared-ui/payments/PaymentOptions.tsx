// ─────────────────────────────────────────────────────────────────
//  src/shared-ui/payments/PaymentOptions.tsx — payment posture (mobile)
//
//  Mirrors apps/web/src/components/payments/PaymentOptions.tsx so both
//  platforms state the same thing, and both are DRIVEN BY THE SERVER FLAG
//  (platform_settings.online_payments_enabled via nx_online_payments_enabled):
//
//    flag OFF → • Manual payment — Available now
//               • Online card payment — Coming soon (disabled, not pressable)
//    flag ON  → • Online card payment — Available (secure card payment)
//               • Manual payment — Also available
//
//  Reading the flag at render time means enabling live payments is a SERVER
//  action (set live Stripe keys, flip the flag) with no app-store rebuild.
//  Fail CLOSED: any error reading the flag renders the OFF state. The server
//  enforces the posture regardless (edge-function guard returns 403 while the
//  flag is false), so this panel is honest UI, never the boundary.
// ─────────────────────────────────────────────────────────────────

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';

export function useOnlinePaymentsEnabled(): boolean | null {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('nx_online_payments_enabled');
        if (alive) setEnabled(!error && data === true);
      } catch {
        if (alive) setEnabled(false);
      }
    })();
    return () => { alive = false; };
  }, []);
  return enabled;
}

export function PaymentOptions() {
  const online = useOnlinePaymentsEnabled();

  return (
    <View style={s.wrap} accessibilityLabel="Payment options">
      {online === true && (
        <View style={[s.card, s.available]} testID="payment-option-online-available">
          <View style={s.row}>
            <Text style={s.title}>Online card payment</Text>
            <View style={[s.badge, s.badgeOn]}>
              <Text style={s.badgeOnText}>AVAILABLE</Text>
            </View>
          </View>
          <Text style={s.body}>
            Pay securely by card. Processed by Stripe; NEXPEC never stores your
            card details.
          </Text>
        </View>
      )}

      <View style={[s.card, s.available]}>
        <View style={s.row}>
          <Text style={s.title}>Manual payment</Text>
          <View style={[s.badge, s.badgeOn]}>
            <Text style={s.badgeOnText}>{online === true ? 'ALSO AVAILABLE' : 'AVAILABLE NOW'}</Text>
          </View>
        </View>
        <Text style={s.body}>
          Bank transfer / invoice, handled by NEXPEC after the required
          approvals.
        </Text>
      </View>

      {online !== true && (
        <View
          style={[s.card, s.soon]}
          accessibilityState={{ disabled: true }}
          testID="payment-option-online-coming-soon"
          pointerEvents="none"
        >
          <View style={s.row}>
            <Text style={[s.title, s.titleMuted]}>Online card payment</Text>
            <View style={s.badge}>
              <Text style={s.badgeText}>COMING SOON</Text>
            </View>
          </View>
          <Text style={[s.body, s.bodyMuted]}>
            Secure online payments will be added in a future update.
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10, marginVertical: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14 },
  available: { borderColor: 'rgba(16,185,129,0.35)', backgroundColor: 'rgba(16,185,129,0.07)' },
  soon: { borderColor: '#1A1D3C', backgroundColor: 'rgba(255,255,255,0.02)', opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', flex: 1 },
  titleMuted: { color: '#94A3B8' },
  badge: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  badgeOn: { borderColor: 'rgba(16,185,129,0.4)', backgroundColor: 'rgba(16,185,129,0.12)' },
  badgeText: { color: '#64748B', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  badgeOnText: { color: '#10B981', fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  body: { color: '#94A3B8', fontSize: 12, marginTop: 6, lineHeight: 17 },
  bodyMuted: { color: '#64748B' },
});

export default PaymentOptions;
