// Simple test component to isolate hooks issue
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function TestHooks() {
  const [test, setTest] = useState('test');
  
  useEffect(() => {
    console.log('Test effect');
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Test Hooks Component</Text>
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