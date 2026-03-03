/**
 * CORRECTED VERSION: fetchApplicants function
 * 
 * This is an example of the correct way to fetch applicants with proper Supabase syntax.
 * Use this as a reference when writing similar queries.
 */

import { supabase } from './supabase';
import { showAlert } from './alert';

/**
 * Fetch applicants for a job with correct Supabase join syntax
 * 
 * @param jobId - The job ID to fetch applicants for
 * @param setLoading - State setter for loading state
 * @param setApplicants - State setter for applicants data
 */
export const fetchApplicants = async (
  jobId: string,
  setLoading: (loading: boolean) => void,
  setApplicants: (applicants: any[]) => void
) => {
  try {
    setLoading(true);

    // ✅ CORRECT SYNTAX: Use 'alias:table_name', not 'table_name:foreign_key'
    const { data, error } = await supabase
      .from('applications')
      .select(`
        *,
        /* 
         * CRITICAL FIX: 
         * - 'applicant' is the alias (what you'll use in code: application.applicant)
         * - 'profiles' is the actual table name
         * - Supabase auto-detects the foreign key from 'applicant_id' column
         */
        applicant:profiles (
          id,
          first_name,    /* ✅ Correct: profiles table has first_name */
          last_name,     /* ✅ Correct: profiles table has last_name */
          avatar_url
        )
      `)
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase Error:', error);
      throw error;
    }

    // ✅ CORRECT DATA PROCESSING: Use 'applicant' (the alias), not 'profiles'
    const formattedData = (data || []).map((application) => {
      // Access the profile using the alias 'applicant'
      const profile = application.applicant;
      
      // Create a full name string, or use "Unknown" if missing
      const fullName = profile 
        ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() 
        : 'Unknown Inspector';

      return {
        ...application,
        // Add computed full_name for convenience in UI
        full_name: fullName || 'Unknown Inspector',
        // Keep the original applicant object for other uses
        applicant: profile,
      };
    });

    setApplicants(formattedData);

  } catch (error: any) {
    console.error('Error loading applicants:', error);
    const errorMessage = error?.message || 'Failed to load applicants';
    showAlert('Error', errorMessage);
  } finally {
    setLoading(false);
  }
};

/**
 * ALTERNATIVE: Using the existing getJobApplications function
 * This is the recommended approach as it's already tested and type-safe
 */
import { getJobApplications } from './applications';
import { ApplicationWithProfile } from '@/types/application';
import { getApplicantName } from '@/types/application';

export const fetchApplicantsUsingHelper = async (
  jobId: string,
  setLoading: (loading: boolean) => void,
  setApplicants: (applicants: ApplicationWithProfile[]) => void
) => {
  try {
    setLoading(true);

    const { data, error } = await getJobApplications(jobId);

    if (error) {
      console.error('Error loading applicants:', error);
      showAlert('Error', error.message || 'Failed to load applicants');
      return;
    }

    // Data is already properly typed as ApplicationWithProfile[]
    // Each item has: application.applicant.first_name, application.applicant.last_name, etc.
    setApplicants(data || []);

  } catch (error: any) {
    console.error('Error loading applicants:', error);
    showAlert('Error', error?.message || 'Failed to load applicants');
  } finally {
    setLoading(false);
  }
};

/**
 * Helper function to get full name from an application
 * Use this in your UI components instead of manually concatenating
 */
export const getApplicantFullName = (application: ApplicationWithProfile): string => {
  return getApplicantName(application.applicant);
};

