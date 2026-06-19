// components/StorageDebugger.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface DebugResult {
  success: boolean;
  status?: number;
  headers?: Record<string, string>;
  contentType?: string;
  contentLength?: string;
  cacheControl?: string;
  cors?: string;
  error?: string;
  timing?: number;
}

export default function StorageDebugger({ imageUrl }: { imageUrl: string }) {
  const [debugResult, setDebugResult] = useState<DebugResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [imageLoadStatus, setImageLoadStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  /**
   * COMPREHENSIVE IMAGE URL DIAGNOSTIC TEST
   */
  const runDiagnostics = async () => {
    console.log('════════════════════════════════════════');
    console.log('🔍 SUPABASE STORAGE DIAGNOSTICS');
    console.log('════════════════════════════════════════');
    console.log('Platform:', Platform.OS);
    console.log('URL:', imageUrl);
    console.log('════════════════════════════════════════');

    setTesting(true);
    const startTime = Date.now();

    try {
      // Test 1: Fetch with detailed logging
      console.log('📡 Test 1: Fetching URL...');
      const response = await fetch(imageUrl, {
        method: 'GET',
        headers: {
          'Accept': 'image/*',
        },
      });

      const timing = Date.now() - startTime;
      console.log(`⏱️  Response time: ${timing}ms`);
      console.log('📊 Status:', response.status, response.statusText);

      // Extract all headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value: string, key: string) => {
        headers[key] = value;
        console.log(`📋 Header [${key}]:`, value);
      });

      // Critical headers
      const contentType = response.headers.get('content-type') || 'MISSING';
      const contentLength = response.headers.get('content-length') || 'MISSING';
      const cacheControl = response.headers.get('cache-control') || 'MISSING';
      const cors = response.headers.get('access-control-allow-origin') || 'MISSING';
      const etag = response.headers.get('etag') || 'MISSING';

      console.log('════════════════════════════════════════');
      console.log('🔑 CRITICAL HEADERS:');
      console.log('Content-Type:', contentType);
      console.log('Content-Length:', contentLength);
      console.log('Cache-Control:', cacheControl);
      console.log('CORS (access-control-allow-origin):', cors);
      console.log('ETag:', etag);
      console.log('════════════════════════════════════════');

      // Test 2: Try to read the body
      if (response.ok) {
        const blob = await response.blob();
        console.log('✅ Blob created successfully');
        console.log('Blob size:', blob.size, 'bytes');
        console.log('Blob type:', blob.type);

        // Validate it's actually an image
        if (!blob.type.startsWith('image/')) {
          console.warn('⚠️  WARNING: Content-Type is not an image!');
          console.warn('Expected: image/*, Got:', blob.type);
        }
      } else {
        console.error('❌ Response not OK:', response.status);
      }

      // Test 3: Check for redirects
      if (response.redirected) {
        console.warn('⚠️  URL was redirected!');
        console.warn('Final URL:', response.url);
      }

      // Store results
      setDebugResult({
        success: response.ok,
        status: response.status,
        headers,
        contentType,
        contentLength,
        cacheControl,
        cors,
        timing,
      });

      console.log('════════════════════════════════════════');

    } catch (error: any) {
      console.error('💥 DIAGNOSTIC FAILED:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);

      setDebugResult({
        success: false,
        error: error.message || 'Unknown error',
      });
    } finally {
      setTesting(false);
    }
  };

  /**
   * Test Image component loading
   */
  const testImageComponent = () => {
    console.log('🖼️  Testing React Native <Image> component...');
    setImageLoadStatus('loading');
  };

  const handleImageLoad = () => {
    console.log('✅ <Image> component loaded successfully!');
    setImageLoadStatus('success');
  };

  const handleImageError = (error: any) => {
    console.error('❌ <Image> component failed:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    setImageLoadStatus('error');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="bug-outline" size={24} color="#F59E0B" />
        <Text style={styles.headerText}>Storage Debugger</Text>
      </View>

      {/* URL Display */}
      <View style={styles.section}>
        <Text style={styles.label}>Image URL:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text style={styles.urlText} selectable>
            {imageUrl}
          </Text>
        </ScrollView>
      </View>

      {/* Action Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.button, styles.primaryButton]}
          onPress={runDiagnostics}
          disabled={testing}
        >
          {testing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="analytics-outline" size={18} color="#fff" />
          )}
          <Text style={styles.buttonText}>Run Diagnostics</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.secondaryButton]}
          onPress={testImageComponent}
        >
          <Ionicons name="image-outline" size={18} color="#fff" />
          <Text style={styles.buttonText}>Test Image</Text>
        </TouchableOpacity>
      </View>

      {/* Image Test */}
      {imageLoadStatus !== 'idle' && (
        <View style={styles.section}>
          <Text style={styles.label}>Image Component Test:</Text>
          <View style={styles.imageTestContainer}>
            <Image
              source={{ uri: imageUrl }}
              style={styles.testImage}
              onLoad={handleImageLoad}
              onError={handleImageError}
              resizeMode="cover"
            />
            {imageLoadStatus === 'loading' && (
              <View style={styles.imageOverlay}>
                <ActivityIndicator color="#3B82F6" size="large" />
              </View>
            )}
            {imageLoadStatus === 'error' && (
              <View style={styles.imageOverlay}>
                <Ionicons name="close-circle" size={40} color="#EF4444" />
                <Text style={styles.errorText}>Failed to Load</Text>
              </View>
            )}
            {imageLoadStatus === 'success' && (
              <View style={styles.successBadge}>
                <Ionicons name="checkmark-circle" size={20} color="#10B981" />
              </View>
            )}
          </View>
        </View>
      )}

      {/* Debug Results */}
      {debugResult && (
        <ScrollView style={styles.resultsContainer}>
          <View style={styles.section}>
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Status:</Text>
              <Text
                style={[
                  styles.resultValue,
                  debugResult.success ? styles.successText : styles.errorText,
                ]}
              >
                {debugResult.status || 'ERROR'} {debugResult.success ? '✓' : '✗'}
              </Text>
            </View>

            {debugResult.timing && (
              <View style={styles.resultRow}>
                <Text style={styles.resultLabel}>Response Time:</Text>
                <Text style={styles.resultValue}>{debugResult.timing}ms</Text>
              </View>
            )}

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Content-Type:</Text>
              <Text
                style={[
                  styles.resultValue,
                  debugResult.contentType?.startsWith('image/')
                    ? styles.successText
                    : styles.warningText,
                ]}
              >
                {debugResult.contentType || 'MISSING'}
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Content-Length:</Text>
              <Text style={styles.resultValue}>{debugResult.contentLength}</Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>CORS Header:</Text>
              <Text
                style={[
                  styles.resultValue,
                  debugResult.cors === 'MISSING' ? styles.errorText : styles.successText,
                ]}
              >
                {debugResult.cors}
              </Text>
            </View>

            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>Cache-Control:</Text>
              <Text style={styles.resultValue}>{debugResult.cacheControl}</Text>
            </View>

            {debugResult.error && (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={20} color="#EF4444" />
                <Text style={styles.errorMessage}>{debugResult.error}</Text>
              </View>
            )}

            {/* All Headers */}
            {debugResult.headers && (
              <View style={styles.headersSection}>
                <Text style={styles.headersTitle}>All Response Headers:</Text>
                {Object.entries(debugResult.headers).map(([key, value]) => (
                  <View key={key} style={styles.headerRow}>
                    <Text style={styles.headerKey}>{key}:</Text>
                    <Text style={styles.headerValue} selectable>
                      {value}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      {/* Platform Info */}
      <View style={styles.platformInfo}>
        <Text style={styles.platformText}>Platform: {Platform.OS}</Text>
        <Text style={styles.platformText}>Version: {Platform.Version}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: '#F59E0B',
    marginVertical: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  headerText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F59E0B',
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 6,
  },
  urlText: {
    fontSize: 11,
    color: '#CBD5E1',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    gap: 6,
  },
  primaryButton: {
    backgroundColor: '#3B82F6',
  },
  secondaryButton: {
    backgroundColor: '#10B981',
  },
  buttonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  imageTestContainer: {
    position: 'relative',
    height: 200,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
  },
  testImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    gap: 8,
  },
  successBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderRadius: 20,
    padding: 4,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
  },
  resultsContainer: {
    maxHeight: 400,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  resultLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94A3B8',
  },
  resultValue: {
    fontSize: 12,
    color: '#CBD5E1',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  successText: {
    color: '#10B981',
  },
  warningText: {
    color: '#F59E0B',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#450A0A',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  errorMessage: {
    flex: 1,
    color: '#FCA5A5',
    fontSize: 12,
  },
  headersSection: {
    marginTop: 16,
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 8,
  },
  headersTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#60A5FA',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  headerKey: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
    width: 120,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  headerValue: {
    flex: 1,
    fontSize: 11,
    color: '#CBD5E1',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  platformInfo: {
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 12,
    marginTop: 12,
  },
  platformText: {
    fontSize: 11,
    color: '#64748B',
  },
});

