import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage'; // 🌟 افزوده شد برای حافظه موبایل

// Environment variables should be set in your .env file
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase URL and Anon Key must be set in environment variables');
}

// Create a single supabase client for interacting with your database
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage, // 🌟 این خط حیاتیه! توکن رو تو هارد گوشی قفل می‌کنه
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // Disable for better performance in mobile apps
  },
  db: {
    schema: 'public',
  },
  global: {
    headers: {
      'X-Client-Info': 'nexpec-mobile/1.0.0',
    },
  },
});

// Helper function to get public URL for storage files
export const getPublicUrl = (bucket: string, path: string): string => {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
};

// Helper function to upload files with proper error handling
export const uploadFile = async (
  bucket: string,
  path: string,
  file: File | Blob,
  contentType: string = 'image/jpeg'
): Promise<string> => {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      });

    if (error) {
      throw error;
    }

    if (!data) {
      throw new Error('Upload returned no data');
    }

    const publicUrl = getPublicUrl(bucket, data.path);
    return publicUrl;
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  }
};

// Helper function to delete files
export const deleteFile = async (bucket: string, path: string): Promise<void> => {
  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Delete failed:', error);
    throw error;
  }
};

// Helper function to list files in a bucket
export const listFiles = async (
  bucket: string,
  path?: string,
  options?: { limit?: number; offset?: number; sortBy?: { column?: string; order?: 'asc' | 'desc' } }
): Promise<any[]> => {
  try {
    const { data, error } = await supabase.storage.from(bucket).list(path, options);
    if (error) {
      throw error;
    }
    return data || [];
  } catch (error) {
    console.error('List files failed:', error);
    throw error;
  }
};

// Helper function to download files
export const downloadFile = async (bucket: string, path: string): Promise<Blob> => {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) {
      throw error;
    }
    return data;
  } catch (error) {
    console.error('Download failed:', error);
    throw error;
  }
};

// Helper function to get file metadata
export const getFileMetadata = async (bucket: string, path: string): Promise<any> => {
  try {
    const { data, error } = await (supabase.storage.from(bucket) as any).getMetadata(path);
    if (error) {
      throw error;
    }
    return data;
  } catch (error) {
    console.error('Get metadata failed:', error);
    throw error;
  }
};

// Helper function to update file metadata
export const updateFileMetadata = async (
  bucket: string,
  path: string,
  metadata: Record<string, any>
): Promise<void> => {
  try {
    const { error } = await supabase.storage.from(bucket).update(path, new Blob(), {
      cacheControl: '3600',
      upsert: false,
      metadata,
    });
    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Update metadata failed:', error);
    throw error;
  }
};

// Helper function to copy files
export const copyFile = async (bucket: string, fromPath: string, toPath: string): Promise<void> => {
  try {
    const { error } = await supabase.storage.from(bucket).copy(fromPath, toPath);
    if (error) {
      throw error;
    }
  } catch (error) {
    console.error('Copy file failed:', error);
    throw error;
  }
};

// Helper function to move files
export const moveFile = async (bucket: string, fromPath: string, toPath: string): Promise<void> => {
  try {
    await copyFile(bucket, fromPath, toPath);
    await deleteFile(bucket, fromPath);
  } catch (error) {
    console.error('Move file failed:', error);
    throw error;
  }
};

// Helper function to create signed URLs for private files
export const createSignedUrl = async (
  bucket: string,
  path: string,
  expiresIn: number = 3600
): Promise<string> => {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) {
      throw error;
    }
    return data.signedUrl;
  } catch (error) {
    console.error('Create signed URL failed:', error);
    throw error;
  }
};

// Helper function to create signed URLs for multiple files
export const createSignedUrls = async (
  bucket: string,
  paths: string[],
  expiresIn: number = 3600
): Promise<{ path: string; signedUrl: string }[]> => {
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, expiresIn);
    if (error) {
      throw error;
    }
    return (data || []) as { path: string; signedUrl: string }[];
  } catch (error) {
    console.error('Create signed URLs failed:', error);
    throw error;
  }
};

// Helper function to check if a file exists
export const fileExists = async (bucket: string, path: string): Promise<boolean> => {
  try {
    const metadata = await getFileMetadata(bucket, path);
    return !!metadata;
  } catch (error) {
    // If we get an error, the file likely doesn't exist
    return false;
  }
};

// Helper function to get file size
export const getFileSize = async (bucket: string, path: string): Promise<number> => {
  try {
    const metadata = await getFileMetadata(bucket, path);
    return metadata.size || 0;
  } catch (error) {
    console.error('Get file size failed:', error);
    return 0;
  }
};

// Helper function to get file type
export const getFileType = async (bucket: string, path: string): Promise<string> => {
  try {
    const metadata = await getFileMetadata(bucket, path);
    return metadata.content_type || '';
  } catch (error) {
    console.error('Get file type failed:', error);
    return '';
  }
};

// Helper function to get file last modified date
export const getFileLastModified = async (bucket: string, path: string): Promise<Date | null> => {
  try {
    const metadata = await getFileMetadata(bucket, path);
    return metadata.updated_at ? new Date(metadata.updated_at) : null;
  } catch (error) {
    console.error('Get file last modified failed:', error);
    return null;
  }
};

// Helper function to get file cache control
export const getFileCacheControl = async (bucket: string, path: string): Promise<string> => {
  try {
    const metadata = await getFileMetadata(bucket, path);
    return metadata.cache_control || '';
  } catch (error) {
    console.error('Get file cache control failed:', error);
    return '';
  }
};

// Helper function to get file etag
export const getFileEtag = async (bucket: string, path: string): Promise<string> => {
  try {
    const metadata = await getFileMetadata(bucket, path);
    return metadata.id || '';
  } catch (error) {
    console.error('Get file etag failed:', error);
    return '';
  }
};

// Helper function to get file version
export const getFileVersion = async (bucket: string, path: string): Promise<string> => {
  try {
    const metadata = await getFileMetadata(bucket, path);
    return metadata.version || '';
  } catch (error) {
    console.error('Get file version failed:', error);
    return '';
  }
};

// Helper function to get file owner
export const getFileOwner = async (bucket: string, path: string): Promise<string> => {
  try {
    const metadata = await getFileMetadata(bucket, path);
    return metadata.owner || '';
  } catch (error) {
    console.error('Get file owner failed:', error);
    return '';
  }
};

// Helper function to get file public URL with custom options
export const getPublicUrlWithOptions = (
  bucket: string,
  path: string,
  options?: {
    transform?: {
      width?: number;
      height?: number;
      resize?: 'cover' | 'contain' | 'fill' | 'scale-down' | 'none';
      format?: 'original' | 'webp' | 'avif' | 'jpg' | 'png';
      quality?: number;
    };
  }
): string => {
  let url = getPublicUrl(bucket, path);
  
  if (options?.transform) {
    const params = new URLSearchParams();
    
    if (options.transform.width) {
      params.set('width', options.transform.width.toString());
    }
    if (options.transform.height) {
      params.set('height', options.transform.height.toString());
    }
    if (options.transform.resize) {
      params.set('resize', options.transform.resize);
    }
    if (options.transform.format && options.transform.format !== 'original') {
      params.set('format', options.transform.format);
    }
    if (options.transform.quality) {
      params.set('quality', options.transform.quality.toString());
    }
    
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
  }
  
  return url;
};

// Helper function to get file URL with transformations
export const getTransformedUrl = (
  bucket: string,
  path: string,
  width?: number,
  height?: number,
  format: 'original' | 'webp' | 'avif' | 'jpg' | 'png' = 'webp',
  quality: number = 80
): string => {
  return getPublicUrlWithOptions(bucket, path, {
    transform: {
      width,
      height,
      format,
      quality,
    },
  });
};

// Helper function to get thumbnail URL
export const getThumbnailUrl = (
  bucket: string,
  path: string,
  width: number = 200,
  height: number = 200
): string => {
  return getTransformedUrl(bucket, path, width, height, 'webp', 80);
};

// Helper function to get medium size URL
export const getMediumUrl = (
  bucket: string,
  path: string,
  width: number = 800,
  height: number = 600
): string => {
  return getTransformedUrl(bucket, path, width, height, 'webp', 85);
};

// Helper function to get large size URL
export const getLargeUrl = (
  bucket: string,
  path: string,
  width: number = 1920,
  height: number = 1080
): string => {
  return getTransformedUrl(bucket, path, width, height, 'webp', 90);
};

// Helper function to get original URL
export const getOriginalUrl = (bucket: string, path: string): string => {
  return getTransformedUrl(bucket, path, undefined, undefined, 'original', 100);
};

// Helper function to get all available sizes for an image
export const getImageSizes = (bucket: string, path: string): {
  thumbnail: string;
  medium: string;
  large: string;
  original: string;
} => {
  return {
    thumbnail: getThumbnailUrl(bucket, path),
    medium: getMediumUrl(bucket, path),
    large: getLargeUrl(bucket, path),
    original: getOriginalUrl(bucket, path),
  };
};

// Helper function to get image dimensions from metadata
export const getImageDimensions = async (bucket: string, path: string): Promise<{ width?: number; height?: number }> => {
  try {
    const metadata = await getFileMetadata(bucket, path);
    return {
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    console.error('Get image dimensions failed:', error);
    return {};
  }
};

// Helper function to get image aspect ratio
export const getImageAspectRatio = async (bucket: string, path: string): Promise<number> => {
  try {
    const { width, height } = await getImageDimensions(bucket, path);
    if (width && height) {
      return width / height;
    }
    return 1;
  } catch (error) {
    console.error('Get image aspect ratio failed:', error);
    return 1;
  }
};

// Helper function to get image orientation
export const getImageOrientation = async (bucket: string, path: string): Promise<'landscape' | 'portrait' | 'square'> => {
  try {
    const { width, height } = await getImageDimensions(bucket, path);
    if (width && height) {
      if (width > height) return 'landscape';
      if (height > width) return 'portrait';
      return 'square';
    }
    return 'square';
  } catch (error) {
    console.error('Get image orientation failed:', error);
    return 'square';
  }
};

// Helper function to get image file size in human readable format
export const getFileSizeHuman = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Helper function to validate file type
export const isValidFileType = (file: File, allowedTypes: string[]): boolean => {
  return allowedTypes.includes(file.type);
};

// Helper function to validate file size
export const isValidFileSize = (file: File, maxSize: number): boolean => {
  return file.size <= maxSize;
};

// Helper function to validate image dimensions
export const isValidImageDimensions = (file: File, maxWidth: number, maxHeight: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(img.width <= maxWidth && img.height <= maxHeight);
    };
    img.onerror = () => {
      resolve(false);
    };
    img.src = URL.createObjectURL(file);
  });
};

// Helper function to compress image
export const compressImage = (file: File, quality: number = 0.8): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not compress image'));
        }
      }, 'image/jpeg', quality);
    };
    img.onerror = () => {
      reject(new Error('Could not load image'));
    };
    img.src = URL.createObjectURL(file);
  });
};

// Helper function to resize image
export const resizeImage = (file: File, maxWidth: number, maxHeight: number): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      
      // Calculate new dimensions while maintaining aspect ratio
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      
      if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
      }
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not resize image'));
        }
      }, 'image/jpeg', 0.8);
    };
    img.onerror = () => {
      reject(new Error('Could not load image'));
    };
    img.src = URL.createObjectURL(file);
  });
};

// Helper function to convert image to webp
export const convertToWebP = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not convert to WebP'));
        }
      }, 'image/webp', 0.8);
    };
    img.onerror = () => {
      reject(new Error('Could not load image'));
    };
    img.src = URL.createObjectURL(file);
  });
};

// Helper function to get file extension
export const getFileExtension = (filename: string): string => {
  return filename.slice((filename.lastIndexOf('.') - 1 >>> 0) + 2);
};

// Helper function to generate unique filename
export const generateUniqueFilename = (originalName: string): string => {
  const extension = getFileExtension(originalName);
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}.${extension}`;
};

// Helper function to sanitize filename
export const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^a-z0-9.]/gi, '-')
    .toLowerCase()
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

// Helper function to get file icon based on type
export const getFileIcon = (filename: string): string => {
  const extension = getFileExtension(filename).toLowerCase();
  
  const iconMap: Record<string, string> = {
    'pdf': 'document-text',
    'doc': 'document-text',
    'docx': 'document-text',
    'xls': 'document-text',
    'xlsx': 'document-text',
    'ppt': 'document-text',
    'pptx': 'document-text',
    'txt': 'document-text',
    'rtf': 'document-text',
    'jpg': 'image',
    'jpeg': 'image',
    'png': 'image',
    'gif': 'image',
    'bmp': 'image',
    'webp': 'image',
    'svg': 'image',
    'mp4': 'videocam',
    'avi': 'videocam',
    'mov': 'videocam',
    'wmv': 'videocam',
    'flv': 'videocam',
    'webm': 'videocam',
    'mp3': 'musical-notes',
    'wav': 'musical-notes',
    'ogg': 'musical-notes',
    'm4a': 'musical-notes',
    'zip': 'archive',
    'rar': 'archive',
    '7z': 'archive',
    'tar': 'archive',
    'gz': 'archive',
  };
  
  return iconMap[extension] || 'document';
};

// Helper function to get file color based on type
export const getFileColor = (filename: string): string => {
  const extension = getFileExtension(filename).toLowerCase();
  
  const colorMap: Record<string, string> = {
    'pdf': '#FF0000',
    'doc': '#2B579A',
    'docx': '#2B579A',
    'xls': '#217346',
    'xlsx': '#217346',
    'ppt': '#D24726',
    'pptx': '#D24726',
    'txt': '#607D8B',
    'rtf': '#607D8B',
    'jpg': '#FF9800',
    'jpeg': '#FF9800',
    'png': '#FF9800',
    'gif': '#FF9800',
    'bmp': '#FF9800',
    'webp': '#FF9800',
    'svg': '#FF9800',
    'mp4': '#9C27B0',
    'avi': '#9C27B0',
    'mov': '#9C27B0',
    'wmv': '#9C27B0',
    'flv': '#9C27B0',
    'webm': '#9C27B0',
    'mp3': '#E91E63',
    'wav': '#E91E63',
    'ogg': '#E91E63',
    'm4a': '#E91E63',
    'zip': '#607D8B',
    'rar': '#607D8B',
    '7z': '#607D8B',
    'tar': '#607D8B',
    'gz': '#607D8B',
  };
  
  return colorMap[extension] || '#607D8B';
};

// Helper function to format file size
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Helper function to format file date
export const formatFileDate = (date: Date): string => {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// Helper function to get file age
export const getFileAge = (date: Date): string => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor(diff / (1000 * 60));
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
};

// Helper function to get file permissions
export const getFilePermissions = async (bucket: string, path: string): Promise<{
  read: boolean;
  write: boolean;
  delete: boolean;
}> => {
  try {
    // This is a simplified implementation
    // In a real app, you would check the user's role and the file's metadata
    const metadata = await getFileMetadata(bucket, path);
    
    return {
      read: true, // Everyone can read public files
      write: true, // User can write their own files
      delete: true, // User can delete their own files
    };
  } catch (error) {
    console.error('Get file permissions failed:', error);
    return {
      read: false,
      write: false,
      delete: false,
    };
  }
};

// Helper function to check if user has permission to perform action
export const hasPermission = async (
  bucket: string,
  path: string,
  action: 'read' | 'write' | 'delete'
): Promise<boolean> => {
  try {
    const permissions = await getFilePermissions(bucket, path);
    return permissions[action];
  } catch (error) {
    console.error('Check permission failed:', error);
    return false;
  }
};
