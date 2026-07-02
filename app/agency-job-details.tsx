import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, Dimensions, RefreshControl, Animated, Platform } from 'react-native';
import { router, Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Briefcase, MapPin, Calendar, DollarSign, Award, Clock, AlertCircle, Zap, User, Users, FileText, ChevronRight, ThumbsUp, ThumbsDown, X, Star, CheckCircle, XCircle } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { nxHandle } from '@/src/core/utils/handle';
import { BUYER_JOB_FIELDS } from '@/lib/jobsProjection';
import { useAuth } from '@/src/contexts/AuthContext';

const C = { bg: '#020420', card: '#0A0D2C', border: '#1E293B', primary: '#7C3AED', primaryMuted: 'rgba(124, 58, 237, 0.12)', primaryBorder: 'rgba(124, 58, 237, 0.28)', text: '#FFFFFF', textSec: '#94A3B8', textMuted: '#64748B', inputBg: '#0A0E2E', success: '#10B981', successBg: 'rgba(16, 185, 129, 0.10)', error: '#EF4444', errorBg: 'rgba(239, 68, 68, 0.08)', warning: '#F59E0B', warningBg: 'rgba(245, 158, 11, 0.10)', blue: '#3B82F6' };

const ApplicantModal = ({ visible, applicant, jobPrice, onClose, onUpdateStatus, updating }: any) => {
  const [inspectorMessage, setInspectorMessage] = useState('');
  const [certs, setCerts] = useState<any[]>([]);
  const [loadingCerts, setLoadingCerts] = useState(false);
  
  useEffect(() => { 
    setInspectorMessage(''); 
    if (visible && applicant) {
      fetchCerts();
    }
  }, [visible, applicant]);

  const fetchCerts = async () => {
    setLoadingCerts(true);
    try {
      const { data } = await supabase
        .from('certifications')
        .select('id, name, status, issuing_organization')
        .eq('user_id', applicant.applicant_id)
        .eq('status', 'verified');
      setCerts(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingCerts(false);
    }
  };

  if (!applicant) return null;
  const profile = applicant.inspector;
  // Account for different statuses that count as "open for review"
  const isPending = ['pending', 'submitted', 'under_review'].includes(applicant.status);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={st.modalRoot} edges={['top']}>
        <View style={st.modalHdr}>
          <TouchableOpacity onPress={onClose}><X size={24} color={C.text} strokeWidth={2} /></TouchableOpacity>
          <Text style={st.modalTitle}>Review Applicant</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <View style={st.profileCard}>
            <View style={st.avatarCircle}><User size={28} color={C.primary} strokeWidth={1.8} /></View>
            <Text style={st.profileName}>{profile?.id ? nxHandle(profile.id) : 'Inspector'}</Text>
            
            {/* Broker Logic: Show Client Price, not Inspector's Payout */}
            <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 10, backgroundColor: C.successBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20}}>
              <DollarSign size={14} color={C.success} />
              <Text style={{color: C.success, fontWeight: '700', marginLeft: 4}}>Job Price: ${jobPrice?.toLocaleString() || '0'}</Text>
            </View>
          </View>

          {/* Cover Note Section */}
          {(applicant.cover_letter || applicant.cover_note) && (
            <View style={st.noteSection}>
              <Text style={st.noteLabel}>Cover Letter</Text>
              <View style={{backgroundColor: C.inputBg, padding: 15, borderRadius: 12, borderWidth: 1, borderColor: C.border}}>
                <Text style={{color: C.textSec, lineHeight: 22, fontStyle: 'italic'}}>
                  "{applicant.cover_letter || applicant.cover_note}"
                </Text>
              </View>
            </View>
          )}

          {/* 🔴 NEW: Certifications Section */}
          <View style={st.noteSection}>
            <Text style={st.noteLabel}>Verified Certifications ({certs.length})</Text>
            {loadingCerts ? (
              <ActivityIndicator size="small" color={C.primary} style={{ alignSelf: 'flex-start', marginTop: 10 }} />
            ) : certs.length > 0 ? (
              <View style={st.certsContainer}>
                {certs.map(c => (
                  <View key={c.id} style={st.certItem}>
                    <Award size={18} color={C.warning} />
                    <View style={{flex: 1, marginLeft: 12}}>
                      <Text style={{color: C.text, fontWeight: '600'}}>{c.name}</Text>
                      <Text style={{color: C.textMuted, fontSize: 12, marginTop: 2}}>{c.issuing_organization}</Text>
                    </View>
                    <CheckCircle size={18} color={C.success} />
                  </View>
                ))}
              </View>
            ) : (
              <Text style={{color: C.textMuted, fontStyle: 'italic', marginTop: 5}}>No verified certifications found for this inspector.</Text>
            )}
          </View>

          {/* 🔴 NEW: CV / Resume Section */}
          <View style={st.noteSection}>
            <Text style={st.noteLabel}>Resume & Docs</Text>
            <TouchableOpacity style={st.cvButton} onPress={() => Alert.alert('CV / Resume', 'Opening inspector documents...')}>
              <FileText size={20} color={C.primary} />
              <Text style={st.cvButtonText}>View Inspector CV</Text>
              <ChevronRight size={20} color={C.textMuted} style={{marginLeft: 'auto'}} />
            </TouchableOpacity>
          </View>

          {/* 🔴 UPDATED: Message to Inspector */}
          {isPending && (
            <View style={st.noteSection}>
              <Text style={st.noteLabel}>Message to Inspector (Optional)</Text>
              <TextInput
                style={st.noteInput}
                placeholder="e.g., Please upload your API-653 certificate before we proceed, or confirm your availability for tomorrow..."
                placeholderTextColor={C.textMuted}
                value={inspectorMessage}
                onChangeText={setInspectorMessage}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          )}

        </ScrollView>

        {isPending && (
          <View style={st.modalActions}>
            <TouchableOpacity style={st.rejectBtn} disabled={updating} onPress={() => onUpdateStatus(applicant.id, applicant.applicant_id, 'rejected', inspectorMessage)}>
              {updating ? <ActivityIndicator size="small" color={C.error} /> : <Text style={st.rejectBtnTxt}>Reject</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={st.acceptBtn} disabled={updating} onPress={() => onUpdateStatus(applicant.id, applicant.applicant_id, 'accepted', inspectorMessage)}>
              {updating ? <ActivityIndicator size="small" color={C.text} /> : <><ThumbsUp size={16} color={C.text} /><Text style={st.acceptBtnTxt}>Nominate</Text></>}
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};

export default function JobDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [job, setJob] = useState<any>(null);
  const [applicants, setApplicants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('details');
  const [selectedApplicant, setSelectedApplicant] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!id) return;
    if (!isRefresh) setLoading(true);
    setLoadError(null);

    try {
      // GR2: agency is a buyer-tier role — no payout columns over the wire.
      const { data: jobData } = await supabase.from('jobs').select(BUYER_JOB_FIELDS).eq('id', id).single();
      setJob(jobData);
      
      // ★ HIRE-008: canonical applications table. Legacy view still
      //   resolves via aliasing, but new code uses the underlying table.
      const { data: appData, error: appErr } = await supabase
        .from('applications')
        .select('*')
        .eq('job_id', id)
        .order('created_at', { ascending: false });

      if (appErr) {
        // Surface the failure instead of silently showing "No Applicants Yet"
        // (the old branch re-ran the identical query and swallowed the error).
        console.error('Applications fetch error:', appErr);
        setLoadError(appErr.message || 'Failed to load applicants.');
        setApplicants([]);
      } else if (appData && appData.length > 0) {
        const applicantIds = appData.map((a: any) => a.inspector_id || a.applicant_id).filter(Boolean);
        const uniqueIds = [...new Set(applicantIds)];
        
        let profiles: any[] = [];
        
        if (uniqueIds.length > 0) {
          // ★ ANTI-POACHING: pseudonymous projection only (was select('*'),
          //   which leaked applicants' full_name/email/avatar/rates). Identity
          //   stays sealed (NX- handle) until a paid Named-Disclosure.
          const { data: profData } = await supabase.from('profiles').select('id, title, bio, specialties, location_city, location_province').in('id', uniqueIds);
          profiles = profData || [];
        }

        const mapped = appData.map((app: any) => {
          const targetId = app.inspector_id || app.applicant_id;
          const inspectorProfile = profiles.find(p => p.id === targetId);
          return {
            ...app,
            applicant_id: targetId,
            // Fallback keeps the pseudonymous contract: the card renders
            // nxHandle(inspector.id) — full_name is never selected (or shown).
            inspector: inspectorProfile || (targetId ? { id: targetId } : null)
          };
        });
        
        setApplicants(mapped);
      } else {
        setApplicants([]);
      }
    } catch (err: any) {
      console.error("Catch Error:", err);
      setLoadError(err?.message || 'Failed to load job details.');
    } finally {
      setLoading(false); 
      setRefreshing(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [fetchData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    fetchData(true);
  };

  const handleUpdateStatus = async (appId: string, inspectorId: string, newStatus: string, message: string) => {
    setUpdating(true);
    try {
      // ★ BROKER MODEL: accept → CLIENT_SELECTED (queues admin dispatch); reject unchanged.
      const targetStatus = newStatus === 'accepted' ? 'CLIENT_SELECTED' : newStatus;
      const { error: statusErr } = await supabase.from('applications').update({ status: targetStatus }).eq('id', appId);
      if (statusErr) throw statusErr;

      if (newStatus === 'accepted' && job && message) {
        // Buyer surface stays confined to applications.status. Only the NEXPEC admin
        // finalises pricing + dispatch (jobs.contractor_id/status) and generates the
        // contract (admin_generate_job_contract → job_contracts). private_note only.
        const { error: noteErr } = await supabase.from('jobs').update({ private_note: message }).eq('id', job.id);
        if (noteErr) throw noteErr;
      }
      
      await fetchData();
      setShowModal(false);
      Alert.alert('Success', newStatus === 'accepted'
        ? 'Inspector nominated — sent to NEXPEC admin to finalise pricing & dispatch.'
        : 'Applicant Rejected.');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <SafeAreaView style={st.root}><ActivityIndicator size="large" color={C.primary} /></SafeAreaView>;
  if (!job) return <SafeAreaView style={st.root}><Text style={{color: '#fff', textAlign: 'center', marginTop: 50}}>Job not found</Text></SafeAreaView>;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={st.root} edges={['top']}>
        <View style={st.header}>
          <TouchableOpacity style={st.backBtn} onPress={() => router.back()}><ArrowLeft size={22} color={C.text} /></TouchableOpacity>
          <Text style={st.headerTitle}>{job.title}</Text>
          <View style={{ width: 42 }} />
        </View>

        <View style={st.tabBar}>
          <TouchableOpacity style={st.tabBtn} onPress={() => setActiveTab('details')}>
            <Text style={[st.tabTxt, activeTab === 'details' && st.tabTxtOn]}>Details</Text>
            {activeTab === 'details' && <View style={st.tabIndicator} />}
          </TouchableOpacity>
          <TouchableOpacity style={st.tabBtn} onPress={() => setActiveTab('applicants')}>
            <Text style={[st.tabTxt, activeTab === 'applicants' && st.tabTxtOn]}>Applicants ({applicants.length})</Text>
            {activeTab === 'applicants' && <View style={st.tabIndicator} />}
          </TouchableOpacity>
        </View>

        <ScrollView 
          style={{ flex: 1 }} 
          contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
        >
          {activeTab === 'details' ? (
            <View>
              <Text style={st.sectionTitle}>Description</Text>
              <View style={st.descCard}>
                <Text style={st.descTxt}>{job.description || 'No description provided.'}</Text>
              </View>

              <Text style={[st.sectionTitle, {marginTop: 20}]}>Job Details</Text>
              <View style={st.detailsGrid}>
                 <View style={st.detailItem}>
                    <MapPin size={18} color={C.textSec} />
                    <Text style={st.detailVal}>{job.location || 'N/A'}</Text>
                 </View>
                 <View style={st.detailItem}>
                    <DollarSign size={18} color={C.success} />
                    {/* ★ Task 4: integer cents → dollars for display */}
                    <Text style={[st.detailVal, {color: C.success}]}>${((((job as any).client_price_cents || (job as any).budget_cents || 0)) / 100).toLocaleString()}</Text>
                 </View>
              </View>
            </View>
          ) : (
            loadError ? (
              <View style={st.emptyState}>
                <AlertCircle size={48} color={C.error} />
                <Text style={st.emptyTitle}>Couldn't Load Applicants</Text>
                <Text style={st.emptySub}>{loadError}</Text>
                <TouchableOpacity
                  style={{ marginTop: 16, backgroundColor: C.primary, paddingVertical: 10, paddingHorizontal: 28, borderRadius: 10 }}
                  onPress={() => fetchData()}
                >
                  <Text style={{ color: C.text, fontWeight: '700' }}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : applicants.length === 0 ? (
              <View style={st.emptyState}>
                <Users size={48} color={C.textMuted} />
                <Text style={st.emptyTitle}>No Applicants Yet</Text>
                <Text style={st.emptySub}>When inspectors apply for this job, they will appear here.</Text>
              </View>
            ) : (
              applicants.map(a => {
                const isPending = ['pending', 'submitted', 'under_review'].includes(a.status);
                const isHired = ['hired', 'accepted'].includes(a.status);
                const isRejected = a.status === 'rejected';

                return (
                  <TouchableOpacity key={a.id} style={[st.applicantCard, isHired && {borderColor: C.success}, isRejected && {opacity: 0.6}]} onPress={() => { setSelectedApplicant(a); setShowModal(true); }}>
                    <View style={st.appCardLeft}>
                      <View style={[st.avatarSmall, isHired && {backgroundColor: C.successBg}]}>
                        {isHired ? <CheckCircle size={20} color={C.success} /> : <User size={20} color={C.primary} />}
                      </View>
                      <View>
                        <Text style={st.applicantName}>{a.inspector?.id ? nxHandle(a.inspector.id) : 'Inspector'}</Text>
                        {(a.inspector?.location_city || a.inspector?.location_province) ? (
                          <Text style={st.appDate}>{[a.inspector?.location_city, a.inspector?.location_province].filter(Boolean).join(', ')}</Text>
                        ) : null}
                        <Text style={st.appDate}>{new Date(a.created_at).toLocaleDateString()}</Text>
                      </View>
                    </View>
                    <View style={[st.statusChip, 
                      isHired ? {backgroundColor: C.successBg} : 
                      isRejected ? {backgroundColor: C.errorBg} : 
                      {backgroundColor: C.warningBg}
                    ]}>
                      <Text style={[st.statusChipTxt, 
                        isHired ? {color: C.success} : 
                        isRejected ? {color: C.error} : 
                        {color: C.warning}
                      ]}>
                        {isHired ? 'HIRED' : isRejected ? 'REJECTED' : 'REVIEW'}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )
          )}
        </ScrollView>
      </SafeAreaView>

      <ApplicantModal 
        visible={showModal} 
        applicant={selectedApplicant} 
        jobPrice={(job as any)?.client_price_cents || (job as any)?.budget_cents}
        onClose={() => setShowModal(false)} 
        onUpdateStatus={handleUpdateStatus} 
        updating={updating} 
      />
    </>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: C.border, backgroundColor: C.card },
  backBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: C.text, textAlign: 'center' },
  tabBar: { flexDirection: 'row', backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 16, position: 'relative' },
  tabTxt: { fontSize: 15, color: C.textMuted, fontWeight: '600' },
  tabTxtOn: { color: C.primary },
  tabIndicator: { position: 'absolute', bottom: -1, left: 20, right: 20, height: 3, backgroundColor: C.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 12 },
  descCard: { backgroundColor: C.card, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: C.border },
  descTxt: { fontSize: 15, color: C.textSec, lineHeight: 24 },
  detailsGrid: { backgroundColor: C.card, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: C.border, gap: 12 },
  detailItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailVal: { fontSize: 15, color: C.text, fontWeight: '500' },
  
  emptyState: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 20 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginTop: 16, marginBottom: 8 },
  emptySub: { fontSize: 14, color: C.textSec, textAlign: 'center', lineHeight: 20 },
  
  applicantCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, padding: 16, borderRadius: 16, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  appCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarSmall: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primaryMuted, justifyContent: 'center', alignItems: 'center' },
  applicantName: { fontSize: 16, color: C.text, fontWeight: '600', marginBottom: 4 },
  appDate: { fontSize: 12, color: C.textMuted },
  statusChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  statusChipTxt: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  
  modalRoot: { flex: 1, backgroundColor: C.bg },
  modalHdr: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: C.border },
  modalTitle: { fontSize: 18, color: C.text, fontWeight: '700' },
  profileCard: { backgroundColor: C.card, padding: 20, borderRadius: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: C.border },
  avatarCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.primaryMuted, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  profileName: { fontSize: 20, color: C.text, fontWeight: '700' },
  
  noteSection: { marginBottom: 20 },
  noteLabel: { fontSize: 13, color: C.textSec, marginBottom: 8, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  noteInput: { backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 16, color: C.text, minHeight: 120, fontSize: 15 },
  
  certsContainer: { backgroundColor: C.inputBg, borderRadius: 12, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  certItem: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  
  cvButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  cvButtonText: { color: C.text, fontWeight: '600', marginLeft: 12, fontSize: 15 },
  
  modalActions: { flexDirection: 'row', gap: 12, padding: 20, borderTopWidth: 1, borderColor: C.border, paddingBottom: Platform.OS === 'ios' ? 40 : 20 },
  rejectBtn: { flex: 1, padding: 16, borderRadius: 14, backgroundColor: C.errorBg, borderWidth: 1, borderColor: C.error, alignItems: 'center' },
  rejectBtnTxt: { color: C.error, fontWeight: '700', fontSize: 16 },
  acceptBtn: { flex: 2, flexDirection: 'row', gap: 8, padding: 16, borderRadius: 14, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', shadowColor: C.primary, shadowOffset: {width: 0, height: 4}, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  acceptBtnTxt: { color: C.text, fontWeight: '700', fontSize: 16 }
});