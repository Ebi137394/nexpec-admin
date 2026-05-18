import React, { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

// ★ The real payment-method management UI lives in the Finance tab
//   (app/(tabs)/finance.tsx) — full Stripe integration, payment-method
//   cards, wallet balance, transactions, the works. This Profile shortcut
//   used to render an empty placeholder; now it just redirects to the
//   canonical screen so the user lands on the working flow.
export default function PaymentsScreen() {
  const router = useRouter();

  useEffect(() => {
    // replace() so the placeholder doesn't sit on the back stack
    const t = setTimeout(() => router.replace('/(tabs)/finance' as any), 0);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#7C3AED" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020420',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
