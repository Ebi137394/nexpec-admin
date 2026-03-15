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
  Dimensions,
  Linking,
  Platform,
  Animated,
  StatusBar,
  Alert,
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
  Eye,
  User,
  Clock,
  Shield,
  ChevronRight,
  Sparkles,
  PartyPopper,
  MapPin,
  Calendar,
  FileCheck,
  Receipt,
  Maximize2,
  ChevronDown,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert } from '@/lib/alert';

// ============================================================================
// TYPES
// ============================================================================

interface Expense {
  id: string;
  description: string;
  amount: number;
  receipt_url: string | null;
  created_at: string;
}

interface ReportDetails {
  report_id: string;
  job_id: string;
  inspector_id: string;
  summary: string;
  report_file_url: string | null;
  photos_urls: string[];
  report_status: string;
  revision_notes: string | null;
  revision_count: number;
  submitted_at: string;

  job_title: string;
  job_price: number;
  job_location: string;

  inspector_first_name: string;
  inspector_last_name: string;
  inspector_avatar: string | null;
  inspector_rating: number;
  inspector_reviews: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PLATFORM_FEE_RATE = 0.10; // 10%
const PHOTO_SIZE = (SCREEN_WIDTH - 48 - 16) / 3;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
};

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
};

const getInspectorFullName = (report: ReportDetails): string => {
  return `${report.inspector_first_name || ''} ${report.inspector_last_name || ''}`.trim() || 'Inspector';
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// 1. Header
const AnimatedHeader = ({ title, onBack, scrollY }: any) => {
  const opacity = scrollY.interpolate({ inputRange: [0, 100], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <>
      <Animated.View style={[styles.headerBackground, { opacity }]} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerButton}>
          <ChevronLeft size={28} color="#0F172A" />
        </TouchableOpacity>
        <Animated.Text style={[styles.headerTitle, { opacity }]}>{title}</Animated.Text>
        <View style={styles.headerButton} />
      </View>
    </>
  );
};

// 2. Payment Card (Updated with Expenses)
const PaymentCard = ({ price, expenses, inspectorName }: { price: number, expenses: Expense[], inspectorName: string }) => {
  const expenseTotal = expenses.reduce((sum, item) => sum + item.amount, 0);
  const platformFee = price * PLATFORM_FEE_RATE;
  const inspectorBase = price - platformFee;
  const totalPayout = inspectorBase + expenseTotal; // Fee only taken from base price, not expenses

  return (
    <View style={styles.paymentCard}>
      <View style={styles.paymentCardGradient}>
        <View style={styles.paymentHeader}>
          <View style={{flexDirection:'row', gap:8, alignItems:'center'}}>
            <Lock size={16} color="rgba(255,255,255,0.9)" />
            <Text style={styles.paymentLabel}>Escrow + Expenses</Text>
          </View>
          <View style={styles.securedBadge}>
            <Shield size={12} color="#059669" />
            <Text style={styles.securedBadgeText}>Secured</Text>
          </View>
        </View>

        <Text style={styles.paymentAmount}>{formatCurrency(price + expenseTotal)}</Text>
        <Text style={styles.paymentSubtext}>Total to be released</Text>

        <View style={styles.paymentDivider} />

        <View style={{gap: 8}}>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentRowLabel}>Base Job Price</Text>
            <Text style={styles.paymentRowValue}>{formatCurrency(price)}</Text>
          </View>
          {expenseTotal > 0 && (
            <View style={styles.paymentRow}>
              <Text style={styles.paymentRowLabel}>Reimbursable Expenses</Text>
              <Text style={styles.paymentRowValue}>+ {formatCurrency(expenseTotal)}</Text>
            </View>
          )}
          <View style={styles.paymentRow}>
            <Text style={styles.paymentRowLabelSmall}>Platform Fee (10% of base)</Text>
            <Text style={styles.paymentRowValueSmall}>- {formatCurrency(platformFee)}</Text>
          </View>
          <View style={[styles.paymentRow, {marginTop: 4}]}>
            <Text style={[styles.paymentRowLabel, {fontWeight:'700', color:'#FFF'}]}>Net to {inspectorName}</Text>
            <Text style={[styles.paymentRowValue, {fontWeight:'700'}]}>{formatCurrency(totalPayout)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

// 3. Expenses Section (New!)
const ExpensesSection = ({ expenses }: { expenses: Expense[] }) => {
  if (!expenses || expenses.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <Receipt size={20} color="#F59E0B" />
        <Text style={styles.sectionHeaderTitle}>Expenses Claimed</Text>
        <View style={styles.countBadge}><Text style={styles.countText}>{expenses.length}</Text></View>
      </View>

      <View style={styles.expensesList}>
        {expenses.map((item) => (
          <View key={item.id} style={styles.expenseItem}>
            <View style={{flex: 1}}>
              <Text style={styles.expenseDesc}>{item.description}</Text>
              <Text style={styles.expenseDate}>{formatDate(item.created_at)}</Text>
            </View>
            <View style={{alignItems: 'flex-end', gap: 4}}>
              <Text style={styles.expenseAmount}>{formatCurrency(item.amount)}</Text>
              {item.receipt_url && (
                <TouchableOpacity onPress={() => Linking.openURL(item.receipt_url!)} style={styles.receiptLink}>
                  <Eye size={12} color="#3B82F6" />
                  <Text style={styles.receiptLinkText}>Receipt</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

// 4. Report Summary
const SummarySection = ({ summary }: { summary: string }) => {
  const [expanded, setExpanded] = useState(false);
  const isLong = summary.length > 300;

  return (
    <View style={styles.card}>
      <View style={styles.sectionHeader}>
        <FileText size={20} color="#8B5CF6" />
        <Text style={styles.sectionHeaderTitle}>Inspection Summary</Text>
      </View>
      <View style={styles.summaryBox}>
        <Text style={styles.summaryText}>
          {expanded || !isLong ? summary : `${summary.substring(0, 300)}...`}
        </Text>
        {isLong && (
          <TouchableOpacity onPress={() => setExpanded(!expanded)} style={styles.expandBtn}>
            <Text style={styles.expandText}>{expanded ? 'Show Less' : 'Read Full Report'}</Text>
            <ChevronDown size={16} color="#8B5CF6" style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

// 5. Document Card
const DocumentCard = ({ url }: { url: string | null }) => (
  <View style={styles.card}>
    <View style={styles.sectionHeader}>
      <FileCheck size={20} color={url ? "#EF4444" : "#64748B"} />
      <Text style={styles.sectionHeaderTitle}>Official Report</Text>
    </View>

    {url ? (
      <View style={styles.docContent}>
        <View style={styles.pdfIcon}>
          <FileText size={24} color="#EF4444" />
          <Text style={styles.pdfText}>PDF</Text>
        </View>
        <View style={{flex: 1}}>
          <Text style={styles.docTitle}>Final_Inspection_Report.pdf</Text>
          <Text style={styles.docSub}>Full technical details</Text>
        </View>
        <TouchableOpacity onPress={() => Linking.openURL(url)} style={styles.downloadBtn}>
          <Download size={20} color="#3B82F6" />
        </TouchableOpacity>
      </View>
    ) : (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No document uploaded.</Text>
      </View>
    )}
  </View>
);

// 6. Photo Gallery
const PhotoGallery = ({ photos }: { photos: string[] }) => (
  <View style={styles.card}>
    <View style={styles.sectionHeader}>
      <Camera size={20} color="#3B82F6" />
      <Text style={styles.sectionHeaderTitle}>Evidence Photos</Text>
      <View style={styles.countBadge}><Text style={styles.countText}>{photos.length}</Text></View>
    </View>
    {photos.length > 0 ? (
      <View style={styles.photoGrid}>
        {photos.map((uri, idx) => (
          <Image key={idx} source={{ uri }} style={styles.photo} />
        ))}
      </View>
    ) : (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>No photos provided.</Text>
      </View>
    )}
  </View>
);

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ReviewReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const jobId = id ? (Array.isArray(id) ? id[0] : id) : null;
  const router = useRouter();
  const scrollY = useRef(new Animated.Value(0)).current;

  const [report, setReport] = useState<ReportDetails | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);

  // Modals
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  useEffect(() => {
    if (jobId) fetchData();
  }, [jobId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');

      // 1. Fetch Report & Job Info
      const { data: rData, error: rError } = await supabase
        .from('inspection_reports')
        .select(`
          id, job_id, inspector_id, summary, notes, file_url, photos_urls, status,
          revision_notes, revision_count, submitted_at,
          jobs (title, price, location),
          inspector:profiles (first_name, last_name, avatar_url, rating_average, rating_count)
        `)
        .eq('job_id', jobId)
        .maybeSingle();

      if (rError) throw rError;
      if (!rData) throw new Error('Report not found');

      // 2. Fetch Expenses
      const { data: eData } = await supabase
        .from('job_expenses')
        .select('*')
        .eq('job_id', jobId);

      const job = rData.jobs as any;
      const inspector = rData.inspector as any;

      setReport({
        report_id: rData.id,
        job_id: rData.job_id,
        inspector_id: rData.inspector_id,
        summary: rData.summary || rData.notes || 'No summary provided.',
        report_file_url: rData.file_url,
        photos_urls: rData.photos_urls || [],
        report_status: rData.status,
        revision_notes: rData.revision_notes,
        revision_count: rData.revision_count,
        submitted_at: rData.submitted_at,
        job_title: job?.title || 'Job',
        job_price: job?.price || 0,
        job_location: job?.location || '',
        inspector_first_name: inspector?.first_name || '',
        inspector_last_name: inspector?.last_name || '',
        inspector_avatar: inspector?.avatar_url,
        inspector_rating: inspector?.rating_average || 0,
        inspector_reviews: inspector?.rating_count || 0,
      });

      setExpenses(eData || []);

    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!report) return;
    setApproving(true);
    try {
      // 1. Approve Report
      await supabase.from('inspection_reports').update({ status: 'approved', approved_at: new Date() }).eq('id', report.report_id);

      // 2. Complete Job
      await supabase.from('jobs').update({ status: 'completed', completed_at: new Date() }).eq('id', jobId);

      // 3. Approve Expenses
      await supabase.from('job_expenses').update({ status: 'approved' }).eq('job_id', jobId);

      setShowConfirmModal(false);
      setShowSuccessModal(true);
    } catch (e: any) {
      Alert.alert('Error', 'Failed to approve. Try again.');
    } finally {
      setApproving(false);
    }
  };

  if (loading) return (
    <SafeAreaView style={styles.loadingContainer}>
      <ActivityIndicator size="large" color="#3B82F6" />
    </SafeAreaView>
  );

  if (!report) return null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <AnimatedHeader title="Review Report" onBack={() => router.back()} scrollY={scrollY} />

      <Animated.ScrollView
        style={styles.content}
        contentContainerStyle={{ padding: 16, paddingTop: Platform.OS === 'ios' ? 60 : 16, paddingBottom: 120 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
      >
        {/* Job Info */}
        <View style={styles.hero}>
          <View style={styles.statusPill}>
            <Clock size={12} color="#B45309" />
            <Text style={styles.statusText}>Action Required</Text>
          </View>
          <Text style={styles.heroTitle}>{report.job_title}</Text>
          <View style={styles.heroRow}>
            <MapPin size={14} color="#64748B" />
            <Text style={styles.heroText}>{report.job_location}</Text>
            <View style={styles.dot} />
            <Text style={styles.heroText}>Submitted {formatDate(report.submitted_at)}</Text>
          </View>
        </View>

        {/* Payment Card */}
        <PaymentCard
          price={report.job_price}
          expenses={expenses}
          inspectorName={getInspectorFullName(report)}
        />

        {/* Inspector */}
        <View style={styles.card}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <Image
              source={report.inspector_avatar ? { uri: report.inspector_avatar } : { uri: 'https://via.placeholder.com/100' }}
              style={styles.avatar}
            />
            <View style={{flex: 1, marginLeft: 12}}>
              <Text style={styles.inspectorName}>{getInspectorFullName(report)}</Text>
              <View style={{flexDirection: 'row', gap: 4, alignItems: 'center'}}>
                <Star size={12} color="#FBBF24" fill="#FBBF24" />
                <Text style={styles.ratingText}>{report.inspector_rating.toFixed(1)} ({report.inspector_reviews})</Text>
              </View>
            </View>
            <View style={styles.verifiedBadge}>
              <CheckCircle2 size={14} color="#16A34A" />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          </View>
        </View>

        {/* Sections */}
        <ExpensesSection expenses={expenses} />
        <SummarySection summary={report.summary} />
        <DocumentCard url={report.report_file_url} />
        <PhotoGallery photos={report.photos_urls} />

      </Animated.ScrollView>

      {/* Footer Actions */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.revisionBtn} onPress={() => Alert.alert('Coming Soon', 'Revision requests coming in next update')}>
          <RefreshCw size={20} color="#F59E0B" />
          <Text style={styles.revisionText}>Request Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.approveBtn} onPress={() => setShowConfirmModal(true)}>
          <CheckCircle2 size={20} color="#FFF" />
          <Text style={styles.approveText}>Approve & Pay</Text>
        </TouchableOpacity>
      </View>

      {/* Confirmation Modal */}
      <Modal visible={showConfirmModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}><DollarSign size={32} color="#FFF" /></View>
            <Text style={styles.modalTitle}>Release Payment?</Text>
            <Text style={styles.modalSub}>This will finalize the job and transfer funds to the inspector.</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowConfirmModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleApprove} disabled={approving}>
                {approving ? <ActivityIndicator color="#FFF" /> : <Text style={styles.modalConfirmText}>Confirm Release</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success Modal */}
      <Modal visible={showSuccessModal} transparent animationType="slide">
        <View style={styles.successOverlay}>
          <View style={styles.successCard}>
            <PartyPopper size={48} color="#22C55E" />
            <Text style={styles.successTitle}>Payment Released!</Text>
            <Text style={styles.successSub}>The job is marked as complete.</Text>
            <TouchableOpacity style={styles.successBtn} onPress={() => router.replace('/(client)/jobs')}>
              <Text style={styles.successBtnText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, paddingTop: Platform.OS === 'ios' ? 60 : 12, zIndex: 100 },
  headerBackground: { position: 'absolute', top: 0, left: 0, right: 0, height: Platform.OS === 'ios' ? 100 : 60, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', zIndex: 99 },
  headerButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.8)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: '#0F172A' },

  // Hero
  hero: { marginBottom: 20 },
  statusPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF3C7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 12 },
  statusText: { color: '#B45309', fontSize: 12, fontWeight: '600' },
  heroTitle: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroText: { color: '#64748B', fontSize: 13 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1' },

  // Cards
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },

  // Payment Card
  paymentCard: { marginBottom: 20, borderRadius: 20, overflow: 'hidden', shadowColor: '#059669', shadowOpacity: 0.2, shadowRadius: 10, elevation: 5 },
  paymentCardGradient: { backgroundColor: '#059669', padding: 20 },
  paymentHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  paymentLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600' },
  securedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  securedBadgeText: { color: '#059669', fontSize: 10, fontWeight: '700' },
  paymentAmount: { color: '#FFF', fontSize: 32, fontWeight: '800' },
  paymentSubtext: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginBottom: 16 },
  paymentDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 16 },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  paymentRowLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  paymentRowValue: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  paymentRowLabelSmall: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },
  paymentRowValueSmall: { color: 'rgba(255,255,255,0.6)', fontSize: 12 },

  // Inspector
  avatar: { width: 48, height: 48, borderRadius: 24 },
  inspectorName: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  ratingText: { fontSize: 12, color: '#64748B' },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#DCFCE7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  verifiedText: { fontSize: 11, color: '#16A34A', fontWeight: '600' },

  // Headers
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionHeaderTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A', flex: 1 },
  countBadge: { backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  countText: { fontSize: 12, fontWeight: '600', color: '#64748B' },

  // Expenses
  expensesList: { gap: 12 },
  expenseItem: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  expenseDesc: { fontSize: 14, fontWeight: '600', color: '#334155' },
  expenseDate: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  expenseAmount: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  receiptLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  receiptLinkText: { fontSize: 11, color: '#3B82F6', fontWeight: '600' },

  // Summary
  summaryBox: { backgroundColor: '#F8FAFC', padding: 12, borderRadius: 12 },
  summaryText: { fontSize: 14, color: '#475569', lineHeight: 22 },
  expandBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  expandText: { fontSize: 13, color: '#8B5CF6', fontWeight: '600' },

  // Document
  docContent: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', padding: 12, borderRadius: 12, gap: 12 },
  pdfIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
  pdfText: { fontSize: 8, fontWeight: '800', color: '#EF4444', marginTop: 2 },
  docTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  docSub: { fontSize: 12, color: '#64748B' },
  downloadBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', padding: 20 },
  emptyText: { color: '#94A3B8', fontSize: 13 },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 8 },

  // Footer
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFF', padding: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 16, borderTopWidth: 1, borderTopColor: '#F1F5F9', flexDirection: 'row', gap: 12 },
  revisionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: '#FEF3C7' },
  revisionText: { fontSize: 14, fontWeight: '600', color: '#B45309' },
  approveBtn: { flex: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: '#22C55E' },
  approveText: { fontSize: 14, fontWeight: '700', color: '#FFF' },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: '#FFF', width: '100%', borderRadius: 24, padding: 24, alignItems: 'center' },
  modalIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#22C55E', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  modalSub: { fontSize: 14, color: '#64748B', textAlign: 'center', marginBottom: 24 },
  modalActions: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center' },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: '#64748B' },
  modalConfirm: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: '#22C55E', alignItems: 'center' },
  modalConfirmText: { fontSize: 14, fontWeight: '700', color: '#FFF' },

  // Success
  successOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  successCard: { backgroundColor: '#FFF', width: '85%', borderRadius: 24, padding: 32, alignItems: 'center' },
  successTitle: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginTop: 16, marginBottom: 8 },
  successSub: { fontSize: 14, color: '#64748B', textAlign: 'center', marginBottom: 24 },
  successBtn: { width: '100%', backgroundColor: '#3B82F6', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  successBtnText: { color: '#FFF', fontWeight: '700', fontSize: 15 }
});
