import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  StyleSheet,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons'; // Added for icons
import { supabase } from '../lib/supabase';

type InspectionType = 'Visual' | 'Welding' | 'NDT';

export default function SubmitReport() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();

  const [inspectionType, setInspectionType] = useState<InspectionType>('Visual');
  const [description, setDescription] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const getUserSession = async () => {
      try {
        // FIX: Added 'data' to destructuring
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (session?.user?.id) {
          setUserId(session.user.id);
        } else {
          Alert.alert('Error', 'No authenticated user found');
          router.replace('/login');
        }
      } catch (error: any) {
        Alert.alert('Auth Error', error.message);
        router.replace('/login');
      }
    };

    getUserSession();
  }, []);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera roll permissions are needed to upload images');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.5, // Reduced quality slightly for faster upload/handling
        aspect: [4, 3],
      });

      if (!result.canceled && result.assets[0]?.uri) {
        setImageUri(result.assets[0].uri);
      }
    } catch (error: any) {
      Alert.alert('Image Picker Error', error.message);
    }
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      Alert.alert('Validation Error', 'Description cannot be empty');
      return;
    }

    if (!userId) {
      Alert.alert('Error', 'User not authenticated');
      return;
    }

    setLoading(true);

    try {
      // NOTE: For now we save the local URI. In Phase 5 we will upload to Storage bucket.
      const { error } = await supabase
        .from('reports')
        .insert([
          {
            project_id: projectId,
            inspector_id: userId,
            inspection_type: inspectionType,
            description: description.trim(),
            image_url: imageUri || null, 
            status: 'Submitted',
          },
        ]);

      if (error) throw error;

      Alert.alert('Success', 'Report submitted successfully!', [
        {
          text: 'OK',
          onPress: () => router.push('/(tabs)/inspector-dashboard'), // Ensure this route exists
        },
      ]);
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error occurred';
      Alert.alert(
        'Submission Failed',
        `Message: ${errorMessage}\n\nEnsure you ran the SQL script to add 'description' and 'inspection_type' columns.`
      );
      console.error('Supabase Insert Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderInspectionTypeChip = (type: InspectionType) => {
    const isSelected = inspectionType === type;
    return (
      <TouchableOpacity
        key={type}
        style={[styles.chip, isSelected && styles.chipSelected]}
        onPress={() => setInspectionType(type)}
      >
        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
          {type}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <Stack.Screen 
        options={{ 
          title: 'Submit Report', 
          headerStyle: { backgroundColor: '#0F172A' }, 
          headerTintColor: '#fff',
          headerBackTitle: 'Back'
        }} 
      />
      
      <ScrollView contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
            <Text style={styles.title}>Inspection Results</Text>
            <Text style={styles.subtitle}>Project Ref: {projectId?.slice(0, 8)}...</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Inspection Type</Text>
          <View style={styles.chipContainer}>
            {(['Visual', 'Welding', 'NDT'] as InspectionType[]).map(renderInspectionTypeChip)}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Findings & Description</Text>
          <TextInput
            style={styles.textArea}
            placeholder="Describe defects, measurements, or observations..."
            placeholderTextColor="#64748B"
            multiline
            numberOfLines={6}
            value={description}
            onChangeText={setDescription}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Evidence (Photo)</Text>
          <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
            {imageUri ? (
              <Image source={{ uri: imageUri }} style={styles.imagePreview} />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Ionicons name="camera-outline" size={40} color="#64748B" />
                <Text style={styles.imagePlaceholderText}>Tap to upload photo</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>Submit Report</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617', // Dark Theme Background
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
  },
  section: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F1F5F9',
    marginBottom: 12,
  },
  chipContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  chip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  textArea: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#334155',
    minHeight: 140,
  },
  imagePicker: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderStyle: 'dashed',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imagePlaceholderText: {
    fontSize: 16,
    color: '#64748B',
    marginTop: 10,
  },
  submitButton: {
    backgroundColor: '#10B981', // Green for success action
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  submitButtonDisabled: {
    backgroundColor: '#334155',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
