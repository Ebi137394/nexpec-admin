import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { FileText, Download, CheckCircle2, Clock } from 'lucide-react-native';
import { supabase } from '../lib/supabase';
import { downloadAndOpenReceipt } from '../utils/receiptDownloader';

interface ConsentRecord {
  consent_id: string;
  document_id: string;
  signed_at: string;
  policy_version: string;
  receipt_filename: string;
}

export const ConsentHistoryScreen = () => {
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    // Uses the view we created in the SQL migration
    const { data, error } = await supabase
      .from('consent_receipt_status')
      .select('*')
      .order('signed_at', { ascending: false });

    if (!error) setConsents(data || []);
    setLoading(false);
  };

  const renderItem = ({ item }: { item: ConsentRecord }) => (
    <View style={styles.card}>
      <View style={styles.header}>
        <FileText color="#7C3AED" size={24} />
        <Text style={styles.title}>{item.document_id}</Text>
      </View>
      
      <View style={styles.details}>
        <View style={styles.row}>
          <Clock size={14} color="#94A3B8" />
          <Text style={styles.text}>{new Date(item.signed_at).toLocaleDateString()}</Text>
        </View>
        <View style={styles.row}>
          <CheckCircle2 size={14} color="#10B981" />
          <Text style={styles.status}>Verified (v{item.policy_version})</Text>
        </View>
      </View>

      {/* Button only enabled if PDF exists */}
      <TouchableOpacity 
        style={[styles.downloadBtn, !item.receipt_filename && styles.disabled]}
        disabled={!item.receipt_filename}
        onPress={() => item.receipt_filename && downloadAndOpenReceipt(item.receipt_filename, item.receipt_filename.split('/').pop() || 'consent-receipt.pdf')}
      >
        <Download size={18} color="#FFF" />
        <Text style={styles.btnText}>
          {item.receipt_filename ? 'Download PDF Receipt' : 'Processing Receipt...'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (loading) return <ActivityIndicator style={{flex:1}} color="#7C3AED" />;

  return (
    <View style={styles.container}>
      <Text style={styles.pageTitle}>Legal Documents</Text>
      <FlatList 
        data={consents}
        renderItem={renderItem}
        keyExtractor={(item) => item.consent_id}
        contentContainerStyle={{ padding: 20 }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  pageTitle: { color: '#FFF', fontSize: 24, fontWeight: '700', padding: 20, paddingTop: 60 },
  card: { backgroundColor: '#0F172A', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#1E293B' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  title: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  details: { gap: 6, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { color: '#94A3B8', fontSize: 13 },
  status: { color: '#10B981', fontSize: 13, fontWeight: '500' },
  downloadBtn: { backgroundColor: '#7C3AED', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', padding: 12, borderRadius: 8, gap: 8 },
  disabled: { backgroundColor: '#334155', opacity: 0.6 },
  btnText: { color: '#FFF', fontWeight: '600' }
});