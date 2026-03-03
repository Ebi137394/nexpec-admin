import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';
import { Platform } from 'react-native';

interface UploadImageParams {
  uri: string;
  base64?: string;
}

export async function uploadReportImageFromPicker({ uri, base64 }: UploadImageParams): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    // Generate unique filename
    const timestamp = Date.now();
    const fileExt = uri.split('.').pop() || 'jpg';
    const fileName = `report_${user.id}_${timestamp}.${fileExt}`;
    const filePath = `reports/${fileName}`;

    let uploadData: ArrayBuffer;

    if (base64) {
      // Use provided base64
      uploadData = decode(base64);
    } else if (Platform.OS === 'web') {
      // For web, fetch and convert to blob then to arraybuffer
      const response = await fetch(uri);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      uploadData = arrayBuffer;
    } else {
      // For native, read as base64 and decode
      const base64String = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      uploadData = decode(base64String);
    }

    // Determine content type
    const contentType = fileExt === 'png' ? 'image/png' : fileExt === 'jpg' || fileExt === 'jpeg' ? 'image/jpeg' : 'image/jpeg';

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('report-images')
      .upload(filePath, uploadData, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('report-images')
      .getPublicUrl(filePath);

    if (!urlData?.publicUrl) {
      throw new Error('Failed to get public URL for uploaded image');
    }

    return urlData.publicUrl;
  } catch (error: any) {
    console.error('Image upload failed:', error);
    throw error;
  }
}

