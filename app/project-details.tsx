import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { SafeAreaView } from 'react-native-safe-area-context'; // استفاده از نسخه امن‌تر

type Project = {
  id: string;
  title: string;
  description: string;
  location: string;
  budget: number;
  status: string;
};

export default function ProjectDetails() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjectDetails();
  }, [id]);

  const fetchProjectDetails = async () => {
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      setProject(data);
    } catch (error: any) {
      Alert.alert('Error', error.message);
      router.back();
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <View style={styles.mainContainer}>
      {/* 👇 این خط هدر پیش‌فرض سیستم را مخفی می‌کند تا تداخل ایجاد نشود 👇 */}
      <Stack.Screen options={{ headerShown: false }} />

      {/* 👇 دکمه بازگشت شناور (روی همه چیز قرار می‌گیرد) 👇 */}
      <TouchableOpacity 
        onPress={() => router.back()} 
        style={styles.floatingBackButton}
        activeOpacity={0.7}
      >
        <Ionicons name="arrow-back" size={28} color="#fff" />
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content}>
        {/* فضای خالی بالای صفحه برای اینکه متن زیر دکمه نرود */}
        <View style={{ height: 60 }} />

        <Text style={styles.title}>{project?.title}</Text>
        
        <View style={styles.priceTag}>
          <Text style={styles.priceText}>
             {project?.budget ? `$ ${project.budget} CAD` : '$ Negotiable'}
          </Text>
        </View>

        <View style={styles.locationContainer}>
          <Ionicons name="location-outline" size={20} color="#94A3B8" />
          <Text style={styles.locationText}>{project?.location}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Description</Text>
          <Text style={styles.description}>{project?.description}</Text>
        </View>

        <View style={styles.actionContainer}>
          <TouchableOpacity 
            style={styles.primaryButton}
            onPress={() => Alert.alert('Report', 'Submit Report Logic Here')}
          >
            <Text style={styles.buttonText}>Submit Report</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.secondaryButton}
            onPress={() => Alert.alert('Hire', 'Payment Gateway Logic Here')}
          >
            <Text style={styles.buttonText}>Hire & Pay Now</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#020617',
    position: 'relative', // حیاتی برای دکمه شناور
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#020617',
  },
  // 👇 استایل دکمه شناور 👇
  floatingBackButton: {
    position: 'absolute', // شناور
    top: Platform.OS === 'ios' ? 60 : 40, // فاصله از بالا (برای رد کردن ناچ آیفون)
    left: 20, // فاصله از چپ
    zIndex: 999, // اولویت نمایش خیلی بالا (روی همه چیز)
    width: 44,
    height: 44,
    backgroundColor: 'rgba(30, 41, 59, 0.8)', // رنگ پس‌زمینه نیمه‌شفاف
    borderRadius: 22, // دایره‌ای
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5, // سایه در اندروید
  },
  content: {
    padding: 20,
    paddingTop: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
  },
  priceTag: {
    marginBottom: 15,
    marginTop: 10,
  },
  priceText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#10B981',
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
  },
  locationText: {
    color: '#94A3B8',
    fontSize: 16,
    marginLeft: 6,
  },
  section: {
    marginBottom: 30,
    backgroundColor: '#1E293B',
    padding: 15,
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 10,
  },
  description: {
    fontSize: 16,
    color: '#CBD5E1',
    lineHeight: 24,
  },
  actionContainer: {
    marginTop: 10,
    gap: 15,
  },
  primaryButton: {
    backgroundColor: '#10B981',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#3B82F6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
