import * as ImageManipulator from 'expo-image-manipulator';

export const optimizeImage = async (uri: string) => {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1200 } }], // محدود کردن عرض برای کاهش حجم
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );
  return result.uri;
};

export const optimizeVideo = async (uri: string) => {
  // فشرده‌سازی ویدیو به کیفیت 720p برای تعادل بین حجم و وضوح
  // Note: VideoCompressor is not available, using ImageManipulator for basic optimization
  // In a real implementation, you would use a video compression library
  return {
    uri: uri,
    optimized: false,
    message: 'Video compression requires expo-video-compressor package'
  };
};

// Human-readable byte size (e.g. 1536 → "1.5 KB"). Used by media field previews.
export const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};
