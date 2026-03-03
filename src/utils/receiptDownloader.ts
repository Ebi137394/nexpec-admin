import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { supabase } from '../lib/supabase';

export const downloadAndOpenReceipt = async (storagePath: string, fileName: string) => {
  try {
    // 1. Get a temporary signed URL because the bucket is private
    const { data, error } = await supabase.storage
      .from('legal-receipts')
      .createSignedUrl(storagePath, 60);

    if (error) throw error;

    // 2. Define local path
    const localUri = `${FileSystem.documentDirectory}${fileName}`;

    // 3. Download the file
    const downloadRes = await FileSystem.downloadAsync(data.signedUrl, localUri);

    // 4. Open the native sharing/viewing menu
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(downloadRes.uri);
    }
  } catch (err) {
    console.error("Download failed:", err);
    throw new Error("Could not download the receipt.");
  }
};