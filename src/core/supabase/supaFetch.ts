// lib/supaFetch.ts
import { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { Profile, Project } from '@/types/db'; // مطمئن شو مسیر درست است

export type SupaResult<T> = { data: T | null; error: PostgrestError | null };

function logColumnError(error: PostgrestError, context: string) {
  if (error.code === '42703') {
    console.error('🔥 [COLUMN ERROR] in:', context);
    console.error('Missing Column. Message:', error.message);
    console.error('Hint:', error.hint);
  } else {
    console.error(`❌ [Supabase Error] in ${context}:`, error.message);
  }
}

export async function safeSelect<T>(
  table: string,
  selectClause: string,
  context: string,
  builder?: (q: any) => any
): Promise<SupaResult<T>> {
  try {
    let query = supabase.from(table).select(selectClause);
    if (builder) {
      query = builder(query);
    }

    const { data, error } = await query;

    if (error) {
      logColumnError(error, context);
      return { data: null, error };
    }

    return { data: data as T, error: null };
  } catch (err: any) {
    console.error('💥 [Unexpected Error] in', context, err);
    return {
      data: null,
      error: { message: err.message || 'Unknown' } as any,
    };
  }
}

// واکشی پروفایل با ستون‌های جدید
export async function fetchCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: { message: 'No User' } as any };

  return safeSelect<Profile>(
    'profiles',
    'id, email, full_name, avatar_url, role, years_experience, bio, phone, created_at, updated_at', // years_experience اضافه شد
    'fetchCurrentProfile',
    (q) => q.eq('id', user.id).single()
  );
}

// واکشی پروژه‌ها (مخصوص داشبورد بازرس)
export async function fetchOpenProjects() {
  const result = await safeSelect<any[]>(
    'projects',
    'id, title, category, location, day_rate, currency, description, status, client_id, created_at, updated_at', // استفاده از day_rate برای mapping
    'fetchOpenProjects',
    (q) => q.or('status.eq.Open,status.eq.open,status.eq.In_Progress,status.eq.in_progress').order('created_at', { ascending: false })
  );

  if (result.error || !result.data) {
    return result;
  }

  // Map database columns to TypeScript types
  // Database uses 'day_rate' but TypeScript Project type uses 'price'
  const mappedProjects: Project[] = result.data.map((item: any) => ({
    id: item.id,
    client_id: item.client_id || null,
    title: item.title,
    category: item.category || '',
    description: item.description || null,
    location: item.location,
    price: item.day_rate || 0, // Map day_rate to price
    currency: item.currency || 'CAD',
    status: item.status as Project['status'],
    created_at: item.created_at,
    updated_at: item.updated_at || item.created_at,
  }));

  return { data: mappedProjects, error: null };
}

