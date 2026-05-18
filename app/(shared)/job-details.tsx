import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput, Dimensions, RefreshControl, Animated } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Briefcase, MapPin, Calendar, DollarSign, Award, Clock, AlertCircle, Zap, User, Users, FileText, ChevronRight, ThumbsUp, ThumbsDown, X, Star } from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { assignJobContractor } from '../../lib/assignJob';
import { useAuth } from '../../src/contexts/AuthContext';

const C = { bg: '#020420', card: '#0A0D2C', border: '#1E293B', primary: '#7C3AED', primaryMuted: 'rgba(124, 58, 237, 0.12)', primaryBorder: 'rgba(124, 58, 237, 0.28)', text: '#FFFFFF', textSec: '#94A3B8', textMuted: '#64748B', inputBg: '#0A0E2E', success: '#10B981', successBg: 'rgba(16, 185, 129, 0.10)', error: '#EF4444', errorBg: 'rgba(239, 68, 68, 0.08)', warning: '#F59E0B', warningBg: 'rgba(245, 158, 11, 0.10)', blue: '#3B82F6' };

const ApplicantModal = ({ visible, applicant, onClose, onUpdateStatus, updating }: any) => {
  const [privateNote, setPrivateNote] = useState('');
  
  // Reset note when modal opens
  useEffect(() => { setPrivateNote(''); }, [visible]);

  if (!applicant) return null;
  const profile = applicant.inspector;
  const isPending = applicant.status === 'pending';

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
            <Text style={st.profileName}>{profile?.full_name || 'Inspector'}</Text>
          </View>

          {/* PRIVATE NOTE SECTION */}
          {isPending && (
            <View style={st.noteSection}>
              <Text style={st.noteLabel}>Private Note (Visible only to Agency & Admin)</Text>
              <TextInput
                style={st.noteInput}
                placeholder="e.g., Check their welding certificates carefully..."
                placeholderTextColor={C.textMuted}
                value={privateNote}
                onChangeText={setPrivateNote}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            </View>
          )}

        </ScrollView>

        {isPending && (
          <View style={st.modalActions}>
            <TouchableOpacity style={st.rejectBtn} disabled={updating} onPress={() => onUpdateStatus(applicant.id, applicant.inspector_id, 'rejected', privateNote)}>
              {updating ? <ActivityIndicator size="small" color={C.error} /> : <Text style={st.rejectBtnTxt}>Reject</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={st.acceptBtn} disabled={updating} onPress={() => onUpdateStatus(applicant.id, applicant.inspector_id, 'accepted', privateNote)}>
              {updating ? <ActivityIndicator size="small" color={C.text} /> : <><ThumbsUp size={16} color={C.text} /><Text style={st.acceptBtnTxt}>Select This Inspector</Text></>}
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};

export default function JobDetailsScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const [job, setJob] = useState<any>(null);
  const [applicants, setApplicants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('details');
  const [selectedApplicant, setSelectedApplicant] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [updating, setUpdating] = useState(false);

  const fetchData = useCallback(async () => {
    if (!jobId) return;
    try {
      const { data: jobData } = await supabase.from('jobs').select('*').eq('id', jobId).single();
      setJob(jobData);
      
      const { data: appData } = await supabase.from('applications')
        .select(`*, profiles:inspector_id(full_name, city, rating)`)
        .eq('job_id', jobId).order('created_at', { ascending: false });
        
      if (appData) {
        const mapped = appData.map((row: any) => ({ ...row, inspector: row.profiles }));
        setApplicants(mapped);
      }
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, [jobId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleUpdateStatus = async (appId: string, inspectorId: string, newStatus: string, note: string) => {
    setUpdating(true);
    try {
      await supabase.from('applications').update({ status: newStatus }).eq('id', appId);

      // CRITICAL: Atomic open → assigned transition via RPC (Task 3).
      // The RPC takes a row lock, validates the pre-state, and writes
      // contractor_id + status in one transaction — no race possible.
      if (newStatus === 'accepted' && job) {
        const result = await assignJobContractor(job.id, inspectorId);
        if (!result.ok) {
          Alert.alert('Could not assign', result.message);
          return;
        }
        // private_note is informational only — the atomic part is done.
        if (note) {
          await supabase.from('jobs').update({ private_note: note }).eq('id', job.id);
        }
      }

      await fetchData();
      setShowModal(false);
      Alert.alert('Success', newStatus === 'accepted' ? 'Inspector Assigned Successfully!' : 'Applicant Rejected.');
    } catch (err: any) {
      Alert.alert('Error', err.message);
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <SafeAreaView style={st.root}><ActivityIndicator size="large" color={C.primary} /></SafeAreaView>;
  if (!job) return <SafeAreaView style={st.root}><Text style={{color: '#fff'}}>Job not found</Text></SafeAreaView>;

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
          <TouchableOpacity onPress={() => setActiveTab('details')}><Text style={[st.tabTxt, activeTab === 'details' && st.tabTxtOn]}>Details</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setActiveTab('applicants')}><Text style={[st.tabTxt, activeTab === 'applicants' && st.tabTxtOn]}>Applicants ({applicants.length})</Text></TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1, padding: 20 }}>
          {activeTab === 'details' ? (
            <View>
              <Text style={st.sectionTitle}>Description</Text>
              <Text style={st.descTxt}>{job.description}</Text>
            </View>
          ) : (
            applicants.map(a => (
              <TouchableOpacity key={a.id} style={st.applicantCard} onPress={() => { setSelectedApplicant(a); setShowModal(true); }}>
                <User size={20} color={C.primary} />
                <Text style={st.applicantName}>{a.inspector?.full_name || 'Inspector'}</Text>
                <Text style={{color: C.textMuted, marginLeft: 'auto'}}>{a.status}</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>

      <ApplicantModal visible={showModal} applicant={selectedApplicant} onClose={() => setShowModal(false)} onUpdateStatus={handleUpdateStatus} updating={updating} />
    </>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: C.border },
  backBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: C.text, textAlign: 'center' },
  tabBar: { flexDirection: 'row', justifyContent: 'space-around', padding: 16, backgroundColor: C.card, borderBottomWidth: 1, borderColor: C.border },
  tabTxt: { fontSize: 15, color: C.textMuted, fontWeight: '600' },
  tabTxtOn: { color: C.primary },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginBottom: 10 },
  descTxt: { fontSize: 14, color: C.textSec, lineHeight: 22 },
  applicantCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, padding: 16, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: C.border },
  applicantName: { fontSize: 16, color: C.text, fontWeight: '600' },
  modalRoot: { flex: 1, backgroundColor: C.bg },
  modalHdr: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderColor: C.border },
  modalTitle: { fontSize: 18, color: C.text, fontWeight: '700' },
  profileCard: { backgroundColor: C.card, padding: 20, borderRadius: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: C.border },
  avatarCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.primaryMuted, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  profileName: { fontSize: 18, color: C.text, fontWeight: '700' },
  noteSection: { marginBottom: 20 },
  noteLabel: { fontSize: 13, color: C.textSec, marginBottom: 8, fontWeight: '600' },
  noteInput: { backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 16, color: C.text, minHeight: 100, fontSize: 15 },
  modalActions: { flexDirection: 'row', gap: 10, padding: 20, borderTopWidth: 1, borderColor: C.border },
  rejectBtn: { flex: 1, padding: 16, borderRadius: 12, backgroundColor: C.errorBg, borderWidth: 1, borderColor: C.error, alignItems: 'center' },
  rejectBtnTxt: { color: C.error, fontWeight: '700', fontSize: 16 },
  acceptBtn: { flex: 2, flexDirection: 'row', gap: 8, padding: 16, borderRadius: 12, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  acceptBtnTxt: { color: C.text, fontWeight: '700', fontSize: 16 }
});