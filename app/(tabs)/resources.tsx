import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, StatusBar, Platform, RefreshControl, TouchableOpacity, Animated, Dimensions, ActivityIndicator, Alert, Modal, Pressable, ScrollView, LayoutAnimation, UIManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import ReferenceHub from '../../src/components/inspector/knowledge/ReferenceHub';
import MicroLearning from '../../src/components/inspector/academy/MicroLearning';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../src/contexts/AuthContext';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) { UIManager.setLayoutAnimationEnabledExperimental(true); }
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = { background: '#020420', backgroundAlt: '#0a0f2e', surface: '#0F172A', surfaceLight: '#1E293B', surfaceElevated: '#162036', border: '#1F2937', borderLight: '#334155', primary: '#7C3AED', primaryLight: '#8B5CF6', primaryDark: '#6D28D9', primaryBg: 'rgba(124, 58, 237, 0.12)', primaryBorder: 'rgba(124, 58, 237, 0.25)', blue: '#3B82F6', blueBg: 'rgba(59, 130, 246, 0.12)', blueBorder: 'rgba(59, 130, 246, 0.25)', green: '#10B981', greenBg: 'rgba(16, 185, 129, 0.12)', greenBorder: 'rgba(16, 185, 129, 0.25)', red: '#EF4444', redBg: 'rgba(239, 68, 68, 0.12)', amber: '#F59E0B', amberBg: 'rgba(245, 158, 11, 0.12)', amberBorder: 'rgba(245, 158, 11, 0.25)', cyan: '#06B6D4', cyanBg: 'rgba(6, 182, 212, 0.12)', gold: '#FDCB6E', goldBg: 'rgba(253, 203, 110, 0.10)', goldBorder: 'rgba(253, 203, 110, 0.15)', white: '#FFFFFF', textPrimary: '#F1F5F9', textSecondary: '#94A3B8', textMuted: '#64748B', textDark: '#475569', offlineGreen: '#00B894', };

type UserRole = 'inspector' | 'client' | 'agency'; type ActiveTab = 'docs' | 'library';
interface ProjectDocument { id: string; job_id: string; file_name: string; file_type: string; file_size: number; file_url: string; category: 'itp' | 'drawing' | 'spec' | 'report' | 'certificate' | 'other'; uploaded_by: string; uploaded_by_name?: string; created_at: string; notes?: string; }
interface JobWithDocs { id: string; title: string; status: string; documents: ProjectDocument[]; }

const DOC_CATEGORIES: { key: ProjectDocument['category']; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; }[] = [ { key: 'itp', label: 'ITP', icon: 'clipboard-outline', color: COLORS.primary, bg: COLORS.primaryBg }, { key: 'drawing', label: 'Drawing', icon: 'map-outline', color: COLORS.blue, bg: COLORS.blueBg }, { key: 'spec', label: 'Spec', icon: 'document-text-outline', color: COLORS.amber, bg: COLORS.amberBg }, { key: 'report', label: 'Report', icon: 'analytics-outline', color: COLORS.green, bg: COLORS.greenBg }, { key: 'certificate', label: 'Certificate', icon: 'ribbon-outline', color: COLORS.cyan, bg: COLORS.cyanBg }, { key: 'other', label: 'Other', icon: 'attach-outline', color: COLORS.textSecondary, bg: 'rgba(148,163,184,0.12)' }, ];
const FILE_TYPE_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = { pdf: { icon: 'document-text', color: '#EF4444' }, doc: { icon: 'document', color: '#3B82F6' }, docx: { icon: 'document', color: '#3B82F6' }, xls: { icon: 'grid', color: '#10B981' }, xlsx: { icon: 'grid', color: '#10B981' }, jpg: { icon: 'image', color: '#F59E0B' }, jpeg: { icon: 'image', color: '#F59E0B' }, png: { icon: 'image', color: '#8B5CF6' }, dwg: { icon: 'construct', color: '#06B6D4' }, default: { icon: 'document-outline', color: COLORS.textMuted }, };

const formatFileSize = (bytes: number): string => { if (bytes === 0) return '0 B'; const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`; };
const formatDate = (dateStr: string): string => { const d = new Date(dateStr); const diffMins = Math.floor((new Date().getTime() - d.getTime()) / 60000); if (diffMins < 1) return 'Just now'; if (diffMins < 60) return `${diffMins}m ago`; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const getFileTypeConfig = (fileName: string) => { const ext = fileName.split('.').pop()?.toLowerCase() || ''; return FILE_TYPE_ICONS[ext] || FILE_TYPE_ICONS.default; };
const getJobStatusConfig = (status: string) => { switch (status) { case 'assigned': case 'in_progress': return { label: 'Active', color: COLORS.blue, bg: COLORS.blueBg, icon: 'play-circle' as const }; case 'pending': return { label: 'Pending', color: COLORS.amber, bg: COLORS.amberBg, icon: 'time' as const }; case 'completed': return { label: 'Completed', color: COLORS.green, bg: COLORS.greenBg, icon: 'checkmark-circle' as const }; case 'open': return { label: 'Open', color: COLORS.cyan, bg: COLORS.cyanBg, icon: 'radio-button-on' as const }; default: return { label: status, color: COLORS.textMuted, bg: 'rgba(100,116,139,0.12)', icon: 'ellipse' as const }; } };

const SegmentedControl: React.FC<{ active: ActiveTab; onChange: (tab: ActiveTab) => void; }> = React.memo(({ active, onChange }) => {
  const slideAnim = useRef(new Animated.Value(active === 'docs' ? 0 : 1)).current; const segW = (SCREEN_WIDTH - 40) / 2;
  useEffect(() => { Animated.spring(slideAnim, { toValue: active === 'docs' ? 0 : 1, tension: 68, friction: 12, useNativeDriver: true, }).start(); }, [active]);
  return (
    <View style={s.segWrap}><View style={s.segControl}><Animated.View style={[ s.segIndicator, { width: segW, transform: [{ translateX: slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, segW], }), }], }, ]} />
        <TouchableOpacity style={s.segTab} onPress={() => onChange('docs')} activeOpacity={0.7}><Ionicons name={active === 'docs' ? 'folder-open' : 'folder-open-outline'} size={16} color={active === 'docs' ? '#FFF' : COLORS.textMuted} /><Text style={[s.segLabel, active === 'docs' && s.segLabelActive]}>Project Docs</Text></TouchableOpacity>
        <TouchableOpacity style={s.segTab} onPress={() => onChange('library')} activeOpacity={0.7}><Ionicons name={active === 'library' ? 'library' : 'library-outline'} size={16} color={active === 'library' ? '#FFF' : COLORS.textMuted} /><Text style={[s.segLabel, active === 'library' && s.segLabelActive]}>Library</Text></TouchableOpacity>
      </View></View>
  );
});

const CollapsibleProject: React.FC<{ job: JobWithDocs; userRole: UserRole; isExpanded: boolean; onToggle: () => void; onViewDoc: (doc: ProjectDocument) => void; onUploadDoc?: (jobId: string) => void; }> = React.memo(({ job, userRole, isExpanded, onToggle, onViewDoc, onUploadDoc }) => {
  const rotateAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current; const statusCfg = getJobStatusConfig(job.status); const isArchived = job.status === 'completed';
  useEffect(() => { Animated.spring(rotateAnim, { toValue: isExpanded ? 1 : 0, tension: 60, friction: 10, useNativeDriver: true, }).start(); }, [isExpanded]);
  const rotation = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'], });
  return (
    <View style={[s.projectCard, isArchived && s.projectCardArchived]}>
      <TouchableOpacity style={s.projectHeader} onPress={onToggle} activeOpacity={0.7}><View style={s.projectHeaderLeft}><View style={[s.projectStatusDot, { backgroundColor: statusCfg.color }]} /><View style={{ flex: 1 }}><Text style={s.projectTitle} numberOfLines={1}>{job.title || 'Untitled Project'}</Text></View></View><View style={s.projectHeaderRight}><View style={[s.projectDocCount, { backgroundColor: `${statusCfg.color}15` }]}><Ionicons name="document-text-outline" size={12} color={statusCfg.color} /><Text style={[s.projectDocCountText, { color: statusCfg.color }]}>{job.documents.length}</Text></View><Animated.View style={{ transform: [{ rotate: rotation }] }}><Ionicons name="chevron-down" size={18} color={COLORS.textMuted} /></Animated.View></View></TouchableOpacity>
      {isExpanded && (
        <View style={s.projectContent}>
          <View style={s.projectStatusBar}><View style={[s.statusBadge, { backgroundColor: statusCfg.bg }]}><Ionicons name={statusCfg.icon} size={12} color={statusCfg.color} /><Text style={[s.statusBadgeText, { color: statusCfg.color }]}>{statusCfg.label}</Text></View></View>
          {job.documents.length === 0 ? ( <View style={s.noDocsWrap}><Ionicons name="document-outline" size={28} color={COLORS.textDark} /><Text style={s.noDocsText}>No documents uploaded yet</Text>{(userRole === 'client' || userRole === 'agency') && onUploadDoc && ( <TouchableOpacity style={s.noDocsUploadBtn} onPress={() => onUploadDoc(job.id)} activeOpacity={0.8}><Ionicons name="cloud-upload-outline" size={14} color={COLORS.primary} /><Text style={s.noDocsUploadText}>Upload First Document</Text></TouchableOpacity> )}</View> ) : (
            <View style={s.docsList}>
              {job.documents.map((doc, idx) => {
                const fileCfg = getFileTypeConfig(doc.file_name); const catCfg = DOC_CATEGORIES.find(c => c.key === doc.category);
                return ( <TouchableOpacity key={doc.id} style={[s.docItem, idx < job.documents.length - 1 && s.docItemBorder]} onPress={() => onViewDoc(doc)} activeOpacity={0.7}><View style={[s.docFileIcon, { backgroundColor: `${fileCfg.color}15` }]}><Ionicons name={fileCfg.icon} size={20} color={fileCfg.color} /></View><View style={s.docInfo}><Text style={s.docFileName} numberOfLines={1}>{doc.file_name}</Text><View style={s.docMetaRow}>{catCfg && ( <View style={[s.docCatBadge, { backgroundColor: catCfg.bg }]}><Text style={[s.docCatText, { color: catCfg.color }]}>{catCfg.label}</Text></View> )}<Text style={s.docMetaText}>{formatFileSize(doc.file_size)}</Text><Text style={s.docMetaDot}>•</Text><Text style={s.docMetaText}>{formatDate(doc.created_at)}</Text></View>{doc.uploaded_by_name && ( <Text style={s.docUploader}>by {doc.uploaded_by_name}</Text> )}</View><TouchableOpacity style={s.docActionBtn} onPress={() => onViewDoc(doc)} activeOpacity={0.7}><Ionicons name={userRole === 'inspector' ? 'download-outline' : 'eye-outline'} size={18} color={COLORS.primary} /></TouchableOpacity></TouchableOpacity> );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
});

const DocStats: React.FC<{ activeCount: number; archivedCount: number; totalDocs: number; }> = React.memo(({ activeCount, archivedCount, totalDocs }) => (
  <View style={s.docStatsBanner}><LinearGradient colors={['rgba(124,58,237,0.12)', 'rgba(124,58,237,0.04)', 'transparent']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} /><View style={s.docStatItem}><Text style={s.docStatValue}>{activeCount}</Text><Text style={s.docStatLabel}>Active</Text></View><View style={s.docStatDivider} /><View style={s.docStatItem}><Text style={s.docStatValue}>{archivedCount}</Text><Text style={s.docStatLabel}>Archived</Text></View><View style={s.docStatDivider} /><View style={s.docStatItem}><Text style={s.docStatValue}>{totalDocs}</Text><Text style={s.docStatLabel}>Documents</Text></View></View>
));

const UploadModal: React.FC<{ visible: boolean; onClose: () => void; onUpload: (category: ProjectDocument['category']) => void; uploading: boolean; }> = ({ visible, onClose, onUpload, uploading }) => {
  const handleCategorySelect = (category: ProjectDocument['category']) => {
    onUpload(category);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.modalOverlay}>
        <View style={s.modalContent}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Upload Document</Text>
            <TouchableOpacity onPress={onClose} style={s.modalCloseBtn}>
              <Ionicons name="close" size={24} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>
          
          <Text style={s.modalSubtitle}>Select document category</Text>
          
          <View style={s.categoryGrid}>
            {DOC_CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.key}
                style={[s.categoryChip, { backgroundColor: cat.bg }]}
                onPress={() => handleCategorySelect(cat.key)}
                disabled={uploading}
                activeOpacity={0.8}
              >
                <Ionicons name={cat.icon} size={20} color={cat.color} />
                <Text style={[s.categoryLabel, { color: cat.color }]}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          
          {uploading && (
            <View style={s.uploadingIndicator}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={s.uploadingText}>Uploading document...</Text>
            </View>
          )}
          
          <TouchableOpacity style={s.modalCancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={s.modalCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default function ResourcesScreen() {
  const router = useRouter(); const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('docs');
  const [libraryRefreshing, setLibraryRefreshing] = useState(false); const [refreshKey, setRefreshKey] = useState(0);
  const [userRole, setUserRole] = useState<UserRole>('inspector'); const [jobsWithDocs, setJobsWithDocs] = useState<JobWithDocs[]>([]); const [docsLoading, setDocsLoading] = useState(true); const [docsRefreshing, setDocsRefreshing] = useState(false); const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set()); const [activeExpanded, setActiveExpanded] = useState(true); const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const activeProjects = useMemo( () => jobsWithDocs.filter((j) => j.status !== 'completed'), [jobsWithDocs], );
  const archivedProjects = useMemo( () => jobsWithDocs.filter((j) => j.status === 'completed'), [jobsWithDocs], );
  const totalDocs = useMemo( () => jobsWithDocs.reduce((sum, j) => sum + j.documents.length, 0), [jobsWithDocs], );

  const fetchUserRole = useCallback(async () => {
    if (!user?.id) return;
    try { const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single(); if (profile?.role) setUserRole(profile.role as UserRole); } catch (err) {}
  }, [user?.id]);

  const fetchJobsWithDocuments = useCallback(async () => {
    if (!user?.id) return;
    try {
      // SAFE QUERY - Removed references to address, city, state, etc. that do not exist
      let jobQuery = supabase.from('jobs').select('*').order('created_at', { ascending: false });
      if (userRole === 'inspector') { jobQuery = jobQuery.eq('contractor_id', user.id); } else if (userRole === 'client' || userRole === 'agency') { jobQuery = jobQuery.eq('poster_id', user.id); }
      const { data: jobs, error: jobError } = await jobQuery;
      if (jobError) throw jobError; if (!jobs || jobs.length === 0) { setJobsWithDocs([]); return; }
      
      const jobIds = jobs.map((j) => j.id);
      // SAFE QUERY - Removed relational join on profiles to prevent PGRST200
      const { data: docs, error: docError } = await supabase.from('project_documents').select('*').in('job_id', jobIds).order('created_at', { ascending: false });
      if (docError) throw docError;
      
      const docsMap = new Map<string, ProjectDocument[]>();
      (docs || []).forEach((d: any) => { const list = docsMap.get(d.job_id) || []; list.push({ id: d.id, job_id: d.job_id, file_name: d.file_name, file_type: d.file_type || '', file_size: d.file_size || 0, file_url: d.file_url || '', category: d.category || 'other', uploaded_by: d.uploaded_by, uploaded_by_name: 'User', created_at: d.created_at, notes: d.notes, }); docsMap.set(d.job_id, list); });
      const merged: JobWithDocs[] = jobs.map((j) => ({ ...j, documents: docsMap.get(j.id) || [], }));
      setJobsWithDocs(merged);
      const firstActive = merged.find((j) => j.status !== 'completed'); if (firstActive) { setExpandedProjects(new Set([firstActive.id])); }
    } catch (err) { console.error('Error fetching jobs with docs:', err); }
  }, [user?.id, userRole]);

  const loadDocsData = useCallback(async () => { setDocsLoading(true); await fetchUserRole(); await fetchJobsWithDocuments(); setDocsLoading(false); }, [fetchUserRole, fetchJobsWithDocuments]);
  useEffect(() => { if (userRole) { fetchJobsWithDocuments(); } }, [userRole, fetchJobsWithDocuments]);
  useFocusEffect( useCallback(() => { loadDocsData(); }, [loadDocsData]), );

  const toggleProject = useCallback((jobId: string) => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setExpandedProjects((prev) => { const next = new Set(prev); if (next.has(jobId)) { next.delete(jobId); } else { next.add(jobId); } return next; }); }, []);
  const toggleActiveSection = useCallback(() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setActiveExpanded((prev) => !prev); }, []);
  const toggleArchivedSection = useCallback(() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setArchivedExpanded((prev) => !prev); }, []);

  const handleViewDoc = useCallback((doc: ProjectDocument) => {
    if (doc.file_url) { Alert.alert( doc.file_name, `Category: ${doc.category.toUpperCase()}\nSize: ${formatFileSize(doc.file_size)}\n\nOpen this document?`, [ { text: 'Cancel', style: 'cancel' }, { text: userRole === 'inspector' ? 'Download' : 'View', onPress: () => { Alert.alert('Opening', `Opening ${doc.file_name}…`); }, }, ], ); } else { Alert.alert('Unavailable', 'Document URL is not available.'); }
  }, [userRole]);

  const handleUploadDocument = useCallback(
    async (category: ProjectDocument['category']) => {
      if (!uploadJobId || !user?.id) {
        Alert.alert('Error', 'Please select a project first.');
        return;
      }

      try {
        // 1. Open Native File Picker
        const result = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/*', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
          copyToCacheDirectory: true,
        });

        if (result.canceled) return;
        
        const file = result.assets[0];
        setUploading(true);

        // 2. Prepare file for upload
        const fileExt = file.name.split('.').pop()?.toLowerCase() || 'pdf';
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        // Stores files in a specific folder for each project to avoid mixing with existing inspector documents
        const filePath = `project_${uploadJobId}/${Date.now()}_${cleanFileName}`;

        // 3. Read file as Blob (Standard React Native approach for Supabase)
        const response = await fetch(file.uri);
        const blob = await response.blob();

        // 4. Upload to Supabase Storage ('documents' bucket)
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, blob, {
            contentType: file.mimeType || 'application/octet-stream',
            upsert: false,
          });

        if (uploadError) throw uploadError;

        // 5. Get Public URL
        const { data: publicUrlData } = supabase.storage
          .from('documents')
          .getPublicUrl(filePath);

        // 6. Save document record to Database
        const newDoc = {
          job_id: uploadJobId,
          file_name: file.name,
          file_type: fileExt,
          file_size: file.size || 0,
          file_url: publicUrlData.publicUrl,
          category,
          uploaded_by: user.id,
          notes: null,
        };

        const { error: dbError } = await supabase
          .from('project_documents')
          .insert(newDoc);

        if (dbError) {
          // Rollback: delete file from storage if DB insert fails
          await supabase.storage.from('documents').remove([filePath]);
          throw dbError;
        }

        Alert.alert('Success', 'Document uploaded successfully!');
        setShowUploadModal(false);
        setUploadJobId(null);
        // Force refresh the list after a successful upload
        await fetchJobsWithDocuments();
      } catch (err: any) {
        console.error('Upload error:', err);
        Alert.alert('Upload Failed', err.message || 'An error occurred during upload.');
      } finally {
        setUploading(false);
      }
    },
    [uploadJobId, user?.id, fetchJobsWithDocuments],
  );

  const handleUploadPress = useCallback((jobId: string) => {
    setUploadJobId(jobId);
    setShowUploadModal(true);
  }, []);

  const onLibraryRefresh = useCallback(() => { setLibraryRefreshing(true); setRefreshKey((prev) => prev + 1); setTimeout(() => setLibraryRefreshing(false), 1000); }, []);
  const onDocsRefresh = useCallback(async () => { setDocsRefreshing(true); await fetchJobsWithDocuments(); setDocsRefreshing(false); }, [fetchJobsWithDocuments]);

  const LibraryContent = useMemo( () => ( <><View style={s.libScreenHeader}><View style={s.libHeaderLeft}><View style={s.libHeaderIconContainer}><Ionicons name="bulb-outline" size={20} color={COLORS.gold} /></View><View><Text style={s.libHeaderTitle}>Knowledge Engine</Text><Text style={s.libHeaderSubtitle}>Reference • Learning • Growth</Text></View></View><View style={s.offlineBadge}><View style={s.offlineDot} /><Text style={s.offlineText}>Offline Ready</Text></View></View><MicroLearning key={`ml-${refreshKey}`} /><View style={s.libDivider}><View style={s.libDividerLine} /><View style={s.libDividerIcon}><Ionicons name="library-outline" size={14} color="rgba(255,255,255,0.15)" /></View><View style={s.libDividerLine} /></View><ReferenceHub key={`rh-${refreshKey}`} /></> ), [refreshKey], );
  const DocsListHeader = useMemo( () => ( <View><View style={s.docsHeader}><View style={s.docsHeaderLeft}><View style={s.docsHeaderIcon}><Ionicons name="folder-open" size={20} color={COLORS.primary} /></View><View><Text style={s.docsHeaderTitle}>Project Documents</Text><Text style={s.docsHeaderSub}>{userRole === 'inspector' ? 'Documents for your assigned inspections' : 'Manage documents across your projects'}</Text></View></View></View><DocStats activeCount={activeProjects.length} archivedCount={archivedProjects.length} totalDocs={totalDocs} /></View> ), [userRole, activeProjects.length, archivedProjects.length, totalDocs], );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <LinearGradient colors={[COLORS.background, COLORS.backgroundAlt, COLORS.background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView style={s.safeArea} edges={['top']}>
        <View style={s.screenTopHeader}><Text style={s.screenTopTitle}>Resources</Text><TouchableOpacity style={s.screenTopBtn} onPress={() => router.push('/notifications')} activeOpacity={0.7}><Ionicons name="notifications-outline" size={22} color={COLORS.textSecondary} /></TouchableOpacity></View>
        <SegmentedControl active={activeTab} onChange={setActiveTab} />
        {activeTab === 'library' && ( <FlatList data={[]} ListHeaderComponent={() => LibraryContent} keyExtractor={() => 'library-root'} renderItem={() => null} refreshControl={ <RefreshControl refreshing={libraryRefreshing} onRefresh={onLibraryRefresh} tintColor={COLORS.gold} colors={[COLORS.gold]} /> } showsVerticalScrollIndicator={false} contentContainerStyle={s.scrollContent} keyboardShouldPersistTaps="handled" /> )}
        {activeTab === 'docs' && ( <>{docsLoading && !docsRefreshing ? ( <View style={s.loadingWrap}><ActivityIndicator size="large" color={COLORS.primary} /><Text style={s.loadingText}>Loading documents…</Text></View> ) : ( <ScrollView style={{ flex: 1 }} contentContainerStyle={s.docsScrollContent} showsVerticalScrollIndicator={false} refreshControl={ <RefreshControl refreshing={docsRefreshing} onRefresh={onDocsRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} /> }>{DocsListHeader}<TouchableOpacity style={s.accordionHeader} onPress={toggleActiveSection} activeOpacity={0.7}><View style={s.accordionHeaderLeft}><View style={[s.accordionDot, { backgroundColor: COLORS.blue }]} /><Text style={s.accordionTitle}>Active Projects</Text><View style={[s.countBadge, { backgroundColor: COLORS.blueBg }]}><Text style={[s.countBadgeText, { color: COLORS.blue }]}>{activeProjects.length}</Text></View></View><Ionicons name={activeExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} /></TouchableOpacity>{activeExpanded && ( <View style={s.accordionContent}>{activeProjects.length === 0 ? ( <View style={s.emptySection}><Ionicons name="folder-open-outline" size={36} color={COLORS.textDark} /><Text style={s.emptySectionTitle}>No Active Projects</Text><Text style={s.emptySectionSub}>{userRole === 'inspector' ? 'Accept jobs from the Discover tab to see documents here.' : 'Post a job to start managing project documents.'}</Text></View> ) : ( activeProjects.map((job) => ( <CollapsibleProject key={job.id} job={job} userRole={userRole} isExpanded={expandedProjects.has(job.id)} onToggle={() => toggleProject(job.id)} onViewDoc={handleViewDoc} onUploadDoc={handleUploadPress} /> )) )}</View> )}<TouchableOpacity style={[s.accordionHeader, { marginTop: 8 }]} onPress={toggleArchivedSection} activeOpacity={0.7}><View style={s.accordionHeaderLeft}><View style={[s.accordionDot, { backgroundColor: COLORS.green }]} /><Text style={s.accordionTitle}>Archived Projects</Text><View style={[s.countBadge, { backgroundColor: COLORS.greenBg }]}><Text style={[s.countBadgeText, { color: COLORS.green }]}>{archivedProjects.length}</Text></View></View><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Ionicons name="lock-closed-outline" size={12} color={COLORS.textDark} /><Ionicons name={archivedExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} /></View></TouchableOpacity>{archivedExpanded && ( <View style={s.accordionContent}>{archivedProjects.length === 0 ? ( <View style={s.emptySection}><Ionicons name="archive-outline" size={36} color={COLORS.textDark} /><Text style={s.emptySectionTitle}>No Archived Projects</Text><Text style={s.emptySectionSub}>Completed inspections and their documents will appear here for audit & legal reference.</Text></View> ) : ( archivedProjects.map((job) => ( <CollapsibleProject key={job.id} job={job} userRole={userRole} isExpanded={expandedProjects.has(job.id)} onToggle={() => toggleProject(job.id)} onViewDoc={handleViewDoc} onUploadDoc={handleUploadPress} /> )) )}{archivedProjects.length > 0 && ( <View style={s.archiveNotice}><Ionicons name="information-circle-outline" size={14} color={COLORS.textDark} /><Text style={s.archiveNoticeText}>Archived documents are retained for legal and audit compliance. They cannot be deleted.</Text></View> )}</View> )}<View style={{ height: 120 }} /></ScrollView> )}</> )}
      </SafeAreaView>

      <UploadModal
        visible={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUpload={handleUploadDocument}
        uploading={uploading}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background }, safeArea: { flex: 1 }, scrollContent: { paddingBottom: 100 }, docsScrollContent: { paddingBottom: 40 }, loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', }, loadingText: { color: COLORS.textSecondary, fontSize: 14, marginTop: 12, },
  screenTopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 10 : 2, paddingBottom: 10, }, screenTopTitle: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.5, }, screenTopBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, },
  segWrap: { paddingHorizontal: 20, paddingBottom: 14 }, segControl: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 14, padding: 3, borderWidth: 1, borderColor: COLORS.border, position: 'relative', }, segIndicator: { position: 'absolute', top: 3, left: 3, bottom: 3, borderRadius: 11, backgroundColor: COLORS.primary, }, segTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, gap: 6, zIndex: 1, }, segLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textMuted, }, segLabelActive: { color: '#FFF', fontWeight: '700', },
  docsHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', }, docsHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, }, docsHeaderIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primaryBorder, }, docsHeaderTitle: { color: COLORS.white, fontSize: 18, fontWeight: '800', }, docsHeaderSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, maxWidth: SCREEN_WIDTH - 110, },
  docStatsBanner: { flexDirection: 'row', marginHorizontal: 20, marginTop: 14, marginBottom: 14, backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', }, docStatItem: { flex: 1, alignItems: 'center', }, docStatValue: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary, }, docStatLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, }, docStatDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 4, },
  accordionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 14, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, }, accordionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, }, accordionDot: { width: 8, height: 8, borderRadius: 4, }, accordionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, }, accordionContent: { paddingHorizontal: 20, paddingTop: 10, gap: 10, },
  projectCard: { backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', }, projectCardArchived: { opacity: 0.85, borderColor: COLORS.borderLight, }, projectHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, }, projectHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, }, projectStatusDot: { width: 10, height: 10, borderRadius: 5, }, projectTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, }, projectHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10, }, projectDocCount: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4, }, projectDocCountText: { fontSize: 12, fontWeight: '700', }, projectContent: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingHorizontal: 14, paddingBottom: 14, paddingTop: 10, }, projectStatusBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, }, statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, gap: 4, }, statusBadgeText: { fontSize: 11, fontWeight: '700', }, 
  noDocsWrap: { alignItems: 'center', paddingVertical: 20, gap: 8, }, noDocsText: { fontSize: 13, color: COLORS.textDark, }, noDocsUploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.primaryBg, borderWidth: 1, borderColor: COLORS.primaryBorder, }, noDocsUploadText: { fontSize: 13, fontWeight: '600', color: COLORS.primary, },
  docsList: {}, docItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, }, docItemBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border, }, docFileIcon: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12, }, docInfo: { flex: 1, }, docFileName: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 4, }, docMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, }, docCatBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, }, docCatText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', }, docMetaText: { fontSize: 11, color: COLORS.textMuted, }, docMetaDot: { fontSize: 11, color: COLORS.textDark, }, docUploader: { fontSize: 11, color: COLORS.textDark, marginTop: 2, }, docActionBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primaryBg, justifyContent: 'center', alignItems: 'center', marginLeft: 8, },
  emptySection: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, }, emptySectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginTop: 10, }, emptySectionSub: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', marginTop: 4, lineHeight: 18, },
  archiveNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', }, archiveNoticeText: { fontSize: 11, color: COLORS.textDark, flex: 1, lineHeight: 16, },
  libScreenHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 12 : 6, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', }, libHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, }, libHeaderIconContainer: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.goldBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.goldBorder, }, libHeaderTitle: { color: COLORS.white, fontSize: 22, fontWeight: '800', letterSpacing: 0.3, }, libHeaderSubtitle: { color: 'rgba(255,255,255,0.3)', fontSize: 11, fontWeight: '500', marginTop: 1, }, offlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,184,148,0.08)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,184,148,0.15)', }, offlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.offlineGreen, }, offlineText: { color: COLORS.offlineGreen, fontSize: 10, fontWeight: '700', letterSpacing: 0.3, }, libDivider: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginVertical: 24, gap: 12, }, libDividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)', }, libDividerIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.03)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, minWidth: 24, alignItems: 'center', }, countBadgeText: { fontSize: 12, fontWeight: '800', },

  // Upload Modal Styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20, },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, width: '100%', maxWidth: 400, borderWidth: 1, borderColor: COLORS.border, },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, },
  modalTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary, },
  modalCloseBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, },
  modalSubtitle: { fontSize: 12, color: COLORS.textMuted, marginBottom: 12, },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16, },
  categoryChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', gap: 6, },
  categoryLabel: { fontSize: 12, fontWeight: '700', },
  uploadingIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, backgroundColor: COLORS.surfaceLight, borderRadius: 8, marginBottom: 16, },
  uploadingText: { fontSize: 12, color: COLORS.textMuted, },
  modalCancelBtn: { backgroundColor: COLORS.surfaceLight, paddingVertical: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, },
  modalCancelText: { fontSize: 14, fontWeight: '600', color: COLORS.textMuted, },
});