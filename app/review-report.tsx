import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  Dimensions,
  Linking,
  Platform,
  Animated,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft,
  FileText,
  Camera,
  Check,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  DollarSign,
  Lock,
  Star,
  Download,
  X,
  Send,
  User,
  Clock,
  Shield,
  ChevronRight,
  Sparkles,
  PartyPopper,
  Eye,
  ZoomIn,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert, showConfirm } from '@/lib/alert';

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

interface ReportData {
  report_id: string;
  job_id: string;
  inspector_id: string;
  summary: string;
  file_url: string | null;
  photos_urls: string[];
  report_status: string;
  revision_notes: string | null;
  revision_count: number;
  submitted_at: string;
  job_title: string;
  job_price: number;
  job_status: string;
  escrow_status: string;
  client_id: string;
  inspector_first_name: string;
  inspector_last_name: string;
  inspector_avatar: string | null;
  inspector_rating: number;
  inspector_rating_count: number;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ============================================================================
// HELPERS
// ============================================================================

// ★ Task 4: input is integer CENTS — divide by 100 before format.
const formatCurrency = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100);

const formatDate = (date: string) => 
  new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const Header = ({ onBack, title }: { onBack: () => void; title: string }) => (
  <View style={styles.header}>
    <TouchableOpacity onPress={onBack} style={styles.backButton}>
      <ChevronLeft size={28} color="#0F172A" />
    </TouchableOpacity>
    <Text style={styles.headerTitle}>{title}</Text>
    <View style={{ width: 40 }} />
  </View>
);

// ★ Task 4: `price` is integer CENTS now. Math is identical (10% of cents = 10% of cents).
const PaymentCard = ({ price }: { price: number }) => {
  const fee = price * 0.10;
  const netAmount = price - fee;
  
  return (
    <View style={styles.paymentCard}>
      <View style={styles.paymentHeader}>
        <Lock size={16} color="#FFFFFF" />
        <Text style={styles.paymentLabel}>Secure Escrow Payment</Text>
      </View>
      <Text style={styles.paymentAmount}>{formatCurrency(price)}</Text>
      <View style={styles.paymentDivider} />
      <View style={styles.breakdownRow}>
        <Text style={styles.breakdownText}>Inspector Net</Text>
        <Text style={styles.breakdownText}>{formatCurrency(netAmount)}</Text>
      </View>
    </View>
  );
};

// Photo Modal Component
interface PhotoModalProps {
  visible: boolean;
  photoUrl: string | null;
  onClose: () => void;
}

const PhotoModal: React.FC<PhotoModalProps> = ({ visible, photoUrl, onClose }) => {
  if (!photoUrl) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.photoModalOverlay}>
        <TouchableOpacity
          style={styles.photoModalClose}
          onPress={onClose}
          activeOpacity={0.8}
        >
          <X size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Image source={{ uri: photoUrl }} style={styles.photoModalImage} resizeMode="contain" />
      </View>
    </Modal>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ReviewReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = id ? (Array.isArray(id) ? id[0] : id) : null;
  const router = useRouter();

  // State
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showRevision, setShowRevision] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [showPhotoModal, setShowPhotoModal] = useState(false);

  // Fetch Data using View
  const loadData = useCallback(async () => {
    if (!jobId) {
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      
      // Try to fetch from view first
      const { data: viewData, error: viewError } = await supabase
        .from('report_review_details')
        .select('*')
        .eq('job_id', jobId)
        .maybeSingle();

      if (!viewError && viewData) {
        setReport(viewData as any);
        setLoading(false);
        return;
      }

      // Fallback: Fetch from inspection_reports with joins
      const { data: reportData, error: reportError } = await supabase
        .from('inspection_reports')
        .select(`
          id,
          job_id,
          inspector_id,
          notes,
          file_url,
          photos_urls,
          status,
          revision_notes,
          revision_count,
          submitted_at,
          jobs (
            id,
            title,
            budget,
            price,
            status,
            escrow_status,
            client_id
          ),
          inspector:profiles (
            first_name,
            last_name,
            avatar_url,
            rating_average,
            rating_count
          )
        `)
        .eq('job_id', jobId)
        .maybeSingle();

      if (reportError) throw reportError;
      
      if (!reportData) {
        showAlert('Report Not Found', 'No report found for this job.');
        router.back();
        return;
      }

      const data = reportData as any;
      const job = data.jobs as any;
      const inspector = data.inspector as any;

      setReport({
        report_id: data.id,
        job_id: data.job_id,
        inspector_id: data.inspector_id,
        summary: data.notes || '', // ✅ FIX: Use notes (summary column doesn't exist)
        file_url: data.file_url,
        photos_urls: data.photos_urls || [],
        report_status: data.status,
        revision_notes: data.revision_notes,
        revision_count: data.revision_count || 0,
        submitted_at: data.submitted_at,
        job_title: job?.title || 'Unknown Job',
        // ★ Task 4: read renamed cents columns; price/budget no longer exist.
        job_price: (job as any)?.price_cents || (job as any)?.budget_cents || 0,
        job_status: job?.status || 'unknown',
        escrow_status: job?.escrow_status || 'unknown',
        client_id: job?.client_id || '',
        inspector_first_name: inspector?.first_name || '',
        inspector_last_name: inspector?.last_name || '',
        inspector_avatar: inspector?.avatar_url,
        inspector_rating: inspector?.rating_average || 0,
        inspector_rating_count: inspector?.rating_count || 0,
      });
    } catch (err: any) {
      console.error('Load error:', err);
      showAlert('Error', 'Failed to load report data');
      router.back();
    } finally {
      setLoading(false);
    }
  }, [jobId, router]);

  useEffect(() => { loadData(); }, [loadData]);

  // Handle Approval
  const handleApprove = async () => {
    if (!report) return;
    setIsProcessing(true);
    try {
      // ۱. تایید گزارش بازرسی
      const { error: reportError } = await supabase
        .from('inspection_reports')
        .update({ status: 'approved' })
        .eq('id', report.report_id);

      if (reportError) throw reportError;

      // ۲. تغییر وضعیت خودِ جاب به Completed (بسیار مهم برای تب‌بندی)
      const { error: jobError } = await supabase
        .from('jobs')
        .update({ 
          status: 'completed',
          escrow_status: 'released' // آزاد کردن پول در ظاهر دیتابیس
        })
        .eq('id', report.job_id);

      if (jobError) throw jobError;

      showAlert(
        'Success',
        'Payment released and job completed!',
        // ★ LANE-A-PHASE-2.6 — Repointed /client/jobs (literal) to canonical
        //   /(tabs)/client-dashboard which lands the client on their job list.
        //   (No exact /(client)/jobs index existed; dashboard is the right home.)
        () => router.replace('/(tabs)/client-dashboard')
      );
    } catch (err: any) {
      console.error('Approve error:', err);
      showAlert('Error', err.message || 'Failed to approve report');
    } finally {
      setIsProcessing(false);
      setShowConfirm(false);
    }
  };

  // Handle Revision
  const handleRequestRevision = async () => {
    if (!revisionNotes || revisionNotes.length < 20) {
      showAlert('Notes Required', 'Please provide at least 20 characters for the inspector.');
      return;
    }
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('inspection_reports')
        .update({ 
          status: 'revision_requested',
          revision_notes: revisionNotes,
          revision_count: (report?.revision_count || 0) + 1,
        })
        .eq('id', report?.report_id);

      if (error) throw error;
      
      setShowRevision(false);
      setRevisionNotes('');
      showAlert('Sent', 'Inspector has been notified to revise the report.', () => {
        router.back();
      });
    } catch (err: any) {
      console.error('Revision error:', err);
      showAlert('Error', 'Failed to send revision request');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePhotoPress = (url: string) => {
    setSelectedPhoto(url);
    setShowPhotoModal(true);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => router.back()} title="Review Findings" />
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading report...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header onBack={() => router.back()} title="Review Findings" />
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Report not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header onBack={() => router.back()} title="Review Findings" />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <PaymentCard price={report.job_price} />

        {/* Inspector Info */}
        <View style={styles.inspectorCard}>
          <View style={styles.inspectorHeader}>
            <Text style={styles.inspectorLabel}>Inspector</Text>
            {report.inspector_rating_count > 0 && (
              <View style={styles.ratingBadge}>
                <Star size={12} color="#FBBF24" fill="#FBBF24" />
                <Text style={styles.ratingText}>
                  {report.inspector_rating.toFixed(1)}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.inspectorInfo}>
            {report.inspector_avatar ? (
              <Image source={{ uri: report.inspector_avatar }} style={styles.inspectorAvatar} />
            ) : (
              <View style={[styles.inspectorAvatar, styles.avatarPlaceholder]}>
                <User size={24} color="#64748B" />
              </View>
            )}
            <View style={styles.inspectorDetails}>
              <Text style={styles.inspectorName}>
                {report.inspector_first_name} {report.inspector_last_name}
              </Text>
              <Text style={styles.inspectorMeta}>
                Submitted {formatDate(report.submitted_at)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Inspection Summary</Text>
          <View style={styles.summaryBox}>
            <Text style={styles.summaryText}>{report.summary}</Text>
          </View>
        </View>

        {report.file_url && (
          <TouchableOpacity 
            style={styles.fileButton} 
            onPress={() => Linking.openURL(report.file_url!)}
            activeOpacity={0.7}
          >
            <FileText size={24} color="#8B5CF6" />
            <Text style={styles.fileButtonText}>View Detailed PDF Report</Text>
            <Download size={18} color="#8B5CF6" />
          </TouchableOpacity>
        )}

        {report.photos_urls?.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Site Photos ({report.photos_urls.length})</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.photosContainer}
            >
              {report.photos_urls.map((url, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => handlePhotoPress(url)}
                  activeOpacity={0.8}
                >
                  <Image source={{ uri: url }} style={styles.photoThumb} />
                  <View style={styles.photoOverlay}>
                    <ZoomIn size={16} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Revision History */}
        {report.revision_count > 0 && (
          <View style={styles.revisionHistory}>
            <View style={styles.revisionHeader}>
              <RefreshCw size={16} color="#F59E0B" />
              <Text style={styles.revisionTitle}>
                Revision History ({report.revision_count})
              </Text>
            </View>
            {report.revision_notes && (
              <Text style={styles.revisionNotes}>{report.revision_notes}</Text>
            )}
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Footer Actions */}
      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.approveBtn} 
          onPress={() => setShowConfirm(true)}
          activeOpacity={0.8}
        >
          <CheckCircle2 size={22} color="#FFFFFF" />
          <Text style={styles.approveBtnText}>Approve & Release Funds</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.revisionBtn} 
          onPress={() => setShowRevision(true)}
          activeOpacity={0.8}
        >
          <RefreshCw size={18} color="#F59E0B" />
          <Text style={styles.revisionBtnText}>Request Changes</Text>
        </TouchableOpacity>
      </View>

      {/* Confirmation Modal */}
      <Modal visible={showConfirm} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalIconContainer}>
              <DollarSign size={40} color="#22C55E" />
            </View>
            <Text style={styles.modalTitle}>Confirm Release</Text>
            <Text style={styles.modalText}>
              Releasing {formatCurrency(report.job_price)} will complete the job. This action cannot be undone.
            </Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity 
                onPress={() => setShowConfirm(false)} 
                style={styles.cancelBtn}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={handleApprove} 
                style={styles.confirmBtn} 
                disabled={isProcessing}
                activeOpacity={0.8}
              >
                {isProcessing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmBtnText}>Release Payment</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Revision Modal */}
      <Modal visible={showRevision} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.revModalContainer}>
          <View style={styles.revHeader}>
            <Text style={styles.revTitle}>Request Revision</Text>
            <TouchableOpacity 
              onPress={() => {
                setShowRevision(false);
                setRevisionNotes('');
              }}
              style={styles.revCloseButton}
              activeOpacity={0.7}
            >
              <X size={24} color="#0F172A" />
            </TouchableOpacity>
          </View>
          
          <View style={styles.revContent}>
            <Text style={styles.revLabel}>
              What needs to be changed? (Minimum 20 characters)
            </Text>
            <TextInput
              style={styles.revInput}
              multiline
              numberOfLines={6}
              placeholder="Describe what needs to be fixed or clarified..."
              placeholderTextColor="#94A3B8"
              value={revisionNotes}
              onChangeText={setRevisionNotes}
              textAlignVertical="top"
            />
            <Text style={styles.revCharCount}>
              {revisionNotes.length}/20 characters
            </Text>
          </View>

          <View style={styles.revFooter}>
            <TouchableOpacity 
              style={[
                styles.revSubmit,
                (revisionNotes.length < 20 || isProcessing) && styles.revSubmitDisabled
              ]} 
              onPress={handleRequestRevision}
              disabled={revisionNotes.length < 20 || isProcessing}
              activeOpacity={0.8}
            >
              {isProcessing ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Send size={18} color="#FFFFFF" />
                  <Text style={styles.revSubmitText}>Send to Inspector</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Photo Modal */}
      <PhotoModal
        visible={showPhotoModal}
        photoUrl={selectedPhoto}
        onClose={() => {
          setShowPhotoModal(false);
          setSelectedPhoto(null);
        }}
      />
    </SafeAreaView>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -8,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  paymentCard: {
    padding: 20,
    borderRadius: 20,
    marginBottom: 20,
    backgroundColor: '#059669',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  paymentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  paymentLabel: {
    color: 'white',
    opacity: 0.9,
    fontSize: 13,
    fontWeight: '500',
  },
  paymentAmount: {
    color: 'white',
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  paymentDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginVertical: 12,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '500',
  },
  inspectorCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  inspectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  inspectorLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  ratingText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#92400E',
  },
  inspectorInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  inspectorAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  avatarPlaceholder: {
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  inspectorDetails: {
    flex: 1,
  },
  inspectorName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 2,
  },
  inspectorMeta: {
    fontSize: 13,
    color: '#64748B',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    color: '#1E293B',
  },
  summaryBox: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  summaryText: {
    fontSize: 15,
    color: '#475569',
    lineHeight: 22,
  },
  fileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F3FF',
    padding: 16,
    borderRadius: 16,
    gap: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  fileButtonText: {
    flex: 1,
    color: '#7C3AED',
    fontWeight: '600',
    fontSize: 15,
  },
  photosContainer: {
    paddingRight: 16,
  },
  photoThumb: {
    width: 120,
    height: 120,
    borderRadius: 12,
    marginRight: 12,
  },
  photoOverlay: {
    position: 'absolute',
    top: 8,
    right: 20,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  revisionHistory: {
    backgroundColor: '#FFFBEB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderLeftWidth: 3,
    borderLeftColor: '#F59E0B',
  },
  revisionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  revisionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#92400E',
  },
  revisionNotes: {
    fontSize: 14,
    color: '#B45309',
    lineHeight: 20,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 12,
  },
  approveBtn: {
    backgroundColor: '#22C55E',
    padding: 16,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  approveBtnText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  revisionBtn: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F59E0B',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  revisionBtnText: {
    color: '#B45309',
    fontWeight: '600',
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
  },
  modalIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#DCFCE7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginVertical: 12,
    color: '#0F172A',
  },
  modalText: {
    textAlign: 'center',
    color: '#64748B',
    lineHeight: 20,
    marginBottom: 20,
    fontSize: 15,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  cancelBtn: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748B',
  },
  confirmBtn: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    backgroundColor: '#22C55E',
    borderRadius: 12,
  },
  confirmBtnText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 15,
  },
  revModalContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  revHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  revTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  revCloseButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  revContent: {
    flex: 1,
    padding: 20,
  },
  revLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1E293B',
    marginBottom: 12,
  },
  revInput: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    color: '#0F172A',
    minHeight: 150,
  },
  revCharCount: {
    fontSize: 12,
    color: '#94A3B8',
    textAlign: 'right',
    marginTop: 8,
  },
  revFooter: {
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 8 : 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  revSubmit: {
    backgroundColor: '#F59E0B',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  revSubmitDisabled: {
    backgroundColor: '#CBD5E1',
  },
  revSubmitText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    color: '#64748B',
    fontWeight: '500',
  },
  photoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoModalClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  photoModalImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.7,
  },
});
