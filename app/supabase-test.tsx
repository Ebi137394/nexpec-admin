import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import SupabaseConnectionTest from '../components/SupabaseConnectionTest';

const SupabaseTestScreen = () => {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>🔧 Supabase Connection Fix</Text>
      <Text style={styles.subtitle}>
        Testing the bulletproof Supabase initialization...
      </Text>
      
      <SupabaseConnectionTest />
      
      <View style={styles.instructions}>
        <Text style={styles.sectionTitle}>📋 What this test does:</Text>
        <Text style={styles.instruction}>
          • Checks if environment variables are loaded correctly
        </Text>
        <Text style={styles.instruction}>
          • Tests the Supabase connection with a simple query
        </Text>
        <Text style={styles.instruction}>
          • Shows detailed console logs for debugging
        </Text>
      </View>

      <View style={styles.instructions}>
        <Text style={styles.sectionTitle}>🎯 Expected Results:</Text>
        <Text style={styles.instruction}>
          ✅ Connection successful - Environment variables are working
        </Text>
        <Text style={styles.instruction}>
          📊 Dashboard should now show your "VERIFIED CLOUD SYNC" project
        </Text>
        <Text style={styles.instruction}>
          🔗 WebSocket connection established for real-time updates
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1e293b',
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 30,
  },
  instructions: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    marginTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1e293b',
    marginBottom: 15,
  },
  instruction: {
    fontSize: 14,
    color: '#334155',
    marginBottom: 8,
    lineHeight: 20,
  },
});

export default SupabaseTestScreen;