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
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, ArrowRight, Plus, Trash2, Calendar, Briefcase, FileText, Upload } from 'lucide-react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/src/i18n/LanguageProvider';

interface WorkExperience {
  id: string;
  company_name: string;
  job_title: string;
  start_date: string;
  end_date: string | null;
  description: string | null;
  created_at: string;
}

export default function ExperienceScreen() {
  const router = useRouter();
  const { user } = useAuth();

  // ✅ Enable Translation & RTL
  const { t, isRTL } = useLanguage();

  const [experiences, setExperiences] = useState<WorkExperience[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingCV, setUploadingCV] = useState(false);
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);

  // Form State
  const [newExperience, setNewExperience] = useState({
    company_name: '',
    job_title: '',
    start_date: '',
    end_date: '',
    description: '',
  });

  useEffect(() => {
    if (user) {
      checkUserTypeAndRedirect();
    }
  }, [user]);

  const checkUserTypeAndRedirect = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('user_type')
        .eq('id', currentUser.id)
        .single();

      if (error) throw error;

      // Redirect agencies to company overview instead of experience
      if (data?.user_type === 'agency') {
        router.replace('/profile/edit');
        return;
      }

      fetchExperiences();
      fetchResumeUrl();
    } catch (error) {
      console.error('Error checking user type:', error);
      setLoading(false);
    }
  };

  const fetchExperiences = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('work_experience')
        .select('*')
        .eq('user_id', user?.id)
        .order('start_date', { ascending: false });

      if (error) throw error;
      setExperiences(data || []);
    } catch (error) {
      console.error('Error fetching experiences:', error);
      Alert.alert(t('Error'), t('Failed to load work experience'));
    } finally {
      setLoading(false);
    }
  };

  const fetchResumeUrl = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('resume_url')
        .eq('id', currentUser.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      setResumeUrl(data?.resume_url || null);
    } catch (error) {
      console.error('Error fetching resume URL:', error);
    }
  };

  const handleUploadCV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      setUploadingCV(true);
      const file = result.assets[0];
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
      const filePath = `${user?.id}/resume_${Date.now()}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('resumes')
        .upload(filePath, decode(base64), { contentType: 'application/pdf' });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('resumes')
        .getPublicUrl(filePath);

      const publicUrl = urlData?.publicUrl;

      if (!publicUrl) {
        throw new Error('Failed to get public URL');
      }

      // Update profile with resume URL
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ resume_url: publicUrl })
        .eq('id', currentUser.id);

      if (updateError) throw updateError;

      setResumeUrl(publicUrl);
      Alert.alert(t('Success'), t('CV uploaded successfully!'));
    } catch (error: any) {
      console.error('Upload failed:', error);
      Alert.alert(t('Error'), error.message || t('Failed to upload CV'));
    } finally {
      setUploadingCV(false);
    }
  };

  const handleAddExperience = async () => {
    if (!newExperience.company_name || !newExperience.job_title || !newExperience.start_date) {
      Alert.alert(t('Error'), t('Please fill in Company Name, Job Title, and Start Date'));
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('work_experience').insert({
        user_id: user?.id,
        company_name: newExperience.company_name,
        job_title: newExperience.job_title,
        start_date: newExperience.start_date,
        end_date: newExperience.end_date || null,
        description: newExperience.description || null,
      });

      if (error) throw error;

      setModalVisible(false);
      setNewExperience({ company_name: '', job_title: '', start_date: '', end_date: '', description: '' });
      fetchExperiences();
      Alert.alert(t('Success'), t('Work experience added!'));
    } catch (error: any) {
      Alert.alert(t('Error'), error.message || t('Failed to save'));
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
          await supabase.from('work_experience').delete().eq('id', id);
          fetchExperiences();
        }
      }
    ]);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('Present');
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    } catch {
      return dateString;
    }
  };

  const renderItem = ({ item }: { item: WorkExperience }) => (
    <View style={[styles.card, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <View style={styles.cardContent}>
        <View style={[styles.cardHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <Briefcase size={20} color="#00F5FF" style={isRTL ? { marginLeft: 8 } : { marginRight: 8 }} />
          <Text style={[styles.cardTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{item.job_title}</Text>
        </View>
        <Text style={[styles.cardCompany, { textAlign: isRTL ? 'right' : 'left' }]}>{item.company_name}</Text>
        <View style={[styles.dateRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <Calendar size={14} color="#64748b" />
          <Text style={[styles.cardDate, isRTL ? { marginRight: 4 } : { marginLeft: 4 }]}>
            {formatDate(item.start_date)} - {formatDate(item.end_date)}
          </Text>
        </View>
        {item.description && (
          <Text style={[styles.cardDescription, { textAlign: isRTL ? 'right' : 'left' }]} numberOfLines={2}>
            {item.description}
          </Text>
        )}
      </View>
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
            {isRTL ? <ArrowRight size={24} color="#fff" /> : <ArrowLeft size={24} color="#fff" />}
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('Work Experience & CV')}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00F5FF" />
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
        <Text style={styles.headerTitle}>{t('Work Experience & CV')}</Text>
        <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.addButton}>
          <Plus size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* CV Upload Section */}
        <View style={styles.cvSection}>
          <View style={[styles.cvHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <FileText size={20} color="#00F5FF" />
            <Text style={[styles.cvTitle, isRTL ? { marginRight: 8 } : { marginLeft: 8 }]}>{t('Resume / CV')}</Text>
          </View>
          {resumeUrl ? (
            <View style={styles.cvUploaded}>
              <View style={[styles.cvInfo, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
                <FileText size={24} color="#10B981" />
                <Text style={[styles.cvUploadedText, { textAlign: isRTL ? 'right' : 'left', marginRight: isRTL ? 12 : 0, marginLeft: isRTL ? 0 : 12 }]}>{t('CV Uploaded')}</Text>
                <TouchableOpacity
                  onPress={() => Alert.alert('CV', 'CV is available at: ' + resumeUrl)}
                  style={styles.viewCvButton}
                >
                  <Text style={styles.viewCvText}>{t('View')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.uploadCvButton}
              onPress={handleUploadCV}
              disabled={uploadingCV}
            >
              {uploadingCV ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Upload size={20} color="#fff" />
                  <Text style={styles.uploadCvText}>{t('Upload CV (PDF)')}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Work Experience List */}
        <View style={styles.experienceSection}>
          <Text style={[styles.sectionTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{t('Work History')}</Text>
          {experiences.length > 0 ? (
            <FlatList
              data={experiences}
              renderItem={renderItem}
              keyExtractor={item => item.id}
              scrollEnabled={false}
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Briefcase size={48} color="#334155" />
                  <Text style={styles.emptyText}>{t('No work experience yet.')}</Text>
                  <Text style={styles.emptySubText}>{t('Add your work history to showcase your expertise.')}</Text>
                </View>
              }
            />
          ) : (
            <View style={styles.emptyContainer}>
              <Briefcase size={48} color="#334155" />
              <Text style={styles.emptyText}>{t('No work experience yet.')}</Text>
              <Text style={styles.emptySubText}>{t('Tap + to add your first work experience.')}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Floating Add Button */}
      <TouchableOpacity
        style={[styles.fab, isRTL ? { left: 20, right: undefined } : { right: 20, left: undefined }]}
        onPress={() => setModalVisible(true)}
      >
        <Plus size={28} color="#000" />
      </TouchableOpacity>

      {/* Add Experience Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('Add Work Experience')}</Text>

            <TextInput
              style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]}
              placeholder={t('Company Name')}
              placeholderTextColor="#64748b"
              value={newExperience.company_name}
              onChangeText={t => setNewExperience({...newExperience, company_name: t})}
            />
            <TextInput
              style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]}
              placeholder={t('Job Title')}
              placeholderTextColor="#64748b"
              value={newExperience.job_title}
              onChangeText={t => setNewExperience({...newExperience, job_title: t})}
            />
            <TextInput
              style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]}
              placeholder={t('Start Date (YYYY-MM-DD)')}
              placeholderTextColor="#64748b"
              value={newExperience.start_date}
              onChangeText={t => setNewExperience({...newExperience, start_date: t})}
            />
            <TextInput
              style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]}
              placeholder={t('End Date (YYYY-MM-DD) or leave empty for current')}
              placeholderTextColor="#64748b"
              value={newExperience.end_date}
              onChangeText={t => setNewExperience({...newExperience, end_date: t})}
            />
            <TextInput
              style={[styles.input, styles.textArea, { textAlign: isRTL ? 'right' : 'left' }]}
              placeholder={t('Description (optional)')}
              placeholderTextColor="#64748b"
              value={newExperience.description}
              onChangeText={t => setNewExperience({...newExperience, description: t})}
              multiline
              numberOfLines={4}
            />

            <View style={[styles.modalActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText}>{t('Cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleAddExperience} disabled={saving}>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b'
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  backButton: { padding: 8 },
  addButton: { backgroundColor: '#00F5FF', padding: 8, borderRadius: 8 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, padding: 20 },

  // CV Section
  cvSection: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cvHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  cvTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  uploadCvButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00F5FF',
    padding: 14,
    borderRadius: 12,
  },
  uploadCvText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '600',
  },
  cvUploaded: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  cvInfo: {
    alignItems: 'center',
  },
  cvUploadedText: {
    color: '#10B981',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  viewCvButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  viewCvText: {
    color: '#10B981',
    fontSize: 13,
    fontWeight: '600',
  },

  // Experience Section
  experienceSection: {
    marginTop: 8,
  },
  sectionTitle: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155'
  },
  cardContent: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  cardTitle: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cardCompany: { color: '#00F5FF', fontSize: 14, marginBottom: 4, fontWeight: '500' },
  dateRow: { alignItems: 'center', marginBottom: 4 },
  cardDate: { color: '#64748b', fontSize: 12 },
  cardDescription: { color: '#94a3b8', fontSize: 13, marginTop: 8 },
  deleteBtn: { padding: 8 },

  emptyContainer: { alignItems: 'center', marginTop: 60, paddingVertical: 40 },
  emptyText: { color: '#fff', fontSize: 18, marginTop: 16, fontWeight: '600' },
  emptySubText: { color: '#64748b', marginTop: 8, textAlign: 'center' },

  // Floating Action Button
  fab: {
    position: 'absolute',
    bottom: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#00F5FF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#00F5FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#1e293b', padding: 24, borderRadius: 16 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  input: {
    backgroundColor: '#0f172a',
    color: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155'
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  modalActions: { gap: 12, marginTop: 8 },
  cancelBtn: { flex: 1, padding: 16, alignItems: 'center', borderRadius: 12, backgroundColor: '#334155' },
  saveBtn: { flex: 1, padding: 16, alignItems: 'center', borderRadius: 12, backgroundColor: '#00F5FF' },
  cancelText: { color: '#fff', fontWeight: '600' },
  saveText: { color: '#000', fontWeight: 'bold' },
});
