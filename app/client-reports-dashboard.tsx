import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useFocusEffect, Link } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

export default function ClientDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<any[]>([]);
  const [allReports, setAllReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [])
  );

  const fetchData = async () => {
    try {
      setLoading(true);
      
      // 1. Fetch Projects (Admin View - No Filter)
      const { data: projectsData, error: projError } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false });

      if (projError) throw projError;

      // 2. Fetch Reports (Directly - No Join)
      const { data: reportsData, error: repError } = await supabase
        .from('reports')
        .select('*');

      if (repError) throw repError;

      console.log('Total Projects:', projectsData?.length);
      console.log('Total Reports:', reportsData?.length);

      // Store all reports for debug view
      setAllReports(reportsData || []);

      // 3. MERGE THEM MANUALLY
      const combined = projectsData?.map(project => {
        // Find reports for this project
        const projectReports = reportsData?.filter(r => r.project_id === project.id) || [];
        return {
          ...project,
          reports: projectReports
        };
      });

      setProjects(combined || []);

    } catch (e: any) {
      console.error('Error fetching dashboard:', e.message);
    } finally {
      setLoading(false);
    }
  };

  const renderProject = ({ item }: { item: any }) => {
    // Get the latest report
    const report = item.reports && item.reports.length > 0 ? item.reports[0] : null;

    return (
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.sub}>{item.location}</Text>
        </View>

        <View style={styles.footer}>
          {!report ? (
            <Text style={styles.noReport}>No Report Yet</Text>
          ) : (
            <View style={{flex: 1}}>
              <View style={styles.statusRow}>
                <Text style={styles.label}>Report Status:</Text>
                <Text style={[styles.statusVal, 
                  report.status === 'Approved' ? {color:'#10B981'} : 
                  report.status === 'Needs_Revision' ? {color:'#F59E0B'} : {color:'#3B82F6'}
                ]}>{report.status}</Text>
              </View>
              
              <Link
                href={{
                  pathname: '/review-report',
                  params: { reportId: report.id }
                }}
                style={styles.reviewBtn}
              >
                <Ionicons name="notifications-outline" size={20} color="#FFF" />
                <Text style={styles.btnText}>REVIEW REPORT</Text>
              </Link>
            </View>
          )}
        </View>
      </View>
    );
  };

  const testNavigation = () => {
    console.log('Testing Navigation...');
    try {
      router.push({
        pathname: '/review-report',
        params: { reportId: 'test-id' }
      });
    } catch (e: any) {
      Alert.alert('Navigation Failed', e.message);
    }
  };

  const renderHeader = () => (
    <View style={styles.debugHeader}>
      <TouchableOpacity onPress={testNavigation} style={{backgroundColor: 'red', padding: 10, marginTop: 10}}>
        <Text style={{color: 'white', fontWeight: 'bold', textAlign: 'center'}}>🚨 CLICK TO TEST ROUTE</Text>
      </TouchableOpacity>
      
      <Text style={styles.debugTitle}>🕵️ DIAGNOSTICS MODE</Text>
      <Text style={styles.debugText}>Projects Loaded: {projects.length}</Text>
      <Text style={styles.debugText}>Reports Loaded: {allReports.length}</Text>
      
      <Text style={styles.debugSubtitle}>RAW REPORTS DUMP:</Text>
      {allReports.length === 0 ? (
        <Text style={styles.debugText}>No reports found in database</Text>
      ) : (
        allReports.map((r, index) => (
          <Text key={index} style={styles.debugReportItem}>
            #{index+1} Status: {r.status || 'N/A'} | ProjID: {r.project_id ? r.project_id.substring(0,8) + '...' : 'MISSING'} | Title: {r.title || 'N/A'}
          </Text>
        ))
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.top}>
        <TouchableOpacity onPress={router.back}><Ionicons name="arrow-back" size={24} color="#FFF"/></TouchableOpacity>
        <Text style={styles.pageTitle}>Client Dashboard (Admin View)</Text>
        <View style={{width:24}}/>
      </View>

      {loading ? <ActivityIndicator color="#3B82F6" style={{marginTop:50}}/> : 
        <FlatList
          data={projects}
          renderItem={renderProject}
          keyExtractor={i => i.id}
          contentContainerStyle={{padding:20}}
          ListHeaderComponent={renderHeader}
        />
      }
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  top: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:20, paddingTop:60, backgroundColor:'#1E293B' },
  pageTitle: { color:'#FFF', fontSize:18, fontWeight:'bold' },
  debugHeader: { padding: 20, backgroundColor: '#334155', marginBottom: 20, borderRadius: 8 },
  debugTitle: { color:'#F59E0B', fontWeight:'bold', fontSize: 16, marginBottom: 8 },
  debugSubtitle: { color:'#F59E0B', marginTop: 10, fontWeight:'bold', fontSize: 14, marginBottom: 8 },
  debugText: { color:'#FFF', fontSize: 12, marginBottom: 4 },
  debugReportItem: { color:'#CBD5E1', fontSize: 10, marginBottom: 4, fontFamily: 'monospace' },
  testButton: { backgroundColor: '#EF4444', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 8, gap: 8, marginBottom: 16 },
  testButtonText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  card: { backgroundColor: '#1E293B', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth:1, borderColor:'#334155' },
  header: { marginBottom: 12, borderBottomWidth:1, borderBottomColor:'#334155', paddingBottom:12 },
  title: { color: '#F1F5F9', fontSize: 18, fontWeight: 'bold' },
  sub: { color: '#94A3B8', fontSize: 14, marginTop:4 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  noReport: { color: '#64748B', fontStyle: 'italic' },
  statusRow: { flexDirection:'row', gap:8, marginBottom:10 },
  label: { color:'#94A3B8' },
  statusVal: { fontWeight:'bold', textTransform:'uppercase' },
  reviewBtn: { backgroundColor: '#3B82F6', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 12, borderRadius: 8, gap: 8 },
  btnText: { color: '#FFF', fontWeight: 'bold' }
});
