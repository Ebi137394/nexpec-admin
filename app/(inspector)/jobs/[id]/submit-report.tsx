import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  Alert, ScrollView, KeyboardAvoidingView, Platform, Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker'; // ✅ Required for Word docs
import * as FileSystem from 'expo-file-system'; // ✅ Required for downloading templates
import * as Sharing from 'expo-sharing'; // ✅ Required for opening downloaded files
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

// Match your app's theme colors
const COLORS = {
  background: '#020420',
  card: '#1e293b',
  border: '#334155',
  primary: '#7C3AED', // Purple to match your branding
  text: '#FFFFFF',
  textDim: '#94A3B8',
  textSecondary: '#94A3B8', // Alias for backward compatibility
  success: '#10B981',
  warning: '#F59E0B',
};

export default function SubmitReportScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [jobData, setJobData] = useState<any>(null);
  const [image, setImage] = useState<string | null>(null);
  const [document, setDocument] = useState<any>(null); // ✅ Store selected doc
  const [downloading, setDownloading] = useState(false);
  
  // ── NEW: Signature state ──────────────────────────────────
  const [signature, setSignature] = useState<string | null>(null);
  const signatureRef = useRef<SignatureViewRef>(null);

  useEffect(() => {
    if (jobId) fetchJobDetails();
  }, [jobId]);

  const fetchJobDetails = async () => {
    // We check if this job has a specific template_url
    const { data } = await supabase.from('jobs').select('title, template_url').eq('id', jobId).single();
    if (data) setJobData(data);
  };

  // ✅ 1. Function to Download Client Template
  const downloadTemplate = async () => {
    if (!jobData?.template_url) return;
    setDownloading(true);
    try {
      const fileUri = FileSystem.documentDirectory + 'inspection-template.docx';
      const { uri } = await FileSystem.downloadAsync(jobData.template_url, fileUri);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('Saved', 'File saved to: ' + uri);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to download template');
    } finally {
      setDownloading(false);
    }
  };

  // ✅ 2. Function to Pick Document (Word/PDF)
  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf'],
        copyToCacheDirectory: true,
      });

      if (result.assets && result.assets.length > 0) {
        // Limit file size to 100MB to be safe
        if (result.assets[0].size && result.assets[0].size > 100 * 1024 * 1024) {
          Alert.alert('File too large', 'Please upload a file smaller than 100MB.');
          return;
        }
        setDocument(result.assets[0]);
      }
    } catch (err) {
      console.log('Document picker error', err);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, quality: 0.5, base64: true });
    if (!result.canceled) setImage(result.assets[0].uri);
  };

  // ── Signature pad web style (injected into the WebView) ───
  const signatureWebStyle = `.m-signature-pad--footer { display: none; margin: 0px; }
    .m-signature-pad { box-shadow: none; border: none; }
    .m-signature-pad--body { border: none; }
    body, html { width: 100%; height: 100%; margin: 0; padding: 0; }
    canvas { width: 100% !important; height: 100% !important; }`;

  // ── NEW: Signature handlers ───────────────────────────────
  const handleSignatureOK = (sig: string) => {
    // sig is a base64 data URI like "data:image/png;base64,iVBOR..."
    setSignature(sig);
  };

  const handleSignatureEmpty = () => {
    setSignature(null);
  };

  const handleClearSignature = () => {
    signatureRef.current?.clearSignature();
    setSignature(null);
  };

  const handleSignatureEnd = () => {
    // Trigger read after the user lifts their finger
    signatureRef.current?.readSignature();
  };

  const handleSignatureBegin = () => {
    // Disable parent ScrollView while user is drawing
    // This prevents scrolling while drawing
  };

  const handleSignatureTouchEnd = () => {
    // Re-enable parent ScrollView
    // This is handled automatically by the signature component
  };

  // ── Form validation ───────────────────────────────────────
  const isFormValid = notes.trim().length > 0 && signature !== null;

  // ── Submit handler (updated with signature) ───────────────
  const handleSubmit = async () => {
    if (!notes.trim()) {
      Alert.alert('Validation Error', 'Notes cannot be empty');
      return;
    }

    if (!signature) {
      Alert.alert('Signature Required', 'Please sign the report before submitting.');
      return;
    }

    if (!user?.id) return;
    setLoading(true);

    try {
      let photoUrl = null;
      let docUrl = null;

      // 1. Upload Photo (if exists)
      if (image) {
        const fileName = `photos/${user.id}/${Date.now()}.jpg`;
        const response = await fetch(image);
        const blob = await response.blob();
        await supabase.storage.from('inspection-photos').upload(fileName, blob);
        const { data } = supabase.storage.from('inspection-photos').getPublicUrl(fileName);
        photoUrl = data.publicUrl;
      }

      // 2. Upload Document (if exists)
      if (document) {
        const fileExt = document.name.split('.').pop();
        const docName = `reports/${user.id}/${Date.now()}.${fileExt}`;
        const response = await fetch(document.uri);
        const blob = await response.blob();

        // Upload to the NEW bucket created in Step 1
        const { error: uploadError } = await supabase.storage
          .from('job-documents')
          .upload(docName, blob);

        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from('job-documents').getPublicUrl(docName);
        docUrl = data.publicUrl;
      }

      // 3. Save Report to Database (UPDATED: includes signature)
      const { error } = await supabase.from('inspection_reports').insert({
        job_id: jobId,
        inspector_id: user.id,
        notes: notes.trim(),
        photo_url: photoUrl,
        final_report_doc: docUrl,
        signature: signature, // ✅ Base64 signature included
      });

      if (error) throw error;

      // 4. Update Job Status
      await supabase.from('jobs').update({ status: 'under_review' }).eq('id', jobId);

      Alert.alert('Success', 'Report submitted successfully!', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/my-jobs') }
      ]);
    } catch (err: any) {
      const errorMessage = err.message || 'Unknown error occurred';
      Alert.alert(
        'Submission Failed',
        `Message: ${errorMessage}\n\nEnsure the 'signature' column (TEXT) exists on the reports table.`
      );
      console.error('Supabase Insert Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color="#FFF" /></TouchableOpacity>
          <Text style={styles.headerTitle}>Submit Report</Text>
        </View>

        <ScrollView contentContainerStyle={styles.content}>

          {/* ✅ SECTION A: DOWNLOAD TEMPLATE (Only shows if client uploaded one) */}
          {jobData?.template_url && (
            <TouchableOpacity style={styles.downloadCard} onPress={downloadTemplate} disabled={downloading}>
              <View style={styles.iconCircle}>
                {downloading ? <ActivityIndicator color="#FFF" /> : <Ionicons name="cloud-download-outline" size={24} color="#FFF" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Client Template Available</Text>
                <Text style={styles.cardSub}>Download the required Word format</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}

          {/* ✅ SECTION B: UPLOAD COMPLETED DOC */}
          <Text style={styles.sectionLabel}>1. Upload Completed Report (Word/PDF)</Text>
          <TouchableOpacity style={styles.uploadBox} onPress={pickDocument}>
            {document ? (
              <View style={styles.filePreview}>
                <Ionicons name="document-text" size={32} color={COLORS.primary} />
                <Text style={styles.fileName}>{document.name}</Text>
                <Text style={styles.fileSize}>{(document.size / 1024 / 1024).toFixed(2)} MB</Text>
              </View>
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={32} color={COLORS.textSecondary} />
                <Text style={styles.uploadText}>Tap to upload .docx or .pdf</Text>
              </>
            )}
          </TouchableOpacity>

          {/* SECTION C: EVIDENCE PHOTO */}
          <Text style={styles.sectionLabel}>2. Evidence Photo (Optional)</Text>
          <TouchableOpacity style={styles.photoBox} onPress={pickImage}>
            {image ? <Image source={{ uri: image }} style={{ width: '100%', height: '100%' }} /> : (
              <View style={{ alignItems: 'center' }}>
                <Ionicons name="camera-outline" size={32} color={COLORS.textSecondary} />
                <Text style={styles.uploadText}>Tap to take photo</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* NOTES */}
          <Text style={styles.sectionLabel}>3. Additional Notes</Text>
          <TextInput
            style={styles.input}
            placeholder="Any extra comments..."
            placeholderTextColor={COLORS.textSecondary}
            multiline
            value={notes}
            onChangeText={setNotes}
          />

          {/* ── NEW: Inspector Signature ────────────────────── */}
          <Text style={styles.sectionLabel}>4. Inspector Signature</Text>
          
          {/* Signature Canvas Container */}
          <View style={styles.signatureContainer}>
            <View style={styles.signatureCanvasWrapper}>
              <SignatureScreen
                ref={signatureRef}
                onOK={handleSignatureOK}
                onEmpty={handleSignatureEmpty}
                onEnd={handleSignatureEnd}
                onBegin={handleSignatureBegin}
                autoClear={false}
                descriptionText=""
                webStyle={signatureWebStyle}
                backgroundColor="#FFFFFF"
                penColor="#020617"
                dotSize={2}
                minWidth={1.5}
                maxWidth={3}
                trimWhitespace
                imageType="image/png"
                style={styles.signatureCanvas}
              />

              {/* Hint overlay — shown only before first stroke */}
              {!signature && (
                <View style={styles.signatureHintOverlay} pointerEvents="none">
                  <Ionicons name="pencil-outline" size={24} color="#CBD5E1" />
                  <Text style={styles.signatureHintText}>
                    Sign here with your finger
                  </Text>
                </View>
              )}
            </View>

            {/* Clear Button */}
            <TouchableOpacity
              style={styles.clearSignatureButton}
              onPress={handleClearSignature}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={18} color="#EF4444" />
              <Text style={styles.clearSignatureText}>Clear</Text>
            </TouchableOpacity>
          </View>

          {/* Signature Preview (after signing) */}
          {signature && (
            <View style={styles.signaturePreviewContainer}>
              <Text style={styles.signaturePreviewLabel}>Preview</Text>
              <View style={styles.signaturePreviewBox}>
                <Image
                  source={{ uri: signature }}
                  style={styles.signaturePreviewImage}
                  resizeMode="contain"
                />
              </View>
            </View>
          )}

          {/* ── Submit Button (disabled until signed) ───────── */}
          <TouchableOpacity
            style={[
              styles.submitBtn,
              (!isFormValid || loading) && styles.submitBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={loading || !isFormValid}
          >
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>Submit Report</Text>}
          </TouchableOpacity>

          {/* Validation hint */}
          {!isFormValid && (
            <Text style={styles.validationHint}>
              {!notes.trim()
                ? '⚠ Notes are required'
                : !signature
                ? '⚠ Signature is required to submit'
                : ''}
            </Text>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: 20, flexDirection: 'row', alignItems: 'center', gap: 15 },
  headerTitle: { color: '#FFF', fontSize: 20, fontWeight: 'bold' },
  content: { padding: 20 },
  sectionLabel: { color: '#FFF', fontSize: 14, fontWeight: 'bold', marginTop: 20, marginBottom: 8 },

  // Styles for Download/Upload cards
  downloadCard: { flexDirection: 'row', backgroundColor: '#1E293B', padding: 15, borderRadius: 12, alignItems: 'center', gap: 12, marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  cardTitle: { color: '#FFF', fontWeight: 'bold' },
  cardSub: { color: COLORS.textSecondary, fontSize: 12 },

  uploadBox: { height: 100, backgroundColor: '#0A0E2E', borderRadius: 12, borderWidth: 1, borderColor: '#1A1F4E', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  photoBox: { height: 180, backgroundColor: '#0A0E2E', borderRadius: 12, borderWidth: 1, borderColor: '#1A1F4E', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' },
  uploadText: { color: COLORS.textSecondary, marginTop: 8 },

  filePreview: { alignItems: 'center' },
  fileName: { color: '#FFF', fontWeight: 'bold', marginTop: 5 },
  fileSize: { color: COLORS.textSecondary, fontSize: 12 },

  input: { backgroundColor: '#0A0E2E', borderRadius: 12, padding: 15, color: '#FFF', minHeight: 100, textAlignVertical: 'top', borderWidth: 1, borderColor: '#1A1F4E' },
  submitBtn: { backgroundColor: COLORS.primary, padding: 18, borderRadius: 12, alignItems: 'center', marginTop: 30 },
  submitBtnDisabled: { backgroundColor: '#334155', shadowOpacity: 0 },
  btnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },

  // ── Signature Styles ──────────────────────────────────────
  signatureContainer: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  signatureCanvasWrapper: {
    height: 200,
    width: '100%',
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
    overflow: 'hidden',
  },
  signatureCanvas: {
    flex: 1,
    width: '100%',
    height: 200,
  },
  signatureHintOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },
  signatureHintText: {
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 6,
    fontWeight: '500',
  },
  clearSignatureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  clearSignatureText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
  },

  // ── Signature Preview ─────────────────────────────────────
  signaturePreviewContainer: {
    marginTop: 12,
  },
  signaturePreviewLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  signaturePreviewBox: {
    height: 80,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#334155',
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signaturePreviewImage: {
    width: '100%',
    height: '100%',
  },

  // ── Validation Hint ───────────────────────────────────────
  validationHint: {
    textAlign: 'center',
    color: '#F59E0B',
    fontSize: 13,
    marginTop: 12,
    fontWeight: '500',
  },
});
