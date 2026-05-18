// components/PublicUrlTester.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';

export default function PublicUrlTester() {
  const [projectRef, setProjectRef] = useState('sxqpjxhslzzcdrdctatm');
  const [fileName, setFileName] = useState('');
  const [publicUrl, setPublicUrl] = useState('');

  const generateUrl = async () => {
    if (!fileName.trim()) {
      Alert.alert('Error', 'Please enter a file name');
      return;
    }

    // Remove leading slash if present
    const cleanFileName = fileName.trim().startsWith('/') 
      ? fileName.trim().slice(1) 
      : fileName.trim();

    const url = `https://${projectRef}.supabase.co/storage/v1/object/public/report-images/reports/${cleanFileName}`;
    setPublicUrl(url);
    
    try {
      await Clipboard.setStringAsync(url);
      console.log('📋 URL copied to clipboard:', url);
      
      if (Platform.OS === 'web') {
        alert('✅ URL copied to clipboard!');
      } else {
        Alert.alert('Success', 'URL copied to clipboard!');
      }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      Alert.alert('Error', 'Failed to copy URL to clipboard');
    }
  };

  const copyUrl = async () => {
    if (!publicUrl) return;
    
    try {
      await Clipboard.setStringAsync(publicUrl);
      if (Platform.OS === 'web') {
        alert('✅ URL copied!');
      } else {
        Alert.alert('Success', 'URL copied to clipboard!');
      }
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="link-outline" size={24} color="#3B82F6" />
        <Text style={styles.title}>Public URL Generator</Text>
      </View>
      
      <Text style={styles.label}>Project Reference:</Text>
      <TextInput
        style={styles.input}
        value={projectRef}
        onChangeText={setProjectRef}
        placeholder="sxqpjxhslzzcdrdctatm"
        placeholderTextColor="#64748B"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>File Name:</Text>
      <TextInput
        style={styles.input}
        value={fileName}
        onChangeText={setFileName}
        placeholder="user123_1234567890_abc123.png"
        placeholderTextColor="#64748B"
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TouchableOpacity 
        style={[styles.button, !fileName.trim() && styles.buttonDisabled]} 
        onPress={generateUrl}
        disabled={!fileName.trim()}
      >
        <Ionicons name="create-outline" size={18} color="#fff" />
        <Text style={styles.buttonText}>Generate & Copy URL</Text>
      </TouchableOpacity>

      {publicUrl && (
        <View style={styles.resultContainer}>
          <View style={styles.resultHeader}>
            <Text style={styles.resultLabel}>Public URL:</Text>
            <TouchableOpacity onPress={copyUrl} style={styles.copyButton}>
              <Ionicons name="copy-outline" size={16} color="#60A5FA" />
              <Text style={styles.copyButtonText}>Copy</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.resultUrl} selectable>
            {publicUrl}
          </Text>
          <View style={styles.instructionContainer}>
            <Ionicons name="information-circle-outline" size={16} color="#10B981" />
            <Text style={styles.instruction}>
              Paste in incognito browser to test
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#1E293B',
    borderRadius: 12,
    margin: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F1F5F9',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    color: '#F1F5F9',
    fontSize: 14,
    ...(Platform.OS === 'web' && { outlineStyle: 'none' as any }),
  },
  button: {
    backgroundColor: '#3B82F6',
    padding: 14,
    borderRadius: 8,
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  resultContainer: {
    marginTop: 20,
    padding: 12,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  resultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  resultLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  copyButtonText: {
    fontSize: 12,
    color: '#60A5FA',
    fontWeight: '600',
  },
  resultUrl: {
    fontSize: 11,
    color: '#10B981',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginBottom: 8,
    lineHeight: 16,
  },
  instructionContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  instruction: {
    fontSize: 12,
    color: '#10B981',
    flex: 1,
  },
});

