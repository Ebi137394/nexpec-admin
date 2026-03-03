// lib/imageUpload.ts
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

interface UploadResult {
  success: boolean;
  publicUrl?: string;
  filePath?: string;
  error?: string;
}

/**
 * BULLETPROOF IMAGE UPLOAD
 * Handles Base64, strips prefixes, generates clean filenames
 */
export async function uploadImageToSupabase(
  imageUri: string,
  bucketName: string = 'report-images'
): Promise<UploadResult> {
  try {
    console.log('════════════════════════════════════════');
    console.log('📤 BULLETPROOF IMAGE UPLOAD');
    console.log('Platform:', Platform.OS);
    console.log('Original URI:', imageUri);
    console.log('════════════════════════════════════════');

    // Step 1: Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      throw new Error('User not authenticated');
    }

    console.log('✅ User ID:', user.id);

    // Step 2: Determine file type and extension
    let fileExtension = 'png';
    let contentType = 'image/png';

    // Check if URI contains base64 data
    if (imageUri.startsWith('data:')) {
      console.log('🔍 Detected base64 data URI');
      
      // Extract MIME type from data URI
      const mimeMatch = imageUri.match(/([^;]+);/);
      if (mimeMatch && mimeMatch[1]) {
        contentType = mimeMatch[1];
        console.log('📄 Extracted Content-Type:', contentType);
        
        // Determine extension from MIME type
        if (contentType.includes('jpeg') || contentType.includes('jpg')) {
          fileExtension = 'jpg';
        } else if (contentType.includes('png')) {
          fileExtension = 'png';
        } else if (contentType.includes('gif')) {
          fileExtension = 'gif';
        } else if (contentType.includes('webp')) {
          fileExtension = 'webp';
        }
      }
    } else {
      // Extract from file URI
      const uriParts = imageUri.split('.');
      if (uriParts.length > 1) {
        const ext = uriParts[uriParts.length - 1].toLowerCase().split('?')[0];
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
          fileExtension = ext === 'jpeg' ? 'jpg' : ext;
          contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
        }
      }
    }

    console.log('📄 File extension:', fileExtension);
    console.log('📄 Content-Type:', contentType);

    // Step 3: Generate clean filename
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 10);
    const cleanFileName = `${user.id}_${timestamp}_${randomId}.${fileExtension}`;
    const filePath = `reports/${cleanFileName}`;

    console.log('📝 Clean filename:', cleanFileName);
    console.log('📁 Full path:', filePath);

    // Step 4: Prepare upload data (Platform-specific)
    let uploadData: Blob | ArrayBuffer;

    if (Platform.OS === 'web') {
      console.log('🌐 WEB PLATFORM');
      
      if (imageUri.startsWith('data:')) {
        // CRITICAL: Strip base64 prefix using regex
        console.log('🔪 Stripping base64 prefix...');
        
        // Regex to match and remove image/...;base64,
        const base64Regex = /^data:image\/[a-zA-Z]+;base64,/;
        const base64Data = imageUri.replace(base64Regex, '');
        
        console.log('✅ Base64 prefix stripped');
        console.log('Base64 length (after strip):', base64Data.length);

        // Convert base64 to blob
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        uploadData = new Blob([byteArray], { type: contentType });

        console.log('✅ Blob created:', uploadData.size, 'bytes');
        console.log('✅ Blob type:', uploadData.type);
      } else {
        // Fetch from URI
        const response = await fetch(imageUri);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        let blob = await response.blob();
        
        // Ensure correct content type
        if (blob.type !== contentType) {
          blob = new Blob([blob], { type: contentType });
        }
        
        uploadData = blob;
        console.log('✅ Blob from fetch:', uploadData.size, 'bytes');
      }
    } else {
      console.log('📱 MOBILE PLATFORM');
      
      let base64String: string;

      if (imageUri.startsWith('data:')) {
        // CRITICAL: Strip base64 prefix using regex
        console.log('🔪 Stripping base64 prefix from data URI...');
        
        const base64Regex = /^data:image\/[a-zA-Z]+;base64,/;
        base64String = imageUri.replace(base64Regex, '');
        
        console.log('✅ Base64 prefix stripped');
      } else {
        // Read from file system
        console.log('📖 Reading from FileSystem...');
        base64String = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }

      console.log('✅ Base64 length:', base64String.length);

      // Decode to ArrayBuffer
      uploadData = decode(base64String);
      console.log('✅ ArrayBuffer size:', uploadData.byteLength, 'bytes');
    }

    // Step 5: Upload to Supabase
    console.log('🔼 Uploading to Supabase Storage...');
    console.log('Bucket:', bucketName);
    console.log('Path:', filePath);
    console.log('Content-Type:', contentType);

    const { data: uploadResult, error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(filePath, uploadData, {
        contentType: contentType,
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) {
      console.error('❌ Upload error:', uploadError);
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    console.log('✅ Upload successful!');
    console.log('Upload result:', uploadResult);

    // Step 6: Generate public URL
    const { data: urlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filePath);

    const publicUrl = urlData?.publicUrl;
    console.log('✅ Public URL:', publicUrl);

    // Step 7: Verify URL is accessible
    try {
      const verifyResponse = await fetch(publicUrl, { method: 'HEAD' });
      console.log('✅ URL verification:', verifyResponse.status);
      
      if (!verifyResponse.ok) {
        console.warn('⚠️ URL verification failed:', verifyResponse.status);
      }
    } catch (verifyError) {
      console.warn('⚠️ Could not verify URL:', verifyError);
    }

    console.log('════════════════════════════════════════');

    return {
      success: true,
      publicUrl,
      filePath,
    };
  } catch (error: any) {
    console.error('💥 UPLOAD FAILED:', error);
    console.log('════════════════════════════════════════');
    
    return {
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

