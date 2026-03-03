import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Platform, Alert } from 'react-native';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function SupabaseDebugger() {
  const [status, setStatus] = useState<string>('Ready to test');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    setConfig({
      url: supabaseUrl || 'MISSING',
      keyPreview: supabaseAnonKey ? `${supabaseAnonKey.substring(0, 10)}...` : 'MISSING',
      platform: Platform.OS,
    });
  }, []);

  const runTest = async () => {
    setLoading(true);
    setStatus('Testing connection...');
    try {
      const startTime = Date.now();
      const { error } = await supabase.auth.getSession();
      const latency = Date.now() - startTime;

      if (error) throw error;
      setStatus(`✅ Connected in ${latency}ms`);
    } catch (error: any) {
      setStatus(`❌ Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const sbKeys = keys.filter(k => k.startsWith('supabase') || k.startsWith('sb-'));
      if (sbKeys.length > 0) {
        await AsyncStorage.multiRemove(sbKeys);
      }
      Alert.alert('Done', 'Storage cleared. Please restart app.');
    } catch (e) {
      Alert.alert('Error', 'Failed to clear storage');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.header}>🔧 Supabase Diagnostics</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Environment Config:</Text>
        <Text style={styles.value}>URL: {config?.url || 'MISSING ❌'}</Text>
        <Text style={styles.value}>Key: {config?.keyPreview || 'MISSING ❌'}</Text>
        <Text style={styles.value}>Platform: {Platform.OS}</Text>
      </View>

      <View style={[styles.card, styles.resultCard]}>
        <Text style={styles.label}>Connection Status:</Text>
        <Text style={[styles.status, status.includes('✅') ? styles.success : styles.error]}>
          {status}
        </Text>
      </View>

      <TouchableOpacity style={styles.btn} onPress={runTest} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>🚀 Run Connection Test</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btn, styles.clearBtn]} onPress={handleClearCache}>
        <Text style={styles.btnText}>🗑️ Clear Auth Cache</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 50, backgroundColor: '#f0f2f5', flexGrow: 1 },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center', color: '#333' },
  card: { backgroundColor: '#fff', padding: 15, borderRadius: 10, marginBottom: 15, elevation: 2 },
  resultCard: { minHeight: 100, justifyContent: 'center', alignItems: 'center' },
  label: { fontWeight: 'bold', color: '#666', marginBottom: 5 },
  value: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12, marginBottom: 5 },
  status: { fontSize: 16, fontWeight: 'bold', textAlign: 'center', marginTop: 10 },
  success: { color: 'green' },
  error: { color: 'red' },
  btn: { backgroundColor: '#007AFF', padding: 15, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  clearBtn: { backgroundColor: '#FF3B30', marginTop: 10 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});

