// ─────────────────────────────────────────────────────────────────
//  src/shared-ui/payments/PaymentOptions.tsx — release payment posture (mobile)
//
//  Mirrors apps/web/src/components/payments/PaymentOptions.tsx so both
//  platforms state the same thing:
//    • Manual payment — Available now
//    • Online card payment — Coming soon (subtle, disabled, NOT pressable)
//
//  The coming-soon card is a plain <View>, never a Touchable/Pressable, so
//  there is nothing to activate. The server enforces the posture separately
//  (platform_settings.online_payments_enabled + edge-function guard).
// ─────────────────────────────────────────────────────────────────

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function PaymentOptions() {
  return (
    <View style={s.wrap} accessibilityLabel="Payment options">
      <View style={[s.card, s.available]}>
        <View style={s.row}>
          <Text style={s.title}>Manual payment</Text>
          <View style={[s.badge, s.badgeOn]}>
            <Text style={s.badgeOnText}>AVAILABLE NOW</Text>
          </View>
        </View>
        <Text style={s.body}>
          Handled manually by NEXPEC after the required approvals.
        </Text>
      </View>

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
