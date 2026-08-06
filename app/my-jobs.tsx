// app/my-jobs.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert
} from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router'; // 🔴 استفاده از useRouter به جای Link
import { supabase } from '../lib/supabase';

interface Job {
  id: string;
  title: string;
  location: string;
  status: string;
  payout_amount_cents: number;        // ★ Task 4
  created_at: string;
}

export default function MyJobsScreen() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  useEffect(() => {
    fetchMyActiveJobs();
  }, []);

  const fetchMyActiveJobs = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const { data, error } = await supabase
        // ★ 20260801318000 — payout columns are revoked from `authenticated` on
        //   the base table; the assigned inspector reads them via this view.
        .from('jobs_inspector_secure_view')
        .select('id, title, location, status, payout_amount_cents, created_at')
        // ★ Assignment column is jobs.contractor_id (set by the dispatch path);
        //   jobs.inspector_id is never populated → this list was always empty.
        .eq('contractor_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setJobs(data || []);
    } catch (err: any) {
      console.error('Error fetching jobs:', err);
      setError(err?.message ?? 'Could not load your jobs.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const generateTestJob = async () => {
    // Pre-launch: test-data seeding is DEV-only. In production this no-ops so a
    // stray button can never mint a self-assigned job (contractor_id = self
    // bypasses the admin broker).
    if (!__DEV__) {
      Alert.alert('Unavailable', 'Test data generation is disabled in production.');
      return;
    }
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // ★ Task 4: dummy seed data uses *_cents columns. 1000 dollars = 100000 cents.
      const { error } = await supabase.from('jobs').insert([{
          title: 'API-653 Storage Tank Inspection',
          location: 'Montreal Refinery, QC',
          status: 'open',
          client_price_cents: 100000,
          payout_amount_cents: 30000,
          contractor_id: user.id,
      }]);

      if (error) throw error;
      fetchMyActiveJobs();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Could not insert test job');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchMyActiveJobs();
  };

  const renderJobCard = ({ item }: { item: Job }) => {
    // ★ Task 4: payout_amount_cents is integer cents — divide by 100.
    const formattedPrice = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
    }).format((item.payout_amount_cents ?? 0) / 100);

    // 🔴 بررسی اینکه آیا کار تمام شده است یا نه
    const isCompleted = item.status === 'completed';

    return (
      <View style={styles.jobCard}>
        <View style={styles.cardHeader}>
          <View style={styles.iconContainer}>
            <MaterialIcons name="assignment" size={28} color="#60A5FA" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.jobTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.reportLabel}>Job ID: {item.id.slice(0, 8).toUpperCase()}</Text>
          </View>
        </View>

        <View style={styles.detailsContainer}>
          <View style={styles.detailRow}>
            <Ionicons name="location-outline" size={18} color="#94A3B8" />
            <Text style={styles.detailText}>{item.location}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="cash-outline" size={18} color="#10B981" />
            <Text style={[styles.detailText, styles.priceText]}>{formattedPrice}</Text>
          </View>
        </View>

        {/* 🔴 بج داینامیک: اگر تمام شده باشد سبز می‌شود */}
        {isCompleted ? (
          <View style={[styles.pendingBadge, { backgroundColor: '#064E3B' }]}>
            <Ionicons name="checkmark-circle" size={16} color="#34D399" />
            <Text style={[styles.pendingText, { color: '#34D399' }]}>Job Completed & Paid</Text>
          </View>
        ) : (
          <View style={styles.pendingBadge}>
            <Ionicons name="alert-circle-outline" size={16} color="#F59E0B" />
            <Text style={styles.pendingText}>Job Pending - Please Complete</Text>
          </View>
        )}

        {/* Modern Split Action Buttons */}
        {!isCompleted && (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <TouchableOpacity 
              style={[styles.fillButton, { flex: 1 }]}
              onPress={() => {
                router.push({ pathname: '/submit-report', params: { jobId: item.id, projectTitle: item.title } });
              }}
            >
              <Ionicons name="create-outline" size={18} color="#fff" />
              <Text style={styles.fillButtonText}>Report</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.fillButton, { flex: 1, backgroundColor: '#0a0f2e', borderWidth: 1, borderColor: '#7C3AED' }]}
              onPress={() => {
                router.push(`/chat/${item.id}`);
              }}
            >
              <Ionicons name="chatbubbles-outline" size={18} color="#7C3AED" />
              <Text style={[styles.fillButtonText, { color: '#7C3AED' }]}>Chat</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) {
      return (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
      );
    }
    if (error) {
      return (
        <View style={styles.centerBox}>
          <Ionicons name="cloud-offline-outline" size={48} color="#7C3AED" />
          <Text style={styles.emptyTitle}>Couldn't load your jobs</Text>
          <Text style={styles.emptySub}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchMyActiveJobs}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.centerBox}>
        <Ionicons name="briefcase-outline" size={48} color="#7C3AED" />
        <Text style={styles.emptyTitle}>No active jobs yet</Text>
        <Text style={styles.emptySub}>Jobs assigned to you by the dispatch team will appear here.</Text>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Active Jobs</Text>
        <TouchableOpacity onPress={fetchMyActiveJobs} style={styles.headerRefreshButton}>
          <Ionicons name="refresh-outline" size={24} color="#7C3AED" />
        </TouchableOpacity>
      </View>

      {__DEV__ && (
        <View style={{ paddingHorizontal: 20, paddingTop: 15, paddingBottom: 5 }}>
          <TouchableOpacity
            style={{ backgroundColor: '#10B981', padding: 15, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
            onPress={generateTestJob}
          >
            <Ionicons name="flask-outline" size={20} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>Generate Test Job (Magic)</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJobCard}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7C3AED" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'web' ? 20 : 60, backgroundColor: '#0a0f2e', borderBottomWidth: 1, borderBottomColor: '#1F2937' },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#F1F5F9' },
  headerRefreshButton: { padding: 4 },
  listContainer: { padding: 20, paddingBottom: 40, flexGrow: 1 },
  jobCard: { backgroundColor: '#0a0f2e', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#1F2937' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 12 },
  iconContainer: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(124, 58, 237, 0.15)', justifyContent: 'center', alignItems: 'center' },
  headerText: { flex: 1 },
  jobTitle: { fontSize: 18, fontWeight: '700', color: '#F1F5F9', lineHeight: 24, marginBottom: 4 },
  reportLabel: { fontSize: 13, color: '#94A3B8', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  detailsContainer: { gap: 8, marginBottom: 16 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { fontSize: 14, color: '#CBD5E1' },
  priceText: { fontWeight: '600', color: '#10B981' },
  pendingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#78350F', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, gap: 6, marginBottom: 16 },
  pendingText: { fontSize: 13, fontWeight: '600', color: '#FCD34D' },
  fillButton: { backgroundColor: '#7C3AED', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, borderRadius: 12, gap: 8, marginBottom: 12 },
  fillButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#F1F5F9', textAlign: 'center', marginTop: 6 },
  emptySub: { fontSize: 14, color: '#94A3B8', textAlign: 'center', lineHeight: 20 },
  retryBtn: { marginTop: 14, backgroundColor: '#7C3AED', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 10 },
  retryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});