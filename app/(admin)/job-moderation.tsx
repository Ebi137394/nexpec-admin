import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useLanguage } from '@/src/i18n/LanguageProvider';
import { supabase } from '@/lib/supabase';
import { showAlert } from '@/lib/alert';
import { toCents, fromCents } from '@/lib/money';
import { ChevronLeft, DollarSign, Edit3, CheckCircle, Clock } from 'lucide-react-native';

interface PendingJob {
  id: string;
  title: string;
  client_price_cents: number;        // ★ Task 4
  payout_amount_cents: number | null;// ★ Task 4
  description: string;
  location_city: string;
  location_province: string;
  created_at: string;
}

export default function JobModerationScreen() {
  const router = useRouter();
  const { t, isRTL } = useLanguage();
  const [jobs, setJobs] = useState<PendingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payoutInputs, setPayoutInputs] = useState<Record<string, string>>({});

  // Fetch pending approval jobs
  const fetchPendingJobs = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('jobs')
        .select(`
          id,
          title,
          client_price_cents,
          payout_amount_cents,
          description,
          location_city,
          location_province,
          created_at
        `)
        .eq('status', 'pending_approval')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setJobs(data || []);
    } catch (err: any) {
      console.error('Fetch pending jobs error:', err);
      showAlert('Error', err.message || 'Failed to load pending jobs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPendingJobs();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchPendingJobs();
  };

  const handlePayoutChange = (jobId: string, value: string) => {
    setPayoutInputs(prev => ({
      ...prev,
      [jobId]: value
    }));
  };

  const handlePublishJob = async (job: PendingJob) => {
    const payoutValue = payoutInputs[job.id];
    
    if (!payoutValue || isNaN(Number(payoutValue)) || Number(payoutValue) <= 0) {
      showAlert('Error', 'Please enter a valid payout amount');
      return;
    }

    // ★ Task 4: payoutValue is dollars (string from input). Convert once
    //   to cents and compare against job.client_price_cents directly.
    const payoutCents = toCents(payoutValue);

    if (payoutCents >= ((job as any).client_price_cents ?? 0)) {
      showAlert('Error', 'Payout amount must be less than client price');
      return;
    }

    try {
      const { error } = await supabase
        .from('jobs')
        .update({
          status: 'open',
          payout_amount_cents: payoutCents,  // ★ Task 4
        })
        .eq('id', job.id);

      if (error) throw error;

      // Update local state
      setJobs(prev => prev.filter(j => j.id !== job.id));
      setPayoutInputs(prev => {
        const newInputs = { ...prev };
        delete newInputs[job.id];
        return newInputs;
      });

      showAlert(
        'Success',
        `Job "${job.title}" published with payout of ${formatCurrency(payoutAmount)}`
      );
    } catch (err: any) {
      console.error('Publish job error:', err);
      showAlert('Error', err.message || 'Failed to publish job');
    }
  };

  // ★ Task 4: input is integer CENTS — divide by 100 before format.
  const formatCurrency = (cents: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format((cents ?? 0) / 100);
  };

  const renderJobItem = ({ item }: { item: PendingJob }) => {
    const payoutValue = payoutInputs[item.id] || '';
    // ★ Task 4: payoutValue is dollars from input; client_price_cents is cents.
    //   Convert input to cents before comparison.
    const payoutCents = toCents(payoutValue);
    const isValidPayout = payoutValue && !isNaN(Number(payoutValue)) && payoutCents > 0 && payoutCents < (item.client_price_cents ?? 0);

    return (
      <View style={styles.jobCard}>
        <View style={styles.jobHeader}>
          <View style={styles.jobTitleContainer}>
            <Text style={styles.jobTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={styles.jobLocation}>
              {item.location_city}{item.location_province ? `, ${item.location_province}` : ''}
            </Text>
          </View>
          <View style={styles.priceContainer}>
            <Text style={styles.clientPriceLabel}>Client Price</Text>
            <Text style={styles.clientPrice}>{formatCurrency(item.client_price_cents)}</Text>
          </View>
        </View>

        <Text style={styles.description} numberOfLines={3}>
          {item.description}
        </Text>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Set Payout Amount</Text>
          <View style={styles.inputWrapper}>
            <DollarSign size={20} color="#7C3AED" style={styles.inputIcon} />
            <TextInput
              style={styles.payoutInput}
              value={payoutValue}
              onChangeText={(value) => handlePayoutChange(item.id, value)}
              placeholder="Enter payout amount"
              placeholderTextColor="#94A3B8"
              keyboardType="numeric"
              textAlign={isRTL ? 'right' : 'left'}
            />
          </View>
          {payoutValue && (
            <Text style={[
              styles.payoutHint,
              isValidPayout ? styles.payoutHintValid : styles.payoutHintInvalid
            ]}>
              {isValidPayout
                ? `Profit: ${formatCurrency((item.client_price_cents ?? 0) - payoutCents)}`
                : 'Payout must be less than client price'
              }
            </Text>
          )}
        </View>

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[
              styles.publishButton,
              !isValidPayout && styles.publishButtonDisabled
            ]}
            onPress={() => handlePublishJob(item)}
            disabled={!isValidPayout}
            activeOpacity={0.7}
          >
            <CheckCircle size={20} color="#FFFFFF" />
            <Text style={styles.publishButtonText}>Publish to Inspectors</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <ChevronLeft size={24} color="#020420" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Job Moderation</Text>
          <View style={styles.headerRight} />
        </View>
        
        <View style={styles.loadingContainer}>
          <Clock size={48} color="#7C3AED" />
          <Text style={styles.loadingText}>Loading pending jobs...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={24} color="#020420" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Job Moderation</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#7C3AED"
          />
        }
      >
        {jobs.length === 0 ? (
          <View style={styles.emptyState}>
            <Clock size={64} color="#94A3B8" />
            <Text style={styles.emptyTitle}>No Pending Jobs</Text>
            <Text style={styles.emptySubtitle}>
              All jobs have been reviewed and published
            </Text>
          </View>
        ) : (
          <FlatList
            data={jobs}
            keyExtractor={(item) => item.id}
            renderItem={renderJobItem}
            scrollEnabled={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#020420',
    textAlign: 'center',
  },
  headerRight: {
    width: 44,
    height: 44,
  },
  content: {
    flex: 1,
  },
  listContent: {
    padding: 16,
  },
  jobCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  jobTitleContainer: {
    flex: 1,
    marginRight: 12,
  },
  jobTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#020420',
    marginBottom: 4,
  },
  jobLocation: {
    fontSize: 13,
    color: '#64748B',
  },
  priceContainer: {
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  clientPriceLabel: {
    fontSize: 11,
    color: '#7C3AED',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  clientPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#7C3AED',
  },
  description: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 20,
    marginBottom: 16,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 8,
    fontWeight: '600',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputIcon: {
    marginRight: 10,
  },
  payoutInput: {
    flex: 1,
    fontSize: 16,
    color: '#020420',
    fontFamily: 'System',
  },
  payoutHint: {
    fontSize: 12,
    marginTop: 6,
    fontWeight: '600',
  },
  payoutHintValid: {
    color: '#22C55E',
  },
  payoutHintInvalid: {
    color: '#EF4444',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  publishButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#7C3AED',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  publishButtonDisabled: {
    backgroundColor: '#E2E8F0',
  },
  publishButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  loadingText: {
    fontSize: 16,
    color: '#64748B',
    marginTop: 16,
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#020420',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
});