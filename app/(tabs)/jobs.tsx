import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Platform, Dimensions, FlatList, Animated, StatusBar, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import MapView from 'react-native-map-clustering';
import { Marker, Region } from 'react-native-maps';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../src/contexts/AuthContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLORS = { background: '#020420', surface: '#0F172A', surfaceLight: '#1E293B', border: '#1F2937', primary: '#7C3AED', primaryLight: '#8B5CF6', primaryBg: 'rgba(124, 58, 237, 0.12)', blue: '#3B82F6', blueBg: 'rgba(59, 130, 246, 0.12)', green: '#10B981', greenBg: 'rgba(16, 185, 129, 0.12)', red: '#EF4444', redBg: 'rgba(239, 68, 68, 0.12)', amber: '#F59E0B', amberBg: 'rgba(245, 158, 11, 0.12)', cyan: '#06B6D4', cyanBg: 'rgba(6, 182, 212, 0.12)', white: '#F8FAFC', textPrimary: '#F1F5F9', textSecondary: '#94A3B8', textMuted: '#64748B' };
const DEFAULT_REGION: Region = { latitude: 39.8283, longitude: -98.5795, latitudeDelta: 40, longitudeDelta: 40 };
const TABS = [ { key: 'discover', label: 'Discover', icon: 'compass-outline' as const }, { key: 'mywork', label: 'My Work', icon: 'briefcase-outline' as const } ];
type ViewMode = 'work' | 'postings';

const formatDate = (dateStr: string) => { const d = new Date(dateStr); const diffMins = Math.floor((new Date().getTime() - d.getTime()) / 60000); if (diffMins < 1) return 'Just now'; if (diffMins < 60) return `${diffMins}m ago`; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const getJobStatusConfig = (status: string) => { switch (status) { case 'assigned': case 'in_progress': return { label: 'Active', color: COLORS.blue, bg: COLORS.blueBg, icon: 'play-circle' as const }; case 'pending': return { label: 'Pending', color: COLORS.amber, bg: COLORS.amberBg, icon: 'time' as const }; case 'completed': return { label: 'Completed', color: COLORS.green, bg: COLORS.greenBg, icon: 'checkmark-circle' as const }; case 'cancelled': return { label: 'Cancelled', color: COLORS.red, bg: COLORS.redBg, icon: 'close-circle' as const }; case 'open': return { label: 'Open', color: COLORS.cyan, bg: COLORS.cyanBg, icon: 'radio-button-on' as const }; default: return { label: status, color: COLORS.textMuted, bg: 'rgba(100,116,139,0.12)', icon: 'ellipse' as const }; } };

const SegmentedControl: React.FC<{ activeIndex: number; onChange: (i: number) => void; }> = React.memo(({ activeIndex, onChange }) => {
  const slideAnim = useRef(new Animated.Value(0)).current; const segmentW = (SCREEN_WIDTH - 40) / 2;
  useEffect(() => { Animated.spring(slideAnim, { toValue: activeIndex * segmentW, tension: 68, friction: 12, useNativeDriver: true }).start(); }, [activeIndex, segmentW]);
  return ( <View style={st.segWrap}><View style={st.segControl}><Animated.View style={[st.segIndicator, { width: segmentW, transform: [{ translateX: slideAnim }] }]} />{TABS.map((tab, idx) => ( <TouchableOpacity key={tab.key} style={st.segTab} onPress={() => onChange(idx)} activeOpacity={0.7}><Ionicons name={tab.icon} size={16} color={activeIndex === idx ? '#FFF' : COLORS.textMuted} /><Text style={[st.segLabel, activeIndex === idx && st.segLabelActive]}>{tab.label}</Text></TouchableOpacity> ))}</View></View> );
});

const PriceMarker: React.FC<{ budget: number; selected: boolean; }> = React.memo(({ budget, selected }) => ( <View style={{ alignItems: 'center' }}><View style={[st.markerBubble, selected && st.markerBubbleSelected]}><Text style={[st.markerText, selected && st.markerTextSelected]}>${Math.round(budget)}</Text></View><View style={[st.markerArrow, selected && st.markerArrowSelected]} /></View> ));

const DiscoverJobCard: React.FC<{ job: any; selected: boolean; onPress: () => void; onAccept: () => void; }> = React.memo(({ job, selected, onPress, onAccept }) => (
  <TouchableOpacity style={[st.discoverCard, selected && st.discoverCardSelected]} onPress={onPress} activeOpacity={0.85}>
    <View style={st.discoverTop}><View style={{ flex: 1 }}><Text style={st.discoverTitle} numberOfLines={1}>{job.title || 'Untitled Job'}</Text><View style={st.discoverLocRow}><Ionicons name="location-outline" size={13} color={COLORS.textMuted} /><Text style={st.discoverAddress} numberOfLines={1}>{job.location || [job.city, job.state].filter(Boolean).join(', ') || 'No location'}</Text></View></View><View style={st.discoverBudgeBadge}><Text style={st.discoverBudgeText}>${(job.budget || 0).toFixed(0)}</Text></View></View>
    <View style={st.discoverTagRow}><View style={[st.discoverTag, { backgroundColor: COLORS.greenBg }]}><Text style={[st.discoverTagText, { color: COLORS.green }]}>Open</Text></View></View>
    <View style={st.discoverBottom}><Text style={st.discoverDate}>Posted {formatDate(job.created_at)}</Text><TouchableOpacity style={st.acceptBtn} onPress={(e) => { e.stopPropagation?.(); onAccept(); }} activeOpacity={0.8}><Ionicons name="checkmark-circle" size={15} color="#FFF" /><Text style={st.acceptBtnText}>Accept</Text></TouchableOpacity></View>
  </TouchableOpacity>
));

const StatsCard: React.FC<{ icon: keyof typeof Ionicons.glyphMap; label: string; count: number; color: string; bg: string; onPress: () => void; active: boolean; }> = React.memo(({ icon, label, count, color, bg, onPress, active }) => ( <TouchableOpacity style={[st.statsCard, active && { borderColor: color }]} onPress={onPress} activeOpacity={0.7}><View style={[st.statsIcon, { backgroundColor: bg }]}><Ionicons name={icon} size={18} color={color} /></View><Text style={st.statsCount}>{count}</Text><Text style={st.statsLabel}>{label}</Text></TouchableOpacity> ));
const FilterChip: React.FC<{ label: string; active: boolean; onPress: () => void; }> = React.memo(({ label, active, onPress }) => ( <TouchableOpacity style={[st.filterChip, active && st.filterChipActive]} onPress={onPress} activeOpacity={0.7}><Text style={[st.filterChipText, active && st.filterChipTextActive]}>{label}</Text></TouchableOpacity> ));

const MyWorkJobCard: React.FC<{ job: any; onPress: () => void; onGeneratePDF: () => void; isGeneratingPDF: boolean; }> = React.memo(({ job, onPress, onGeneratePDF, isGeneratingPDF }) => {
  const cfg = getJobStatusConfig(job.status);
  return (
    <TouchableOpacity style={st.myJobCard} onPress={onPress} activeOpacity={0.85}>
      <View style={st.myJobTopRow}><View style={{ flex: 1 }}><Text style={st.myJobTitle} numberOfLines={1}>{job.title || 'Untitled Job'}</Text><View style={st.myJobLocRow}><Ionicons name="location-outline" size={13} color={COLORS.textMuted} /><Text style={st.myJobAddress} numberOfLines={1}>{job.location || [job.city, job.state].filter(Boolean).join(', ') || 'No location'}</Text></View></View><View style={[st.statusBadge, { backgroundColor: cfg.bg }]}><Ionicons name={cfg.icon} size={12} color={cfg.color} /><Text style={[st.statusBadgeText, { color: cfg.color }]}>{cfg.label}</Text></View></View>
      <View style={st.myJobActions}><Text style={st.myJobDateText}>Created {formatDate(job.created_at)}</Text><View style={st.myJobBtnRow}><TouchableOpacity style={st.pdfBtn} onPress={onGeneratePDF} disabled={isGeneratingPDF} activeOpacity={0.7}>{isGeneratingPDF ? ( <ActivityIndicator size="small" color={COLORS.primary} /> ) : ( <><Ionicons name="document-text-outline" size={14} color={COLORS.primary} /><Text style={st.pdfBtnText}>PDF</Text></> )}</TouchableOpacity><TouchableOpacity style={st.viewBtn} onPress={onPress} activeOpacity={0.7}><Text style={st.viewBtnText}>View</Text><Ionicons name="chevron-forward" size={14} color="#FFF" /></TouchableOpacity></View></View>
    </TouchableOpacity>
  );
});

export default function JobsScreen() {
  const router = useRouter(); const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(0); 
  const [discoverJobs, setDiscoverJobs] = useState<any[]>([]); const [discoverLoading, setDiscoverLoading] = useState(true); const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const mapRef = useRef<any>(null); const flatListRef = useRef<FlatList>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('work'); const [filter, setFilter] = useState('all'); const [myJobs, setMyJobs] = useState<any[]>([]); const [myWorkLoading, setMyWorkLoading] = useState(true); const [stats, setStats] = useState({ active: 0, pending: 0, completed: 0 }); const [generatingPDF, setGeneratingPDF] = useState<string | null>(null);
  const discoverMapJobs = useMemo( () => discoverJobs.filter( (j) => j.latitude != null && j.longitude != null, ), [discoverJobs] );

  const fetchDiscoverJobs = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase.from('jobs').select('*').eq('status', 'open').is('contractor_id', null).order('created_at', { ascending: false });
      if (error) throw error; setDiscoverJobs(data || []);
      if (data && data.length > 0 && mapRef.current) {
        const coords = data.filter((j: any) => j.latitude != null && j.longitude != null).map((j: any) => ({ latitude: j.latitude, longitude: j.longitude }));
        if (coords.length > 0) { setTimeout(() => { mapRef.current?.fitToCoordinates(coords, { edgePadding: { top: 60, right: 60, bottom: 60, left: 60 }, animated: true }); }, 500); }
      }
    } catch (err) { console.error('Error fetching discover jobs:', err); }
  }, [user?.id]);

  const fetchMyJobs = useCallback(async () => {
    if (!user?.id) return; setMyWorkLoading(true);
    try {
      let query = supabase.from('jobs').select('*').order('created_at', { ascending: false });
      if (viewMode === 'work') { query = query.eq('contractor_id', user.id); } else { query = query.eq('poster_id', user.id); }
      if (filter !== 'all') { if (filter === 'active') { query = query.in('status', ['assigned', 'in_progress']); } else { query = query.eq('status', filter); } }
      const { data, error } = await query; if (error) throw error; setMyJobs(data || []);
      const { data: allJobs } = await supabase.from('jobs').select('status').eq(viewMode === 'work' ? 'contractor_id' : 'poster_id', user.id);
      if (allJobs) { setStats({ active: allJobs.filter((j) => ['assigned', 'in_progress'].includes(j.status)).length, pending: allJobs.filter((j) => j.status === 'pending').length, completed: allJobs.filter((j) => j.status === 'completed').length }); }
    } catch (err) { console.error('Error fetching my jobs:', err); } finally { setMyWorkLoading(false); }
  }, [user?.id, viewMode, filter]);

  useFocusEffect( useCallback(() => { fetchDiscoverJobs().finally(() => setDiscoverLoading(false)); fetchMyJobs(); }, [fetchDiscoverJobs, fetchMyJobs]) );
  useEffect(() => { fetchMyJobs(); }, [viewMode, filter, fetchMyJobs]);

  const handleAcceptJob = async (jobId: string) => {
    try { const { error } = await supabase.from('jobs').update({ status: 'assigned', contractor_id: user?.id }).eq('id', jobId); if (error) throw error; Alert.alert('Success', 'Job accepted!'); fetchDiscoverJobs(); } catch (err) { Alert.alert('Error', 'Failed to accept job.'); }
  };

  const MyWorkListHeader = useMemo( () => (
      <View style={st.myWorkListHeader}>
        <View style={st.viewModeWrap}>
          <TouchableOpacity style={[st.viewModeBtn, viewMode === 'work' && st.viewModeBtnActive]} onPress={() => setViewMode('work')} activeOpacity={0.7}><Text style={[ st.viewModeText, viewMode === 'work' && st.viewModeTextActive ]}>My Work</Text></TouchableOpacity>
          <TouchableOpacity style={[ st.viewModeBtn, viewMode === 'postings' && st.viewModeBtnActive ]} onPress={() => setViewMode('postings')} activeOpacity={0.7}><Text style={[ st.viewModeText, viewMode === 'postings' && st.viewModeTextActive ]}>My Postings</Text></TouchableOpacity>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.statsRow}>
          <StatsCard icon="play-circle" label="Active" count={stats.active} color={COLORS.blue} bg={COLORS.blueBg} onPress={() => setFilter(filter === 'active' ? 'all' : 'active')} active={filter === 'active'} />
          <StatsCard icon="time" label="Pending" count={stats.pending} color={COLORS.amber} bg={COLORS.amberBg} onPress={() => setFilter(filter === 'pending' ? 'all' : 'pending')} active={filter === 'pending'} />
          <StatsCard icon="checkmark-circle" label="Completed" count={stats.completed} color={COLORS.green} bg={COLORS.greenBg} onPress={() => setFilter(filter === 'completed' ? 'all' : 'completed') } active={filter === 'completed'} />
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.filterRow}>
          {['all', 'active', 'pending', 'completed'].map((f) => ( <FilterChip key={f} label={f.charAt(0).toUpperCase() + f.slice(1)} active={filter === f} onPress={() => setFilter(f)} /> ))}
        </ScrollView>
      </View>
    ), [viewMode, filter, stats] );

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={st.header}><View><Text style={st.headerTitle}>Jobs</Text></View></View>
      <SegmentedControl activeIndex={activeTab} onChange={setActiveTab} />
      {activeTab === 0 && (
        <View style={st.discoverContainer}>
          <View style={st.mapContainer}>
            {discoverLoading ? <ActivityIndicator size="large" color={COLORS.primary} style={{marginTop: 50}}/> : (
              <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={DEFAULT_REGION} clusterColor={COLORS.primary} clusterTextColor="#FFF">
                {discoverMapJobs.map((job) => ( <Marker key={job.id} identifier={job.id} coordinate={{ latitude: job.latitude, longitude: job.longitude }} onPress={() => setSelectedJobId(job.id)}><PriceMarker budget={job.budget || 0} selected={selectedJobId === job.id} /></Marker> ))}
              </MapView>
            )}
          </View>
          <View style={st.listContainer}>
            <FlatList ref={flatListRef} data={discoverJobs} renderItem={({ item }) => <DiscoverJobCard job={item} selected={selectedJobId === item.id} onPress={() => setSelectedJobId(item.id)} onAccept={() => handleAcceptJob(item.id)} />} keyExtractor={(item) => item.id} contentContainerStyle={st.discoverListContent} showsVerticalScrollIndicator={false} />
          </View>
        </View>
      )}
      {activeTab === 1 && (
        <View style={{ flex: 1 }}>
          {myWorkLoading ? <ActivityIndicator size="large" color={COLORS.primary} style={{marginTop: 50}}/> : (
            <FlatList data={myJobs} renderItem={({item}) => <MyWorkJobCard job={item} onPress={() => router.push(`/jobs/${item.id}`)} onGeneratePDF={() => {}} isGeneratingPDF={false} />} keyExtractor={(item) => item.id} ListHeaderComponent={MyWorkListHeader} contentContainerStyle={st.myWorkListContent} showsVerticalScrollIndicator={false} />
          )}
        </View>
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
  discoverContainer: { flex: 1 }, 
  mapContainer: { flex: 4, backgroundColor: COLORS.surface, overflow: 'hidden' }, 
  listContainer: { flex: 6, backgroundColor: COLORS.background }, 
  discoverListContent: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 100 }, 
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
  discoverAddress: { fontSize: 13, color: COLORS.textMuted, flex: 1 }, 
  discoverBudgeBadge: { backgroundColor: COLORS.greenBg, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, marginLeft: 10 }, 
  discoverBudgeText: { fontSize: 15, fontWeight: '800', color: COLORS.green }, 
  discoverTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }, 
  discoverTag: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surfaceLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }, 
  discoverTagText: { fontSize: 11, fontWeight: '600', color: COLORS.textSecondary }, 
  discoverBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 }, 
  discoverDate: { fontSize: 12, color: COLORS.textMuted }, 
  acceptBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, gap: 5 }, 
  acceptBtnText: { fontSize: 13, fontWeight: '700', color: '#FFF' }, 
  viewModeWrap: { flexDirection: 'row', marginHorizontal: 16, marginTop: 4, marginBottom: 14, backgroundColor: COLORS.surface, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: COLORS.border }, 
  viewModeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 9, gap: 6 }, 
  viewModeBtnActive: { backgroundColor: COLORS.surfaceLight }, 
  viewModeText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted }, 
  viewModeTextActive: { color: COLORS.textPrimary }, 
  statsRow: { paddingHorizontal: 16, paddingBottom: 14, gap: 10 }, 
  statsCard: { width: 110, backgroundColor: COLORS.surface, borderRadius: 14, padding: 14, alignItems: 'center', borderWidth: 1.5, borderColor: COLORS.border }, 
  statsIcon: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginBottom: 8 }, 
  statsCount: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary }, 
  statsLabel: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 }, 
  filterRow: { paddingHorizontal: 16, paddingBottom: 14, gap: 8 }, 
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border }, 
  filterChipActive: { backgroundColor: COLORS.primaryBg, borderColor: COLORS.primary }, 
  filterChipText: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted }, 
  filterChipTextActive: { color: COLORS.primary }, 
  myWorkListContent: { paddingHorizontal: 16, paddingBottom: 100 }, 
  myWorkListHeader: { paddingHorizontal: 16, paddingTop: 10 },
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
  emptyBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF' }
});