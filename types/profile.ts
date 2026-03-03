// types/profile.ts

export interface Profile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  bio: string | null;
  phone: string | null;
  avatar_url: string | null;
  specialties: string[] | null;
  years_experience: number | null;
  role: 'inspector' | 'client' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface ProfileFormData {
  first_name: string;
  last_name: string;
  title: string;
  bio: string;
  phone: string;
  specialties: string[];
  years_experience: string;
}

export interface ProfileUpdatePayload {
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  bio: string | null;
  phone: string | null;
  specialties: string[] | null;
  years_experience: number | null;
  avatar_url?: string | null;
  updated_at: string;
}

export interface ImagePickerAsset {
  uri: string;
  width: number;
  height: number;
  type?: 'image' | 'video';
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
}

