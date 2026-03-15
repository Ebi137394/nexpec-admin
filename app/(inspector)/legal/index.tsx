import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// Types
interface LegalDoc {
  id: string;
  title: string;
  content: string;
  version: string;
  signed_at?: string; // If signed, this exists
}

export default function LegalScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [documents, setDocuments] = useState<LegalDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<LegalDoc | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    if (user) fetchDocuments();
  }, [user]);

  const fetchDocuments = async () => {
    try {
      // 1. Get the current user's profile to check their role
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

      const userRole = profile?.role || 'inspector'; // Default to inspector if null

      // 2. Fetch templates matching their role
      const { data: templates } = await supabase
        .from('legal_templates')
        .select('*')
        .eq('is_active', true)
        .eq('target_role', userRole); // 👈 THIS IS THE FIX

      // 3. Fetch signed status
      const { data: signed } = await supabase
        .from('signed_agreements')
        .select('template_id, signed_at')
        .eq('user_id', user.id);

      const merged = templates?.map((t: any) => ({
        ...t,
        signed_at: signed?.find((s: any) => s.template_id === t.id)?.signed_at
      })) || [];

      setDocuments(merged);
    } catch (e) { console.error(e); }
  };

  const handleSign = async () => {
    if (!selectedDoc || !user) return;
    try {
      const { error } = await supabase.from('signed_agreements').insert({
        user_id: user.id,
        template_id: selectedDoc.id,
        signed_at: new Date().toISOString()
      });

      if (error) throw error;

      Alert.alert('Success', 'Document signed successfully.');
      setModalVisible(false);
      fetchDocuments(); // Refresh list
    } catch (error) {
      Alert.alert('Error', 'Failed to sign document.');
    }
  };

  const openDoc = (doc: LegalDoc) => {
    setSelectedDoc(doc);
    setModalVisible(true);
  };

  const renderItem = ({ item }: { item: LegalDoc }) => (
    <TouchableOpacity style={styles.card} onPress={() => openDoc(item)}>
      <View style={styles.iconBox}>
        <Ionicons
          name={item.signed_at ? "shield-checkmark" : "alert-circle"}
          size={24}
          color={item.signed_at ? "#10B981" : "#F59E0B"}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.subtitle}>Version {item.version}</Text>
      </View>
      <View style={[styles.badge, { backgroundColor: item.signed_at ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)' }]}>
        <Text style={{ color: item.signed_at ? '#10B981' : '#F59E0B', fontSize: 12, fontWeight: 'bold' }}>
          {item.signed_at ? 'SIGNED' : 'PENDING'}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={24} color="#FFF" /></TouchableOpacity>
        <Text style={styles.headerTitle}>Legal & Compliance</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={documents}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
      />

      {/* Modal for Reading/Signing */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{selectedDoc?.title}</Text>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={24} color="#FFF" />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.modalContent}>
            <Text style={styles.legalText}>{selectedDoc?.content}</Text>
          </ScrollView>

          <View style={styles.modalFooter}>
            {selectedDoc?.signed_at ? (
              <View style={styles.disabledBtn}>
                <Ionicons name="checkmark" size={20} color="#FFF" />
                <Text style={styles.btnText}>Already Signed on {new Date(selectedDoc.signed_at).toLocaleDateString()}</Text>
              </View>
            ) : (
              <TouchableOpacity style={styles.signBtn} onPress={handleSign}>
                <Text style={styles.btnText}>I Agree & Sign</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 16, alignItems: 'center' },
  headerTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  card: { flexDirection: 'row', backgroundColor: '#1e293b', padding: 16, borderRadius: 12, marginBottom: 12, alignItems: 'center', gap: 12 },
  iconBox: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' },
  title: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  subtitle: { color: '#94A3B8', fontSize: 14 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },

  // Modal Styles
  modalContainer: { flex: 1, backgroundColor: '#020420' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: '#334155' },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: 'bold' },
  modalContent: { padding: 20 },
  legalText: { color: '#CBD5E1', fontSize: 16, lineHeight: 24 },
  modalFooter: { padding: 20, borderTopWidth: 1, borderTopColor: '#334155', paddingBottom: 40 },
  signBtn: { backgroundColor: '#3B82F6', padding: 16, borderRadius: 12, alignItems: 'center' },
  disabledBtn: { backgroundColor: '#10B981', padding: 16, borderRadius: 12, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },
  btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
});
