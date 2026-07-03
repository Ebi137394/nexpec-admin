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
import { nxHandle } from '@/src/core/utils/handle';
import { signedUrl, signedUrls, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';

// ★ NEXPEC brand palette (locked): deep-navy canvas + violet accent.
const C = {
  bg: '#020420',
  card: '#0A0D2C',
  border: '#1A1D3C',
  violet: '#7C3AED',
  violetSoft: 'rgba(124,58,237,0.14)',
  text: '#FFFFFF',
  textDim: '#9CA3AF',
  textMute: '#64748B',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
};

// ANTI-POACHING: a stored report's free-text notes can carry the inspector's
// real name in a "SIGNED BY:" line. Strip it for client-facing display — the
// signature is re-rendered separately as the pseudonymous NX handle.
const stripInspectorSignature = (raw: string): string =>
  (raw || '')
    .split('\n')
    .filter((line) => !/^\s*signed\s*by\s*[:\-]/i.test(line))
    .join('\n')
    .trim();

const titleCase = (s: string): string =>
  s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// Parse a stored report's free-text notes into structured sections so it can be
// rendered as a polished document (not a raw monospace blob). Recognizes a
// leading [TAG] line and ALL-CAPS "HEADING:" markers; the inspector signature
// line is dropped (re-rendered separately as the pseudonymous NX handle).
type ReportSection = { title: string; body: string };
function parseReport(raw: string): { tag: string | null; sections: ReportSection[] } {
  const lines = stripInspectorSignature(raw).split('\n');
  let tag: string | null = null;
  const out: { title: string; body: string[] }[] = [];
  let cur: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t && !cur) continue; // skip leading blank lines
    const tagMatch = t.match(/^\[(.+)\]$/);
    if (tagMatch && !cur && out.length === 0) { tag = titleCase(tagMatch[1]); continue; }
    const headMatch = t.match(/^([A-Z][A-Z0-9 /&'\-]{2,}):$/);
    if (headMatch) { cur = { title: titleCase(headMatch[1].trim()), body: [] }; out.push(cur); continue; }
    if (!cur) { cur = { title: 'Summary', body: [] }; out.push(cur); }
    cur.body.push(line);
  }
  return { tag, sections: out.map((s) => ({ title: s.title, body: s.body.join('\n').trim() })) };
}
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
  job_title: string; job_price_cents: number; job_location: string;  // ★ Task 4
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
  // Track evidence photos whose remote image failed to load, so a broken /
  // permission-gated URL never leaves a dead dark tile in the grid.
  const [brokenPhotos, setBrokenPhotos] = useState<Record<string, boolean>>({});
  // Storage lockdown: photos_urls / report_file_url now hold private storage
  // PATHS, not URLs. Mint signed URLs once after fetch and render from state
  // (never await inside JSX). Keyed by the stored path; null = mint failed.
  const [photoUrlMap, setPhotoUrlMap] = useState<Record<string, string | null>>({});
  const [reportFileSignedUrl, setReportFileSignedUrl] = useState<string | null>(null);

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
        // Real inspection_reports schema: inspector_id (not contractor_id),
        // notes (not summary), pdf_url/final_report_doc (not file_url),
        // photo_url single (not photos_urls[]), created_at (not submitted_at);
        // there are no revision_* columns on this table.
        .select(`
          id, job_id, inspector_id, notes, photo_url, pdf_url, final_report_doc, status, created_at, is_published,
          jobs (title, price_cents, location, client_id, agency_id),
          inspector:profiles (rating_average, rating_count)
        `)
        .eq('job_id', id)
        // GR3 (report→admin→client): a buyer may only ever open a report the
        // admin has reviewed and released. Deep links to submitted/unreviewed
        // reports must bounce, not render.
        .eq('is_published', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (rError) throw rError;
      if (!rData) {
         Alert.alert('Report Not Available', 'No released report yet. Reports appear here once reviewed and released by NEXPEC.');
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
        // Map real columns → existing UI fields (interface unchanged):
        contractor_id: rData.inspector_id,
        summary: rData.notes || 'No summary provided.',
        report_file_url: rData.pdf_url || rData.final_report_doc || null,
        photos_urls: rData.photo_url ? [rData.photo_url] : [],
        report_status: rData.status,
        revision_notes: null,   // no revision_notes column on inspection_reports
        revision_count: 0,      // no revision_count column on inspection_reports
        submitted_at: rData.created_at,
        job_title: job?.title || 'Job',
        // ★ Task 4: integer cents end-to-end.
        job_price_cents: job?.price_cents || 0,
        job_location: job?.location || '',
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

      // job_expenses.amount is NUMERIC DOLLARS (inspector enters dollars);
      // every consumer below (PaymentCard sum, ExpensesList) works in integer
      // CENTS via formatCurrency. Convert once at the fetch boundary.
      setExpenses(
        (eData || []).map((exp: any) => ({
          ...exp,
          amount: Math.round((Number(exp.amount) || 0) * 100),
        })),
      );

      // ── Storage lockdown: mint signed URLs for the now-PATH-valued fields ──
      // Evidence photos live in `inspection-photos`; the report doc lives in
      // `job-documents`. Both are private — render must use signed URLs minted
      // here (once), not getPublicUrl and never awaited inside JSX.
      const photoPaths = (rData.photo_url ? [rData.photo_url] : []).filter(
        (p): p is string => typeof p === 'string' && p.trim().length > 0,
      );
      if (photoPaths.length > 0) {
        const map = await signedUrls('inspection-photos', photoPaths, SIGNED_URL_TTL.VIEW);
        setPhotoUrlMap(map);
      } else {
        setPhotoUrlMap({});
      }

      const docPath = rData.pdf_url || rData.final_report_doc || null;
      if (docPath) {
        const url = await signedUrl({ bucket: 'job-documents', path: docPath, ttl: SIGNED_URL_TTL.VIEW });
        setReportFileSignedUrl(url);
      } else {
        setReportFileSignedUrl(null);
      }
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
    // PRICE-BLINDNESS: the client/agency sees ONLY what they pay (project value
    // + any reimbursed expenses). The inspector's net payout and the NEXPEC
    // managed commission are deliberately NOT derived or shown on this screen.

    return (
      <View style={styles.paymentCard}>
        <View style={styles.paymentGradient}>
          <View style={styles.rowBetween}>
            <View style={{flexDirection:'row', alignItems:'center', gap:6}}>
              <Lock size={14} color="rgba(255,255,255,0.9)" />
              <Text style={styles.payLabel}>Managed Disbursement</Text>
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
          <View style={[styles.rowBetween, {marginTop: 8}]}>
            <Text style={[styles.lineLabel, {color:'#FFF', fontWeight:'bold'}]}>Secured Funds</Text>
            <Text style={[styles.lineValue, {fontSize: 16}]}>{formatCurrency(report.job_price_cents + expenseTotal)}</Text>
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
              {/* Raw receipt scan intentionally NOT shown to the buyer
                  (price-blindness + anti-poaching: receipts can carry the
                  inspector's identity/cost detail). The `receipts` bucket is
                  owner+admin only; admin reviews receipts during reconciliation. */}
            </View>
          </View>
        ))}
      </View>
    );
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#7C3AED"/></View>;
  if (!report) return null;

  const parsed = parseReport(report.summary);
  // report.photos_urls holds storage PATHS; keep only those with a freshly
  // minted, non-broken signed URL so a dead/permission-gated tile never shows.
  const photos = (report.photos_urls || []).filter(
    (p) => typeof p === 'string' && p.trim().length > 0 && !!photoUrlMap[p] && !brokenPhotos[p],
  );
  const statusMeta =
    report.report_status === 'approved'
      ? { label: 'Approved', color: '#22C55E' }
      : report.report_status === 'published'
      ? { label: 'Published', color: '#22C55E' }
      : report.report_status === 'revision_requested'
      ? { label: 'Revision Requested', color: '#F59E0B' }
      : { label: 'Submitted', color: '#7C3AED' };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ChevronLeft size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review & Pay</Text>
        <View style={{width:40}} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>

        {/* Status Banner */}
        <View style={styles.statusBanner}>
          <Clock size={16} color="#F59E0B" />
          <Text style={styles.statusText}>Action Required: Review findings to release payment.</Text>
        </View>

        <Text style={styles.jobTitle}>{report.job_title}</Text>

        {/* Payment Card */}
        <PaymentCard />

        {/* Expenses Section */}
        <ExpensesList />

        {/* Report — parsed into structured sections + a credential signature.
            Inspector identity stays the pseudonymous NX handle (anti-poaching). */}
        <View style={styles.card}>
          <View style={styles.reportHeaderRow}>
            <View style={styles.reportIconWrap}>
              <FileText size={18} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Inspector's Report</Text>
              {parsed.tag ? <Text style={styles.reportEyebrow}>{parsed.tag}</Text> : null}
            </View>
            <View style={[styles.statusPill, { borderColor: statusMeta.color + '59', backgroundColor: statusMeta.color + '1F' }]}>
              <Text style={[styles.statusPillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            </View>
          </View>

          <View style={styles.reportBody}>
            {parsed.sections.length === 0 ? (
              <Text style={styles.sectionBody}>No report details were provided.</Text>
            ) : (
              parsed.sections.map((sec, i) => (
                <View key={i} style={i > 0 ? { marginTop: 18 } : undefined}>
                  <View style={styles.sectionLabelRow}>
                    <View style={styles.sectionTick} />
                    <Text style={styles.sectionLabel}>{sec.title}</Text>
                  </View>
                  <Text style={styles.sectionBody}>{sec.body || 'None noted.'}</Text>
                </View>
              ))
            )}

            {/* Credential signature — anonymized, tamper-evident chip */}
            <View style={styles.credChip}>
              <View style={styles.credSigil}>
                <Text style={styles.credSigilTxt}>NX</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.credName}>{nxHandle(report.contractor_id)}</Text>
                <Text style={styles.credRole}>Verified NEXPEC Inspector</Text>
              </View>
              <View style={styles.credVerified}>
                <Check size={12} color="#22C55E" />
                <Text style={styles.credVerifiedTxt}>Verified</Text>
              </View>
            </View>
          </View>

          {reportFileSignedUrl && (
            <TouchableOpacity style={styles.docBtn} onPress={() => Linking.openURL(reportFileSignedUrl)}>
              <View style={styles.docIconWrap}><FileText size={18} color="#7C3AED" /></View>
              <View style={{flex:1}}>
                <Text style={styles.docName}>Full Inspection Report</Text>
                <Text style={styles.docSub}>PDF · tap to open</Text>
              </View>
              <Download size={18} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>

        {/* Photos — always render the section; show a clean empty state when
            there are no (valid) evidence photos instead of a dead dark tile. */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Camera size={20} color="#7C3AED" />
            <Text style={styles.cardTitle}>Evidence Photos</Text>
          </View>
          {photos.length > 0 ? (
            <View style={styles.photoGrid}>
              {photos.map((path) => (
                <Image
                  key={path}
                  source={{ uri: photoUrlMap[path]! }}
                  style={styles.photo}
                  onError={() => setBrokenPhotos((prev) => ({ ...prev, [path]: true }))}
                />
              ))}
            </View>
          ) : (
            <View style={styles.photoEmpty}>
              <View style={styles.photoEmptyIcon}>
                <Camera size={22} color="#7C3AED" />
              </View>
              <Text style={styles.photoEmptyTitle}>No evidence photos attached</Text>
              <Text style={styles.photoEmptySub}>The inspector did not include photo evidence with this report.</Text>
            </View>
          )}
        </View>

       {/* EXTERNAL CHAT BUTTON */}
       <TouchableOpacity 
         style={{ backgroundColor: 'rgba(124,58,237,0.10)', padding: 16, borderRadius: 12, marginTop: 16, borderWidth: 1, borderColor: '#7C3AED', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
         onPress={() => router.push(`/chat/${id}?chatType=admin_support`)}
       >
         <View style={{ flexDirection: 'row', alignItems: 'center' }}>
           <FileText size={24} color="#7C3AED" style={{ marginRight: 12 }} />
           <View>
             <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: 'bold' }}>Chat with Admin</Text>
             <Text style={{ color: '#9CA3AF', fontSize: 12 }}>External support conversation</Text>
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
          <Text style={styles.revisionText} numberOfLines={1}>Request Changes</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.approveBtn} onPress={() => setShowConfirmModal(true)}>
          <CheckCircle2 size={20} color="#FFF" />
          <Text style={styles.approveText} numberOfLines={1}>Approve & Pay</Text>
        </TouchableOpacity>
      </View>
      )}

      {/* Confirmation Modal */}
      <Modal visible={showConfirmModal} transparent animationType="fade" onRequestClose={() => setShowConfirmModal(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}><DollarSign size={32} color="#FFF" /></View>
            <Text style={styles.modalTitle}>Approve report & authorize settlement?</Text>
            <Text style={styles.modalSub}>By confirming, you approve the inspection report and authorize NEXPEC to begin the final settlement and payout process with the inspector.</Text>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowConfirmModal(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleApprove} disabled={approving}>
                {approving ? <ActivityIndicator color="#FFF"/> : <Text style={styles.confirmText}>Approve & authorize</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Success Modal — branches on whether the last action was approve
          or revision-request. Existing modal recipe (modalBg/modalCard/
          modalTitle/modalSub/successBtn) is reused verbatim — only the
          copy + icon differ. */}
      <Modal visible={showSuccessModal} transparent animationType="slide" onRequestClose={() => router.replace('/(tabs)/client-dashboard')}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            {successKind === 'approved' ? (
              <>
                <PartyPopper size={48} color="#22C55E" />
                <Text style={styles.modalTitle}>Report Approved!</Text>
                <Text style={styles.modalSub}>Your approval is recorded. NEXPEC will begin the final settlement and payout process with the inspector.</Text>
              </>
            ) : (
              <>
                <RefreshCw size={48} color="#F59E0B" />
                <Text style={styles.modalTitle}>Revision Requested</Text>
                <Text style={styles.modalSub}>The inspector has been notified and can resubmit. You'll see the updated report here when they do.</Text>
              </>
            )}
            <TouchableOpacity style={styles.successBtn} onPress={() => router.replace('/(tabs)/client-dashboard')}>
              <Text style={styles.successText}>Back to Dashboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Revision Modal — reuses the same modal recipe so it visually
          matches the Approve & Pay confirmation modal. The only new
          control is a multi-line text input for the revision notes. */}
      <Modal visible={showRevisionModal} transparent animationType="fade" onRequestClose={() => { setShowRevisionModal(false); setRevisionNotes(''); }}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <View style={[styles.modalIcon, { backgroundColor: '#F59E0B' }]}>
              <RefreshCw size={32} color="#FFF" />
            </View>
            <Text style={styles.modalTitle}>Request Changes</Text>
            <Text style={styles.modalSub}>Describe what needs to change. The inspector will receive your note and can resubmit.</Text>
            <View style={{ width: '100%', marginBottom: 16 }}>
              <View style={{ borderWidth: 1, borderColor: '#1A1D3C', borderRadius: 12, backgroundColor: '#06081E', paddingHorizontal: 12, paddingVertical: 10, minHeight: 96 }}>
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
      style={{ flex: 1, padding: 0, margin: 0, color: '#FFFFFF', fontSize: 14, lineHeight: 20, textAlignVertical: 'top', minHeight: 76 }}
    />
  );
}

// STYLES
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#020420' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 60, backgroundColor: '#020420', borderBottomWidth: 1, borderBottomColor: '#1A1D3C' },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', marginLeft: 10 },
  scrollContent: { padding: 16, paddingBottom: 120 },

  statusBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)', padding: 12, borderRadius: 12, marginBottom: 16 },
  statusText: { color: '#F59E0B', fontWeight: '600', fontSize: 13, flex: 1 },
  jobTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', marginBottom: 20 },

  card: { backgroundColor: '#0A0D2C', borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1A1D3C' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },

  // Payment Card (price-blind, on-brand)
  paymentCard: { borderRadius: 16, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(124,58,237,0.45)' },
  paymentGradient: { backgroundColor: '#0A0D2C', padding: 20 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  payLabel: { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600' },
  secureBadge: { backgroundColor: '#7C3AED', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  secureText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  totalAmount: { color: '#FFFFFF', fontSize: 32, fontWeight: '800', marginVertical: 8 },
  totalLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginBottom: 16 },
  divider: { height: 1, backgroundColor: '#1A1D3C', marginBottom: 12 },
  lineLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 13 },
  lineValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },

  // Expense List
  expenseRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1A1D3C' },
  expDesc: { fontWeight: '600', color: '#E5E7EB' },
  expDate: { fontSize: 12, color: '#64748B' },
  expAmount: { fontWeight: '700', color: '#FFFFFF' },
  viewReceipt: { fontSize: 12, color: '#7C3AED', fontWeight: '600', marginTop: 4 },

  summaryText: { color: '#CBD5E1', lineHeight: 22 },

  // Report document (premium structured rendering)
  reportHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  reportIconWrap: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(124,58,237,0.15)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.30)', alignItems: 'center', justifyContent: 'center' },
  reportEyebrow: { color: '#7C3AED', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 3 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusPillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },

  reportBody: { backgroundColor: '#06081E', borderRadius: 14, borderWidth: 1, borderColor: '#1A1D3C', padding: 18 },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
  sectionTick: { width: 3, height: 13, borderRadius: 2, backgroundColor: '#7C3AED' },
  sectionLabel: { color: '#A78BFA', fontSize: 12, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  sectionBody: { color: '#E5E7EB', fontSize: 15, lineHeight: 23 },

  // Credential signature chip
  credChip: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1A1D3C' },
  credSigil: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#312E81', borderWidth: 1, borderColor: 'rgba(124,58,237,0.5)', alignItems: 'center', justifyContent: 'center' },
  credSigilTxt: { color: '#FFFFFF', fontWeight: '800', fontSize: 13, letterSpacing: 0.5 },
  credName: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, letterSpacing: 0.3 },
  credRole: { color: '#9CA3AF', fontSize: 12, marginTop: 1 },
  credVerified: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(34,197,94,0.12)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  credVerifiedTxt: { color: '#22C55E', fontSize: 11, fontWeight: '700' },
  docIconWrap: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(124,58,237,0.12)', alignItems: 'center', justifyContent: 'center' },

  docBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(124,58,237,0.10)', padding: 12, borderRadius: 12, marginTop: 16, borderWidth: 1, borderColor: 'rgba(124,58,237,0.35)' },
  docName: { fontWeight: '700', color: '#FFFFFF' },
  docSub: { fontSize: 12, color: '#9CA3AF' },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 8, backgroundColor: '#1A1D3C' },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 22, paddingHorizontal: 16 },
  photoEmptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(124,58,237,0.12)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.25)', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  photoEmptyTitle: { color: '#E5E7EB', fontSize: 14, fontWeight: '700' },
  photoEmptySub: { color: '#64748B', fontSize: 12, marginTop: 3, textAlign: 'center', lineHeight: 17 },

  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#0A0D2C', padding: 16, paddingBottom: 34, borderTopWidth: 1, borderTopColor: '#1A1D3C', flexDirection: 'row', gap: 12 },
  revisionBtn: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 10, borderRadius: 12, backgroundColor: 'rgba(245,158,11,0.14)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.4)' },
  revisionText: { fontSize: 14, fontWeight: '600', color: '#F59E0B', flexShrink: 1 },
  approveBtn: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 10, borderRadius: 12, backgroundColor: '#7C3AED' },
  approveText: { fontSize: 14, fontWeight: '700', color: '#FFF', flexShrink: 1 },

  // Modals
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: '#0A0D2C', borderRadius: 24, padding: 24, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#1A1D3C' },
  modalIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#7C3AED', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#FFFFFF', marginBottom: 8 },
  modalSub: { textAlign: 'center', color: '#9CA3AF', marginBottom: 24 },
  modalBtns: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancel: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#1A1D3C', alignItems: 'center' },
  cancelText: { fontWeight: '600', color: '#9CA3AF' },
  modalConfirm: { flex: 1, padding: 14, borderRadius: 12, backgroundColor: '#7C3AED', alignItems: 'center' },
  confirmText: { fontWeight: '600', color: '#FFF' },
  successBtn: { width: '100%', padding: 16, backgroundColor: '#7C3AED', borderRadius: 12, alignItems: 'center' },
  successText: { color: '#FFF', fontWeight: '700' }
});
