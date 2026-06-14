import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { toCents } from '@/lib/money';

const COLORS = {
  background: '#020420',
  cardBackground: '#1e293b',
  cardBorder: '#334155',
  primary: '#3b82f6',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  success: '#10B981',
};

export default function SubmitProposalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); 
  const router = useRouter();
  const { user } = useAuth();

  const [bidAmount, setBidAmount] = useState('');
  const [coverLetter, setCoverLetter] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!bidAmount.trim()) {
      Alert.alert('Error', 'Please enter your bid amount.');
      return;
    }
    if (!coverLetter.trim()) {
      Alert.alert('Error', 'Please include a short cover letter.');
      return;
    }

    // Validate the bid is a real, positive amount. toCents() returns 0 for
    // non-numeric input and rounds negatives, so an empty/garbage/negative
    // string must be rejected before it reaches the admin negotiation flow.
    const bidCents = toCents(bidAmount);
    if (!Number.isFinite(bidCents) || bidCents <= 0) {
      Alert.alert('Error', 'Enter a valid bid amount greater than zero.');
      return;
    }

    setLoading(true);

    try {
      // ★ HIRE-008: canonical applications table, canonical columns only.
      //   `applications` does NOT have inspector_id / user_id columns —
      //   confirmed by the table-consolidation migration. applicant_id
      //   is the single source of truth for the inspector identity.
      const { error } = await supabase
        .from('applications')
        .insert({
          job_id: id,
          applicant_id: user?.id,
          bid_amount_cents: bidCents,
          cover_note: coverLetter,
          status: 'pending',
        });

      if (error) {
        if (error.code === '23505') {
          Alert.alert('Already Applied', 'You have already submitted a proposal for this job.');
        } else {
          throw error;
        }
      } else {
        Alert.alert('Success', 'Your proposal has been sent!', [
          { text: 'OK', onPress: () => router.navigate('/(tabs)/jobs') }
        ]);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="close" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Submit Proposal</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.content}>

          <View style={styles.infoBox}>
            <Ionicons name="bulb-outline" size={20} color={COLORS.primary} />
            <Text style={styles.infoText}>
              Send a competitive bid. The client will review your profile and price.
            </Text>
          </View>

          <Text style={styles.label}>Your Bid ($)</Text>
          <View style={styles.inputContainer}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor={COLORS.textSecondary}
              keyboardType="decimal-pad"
              value={bidAmount}
              onChangeText={setBidAmount}
            />
          </View>

          <Text style={styles.label}>Cover Letter</Text>
          <View style={[styles.inputContainer, styles.textAreaContainer]}>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Introduce yourself..."
              placeholderTextColor={COLORS.textSecondary}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              value={coverLetter}
              onChangeText={setCoverLetter}
            />
          </View>

        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabledButton]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Application</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.textPrimary },
  backButton: { padding: 4 },
  content: { padding: 20 },
  infoBox: {
    flexDirection: 'row', backgroundColor: '#3b82f620', padding: 16,
    borderRadius: 12, marginBottom: 24, gap: 12, alignItems: 'center'
  },
  infoText: { color: '#93C5FD', fontSize: 14, flex: 1 },
  label: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary, marginBottom: 8 },
  inputContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.cardBackground,
    borderWidth: 1, borderColor: COLORS.cardBorder, borderRadius: 12,
    paddingHorizontal: 16, marginBottom: 24
  },
  currency: { fontSize: 18, color: COLORS.success, fontWeight: 'bold', marginRight: 8 },
  input: { flex: 1, color: COLORS.textPrimary, fontSize: 16, paddingVertical: 16 },
  textAreaContainer: { alignItems: 'flex-start', minHeight: 120 },
  textArea: { height: 100, textAlignVertical: 'top' },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  submitButton: {
    backgroundColor: COLORS.primary, padding: 16, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center'
  },
  disabledButton: { opacity: 0.7 },
  submitButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
});