// lib/storage.ts
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

interface UploadResult {
  publicUrl: string;
  path: string;
  error?: string;
}

/**
 * ROBUST CROSS-PLATFORM IMAGE UPLOAD TO SUPABASE STORAGE
 * Works on Web, iOS, and Android
 */
export async function uploadImageToSupabase(
  uri: string,
  bucketName: string = 'report-images',
  folder: string = 'reports'
): Promise<UploadResult> {
  try {
    console.log('════════════════════════════════════════');
    console.log('📤 STARTING IMAGE UPLOAD');
    console.log('Platform:', Platform.OS);
    console.log('URI:', uri);
    console.log('Bucket:', bucketName);
    console.log('Folder:', folder);
    console.log('════════════════════════════════════════');

    // Step 1: Authenticate
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      throw new Error('User not authenticated');
    }

    console.log('✅ User authenticated:', user.id);

    // Step 2: Extract file extension and determine MIME type
    let fileExtension = 'jpg';
    let contentType = 'image/jpeg';

    // Try to get extension from URI
    const uriParts = uri.split('.');
    if (uriParts.length > 1) {
      fileExtension = uriParts[uriParts.length - 1].toLowerCase().split('?')[0];
    }

    // Determine content type
    switch (fileExtension) {
      case 'png':
        contentType = 'image/png';
        break;
      case 'jpg':
      case 'jpeg':
        contentType = 'image/jpeg';
        break;
      case 'gif':
        contentType = 'image/gif';
        break;
      case 'webp':
        contentType = 'image/webp';
        break;
      case 'heic':
      case 'heif':
        contentType = 'image/heic';
        fileExtension = 'jpg'; // Convert HEIC to JPG for web compatibility
        contentType = 'image/jpeg';
        break;
      default:
        console.warn('⚠️ Unknown file extension, defaulting to JPEG');
        fileExtension = 'jpg';
        contentType = 'image/jpeg';
    }

    console.log('📄 File extension:', fileExtension);
    console.log('📄 Content type:', contentType);

    // Step 3: Generate unique filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 10);
    const fileName = `${user.id}_${timestamp}_${randomId}.${fileExtension}`;
    const filePath = `${folder}/${fileName}`;

    console.log('📝 Generated filename:', fileName);
    console.log('📁 Full path:', filePath);

    // Step 4: Prepare upload data (Platform-specific)
    let uploadData: Blob | ArrayBuffer;

    if (Platform.OS === 'web') {
      console.log('🌐 WEB PLATFORM - Using Blob');
      
      try {
        const response = await fetch(uri);
        
        if (!response.ok) {
          throw new Error(`Failed to fetch image blob: ${response.statusText}`);
        }

        let blob = await response.blob();
        console.log('✅ Original blob size:', blob.size, 'bytes');
        console.log('✅ Original blob type:', blob.type);

        // CRITICAL: Ensure blob has correct content type
        if (!blob.type || blob.type === '' || blob.type === 'application/octet-stream') {
          console.warn('⚠️ Blob type missing or generic. Creating new blob with correct type...');
          blob = new Blob([blob], { type: contentType });
          console.log('✅ New blob type:', blob.type);
        }

        uploadData = blob;
      } catch (fetchError: any) {
        console.error('❌ Blob fetch error:', fetchError);
        throw new Error(`Failed to create blob: ${fetchError.message}`);
      }
    } else {
      console.log('📱 MOBILE PLATFORM - Using FileSystem + Base64');
      
      try {
        // Read file as base64
        const base64String = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });

        console.log('✅ Base64 string length:', base64String.length);

        // Decode base64 to ArrayBuffer
        uploadData = decode(base64String);
        
        console.log('✅ ArrayBuffer size:', uploadData.byteLength, 'bytes');
      } catch (fileError: any) {
        console.error('❌ FileSystem error:', fileError);
        throw new Error(`Failed to read file: ${fileError.message}`);
      }
    }

    // Step 5: Upload to Supabase Storage
    console.log('🔼 Uploading to Supabase...');

    const { data: uploadResult, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, uploadData, {
        contentType: contentType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ Upload error:', uploadError);
      console.error('Error message:', uploadError.message);
      console.error('Error cause:', uploadError.cause);
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    console.log('✅ Upload successful!');
    console.log('Upload result:', uploadResult);

    // Step 6: Get public URL
    const { data } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    const publicUrl = data?.publicUrl;

    console.log('✅ Public URL generated:', publicUrl);

    // Step 7: VERIFY the URL is accessible (optional but recommended)
    try {
      const verifyResponse = await fetch(publicUrl, { method: 'HEAD' });
      if (verifyResponse.ok) {
        console.log('✅ URL verified - image is accessible');
      } else {
        console.warn('⚠️ URL verification failed:', verifyResponse.status);
      }
    } catch (verifyError) {
      console.warn('⚠️ Could not verify URL:', verifyError);
    }

    console.log('════════════════════════════════════════');

    return {
      publicUrl,
      path: filePath,
    };
  } catch (error: any) {
    console.error('💥 UPLOAD FAILED:', error);
    console.log('════════════════════════════════════════');
    
    return {
      publicUrl: '',
      path: '',
      error: error.message || 'Unknown error occurred',
    };
  }
}

