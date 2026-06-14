import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, Modal, Dimensions, Linking, Platform, Animated, StatusBar, Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft, FileText, Camera, Check, CheckCircle2, AlertTriangle,
  RefreshCw, DollarSign, Lock, Star, Download, Eye, User, Clock,
  Shield, ChevronRight, Sparkles, PartyPopper, MapPin, Receipt,
  Maximize2, ChevronDown
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
// ★ AGENCY-PARITY-006 — Approve & Request-revision now hit the
//   approve_inspection_report RPC (atomic, ownership-checked against
//   BOTH jobs.client_id and jobs.agency_id). Gating mirrors the parent
//   /jobs/[id] screen via canManageJob so agencies see the same buttons
//   under identical UX, and non-owners see nothing.

// TYPES
interface Expense {
  id: string; description: string; amount: number; receipt_url: string | null; created_at: string;
}
interface ReportDetails {
  report_id: string; job_id: string; contractor_id: string; summary: string;
  report_file_url: string | null; photos_urls: string[]; report_status: string;
  revision_notes: string | null; revision_count: number; submitted_at: string;
  job_title: string; job_price_cents: number; job_location: string; escrow_status: string;  // ★ Task 4
  contractor_payout_amount_cents: number;  // ★ Task 4
  // ★ AGENCY-PARITY-006 — buyer-ownership fields fetched alongside job
  //   metadata so canManageJob can be computed locally.
  job_client_id: string | null;
  job_agency_id: string | null;
  inspector_first_name: string; inspector_last_name: string; inspector_avatar: string | null;
  inspector_rating: number; inspector_reviews: number;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PLATFORM_FEE_RATE = 0.10; // 10%
const PHOTO_SIZE = (SCREEN_WIDTH - 48 - 16) / 3;

// HELPER: Format Currency
// ★ Task 4: input is integer CENTS — divide by 100 before format.
const formatCurrency = (cents: number) => {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

export default function ReviewReportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); // Job ID
  const router = useRouter();
  const scrollY = useRef(new Animated.Value(0)).current;
  // ★ AGENCY-PARITY-006 — role + user for canManageJob gate
  const { role, user } = useAuth();

  const [report, setReport] = useState<ReportDetails | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  // ★ AGENCY-PARITY-006 — Request Changes modal state
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [revisionSubmitting, setRevisionSubmitting] = useState(false);
  const [successKind, setSuccessKind] = useState<'approved' | 'revision'>('approved');

  // ★ AGENCY-PARITY-006 — same gate as the parent /jobs/[id] screen.
  //   Buyer (client or agency) sees the action buttons; everyone else sees
  //   the page in read-only mode (existing UI minus the footer).
  const canManageJob =
    !!user?.id &&
    !!report &&
    (
      (role === 'client' && user.id === report.job_client_id) ||
      (role === 'agency' && user.id === report.job_agency_id)
    );

  useEffect(() => { if (id) fetchData(); }, [id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user');

      // 1. Fetch Report & Job Info
      // ★ AGENCY-PARITY-006 — pulled client_id + agency_id so the screen
      //   can compute canManageJob without an extra round trip.
      const { data: rData, error: rError } = await supabase
        .from('inspection_reports')
        .select(`
          id, job_id, contractor_id, summary, notes, file_url, photos_urls, status,
          revision_notes, revision_count, submitted_at,
          jobs (title, price_cents, location, escrow_status, contractor_payout_amount_cents, client_id, agency_id),
          inspector:profiles (rating_average, rating_count)
        `)
        .eq('job_id', id)
        .maybeSingle();

      if (rError) throw rError;
      if (!rData) {
         Alert.alert('Report Not Found', 'The inspector has not submitted a report yet.');
         router.back();
         return;
      }

      // 2. Fetch Expenses
      const { data: eData } = await supabase
        .from('job_expenses')
        .select('*')
        .eq('job_id', id);

      const job = rData.jobs as any;
      const inspector = rData.inspector as any;

      setReport({
        report_id: rData.id,
        job_id: rData.job_id,
        contractor_id: rData.contractor_id,
        summary: rData.summary || rData.notes || 'No summary provided.',
        report_file_url: rData.file_url,
        photos_urls: rData.photos_urls || [],
        report_status: rData.status,
        revision_notes: rData.revision_notes,
        revision_count: rData.revision_count,
        submitted_at: rData.submitted_at,
        job_title: job?.title || 'Job',
        // ★ Task 4: integer cents end-to-end.
        job_price_cents: job?.price_cents || 0,
        job_location: job?.location || '',
        escrow_status: job?.escrow_status || 'funded',
        contractor_payout_amount_cents: job?.contractor_payout_amount_cents || 0,
        // ★ AGENCY-PARITY-006 — ownership pass-through for the gate.
        job_client_id: job?.client_id ?? null,
        job_agency_id: job?.agency_id ?? null,
        // ANTI-POACHING: inspector identity not held client-side on this
        // pre-reveal report-review screen. Empty for type compatibility.
        inspector_first_name: '',
        inspector_last_name: '',
        inspector_avatar: null,
        inspector_rating: inspector?.rating_average || 0,
        inspector_reviews: inspector?.rating_count || 0,
      });

      setExpenses(eData || []);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ★ AGENCY-PARITY-006 — Approval now goes through the
  //   approve_inspection_report RPC, which is atomic (report status +
  //   audit-event INSERT roll back together on error) and authorizes
  //   the caller against BOTH jobs.client_id and jobs.agency_id. The
  //   prior implementation did 3 raw UPDATEs with no atomicity and no
  //   server-side authorization (only RLS, which we've since hardened).
  //   Expenses-approval is intentionally NOT in the RPC's scope — that
  //   stays a client-side write until/unless it gets pulled into the
  //   atomic transaction in a follow-up migration.
  const handleApprove = async () => {
    if (!report) return;
    if (!canManageJob) {
      Alert.alert('Not allowed', 'Only the job owner can approve this report.');
      return;
    }
    setApproving(true);
    try {
      const { data, error } = await supabase.rpc('approve_inspection_report', {
        p_job_id: id,
        p_approved: true,
        p_comment: null,
      });
      if (error) throw error;
      if (!(data as any)?.ok) {
        throw new Error('RPC returned ok=false');
      }
      // Expenses bookkeeping — non-atomic side effect, kept out of the RPC.
      try {
        await supabase.from('job_expenses').update({ status: 'approved' }).eq('job_id', id);
      } catch (expErr) {
        console.warn('[review-report] expenses update failed (non-fatal):', expErr);
      }
      setShowConfirmModal(false);
      setSuccessKind('approved');
      setShowSuccessModal(true);
    } catch (e: any) {
      console.error('[review-report] approve failed:', e);
      Alert.alert('Error', e?.message ?? 'Failed to process approval.');
    } finally {
      setApproving(false);
    }
  };

  // ★ AGENCY-PARITY-006 — Request Changes: same RPC, p_approved=false.
  //   The inspection_reports row's status flips to 'revision_requested'
  //   and a job_events row is emitted so the inspector gets pinged via
  //   the existing notify-job-event dispatcher.
  const handleRequestRevision = async () => {
    if (!report) return;
    if (!canManageJob) {
      Alert.alert('Not allowed', 'Only the job owner can request changes on this report.');
      return;
    }
    const trimmed = revisionNotes.trim();
    if (trimmed.length < 8) {
      Alert.alert('Add detail', 'Please describe what needs to change (at least a sentence).');
      return;
    }
    setRevisionSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('approve_inspection_report', {
        p_job_id: id,
        p_approved: false,
        p_comment: trimmed,
      });
      if (error) throw error;
      if (!(data as any)?.ok) {
        throw new Error('RPC returned ok=false');
      }
      setShowRevisionModal(false);
      setRevisionNotes('');
      setSuccessKind('revision');
      setShowSuccessModal(true);
    } catch (e: any) {
      console.error('[review-report] revision request failed:', e);
      Alert.alert('Error', e?.message ?? 'Failed to send revision request.');
    } finally {
      setRevisionSubmitting(false);
    }
  };

  // --- Sub-Components (Inline for simplicity) ---

  const PaymentCard = () => {
    if (!report) return null;
    const expenseTotal = expenses.reduce((sum, item) => sum + item.amount, 0);
    // Logic: Total Payout is the manually set amount plus claimed expenses
    // ★ Task 4: integer cents math is identical to dollar math, just different unit.
    const inspectorPayout = report.contractor_payout_amount_cents + expenseTotal;
    const serviceCommission = report.job_price_cents - report.contractor_payout_amount_cents;

    return (
      <View style={styles.paymentCard}>
        <View style={styles.paymentGradient}>
          <View style={styles.rowBetween}>
            <View style={{flexDirection:'row', alignItems:'center', gap:6}}>
              <Lock size={14} color="rgba(255,255,255,0.9)" />
              <Text style={styles.payLabel}>Managed Escrow Disbursement</Text>
            </View>
            <View style={styles.secureBadge}><Text style={styles.secureText}>MANAGED</Text></View>
          </View>
          <Text style={styles.totalAmount}>{formatCurrency(report.job_price_cents + expenseTotal)}</Text>
          <Text style={styles.totalLabel}>Total value released</Text>
          <View style={styles.divider} />

          <View style={styles.rowBetween}>
            <Text style={styles.lineLabel}>Project Value</Text>
            <Text style={styles.lineValue}>{formatCurrency(report.job_price_cents)}</Text>
          </View>
          {expenseTotal > 0 && (
            <View style={styles.rowBetween}>
              <Text style={styles.lineLabel}>Expenses (Reimbursed)</Text>
              <Text style={styles.lineValue}>+ {formatCurrency(expenseTotal)}</Text>
            </View>
          )}
          {serviceCommission > 0 && (
            <View style={styles.rowBetween}>
              <Text style={styles.lineLabel}>Managed Commission</Text>
              <Text style={styles.lineValue}>- {formatCurrency(serviceCommission)}</Text>
            </View>
          )}
          <View style={[styles.rowBetween, {marginTop: 8}]}>
            <Text style={[styles.lineLabel, {color:'#FFF', fontWeight:'bold'}]}>Net to Contractor</Text>
            <Text style={[styles.lineValue, {fontSize: 16}]}>{formatCurrency(inspectorPayout)}</Text>
          </View>
        </View>
      </View>
    );
  };

  const ExpensesList = () => {
    if (expenses.length === 0) return null;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Receipt size={20} color="#F59E0B" />
          <Text style={styles.cardTitle}>Expenses Claimed</Text>
        </View>
        {expenses.map((exp, i) => (
          <View key={i} style={styles.expenseRow}>
            <View style={{flex:1}}>
              <Text style={styles.expDesc}>{exp.description}</Text>
              <Text style={styles.expDate}>{new Date(exp.created_at).toLocaleDateString()}</Text>
            </View>
            <View style={{alignItems:'flex-end'}}>
              <Text style={styles.expAmount}>{formatCurrency(exp.amount)}</Text>
              {exp.receipt_url && (
                <TouchableOpacity onPress={() => Linking.openURL(exp.receipt_url!)}>
                  <Text style={styles.viewReceipt}>View Receipt</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </View>
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#3B82F6"/></View>;
  if (!report) return null;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review & Pay</Text>
        <View style={{width:40}} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* Status Banner */}
        <View style={styles.statusBanner}>
          <Clock size={16} color="#B45309" />
          <Text style={styles.statusText}>Action Required: Review findings to release payment.</Text>
        </View>

        <Text style={styles.jobTitle}>{report.job_title}</Text>

        {/* Payment Card */}
        <PaymentCard />

        {/* Expenses Section */}
        <ExpensesList />

        {/* Report Summary */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <FileText size={20} color="#3B82F6" />
            <Text style={styles.cardTitle}>Inspector's Report</Text>
          </View>
          <Text style={styles.summaryText}>{report.summary}</Text>

          {report.report_file_url && (
            <TouchableOpacity style={styles.docBtn} onPress={() => Linking.openURL(report.report_file_url!)}>
              <FileText size={20} color="#EF4444" />
              <View style={{flex:1}}>
                <Text style={styles.docName}>Full_Report.pdf</Text>
                <Text style={styles.docSub}>Tap to view document</Text>
              </View>
              <Download size={20} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>

        {/* Photos */}
        {report.photos_urls.length > 0 && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Camera size={20} color="#8B5CF6" />
              <Text style={styles.cardTitle}>Evidence Photos</Text>
            </View>
            <View style={styles.photoGrid}>
              {report.photos_urls.map((url, i) => (
                <Image key={i} source={{ uri: url }} style={styles.photo} />
              ))}
            </View>
         </View>
       )}

       {/* EXTERNAL CHAT BUTTON */}
       <TouchableOpacity 
         style={{ backgroundColor: '#F1F5F9', padding: 16, borderRadius: 12, marginTop: 16, borderWidth: 1, borderColor: '#7C3AED', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
         onPress={() => router.push(`/chat/${id}?chatType=admin_support`)} 
       >
         <View style={{ flexDirection: 'row', alignItems: 'center' }}>
           <FileText size={24} color="#7C3AED" style={{ marginRight: 12 }} />
           <View>
             <Text style={{ color: '#0F172A', fontSize: 16, fontWeight: 'bold' }}>Chat with Admin</Text>
             <Text style={{ color: '#64748B', fontSize: 12 }}>External support conversation</Text>
           </View>
         </View>
         <ChevronRight size={20} color="#7C3AED" />
       </TouchableOpacity>

     </ScrollView>

     {/* Footer Actions — gated to buyer (client or agency). Non-owners
         (inspector, admin, anonymous deep-linkers) see the report in
         read-only mode without the action buttons. */}
      {canManageJob && (
      <View style={styles.footer}>
        <TouchableOpacity style={styles.revisionBtn} onPress={() => { setRevisionNotes(''); setShowRevisionModal(true); }}>
          <RefreshCw size={20} color="#F59E0B" />
          <Text style={styles.revisionText}>Request Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.approveBtn} onPress={() => setShowConfirmModal(true)}>
          <CheckCircle2 size={20} color="#FFF" />
          <Text style={styles.approveText}>Approve & Pay</Text>
        </TouchableOpacity>
      </View>
      )}

      {/* Confirmation Modal */}
      <Modal visible={showConfirmModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}><DollarSign size={32} color="#FFF" /></View>
            <Text style={styles.modalTitle}>Release Payment?</Text>
            <Text style={styles.modalSub}>This will transfer funds to the inspector and mark the job as complete.</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowConfirmModal(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleApprove} disabled={approving}>
                {approving ? <ActivityIndicator color="#FFF"/> : <Text style={styles.confirmText}>Confirm Release</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success Modal — branches on whether the last action was approve
          or revision-request. Existing modal recipe (modalBg/modalCard/
          modalTitle/modalSub/successBtn) is reused verbatim — only the
          copy + icon differ. */}
      <Modal visible={showSuccessModal} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            {successKind === 'approved' ? (
              <>
                <PartyPopper size={48} color="#22C55E" />
                <Text style={styles.modalTitle}>Report Approved!</Text>
                <Text style={styles.modalSub}>Payment release is queued. The job will be marked complete once Stripe captures the held funds.</Text>
              </>
            ) : (
              <>
                <RefreshCw size={48} color="#F59E0B" />
                <Text style={styles.modalTitle}>Revision Requested</Text>
                <Text style={styles.modalSub}>The inspector has been notified and can resubmit. You'll see the updated report here when they do.</Text>
              </>
            )}
            <TouchableOpacity style={styles.successBtn} onPress={() => router.replace('/(client)/jobs')}>
              <Text style={styles.successText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Revision Modal — reuses the same modal recipe so it visually
          matches the Approve & Pay confirmation modal. The only new
          control is a multi-line text input for the revision notes. */}
      <Modal visible={showRevisionModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={[styles.modalIcon, { backgroundColor: '#F59E0B' }]}>
              <RefreshCw size={32} color="#FFF" />
            </View>
            <Text style={styles.modalTitle}>Request Changes</Text>
            <Text style={styles.modalSub}>Describe what needs to change. The inspector will receive your note and can resubmit.</Text>
            <View style={{ width: '100%', marginBottom: 16 }}>
              <View style={{ borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, backgroundColor: '#F8FAFC', paddingHorizontal: 12, paddingVertical: 10, minHeight: 96 }}>
                <RevisionNotesInput value={revisionNotes} onChangeText={setRevisionNotes} />
              </View>
            </View>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setShowRevisionModal(false); setRevisionNotes(''); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalConfirm, { backgroundColor: '#F59E0B' }]}
                onPress={handleRequestRevision}
                disabled={revisionSubmitting}
              >
                {revisionSubmitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.confirmText}>Send Request</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// ★ AGENCY-PARITY-006 — tiny adapter so we can drop a TextInput inside
//   the existing modal recipe without restructuring the JSX or adding a
//   new style. Keeps the modal looking identical to the Approve modal.
import { TextInput as RNTextInput } from 'react-native';
function RevisionNotesInput({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  return (
    <RNTextInput
      value={value}
      onChangeText={onChangeText}
      placeholder="e.g. The exterior photo doesn't clearly show the company signage. Please retake with the sign in frame."
      placeholderTextColor="#94A3B8"
      multiline
      style={{ flex: 1, padding: 0, margin: 0, color: '#0F172A', fontSize: 14, lineHeight: 20, textAlignVertical: 'top', minHeight: 76 }}
    />
  );
}

// STYLES
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 60, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A', marginLeft: 10 },
  scrollContent: { padding: 16, paddingBottom: 120 },

  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF3C7', padding: 12, borderRadius: 12, marginBottom: 16 },
  statusText: { color: '#B45309', fontWeight: '600', fontSize: 13 },
  jobTitle: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 20 },

  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A' },

  // Payment Card
  paymentCard: { borderRadius: 16, overflow: 'hidden', marginBottom: 20, elevation: 4 },
  paymentGradient: { backgroundColor: '#059669', padding: 20 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  payLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' },
  secureBadge: { backgroundColor: '#FFF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  secureText: { color: '#059669', fontSize: 10, fontWeight: '800' },
  totalAmount: { color: '#FFF', fontSize: 32, fontWeight: '800', marginVertical: 8 },
  totalLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginBottom: 16 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginBottom: 12 },
  lineLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 13 },
  lineValue: { color: '#FFF', fontSize: 13, fontWeight: '600' },

  // Expense List
  expenseRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  expDesc: { fontWeight: '600', color: '#334155' },
  expDate: { fontSize: 12, color: '#94A3B8' },
  expAmount: { fontWeight: '700', color: '#0F172A' },
  viewReceipt: { fontSize: 12, color: '#3B82F6', fontWeight: '600', marginTop: 4 },

  summaryText: { color: '#475569', lineHeight: 22 },
  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FEF2F2', padding: 12, borderRadius: 12, marginTop: 16, borderWidth: 1, borderColor: '#FECACA' },
  docName: { fontWeight: '700', color: '#0F172A' },
  docSub: { fontSize: 12, color: '#64748B' },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 8 },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFF', padding: 16, paddingBottom: 34, borderTopWidth: 1, borderTopColor: '#E2E8F0', flexDirection: 'row', gap: 12 },
  revisionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: '#FEF3C7' },
  revisionText: { fontSize: 14, fontWeight: '600', color: '#B45309' },
  approveBtn: { flex: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: '#22C55E' },
  approveText: { fontSize: 14, fontWeight: '700', color: '#FFF' },

  // Modals
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: '#FFF', borderRadius: 24, padding: 24, width: '100%', alignItems: 'center' },
  modalIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#22C55E', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  modalSub: { textAlign: 'center', color: '#64748B', marginBottom: 24 },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center' },
  cancelText: { fontWeight: '600', color: '#64748B' },
  modalConfirm: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#22C55E', alignItems: 'center' },
  confirmText: { fontWeight: '600', color: '#FFF' },
  successBtn: { width: '100%', padding: 16, backgroundColor: '#3B82F6', borderRadius: 12, alignItems: 'center' },
  successText: { color: '#FFF', fontWeight: '700' }
});
