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
  payout_amount: number;
  created_at: string;
}

export default function MyJobsScreen() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');

  useEffect(() => {
    fetchMyActiveJobs();
  }, []);

  const fetchMyActiveJobs = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const { data, error } = await supabase
        .from('jobs')
        .select('id, title, location, status, payout_amount, created_at')
        .eq('inspector_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setJobs(data || []);
    } catch (error) {
      console.error('Error fetching jobs:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const generateTestJob = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from('jobs').insert([{
          title: 'API-653 Storage Tank Inspection',
          location: 'Montreal Refinery, QC',
          status: 'open',
          client_price: 1000,
          payout_amount: 300,
          inspector_id: user.id,
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
    const formattedPrice = new Intl.NumberFormat('en-CA', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 0,
    }).format(item.payout_amount);

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
              style={[styles.fillButton, { flex: 1, backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#3B82F6' }]}
              onPress={() => {
                router.push({ pathname: '/chat', params: { jobId: item.id, projectTitle: item.title } });
              }}
            >
              <Ionicons name="chatbubbles-outline" size={18} color="#3B82F6" />
              <Text style={[styles.fillButtonText, { color: '#3B82F6' }]}>Chat</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Active Jobs</Text>
        <TouchableOpacity onPress={fetchMyActiveJobs} style={styles.headerRefreshButton}>
          <Ionicons name="refresh-outline" size={24} color="#60A5FA" />
        </TouchableOpacity>
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 15, paddingBottom: 5 }}>
        <TouchableOpacity 
          style={{ backgroundColor: '#10B981', padding: 15, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 }}
          onPress={generateTestJob}
        >
          <Ionicons name="flask-outline" size={20} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>Generate Test Job (Magic)</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={renderJobCard}
        contentContainerStyle={styles.listContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3B82F6" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: Platform.OS === 'web' ? 20 : 60, backgroundColor: '#1E293B', borderBottomWidth: 1, borderBottomColor: '#334155' },
  headerTitle: { fontSize: 28, fontWeight: '700', color: '#F1F5F9' },
  headerRefreshButton: { padding: 4 },
  listContainer: { padding: 20, paddingBottom: 40, flexGrow: 1 },
  jobCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, gap: 12 },
  iconContainer: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1E40AF', justifyContent: 'center', alignItems: 'center' },
  headerText: { flex: 1 },
  jobTitle: { fontSize: 18, fontWeight: '700', color: '#F1F5F9', lineHeight: 24, marginBottom: 4 },
  reportLabel: { fontSize: 13, color: '#94A3B8', fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  detailsContainer: { gap: 8, marginBottom: 16 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailText: { fontSize: 14, color: '#CBD5E1' },
  priceText: { fontWeight: '600', color: '#10B981' },
  pendingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#78350F', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, gap: 6, marginBottom: 16 },
  pendingText: { fontSize: 13, fontWeight: '600', color: '#FCD34D' },
  fillButton: { backgroundColor: '#3B82F6', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 14, borderRadius: 12, gap: 8, marginBottom: 12 },
  fillButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});