import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Alert, // Added standard Alert as backup
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

// Helper function for alerts (in case @/lib/alert doesn't exist)
const showAlert = (title: string, msg: string, onPress?: () => void) => {
  Alert.alert(title, msg, onPress ? [{ text: 'OK', onPress }] : [{ text: 'OK' }]);
};

const showConfirm = (title: string, msg: string, onConfirm: () => void) => {
  Alert.alert(title, msg, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Discard', style: 'destructive', onPress: onConfirm },
  ]);
};

export default function PostJobScreen() {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [dayRate, setDayRate] = useState('');
  const [currency, setCurrency] = useState('CAD');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const validateInputs = (): boolean => {
    if (!title.trim()) { showAlert('Error', 'Please enter a project title'); return false; }
    if (!location.trim()) { showAlert('Error', 'Please enter a location'); return false; }
    if (!dayRate.trim()) { showAlert('Error', 'Please enter a rate'); return false; }
    if (isNaN(parseFloat(dayRate))) { showAlert('Error', 'Invalid rate'); return false; }
    if (!description.trim()) { showAlert('Error', 'Please enter a description'); return false; }
    return true;
  };

  const handlePostJob = async () => {
    if (!validateInputs()) return;

    try {
      setLoading(true);
      
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        throw new Error('You must be logged in to post a job');
      }

      // ✅ FIX: Map inputs to the ACTUAL database columns
      // DB has: price, location. It does NOT have: budget, location_city.
      const jobData = {
        client_id: user.id,
        title: title.trim(),
        location: location.trim(), // Fixed: Mapped 'location' to 'location'
        price: parseFloat(dayRate.trim()), // Fixed: Mapped 'dayRate' to 'price'
        description: description.trim(),
        status: 'open',
        // Note: 'currency', 'job_type', 'urgency' are omitted because they aren't in your DB yet.
        // If you need them, we must add columns to Supabase first.
        // For now, this prevents the crash.
      };

      const { error: insertError } = await supabase
        .from('jobs')
        .insert([jobData]);

      if (insertError) throw insertError;

      showAlert(
        'Success! 🎉',
        'Your job has been posted successfully.',
        () => router.back()
      );

    } catch (error: any) {
      console.error('💥 Error posting job:', error);
      showAlert('Error', error.message || 'Failed to post job.');
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    const hasData = title || location || dayRate || description;
    if (hasData) {
      showConfirm(
        'Discard Changes?',
        'You have unsaved changes. Are you sure you want to go back?',
        () => router.back()
      );
    } else {
      router.back();
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#F1F5F9" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post a New Job</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Project Title <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputContainer}>
            <Ionicons name="briefcase-outline" size={20} color="#94A3B8" />
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Valve Inspection"
              placeholderTextColor="#64748B"
              maxLength={100}
            />
          </View>
          <Text style={styles.charCount}>{title.length}/100</Text>
        </View>

        {/* Location Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Location <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputContainer}>
            <Ionicons name="location-outline" size={20} color="#94A3B8" />
            <TextInput
              style={styles.input}
              value={location}
              onChangeText={setLocation}
              placeholder="e.g., Montreal, QC"
              placeholderTextColor="#64748B"
              maxLength={80}
            />
          </View>
        </View>

        {/* Day Rate Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Rate ($) <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputContainer}>
            <Ionicons name="cash-outline" size={20} color="#94A3B8" />
            <TextInput
              style={[styles.input, styles.priceInput]}
              value={dayRate}
              onChangeText={(text) => {
                const sanitized = text.replace(/[^0-9.]/g, '');
                const parts = sanitized.split('.');
                setDayRate(parts.length > 2 ? parts[0] + '.' + parts.slice(1).join('') : sanitized);
              }}
              placeholder="0.00"
              placeholderTextColor="#64748B"
              keyboardType="decimal-pad"
              maxLength={10}
            />
          </View>
        </View>

        {/* Currency Input (Visual Only for now) */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Currency <Text style={styles.required}>*</Text></Text>
          <View style={styles.inputContainer}>
            <Ionicons name="globe-outline" size={20} color="#94A3B8" />
            <TextInput
              style={styles.input}
              value={currency}
              onChangeText={(text) => setCurrency(text.toUpperCase().trim())}
              placeholder="CAD"
              placeholderTextColor="#64748B"
              maxLength={3}
            />
          </View>
        </View>

        {/* Description Input */}
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Description <Text style={styles.required}>*</Text></Text>
          <View style={[styles.inputContainer, styles.textAreaContainer]}>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Describe requirements..."
              placeholderTextColor="#64748B"
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={500}
            />
          </View>
          <Text style={styles.charCount}>{description.length}/500</Text>
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color="#60A5FA" />
          <Text style={styles.infoText}>
            Inspectors will be able to view and apply immediately.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.postButton, loading && styles.postButtonDisabled]}
          onPress={handlePostJob}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="checkmark-circle-outline" size={22} color="#fff" />
              <Text style={styles.postButtonText}>POST JOB</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: Platform.OS === 'web' ? 20 : 60, paddingBottom: 20, backgroundColor: '#1E293B', borderBottomWidth: 1, borderBottomColor: '#334155' },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#F1F5F9' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 120 },
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#94A3B8', marginBottom: 8 },
  required: { color: '#EF4444' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  input: { flex: 1, fontSize: 16, color: '#F1F5F9', ...(Platform.OS === 'web' && { outlineStyle: 'none' as any }) },
  priceInput: { fontWeight: '600' },
  textAreaContainer: { alignItems: 'flex-start', minHeight: 120 },
  textArea: { height: 100, paddingTop: Platform.OS === 'ios' ? 8 : 0, textAlignVertical: 'top' },
  charCount: { fontSize: 12, color: '#64748B', textAlign: 'right', marginTop: 4 },
  infoCard: { flexDirection: 'row', backgroundColor: '#1E3A8A', padding: 16, borderRadius: 12, gap: 12, marginTop: 8 },
  infoText: { flex: 1, fontSize: 13, color: '#93C5FD' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: '#1E293B', borderTopWidth: 1, borderTopColor: '#334155' },
  postButton: { backgroundColor: '#3B82F6', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 16, borderRadius: 12, gap: 10 },
  postButtonDisabled: { opacity: 0.6 },
  postButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});