import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { supabase } from '@/lib/supabase';

const SupabaseConnectionTest = () => {
  const [status, setStatus] = useState('Checking connection...');
  const [error, setError] = useState<string | null>(null);

  const testConnection = async () => {
    try {
      setStatus('Testing Supabase connection...');
      setError(null);

      // Test basic connection
      const { data, error } = await supabase.from('profiles').select('*').limit(1);
      
      if (error) {
        throw error;
      }

      setStatus('✅ Connection successful!');
      console.log('🎉 Supabase connection test passed:', data);
    } catch (err: any) {
      const errorMsg = err?.message || 'Connection failed';
      setError(errorMsg);
      setStatus('❌ Connection failed');
      console.error('💥 Supabase connection test failed:', err);
    }
  };

  useEffect(() => {
    testConnection();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Supabase Connection Test</Text>
      
      <View style={styles.statusContainer}>
        <Text style={[styles.statusText, status.includes('✅') ? styles.success : styles.error]}>
          {status}
        </Text>
        {error && (
          <Text style={styles.errorText}>
            Error: {error}
          </Text>
        )}
      </View>

      <TouchableOpacity style={styles.button} onPress={testConnection}>
        <Text style={styles.buttonText}>Test Connection Again</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 8,
    margin: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  statusContainer: {
    marginBottom: 15,
  },
  statusText: {
    fontSize: 16,
    textAlign: 'center',
    paddingVertical: 10,
  },
  success: {
    color: '#22c55e',
    backgroundColor: '#f0fdf4',
    borderRadius: 6,
  },
  error: {
    color: '#ef4444',
    backgroundColor: '#fef2f2',
    borderRadius: 6,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    marginTop: 5,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#3b82f6',
    padding: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
  },
});

export default SupabaseConnectionTest;