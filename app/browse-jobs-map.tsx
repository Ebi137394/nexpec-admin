import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
  StatusBar,
} from 'react-native';
import MapView, { Marker, Callout, PROVIDER_DEFAULT, PROVIDER_GOOGLE } from 'react-native-maps';
import { useRouter, Stack } from 'expo-router';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';

interface Job {
  id: string;
  title: string;
  description: string;
  location: string;
  latitude: number;
  longitude: number;
  budget: number;
  status: string;
}

export default function BrowseJobsMap() {
  const router = useRouter();
  
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [region, setRegion] = useState({
    latitude: 45.5017,  // Montreal default
    longitude: -73.5673,
    latitudeDelta: 0.1, // زوم بهتر
    longitudeDelta: 0.1,
  });

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('id, title, description, location, latitude, longitude, budget, status')
        .eq('status', 'Open')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);

      if (error) throw error;

      setJobs(data || []);

      // زوم کردن روی اولین پروژه پیدا شده
      if (data && data.length > 0) {
        setRegion({
          latitude: data[0].latitude,
          longitude: data[0].longitude,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        });
      }
    } catch (error) {
      console.error('Fetch jobs error:', error);
      Alert.alert('Error', 'Failed to load jobs on map');
    } finally {
      setLoading(false);
    }
  };

  const navigateToJobDetails = (jobId: string) => {
    router.push({ pathname: '/project-details', params: { id: jobId } });
  };

  const getMarkerColor = (budget: number): string => {
    if (budget > 10000) return 'green'; 
    if (budget > 5000) return 'orange';  
    return 'blue'; 
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" color="#3B82F6" />
        <Text style={styles.loadingText}>Loading map...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* 🗺️ نقشه */}
      <MapView
        // نکته مهم: در iOS از Apple Maps استفاده می‌کنیم تا بدون API Key کار کند
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
        style={styles.map}
        initialRegion={region}
        showsUserLocation
        showsMyLocationButton={false} // دکمه پیش‌فرض زشت است، خودمان می‌سازیم
        showsCompass
      >
        {jobs.map((job) => (
          <Marker
            key={job.id}
            coordinate={{
              latitude: job.latitude,
              longitude: job.longitude,
            }}
            pinColor={getMarkerColor(job.budget)}
          >
            <Callout tooltip onPress={() => navigateToJobDetails(job.id)}>
              <View style={styles.calloutContainer}>
                <Text style={styles.calloutTitle} numberOfLines={1}>
                  {job.title}
                </Text>
                <Text style={styles.calloutBudget}>
                  ${job.budget.toLocaleString()} CAD
                </Text>
                <View style={styles.calloutButton}>
                  <Text style={styles.calloutButtonText}>Tap for Details</Text>
                </View>
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>

      {/* 🔙 دکمه بازگشت شناور */}
      <TouchableOpacity 
        onPress={() => router.back()} 
        style={styles.backButton}
        activeOpacity={0.8}
      >
        <Ionicons name="arrow-back" size={24} color="#fff" />
      </TouchableOpacity>

      {/* ℹ️ راهنمای نقشه (Legend) - تم تاریک */}
      <View style={styles.legendContainer}>
        <Text style={styles.legendTitle}>Budget Legend</Text>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#4CAF50' }]} />
          <Text style={styles.legendText}>$10k+ (High)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#FF9800' }]} />
          <Text style={styles.legendText}>$5k - $10k (Mid)</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#2196F3' }]} />
          <Text style={styles.legendText}>Under $5k (Low)</Text>
        </View>
      </View>

      {/* 🔄 دکمه رفرش */}
      <TouchableOpacity
        style={styles.refreshButton}
        onPress={fetchJobs}
      >
        <Ionicons name="refresh" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#020617',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#94A3B8',
  },
  map: {
    flex: 1,
  },
  // استایل دکمه بازگشت
  backButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E293B', // دایره طوسی تیره
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#334155',
  },
  // استایل رفرش
  refreshButton: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#3B82F6', // دکمه آبی
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  // استایل لجند (Dark Mode)
  legendContainer: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    backgroundColor: 'rgba(30, 41, 59, 0.95)', // پس‌زمینه تیره و شفاف
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  legendTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  legendText: {
    fontSize: 12,
    color: '#CBD5E1', // متن روشن
  },
  // استایل حباب روی نقشه (Callout)
  calloutContainer: {
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 8,
    width: 200,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  calloutTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  calloutBudget: {
    fontSize: 12,
    color: '#4CAF50',
    fontWeight: 'bold',
    marginBottom: 8,
  },
  calloutButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  calloutButtonText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
});

