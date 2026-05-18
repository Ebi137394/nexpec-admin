// ============================================================================
// JOB APPLICATIONS UTILITY FUNCTIONS
// ============================================================================

import { supabase } from '@/src/core/supabase/supabase';
import { Alert } from 'react-native';
import type { JobApplication } from '@/types/core';
import { toCents } from '@/src/core/utils/money';

// ============================================================================
// SUBMIT APPLICATION
// ============================================================================

/**
 * تابع ارسال درخواست برای یک شغل
 * @param jobId - شناسه شغلی که برای آن درخواست داده می‌شود
 * @param coverLetter - متن توضیحات پیمانکار
 * @param proposedPrice - قیمت پیشنهادی (اختیاری)
 * @param userId - شناسه کاربر لاگین شده (به صورت صریح دریافت می‌شود)
 */
export const submitApplication = async (
  jobId: string,
  coverLetter: string,
  proposedPrice: number,
  userId: string
) => {
  try {
    console.log('Preparing to submit application for user:', userId);

    // ★ HIRE-008: canonical applications table, canonical columns only.
    //   The columns inspector_id and user_id do NOT exist on this
    //   table — confirmed by the table-consolidation migration.
    //   applicant_id is the single source of truth for the inspector.
    const { data, error } = await supabase
      .from('applications')
      .insert({
        job_id: jobId,
        applicant_id: userId,
        status: 'pending',
        cover_note: coverLetter,
        bid_amount_cents: toCents(proposedPrice),
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
    // ★ HIRE-008: canonical applications table. FK embed retargeted to
    //   applications_applicant_id_fkey (or auto-detected via the
    //   applicant_id → profiles.id FK added in reviews-system-hotfix.sql).
    const { data, error } = await supabase
      .from('applications')
      .select(`
        *,
        inspector:profiles!applicant_id(
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

    // ★ HIRE-008: canonical applications table; inspector_id → applicant_id.
    const { data, error } = await supabase
      .from('applications')
      .select(`
        *,
        job:jobs(
          *,
          client:profiles!jobs_client_id_fkey(full_name, avatar_url, company_name)
        )
      `)
      .eq('applicant_id', user.id)
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
    // ★ HIRE-008: canonical applications table.
    const { error } = await supabase
      .from('applications')
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

    // ★ HIRE-008: canonical applications table; inspector_id → applicant_id.
    const { error } = await supabase
      .from('applications')
      .update({ status: 'rejected' })
      .eq('id', applicationId)
      .eq('applicant_id', user.id); // Ensure user owns the application

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

    // ★ HIRE-008: canonical applications table; inspector_id → applicant_id.
    const { data, error } = await supabase
      .from('applications')
      .select('id')
      .eq('job_id', jobId)
      .eq('applicant_id', user.id)
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
