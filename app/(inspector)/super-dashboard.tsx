import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl, Platform, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
// ★ Consolidation: canonical supabase client @/lib/supabase.
import { supabase } from '@/lib/supabase';
import { INSPECTOR_JOB_FIELDS } from '@/lib/jobsProjection';

// --- Secure Chat Components ---
import ChatFAB from '../../components/chat/ChatFAB';
import { buildRoomId } from '../../types/chat';

// --- Existing Dashboard Components ---
import WeatherWidget from '../../src/components/dashboard/WeatherWidget';
import SOSButton from '../../src/components/shared/SOSButton';
import JobCard from '../../src/components/inspector/JobCard';

export default function SuperDashboard() {
  const [refreshing, setRefreshing] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 🔴 Fetch real data from Supabase
  useEffect(() => {
    fetchRealDashboardData();
  }, []);

  const fetchRealDashboardData = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Fetch real jobs for this user
      const { data: realJobs, error } = await supabase
        .from('jobs')
        // GR2 (Strict price visibility) — inspector tier. The projection
        // excludes client_price_cents / budget_*_cents. We still join the
        // client profile for display purposes (name + avatar only).
        .select(`${INSPECTOR_JOB_FIELDS}, clients:client_id(full_name, avatar_url)`)
        .eq('inspector_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (!error && realJobs) {
        setJobs(realJobs);
        // Find the first active/in-progress job to attach to the ChatFAB
        const activeJob = (realJobs as any[]).find((j: any) => j.status === 'in_progress' || j.status === 'Active');
        if (activeJob) setActiveJobId(activeJob.id);
      }

      // 2. Fetch real unread messages count (optional enhancement)
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('receiver_id', user.id)
        .eq('is_read', false);
        
      setUnreadMessages(count || 0);

    } catch (error) {
      console.log('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleJobPress = (job: any) => {
    console.log('Job pressed:', job.title);
  };

  const handleStatusChange = (id: string, status: any) => {
    console.log('Status change:', id, status);
  };

  const handleCloneJob = (job: any) => {
    console.log('Clone job:', job.title);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    // Add your Supabase fetch logic here
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />
      
      <FlatList
        data={jobs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <JobCard 
            job={item} 
            onPress={handleJobPress}
            onStatusChange={handleStatusChange}
            onClone={handleCloneJob}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7C3AED" />
        }
        ListHeaderComponent={
          <>
            {/* 1. Header Row */}
            <View style={styles.header}>
              <View>
                <Text style={styles.greeting}>Good afternoon,</Text>
                <Text style={styles.userName}>Inspector 👋</Text>
              </View>
              <View style={styles.notifButton}>
                <Ionicons name="notifications-outline" size={24} color="#FFF" />
              </View>
            </View>

            {/* 2. Environment & Safety */}
            <View style={styles.envRow}>
              <WeatherWidget />
              <SOSButton />
            </View>

            {/* 3. Hero Earnings Card */}
            <LinearGradient colors={['#7C3AED', '#5B21B6']} style={styles.earningsCard}>
               <Text style={styles.earnLabel}>Total Earnings</Text>
               <Text style={styles.earnValue}>$0</Text>
               <Text style={styles.earnSub}>From your work</Text>
            </LinearGradient>

            {/* 4. Quick Actions */}
            <View style={styles.sectionHeader}>
               <Ionicons name="flash" size={18} color="#7C3AED" />
               <Text style={styles.sectionTitle}>Quick Actions</Text>
            </View>
            <View style={styles.quickActions}>
               {/* Messages button leads to chat list */}
               <ActionItem icon="search" label="Find Jobs" color="#7C3AED" />
               <ActionItem icon="briefcase" label="Contracts" color="#06B6D4" />
               <ActionItem icon="chatbubble-outline" label="Messages" color="#10B981" />
            </View>
          </>
        }
      />

      {/* 5. SECURE CHAT FAB - The heart of Client/Senior interaction */}
      {activeJobId && (
        <ChatFAB 
          context="job" 
          contextId={activeJobId} 
          unreadCount={unreadMessages} 
        />
      )}
    </SafeAreaView>
  );
}

// --- Helper UI Component ---
const ActionItem = ({ icon, label, color }: any) => (
  <View style={styles.actionItem}>
    <LinearGradient colors={[`${color}25`, `${color}05`]} style={styles.actionGrad}>
      <Ionicons name={icon} size={24} color={color} />
    </LinearGradient>
    <Text style={styles.actionLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  listContent: { paddingHorizontal: 20, paddingBottom: 100 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  greeting: { color: '#94A3B8', fontSize: 14 },
  userName: { color: '#FFF', fontSize: 26, fontWeight: '700' },
  notifButton: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#0A0E2E', justifyContent: 'center', alignItems: 'center' },
  envRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  earningsCard: { borderRadius: 24, padding: 24, marginBottom: 20 },
  earnLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 14 },
  earnValue: { color: '#FFF', fontSize: 42, fontWeight: '800' },
  earnSub: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  sectionTitle: { color: '#FFF', fontSize: 18, fontWeight: '600' },
  quickActions: { flexDirection: 'row', justifyContent: 'space-between' },
  actionItem: { alignItems: 'center', flex: 1 },
  actionGrad: { width: 72, height: 72, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  actionLabel: { color: '#94A3B8', fontSize: 13 }
});