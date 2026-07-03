import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Modal,
  TextInput,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, Plus, Trash2, Calendar, Award } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
import { signedUrls, SIGNED_URL_TTL } from '@/src/core/storage/signedUrls';
// ✅ IMPORT LANGUAGE HOOK
import { useLanguage } from '@/src/i18n/LanguageProvider';

interface Certification {
  id: string;
  title: string;
  issuing_org: string;
  expiry_date: string;
  file_url: string | null;
}

export default function CertificationsScreen() {
  const router = useRouter();
  const { user } = useAuth();

  // ✅ ENABLE TRANSLATION & RTL
  const { t, isRTL } = useLanguage();

  const [certs, setCerts] = useState<Certification[]>([]);
  // file_url is now a storage PATH (certifications bucket is private). Mint
  // signed URLs at read for the owner viewing their own certs. Keyed by path.
  const [certUrls, setCertUrls] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form State
  const [newCert, setNewCert] = useState({
    title: '',
    issuing_org: '',
    expiry_date: '',
    photo_uri: '',
  });

  useEffect(() => {
    if (user) fetchCerts();
  }, [user]);

  const fetchCerts = async () => {
    try {
      const { data, error } = await supabase
        .from('certifications')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      const rows = data || [];
      setCerts(rows);

      // Mint signed URLs for cert file PATHs (private bucket; owner-authorized).
      const paths = rows
        .map((c: Certification) => c.file_url)
        .filter((p): p is string => !!p);
      if (paths.length > 0) {
        const urls = await signedUrls('certifications', paths, SIGNED_URL_TTL.THUMB);
        setCertUrls(urls);
      } else {
        setCertUrls({});
      }
    } catch (error) {
      console.error('Error fetching certs:', error);
    } finally {
      setLoading(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });

    if (!result.canceled) {
      setNewCert({ ...newCert, photo_uri: result.assets[0].uri });
    }
  };

  /**
   * Upload certificate image to Supabase Storage and return the storage PATH.
   * The `certifications` bucket is private (owner+admin only); we store the
   * path and mint signed URLs at read time.
   */
  const uploadImage = async (uri: string): Promise<string> => {
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      const filePath = `${user?.id}/${Date.now()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from('certifications')
        .upload(filePath, decode(base64), { contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      // Store the PATH (not a public URL — bucket is private).
      return filePath;
    } catch (error) {
      console.error('Upload failed:', error);
      throw error;
    }
  };

  const handleAddCert = async () => {
    if (!newCert.title || !newCert.issuing_org) {
      Alert.alert(t('Error'), t('Please fill in Title and Organization'));
      return;
    }

    setSaving(true);
    try {
      let fileUrl = null;
      if (newCert.photo_uri) {
        fileUrl = await uploadImage(newCert.photo_uri);
      }

      const { error } = await supabase.from('certifications').insert({
        user_id: user?.id,
        name: newCert.title, // Map title to name column (required by database)
        title: newCert.title,
        issuing_organization: newCert.issuing_org, // Map issuing_org state to issuing_organization column
        expiry_date: newCert.expiry_date || null,
        file_url: fileUrl,
      });

      if (error) throw error;

      setModalVisible(false);
      setNewCert({ title: '', issuing_org: '', expiry_date: '', photo_uri: '' });
      fetchCerts();
      Alert.alert(t('Success'), t('Certification added!')); // Fixed generic string
    } catch (error: any) {
      Alert.alert(t('Error'), error.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    Alert.alert(t('Delete'), t('Are you sure?'), [
      { text: t('Cancel') },
      {
        text: t('Delete'),
        style: 'destructive',
        onPress: async () => {
          await supabase.from('certifications').delete().eq('id', id);
          fetchCerts();
        }
      }
    ]);
  };

  const renderItem = ({ item }: { item: Certification }) => (
    <View style={[styles.card, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <View style={styles.cardContent}>
        <View style={[styles.cardHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <Award size={20} color="#8B5CF6" style={isRTL ? {marginLeft: 8} : {marginRight: 8}} />
            <Text style={[styles.cardTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{item.title}</Text>
        </View>
        <Text style={[styles.cardOrg, { textAlign: isRTL ? 'right' : 'left' }]}>{item.issuing_org}</Text>
        {item.expiry_date && (
            <View style={[styles.dateRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <Calendar size={14} color="#64748b" />
                <Text style={styles.cardDate}> Exp: {item.expiry_date}</Text>
            </View>
        )}
      </View>

      {item.file_url && certUrls[item.file_url] && (
        <Image source={{ uri: certUrls[item.file_url] as string }} style={styles.thumbnail} />
      )}

      <TouchableOpacity onPress={() => handleDelete(item.id)} style={styles.deleteBtn}>
        <Trash2 size={20} color="#ef4444" />
      </TouchableOpacity>
    </View>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
             {/* Flip arrow based on Language */}
             {isRTL ? <ArrowRight size={24} color="#fff" /> : <ArrowLeft size={24} color="#fff" />}
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('Certifications')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={[styles.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          {isRTL ? <ArrowRight size={24} color="#fff" /> : <ArrowLeft size={24} color="#fff" />}
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('Certifications')}</Text>
        <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.addButton}>
          <Plus size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={certs}
        renderItem={renderItem}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 20 }}
        ListEmptyComponent={
            <View style={styles.emptyContainer}>
                <Award size={48} color="#334155" />
                <Text style={styles.emptyText}>{t('No certifications yet.')}</Text>
                <Text style={styles.emptySubText}>{t('Add your licenses to verify your profile.')}</Text>
            </View>
        }
      />

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('Add Certification')}</Text>

            <TextInput
              style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]}
              placeholder={t('Title (e.g. NDT Level 2)')}
              placeholderTextColor="#64748b"
              value={newCert.title}
              onChangeText={text => setNewCert({...newCert, title: text})}
            />
            <TextInput
              style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]}
              placeholder={t('Issuing Org (e.g. ASNT)')}
              placeholderTextColor="#64748b"
              value={newCert.issuing_org}
              onChangeText={text => setNewCert({...newCert, issuing_org: text})}
            />
             <TextInput
              style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]}
              placeholder={t('Expiry Date (YYYY-MM-DD)')}
              placeholderTextColor="#64748b"
              value={newCert.expiry_date}
              onChangeText={text => setNewCert({...newCert, expiry_date: text})}
            />

            <TouchableOpacity style={styles.uploadBtn} onPress={pickImage}>
              {newCert.photo_uri ? (
                  <Image source={{ uri: newCert.photo_uri }} style={styles.previewImage} />
              ) : (
                  <View style={styles.uploadPlaceholder}>
                      <Plus size={20} color="#fff" />
                      <Text style={styles.uploadText}>{t('Upload Document Photo')}</Text>
                  </View>
              )}
            </TouchableOpacity>

            <View style={[styles.modalActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>{t('Cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddCert} disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>{t('Save')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  backButton: { padding: 8 },
  addButton: { backgroundColor: '#3b82f6', padding: 8, borderRadius: 8 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  
  card: { backgroundColor: '#1e293b', padding: 16, borderRadius: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#334155' },
  cardContent: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cardOrg: { color: '#94a3b8', fontSize: 14, marginBottom: 4 },
  dateRow: { flexDirection: 'row', alignItems: 'center' },
  cardDate: { color: '#64748b', fontSize: 12 },
  
  thumbnail: { width: 50, height: 50, borderRadius: 8, marginHorizontal: 12, backgroundColor: '#000' },
  deleteBtn: { padding: 8 },
  
  emptyContainer: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#fff', fontSize: 18, marginTop: 16, fontWeight: '600' },
  emptySubText: { color: '#64748b', marginTop: 8 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#1e293b', padding: 24, borderRadius: 16 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  input: { backgroundColor: '#0f172a', color: '#fff', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  
  uploadBtn: { height: 120, backgroundColor: '#0f172a', borderRadius: 12, marginBottom: 20, overflow: 'hidden', borderWidth: 1, borderColor: '#334155', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  uploadPlaceholder: { alignItems: 'center' },
  uploadText: { color: '#94a3b8', marginTop: 8 },
  previewImage: { width: '100%', height: '100%' },
  
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 16, alignItems: 'center', borderRadius: 12, backgroundColor: '#334155' },
  saveBtn: { flex: 1, padding: 16, alignItems: 'center', borderRadius: 12, backgroundColor: '#3b82f6' },
  cancelText: { color: '#fff', fontWeight: '600' },
  saveText: { color: '#fff', fontWeight: 'bold' },
});
