import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
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
  success: '#10B981', // Green
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
};

export default function JobDetailsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (jobId) fetchJob();
  }, [jobId]);

  const fetchJob = async () => {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (error) throw error;
      setJob(data);
    } catch (error) {
      console.log('Error fetching job:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptJob = async () => {
    if (!user) return;
    setProcessing(true);

    try {
      // Assign the job to the current user (Inspector)
      const { error } = await supabase
        .from('jobs')
        .update({
          contractor_id: user.id,
          status: 'assigned',
        })
        .eq('id', jobId);

      if (error) throw error;

      Alert.alert('Success', 'You have accepted this job!', [
        { text: 'Go to My Jobs', onPress: () => router.replace('/(tabs)/my-jobs') }
      ]);

    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!job) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.centerContainer}>
          <Text style={styles.errorText}>Job not found</Text>
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={24} color="#FFF" />
            <Text style={{color: '#FFF', fontWeight: 'bold', marginLeft: 8}}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Job Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* Job Title & Price */}
        <View style={styles.card}>
          <Text style={styles.jobTitle}>{job?.title}</Text>
          <View style={styles.rowBetween}>
            <View style={styles.locationRow}>
              <Ionicons name="location-outline" size={18} color={COLORS.textSecondary} />
              <Text style={styles.locationText}>{job?.location}</Text>
            </View>
            <Text style={styles.priceText}>${job?.price?.toLocaleString()}</Text>
          </View>
        </View>

        {/* Description */}
        <Text style={styles.sectionTitle}>Description</Text>
        <View style={styles.card}>
          <Text style={styles.descriptionText}>{job?.description}</Text>
        </View>

        {/* Requirements */}
        <Text style={styles.sectionTitle}>Requirements</Text>
        <View style={styles.card}>
          <View style={styles.requirementItem}>
            <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.success} />
            <Text style={styles.reqText}>Certified Inspector</Text>
          </View>
          <View style={styles.requirementItem}>
            <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.success} />
            <Text style={styles.reqText}>Available for On-site visit</Text>
          </View>
        </View>

        {/* Accept Button (Only if job is OPEN) */}
        {job?.status === 'open' && job?.client_id !== user?.id && (
          <TouchableOpacity
            style={[styles.acceptButton, processing && styles.disabledButton]}
            onPress={handleAcceptJob}
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Text style={styles.acceptButtonText}>Accept Job</Text>
                <Ionicons name="arrow-forward" size={20} color="#FFF" />
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Status Message if already assigned */}
        {job?.status !== 'open' && (
          <View style={styles.statusBox}>
            <Ionicons name="information-circle-outline" size={24} color={COLORS.textSecondary} />
            <Text style={styles.statusText}>
              This job is currently {job?.status.replace('_', ' ')}.
            </Text>
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: 18,
    marginBottom: 16,
  },
  
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    width: 40, 
    height: 40, 
    borderRadius: 20, 
    backgroundColor: COLORS.cardBackground,
    justifyContent: 'center', 
    alignItems: 'center',
    flexDirection: 'row'
  },
  headerTitle: { 
    fontSize: 18, 
    fontWeight: 'bold', 
    color: COLORS.textPrimary 
  },

  // Scroll
  scrollContent: { padding: 20, paddingBottom: 40 },

  card: {
    backgroundColor: COLORS.cardBackground, 
    borderRadius: 16, 
    overflow: 'hidden',
    marginBottom: 24, 
    borderWidth: 1, 
    borderColor: COLORS.cardBorder
  },
  jobTitle: { fontSize: 22, fontWeight: 'bold', color: COLORS.textPrimary, padding: 20, paddingBottom: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 20 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locationText: { color: COLORS.textSecondary, fontSize: 15 },
  priceText: { color: COLORS.success, fontSize: 24, fontWeight: 'bold' },

  sectionTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  descriptionText: { color: COLORS.textSecondary, fontSize: 15, lineHeight: 24, padding: 20 },

  requirementItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10 },
  reqText: { color: COLORS.textSecondary, fontSize: 14 },

  acceptButton: {
    backgroundColor: COLORS.primary, flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', padding: 18, borderRadius: 16, marginTop: 10, gap: 10
  },
  disabledButton: { opacity: 0.7 },
  acceptButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },

  statusBox: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    padding: 20, backgroundColor: COLORS.cardBackground, borderRadius: 16, gap: 10,
    borderWidth: 1, borderColor: COLORS.cardBorder
  },
  statusText: { color: COLORS.textSecondary },
});