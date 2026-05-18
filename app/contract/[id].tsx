import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';

// =============================================================================
// TYPES
// =============================================================================

interface Contract {
  id: string;
  job_id: string;
  inspector_id: string;
  rate: number;
  rate_type: 'hourly' | 'daily' | 'fixed';
  payment_terms: string;
  status: 'pending' | 'signed' | 'completed' | 'cancelled';
  terms_text: string | null;
  signed_at: string | null;
  pdf_file_name?: string | null;
  created_at: string;
  jobs?: {
    title: string;
    company_name: string;
    location: string;
    start_date: string;
    end_date: string;
  };
}

interface Job {
  id: string;
  title: string;
  company_name: string;
  location: string;
  start_date: string;
  end_date: string;
}

// =============================================================================
// COLORS - Document Style (Light Theme for Contract)
// =============================================================================

const COLORS = {
  background: '#f8fafc',
  paper: '#ffffff',
  headerBg: '#020420',
  primary: '#2563eb',
  primaryDark: '#1d4ed8',
  text: '#1e293b',
  textSecondary: '#64748b',
  border: '#e2e8f0',
  success: '#059669',
  successBg: '#ecfdf5',
  warning: '#d97706',
  warningBg: '#fffbeb',
  pending: '#6366f1',
  pendingBg: '#eef2ff',
};

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function ContractScreen() {
  const { id: jobId } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [contract, setContract] = useState<Contract | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  useEffect(() => {
    initializeData();
  }, [jobId]);

  const initializeData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        Alert.alert('Error', 'Please log in to view contracts');
        router.back();
        return;
      }

      setUserId(user.id);
      
      await Promise.all([
        fetchContract(user.id),
        fetchJob(),
      ]);
    } catch (error) {
      console.error('Error initializing:', error);
      Alert.alert('Error', 'Failed to load contract data');
    } finally {
      setLoading(false);
    }
  };

  const fetchContract = async (uid: string) => {
    // 🌟 FIX: jobId is actually the Contract ID from the URL! We fetch it directly safely.
    const { data, error } = await supabase
      .from('contracts')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching contract:', error);
    }

    if (data) {
      // Safely fetch job and client details manually to prevent DB crash
      if (data.job_id) {
        const { data: jobData } = await supabase
          .from('jobs')
          .select('title, location, start_date, scheduled_date, end_date, client_id')
          .eq('id', data.job_id)
          .single();

        if (jobData) {
          data.jobs = { ...jobData, company_name: 'Unknown Company' };
          
          if (jobData.client_id) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('company_name, full_name')
              .eq('id', jobData.client_id)
              .single();
            if (profile) {
              data.jobs.company_name = profile.company_name || profile.full_name || 'Unknown Company';
            }
          }

          if (!data.jobs.start_date && data.jobs.scheduled_date) {
            data.jobs.start_date = data.jobs.scheduled_date;
          }
        }
      }
      setContract(data);
    }
  };

  const fetchJob = async () => {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, title, company_name, location, start_date, scheduled_date, end_date')
      .eq('id', jobId)
      .single();

    if (error) {
      console.error('Error fetching job:', error);
    }

    if (data) {
      // Use scheduled_date as fallback if start_date is null
      if (!data.start_date && data.scheduled_date) {
        data.start_date = data.scheduled_date;
      }
      setJob(data);
    }
  };

  // ===========================================================================
  // SIGN CONTRACT
  // ===========================================================================

  const handleSignContract = async () => {
    if (!contract) return;

    Alert.alert(
      'Sign Contract',
      'By signing this contract, you agree to the terms and conditions outlined below. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign & Accept',
          style: 'default',
          onPress: signContract,
        },
      ]
    );
  };

  const signContract = async () => {
    if (!contract) return;

    setSigning(true);

    try {
      const { error } = await supabase
        .from('contracts')
        .update({
          status: 'signed',
          signed_at: new Date().toISOString(),
        })
        .eq('id', contract.id);

      if (error) throw error;

      // Update local state
      setContract(prev => prev ? {
        ...prev,
        status: 'signed',
        signed_at: new Date().toISOString(),
      } : null);

      Alert.alert(
        'Contract Signed! ✅',
        'You have successfully signed the contract. You can now proceed with the job.',
        [{ text: 'OK' }]
      );
    } catch (error: any) {
      console.error('Error signing contract:', error);
      Alert.alert('Error', error.message || 'Failed to sign contract');
    } finally {
      setSigning(false);
    }
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const getRateTypeLabel = (type: string) => {
    switch (type) {
      case 'hourly': return 'per hour';
      case 'daily': return 'per day';
      case 'fixed': return 'fixed rate';
      default: return type;
    }
  };

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'signed':
        return { 
          label: 'Signed', 
          color: COLORS.success, 
          bg: COLORS.successBg,
          icon: 'checkmark-circle' as const,
        };
      case 'completed':
        return { 
          label: 'Completed', 
          color: COLORS.success, 
          bg: COLORS.successBg,
          icon: 'trophy' as const,
        };
      case 'cancelled':
        return { 
          label: 'Cancelled', 
          color: COLORS.warning, 
          bg: COLORS.warningBg,
          icon: 'close-circle' as const,
        };
      default:
        return { 
          label: 'Pending Signature', 
          color: COLORS.pending, 
          bg: COLORS.pendingBg,
          icon: 'time' as const,
        };
    }
  };

  // 🌟 Helper for PDF URLs
  const openPdfViewer = () => {
    if (contract?.pdf_file_name) {
      const { data } = supabase.storage.from('contracts').getPublicUrl(contract.pdf_file_name);
      Linking.openURL(data.publicUrl);
    } else {
      Alert.alert('Error', 'PDF link is missing or broken.');
    }
  };

  // ===========================================================================
  // RENDER: LOADING STATE
  // ===========================================================================

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen
          options={{
            headerShown: false,
          }}
        />
        {/* Custom Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: COLORS.headerBg }}>
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 8, marginRight: 8 }}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>
            Contract
          </Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading contract...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ===========================================================================
  // RENDER: NO CONTRACT STATE
  // ===========================================================================

  if (!contract) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Stack.Screen
          options={{
            headerShown: false,
          }}
        />
        {/* Custom Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: COLORS.headerBg }}>
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 8, marginRight: 8 }}>
            <Ionicons name="arrow-back" size={24} color="white" />
          </TouchableOpacity>
          <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>
            Contract
          </Text>
        </View>
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconContainer}>
            <Ionicons name="document-text-outline" size={80} color={COLORS.textSecondary} />
          </View>
          <Text style={styles.emptyTitle}>No Contract Issued Yet</Text>
          <Text style={styles.emptyText}>
            A contract will be available once your application has been accepted by the employer.
          </Text>
          {job && (
            <View style={styles.jobInfoCard}>
              <Text style={styles.jobInfoTitle}>{job.title}</Text>
              <Text style={styles.jobInfoCompany}>{job.company_name}</Text>
            </View>
          )}
          <TouchableOpacity 
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="arrow-back" size={20} color={COLORS.primary} />
            <Text style={styles.backButtonText}>Back to Job Details</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ===========================================================================
  // RENDER: CONTRACT DOCUMENT
  // ===========================================================================

  const statusConfig = getStatusConfig(contract.status);
  const jobInfo = contract.jobs || job;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />

      {/* Custom Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: COLORS.headerBg }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 8, marginRight: 8 }}>
          <Ionicons name="arrow-back" size={24} color="white" />
        </TouchableOpacity>
        <Text style={{ color: 'white', fontSize: 20, fontWeight: 'bold' }}>
          Contract
        </Text>
      </View>

      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Contract Paper */}
        <View style={styles.paper}>
          {/* Header */}
          <View style={styles.documentHeader}>
            <View style={styles.logoPlaceholder}>
              <Ionicons name="shield-checkmark" size={32} color={COLORS.primary} />
            </View>
            <Text style={styles.documentTitle}>SERVICE CONTRACT</Text>
            <Text style={styles.documentSubtitle}>Inspector Agreement</Text>
          </View>

          {/* Status Badge */}
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <Ionicons name={statusConfig.icon} size={18} color={statusConfig.color} />
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Job Information Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>JOB INFORMATION</Text>
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Position:</Text>
              <Text style={styles.infoValue}>{jobInfo?.title || 'N/A'}</Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Company:</Text>
              <Text style={styles.infoValue}>{jobInfo?.company_name || 'N/A'}</Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Location:</Text>
              <Text style={styles.infoValue}>{jobInfo?.location || 'N/A'}</Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Duration:</Text>
              <Text style={styles.infoValue}>
                {jobInfo?.start_date && jobInfo?.end_date 
                  ? `${formatDate(jobInfo.start_date)} - ${formatDate(jobInfo.end_date)}`
                  : 'TBD'}
              </Text>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Compensation Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>COMPENSATION</Text>
            
            <View style={styles.rateContainer}>
              <Text style={styles.rateAmount}>{formatCurrency(contract.rate)}</Text>
              <Text style={styles.rateType}>{getRateTypeLabel(contract.rate_type)}</Text>
            </View>
            
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Payment Terms:</Text>
              <Text style={styles.infoValue}>{contract.payment_terms || 'Net 30'}</Text>
            </View>
          </View>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Terms Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TERMS & CONDITIONS</Text>
            <Text style={styles.termsText}>
              {contract.terms_text || `
1. The Inspector agrees to perform all duties as outlined in the job description with professional standards and due diligence.

2. The Inspector shall maintain all required certifications and licenses throughout the duration of this contract.

3. Work hours and schedule shall be as mutually agreed upon by both parties.

4. The Inspector shall maintain confidentiality regarding all proprietary information.

5. Either party may terminate this agreement with 48 hours written notice.

6. The Inspector shall comply with all applicable safety regulations and company policies.

7. Payment will be processed within the agreed payment terms upon satisfactory completion of work.
              `.trim()}
            </Text>
          </View>

          {/* 🌟 PDF Contract Section Added Exactly Here */}
          {contract.pdf_file_name && (
            <>
              <View style={styles.divider} />
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>CONTRACT PDF</Text>
                
                <TouchableOpacity 
                  style={styles.pdfToggleBtn} 
                  onPress={openPdfViewer}
                >
                  <Ionicons name="document-text-outline" size={20} color="#FFF" />
                  <Text style={styles.pdfToggleText}>View PDF Contract</Text>
                  <Ionicons name="chevron-forward" size={20} color="#FFF" />
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.fullScreenBtn} 
                  onPress={openPdfViewer}
                >
                  <Ionicons name="expand" size={20} color="#FFF" />
                  <Text style={styles.fullScreenText}>Full Screen View</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Signature Section */}
          {contract.status === 'signed' && contract.signed_at && (
            <>
              <View style={styles.divider} />
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>SIGNATURE</Text>
                <View style={styles.signatureBox}>
                  <Ionicons name="create" size={24} color={COLORS.success} />
                  <View style={styles.signatureInfo}>
                    <Text style={styles.signedLabel}>Digitally Signed</Text>
                    <Text style={styles.signedDate}>
                      {/* 🌟 FIX: Checked if signed_at exists to prevent Invalid Date */}
                      {contract.signed_at ? formatDateTime(contract.signed_at) : 'N/A'}
                    </Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
                </View>
              </View>
            </>
          )}

          {/* Contract ID Footer */}
          <View style={styles.documentFooter}>
            <Text style={styles.contractId}>
              Contract ID: {contract.id.slice(0, 8).toUpperCase()}
            </Text>
            <Text style={styles.generatedDate}>
              Generated: {formatDate(contract.created_at)}
            </Text>
          </View>
        </View>

        {/* Sign Button (only if pending) */}
        {contract.status === 'pending' && (
          <TouchableOpacity
            style={[styles.signButton, signing && styles.signButtonDisabled]}
            onPress={handleSignContract}
            disabled={signing}
            activeOpacity={0.8}
          >
            {signing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="create-outline" size={24} color="#fff" />
                <Text style={styles.signButtonText}>Sign Contract</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

// =============================================================================
// STYLES
// =============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  loadingText: {
    marginTop: 16,
    color: COLORS.textSecondary,
    fontSize: 16,
  },

  // Empty State
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: COLORS.background,
  },
  emptyIconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.paper,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 15,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  jobInfoCard: {
    backgroundColor: COLORS.paper,
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  jobInfoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  jobInfoCompany: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  backButtonText: {
    fontSize: 16,
    color: COLORS.primary,
    marginLeft: 8,
    fontWeight: '500',
  },

  // Paper/Document
  paper: {
    backgroundColor: COLORS.paper,
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  documentHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  logoPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#eff6ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  documentTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.text,
    letterSpacing: 1,
  },
  documentSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },

  // Status Badge
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: 'center',
    marginBottom: 20,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },

  // Divider
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 20,
  },

  // Sections
  section: {
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    letterSpacing: 1,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  infoLabel: {
    width: 100,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  infoValue: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },

  // Rate
  rateContainer: {
    backgroundColor: '#f0f9ff',
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  rateAmount: {
    fontSize: 32,
    fontWeight: '800',
    color: COLORS.primary,
  },
  rateType: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
  },

  // Terms
  termsText: {
    fontSize: 13,
    color: COLORS.text,
    lineHeight: 22,
  },

  // Signature
  signatureBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.successBg,
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.success,
    borderStyle: 'dashed',
  },
  signatureInfo: {
    flex: 1,
    marginLeft: 12,
  },
  signedLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.success,
  },
  signedDate: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // 🌟 استایل‌های مربوط به دکمه‌های PDF که اضافه شد
  pdfToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#8B5CF6',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  pdfToggleText: {
    flex: 1,
    color: '#fff',
    fontWeight: '600',
    marginLeft: 12,
  },
  fullScreenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 8,
  },
  fullScreenText: {
    color: '#fff',
    fontWeight: '600',
    marginLeft: 8,
  },

  // Footer
  documentFooter: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    alignItems: 'center',
  },
  contractId: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
  },
  generatedDate: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
  },

  // Sign Button
  signButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 18,
    borderRadius: 12,
    marginTop: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  signButtonDisabled: {
    opacity: 0.7,
  },
  signButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 10,
  },

  bottomSpacer: {
    height: 40,
  },
});