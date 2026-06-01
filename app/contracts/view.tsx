import React, { useCallback, useState, useEffect, useId } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Text, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams } from 'expo-router';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase'; // کلاینت سوپابیس خود را وارد کنید
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';

export default function ContractView() {
  const { id, uri, contractNumber } = useLocalSearchParams<{ id: string, uri: string, contractNumber: string }>();
  const [downloading, setDownloading] = useState(false);
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

  const viewerUrl = `https://docs.google.com/viewer?url=${encodeURIComponent(uri || '')}&embedded=true`;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Contract Details</Text>
        <TouchableOpacity onPress={handleDownload} disabled={downloading}>
          {downloading ? <ActivityIndicator color="#00CFD5" /> : <Ionicons name="download-outline" size={24} color="#00CFD5" />}
        </TouchableOpacity>
      </View>

      {/* بخش وضعیت امضاها */}
      <View style={styles.statusContainer}>
        <View style={styles.statusItem}>
          <Ionicons 
            name={status.inspector ? "checkmark-circle" : "time-outline"} 
            size={18} 
            color={status.inspector ? "#00CFD5" : "#94A3B8"} 
          />
          <Text style={[styles.statusText, { color: status.inspector ? "#FFF" : "#94A3B8" }]}>
            Inspector: {status.inspector ? "Signed" : "Pending"}
          </Text>
        </View>
        <View style={styles.statusItem}>
          <Ionicons 
            name={status.client ? "checkmark-circle" : "time-outline"} 
            size={18} 
            color={status.client ? "#00CFD5" : "#94A3B8"} 
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
        renderLoading={() => <ActivityIndicator color="#00CFD5" size="large" style={styles.loader} />}
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
