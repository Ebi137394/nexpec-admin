// app/payment-screen.tsx
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useStripe } from '@stripe/stripe-react-native';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

type Params = {
  projectId?: string;
  amount?: string; // will parse to number
};

export default function PaymentScreen() {
  const { projectId, amount } = useLocalSearchParams<Params>();
  const numericAmount = amount ? Number(amount) : 0;
  const [loading, setLoading] = useState(false);
  const [paymentReady, setPaymentReady] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const router = useRouter();

  useEffect(() => {
    if (!projectId || !numericAmount || Number.isNaN(numericAmount)) {
      Alert.alert('Invalid payment', 'Missing project or amount.');
      return;
    }
    initializePaymentSheet();
  }, [projectId, numericAmount]);

  async function fetchPaymentParams() {
    try {
      setLoading(true);

      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/create-payment-intent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          // amount in cents
          body: JSON.stringify({
            amount: Math.round(numericAmount * 100),
            currency: 'CAD',
            projectId,
          }),
        }
      );

      if (!response.ok) {
        const errorPayload = await response.text();
        console.error('Edge function error:', errorPayload);
        throw new Error('Failed to create payment intent.');
      }

      const json = await response.json();
      if (!json.clientSecret) {
        throw new Error('Missing clientSecret in response.');
      }

      setClientSecret(json.clientSecret);
      return json.clientSecret as string;
    } catch (err: any) {
      console.error('fetchPaymentParams error:', err);
      Alert.alert('Error', err.message ?? 'Failed to prepare payment.');
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function initializePaymentSheet() {
    const secret = await fetchPaymentParams();
    if (!secret) return;

    const { error } = await initPaymentSheet({
      paymentIntentClientSecret: secret,
      merchantDisplayName: 'NEXPEC Inspections',
      defaultBillingDetails: {
        name: 'NEXPEC Client',
      },
      // test mode settings; adjust for production
      allowsDelayedPaymentMethods: false,
    });

    if (error) {
      console.error('initPaymentSheet error:', error);
      Alert.alert('Error', error.message);
      return;
    }

    setPaymentReady(true);
  }

  async function openPaymentSheet() {
    if (!clientSecret) {
      Alert.alert('Error', 'Payment is not ready yet.');
      return;
    }

    const { error } = await presentPaymentSheet({
      clientSecret,
    });

    if (error) {
      console.error('presentPaymentSheet error:', error);
      Alert.alert('Payment failed', error.message);
      return;
    }

    Alert.alert('Payment successful', 'Thank you for your payment.', [
      {
        text: 'OK',
        onPress: () => router.push({ pathname: '/project-details', params: { id: projectId } }),
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: 'Payment',
          headerTitleStyle: { color: '#FFFFFF' },
          headerStyle: { backgroundColor: '#0F172A' },
          headerTintColor: '#FFFFFF',
        }}
      />

      <View style={styles.content}>
        <Text style={styles.title}>Project Payment</Text>
        <Text style={styles.subtitle}>
          You are hiring an inspector for this project.
        </Text>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Project ID</Text>
          <Text style={styles.summaryValue}>{projectId ?? 'N/A'}</Text>

          <Text style={[styles.summaryLabel, { marginTop: 16 }]}>
            Total Amount
          </Text>
          <Text style={styles.amountText}>
            ${numericAmount.toFixed(2)} CAD
          </Text>
        </View>

        {loading && (
          <ActivityIndicator
            size="large"
            color="#3B82F6"
            style={{ marginTop: 24 }}
          />
        )}

        <TouchableOpacity
          style={[
            styles.payButton,
            (!paymentReady || loading) && { opacity: 0.6 },
          ]}
          onPress={openPaymentSheet}
          disabled={!paymentReady || loading}
        >
          <Text style={styles.payButtonText}>
            {paymentReady ? 'Pay Now' : 'Preparing Payment…'}
          </Text>
        </TouchableOpacity>

        <Text style={styles.helperText}>
          Payments are securely processed by Stripe. Your card details are not
          stored by NEXPEC.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  title: {
    color: '#F9FAFB',
    fontSize: 20,
    fontWeight: '700',
    marginTop: 8,
  },
  subtitle: {
    color: '#9CA3AF',
    fontSize: 14,
    marginTop: 4,
  },
  summaryCard: {
    marginTop: 24,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  summaryLabel: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  summaryValue: {
    color: '#E5E7EB',
    fontSize: 14,
    marginTop: 2,
  },
  amountText: {
    color: '#22C55E',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 4,
  },
  payButton: {
    marginTop: 32,
    backgroundColor: '#3B82F6',
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  payButtonText: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
  },
  helperText: {
    marginTop: 16,
    color: '#6B7280',
    fontSize: 12,
  },
});

