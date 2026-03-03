import * as FileSystem from 'expo-file-system';
import { SignatureStorageOptions } from '../types/signature.types';

const DEFAULT_OPTIONS: Required<SignatureStorageOptions> = {
  directory: 'signatures',
  filePrefix: 'sig',
  quality: 1,
};

/**
 * Get the signatures directory path
 */
export const getSignaturesDirectory = (customDir?: string): string => {
  const dir = customDir || DEFAULT_OPTIONS.directory;
  return `${FileSystem.documentDirectory}${dir}/`;
};

/**
 * Ensure the signatures directory exists
 */
export const ensureDirectoryExists = async (directory: string): Promise<void> => {
  const dirInfo = await FileSystem.getInfoAsync(directory);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  }
};

/**
 * Generate a unique filename for a signature
 */
export const generateSignatureFilename = (prefix: string = 'sig'): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}.png`;
};

/**
 * Clean base64 string by removing data URL prefix
 */
export const cleanBase64 = (base64Data: string): string => {
  return base64Data.replace(/^data:image\/\w+;base64,/, '');
};

/**
 * Add data URL prefix to base64 string
 */
export const addBase64Prefix = (base64Data: string): string => {
  if (base64Data.startsWith('data:image')) {
    return base64Data;
  }
  return `data:image/png;base64,${base64Data}`;
};

/**
 * Save a base64 encoded signature to the local file system
 */
export const saveSignatureToFile = async (
  base64Data: string,
  options?: SignatureStorageOptions
): Promise<string> => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  try {
    const directory = getSignaturesDirectory(opts.directory);
    await ensureDirectoryExists(directory);
    
    const filename = generateSignatureFilename(opts.filePrefix);
    const fileUri = `${directory}${filename}`;
    
    const cleanedBase64 = cleanBase64(base64Data);
    
    await FileSystem.writeAsStringAsync(fileUri, cleanedBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    console.log(`[SignatureStorage] Saved signature to: ${fileUri}`);
    return fileUri;
  } catch (error) {
    console.error('[SignatureStorage] Error saving signature:', error);
    throw new Error('Failed to save signature to local storage');
  }
};

/**
 * Load a signature from the local file system
 */
export const loadSignatureFromFile = async (
  fileUri: string
): Promise<string | null> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    
    if (!fileInfo.exists) {
      console.warn(`[SignatureStorage] File not found: ${fileUri}`);
      return null;
    }
    
    const base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    
    return addBase64Prefix(base64);
  } catch (error) {
    console.error('[SignatureStorage] Error loading signature:', error);
    return null;
  }
};

/**
 * Delete a signature file from the local file system
 */
export const deleteSignatureFile = async (fileUri: string): Promise<boolean> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(fileUri);
    
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(fileUri, { idempotent: true });
      console.log(`[SignatureStorage] Deleted signature: ${fileUri}`);
    }
    
    return true;
  } catch (error) {
    console.error('[SignatureStorage] Error deleting signature:', error);
    return false;
  }
};

/**
 * Get file info for a signature
 */
export const getSignatureFileInfo = async (
  fileUri: string
): Promise<FileSystem.FileInfo | null> => {
  try {
    const fileInfo = await FileSystem.getInfoAsync(fileUri, { size: true });
    return fileInfo;
  } catch (error) {
    console.error('[SignatureStorage] Error getting file info:', error);
    return null;
  }
};

/**
 * List all saved signatures
 */
export const listSignatures = async (
  directory?: string
): Promise<string[]> => {
  try {
    const dir = getSignaturesDirectory(directory);
    const dirInfo = await FileSystem.getInfoAsync(dir);
    
    if (!dirInfo.exists) {
      return [];
    }
    
    const files = await FileSystem.readDirectoryAsync(dir);
    return files
      .filter((file) => file.endsWith('.png'))
      .map((file) => `${dir}${file}`);
  } catch (error) {
    console.error('[SignatureStorage] Error listing signatures:', error);
    return [];
  }
};

/**
 * Clear all saved signatures
 */
export const clearAllSignatures = async (directory?: string): Promise<void> => {
  try {
    const dir = getSignaturesDirectory(directory);
    const dirInfo = await FileSystem.getInfoAsync(dir);
    
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(dir, { idempotent: true });
      console.log('[SignatureStorage] Cleared all signatures');
    }
  } catch (error) {
    console.error('[SignatureStorage] Error clearing signatures:', error);
    throw error;
  }
};

/**
 * Get total storage used by signatures
 */
export const getSignaturesStorageSize = async (
  directory?: string
): Promise<number> => {
  try {
    const files = await listSignatures(directory);
    let totalSize = 0;
    
    for (const file of files) {
      const info = await getSignatureFileInfo(file);
      if (info?.exists && 'size' in info) {
        totalSize += info.size || 0;
      }
    }
    
    return totalSize;
  } catch (error) {
    console.error('[SignatureStorage] Error calculating storage size:', error);
    return 0;
  }
};

/**
 * Format bytes to human-readable string
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};