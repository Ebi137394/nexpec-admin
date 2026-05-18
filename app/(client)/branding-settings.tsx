import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView, StyleSheet, Image, TextInput as RNTextInput } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../lib/supabase';
import { BrandingConfig } from '../../src/types/report';

export default function BrandingSettings() {
  const [branding, setBranding] = useState<BrandingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#7C3AED');
  const [companyName, setCompanyName] = useState('');

  useEffect(() => {
    fetchBranding();
  }, []);

  const fetchBranding = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('company_logo_url, report_header_text, report_footer_text, use_custom_branding, primary_color, company_name')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setBranding(data);
      setHeaderText(data?.report_header_text || '');
      setFooterText(data?.report_footer_text || '');
      setPrimaryColor(data?.primary_color || '#7C3AED');
      setCompanyName(data?.company_name || '');
    } catch (error) {
      console.error('Error fetching branding:', error);
      Alert.alert('Error', 'Failed to load branding settings');
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 4],
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      uploadImage(result.assets[0].uri);
    }
  };

  const uploadImage = async (uri: string) => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const response = await fetch(uri);
      const blob = await response.blob();
      const filename = `company-logo-${user.id}-${Date.now()}.png`;

      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(filename, blob, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('company-logos')
        .getPublicUrl(filename);

      await updateBranding({ company_logo_url: publicUrl });
      Alert.alert('Success', 'Logo uploaded successfully');
    } catch (error) {
      console.error('Error uploading image:', error);
      Alert.alert('Error', 'Failed to upload logo');
    } finally {
      setLoading(false);
    }
  };

  const updateBranding = async (updates: Partial<BrandingConfig>) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase
        .from('profiles')
        .update({
          ...updates,
          report_header_text: headerText,
          report_footer_text: footerText,
          primary_color: primaryColor,
          company_name: companyName,
          use_custom_branding: true
        })
        .eq('id', user.id);

      if (error) throw error;

      await fetchBranding();
      Alert.alert('Success', 'Branding updated successfully');
    } catch (error) {
      console.error('Error updating branding:', error);
      Alert.alert('Error', 'Failed to update branding');
    }
  };

  const removeLogo = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await updateBranding({ company_logo_url: null });
      Alert.alert('Success', 'Logo removed successfully');
    } catch (error) {
      console.error('Error removing logo:', error);
      Alert.alert('Error', 'Failed to remove logo');
    }
  };

  const toggleCustomBranding = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await updateBranding({ use_custom_branding: !branding?.use_custom_branding });
    } catch (error) {
      console.error('Error toggling branding:', error);
      Alert.alert('Error', 'Failed to update branding settings');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>White-Label Branding</Text>
      <Text style={styles.subtitle}>Customize your inspection reports with your company branding</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Company Logo</Text>
        {branding?.company_logo_url ? (
          <View style={styles.logoContainer}>
            <Image source={{ uri: branding.company_logo_url }} style={styles.logo} />
            <TouchableOpacity style={styles.removeButton} onPress={removeLogo}>
              <Text style={styles.removeButtonText}>Remove Logo</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.uploadButton} onPress={pickImage} disabled={loading}>
            <Text style={styles.uploadButtonText}>Upload Company Logo</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Report Header Text</Text>
        <RNTextInput
          value={headerText}
          onChangeText={setHeaderText}
          placeholder="e.g., Official Inspection Report"
          style={styles.input}
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Report Footer Text</Text>
        <RNTextInput
          value={footerText}
          onChangeText={setFooterText}
          placeholder="e.g., Generated via Your Company Name"
          style={styles.input}
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Primary Color</Text>
        <RNTextInput
          value={primaryColor}
          onChangeText={setPrimaryColor}
          placeholder="#7C3AED"
          style={styles.input}
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Company Name</Text>
        <RNTextInput
          value={companyName}
          onChangeText={setCompanyName}
          placeholder="Your Company Name"
          style={styles.input}
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Enable Custom Branding</Text>
        <TouchableOpacity 
          style={[
            styles.toggleButton, 
            branding?.use_custom_branding ? styles.toggleButtonActive : styles.toggleButtonInactive
          ]} 
          onPress={toggleCustomBranding}
        >
          <Text style={[
            styles.toggleButtonText,
            branding?.use_custom_branding ? styles.toggleButtonTextActive : styles.toggleButtonTextInactive
          ]}>
            {branding?.use_custom_branding ? 'Enabled' : 'Disabled'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.note}>
        Note: Custom branding will be applied to all inspection reports generated for your account.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 30,
  },
  section: {
    marginBottom: 24,
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 12,
  },
  logoContainer: {
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#e2e8f0',
  },
  uploadButton: {
    backgroundColor: '#7c3aed',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  uploadButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  removeButton: {
    backgroundColor: '#ef4444',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  removeButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#fff',
  },
  toggleButton: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  toggleButtonActive: {
    backgroundColor: '#22c55e',
  },
  toggleButtonInactive: {
    backgroundColor: '#64748b',
  },
  toggleButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  toggleButtonTextActive: {
    color: '#fff',
  },
  toggleButtonTextInactive: {
    color: '#fff',
  },
  note: {
    fontSize: 12,
    color: '#64748b',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 20,
  },
});