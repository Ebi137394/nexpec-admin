import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, StatusBar, Platform, RefreshControl, TouchableOpacity, Animated, Dimensions, ActivityIndicator, Alert, Modal, Pressable, ScrollView, LayoutAnimation, UIManager, TextInput, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
// ★ NX-STORAGE-002 — `documents` bucket is private post-Module-2 lockdown.
//   Document views require a freshly minted signed URL; the legacy
//   `file_url` field is a non-working public URL for new uploads and
//   should be re-parsed into bucket+path so we can mint a signed URL on
//   demand.
import { signedUrl, parseSupabaseStorageUrl, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';
// ★ Library section deprecated — ReferenceHub + MicroLearning no longer
//   imported. The Resources tab is now strictly Project Documents.
import { supabase } from '../../lib/supabase';
import { jobFieldsForRole } from '../../lib/jobsProjection';
import { useAuth } from '../../src/contexts/AuthContext';
import { useLanguage } from '@/src/i18n/LanguageProvider';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) { UIManager.setLayoutAnimationEnabledExperimental(true); }
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const COLORS = { background: '#020420', backgroundAlt: '#0a0f2e', surface: '#0F172A', surfaceLight: '#1E293B', surfaceElevated: '#162036', border: '#1F2937', borderLight: '#334155', primary: '#7C3AED', primaryLight: '#8B5CF6', primaryDark: '#6D28D9', primaryBg: 'rgba(124, 58, 237, 0.12)', primaryBorder: 'rgba(124, 58, 237, 0.25)', blue: '#3B82F6', blueBg: 'rgba(59, 130, 246, 0.12)', blueBorder: 'rgba(59, 130, 246, 0.25)', green: '#10B981', greenBg: 'rgba(16, 185, 129, 0.12)', greenBorder: 'rgba(16, 185, 129, 0.25)', red: '#EF4444', redBg: 'rgba(239, 68, 68, 0.12)', amber: '#F59E0B', amberBg: 'rgba(245, 158, 11, 0.12)', amberBorder: 'rgba(245, 158, 11, 0.25)', cyan: '#06B6D4', cyanBg: 'rgba(6, 182, 212, 0.12)', white: '#FFFFFF', textPrimary: '#F1F5F9', textSecondary: '#94A3B8', textMuted: '#64748B', textDark: '#475569', };

type UserRole = 'inspector' | 'client' | 'agency' | 'enterprise';
interface ProjectDocument { id: string; job_id: string; file_name: string; file_type: string; file_size: number; file_url: string; /** External link (Google Drive / Dropbox / etc.) — set instead of file_url for link rows. */ document_url?: string | null; category: 'itp' | 'drawing' | 'spec' | 'report' | 'certificate' | 'other'; uploaded_by: string; uploaded_by_name?: string; created_at: string; notes?: string; }
interface JobWithDocs { id: string; title: string; status: string; documents: ProjectDocument[]; }

const DOC_CATEGORIES: { key: ProjectDocument['category']; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; }[] = [ { key: 'itp', label: 'ITP', icon: 'clipboard-outline', color: COLORS.primary, bg: COLORS.primaryBg }, { key: 'drawing', label: 'Drawing', icon: 'map-outline', color: COLORS.blue, bg: COLORS.blueBg }, { key: 'spec', label: 'Spec', icon: 'document-text-outline', color: COLORS.amber, bg: COLORS.amberBg }, { key: 'report', label: 'Report', icon: 'analytics-outline', color: COLORS.green, bg: COLORS.greenBg }, { key: 'certificate', label: 'Certificate', icon: 'ribbon-outline', color: COLORS.cyan, bg: COLORS.cyanBg }, { key: 'other', label: 'Other', icon: 'attach-outline', color: COLORS.textSecondary, bg: 'rgba(148,163,184,0.12)' }, ];
const FILE_TYPE_ICONS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = { pdf: { icon: 'document-text', color: '#EF4444' }, doc: { icon: 'document', color: '#3B82F6' }, docx: { icon: 'document', color: '#3B82F6' }, xls: { icon: 'grid', color: '#10B981' }, xlsx: { icon: 'grid', color: '#10B981' }, jpg: { icon: 'image', color: '#F59E0B' }, jpeg: { icon: 'image', color: '#F59E0B' }, png: { icon: 'image', color: '#8B5CF6' }, dwg: { icon: 'construct', color: '#06B6D4' }, default: { icon: 'document-outline', color: COLORS.textMuted }, };

const formatFileSize = (bytes: number): string => { if (bytes === 0) return '0 B'; const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`; };
const formatDate = (dateStr: string): string => { const d = new Date(dateStr); const diffMins = Math.floor((new Date().getTime() - d.getTime()) / 60000); if (diffMins < 1) return 'Just now'; if (diffMins < 60) return `${diffMins}m ago`; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const getFileTypeConfig = (fileName: string) => { const ext = fileName.split('.').pop()?.toLowerCase() || ''; return FILE_TYPE_ICONS[ext] || FILE_TYPE_ICONS.default; };
const getJobStatusConfig = (status: string) => { switch (status) { case 'assigned': case 'in_progress': return { label: 'Active', color: COLORS.blue, bg: COLORS.blueBg, icon: 'play-circle' as const }; case 'pending': return { label: 'Pending', color: COLORS.amber, bg: COLORS.amberBg, icon: 'time' as const }; case 'completed': return { label: 'Completed', color: COLORS.green, bg: COLORS.greenBg, icon: 'checkmark-circle' as const }; case 'open': return { label: 'Open', color: COLORS.cyan, bg: COLORS.cyanBg, icon: 'radio-button-on' as const }; default: return { label: status, color: COLORS.textMuted, bg: 'rgba(100,116,139,0.12)', icon: 'ellipse' as const }; } };

// ★ SegmentedControl removed — the Resources tab no longer toggles
//   between Project Docs and Library. Project Docs is the only mode.

const CollapsibleProject: React.FC<{ job: JobWithDocs; userRole: UserRole; isExpanded: boolean; onToggle: () => void; onViewDoc: (doc: ProjectDocument) => void; onUploadDoc?: (jobId: string) => void; }> = React.memo(({ job, userRole, isExpanded, onToggle, onViewDoc, onUploadDoc }) => {
  const { t } = useLanguage();
  const rotateAnim = useRef(new Animated.Value(isExpanded ? 1 : 0)).current; const statusCfg = getJobStatusConfig(job.status); const isArchived = job.status === 'completed';
  useEffect(() => { Animated.spring(rotateAnim, { toValue: isExpanded ? 1 : 0, tension: 60, friction: 10, useNativeDriver: true, }).start(); }, [isExpanded]);
  const rotation = rotateAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'], });
  return (
    <View style={[s.projectCard, isArchived && s.projectCardArchived]}>
      <TouchableOpacity style={s.projectHeader} onPress={onToggle} activeOpacity={0.7}><View style={s.projectHeaderLeft}><View style={[s.projectStatusDot, { backgroundColor: statusCfg.color }]} /><View style={{ flex: 1 }}><Text style={s.projectTitle} numberOfLines={1}>{job.title || t('Untitled Project')}</Text></View></View><View style={s.projectHeaderRight}><View style={[s.projectDocCount, { backgroundColor: `${statusCfg.color}15` }]}><Ionicons name="document-text-outline" size={12} color={statusCfg.color} /><Text style={[s.projectDocCountText, { color: statusCfg.color }]}>{job.documents.length}</Text></View><Animated.View style={{ transform: [{ rotate: rotation }] }}><Ionicons name="chevron-down" size={18} color={COLORS.textMuted} /></Animated.View></View></TouchableOpacity>
      {isExpanded && (
        <View style={s.projectContent}>
          <View style={s.projectStatusBar}><View style={[s.statusBadge, { backgroundColor: statusCfg.bg }]}><Ionicons name={statusCfg.icon} size={12} color={statusCfg.color} /><Text style={[s.statusBadgeText, { color: statusCfg.color }]}>{statusCfg.label}</Text></View></View>
          {job.documents.length === 0 ? ( <View style={s.noDocsWrap}><Ionicons name="document-outline" size={28} color={COLORS.textDark} /><Text style={s.noDocsText}>{t('No documents uploaded yet')}</Text>{(userRole === 'client' || userRole === 'agency') && onUploadDoc && ( <TouchableOpacity style={s.noDocsUploadBtn} onPress={() => onUploadDoc(job.id)} activeOpacity={0.8}><Ionicons name="cloud-upload-outline" size={14} color={COLORS.primary} /><Text style={s.noDocsUploadText}>{t('Upload First Document')}</Text></TouchableOpacity> )}</View> ) : (
            <View style={s.docsList}>
              {job.documents.map((doc, idx) => {
                const isExternal = !!doc.document_url;
                // External rows get a cyan link icon and "External Link" meta
                // label, so users immediately recognize them as off-platform.
                const fileCfg = isExternal
                  ? { icon: 'link' as const, color: COLORS.cyan }
                  : getFileTypeConfig(doc.file_name);
                const catCfg = DOC_CATEGORIES.find(c => c.key === doc.category);
                return ( <TouchableOpacity key={doc.id} style={[s.docItem, idx < job.documents.length - 1 && s.docItemBorder]} onPress={() => onViewDoc(doc)} activeOpacity={0.7}><View style={[s.docFileIcon, { backgroundColor: `${fileCfg.color}15` }]}><Ionicons name={fileCfg.icon} size={20} color={fileCfg.color} /></View><View style={s.docInfo}><Text style={s.docFileName} numberOfLines={1}>{doc.file_name}</Text><View style={s.docMetaRow}>{catCfg && ( <View style={[s.docCatBadge, { backgroundColor: catCfg.bg }]}><Text style={[s.docCatText, { color: catCfg.color }]}>{t(catCfg.label)}</Text></View> )}{isExternal ? ( <View style={[s.docCatBadge, { backgroundColor: COLORS.cyanBg }]}><Text style={[s.docCatText, { color: COLORS.cyan }]}>{t('EXTERNAL LINK')}</Text></View> ) : ( <Text style={s.docMetaText}>{formatFileSize(doc.file_size)}</Text> )}<Text style={s.docMetaDot}>•</Text><Text style={s.docMetaText}>{formatDate(doc.created_at)}</Text></View>{doc.uploaded_by_name && ( <Text style={s.docUploader}>{t('by')} {doc.uploaded_by_name}</Text> )}</View><TouchableOpacity style={s.docActionBtn} onPress={() => onViewDoc(doc)} activeOpacity={0.7}><Ionicons name={isExternal ? 'open-outline' : (userRole === 'inspector' ? 'download-outline' : 'eye-outline')} size={18} color={isExternal ? COLORS.cyan : COLORS.primary} /></TouchableOpacity></TouchableOpacity> );
              })}
            </View>
          )}
        </View>
      )}
    </View>
  );
});

const DocStats: React.FC<{ activeCount: number; archivedCount: number; totalDocs: number; }> = React.memo(({ activeCount, archivedCount, totalDocs }) => {
  const { t } = useLanguage();
  return (
  <View style={s.docStatsBanner}><LinearGradient colors={['rgba(124,58,237,0.12)', 'rgba(124,58,237,0.04)', 'transparent']} style={StyleSheet.absoluteFill} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} /><View style={s.docStatItem}><Text style={s.docStatValue}>{activeCount}</Text><Text style={s.docStatLabel}>{t('Active')}</Text></View><View style={s.docStatDivider} /><View style={s.docStatItem}><Text style={s.docStatValue}>{archivedCount}</Text><Text style={s.docStatLabel}>{t('Archived')}</Text></View><View style={s.docStatDivider} /><View style={s.docStatItem}><Text style={s.docStatValue}>{totalDocs}</Text><Text style={s.docStatLabel}>{t('Documents')}</Text></View></View>
  );
});

type UploadMode = 'file' | 'link';

const UploadModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  onUploadFile: (category: ProjectDocument['category']) => void;
  onUploadLink: (category: ProjectDocument['category'], url: string) => void;
  uploading: boolean;
}> = ({ visible, onClose, onUploadFile, onUploadLink, uploading }) => {
  const { t } = useLanguage();
  const [mode, setMode] = useState<UploadMode>('file');
  const [linkUrl, setLinkUrl] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ProjectDocument['category'] | null>(null);

  // Reset state every time the modal re-opens.
  useEffect(() => {
    if (visible) {
      setMode('file');
      setLinkUrl('');
      setSelectedCategory(null);
    }
  }, [visible]);

  const handleCategoryTap = (category: ProjectDocument['category']) => {
    if (uploading) return;
    if (mode === 'file') {
      // File mode: tapping a chip kicks off the native file picker immediately.
      onUploadFile(category);
    } else {
      // Link mode: select the category, wait for user to enter URL + tap Attach.
      setSelectedCategory(category);
    }
  };

  const handleAttachLink = () => {
    if (!selectedCategory) {
      Alert.alert(t('Pick a category'), t('Tap one of the category chips above first.'));
      return;
    }
    const raw = linkUrl.trim();
    if (!raw) {
      Alert.alert(t('Paste a URL'), t('Enter a Google Drive / Dropbox / OneDrive link.'));
      return;
    }
    if (!/^https?:\/\//i.test(raw)) {
      Alert.alert(t('Invalid link'), t('The URL must start with http:// or https://.'));
      return;
    }
    onUploadLink(selectedCategory, raw);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.modalOverlay}>
        <View style={s.modalContent}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{t('Upload Document')}</Text>
            <TouchableOpacity onPress={onClose} style={s.modalCloseBtn}>
              <Ionicons name="close" size={24} color={COLORS.textMuted} />
            </TouchableOpacity>
          </View>

          {/* ★ Source toggle — File or External Link */}
          <Text style={s.modalSubtitle}>{t('Source')}</Text>
          <View style={s.modeToggleRow}>
            <TouchableOpacity
              style={[s.modeToggleBtn, mode === 'file' && s.modeToggleBtnOn]}
              onPress={() => setMode('file')}
              disabled={uploading}
              activeOpacity={0.8}
            >
              <Ionicons
                name="cloud-upload-outline"
                size={16}
                color={mode === 'file' ? COLORS.primary : COLORS.textMuted}
              />
              <Text style={[s.modeToggleText, mode === 'file' && { color: COLORS.primary }]}>
                {t('Pick File')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.modeToggleBtn, mode === 'link' && s.modeToggleBtnOn]}
              onPress={() => setMode('link')}
              disabled={uploading}
              activeOpacity={0.8}
            >
              <Ionicons
                name="link-outline"
                size={16}
                color={mode === 'link' ? COLORS.primary : COLORS.textMuted}
              />
              <Text style={[s.modeToggleText, mode === 'link' && { color: COLORS.primary }]}>
                {t('External Link')}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={[s.modalSubtitle, { marginTop: 14 }]}>
            {mode === 'file' ? t('Select document category') : t('Select category, then paste URL')}
          </Text>

          <View style={s.categoryGrid}>
            {DOC_CATEGORIES.map((cat) => {
              const isPicked = mode === 'link' && selectedCategory === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[
                    s.categoryChip,
                    { backgroundColor: cat.bg },
                    isPicked && { borderColor: cat.color, borderWidth: 1.5 },
                  ]}
                  onPress={() => handleCategoryTap(cat.key)}
                  disabled={uploading}
                  activeOpacity={0.8}
                >
                  <Ionicons name={cat.icon} size={20} color={cat.color} />
                  <Text style={[s.categoryLabel, { color: cat.color }]}>{t(cat.label)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ★ Link mode — URL input + Attach button */}
          {mode === 'link' && (
            <View style={s.linkBlock}>
              <Text style={s.modalSubtitle}>{t('External URL')}</Text>
              <View style={s.linkInputWrap}>
                <Ionicons name="link" size={14} color={COLORS.cyan} style={{ marginRight: 8 }} />
                <TextInput
                  value={linkUrl}
                  onChangeText={setLinkUrl}
                  placeholder="https://drive.google.com/..."
                  placeholderTextColor={COLORS.textDark}
                  style={s.linkInputField}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="done"
                  onSubmitEditing={handleAttachLink}
                  editable={!uploading}
                />
              </View>
              <Text style={s.linkHelp}>
                {t('For heavy files (large drawings, video, full DWG packages) use Google Drive, Dropbox, or OneDrive share links.')}
              </Text>
              <TouchableOpacity
                style={[
                  s.linkAttachBtn,
                  (!selectedCategory || !linkUrl.trim() || uploading) && { opacity: 0.5 },
                ]}
                onPress={handleAttachLink}
                disabled={!selectedCategory || !linkUrl.trim() || uploading}
                activeOpacity={0.85}
              >
                <Ionicons name="add-circle-outline" size={18} color="#FFF" />
                <Text style={s.linkAttachText}>{t('Attach External Link')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {uploading && (
            <View style={s.uploadingIndicator}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={s.uploadingText}>
                {mode === 'file' ? t('Uploading document…') : t('Saving link…')}
              </Text>
            </View>
          )}

          <TouchableOpacity style={s.modalCancelBtn} onPress={onClose} activeOpacity={0.7}>
            <Text style={s.modalCancelText}>{t('Cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

export default function ResourcesScreen() {
  const router = useRouter(); const { user } = useAuth();
  const { t, isRTL, language } = useLanguage();
  // ★ activeTab + library state removed — Project Docs is the only mode.
  const [userRole, setUserRole] = useState<UserRole>('inspector'); const [jobsWithDocs, setJobsWithDocs] = useState<JobWithDocs[]>([]); const [docsLoading, setDocsLoading] = useState(true); const [docsRefreshing, setDocsRefreshing] = useState(false); const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set()); const [activeExpanded, setActiveExpanded] = useState(true); const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const activeProjects = useMemo( () => jobsWithDocs.filter((j) => j.status !== 'completed'), [jobsWithDocs], );
  const archivedProjects = useMemo( () => jobsWithDocs.filter((j) => j.status === 'completed'), [jobsWithDocs], );
  const totalDocs = useMemo( () => jobsWithDocs.reduce((sum, j) => sum + j.documents.length, 0), [jobsWithDocs], );

  const fetchUserRole = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role) {
        // Enterprise is now a first-class role on mobile (alias removed
        // 2026-05-20). The fetchJobsWithDocuments branch below has been
        // extended to include enterprise alongside client/agency so the
        // client_id filter is always applied — never an unfiltered scan.
        setUserRole(profile.role as UserRole);
      }
    } catch (err) {}
  }, [user?.id]);

  const fetchJobsWithDocuments = useCallback(async () => {
    if (!user?.id) return;
    try {
      // ★ DEFENSE-IN-DEPTH: previously this used `if/else if` and any role
      //   that wasn't exactly 'inspector'/'client'/'agency' fell through
      //   with NO filter — leaking every job in the DB. Switching to a
      //   default-deny shape: inspector → contractor_id; everyone else
      //   (client, agency, enterprise, future roles) → client_id. The
      //   query is never sent without a user-scoping filter.
      // ★ CONSOLE-NOISE-001(A): PII-stripped — was logging user.id to
      //   the device console, which Console.app exposes to anyone with
      //   physical access. Role only is sufficient for diagnostics.
      console.log('[resources] fetchJobsWithDocuments role=', userRole);
      // GR2 (Strict price visibility) — pick the projection that matches
      // the caller's role. Inspector NEVER receives client_price_cents;
      // buyer roles (client/agency/enterprise) NEVER receive payout.
      const projection = jobFieldsForRole(userRole);
      let jobQuery = supabase.from('jobs').select(projection).order('created_at', { ascending: false });
      if (userRole === 'inspector') {
        jobQuery = jobQuery.eq('contractor_id', user.id);
      } else {
        jobQuery = jobQuery.eq('client_id', user.id);
      }
      const { data: jobs, error: jobError } = await jobQuery;
      if (jobError) throw jobError; if (!jobs || jobs.length === 0) { setJobsWithDocs([]); return; }
      
      const jobIds = (jobs as any[]).map((j) => j.id);
      // SAFE QUERY - Removed relational join on profiles to prevent PGRST200
      const { data: docs, error: docError } = await supabase.from('project_documents').select('*').in('job_id', jobIds).order('created_at', { ascending: false });
      if (docError) throw docError;
      
      const docsMap = new Map<string, ProjectDocument[]>();
      (docs || []).forEach((d: any) => { const list = docsMap.get(d.job_id) || []; list.push({ id: d.id, job_id: d.job_id, file_name: d.file_name, file_type: d.file_type || '', file_size: d.file_size || 0, file_url: d.file_url || '', document_url: d.document_url ?? null, category: d.category || 'other', uploaded_by: d.uploaded_by, uploaded_by_name: 'User', created_at: d.created_at, notes: d.notes, }); docsMap.set(d.job_id, list); });
      const merged: JobWithDocs[] = (jobs as any[]).map((j) => ({ ...j, documents: docsMap.get(j.id) || [], }));
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
    // ★ External-link rows open straight in the device's default browser
    //   via Linking.openURL — no storage download path, no signed-URL
    //   ceremony. Works on iOS, Android, and web for any reachable URL.
    if (doc.document_url) {
      Alert.alert(
        doc.file_name || t('External Link'),
        `${t('Category:')} ${doc.category.toUpperCase()}\n${t('Source: External Link')}\n\n${doc.document_url}\n\n${t('Open in browser?')}`,
        [
          { text: t('Cancel'), style: 'cancel' },
          {
            text: t('Open Link'),
            onPress: async () => {
              try {
                const supported = await Linking.canOpenURL(doc.document_url!);
                if (!supported) {
                  Alert.alert(t('Cannot open link'), t('This URL is not supported on this device.'));
                  return;
                }
                await Linking.openURL(doc.document_url!);
              } catch (e: any) {
                Alert.alert(t('Could not open link'), e?.message ?? t('Unknown error.'));
              }
            },
          },
        ],
      );
      return;
    }

    // Existing file-upload flow — bucket is private post-NX-STORAGE-002
    // lockdown, so `file_url` (legacy public URL) is no longer renderable.
    // We DEFER the signed-URL mint to onPress so handleViewDoc stays sync
    // (the outer useCallback is not async). Falls back to legacy URL if
    // parsing fails (non-Supabase URL).
    if (doc.file_url) {
      Alert.alert(
        doc.file_name,
        `${t('Category:')} ${doc.category.toUpperCase()}\n${t('Size:')} ${formatFileSize(doc.file_size)}\n\n${t('Open this document?')}`,
        [
          { text: t('Cancel'), style: 'cancel' },
          {
            text: userRole === 'inspector' ? t('Download') : t('View'),
            onPress: async () => {
              try {
                let openUrl = doc.file_url;
                const parsed = parseSupabaseStorageUrl(doc.file_url);
                if (parsed) {
                  const fresh = await signedUrl({
                    bucket: parsed.bucket,
                    path:   parsed.path,
                    ttl:    SIGNED_URL_TTL.VIEW,
                  });
                  if (fresh) openUrl = fresh;
                }
                const supported = await Linking.canOpenURL(openUrl);
                if (supported) {
                  await Linking.openURL(openUrl);
                } else {
                  Alert.alert(t('Cannot open document'), t('This URL is not supported on this device.'));
                }
              } catch (e: any) {
                Alert.alert(t('Could not open'), e?.message ?? t('Unknown error.'));
              }
            },
          },
        ],
      );
    } else {
      Alert.alert(t('Unavailable'), t('Document URL is not available.'));
    }
  }, [userRole, t]);

  const handleUploadDocument = useCallback(
    async (category: ProjectDocument['category']) => {
      if (!uploadJobId || !user?.id) {
        Alert.alert(t('Error'), t('Please select a project first.'));
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

        Alert.alert(t('Success'), t('Document uploaded successfully!'));
        setShowUploadModal(false);
        setUploadJobId(null);
        // Force refresh the list after a successful upload
        await fetchJobsWithDocuments();
      } catch (err: any) {
        console.error('Upload error:', err);
        Alert.alert(t('Upload Failed'), err.message || t('An error occurred during upload.'));
      } finally {
        setUploading(false);
      }
    },
    [uploadJobId, user?.id, fetchJobsWithDocuments, t],
  );

  const handleUploadPress = useCallback((jobId: string) => {
    setUploadJobId(jobId);
    setShowUploadModal(true);
  }, []);

  // ─── External Link insert (no storage upload) ──────────────────────
  // Inserts a project_documents row with document_url populated and
  // file_url left null (allowed by the new project_documents_has_pointer
  // CHECK constraint). file_name / file_type / file_size are filled with
  // sensible defaults so the existing list renderer works unchanged.
  const handleUploadLink = useCallback(
    async (category: ProjectDocument['category'], url: string) => {
      if (!uploadJobId || !user?.id) {
        Alert.alert(t('Error'), t('Please select a project first.'));
        return;
      }
      setUploading(true);
      try {
        // Derive a friendly file_name from the URL host so it reads sensibly
        // in the docs list ("drive.google.com link", "dropbox.com link", …).
        let label = 'External Link';
        try {
          const parsed = new URL(url);
          label = `${parsed.hostname} link`;
        } catch {
          /* keep default label */
        }

        const newDoc = {
          job_id: uploadJobId,
          file_name: label,
          file_type: 'url',
          file_size: 0,
          file_url: null,
          document_url: url,
          category,
          uploaded_by: user.id,
          notes: null,
        };

        const { error: dbError } = await supabase
          .from('project_documents')
          .insert(newDoc);
        if (dbError) throw dbError;

        Alert.alert(t('Saved'), t('External link attached.'));
        setShowUploadModal(false);
        setUploadJobId(null);
        await fetchJobsWithDocuments();
      } catch (err: any) {
        console.error('Link save error:', err);
        Alert.alert(t('Could not save link'), err?.message ?? t('An error occurred.'));
      } finally {
        setUploading(false);
      }
    },
    [uploadJobId, user?.id, fetchJobsWithDocuments, t],
  );

  const onDocsRefresh = useCallback(async () => { setDocsRefreshing(true); await fetchJobsWithDocuments(); setDocsRefreshing(false); }, [fetchJobsWithDocuments]);

  // ★ LibraryContent useMemo + onLibraryRefresh removed alongside the
  //   deprecated Library tab. Only DocsListHeader survives.
  const DocsListHeader = useMemo( () => ( <View><View style={s.docsHeader}><View style={s.docsHeaderLeft}><View style={s.docsHeaderIcon}><Ionicons name="folder-open" size={20} color={COLORS.primary} /></View><View><Text style={s.docsHeaderTitle}>{t('Project Documents')}</Text><Text style={s.docsHeaderSub}>{userRole === 'inspector' ? t('Documents for your assigned inspections') : t('Manage documents across your projects')}</Text></View></View></View><DocStats activeCount={activeProjects.length} archivedCount={archivedProjects.length} totalDocs={totalDocs} /></View> ), [userRole, activeProjects.length, archivedProjects.length, totalDocs, t, language], );

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <LinearGradient colors={[COLORS.background, COLORS.backgroundAlt, COLORS.background]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView style={s.safeArea} edges={['top']}>
        <View style={s.screenTopHeader}><Text style={s.screenTopTitle}>{t('Documents')}</Text><TouchableOpacity style={s.screenTopBtn} onPress={() => router.push('/notifications')} activeOpacity={0.7}><Ionicons name="notifications-outline" size={22} color={COLORS.textSecondary} /></TouchableOpacity></View>
        {/* ★ Library deprecated. Project Documents is the only mode now. */}
        {docsLoading && !docsRefreshing ? ( <View style={s.loadingWrap}><ActivityIndicator size="large" color={COLORS.primary} /><Text style={s.loadingText}>{t('Loading documents…')}</Text></View> ) : ( <ScrollView style={{ flex: 1 }} contentContainerStyle={s.docsScrollContent} showsVerticalScrollIndicator={false} refreshControl={ <RefreshControl refreshing={docsRefreshing} onRefresh={onDocsRefresh} tintColor={COLORS.primary} colors={[COLORS.primary]} /> }>{DocsListHeader}<TouchableOpacity style={s.accordionHeader} onPress={toggleActiveSection} activeOpacity={0.7}><View style={s.accordionHeaderLeft}><View style={[s.accordionDot, { backgroundColor: COLORS.blue }]} /><Text style={s.accordionTitle}>{t('Active Projects')}</Text><View style={[s.countBadge, { backgroundColor: COLORS.blueBg }]}><Text style={[s.countBadgeText, { color: COLORS.blue }]}>{activeProjects.length}</Text></View></View><Ionicons name={activeExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} /></TouchableOpacity>{activeExpanded && ( <View style={s.accordionContent}>{activeProjects.length === 0 ? ( <View style={s.emptySection}><Ionicons name="folder-open-outline" size={36} color={COLORS.textDark} /><Text style={s.emptySectionTitle}>{t('No Active Projects')}</Text><Text style={s.emptySectionSub}>{userRole === 'inspector' ? t('Accept jobs from the Discover tab to see documents here.') : t('Post a job to start managing project documents.')}</Text></View> ) : ( activeProjects.map((job) => ( <CollapsibleProject key={job.id} job={job} userRole={userRole} isExpanded={expandedProjects.has(job.id)} onToggle={() => toggleProject(job.id)} onViewDoc={handleViewDoc} onUploadDoc={handleUploadPress} /> )) )}</View> )}<TouchableOpacity style={[s.accordionHeader, { marginTop: 8 }]} onPress={toggleArchivedSection} activeOpacity={0.7}><View style={s.accordionHeaderLeft}><View style={[s.accordionDot, { backgroundColor: COLORS.green }]} /><Text style={s.accordionTitle}>{t('Archived Projects')}</Text><View style={[s.countBadge, { backgroundColor: COLORS.greenBg }]}><Text style={[s.countBadgeText, { color: COLORS.green }]}>{archivedProjects.length}</Text></View></View><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Ionicons name="lock-closed-outline" size={12} color={COLORS.textDark} /><Ionicons name={archivedExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={COLORS.textMuted} /></View></TouchableOpacity>{archivedExpanded && ( <View style={s.accordionContent}>{archivedProjects.length === 0 ? ( <View style={s.emptySection}><Ionicons name="archive-outline" size={36} color={COLORS.textDark} /><Text style={s.emptySectionTitle}>{t('No Archived Projects')}</Text><Text style={s.emptySectionSub}>{t('Completed inspections and their documents will appear here for audit & legal reference.')}</Text></View> ) : ( archivedProjects.map((job) => ( <CollapsibleProject key={job.id} job={job} userRole={userRole} isExpanded={expandedProjects.has(job.id)} onToggle={() => toggleProject(job.id)} onViewDoc={handleViewDoc} onUploadDoc={handleUploadPress} /> )) )}{archivedProjects.length > 0 && ( <View style={s.archiveNotice}><Ionicons name="information-circle-outline" size={14} color={COLORS.textDark} /><Text style={s.archiveNoticeText}>{t('Archived documents are retained for legal and audit compliance. They cannot be deleted.')}</Text></View> )}</View> )}<View style={{ height: 120 }} /></ScrollView> )}
      </SafeAreaView>

      <UploadModal
        visible={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadFile={handleUploadDocument}
        onUploadLink={handleUploadLink}
        uploading={uploading}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.background }, safeArea: { flex: 1 }, docsScrollContent: { paddingBottom: 40 }, loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', }, loadingText: { color: COLORS.textSecondary, fontSize: 14, marginTop: 12, },
  screenTopHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: Platform.OS === 'android' ? 10 : 2, paddingBottom: 10, }, screenTopTitle: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.5, }, screenTopBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, },
  docsHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', }, docsHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, }, docsHeaderIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.primaryBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.primaryBorder, }, docsHeaderTitle: { color: COLORS.white, fontSize: 18, fontWeight: '800', }, docsHeaderSub: { color: COLORS.textMuted, fontSize: 12, marginTop: 2, maxWidth: SCREEN_WIDTH - 110, },
  docStatsBanner: { flexDirection: 'row', marginHorizontal: 20, marginTop: 14, marginBottom: 14, backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', }, docStatItem: { flex: 1, alignItems: 'center', }, docStatValue: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary, }, docStatLabel: { fontSize: 11, color: COLORS.textMuted, marginTop: 2, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, }, docStatDivider: { width: 1, backgroundColor: COLORS.border, marginVertical: 4, },
  accordionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 20, paddingVertical: 14, paddingHorizontal: 14, backgroundColor: COLORS.surface, borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, }, accordionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, }, accordionDot: { width: 8, height: 8, borderRadius: 4, }, accordionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, }, accordionContent: { paddingHorizontal: 20, paddingTop: 10, gap: 10, },
  projectCard: { backgroundColor: COLORS.surface, borderRadius: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden', }, projectCardArchived: { opacity: 0.85, borderColor: COLORS.borderLight, }, projectHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, }, projectHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, }, projectStatusDot: { width: 10, height: 10, borderRadius: 5, }, projectTitle: { fontSize: 15, fontWeight: '700', color: COLORS.textPrimary, }, projectHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10, }, projectDocCount: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 4, }, projectDocCountText: { fontSize: 12, fontWeight: '700', }, projectContent: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingHorizontal: 14, paddingBottom: 14, paddingTop: 10, }, projectStatusBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, }, statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, gap: 4, }, statusBadgeText: { fontSize: 11, fontWeight: '700', }, 
  noDocsWrap: { alignItems: 'center', paddingVertical: 20, gap: 8, }, noDocsText: { fontSize: 13, color: COLORS.textDark, }, noDocsUploadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.primaryBg, borderWidth: 1, borderColor: COLORS.primaryBorder, }, noDocsUploadText: { fontSize: 13, fontWeight: '600', color: COLORS.primary, },
  docsList: {}, docItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, }, docItemBorder: { borderBottomWidth: 1, borderBottomColor: COLORS.border, }, docFileIcon: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12, }, docInfo: { flex: 1, }, docFileName: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 4, }, docMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, }, docCatBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, }, docCatText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', }, docMetaText: { fontSize: 11, color: COLORS.textMuted, }, docMetaDot: { fontSize: 11, color: COLORS.textDark, }, docUploader: { fontSize: 11, color: COLORS.textDark, marginTop: 2, }, docActionBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.primaryBg, justifyContent: 'center', alignItems: 'center', marginLeft: 8, },
  emptySection: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20, }, emptySectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginTop: 10, }, emptySectionSub: { fontSize: 13, color: COLORS.textMuted, textAlign: 'center', marginTop: 4, lineHeight: 18, },
  archiveNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', }, archiveNoticeText: { fontSize: 11, color: COLORS.textDark, flex: 1, lineHeight: 16, },
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

  // ★ Upload source toggle (File / External Link) ─────────────────────
  modeToggleRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  modeToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceLight,
  },
  modeToggleBtnOn: {
    backgroundColor: COLORS.primaryBg,
    borderColor: COLORS.primaryBorder,
  },
  modeToggleText: { fontSize: 13, fontWeight: '700', color: COLORS.textMuted },

  // ★ External Link input block (shown only in link mode) ────────────
  linkBlock: { marginBottom: 14 },
  linkInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  linkInputField: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 13,
    padding: 0,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any,
  },
  linkHelp: { color: COLORS.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 10, fontStyle: 'italic' },
  linkAttachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 10,
  },
  linkAttachText: { color: '#FFF', fontSize: 14, fontWeight: '800', letterSpacing: 0.3 },
});