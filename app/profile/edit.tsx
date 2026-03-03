import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Camera, Save } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';

export default function EditProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState(''); // Professional Title
  const [headline, setHeadline] = useState(''); // Bio/Headline
  const [bio, setBio] = useState('');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  // Load initial data
  useEffect(() => {
    async function loadData() {
      if (!user) return;
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        
        if (error) throw error;
        
        if (data) {
          setFullName(data.full_name || '');
          // Load title (Professional Title) and headline (Bio/Headline) separately
          setTitle(data.title || data.professional_title || '');
          setHeadline(data.headline || '');
          setBio(data.bio || '');
          setAvatarUri(data.avatar_url || null);
        }
      } catch (error) {
        console.error('Error loading profile:', error);
      } finally {
        setFetching(false);
      }
    }
    loadData();
  }, [user]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.5,
      aspect: [1, 1],
    });

    if (!result.canceled) {
      setAvatarUri(result.assets[0].uri);
    }
  };

  /**
   * Upload avatar image to Supabase Storage
   * Using the SAFE publicUrl extraction method
   */
  const uploadAvatar = async (): Promise<string | null> => {
    if (!avatarUri || avatarUri.startsWith('http')) return avatarUri; 

    try {
      const base64 = await FileSystem.readAsStringAsync(avatarUri, { encoding: 'base64' });
      const filePath = `avatars/${user?.id}/${Date.now()}.jpg`;
      
      // We assume bucket 'avatars' exists. If not, create it in Supabase dashboard.
      const { error: uploadError } = await supabase.storage
        .from('avatars') 
        .upload(filePath, decode(base64), { contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      // ✅ SAFE METHOD: Get public URL without destructuring
      const { data: urlData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const publicUrl = urlData?.publicUrl;

      if (!publicUrl) {
        throw new Error('Failed to get public URL');
      }

      return publicUrl;
    } catch (error) {
      console.error('Avatar upload failed:', error);
      return null;
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const publicUrl = await uploadAvatar();

      const updates: any = {
        full_name: fullName.trim(),
        bio: bio.trim(),
        updated_at: new Date().toISOString(),
      };

      // Only update avatar_url if we have a new URL
      if (publicUrl) {
        updates.avatar_url = publicUrl;
      }

      // Update title (Professional Title) column
      if (title.trim()) {
        updates.title = title.trim();
      } else {
        updates.title = null;
      }

      // Update headline (Bio/Headline) column
      if (headline.trim()) {
        updates.headline = headline.trim();
      } else {
        updates.headline = null;
      }

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user?.id);

      if (error) throw error;
      
      Alert.alert('Success', 'Profile updated!');
      router.back();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update profile');
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
     return (
       <SafeAreaView style={styles.container}>
         <View style={styles.loadingContainer}>
           <ActivityIndicator size="large" color="#3b82f6" />
         </View>
       </SafeAreaView>
     );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={loading} style={styles.saveButton}>
           {loading ? <ActivityIndicator color="#fff" /> : <Save size={24} color="#fff" />}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarSection}>
          <TouchableOpacity onPress={pickImage} style={styles.avatarContainer}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder} />
            )}
            <View style={styles.cameraIcon}>
              <Camera size={20} color="#fff" />
            </View>
          </TouchableOpacity>
          <Text style={styles.changePhotoText}>Tap to change photo</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="John Doe"
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>Professional Title</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Senior Welding Inspector"
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>Headline</Text>
          <TextInput
            style={styles.input}
            value={headline}
            onChangeText={setHeadline}
            placeholder="Brief professional summary"
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell us about your experience..."
            placeholderTextColor="#64748b"
            multiline
            numberOfLines={4}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  loadingContainer: { flex: 1, backgroundColor: '#020420', justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  backButton: { padding: 8 },
  saveButton: { padding: 8, backgroundColor: '#3b82f6', borderRadius: 8 },
  
  content: { padding: 20 },
  avatarSection: { alignItems: 'center', marginBottom: 30 },
  avatarContainer: { position: 'relative' },
  avatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: '#3b82f6' },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#1e293b', borderWidth: 2, borderColor: '#3b82f6' },
  cameraIcon: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#3b82f6', padding: 8, borderRadius: 20 },
  changePhotoText: { color: '#94a3b8', marginTop: 12 },
  
  form: { gap: 16 },
  label: { color: '#94a3b8', fontSize: 14, marginBottom: 4 },
  input: { backgroundColor: '#1e293b', color: '#fff', padding: 16, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: '#334155' },
  textArea: { height: 120, textAlignVertical: 'top' },
});
