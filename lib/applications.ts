// ============================================================================
// JOB APPLICATIONS UTILITY FUNCTIONS
// ============================================================================

import { supabase } from './supabase';
import { Alert } from 'react-native';
import type { JobApplication } from '@/types/core';

// ============================================================================
// SUBMIT APPLICATION
// ============================================================================

/**
 * تابع ارسال درخواست برای یک شغل
 * @param jobId - شناسه شغلی که برای آن درخواست داده می‌شود
 * @param coverLetter - متن توضیحات پیمانکار
 * @param proposedPrice - قیمت پیشنهادی (اختیاری)
 */
export const submitApplication = async (
  jobId: string,
  coverLetter: string,
  proposedPrice: number
) => {
  try {
    // 1. دریافت اطلاعات کاربر (اصلاح شده و امن)
    // نکته مهم: در Supabase اطلاعات کاربر داخل آبجکت data است
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    // 2. چک کردن وضعیت لاگین
    if (authError || !user) {
      throw new Error('User is not authenticated. Please log in.');
    }

    console.log('Preparing to submit application for user:', user.id);

    // 3. ارسال درخواست به دیتابیس
    const { data, error } = await supabase
      .from('job_applications')
      .insert({
        job_id: jobId,
        inspector_id: user.id, // ✅ شناسه کاربر لاگین شده
        status: 'pending', // ✅ وضعیت اولیه همیشه باید pending باشد
        cover_letter: coverLetter,
        proposed_price: proposedPrice,
      })
      .select()
      .single();

    // 4. مدیریت خطاها
    if (error) {
      // اگر ارور مربوط به این بود که قبلا درخواست داده (Duplicate Key)
      if (error.code === '23505') {
        throw new Error('You have already applied for this job.');
      }
      throw error;
    }

    // 5. موفقیت
    console.log('Application submitted successfully:', data);
    return { success: true, data };

  } catch (err: any) {
    console.error('Submission Error:', err.message);
    Alert.alert('Error', err.message); // نمایش پیام خطا به کاربر
    return { success: false, error: err.message };
  }
};

// ============================================================================
// GET JOB APPLICATIONS
// ============================================================================

/**
 * Get all applications for a specific job (for clients)
 */
export async function getJobApplications(
  jobId: string
): Promise<{ data: JobApplication[] | null; error: Error | null }> {
  try {
    const { data, error } = await supabase
      .from('job_applications')
      .select(`
        *,
        inspector:profiles!job_applications_inspector_id_fkey(
          id,
          full_name,
          avatar_url,
          rating_average,
          years_experience
        )
      `)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching job applications:', error);
    return { data: null, error: error as Error };
  }
}

/**
 * Get user's own applications (for inspectors)
 */
export async function getMyApplications(): Promise<{
  data: JobApplication[] | null;
  error: Error | null;
}> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('job_applications')
      .select(`
        *,
        job:jobs(
          *,
          client:profiles!jobs_client_id_fkey(full_name, avatar_url, company_name)
        )
      `)
      .eq('inspector_id', user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('Error fetching my applications:', error);
    return { data: null, error: error as Error };
  }
}

// ============================================================================
// UPDATE APPLICATION STATUS
// ============================================================================

/**
 * Update application status (for clients)
 */
export async function updateApplicationStatus(
  applicationId: string,
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { error } = await supabase
      .from('job_applications')
      .update({ status })
      .eq('id', applicationId);

    if (error) throw error;
    return { success: true, error: null };
  } catch (error: any) {
    console.error('Error updating application status:', error);
    return { success: false, error: error.message };
  }
}

// ============================================================================
// WITHDRAW APPLICATION
// ============================================================================

/**
 * Withdraw an application (for inspectors)
 */
export async function withdrawApplication(
  applicationId: string
): Promise<{ success: boolean; error: string | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('job_applications')
      .update({ status: 'rejected' }) // Changed from 'withdrawn' to 'rejected' to match schema
      .eq('id', applicationId)
      .eq('inspector_id', user.id); // Ensure user owns the application

    if (error) throw error;
    return { success: true, error: null };
  } catch (error: any) {
    console.error('Error withdrawing application:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if user has already applied to a job
 * Returns an object with hasApplied boolean and applicationId if found
 */
export async function hasAppliedToJob(
  jobId: string
): Promise<{ hasApplied: boolean; applicationId: string | null }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { hasApplied: false, applicationId: null };

    const { data, error } = await supabase
      .from('job_applications')
      .select('id')
      .eq('job_id', jobId)
      .eq('inspector_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error checking application:', error);
      return { hasApplied: false, applicationId: null };
    }

    return {
      hasApplied: !!data,
      applicationId: data?.id || null,
    };
  } catch (error) {
    console.error('Error in hasAppliedToJob:', error);
    return { hasApplied: false, applicationId: null };
  }
}
