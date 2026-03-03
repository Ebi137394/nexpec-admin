/**
 * Database Types for NEXPEC
 * Strictly typed to match Supabase schema
 */

export interface Profile {
  id: string;
  full_name: string;
  role: string;
  verification_status: boolean;
  avatar_url: string | null;
  job_title: string;
  base_location: string;
  years_experience?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface Skill {
  id: string;
  profile_id: string;
  category: string;
  brand_name: string;
  model: string;
  years_experience: number;
  created_at?: string;
}

export interface InspectorStats {
  projects_completed: number;
  hours_logged: number;
  rating: number;
}

export interface Project {
  id: string;
  title: string;
  location: string;
  day_rate: number; // snake_case to match DB
  required_brand: string; // snake_case to match DB
  description: string;
  status: string;
  client_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Application {
  id: string;
  project_id: string;
  applicant_id: string;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string;
  updated_at: string;
}

export interface Report {
  id: string;
  application_id: string;
  inspector_id: string;
  result: 'pass' | 'fail';
  comments: string;
  submitted_at: string;
  created_at: string;
}

