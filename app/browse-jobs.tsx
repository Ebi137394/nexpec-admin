import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Platform, // برای تشخیص آیفون/اندروید
  StatusBar,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

// تعریف نوع داده
type Project = {
  id: string;
  title: string;
  location: string;
  budget: number;
  description: string;
  inspection_type?: string;
};

export default function BrowseJobs() {
  const router = useRouter();
  const [jobs, setJobs] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('status', 'Open') // فقط پروژه‌های باز
        .order('created_at', { ascending: false });

      if (error) throw error;
      setJobs(data || []);
    } catch (error) {
      console.log('Error fetching jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderJobItem = ({ item }: { item: Project }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push({ pathname: '/project-details', params: { id: item.id } })}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.jobTitle}>{item.title}</Text>
        <Text style={styles.budget}>
          {item.budget ? `$${item.budget}` : 'Negotiable'}
        </Text>
      </View>

      <View style={styles.row}>
        <Ionicons name="location-outline" size={16} color="#94A3B8" />
        <Text style={styles.location}>{item.location}</Text>
      </View>

      <View style={styles.tagsContainer}>
        <View style={styles.tag}>
          <Text style={styles.tagText}>
            {item.inspection_type || 'General'}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* 🛑 مخفی کردن هدر سیستم برای جلوگیری از تداخل */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* 🔙 دکمه بازگشت شناور (Floating Back Button) */}
      <View style={styles.headerArea}>
        <TouchableOpacity onPress={() => router.back()} style={styles.floatingBackButton}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        
        <Text style={styles.screenTitle}>Available Jobs</Text>

        {/* 👇 دکمه جدید برای رفتن به نقشه 👇 */}
        <TouchableOpacity 
          style={{ marginLeft: 'auto', backgroundColor: '#3B82F6', padding: 8, borderRadius: 8 }}
          onPress={() => router.push('/browse-jobs-map')}
        >
          <Ionicons name="map" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* جستجو */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#64748B" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search inspections..."
          placeholderTextColor="#64748B"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#3B82F6" style={{ marginTop: 20 }} />
      ) : (
        <FlatList
          data={jobs.filter(job => 
            job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            job.location.toLowerCase().includes(searchQuery.toLowerCase())
          )}
          keyExtractor={(item) => item.id}
          renderItem={renderJobItem}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No open jobs found right now.</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617', // پس‌زمینه اصلی
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  // 👇 استایل هدر و دکمه بازگشت 👇
  headerArea: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 60 : 20, // فاصله از بالا برای ناچ آیفون
    paddingHorizontal: 20,
    paddingBottom: 20,
    backgroundColor: '#020617',
    zIndex: 100,
  },
  floatingBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1E293B', // دایره طوسی تیره
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15, // فاصله تا تایتل
    borderWidth: 1,
    borderColor: '#334155',
  },
  screenTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    flex: 1,
  },
  // 👆 پایان هدر 👆
  
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    marginHorizontal: 20,
    paddingHorizontal: 15,
    borderRadius: 12,
    height: 50,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 16,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  jobTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
    flex: 1,
    marginRight: 8,
  },
  budget: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#10B981', // سبز
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  location: {
    color: '#94A3B8',
    marginLeft: 4,
    fontSize: 14,
  },
  tagsContainer: {
    flexDirection: 'row',
  },
  tag: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  tagText: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  emptyText: {
    color: '#64748B',
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
  },
});
