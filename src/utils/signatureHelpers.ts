import { SignatureData } from '../types/signature.types';
import { loadSignatureFromFile, getSignatureFileInfo, formatBytes } from './signatureStorage';

/**
 * Validate a signature data object
 */
export const isValidSignature = (data: SignatureData | null): boolean => {
  if (!data) return false;
  if (!data.base64) return false;
  if (data.base64 === 'data:image/png;base64,') return false;
  return true;
};

/**
 * Get signature age in human-readable format
 */
export const getSignatureAge = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${days} day${days === 1 ? '' : 's'} ago`;
};

/**
 * Prepare signature for API upload
 */
export const prepareSignatureForUpload = async (
  data: SignatureData
): Promise<{
  base64: string;
  mimeType: string;
  timestamp: number;
  fileSize: number | null;
}> => {
  let fileSize: number | null = null;
  
  if (data.fileUri) {
    const info = await getSignatureFileInfo(data.fileUri);
    if (info?.exists && 'size' in info) {
      fileSize = info.size || null;
    }
  }
  
  // Remove data URL prefix for API upload
  const base64 = data.base64.replace(/^data:image\/\w+;base64,/, '');
  
  return {
    base64,
    mimeType: 'image/png',
    timestamp: data.timestamp,
    fileSize,
  };
};

/**
 * Recover signature from local file if base64 is missing
 */
export const recoverSignature = async (
  data: SignatureData
): Promise<SignatureData | null> => {
  if (data.base64 && data.base64 !== 'data:image/png;base64,') {
    return data;
  }
  
  if (!data.fileUri) {
    return null;
  }
  
  const base64 = await loadSignatureFromFile(data.fileUri);
  
  if (!base64) {
    return null;
  }
  
  return {
    ...data,
    base64,
  };
};

/**
 * Get storage info for signatures
 */
export const getSignatureStorageInfo = async (
  signatures: SignatureData[]
): Promise<{
  totalSize: number;
  formattedSize: string;
  count: number;
}> => {
  let totalSize = 0;
  
  for (const sig of signatures) {
    if (sig.fileUri) {
      const info = await getSignatureFileInfo(sig.fileUri);
      if (info?.exists && 'size' in info) {
        totalSize += info.size || 0;
      }
    }
  }
  
  return {
    totalSize,
    formattedSize: formatBytes(totalSize),
    count: signatures.length,
  };
};