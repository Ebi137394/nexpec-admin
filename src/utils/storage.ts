import { supabase } from '../hooks/useFormTemplate';
import { decode } from 'base64-arraybuffer';

export const uploadInspectionPhoto = async (
  base64: string, 
  fileName: string
): Promise<string | null> => {
  try {
    const filePath = `inspections/${Date.now()}_${fileName}.jpg`;
    
    // آپلود در باکت 'inspection-photos'
    const { data, error } = await supabase.storage
      .from('inspection-photos')
      .upload(filePath, decode(base64), {
        contentType: 'image/jpeg'
      });

    if (error) throw error;

    // گرفتن لینک عمومی
    const { data: urlData } = supabase.storage
      .from('inspection-photos')
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Upload Error:', error);
    return null;
  }
};