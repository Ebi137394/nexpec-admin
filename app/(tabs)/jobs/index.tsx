import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Dimensions, FlatList, Animated, StatusBar, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import MapView from 'react-native-map-clustering';
import { Marker, Region } from 'react-native-maps';
import { supabase } from '@/lib/supabase';
import { BUYER_JOB_FIELDS, INSPECTOR_JOB_FIELDS } from '@/lib/jobsProjection';
import { useAuth } from '@/src/contexts/AuthContext';
import { PipelineSection } from '@/src/components/jobs/PipelineSection';
// ★ Phase 5 — Discovery Engine: proximity-sorted feed + radius override
import { useDiscoverJobs } from '@/src/hooks/useDiscoverJobs';
import RadiusPickerSheet, { formatRadiusLabel } from '@/src/components/inspector/RadiusPickerSheet';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLORS = { background: '#020420', surface: '#0F172A', surfaceLight: '#1E293B', border: '#1F2937', primary: '#7C3AED', primaryLight: '#8B5CF6', primaryBg: 'rgba(124, 58, 237, 0.12)', blue: '#3B82F6', blueBg: 'rgba(59, 130, 246, 0.12)', green: '#10B981', greenBg: 'rgba(16, 185, 129, 0.12)', red: '#EF4444', redBg: 'rgba(239, 68, 68, 0.12)', amber: '#F59E0B', amberBg: 'rgba(245, 158, 11, 0.12)', cyan: '#06B6D4', cyanBg: 'rgba(6, 182, 212, 0.12)', white: '#F8FAFC', textPrimary: '#F1F5F9', textSecondary: '#94A3B8', textMuted: '#64748B' };
const DEFAULT_REGION: Region = { latitude: 45.5017, longitude: -73.5673, latitudeDelta: 40, longitudeDelta: 40 }; 
const TABS = [ { key: 'discover', label: 'Discover', icon: 'compass-outline' as const }, { key: 'mywork', label: 'My Work', icon: 'briefcase-outline' as const } ];
type ViewMode = 'work' | 'postings';

const formatDate = (dateStr: string) => { const d = new Date(dateStr); const diffMins = Math.floor((new Date().getTime() - d.getTime()) / 60000); if (diffMins < 1) return 'Just now'; if (diffMins < 60) return `${diffMins}m ago`; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const getJobStatusConfig = (status: string) => { switch (status) { case 'assigned': case 'in_progress': return { label: 'Active', color: COLORS.blue, bg: COLORS.blueBg, icon: 'play-circle' as const }; case 'pending': case 'pending_approval': return { label: 'Pending', color: COLORS.amber, bg: COLORS.amberBg, icon: 'time' as const }; case 'completed': return { label: 'Completed', color: COLORS.green, bg: COLORS.greenBg, icon: 'checkmark-circle' as const }; case 'cancelled': return { label: 'Cancelled', color: COLORS.red, bg: COLORS.redBg, icon: 'close-circle' as const }; case 'open': return { label: 'Open', color: COLORS.cyan, bg: COLORS.cyanBg, icon: 'radio-button-on' as const }; default: return { label: status, color: COLORS.textMuted, bg: 'rgba(100,116,139,0.12)', icon: 'ellipse' as const }; } };

const SegmentedControl: React.FC<{ activeIndex: number; onChange: (i: number) => void; }> = React.memo(({ activeIndex, onChange }) => {
  const slideAnim = useRef(new Animated.Value(0)).current; const segmentW = (SCREEN_WIDTH - 40) / 2;
  useEffect(() => { Animated.spring(slideAnim, { toValue: activeIndex * segmentW, tension: 68, friction: 12, useNativeDriver: true }).start(); }, [activeIndex, segmentW]);
  return ( <View style={st.segWrap}><View style={st.segControl}><Animated.View style={[st.segIndicator, { width: segmentW, transform: [{ translateX: slideAnim }] }]} />{TABS.map((tab, idx) => ( <TouchableOpacity key={tab.key} style={st.segTab} onPress={() => onChange(idx)} activeOpacity={0.7}><Ionicons name={tab.icon} size={16} color={activeIndex === idx ? '#FFF' : COLORS.textMuted} /><Text style={[st.segLabel, activeIndex === idx && st.segLabelActive]}>{tab.label}</Text></TouchableOpacity> ))}</View></View> );
});

const PriceMarker: React.FC<{ amount: number; selected: boolean; }> = React.memo(({ amount, selected }) => ( <View style={{ alignItems: 'center' }}><View style={[st.markerBubble, selected && st.markerBubbleSelected]}><Text style={[st.markerText, selected && st.markerTextSelected]}>{amount > 0 ? `$${Math.round(amount)}` : 'TBD'}</Text></View><View style={[st.markerArrow, selected && st.markerArrowSelected]} /></View> ));

// ★ Phase 5 — pretty-print km. "1.4k km" beyond 1000, "42 km" otherwise.
const formatDistance = (km: number | null | undefined): string | null => {
  if (km == null) return null;
  if (km >= 1000) return `~${(km / 1000).toFixed(1)}k km`;
  if (km >= 10) return `~${Math.round(km)} km`;
  return `~${km.toFixed(1)} km`;
};

const DiscoverJobCard: React.FC<{ job: any; selected: boolean; onPress: () => void; onAccept: () => void; router: any; hasApplied: boolean; }> = React.memo(({ job, selected, onPress, onAccept, router, hasApplied }) => {
  const distLabel = formatDistance(job.distance_km);
  return (
  <TouchableOpacity style={[st.discoverCard, selected && st.discoverCardSelected]} onPress={onPress} activeOpacity={0.85}>
    <View style={st.discoverTop}><View style={{ flex: 1 }}><Text style={st.discoverTitle} numberOfLines={1}>{job.title || 'Untitled Job'}</Text><View style={st.discoverLocRow}><Ionicons name="location-outline" size={13} color={COLORS.textMuted} /><Text style={st.discoverAddress} numberOfLines={1}>{job.location || [job.city, job.state, job.country].filter(Boolean).join(', ') || 'No location'}</Text>{distLabel && (<><Text style={st.discoverDistSep}>·</Text><Text style={st.discoverDistText} numberOfLines={1}>{distLabel}</Text></>)}</View></View><View style={st.discoverBudgeBadge}><Text style={st.discoverBudgeText}>{job.payout_amount_cents > 0 ? `$${Math.round(job.payout_amount_cents / 100)}` : 'TBD'}</Text></View></View>
    <View style={st.discoverTagRow}>
      <View style={[st.discoverTag, { backgroundColor: COLORS.greenBg }]}><Text style={[st.discoverTagText, { color: COLORS.green }]}>Open</Text></View>
      {(job.job_type || job.inspection_type) && ( <View style={[st.discoverTag, { backgroundColor: COLORS.primaryBg }]}><Text style={[st.discoverTagText, { color: COLORS.primaryLight }]}>{job.job_type || job.inspection_type}</Text></View> )}
    </View>
    <View style={st.discoverBottom}><Text style={st.discoverDate}>Posted {formatDate(job.created_at)}</Text></View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, width: '100%', paddingHorizontal: 2 }}>
      <TouchableOpacity activeOpacity={0.7} style={{ flex: 1, marginRight: 8, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#7C3AED', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' }} onPress={(e) => { e.stopPropagation?.(); onAccept(); }}><Text style={{ color: '#7C3AED', fontSize: 14, fontWeight: '700' }}>View Details</Text></TouchableOpacity>
      {hasApplied ? ( <View style={{ flex: 1, marginLeft: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: COLORS.surfaceLight, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}><Ionicons name="checkmark-circle" size={16} color={COLORS.green} /><Text style={{ color: COLORS.green, fontSize: 14, fontWeight: '700' }}>Applied</Text></View>
      ) : ( <TouchableOpacity activeOpacity={0.7} style={{ flex: 1, marginLeft: 8, paddingVertical: 12, borderRadius: 12, backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center' }} onPress={(e) => { e.stopPropagation?.(); router.push(`/(inspector)/jobs/${job.id}/apply`); }}><Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>Apply</Text></TouchableOpacity> )}
    </View>
  </TouchableOpacity>
  );
});

const StatsCard: React.FC<{ icon: keyof typeof Ionicons.glyphMap; label: string; count: number; color: string; bg: string; onPress: () => void; active: boolean; }> = React.memo(({ icon, label, count, color, bg, onPress, active }) => ( <TouchableOpacity style={[st.statsCard, active && { borderColor: color }]} onPress={onPress} activeOpacity={0.7}><View style={[st.statsIcon, { backgroundColor: bg }]}><Ionicons name={icon} size={18} color={color} /></View><Text style={st.statsCount}>{count}</Text><Text style={st.statsLabel}>{label}</Text></TouchableOpacity> ));
const FilterChip: React.FC<{ label: string; active: boolean; onPress: () => void; }> = React.memo(({ label, active, onPress }) => ( <TouchableOpacity style={[st.filterChip, active && st.filterChipActive]} onPress={onPress} activeOpacity={0.7}><Text style={[st.filterChipText, active && st.filterChipTextActive]}>{label}</Text></TouchableOpacity> ));

const AnimatedFilterPill: React.FC<{ label: string; icon: keyof typeof Ionicons.glyphMap; active: boolean; onPress: () => void; }> = React.memo(({ label, icon, active, onPress }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: active ? 0.94 : 1, tension: 300, friction: 15, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: active ? 1 : 0, duration: 150, useNativeDriver: true })
    ]).start();
  }, [active]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
      <TouchableOpacity style={st.dynPill} onPress={onPress} activeOpacity={0.8}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: opacityAnim, borderRadius: 20, overflow: 'hidden' }]}>
          <LinearGradient colors={['#7C3AED', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <View style={st.dynPillContent}>
          <Ionicons name={active ? "checkmark-circle" : icon} size={14} color={active ? '#FFF' : COLORS.textMuted} style={{ marginRight: 6 }} />
          <Text style={[st.dynPillText, active && st.dynPillTextActive]}>{label}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

const MyWorkJobCard: React.FC<{ job: any; onPress: () => void; onGeneratePDF: () => void; isGeneratingPDF: boolean; isClient: boolean; }> = React.memo(({ job, onPress, onGeneratePDF, isGeneratingPDF, isClient }) => {
  const cfg = getJobStatusConfig(job.status);
  return (
    <TouchableOpacity style={st.myJobCard} onPress={onPress} activeOpacity={0.85}>
      <View style={st.myJobTopRow}><View style={{ flex: 1 }}><Text style={st.myJobTitle} numberOfLines={1}>{job.title || 'Untitled Job'}</Text><View style={st.myJobLocRow}><Ionicons name="location-outline" size={13} color={COLORS.textMuted} /><Text style={st.myJobAddress} numberOfLines={1}>{job.location || [job.city, job.state, job.country].filter(Boolean).join(', ') || 'No location'}</Text></View></View><View style={[st.statusBadge, { backgroundColor: cfg.bg }]}><Ionicons name={cfg.icon} size={12} color={cfg.color} /><Text style={[st.statusBadgeText, { color: cfg.color }]}>{cfg.label}</Text></View></View>
      <View style={st.myJobActions}>
        <Text style={st.myJobDateText}>Created {formatDate(job.created_at)}</Text>
        <View style={st.myJobBtnRow}>
          {!isClient && ( <TouchableOpacity style={st.pdfBtn} onPress={onGeneratePDF} disabled={isGeneratingPDF} activeOpacity={0.7}>{isGeneratingPDF ? ( <ActivityIndicator size="small" color={COLORS.primary} /> ) : ( <><Ionicons name="document-text-outline" size={14} color={COLORS.primary} /><Text style={st.pdfBtnText}>PDF</Text></> )}</TouchableOpacity> )}
          <TouchableOpacity style={st.viewBtn} onPress={onPress} activeOpacity={0.7}><Text style={st.viewBtnText}>View</Text><Ionicons name="chevron-forward" size={14} color="#FFF" /></TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
});

export default function JobsScreen() {
  const router = useRouter(); 
  const { user } = useAuth();
  
  const [userRole, setUserRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0); 
  const [viewMode, setViewMode] = useState<ViewMode>('work'); 
  const [filter, setFilter] = useState('all'); 
  
  // ★ Phase 5 — proximity-sorted discovery feed (server-side RPC).
  //    Aliases (loading→discoverLoading, jobs→discoverJobs) preserve the
  //    existing render code so the patch stays minimally invasive.
  const {
    jobs: discoverJobs,
    loading: discoverLoading,
    refreshing: discoverRefreshing,
    refresh: refreshDiscover,
    effectiveRadiusKm,
    setRadiusOverride,
    cityQuery,
    setCityQuery,
    homeBase,
  } = useDiscoverJobs();
  const [radiusSheetVisible, setRadiusSheetVisible] = useState(false);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [myJobs, setMyJobs] = useState<any[]>([]); 
  const [myWorkLoading, setMyWorkLoading] = useState(true); 
  const [stats, setStats] = useState({ active: 0, pending: 0, completed: 0 }); 
  
  const [appliedJobIds, setAppliedJobIds] = useState<string[]>([]);
  
  // Real Filter States
  const [selectedLocations, setSelectedLocations] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const mapRef = useRef<any>(null); 
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    setSelectedLocations([]);
    setSelectedTypes([]);
    setSearchQuery('');
  }, [activeTab]);

  useEffect(() => {
    const fetchRole = async () => {
      if (!user?.id) return;
      try {
        const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).single();
        if (error) throw error;
        // Enterprise is a first-class role on mobile (no longer aliased
        // to agency). The buyer-tier branches downstream — isClientSide,
        // handleViewDetails — explicitly include all three buyer roles.
        const fetchedRole = data?.role;
        setUserRole(fetchedRole);
        if (
          fetchedRole === 'client' ||
          fetchedRole === 'agency' ||
          fetchedRole === 'enterprise'
        ) {
          setActiveTab(1);
          setViewMode('postings');
        }
      } catch (err) { console.error('Error fetching role:', err); } finally { setRoleLoading(false); }
    };
    fetchRole();
  }, [user?.id]);

  // ★ Phase 5 — fetchDiscoverJobs removed. useDiscoverJobs (above) owns
  //   loading, refresh, debounced search, radius override, and the
  //   distance/has_applied row enrichment. The Discover feed now sorts
  //   by proximity server-side via the discover_jobs RPC.

  const fetchMyJobs = useCallback(async () => {
    if (!user?.id || !userRole) return;
    setMyWorkLoading(true);
    try {
      // GR2 (Strict price visibility) — projection allowlist per role.
      // Buyers (client/agency/enterprise) get BUYER_JOB_FIELDS — never
      // receive payout_amount_cents / inspector_payout_cents.
      // Inspectors get INSPECTOR_JOB_FIELDS — never receive
      // client_price_cents or the budget_*_cents family.
      if (userRole === 'client' || userRole === 'agency' || userRole === 'enterprise') {
        const { data } = await supabase.from('jobs').select(BUYER_JOB_FIELDS).eq('client_id', user.id).order('created_at', { ascending: false });
        const all = (data ?? []) as any[];
        setStats({ active: all.filter(j => ['assigned', 'in_progress'].includes(j.status)).length, pending: all.filter(j => ['open', 'pending'].includes(j.status)).length, completed: all.filter(j => j.status === 'completed').length });
        setMyJobs(filter === 'all' ? all : all.filter(j => filter === 'active' ? ['assigned', 'in_progress'].includes(j.status) : filter === 'pending' ? ['open', 'pending'].includes(j.status) : j.status === 'completed'));
      } else {
        const { data: assignedJobs } = await supabase.from('jobs').select(INSPECTOR_JOB_FIELDS).eq('contractor_id', user.id).order('created_at', { ascending: false });
        const allAssigned = (assignedJobs ?? []) as any[];

        const { data: appsData } = await supabase.from('applications').select('job_id').eq('applicant_id', user.id);
        const uniquePendingJobIds = [...new Set((appsData || []).map(a => a.job_id))];
        setAppliedJobIds(uniquePendingJobIds);

        let pendingJobsData: any[] = [];
        if (uniquePendingJobIds.length > 0) {
          const { data: pJobs } = await supabase.from('jobs').select(INSPECTOR_JOB_FIELDS).in('id', uniquePendingJobIds);
          if (pJobs) pendingJobsData = (pJobs as any[]).map(j => ({ ...j, status: 'pending' }));
        }

        const actualPendingJobs = pendingJobsData.filter(p => !allAssigned.some(a => a.id === p.id));

        let combinedJobs = [];
        if (filter === 'active') combinedJobs = allAssigned.filter(j => ['assigned', 'in_progress'].includes(j.status));
        else if (filter === 'completed') combinedJobs = allAssigned.filter(j => j.status === 'completed');
        else if (filter === 'pending') combinedJobs = actualPendingJobs;
        else combinedJobs = [...actualPendingJobs, ...allAssigned].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        const finalJobs = Array.from(new Map(combinedJobs.map(item => [item.id, item])).values());
        setStats({ active: allAssigned.filter(j => ['assigned', 'in_progress'].includes(j.status)).length, pending: actualPendingJobs.length, completed: allAssigned.filter(j => j.status === 'completed').length });
        setMyJobs(finalJobs);
      }
    } catch (err) { console.error('Error fetching my jobs:', err); } finally { setMyWorkLoading(false); }
  }, [user?.id, userRole, filter]);

  // Discover is owned by useDiscoverJobs (auto-refetches on cityQuery/
  // radius/homeBase changes). On focus we only need to re-pull My Work.
  useFocusEffect( useCallback(() => { if(!roleLoading) { fetchMyJobs(); refreshDiscover(); } }, [fetchMyJobs, refreshDiscover, roleLoading]) );
  useEffect(() => { if(!roleLoading) { fetchMyJobs(); } }, [filter, fetchMyJobs, roleLoading]);

  const currentRawJobs = activeTab === 0 ? discoverJobs : myJobs;
  
  const availableLocations = useMemo(() => {
    const locs = new Set<string>();
    currentRawJobs.forEach(job => {
      const loc = job.location || [job.city, job.state, job.country].filter(Boolean).join(', ');
      if (loc && loc !== 'No location') locs.add(loc);
    });
    return Array.from(locs).sort();
  }, [currentRawJobs]);

  const availableTypes = useMemo(() => {
    const types = new Set<string>();
    currentRawJobs.forEach(job => {
      if (job.job_type) types.add(job.job_type);
      else if (job.inspection_type) types.add(job.inspection_type);
    });
    return Array.from(types).sort();
  }, [currentRawJobs]);

  const unifiedFilterChips = useMemo(() => {
    const chips: { category: string; value: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [];
    availableLocations.forEach(loc => { chips.push({ category: 'location', value: loc, label: loc, icon: 'location-outline' }); });
    availableTypes.forEach(t => { chips.push({ category: 'type', value: t, label: t, icon: 'construct-outline' }); });
    return chips;
  }, [availableLocations, availableTypes]);

  const filteredDiscoverJobs = useMemo(() => {
    return discoverJobs.filter(job => {
      const loc = job.location || [job.city, job.state, job.country].filter(Boolean).join(', ');
      const type = job.job_type || job.inspection_type;
      
      const matchLoc = selectedLocations.length === 0 || selectedLocations.includes(loc);
      const matchType = selectedTypes.length === 0 || selectedTypes.includes(type);
      
      const q = searchQuery.toLowerCase();
      const locString = loc.toLowerCase();
      const titleString = (job.title || '').toLowerCase();
      const matchSearch = !searchQuery || locString.includes(q) || titleString.includes(q);
      
      return matchLoc && matchType && matchSearch;
    });
  }, [discoverJobs, selectedLocations, selectedTypes, searchQuery]);

  const filteredMyJobs = useMemo(() => {
    return myJobs.filter(job => {
      const loc = job.location || [job.city, job.state, job.country].filter(Boolean).join(', ');
      const type = job.job_type || job.inspection_type;
      
      const matchLoc = selectedLocations.length === 0 || selectedLocations.includes(loc);
      const matchType = selectedTypes.length === 0 || selectedTypes.includes(type);
      
      const q = searchQuery.toLowerCase();
      const locString = loc.toLowerCase();
      const titleString = (job.title || '').toLowerCase();
      const matchSearch = !searchQuery || locString.includes(q) || titleString.includes(q);
      
      return matchLoc && matchType && matchSearch;
    });
  }, [myJobs, selectedLocations, selectedTypes, searchQuery]);

  const discoverMapJobs = useMemo( () => filteredDiscoverJobs.filter( (j) => j.latitude != null && j.longitude != null, ), [filteredDiscoverJobs] );
  const myMapJobs = useMemo( () => filteredMyJobs.filter( (j) => j.latitude != null && j.longitude != null, ), [filteredMyJobs] );

  useEffect(() => {
    const mapData = activeTab === 0 ? discoverMapJobs : myMapJobs;
    if (mapData.length > 0 && mapRef.current) {
      const coords = mapData.map((j: any) => ({ latitude: j.latitude, longitude: j.longitude }));
      setTimeout(() => { mapRef.current?.fitToCoordinates(coords, { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }); }, 500);
    }
  }, [discoverMapJobs, myMapJobs, activeTab]);

  const handleViewDetails = async (jobId: string) => {
    try {
      if (userRole === 'client' || userRole === 'agency' || userRole === 'enterprise') { router.push(`/(tabs)/jobs/${jobId}`); } 
      else { router.push(`/(inspector)/jobs/${jobId}`); }
    } catch (err) { console.error('Nav Error:', err); }
  };

  const isClientSide =
    userRole === 'client' || userRole === 'agency' || userRole === 'enterprise';

  const handleToggleFilter = useCallback((category: string, value: string) => {
    if (category === 'location') { setSelectedLocations(prev => prev.includes(value) ? prev.filter(l => l !== value) : [...prev, value]); } 
    else if (category === 'type') { setSelectedTypes(prev => prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value]); } 
  }, []);

  const handleClearFilters = useCallback(() => {
    setSelectedLocations([]); setSelectedTypes([]); setSearchQuery('');
    // ★ Phase 5 — also clear the server-side city query and any session
    //   radius override so "Clear" truly returns the feed to defaults.
    setCityQuery('');
    setRadiusOverride(undefined);
  }, [setCityQuery, setRadiusOverride]);

  // ★ Phase 5 — keep local searchQuery state in sync with the hook's
  //   debounced cityQuery. Local copy drives the My Work client filter
  //   and the snappy in-input visuals; cityQuery drives the RPC.
  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    setCityQuery(text);
  }, [setCityQuery]);

  // ★ Phase 5 — radius pill handlers
  const handleOpenRadiusSheet = useCallback(() => setRadiusSheetVisible(true), []);
  const handleCloseRadiusSheet = useCallback(() => setRadiusSheetVisible(false), []);
  const handleSelectRadius = useCallback(
    (km: number | null) => setRadiusOverride(km),
    [setRadiusOverride],
  );

  const hasFilters = selectedLocations.length > 0 || selectedTypes.length > 0 || searchQuery.length > 0;

  // 🌟 COMPACT, REAL UNIFIED HEADER (Inside ListHeaderComponent)
  // ★ Phase 5 — On the Discover tab, prepends a "Within X km" pill that
  //   opens the RadiusPickerSheet. Pill is hidden on My Work since
  //   proximity sorting only applies to the discovery feed.
  const isDiscoverTab = activeTab === 0 && !isClientSide;
  const radiusPillLabel = formatRadiusLabel(effectiveRadiusKm);
  const radiusPillActive = effectiveRadiusKm !== null; // null = Unlimited (default-ish)
  const UnifiedFilterHeader = useMemo(() => {
    // On Discover we always render (for the radius pill). Elsewhere only
    // when there's something to show.
    if (!isDiscoverTab && unifiedFilterChips.length === 0 && !searchQuery) return null;

    return (
      <View style={st.unifiedHeaderWrap}>
        <View style={st.unifiedSearchRow}>
          <View style={st.searchContainer}>
            <Ionicons name="search" size={16} color={COLORS.textMuted} style={{ marginRight: 6 }} />
            <TextInput
              style={st.searchInput}
              placeholder={isDiscoverTab ? "Search city, region, or job title…" : "Search location or title..."}
              placeholderTextColor={COLORS.textMuted}
              value={searchQuery}
              onChangeText={handleSearchChange}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => handleSearchChange('')} style={{ padding: 4 }}>
                <Ionicons name="close-circle" size={16} color={COLORS.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          {hasFilters && (
            <TouchableOpacity style={st.clearMiniBtn} onPress={handleClearFilters} activeOpacity={0.7}>
              <Text style={st.clearMiniBtnText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        {(isDiscoverTab || unifiedFilterChips.length > 0) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.unifiedChipsScroll}>
            {/* ★ Phase 5 — Radius pill. Always first, Discover only. */}
            {isDiscoverTab && (
              <TouchableOpacity
                style={[st.radiusPill, radiusPillActive && st.radiusPillActive]}
                onPress={handleOpenRadiusSheet}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={radiusPillActive ? "locate" : "infinite"}
                  size={13}
                  color={radiusPillActive ? '#FFF' : COLORS.primaryLight}
                  style={{ marginRight: 6 }}
                />
                <Text style={[st.radiusPillText, radiusPillActive && st.radiusPillTextActive]}>
                  {effectiveRadiusKm === null ? 'Unlimited' : `Within ${effectiveRadiusKm} km`}
                </Text>
                <Ionicons
                  name="chevron-down"
                  size={12}
                  color={radiusPillActive ? '#FFF' : COLORS.primaryLight}
                  style={{ marginLeft: 4 }}
                />
              </TouchableOpacity>
            )}
            {unifiedFilterChips.map(chip => {
              let isActive = false;
              if (chip.category === 'location') isActive = selectedLocations.includes(chip.value);
              else if (chip.category === 'type') isActive = selectedTypes.includes(chip.value);

              return (
                <AnimatedFilterPill
                  key={`${chip.category}-${chip.value}`}
                  label={chip.label}
                  icon={chip.icon}
                  active={isActive}
                  onPress={() => handleToggleFilter(chip.category, chip.value)}
                />
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  }, [unifiedFilterChips, searchQuery, selectedLocations, selectedTypes, hasFilters, isDiscoverTab, effectiveRadiusKm, radiusPillActive, handleOpenRadiusSheet, handleSearchChange, handleClearFilters, handleToggleFilter]);

  const DiscoverListHeader = useMemo(() => (
    <View style={{ paddingTop: 10 }}>
      {UnifiedFilterHeader}
      <View style={st.resultsCountWrap}>
        <Text style={st.resultsCountText}>{filteredDiscoverJobs.length} {filteredDiscoverJobs.length === 1 ? 'job' : 'jobs'} found</Text>
      </View>
    </View>
  ), [UnifiedFilterHeader, filteredDiscoverJobs.length]);

  const MyWorkListHeader = useMemo( () => (
      <View style={st.myWorkListHeader}>
        {/*
          Pipeline — surfaces jobs/applications/contracts that paused while
          waiting on someone (you, the other party, or NEXPEC moderation).
          Self-suppresses when nothing is pending. Lives ABOVE the existing
          stats + filter row so nothing else in the layout shifts. No new
          tabs / nav entries — strictly additive per UX directive (2026-05-20).
        */}
        <PipelineSection userId={user?.id ?? null} userRole={userRole} />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.statsRow}>
          <StatsCard icon="play-circle" label="Active" count={stats.active} color={COLORS.blue} bg={COLORS.blueBg} onPress={() => setFilter(filter === 'active' ? 'all' : 'active')} active={filter === 'active'} />
          <StatsCard icon="time" label="Pending" count={stats.pending} color={COLORS.amber} bg={COLORS.amberBg} onPress={() => setFilter(filter === 'pending' ? 'all' : 'pending')} active={filter === 'pending'} />
          <StatsCard icon="checkmark-circle" label="Completed" count={stats.completed} color={COLORS.green} bg={COLORS.greenBg} onPress={() => setFilter(filter === 'completed' ? 'all' : 'completed') } active={filter === 'completed'} />
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow}>
          {['all', 'active', 'pending', 'completed'].map((f) => ( <FilterChip key={f} label={f.charAt(0).toUpperCase() + f.slice(1)} active={filter === f} onPress={() => setFilter(f)} /> ))}
        </ScrollView>
        <View style={{ marginTop: 6 }}>
          {UnifiedFilterHeader}
          <View style={st.resultsCountWrap}>
             <Text style={st.resultsCountText}>{filteredMyJobs.length} {filteredMyJobs.length === 1 ? 'job' : 'jobs'} found</Text>
          </View>
        </View>
      </View>
    ), [filter, stats, UnifiedFilterHeader, filteredMyJobs.length, user?.id, userRole] );

  if (roleLoading) {
    return <SafeAreaView style={[st.container, { justifyContent: 'center' }]}><ActivityIndicator size="large" color={COLORS.primary}/></SafeAreaView>;
  }

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={st.header}><Text style={st.headerTitle}>{isClientSide ? 'My Projects' : 'Jobs'}</Text></View>
      
      {!isClientSide && <SegmentedControl activeIndex={activeTab} onChange={setActiveTab} />}
      
      {/* 🔴 INSPECTOR DISCOVER VIEW (STANDARD FLEX SPLIT) */}
      {!isClientSide && activeTab === 0 && (
        <View style={st.discoverContainer}>
          <View style={st.mapContainer}>
            {discoverLoading ? <ActivityIndicator size="large" color={COLORS.primary} style={{marginTop: 50}}/> : (
              <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={DEFAULT_REGION} clusterColor={COLORS.primary} clusterTextColor="#FFF">
                {discoverMapJobs.map((job) => ( <Marker key={job.id} identifier={job.id} coordinate={{ latitude: job.latitude, longitude: job.longitude }} onPress={() => setSelectedJobId(job.id)}><PriceMarker amount={(job.payout_amount_cents || 0) / 100} selected={selectedJobId === job.id} /></Marker> ))}
              </MapView>
            )}
          </View>
          <View style={st.listContainer}>
            <FlatList 
              ref={flatListRef} 
              data={filteredDiscoverJobs} 
              extraData={appliedJobIds} 
              ListHeaderComponent={DiscoverListHeader} 
              renderItem={({ item }) => (
                <DiscoverJobCard
                  job={item}
                  selected={selectedJobId === item.id}
                  onPress={() => setSelectedJobId(item.id)}
                  onAccept={() => handleViewDetails(item.id)}
                  router={router}
                  // ★ Phase 5 — server-side has_applied wins; fall back to
                  //   the legacy appliedJobIds array for cached/optimistic UI.
                  hasApplied={!!item.has_applied || appliedJobIds.includes(item.id)}
                />
              )}
              keyExtractor={(item) => item.id} 
              contentContainerStyle={st.listContent} 
              showsVerticalScrollIndicator={false} 
              ListEmptyComponent={() => (
                <View style={st.emptyWrap}>
                  <View style={st.emptyIconWrap}><Ionicons name="search-outline" size={32} color={COLORS.primary} /></View>
                  <Text style={st.emptyTitle}>No Matches Found</Text>
                  <Text style={st.emptySub}>Try clearing your filters to see more jobs.</Text>
                </View>
              )}
            />
          </View>
        </View>
      )}

      {/* 🔵 CLIENT AND INSPECTOR "MY WORK" VIEW (STANDARD FLEX SPLIT) */}
      {(isClientSide || activeTab === 1) && (
        <View style={isClientSide ? st.discoverContainer : { flex: 1 }}>
          {isClientSide && (
            <View style={st.mapContainer}>
              {myWorkLoading ? <ActivityIndicator size="large" color={COLORS.primary} style={{marginTop: 50}}/> : (
                <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={DEFAULT_REGION} clusterColor={COLORS.primary} clusterTextColor="#FFF">
                  {myMapJobs.map((job) => ( 
                    <Marker key={job.id} identifier={job.id} coordinate={{ latitude: job.latitude, longitude: job.longitude }} onPress={() => setSelectedJobId(job.id)}>
                      <PriceMarker amount={(job.client_price_cents || 0) / 100} selected={selectedJobId === job.id} />
                    </Marker> 
                  ))}
                </MapView>
              )}
            </View>
          )}
          <View style={isClientSide ? st.listContainer : { flex: 1 }}>
            {myWorkLoading ? <ActivityIndicator size="large" color={COLORS.primary} style={{marginTop: 50}}/> : (
              <FlatList 
                data={filteredMyJobs} 
                renderItem={({item}) => <MyWorkJobCard job={item} onPress={() => handleViewDetails(item.id)} onGeneratePDF={() => {}} isGeneratingPDF={false} isClient={isClientSide} />} 
                keyExtractor={(item) => item.id} 
                ListHeaderComponent={MyWorkListHeader} 
                contentContainerStyle={st.listContent} 
                showsVerticalScrollIndicator={false} 
                ListEmptyComponent={() => (
                  <View style={st.emptyWrap}>
                    <View style={st.emptyIconWrap}><Ionicons name="folder-open-outline" size={32} color={COLORS.primary} /></View>
                    <Text style={st.emptyTitle}>No Projects Yet</Text>
                    <Text style={st.emptySub}>No jobs found in this category.</Text>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      )}

      {/* ★ Phase 5 — Radius override sheet. Inspector-only, session-scoped
          (does NOT persist to profile). Shared component with the profile
          Discovery Preferences card. */}
      {!isClientSide && (
        <RadiusPickerSheet
          visible={radiusSheetVisible}
          currentRadiusKm={effectiveRadiusKm}
          homeBaseLabel={homeBase?.label ?? null}
          onSelect={handleSelectRadius}
          onClose={handleCloseRadiusSheet}
          subtitle={
            homeBase
              ? `Adjust for this session only — your profile default stays put.`
              : `Set your home base in Profile first so we know where to measure from.`
          }
        />
      )}
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background }, 
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 }, 
  headerTitle: { fontSize: 28, fontWeight: '800', color: COLORS.textPrimary, letterSpacing: -0.5 }, 
  segWrap: { paddingHorizontal: 20, paddingBottom: 12 }, 
  segControl: { flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 14, padding: 3, borderWidth: 1, borderColor: COLORS.border, position: 'relative' }, 
  segIndicator: { position: 'absolute', top: 3, left: 3, bottom: 3, borderRadius: 11, backgroundColor: COLORS.primary }, 
  segTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, gap: 6, zIndex: 1 }, 
  segLabel: { fontSize: 14, fontWeight: '600', color: COLORS.textMuted }, 
  segLabelActive: { color: '#FFF', fontWeight: '700' }, 
  
  // STANDARD LAYOUT REVERTED (Flex Split)
  discoverContainer: { flex: 1 }, 
  mapContainer: { flex: 4, backgroundColor: COLORS.surface, overflow: 'hidden' }, 
  listContainer: { flex: 6, backgroundColor: COLORS.background }, 
  listContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 100 }, 

  markerBubble: { backgroundColor: COLORS.surface, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1.5, borderColor: COLORS.border }, 
  markerBubbleSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primaryLight }, 
  markerText: { fontSize: 12, fontWeight: '800', color: COLORS.textPrimary }, 
  markerTextSelected: { color: '#FFF' }, 
  markerArrow: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: COLORS.border, marginTop: -1 }, 
  markerArrowSelected: { borderTopColor: COLORS.primary }, 
  discoverCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border }, 
  discoverCardSelected: { borderColor: COLORS.primary }, 
  discoverTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }, 
  discoverTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 }, 
  discoverLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  discoverAddress: { fontSize: 13, color: COLORS.textMuted, flexShrink: 1 },
  // ★ Phase 5 — distance chip (sits inline after the location text).
  discoverDistSep: { fontSize: 13, color: COLORS.textMuted, paddingHorizontal: 4 },
  discoverDistText: { fontSize: 12, color: COLORS.primaryLight, fontWeight: '700', letterSpacing: 0.2 },
  discoverBudgeBadge: { backgroundColor: COLORS.greenBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, marginLeft: 10 }, 
  discoverBudgeText: { fontSize: 15, fontWeight: '800', color: COLORS.green }, 
  discoverTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }, 
  discoverTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surfaceLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }, 
  discoverTagText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary }, 
  discoverBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 }, 
  discoverDate: { fontSize: 12, color: COLORS.textMuted }, 
  
  statsRow: { paddingHorizontal: 0, paddingBottom: 10, gap: 10 }, 
  statsCard: { width: 110, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.border }, 
  statsIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 }, 
  statsCount: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary }, 
  statsLabel: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 }, 
  filterRow: { paddingHorizontal: 0, paddingBottom: 10, gap: 8 }, 
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }, 
  filterChipActive: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: COLORS.primaryBg, borderWidth: 1, borderColor: COLORS.primary }, 
  filterChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted }, 
  filterChipTextActive: { fontSize: 13, fontWeight: '600', color: COLORS.primary }, 
  myWorkListHeader: { paddingTop: 10 },
  myJobCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: COLORS.border }, 
  myJobTopRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }, 
  myJobTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 }, 
  myJobLocRow: { flexDirection: 'row', alignItems: 'center', gap: 4 }, 
  myJobAddress: { fontSize: 13, color: COLORS.textMuted, flex: 1 }, 
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, gap: 4, marginLeft: 10 }, 
  statusBadgeText: { fontSize: 11, fontWeight: '700' }, 
  myJobDetailRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }, 
  myJobDetailChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COLORS.surfaceLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }, 
  myJobDetailText: { fontSize: 12, fontWeight: '600', color: COLORS.textSecondary }, 
  myJobActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 12 }, 
  myJobDateText: { fontSize: 12, color: COLORS.textMuted }, 
  myJobBtnRow: { flexDirection: 'row', gap: 8 }, 
  pdfBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: COLORS.primaryBg, gap: 4, minWidth: 60, justifyContent: 'center' }, 
  pdfBtnText: { fontSize: 12, fontWeight: '700', color: COLORS.primary }, 
  viewBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: COLORS.primary, gap: 4 }, 
  viewBtnText: { fontSize: 12, fontWeight: '700', color: '#FFF' }, 
  emptyWrap: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 32 }, 
  emptyIconWrap: { width: 80, height: 80, borderRadius: 20, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: COLORS.border }, 
  emptyTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 6 }, 
  emptySub: { fontSize: 14, color: COLORS.textMuted, textAlign: 'center', lineHeight: 20, marginBottom: 20 }, 
  emptyBtn: { paddingHorizontal: 20, paddingVertical: 11, borderRadius: 12, backgroundColor: COLORS.primary }, 
  emptyBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' },

  // 🌟 ULTRA-COMPACT UNIFIED FILTER STYLES 🌟
  unifiedHeaderWrap: { paddingBottom: 8 },
  unifiedSearchRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  searchContainer: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 20, height: 38, paddingHorizontal: 12 },
  searchInput: { flex: 1, color: COLORS.textPrimary, fontSize: 13, height: '100%' },
  clearMiniBtn: { marginLeft: 10, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: COLORS.redBg, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(239, 68, 68, 0.3)' },
  clearMiniBtnText: { color: COLORS.red, fontSize: 12, fontWeight: '700' },
  unifiedChipsScroll: { gap: 8 },
  
  dynPill: { borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, minHeight: 32, justifyContent: 'center' },
  dynPillContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, zIndex: 1 },
  dynPillText: { fontSize: 12, fontWeight: '600', color: COLORS.textMuted },
  dynPillTextActive: { color: '#FFF', fontWeight: '700' },
  // ★ Phase 5 — Radius override pill (Discover-only, first in row).
  //   Distinguished from filter pills by primary-purple border to signal
  //   "preference" not "filter". Active fill = finite radius is set.
  radiusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primaryBg,
    minHeight: 32,
  },
  radiusPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  radiusPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primaryLight,
    letterSpacing: 0.2,
  },
  radiusPillTextActive: { color: '#FFF' },

  resultsCountWrap: { paddingBottom: 10, marginTop: 4 },
  resultsCountText: { fontSize: 12, fontWeight: '700', color: COLORS.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
});