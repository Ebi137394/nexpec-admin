import React, { useCallback, useState, useEffect, useId } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Text, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase'; // کلاینت سوپابیس خود را وارد کنید
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';

export default function ContractView() {
  const router = useRouter();
  const { id, uri, contractNumber } = useLocalSearchParams<{ id: string, uri: string, contractNumber: string }>();
  const [downloading, setDownloading] = useState(false);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/contracts');
    }
  };
  const [status, setStatus] = useState({ client: false, inspector: false });

  const fetchSignatureStatus = useCallback(async () => {
    const { data, error } = await supabase
      .from('contracts')
      .select('client_signed_at, inspector_signed_at')
      .eq('id', id)
      .single();

    if (!error && data) {
      setStatus({
        client: !!data.client_signed_at,
        inspector: !!data.inspector_signed_at
      });
    }
  }, [id]);

  // ۱. واکشی اولیه وضعیت
  useEffect(() => {
    if (!id) return;
    fetchSignatureStatus();
  }, [id, fetchSignatureStatus]);

  // ۲. گوش دادن به تغییرات آنی (Real-time Subscription)
  const channelId = useId();
  useRealtimeSubscription({
    channelName: `contract_changes_${id ?? 'none'}:${channelId}`,
    bindings: [
      {
        event: 'UPDATE',
        table: 'contracts',
        filter: id ? `id=eq.${id}` : undefined,
      },
    ],
    onChange: (payload) => {
      console.log('Real-time update received!', payload.new);
      setStatus({
        client: !!(payload.new as any).client_signed_at,
        inspector: !!(payload.new as any).inspector_signed_at
      });
    },
    onDesync: () => { fetchSignatureStatus(); },
    enabled: !!id,
  });

  const handleDownload = async () => {
    if (!uri) return;
    setDownloading(true);
    try {
      const fileName = `NEXPEC_${contractNumber || 'Contract'}.pdf`;
      const fileUri = FileSystem.documentDirectory + fileName;
      const downloadResumable = FileSystem.createDownloadResumable(uri, fileUri);
      const result = await downloadResumable.downloadAsync();
      if (result) await Sharing.shareAsync(result.uri);
    } catch (error) {
      Alert.alert("Error", "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  // Load the signed PDF directly. Never route a private contract through a
  // third-party (Google) viewer. iOS WebView renders PDFs inline; on Android
  // the file may download rather than render inline — acceptable vs. leaking.
  const viewerUrl = uri || '';

  // ── URI allow-list ────────────────────────────────────────────────
  // This screen renders whatever `uri` it is handed inside a WebView, so a
  // crafted deep link could otherwise turn it into an arbitrary-web surface.
  // Only accept signed Supabase Storage URLs from OUR project: https, on the
  // EXPO_PUBLIC_SUPABASE_URL host, under /storage/.
  const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const isAllowedUri =
    typeof viewerUrl === 'string' &&
    viewerUrl.startsWith('https://') &&
    !!SUPABASE_URL &&
    viewerUrl.startsWith(`${SUPABASE_URL.replace(/\/$/, '')}/storage/`);

  if (!isAllowedUri) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack}>
            <Ionicons name="arrow-back" size={24} color="#7C3AED" />
          </TouchableOpacity>
          <Text style={styles.headerText}>Contract Details</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          <Ionicons name="alert-circle-outline" size={44} color="#7C3AED" />
          <Text style={{ color: '#FFF', fontSize: 17, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>
            Document unavailable
          </Text>
          <Text style={{ color: '#94A3B8', fontSize: 13, marginTop: 6, textAlign: 'center', lineHeight: 19 }}>
            This viewer only opens secure NEXPEC contract links. Please reopen the contract from its details screen.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color="#7C3AED" />
        </TouchableOpacity>
        <Text style={styles.headerText}>Contract Details</Text>
        <TouchableOpacity onPress={handleDownload} disabled={downloading}>
          {downloading ? <ActivityIndicator color="#7C3AED" /> : <Ionicons name="download-outline" size={24} color="#7C3AED" />}
        </TouchableOpacity>
      </View>

      {/* بخش وضعیت امضاها */}
      <View style={styles.statusContainer}>
        <View style={styles.statusItem}>
          <Ionicons 
            name={status.inspector ? "checkmark-circle" : "time-outline"} 
            size={18} 
            color={status.inspector ? "#7C3AED" : "#94A3B8"} 
          />
          <Text style={[styles.statusText, { color: status.inspector ? "#FFF" : "#94A3B8" }]}>
            Inspector: {status.inspector ? "Signed" : "Pending"}
          </Text>
        </View>
        <View style={styles.statusItem}>
          <Ionicons 
            name={status.client ? "checkmark-circle" : "time-outline"} 
            size={18} 
            color={status.client ? "#7C3AED" : "#94A3B8"} 
          />
          <Text style={[styles.statusText, { color: status.client ? "#FFF" : "#94A3B8" }]}>
            Client: {status.client ? "Signed" : "Pending"}
          </Text>
        </View>
      </View>

      <WebView 
        source={{ uri: viewerUrl }}
        style={styles.webview}
        startInLoadingState={true}
        renderLoading={() => <ActivityIndicator color="#7C3AED" size="large" style={styles.loader} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    paddingHorizontal: 20, 
    paddingTop: 50, 
    paddingBottom: 15,
    backgroundColor: '#020420'
  },
  headerText: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  statusContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    backgroundColor: '#111827', // رنگ تیره برای تمایز
    borderBottomWidth: 1,
    borderBottomColor: '#1C6BB1'
  },
  statusItem: { flexDirection: 'row', alignItems: 'center' },
  statusText: { marginLeft: 8, fontSize: 12, fontWeight: '600' },
  webview: { flex: 1, backgroundColor: 'transparent' },
  loader: { position: 'absolute', top: '50%', left: '45%' }
});
