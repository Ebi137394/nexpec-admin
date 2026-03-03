import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

const COLORS = {
  background: '#020420',
  cardBackground: '#1e293b',
  cardBorder: '#334155',
  primary: '#3b82f6',
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  success: '#10B981',
  danger: '#ef4444',
};

export default function InspectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [notes, setNotes] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 1. Pick Image
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.5, // Keep quality low for faster uploads
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
  };

  // 2. Upload Image to Supabase Storage
  const uploadImageToStorage = async (uri: string) => {
    const ext = uri.substring(uri.lastIndexOf('.') + 1);
    const fileName = `${Date.now()}.${ext}`;
    const filePath = `${user?.id}/${fileName}`;

    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const { error } = await supabase.storage
      .from('inspection-photos') // Using the bucket we created earlier
      .upload(filePath, decode(base64), {
        contentType: `image/${ext}`,
      });

    if (error) throw error;

    // Get Public URL
    const { data } = supabase.storage
      .from('inspection-photos')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  // 3. Submit Final Report
  const handleSubmit = async () => {
    if (!notes.trim()) {
      Alert.alert('Missing Info', 'Please add some inspection notes.');
      return;
    }
    if (!image) {
      Alert.alert('Missing Photo', 'Please upload an inspection photo.');
      return;
    }

    setUploading(true);

    try {
      // A. Upload Photo
      const photoUrl = await uploadImageToStorage(image);

      // B. Save Report to Database
      const { error: reportError } = await supabase
        .from('inspection_reports')
        .insert({
          job_id: id,
          inspector_id: user?.id,
          notes: notes,
          photo_url: photoUrl,
        });

      if (reportError) throw reportError;

      // C. Update Job Status to 'completed' (or 'review')
      await supabase
        .from('jobs')
        .update({ status: 'completed' })
        .eq('id', id);

      Alert.alert('Success!', 'Inspection report submitted.', [
        { text: 'OK', onPress: () => router.push('/(tabs)/my-jobs') }
      ]);

    } catch (error: any) {
      console.error(error);
      Alert.alert('Error', error.message || 'Failed to submit report');
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Inspection Report</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Photo Upload Section */}
        <Text style={styles.sectionTitle}>Evidence Photo</Text>
        <TouchableOpacity style={styles.uploadBox} onPress={pickImage}>
          {image ? (
            <Image source={{ uri: image }} style={styles.previewImage} />
          ) : (
            <View style={styles.uploadPlaceholder}>
              <Ionicons name="camera" size={40} color={COLORS.primary} />
              <Text style={styles.uploadText}>Tap to Upload Photo</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Notes Section */}
        <Text style={styles.sectionTitle}>Inspection Notes</Text>
        <View style={styles.textAreaContainer}>
          <TextInput
            style={styles.textArea}
            placeholder="Describe the condition of the equipment..."
            placeholderTextColor={COLORS.textSecondary}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            value={notes}
            onChangeText={setNotes}
          />
        </View>

        {/* Warning/Info */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={20} color={COLORS.textSecondary} />
          <Text style={styles.infoText}>
            Submitting this report will mark the job as completed and notify the client.
          </Text>
        </View>

      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.submitButton, uploading && styles.disabledButton]}
          onPress={handleSubmit}
          disabled={uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={20} color="#FFF" style={{marginRight: 8}} />
              <Text style={styles.submitButtonText}>Submit Report</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.cardBorder
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.textPrimary },
  backButton: { padding: 4 },

  content: { padding: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 12, marginTop: 8 },

  uploadBox: {
    height: 200, backgroundColor: COLORS.cardBackground, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.cardBorder, borderStyle: 'dashed',
    overflow: 'hidden', marginBottom: 24
  },
  uploadPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  uploadText: { color: COLORS.primary, fontWeight: '600' },
  previewImage: { width: '100%', height: '100%', resizeMode: 'cover' },

  textAreaContainer: {
    backgroundColor: COLORS.cardBackground, borderRadius: 12,
    borderWidth: 1, borderColor: COLORS.cardBorder, padding: 12, marginBottom: 24
  },
  textArea: { color: COLORS.textPrimary, fontSize: 16, minHeight: 120 },

  infoBox: { flexDirection: 'row', gap: 10, paddingHorizontal: 4 },
  infoText: { color: COLORS.textSecondary, fontSize: 13, flex: 1, lineHeight: 20 },

  footer: { padding: 20, borderTopWidth: 1, borderTopColor: COLORS.cardBorder },
  submitButton: {
    backgroundColor: COLORS.success, padding: 16, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center'
  },
  disabledButton: { opacity: 0.7 },
  submitButtonText: { color: '#FFF', fontSize: 16, fontWeight: 'bold' },
});
