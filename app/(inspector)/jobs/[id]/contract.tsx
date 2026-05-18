import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

const COLORS = {
  background: '#020420',
  cardBackground: '#0A0D2C',
  cardBorder: '#1A1D3C',
  primary: '#7C3AED',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  success: '#10B981',
  danger: '#EF4444',
  inputBg: '#0F1235'
};

export default function ContractScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [signatureName, setSignatureName] = useState('');
  const [isAgreed, setIsAgreed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);

  const todayDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const handleUploadContract = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/jpeg', 'image/png'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets.length > 0) {
        setUploading(true);
        const file = result.assets[0];
        const ext = file.name.split('.').pop() || 'pdf';
        const fileName = `custom_contract_${Date.now()}.${ext}`;
        const filePath = `contracts/${user?.id}/${fileName}`;

        const response = await fetch(file.uri);
        const blob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(filePath, blob);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from('documents')
          .getPublicUrl(filePath);

        setUploadedFileUrl(publicUrlData.publicUrl);
        setUploadedFileName(file.name);
        Alert.alert('Success', 'Custom contract file uploaded successfully!');
      }
    } catch (error: any) {
      Alert.alert('Upload Error', error.message || 'Failed to upload document.');
    } finally {
      setUploading(false);
    }
  };

  const handleSignAndSubmit = async () => {
    if (!isAgreed) {
      Alert.alert('Required', 'You must agree to the terms by checking the box.');
      return;
    }
    if (signatureName.trim().length < 3) {
      Alert.alert('Required', 'Please type your full legal name as your signature.');
      return;
    }

    setSubmitting(true);
    try {
      // تمیز کردن آیدی برای جلوگیری از باگ‌های احتمالی Expo Router
      const currentJobId = String(id).trim();

      const { data: jobData, error: jobError } = await supabase
        .from('jobs')
        .select('client_id, payout_amount_cents')
        .eq('id', currentJobId)
        .single();

      if (jobError) throw new Error(`Fetch job error: ${jobError.message}`);

      const { data: existingContract } = await supabase
        .from('contracts')
        .select('id')
        .eq('job_id', currentJobId)
        .maybeSingle();

      // ★ Authoritative `contracts` schema (verified via information_schema):
      //   id, job_id, client_id, contractor_id, status, total_amount,
      //   contract_text, document_url, external_link,
      //   client_signature, contractor_signature,
      //   client_signed_at, contractor_signed_at, signed_at,
      //   start_date, end_date, created_at, updated_at.
      //   Notably ABSENT: pdf_url, inspector_id, worker_id, contract_number.
      //   Earlier insert attempts wrote to those phantom columns and were
      //   rejected by PostgREST with PGRST204.
      const nowIso = new Date().toISOString();
      const trimmedSignature = signatureName.trim();

      // ★ Task 4: jobs.payout_amount → payout_amount_cents (already integer cents).
      //   contracts.total_amount → total_amount_cents. Forward integer-to-integer.
      const payoutCents = (jobData as any).payout_amount_cents ?? 0;

      if (existingContract) {
        const { error: updateError } = await supabase
          .from('contracts')
          .update({
            status: 'signed',
            total_amount_cents: payoutCents,  // ★ Task 4
            document_url: uploadedFileUrl ?? null,
            contractor_signature: trimmedSignature,
            contractor_signed_at: nowIso,
            signed_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', existingContract.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('contracts')
          .insert({
            job_id: currentJobId,
            contractor_id: user?.id,
            client_id: jobData.client_id,
            status: 'signed',
            total_amount_cents: payoutCents,  // ★ Task 4
            document_url: uploadedFileUrl ?? null,
            contractor_signature: trimmedSignature,
            contractor_signed_at: nowIso,
            signed_at: nowIso,
          });
        if (insertError) throw insertError;
      }

      Alert.alert('Contract Signed! 📝', 'Your agreement has been securely submitted to NEXPEC.', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error: any) {
      Alert.alert('Submission Error', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Job Agreement</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.securityBanner}>
          <Ionicons name="shield-checkmark" size={24} color={COLORS.success} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: COLORS.success, fontWeight: 'bold', fontSize: 14 }}>Secure Digital Signature</Text>
            <Text style={{ color: '#D1FAE5', fontSize: 12, marginTop: 4 }}>This document is legally binding. A copy will be sent to the NEXPEC administrators.</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="cloud-upload-outline" size={20} color={COLORS.primary} />
            <Text style={styles.cardTitle}>Custom Company Contract</Text>
          </View>
          <Text style={styles.cardDesc}>
            Did the client or agency provide a specific contract file? Upload the signed PDF or image here. (Optional)
          </Text>
          <TouchableOpacity style={styles.uploadBtn} onPress={handleUploadContract} disabled={uploading}>
            {uploading ? <ActivityIndicator color={COLORS.primary} /> : (
              <>
                <Ionicons name="document-attach-outline" size={20} color={COLORS.primary} />
                <Text style={styles.uploadBtnText}>{uploadedFileName ? 'Replace Uploaded File' : 'Select File to Upload'}</Text>
              </>
            )}
          </TouchableOpacity>
          {uploadedFileName && <Text style={styles.successText}>📎 Attached: {uploadedFileName}</Text>}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="reader-outline" size={20} color={COLORS.textPrimary} />
            <Text style={styles.cardTitle}>Standard Inspection Terms</Text>
          </View>
          <View style={styles.termsBox}>
            <ScrollView nestedScrollEnabled={true} showsVerticalScrollIndicator={true}>
              <Text style={styles.termsText}>
                By signing this agreement, the Inspector agrees to perform the requested services professionally, accurately, and within the stipulated timeframe. {"\n\n"}
                1. INDEPENDENT CONTRACTOR: The Inspector acts as an independent contractor, not an employee.{"\n"}
                2. CONFIDENTIALITY: All findings, photos, and reports must remain strictly confidential between the Inspector, the Client, and NEXPEC.{"\n"}
                3. LIABILITY: The Inspector must adhere to local safety regulations. NEXPEC is not liable for on-site injuries.{"\n"}
                4. PAYMENT: Funds will be released via escrow upon client approval of the final submitted report.
              </Text>
            </ScrollView>
          </View>
        </View>

        <View style={styles.signatureCard}>
          <Text style={styles.signatureTitle}>Digital Signature</Text>
          <TouchableOpacity style={styles.checkboxRow} onPress={() => setIsAgreed(!isAgreed)} activeOpacity={0.7}>
            <View style={[styles.checkbox, isAgreed && styles.checkboxActive]}>
              {isAgreed && <Ionicons name="checkmark" size={16} color="#FFF" />}
            </View>
            <Text style={styles.checkboxText}>I have read, understood, and agree to the terms and conditions outlined above.</Text>
          </TouchableOpacity>
          <Text style={styles.inputLabel}>Type your full legal name to sign:</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="create-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 10 }} />
            <TextInput style={styles.textInput} placeholder="e.g. John Doe" placeholderTextColor={COLORS.textSecondary} value={signatureName} onChangeText={setSignatureName} />
          </View>
          <View style={styles.dateRow}>
            <Text style={styles.dateLabel}>Date:</Text>
            <Text style={styles.dateValue}>{todayDate}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity 
          style={[styles.submitBtn, (!isAgreed || signatureName.length < 3) && styles.submitBtnDisabled]} 
          onPress={handleSignAndSubmit} 
          disabled={submitting || !isAgreed || signatureName.length < 3}
        >
          {submitting ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitBtnText}>Sign & Submit to Admin</Text>}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder },
  backBtn: { padding: 8, backgroundColor: COLORS.cardBackground, borderRadius: 12 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: 'bold', color: COLORS.textPrimary },
  scrollContent: { padding: 16, paddingBottom: 40 },
  securityBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: 16, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: 'rgba(16, 185, 129, 0.3)' },
  card: { backgroundColor: COLORS.cardBackground, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 20 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.textPrimary, marginLeft: 8 },
  cardDesc: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 20, marginBottom: 16 },
  uploadBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(124, 58, 237, 0.1)', padding: 14, borderRadius: 12, borderWidth: 1, borderColor: COLORS.primary, borderStyle: 'dashed' },
  uploadBtnText: { color: COLORS.primary, fontWeight: 'bold', marginLeft: 8 },
  successText: { color: COLORS.success, fontSize: 12, marginTop: 12, fontWeight: '600' },
  termsBox: { backgroundColor: '#020420', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: COLORS.cardBorder, maxHeight: 200 },
  termsText: { color: COLORS.textSecondary, fontSize: 13, lineHeight: 22 },
  signatureCard: { backgroundColor: COLORS.cardBackground, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: COLORS.primary },
  signatureTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.primary, marginBottom: 16 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: COLORS.textSecondary, justifyContent: 'center', alignItems: 'center', marginRight: 12, marginTop: 2 },
  checkboxActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  checkboxText: { flex: 1, color: COLORS.textPrimary, fontSize: 14, lineHeight: 20 },
  inputLabel: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 8, fontWeight: '600' },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.inputBg, borderRadius: 12, paddingHorizontal: 16, height: 54, borderWidth: 1, borderColor: COLORS.cardBorder, marginBottom: 16 },
  textInput: { flex: 1, color: COLORS.textPrimary, fontSize: 16, fontWeight: '500' },
  dateRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', padding: 12, borderRadius: 8 },
  dateLabel: { color: COLORS.textSecondary, fontSize: 14 },
  dateValue: { color: COLORS.textPrimary, fontSize: 14, fontWeight: 'bold' },
  footer: { padding: 16, backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  submitBtn: { backgroundColor: COLORS.primary, paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' }
});