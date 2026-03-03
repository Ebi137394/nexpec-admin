import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// ============================================
// Color Constants - Dark Theme
// ============================================
const COLORS = {
  background: '#020420',
  cardBackground: '#0A0E2E',
  cardBorder: '#1A1F4E',
  primary: '#7C3AED', // Purple
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  inputBg: '#111640',
  success: '#10B981',
};

export default function CreateJobScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    price: '',
  });

  const handleCreate = async () => {
    // 1. Validation
    if (!formData.title || !formData.description || !formData.location || !formData.price) {
      Alert.alert('Missing Fields', 'Please fill in all fields to post a job.');
      return;
    }

    if (!user) {
      Alert.alert('Error', 'You must be logged in to post a job.');
      return;
    }

    setLoading(true);

    try {
      // 2. Insert into Supabase
      const { error } = await supabase
        .from('jobs')
        .insert({
          title: formData.title,
          description: formData.description,
          location: formData.location,
          price: parseFloat(formData.price), // Convert string to number
          client_id: user.id,
          status: 'open', // Default status
        });

      if (error) throw error;

      // 3. Success
      Alert.alert('Success', 'Job posted successfully!', [
        {
          text: 'OK',
          onPress: () => router.replace('/(tabs)/my-jobs') // Redirect to My Jobs
        }
      ]);

    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post a New Job</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>

          {/* Info Card */}
          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={24} color={COLORS.primary} />
            <Text style={styles.infoText}>
              Describe the inspection work required. Inspectors will see this in the Browse tab.
            </Text>
          </View>

          {/* Form Fields */}
          <View style={styles.formGroup}>
            <Text style={styles.label}>Job Title</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Welding Inspection for Pipeline"
              placeholderTextColor={COLORS.textMuted}
              value={formData.title}
              onChangeText={(text) => setFormData({ ...formData, title: text })}
            />
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Location</Text>
            <View style={styles.iconInput}>
              <Ionicons name="location-outline" size={20} color={COLORS.textMuted} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { flex: 1, borderWidth: 0, marginTop: 0 }]}
                placeholder="e.g. Houston, TX (or Remote)"
                placeholderTextColor={COLORS.textMuted}
                value={formData.location}
                onChangeText={(text) => setFormData({ ...formData, location: text })}
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Price ($)</Text>
            <View style={styles.iconInput}>
              <Text style={styles.currencySymbol}>$</Text>
              <TextInput
                style={[styles.input, { flex: 1, borderWidth: 0, marginTop: 0 }]}
                placeholder="0.00"
                placeholderTextColor={COLORS.textMuted}
                keyboardType="numeric"
                value={formData.price}
                onChangeText={(text) => setFormData({ ...formData, price: text })}
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Provide details about the inspection requirements, certifications needed, and timeline..."
              placeholderTextColor={COLORS.textMuted}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              value={formData.description}
              onChangeText={(text) => setFormData({ ...formData, description: text })}
            />
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.disabledButton]}
            onPress={handleCreate}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons name="add-circle-outline" size={20} color="#FFF" />
                <Text style={styles.submitButtonText}>Post Job Now</Text>
              </>
            )}
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20
  },
  backButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.cardBackground,
    justifyContent: 'center', alignItems: 'center'
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.textPrimary },
  scrollContent: { padding: 20, paddingBottom: 40 },

  // Info Card
  infoCard: {
    flexDirection: 'row', backgroundColor: COLORS.cardBackground, padding: 16,
    borderRadius: 16, marginBottom: 24, borderWidth: 1, borderColor: COLORS.cardBorder,
    alignItems: 'center', gap: 12
  },
  infoText: { color: COLORS.textSecondary, fontSize: 13, flex: 1, lineHeight: 20 },

  // Form
  formGroup: { marginBottom: 20 },
  label: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: {
    backgroundColor: COLORS.inputBg, borderRadius: 12, padding: 16,
    color: COLORS.textPrimary, fontSize: 15, borderWidth: 1, borderColor: COLORS.cardBorder
  },
  textArea: { minHeight: 120 },

  // Icon Inputs (Location/Price)
  iconInput: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.inputBg,
    borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder, paddingHorizontal: 16
  },
  inputIcon: { marginRight: 8 },
  currencySymbol: { color: COLORS.success, fontSize: 18, fontWeight: 'bold', marginRight: 8 }, // Green $ sign

  // Button
  submitButton: {
    backgroundColor: COLORS.primary, flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', padding: 18, borderRadius: 16, marginTop: 20, gap: 8
  },
  disabledButton: { opacity: 0.7 },
  submitButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
});
