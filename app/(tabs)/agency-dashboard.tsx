import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  StatusBar,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Plus,
  Briefcase,
  Clock,
  CheckCircle,
  ChevronRight,
  Building2,
  MapPin,
  Calendar,
} from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../src/contexts/AuthContext';

// ────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────
interface Job {
  id: string;
  title: string;
  status: string;
  location?: string;
  created_at: string;
  description?: string;
}

// ────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  open: '#F59E0B',
  assigned: '#3B82F6',
  in_progress: '#8B5CF6',
  completed: '#10B981',
  cancelled: '#EF4444',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const getStatusColor = (s: string) => STATUS_COLORS[s] ?? '#64748B';
const getStatusLabel = (s: string) => STATUS_LABELS[s] ?? s;

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

// ────────────────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────────────────
export default function AgencyDashboard() {
  const { user } = useAuth();
  const router = useRouter();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Post-job modal state
  const [showPostModal, setShowPostModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [posting, setPosting] = useState(false);

  // ── Fetch jobs ──────────────────────────────────────────
  const fetchJobs = useCallback(async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .eq('client_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setJobs(data ?? []);
    } catch (err: any) {
      console.error('[AgencyDashboard] fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchJobs();
  }, [fetchJobs]);

  // ── Post a job ──────────────────────────────────────────
  const handlePostJob = async () => {
    if (!newTitle.trim()) {
      Alert.alert('Required', 'Please enter a job title.');
      return;
    }
    setPosting(true);
    try {
      const { error } = await supabase.from('jobs').insert({
        client_id: user?.id,
        title: newTitle.trim(),
        description: newDescription.trim() || null,
        location: newLocation.trim() || null,
        status: 'open',
      });
      if (error) throw error;

      Alert.alert('Success', 'Contract job posted!');
      setNewTitle('');
      setNewDescription('');
      setNewLocation('');
      setShowPostModal(false);
      fetchJobs();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Could not post job.');
    } finally {
      setPosting(false);
    }
  };

  const resetModal = () => {
    setShowPostModal(false);
    setNewTitle('');
    setNewDescription('');
    setNewLocation('');
  };

  // ── Derived stats ───────────────────────────────────────
  const activeCount = jobs.filter((j) =>
    ['open', 'assigned', 'in_progress'].includes(j.status),
  ).length;
  const pendingCount = jobs.filter((j) => j.status === 'open').length;
  const completedCount = jobs.filter((j) => j.status === 'completed').length;

  // ── Render helpers ──────────────────────────────────────
  const renderJobItem = ({ item }: { item: Job }) => {
    const color = getStatusColor(item.status);
    return (
      <TouchableOpacity style={styles.jobCard} activeOpacity={0.7}>
        {/* Header row */}
        <View style={styles.jobHeader}>
          <View style={styles.jobTitleRow}>
            <Briefcase size={18} color="#7C3AED" />
            <Text style={styles.jobTitle} numberOfLines={1}>
              {item.title}
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: `${color}20` }]}>
            <View style={[styles.badgeDot, { backgroundColor: color }]} />
            <Text style={[styles.badgeText, { color }]}>{getStatusLabel(item.status)}</Text>
          </View>
        </View>

        {/* Description */}
        {!!item.description && (
          <Text style={styles.jobDesc} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        {/* Meta row */}
        <View style={styles.jobMeta}>
          {!!item.location && (
            <View style={styles.metaItem}>
              <MapPin size={14} color="#64748B" />
              <Text style={styles.metaText}>{item.location}</Text>
            </View>
          )}
          <View style={styles.metaItem}>
            <Calendar size={14} color="#64748B" />
            <Text style={styles.metaText}>{formatDate(item.created_at)}</Text>
          </View>
        </View>

        {/* Arrow */}
        <View style={styles.jobArrow}>
          <ChevronRight size={20} color="#64748B" />
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <Building2 size={64} color="#1E293B" />
      <Text style={styles.emptyTitle}>No Jobs Yet</Text>
      <Text style={styles.emptySub}>Post your first contract job to get started.</Text>
    </View>
  );

  const renderListHeader = () => (
    <View>
      {/* ── Greeting ────────────────────────────────── */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Agency Command Center</Text>
          <Text style={styles.subGreeting}>Manage your contract inspections</Text>
        </View>
        <View style={styles.headerIconWrap}>
          <Building2 size={28} color="#7C3AED" />
        </View>
      </View>

      {/* ── Stats ───────────────────────────────────── */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <View style={[styles.statIcon, { backgroundColor: 'rgba(124,58,237,0.15)' }]}>
            <Briefcase size={20} color="#7C3AED" />
          </View>
          <Text style={styles.statNum}>{activeCount}</Text>
          <Text style={styles.statLabel}>Active</Text>
        </View>
        <View style={styles.statCard}>
          <View style={[styles.statIcon, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
            <Clock size={20} color="#F59E0B" />
          </View>
          <Text style={styles.statNum}>{pendingCount}</Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
        <View style={styles.statCard}>
          <View style={[styles.statIcon, { backgroundColor: 'rgba(16,185,129,0.15)' }]}>
            <CheckCircle size={20} color="#10B981" />
          </View>
          <Text style={styles.statNum}>{completedCount}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
      </View>

      {/* ── Post Job Button ─────────────────────────── */}
      <TouchableOpacity
        style={styles.postBtn}
        activeOpacity={0.8}
        onPress={() => setShowPostModal(true)}
      >
        <View style={styles.postBtnGlow} />
        <View style={styles.postBtnContent}>
          <Plus size={22} color="#FFFFFF" strokeWidth={3} />
          <Text style={styles.postBtnText}>Post a Contract Job</Text>
        </View>
      </TouchableOpacity>

      {/* ── Section header ──────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Your Jobs</Text>
        <Text style={styles.sectionCount}>{jobs.length} total</Text>
      </View>
    </View>
  );

  // ── Loading state ───────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor="#020420" />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#7C3AED" />
          <Text style={styles.loadingLabel}>Loading dashboard…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main render ─────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor="#020420" />

      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJobItem}
        ListHeaderComponent={renderListHeader}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#7C3AED"
            colors={['#7C3AED']}
          />
        }
      />

      {/* ── Post-Job Modal ─────────────────────────────── */}
      <Modal visible={showPostModal} animationType="slide" transparent onRequestClose={resetModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Post a Contract Job</Text>
            <Text style={styles.modalSub}>Create a new inspection contract for your agency</Text>

            {/* Title */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Job Title *</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g., Pipeline Inspection — Site A"
                placeholderTextColor="#64748B"
                value={newTitle}
                onChangeText={setNewTitle}
                editable={!posting}
              />
            </View>

            {/* Description */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldTextArea]}
                placeholder="Describe the inspection requirements…"
                placeholderTextColor="#64748B"
                value={newDescription}
                onChangeText={setNewDescription}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
                editable={!posting}
              />
            </View>

            {/* Location */}
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Location</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="e.g., Houston, TX"
                placeholderTextColor="#64748B"
                value={newLocation}
                onChangeText={setNewLocation}
                editable={!posting}
              />
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={resetModal} disabled={posting}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  (!newTitle.trim() || posting) && styles.submitBtnDisabled,
                ]}
                onPress={handlePostJob}
                disabled={!newTitle.trim() || posting}
              >
                {posting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.submitBtnText}>Post Job</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ────────────────────────────────────────────────────────
// STYLES — dark theme: #020420 bg, #7C3AED primary, #0F172A cards
// ────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020420',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingLabel: {
    color: '#64748B',
    fontSize: 14,
    marginTop: 12,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },

  /* ── Header ─────────────────────────────────────────── */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 24,
  },
  greeting: {
    fontSize: 26,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  subGreeting: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 4,
  },
  headerIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(124,58,237,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /* ── Stats ──────────────────────────────────────────── */
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  statIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statNum: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
    marginTop: 2,
  },

  /* ── Post-job CTA ───────────────────────────────────── */
  postBtn: {
    position: 'relative',
    borderRadius: 16,
    overflow: 'visible',
    marginBottom: 28,
  },
  postBtnGlow: {
    position: 'absolute',
    top: 4,
    left: 10,
    right: 10,
    bottom: -4,
    backgroundColor: '#7C3AED',
    borderRadius: 16,
    opacity: 0.35,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 12,
  },
  postBtnContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#7C3AED',
    borderRadius: 16,
    paddingVertical: 18,
    gap: 10,
  },
  postBtnText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },

  /* ── Section header ─────────────────────────────────── */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  sectionCount: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },

  /* ── Job card ───────────────────────────────────────── */
  jobCard: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    position: 'relative',
  },
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  jobTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
    gap: 8,
  },
  jobTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    flex: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 6,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  jobDesc: {
    fontSize: 13,
    color: '#94A3B8',
    lineHeight: 18,
    marginBottom: 10,
  },
  jobMeta: {
    flexDirection: 'row',
    gap: 18,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  jobArrow: {
    position: 'absolute',
    right: 16,
    top: '50%',
    marginTop: -10,
  },

  /* ── Empty state ────────────────────────────────────── */
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    marginTop: 16,
  },
  emptySub: {
    fontSize: 14,
    color: '#64748B',
    marginTop: 6,
    textAlign: 'center',
  },

  /* ── Modal ──────────────────────────────────────────── */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(2,4,32,0.85)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 24,
  },
  fieldGroup: {
    marginBottom: 18,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    color: '#FFFFFF',
  },
  fieldTextArea: {
    minHeight: 80,
    paddingTop: 14,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#94A3B8',
  },
  submitBtn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#7C3AED',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  submitBtnDisabled: {
    backgroundColor: 'rgba(124,58,237,0.35)',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});