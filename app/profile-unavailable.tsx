// ─────────────────────────────────────────────────────────────────
//  app/profile-unavailable.tsx — D38: signed-in offline screen.
//
//  Shown by the AuthGate when the profile fetch is UNAVAILABLE
//  (offline / network / Supabase failure) and no last-validated
//  snapshot exists. This is explicitly NOT the stance chooser: an
//  unavailable fetch is not an answer about the user's stance.
//  AuthContext rehydrates automatically when connectivity returns;
//  the gate then routes to the real destination. Retry is manual
//  rehydration for impatient humans.
// ─────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { useAuth } from '@/src/contexts/AuthContext';

export default function ProfileUnavailable() {
  const { refreshOrganization, signOut } = useAuth();
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    setBusy(true);
    try {
      await refreshOrganization();
      // On success profileSource flips to 'network' and the AuthGate
      // re-routes away from this screen on its next pass.
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0B1020', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 }} testID="profile-unavailable">
      <WifiOff size={40} color="#8B5CF6" />
      <Text style={{ color: '#F1F5F9', fontSize: 20, fontWeight: '700', textAlign: 'center' }}>
        You appear to be offline
      </Text>
      <Text style={{ color: '#9AA8C7', fontSize: 14, textAlign: 'center', lineHeight: 20 }}>
        Your profile can't be loaded right now, and no saved copy exists on this
        device yet. Nothing about your account has changed — we'll reconnect
        automatically as soon as you're back online.
      </Text>
      <Pressable
        onPress={retry}
        disabled={busy}
        testID="profile-unavailable-retry"
        style={{ backgroundColor: '#7C3AEC', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 28, marginTop: 8, opacity: busy ? 0.6 : 1, minWidth: 160, alignItems: 'center' }}
      >
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Retry</Text>}
      </Pressable>
      <Pressable onPress={() => void signOut()} style={{ padding: 10 }}>
        <Text style={{ color: '#64748B', fontSize: 13 }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
