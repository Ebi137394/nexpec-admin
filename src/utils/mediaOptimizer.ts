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
