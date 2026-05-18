// Simple test component to check if supabase import causes hooks issue
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';

export default function TestSupabase() {
  const [test, setTest] = useState('test');
  
  useEffect(() => {
    console.log('Test effect with supabase');
    // Just import supabase, don't use it
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Test Supabase Component</Text>
      <Text style={styles.text}>{test}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
  },
  text: {
    fontSize: 16,
    color: '#000',
  },
});