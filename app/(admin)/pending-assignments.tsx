import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function PendingApprovalsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'reports' | 'hires'>('reports');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'reports') {
        // 1) Pending inspection reports awaiting admin publish
        const { data: reports, error: reportsErr } = await supabase
          .from('inspection_reports')
          .select('*, job:jobs(id, title, location)')
          .eq('is_published', false)
          .order('created_at', { ascending: false });

        if (reportsErr) throw reportsErr;
        setData(reports || []);
      } else {
        // 2) Pending hires — applications the Client has CLIENT_SELECTED.
        //    This is the single gatekeeper signal: Client has chosen,
        //    Admin must Confirm & Dispatch (in Spread Editor) before the
        //    inspector becomes officially `hired` and the job is locked.
        const { data: apps, error: appsErr } = await supabase
          .from('applications')
          .select(`
            id,
            status,
            cover_note,
            created_at,
            updated_at,
            job_id,
            applicant:profiles!applicant_id (
              id, first_name, last_name, avatar_url, title, email
            ),
            job:jobs!job_id (
              id, title, location, client_id
            )
          `)
          .eq('status', 'CLIENT_SELECTED')
          .order('updated_at', { ascending: false });

        if (appsErr) throw appsErr;
        setData(apps || []);
      }
    } catch (err: any) {
      console.error('Error fetching data:', err);
      Alert.alert('Database Error', err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom', 'left', 'right']}>

      {/* Tab Bar */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'reports' && styles.activeTab]}
          onPress={() => setActiveTab('reports')}
        >
          <Text style={[styles.tabText, activeTab === 'reports' && styles.activeTabText]}>Pending Reports</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabButton, activeTab === 'hires' && styles.activeTab]}
          onPress={() => setActiveTab('hires')}
        >
          <Text style={[styles.tabText, activeTab === 'hires' && styles.activeTabText]}>Pending Hires</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#7C3AED" />
        </View>
      ) : data.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-done-circle-outline" size={64} color="#1E293B" />
          <Text style={styles.caughtUpText}>All caught up!</Text>
          <Text style={styles.subText}>No pending {activeTab} at the moment.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={styles.headerText}>
            {data.length} {activeTab === 'reports' ? 'reports' : 'hires'} awaiting action
          </Text>

          {data.map((item) => {
            const isReport = activeTab === 'reports';

            // Both lanes route to the Spread Editor at /(admin)/jobs/<job_id>,
            // which is the ONE place that owns the Confirm & Dispatch gate.
            const navId = isReport ? item.job_id : (item.job?.id || item.job_id);

            const projectTitle = isReport
              ? (item.job?.location || 'Unknown Location')
              : (item.job?.title || 'Untitled Project');

            const applicantName = !isReport
              ? `${item.applicant?.first_name ?? ''} ${item.applicant?.last_name ?? ''}`.trim() ||
                'Inspector'
              : '';

            const iconColor = isReport ? '#F59E0B' : '#3B82F6';
            const iconName  = isReport ? 'document-text' : 'person-add';

            return (
              <TouchableOpacity
                key={item.id}
                style={styles.card}
                onPress={() => router.push(`/(admin)/jobs/${navId}` as any)}
              >
                <View style={styles.cardLeft}>
                  <Ionicons name={iconName} size={24} color={iconColor} style={{ marginRight: 12 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.jobText}>
                      {isReport ? `Report for: ${projectTitle}` : applicantName}
                    </Text>

                    {/* Client comment, only when reviewing a hire */}
                    {!isReport && item.cover_note ? (
                      <Text style={styles.commentText} numberOfLines={2}>
                        💬 "{item.cover_note}"
                      </Text>
                    ) : null}

                    <Text style={styles.timeText}>
                      {isReport ? 'Submitted: ' : 'Project: '}{projectTitle}
                    </Text>
                  </View>
                </View>
                <View style={styles.statusWrap}>
                  {!isReport && (
                    <Text style={[styles.statusTag, { color: iconColor }]}>
                      {String(item.status || '').replace(/_/g, ' ').toUpperCase()}
                    </Text>
                  )}
                  <Ionicons name="chevron-forward" size={20} color="#1E293B" />
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  tabContainer: { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 8, marginTop: 8 },
  tabButton: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: '#1A1D3C' },
  activeTab: { borderBottomColor: '#7C3AED' },
  tabText: { color: '#64748B', fontWeight: '600', fontSize: 14 },
  activeTabText: { color: '#7C3AED', fontWeight: 'bold' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  caughtUpText: { color: '#FFF', fontSize: 20, fontWeight: 'bold', marginTop: 16 },
  subText: { color: '#64748B', fontSize: 14, marginTop: 8 },
  scrollContent: { padding: 16 },
  headerText: { color: '#94A3B8', fontSize: 14, marginBottom: 16, textTransform: 'uppercase', fontWeight: 'bold' },
  card: { backgroundColor: '#0A0D2C', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#1A1D3C', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  jobText: { color: '#FFF', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  commentText: { color: '#94A3B8', fontSize: 13, fontStyle: 'italic', marginBottom: 4 },
  timeText: { color: '#64748B', fontSize: 12 },
  statusWrap: { alignItems: 'flex-end' },
  statusTag: { fontSize: 10, fontWeight: '800', marginBottom: 4 },
});