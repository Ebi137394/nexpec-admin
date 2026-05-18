import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Image,
  ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';
// ★ Phase 3 / Task 2 — offline-first outbox.
//   The inspection_reports INSERT goes through enqueueReportSave so
//   transient network failures don't lose the user's submission.
//   File uploads stay synchronous because in custom mode the URLs
//   must be embedded into the notes string before insert.
import { enqueueReportSave } from '@/lib/offline';

const COLORS = {
  background: '#020420', cardBackground: '#0A0D2C', cardBorder: '#1A1D3C',
  primary: '#7C3AED', primaryLight: '#8B5CF6', textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8', textMuted: '#64748B', success: '#10B981',
  danger: '#ef4444', warning: '#F59E0B',
};

type ReportMode = 'standard' | 'custom';

interface Props {
  onClose?: () => void;
}

export default function InspectionScreen({ onClose }: Props) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  
  const [mode, setMode] = useState<ReportMode>('standard');
  const [uploading, setUploading] = useState(false);
  const [jobTitle, setJobTitle] = useState('Inspection');

  const [findings, setFindings] = useState('');
  const [recommendations, setRecommendations] = useState('');
  const [externalLink, setExternalLink] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [signatureName, setSignatureName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [documents, setDocuments] = useState<{ uri: string; name: string }[]>([]);

  useEffect(() => {
    if (id) {
      supabase.from('jobs').select('title').eq('id', id).single().then(({ data }) => {
        if (data?.title) setJobTitle(data.title);
      });
    }
  }, [id]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.6,
    });
    if (!result.canceled) setImage(result.assets[0].uri);
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
        multiple: true, // Allow multiple files
      });
      if (!result.canceled && result.assets.length > 0) {
        const newDocs = result.assets.map(a => ({ uri: a.uri, name: a.name }));
        setDocuments(prev => [...prev, ...newDocs]);
      }
    } catch (error) { Alert.alert('Error', 'Failed to pick documents.'); }
  };

  const removeDocument = (indexToRemove: number) => {
    setDocuments(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const uploadFileToStorage = async (uri: string, isDocument: boolean) => {
    if (!user?.id) throw new Error("Authentication error");
    const ext = uri.substring(uri.lastIndexOf('.') + 1) || (isDocument ? 'pdf' : 'jpg');
    const fileName = `rep_${Date.now()}.${ext}`;
    const filePath = `${user.id}/${fileName}`;

    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    const contentType = isDocument ? (ext.includes('pdf') ? 'application/pdf' : 'application/msword') : `image/${ext}`;

    const { error } = await supabase.storage.from('inspection-photos').upload(filePath, decode(base64), { contentType });
    if (error) throw error;
    
    return supabase.storage.from('inspection-photos').getPublicUrl(filePath).data.publicUrl;
  };

  const handleSubmit = async () => {
    if (!user?.id) return Alert.alert('Error', 'Not logged in!');
    
    if (mode === 'standard') {
      if (!findings.trim()) return Alert.alert('Missing Info', 'Please enter findings.');
      if (!image) return Alert.alert('Missing Photo', 'Please upload a photo.');
      if (!signatureName.trim() || !agreed) return Alert.alert('Signature Required', 'Sign and agree to terms.');
    } else {
      if (documents.length === 0 && !externalLink.trim()) return Alert.alert('Missing Info', 'Upload at least one document or provide an external link.');
    }

    setUploading(true);
    try {
      let primaryPhotoUrl = null;
      let finalNotes = '';

      if (mode === 'standard') {
        primaryPhotoUrl = await uploadFileToStorage(image as string, false);
        finalNotes = `[STANDARD REPORT]\n\nFINDINGS:\n${findings.trim()}\n\nRECOMMENDATIONS:\n${recommendations.trim()}\n\nSIGNED BY: ${signatureName.trim()}`;
      } else {
        finalNotes = `[CUSTOM DOCUMENTS UPLOADED]\n`;
        for (let i = 0; i < documents.length; i++) {
          const url = await uploadFileToStorage(documents[i].uri, true);
          finalNotes += `${i + 1}. ${documents[i].name}\nLink: ${url}\n\n`;
        }
      }

      if (externalLink.trim()) {
        finalNotes += `\n\nEXTERNAL LINKS / GOOGLE DRIVE:\n${externalLink.trim()}`;
      }

      // Enqueue the report row insert. Returns immediately even when
      // offline; the sync engine drains when connectivity returns.
      // client_op_id makes this idempotent server-side.
      await enqueueReportSave({
        job_id: id!,
        inspector_id: user.id,
        notes: finalNotes,
        photo_url: primaryPhotoUrl ?? undefined,
      });

      const { error: updateError } = await supabase.from('jobs').update({
        status: 'completed'
      }).eq('id', id);
      if (updateError) throw updateError;

      Alert.alert('Report Submitted! 🚀', 'Your inspection is now complete.', [
        { text: 'OK', onPress: () => router.push('/(tabs)/my-jobs' as any) }
      ]);

    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to submit report');
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        
        <View style={styles.header}>
          <TouchableOpacity onPress={() => onClose ? onClose() : router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#FFF" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.title}>Inspection Center</Text>
            <Text style={styles.subtitle} numberOfLines={1}>{jobTitle}</Text>
          </View>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity style={[styles.tab, mode === 'standard' && styles.activeTab]} onPress={() => setMode('standard')}>
            <Text style={[styles.tabTxt, mode === 'standard' && styles.activeTabTxt]}>Standard Form</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, mode === 'custom' && styles.activeTab]} onPress={() => setMode('custom')}>
            <Text style={[styles.tabTxt, mode === 'custom' && styles.activeTabTxt]}>Custom (Word/PDF)</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {mode === 'standard' ? (
            <>
              <Text style={styles.label}>Inspection Findings <Text style={styles.req}>*</Text></Text>
              <TextInput style={styles.input} placeholder="Detail the condition..." placeholderTextColor={COLORS.textMuted} multiline value={findings} onChangeText={setFindings} />

              <Text style={styles.label}>Recommendations</Text>
              <TextInput style={styles.input} placeholder="Your suggestions..." placeholderTextColor={COLORS.textMuted} multiline value={recommendations} onChangeText={setRecommendations} />

              {/* NEW EXTERNAL LINK FIELD */}
              <Text style={styles.label}>External Links / Drive (Optional)</Text>
              <TextInput 
                style={[styles.input, { minHeight: 60 }]} 
                placeholder="Paste Google Drive, Dropbox, or Document link..." 
                placeholderTextColor={COLORS.textMuted} 
                multiline 
                value={externalLink} 
                onChangeText={setExternalLink} 
              />

              <Text style={styles.label}>Evidence Photo <Text style={styles.req}>*</Text></Text>
              <TouchableOpacity style={styles.uploadBox} onPress={pickImage}>
                {image ? <Image source={{ uri: image }} style={{ width: '100%', height: '100%' }} /> : <View style={{ alignItems: 'center' }}><Ionicons name="camera" size={32} color={COLORS.primary} /><Text style={{ color: COLORS.primaryLight, marginTop: 8 }}>Tap to upload</Text></View>}
              </TouchableOpacity>

              <Text style={styles.label}>E-Signature <Text style={styles.req}>*</Text></Text>
              <View style={styles.sigBox}>
                <TextInput style={styles.sigInput} placeholder="Type legal name..." placeholderTextColor={COLORS.textMuted} value={signatureName} onChangeText={setSignatureName} />
                <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} onPress={() => setAgreed(!agreed)}>
                  <Ionicons name={agreed ? "checkbox" : "square-outline"} size={22} color={agreed ? COLORS.success : COLORS.textMuted} />
                  <Text style={{ flex: 1, color: COLORS.textSecondary, fontSize: 12 }}>I certify this is accurate and adheres to safety protocols.</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.customBox}>
              <Ionicons name="document-attach" size={48} color={COLORS.primary} />
              <Text style={{ color: '#FFF', fontSize: 16, marginVertical: 12 }}>Upload Client Document</Text>
              <TouchableOpacity style={styles.btn} onPress={pickDocument}>
                <Text style={{ color: '#FFF', fontWeight: '700' }}>Browse Files (Multiple allowed)</Text>
              </TouchableOpacity>
              
              {documents.length > 0 && (
                <View style={{ marginTop: 16, width: '100%', gap: 8 }}>
                  {documents.map((doc, idx) => (
                    <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#10B98115', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#10B98140' }}>
                      <Ionicons name="document-text" size={20} color={COLORS.success} />
                      <Text style={{ color: COLORS.textPrimary, flex: 1, marginLeft: 8, fontSize: 13 }} numberOfLines={1}>{doc.name}</Text>
                      <TouchableOpacity onPress={() => removeDocument(idx)} style={{ padding: 4 }}>
                        <Ionicons name="close-circle" size={22} color={COLORS.danger} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              
              {/* NEW EXTERNAL LINK FIELD FOR CUSTOM TAB AS WELL */}
              <Text style={[styles.label, { marginTop: 24, alignSelf: 'flex-start' }]}>External Links (Optional)</Text>
              <TextInput 
                style={[styles.input, { width: '100%', minHeight: 60 }]} 
                placeholder="Paste external link..." 
                placeholderTextColor={COLORS.textMuted} 
                multiline 
                value={externalLink} 
                onChangeText={setExternalLink} 
              />
            </View>
          )}
          <View style={{ height: 40 }} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={[styles.submitBtn, uploading && { opacity: 0.6 }]} onPress={handleSubmit} disabled={uploading}>
            {uploading ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 16 }}>Submit Report</Text>}
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder },
  backBtn: { padding: 8, backgroundColor: COLORS.cardBackground, borderRadius: 12 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#FFF' }, subtitle: { color: COLORS.primaryLight },
  tabs: { flexDirection: 'row', padding: 16, gap: 10 },
  tab: { flex: 1, padding: 12, backgroundColor: COLORS.cardBackground, borderRadius: 10, alignItems: 'center' },
  activeTab: { backgroundColor: '#7C3AED20', borderColor: COLORS.primary, borderWidth: 1 },
  tabTxt: { color: COLORS.textMuted, fontWeight: 'bold' }, activeTabTxt: { color: COLORS.primaryLight },
  content: { padding: 16 }, label: { color: '#FFF', fontWeight: 'bold', marginVertical: 8 }, req: { color: COLORS.danger },
  input: { backgroundColor: COLORS.cardBackground, borderRadius: 12, padding: 16, color: '#FFF', minHeight: 100, textAlignVertical: 'top' },
  uploadBox: { height: 150, backgroundColor: COLORS.cardBackground, borderRadius: 12, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.primary },
  sigBox: { backgroundColor: COLORS.cardBackground, padding: 16, borderRadius: 12 },
  sigInput: { fontSize: 18, color: '#FFF', borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder, paddingBottom: 8, marginBottom: 12 },
  customBox: { backgroundColor: COLORS.cardBackground, padding: 30, borderRadius: 16, alignItems: 'center', marginTop: 20 },
  btn: { backgroundColor: COLORS.primary, padding: 14, borderRadius: 12, width: '100%', alignItems: 'center' },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: COLORS.cardBorder, backgroundColor: COLORS.background },
  submitBtn: { backgroundColor: COLORS.success, padding: 16, borderRadius: 12, alignItems: 'center' }
});