import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Job, JobApplication } from '@/types/core';
import { useAuth } from '@/providers/AuthProvider';

// ============================================================================
// TYPES
// ============================================================================

interface UseJobsReturn {
  availableJobs: Job[];
  myApplications: JobApplication[];
  myJobs: Job[]; // These are your "Active" missions
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  applyToJob: (
    jobId: string,
    proposedPrice: number,
    coverLetter: string
  ) => Promise<{ success: boolean; message: string; applicationId?: string }>;
  withdrawApplication: (
    applicationId: string
  ) => Promise<{ success: boolean; message: string }>;
  hasAppliedToJob: (jobId: string) => boolean;
  getJobById: (jobId: string) => Promise<Job | null>;
}

// ============================================================================
// HOOK
// ============================================================================

export function useJobs(): UseJobsReturn {
  const { user } = useAuth();
  const [availableJobs, setAvailableJobs] = useState<Job[]>([]);
  const [myApplications, setMyApplications] = useState<JobApplication[]>([]);
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ========================================
  // DATA FETCHING
  // ========================================

  const fetchJobsData = useCallback(
    async (showRefresh = false) => {
      if (!user?.id) {
        console.log('⚠️ No user ID, skipping fetch');
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      try {
        if (showRefresh) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setError(null);

        // 1. Fetch Available Jobs (Open Market)
        console.log('🔍 Fetching available jobs (status: open)...');
        const { data: jobsData, error: jobsError } = await supabase
          .from('jobs')
          .select(`
            *,
            client:profiles!jobs_client_id_fkey(full_name, avatar_url, company_name)
          `)
          .eq('status', 'open')
          .order('created_at', { ascending: false });

        if (jobsError) {
          console.error('❌ Error in Query 1 (Available Jobs):');
          console.error('  Message:', jobsError.message);
          console.error('  Code:', jobsError.code);
          console.error('  Details:', jobsError.details);
          console.error('  Hint:', jobsError.hint);
          throw jobsError;
        }
        
        // ✅ FIX 1: Map 'budget' column to 'budget_min' for TypeScript interface
        // Database has 'budget', but TypeScript expects 'budget_min'
        // ✅ FIX 3: Ensure is_featured defaults to false if undefined
        // ✅ FIX: Ensure urgency defaults to 'normal' if undefined/null
        const mappedJobs = (jobsData || []).map((job: any) => ({
          ...job,
          budget_min: job.budget !== undefined ? job.budget : (job.budget_min || 0),
          budget_max: job.budget_max || job.budget || job.budget_min || 0,
          is_featured: job.is_featured ?? false, // Safe default for is_featured
          urgency: job.urgency || 'normal', // Safe default for urgency
        }));
        
        console.log('✅ Available jobs fetched:', mappedJobs.length);
        console.log('✅ Jobs fetched successfully:', mappedJobs.length);
        setAvailableJobs(mappedJobs as Job[]);

        // 2. Fetch My Applications
        console.log('🔍 Fetching my applications...');
        const { data: applicationsData, error: applicationsError } = await supabase
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

        if (applicationsError) {
          console.error('❌ Error in Query 2 (My Applications):');
          console.error('  Message:', applicationsError.message);
          console.error('  Code:', applicationsError.code);
          console.error('  Details:', applicationsError.details);
          console.error('  Hint:', applicationsError.hint);
          throw applicationsError;
        }
        
        // ✅ FIX 1: Map 'budget' in nested job objects
        // ✅ FIX 3: Ensure is_featured defaults to false if undefined
        // ✅ FIX: Ensure urgency defaults to 'normal' if undefined/null
        const mappedApplications = (applicationsData || []).map((app: any) => {
          if (app.job && typeof app.job === 'object' && !Array.isArray(app.job)) {
            return {
              ...app,
              job: {
                ...app.job,
                budget_min: app.job.budget !== undefined ? app.job.budget : (app.job.budget_min || 0),
                budget_max: app.job.budget_max || app.job.budget || app.job.budget_min || 0,
                is_featured: app.job.is_featured ?? false, // Safe default for is_featured
                urgency: app.job.urgency || 'normal', // Safe default for urgency
              },
            };
          }
          return app;
        });
        
        console.log('✅ Applications fetched:', mappedApplications.length);
        setMyApplications(mappedApplications as JobApplication[]);

        // 3. Fetch My Active Missions (Fixed Status Check)
        console.log('🔍 Fetching my active jobs (hired_inspector_id, status: in_progress)...');
        const { data: myJobsData, error: myJobsError } = await supabase
          .from('jobs')
          .select(`
            *,
            client:profiles!jobs_client_id_fkey(full_name, avatar_url, company_name)
          `)
          .eq('hired_inspector_id', user.id)
          // ✅ FIX: Match DB statuses - only 'in_progress' for active jobs
          .eq('status', 'in_progress')
          .order('updated_at', { ascending: false });

        if (myJobsError) {
          console.error('❌ Error in Query 3 (My Active Jobs):');
          console.error('  Message:', myJobsError.message);
          console.error('  Code:', myJobsError.code);
          console.error('  Details:', myJobsError.details);
          console.error('  Hint:', myJobsError.hint);
          throw myJobsError;
        }
        
        // ✅ FIX 1: Map 'budget' to 'budget_min' for TypeScript interface
        // ✅ FIX 3: Ensure is_featured defaults to false if undefined
        // ✅ FIX: Ensure urgency defaults to 'normal' if undefined/null
        const mappedMyJobs = (myJobsData || []).map((job: any) => ({
          ...job,
          budget_min: job.budget !== undefined ? job.budget : (job.budget_min || 0),
          budget_max: job.budget_max || job.budget || job.budget_min || 0,
          is_featured: job.is_featured ?? false, // Safe default for is_featured
          urgency: job.urgency || 'normal', // Safe default for urgency
        }));
        
        console.log('✅ Active jobs fetched:', mappedMyJobs.length);
        setMyJobs(mappedMyJobs as Job[]);
        
        // ✅ FIX 3: Success log - Main success confirmation
        console.log('✅ Jobs fetched successfully! Total:', {
          available: mappedJobs.length,
          applications: mappedApplications.length,
          active: mappedMyJobs.length,
        });
      } catch (err: any) {
        // ✅ DETAILED ERROR LOGGING - Log all Supabase error details
        console.error('════════════════════════════════════════');
        console.error('❌ ERROR FETCHING JOBS DATA');
        console.error('════════════════════════════════════════');
        console.error('Error Type:', err?.constructor?.name || typeof err);
        console.error('Error Message:', err?.message || 'No message');
        console.error('Error Code:', err?.code || 'No code');
        console.error('Error Details:', err?.details || 'No details');
        console.error('Error Hint:', err?.hint || 'No hint');
        try {
          console.error('Full Error Object:', JSON.stringify(err, null, 2));
        } catch (stringifyError) {
          console.error('Full Error Object (circular reference):', err);
        }
        
        // Log Supabase-specific error properties
        if (err?.status) console.error('HTTP Status:', err.status);
        if (err?.statusText) console.error('HTTP Status Text:', err.statusText);
        if (err?.response) console.error('Response:', err.response);
        
        // Log the query that failed (if available)
        console.error('User ID:', user?.id || 'No user');
        console.error('════════════════════════════════════════');
        
        setError(err?.message || 'Failed to fetch jobs data');
      } finally {
        // ✅ FIX 2: Ensure loading state is ALWAYS reset
        setIsLoading(false);
        setIsRefreshing(false);
        console.log('✅ Loading state reset (finally block executed)');
      }
    },
    [user?.id]
  );

  // ========================================
  // INITIAL LOAD & REALTIME
  // ========================================

  // Real-time Listeners
  useEffect(() => {
    if (!user?.id) return;

    fetchJobsData();

    // Listen for changes to MY jobs (e.g., when a client accepts my offer)
    const channel = supabase
      .channel('jobs_realtime')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `hired_inspector_id=eq.${user.id}`,
        },
        () => {
          fetchJobsData(true);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'job_applications',
          filter: `inspector_id=eq.${user.id}`,
        },
        () => {
          fetchJobsData(true);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchJobsData, user?.id]);

  // ========================================
  // APPLICATION ACTIONS
  // ========================================

  const applyToJob = useCallback(
    async (
      jobId: string,
      proposedPrice: number,
      coverLetter: string
    ): Promise<{ success: boolean; message: string; applicationId?: string }> => {
      try {
        // 1. دریافت صحیح کاربر (اصلاح شده)
        const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();

        if (userError || !currentUser) {
          console.error('❌ No user logged in:', userError?.message);
          return { success: false, message: 'Authentication required. Please log in.' };
        }

        // 2. ارسال درخواست (این بخش شما عالی بود)
        const { data, error } = await supabase
          .from('job_applications')
          .insert({
            job_id: jobId,
            inspector_id: currentUser.id, // ✅ الان user.id مقدار صحیح دارد
            status: 'pending', // ✅ مطابق با مقادیر مجاز دیتابیس
            cover_letter: coverLetter,
            proposed_price: proposedPrice,
          })
          .select()
          .single();

        if (error) {
          console.error('❌ Application submission error:', error.message);
          
          // Check for duplicate application error
          if (error.code === '23505') {
            return { success: false, message: 'Already applied to this job' };
          }
          
          // اینجا می‌توانید state ارور را آپدیت کنید تا به کاربر نمایش داده شود
          return {
            success: false,
            message: error.message || 'Failed to submit application',
          };
        }

        // اینجا می‌توانید نویگیشن انجام دهید یا پیام موفقیت نشان دهید
        console.log('✅ Application submitted successfully:', data);
        
        await fetchJobsData(true);
        return {
          success: true,
          message: 'Application sent!',
          applicationId: data.id,
        };
      } catch (err: any) {
        console.error('❌ Error applying to job:', err);
        return {
          success: false,
          message: err?.message || 'Failed to submit application',
        };
      }
    },
    [fetchJobsData]
  );

  const withdrawApplication = useCallback(
    async (
      applicationId: string
    ): Promise<{ success: boolean; message: string }> => {
      try {
        const { error } = await supabase
          .from('job_applications')
          .update({ status: 'withdrawn' })
          .eq('id', applicationId);

        if (error) {
          throw error;
        }

        await fetchJobsData(true);
        return {
          success: true,
          message: 'Application withdrawn successfully',
        };
      } catch (err: any) {
        console.error('❌ Error withdrawing application:', err);
        return {
          success: false,
          message: err?.message || 'Failed to withdraw application',
        };
      }
    },
    [fetchJobsData]
  );

  // ========================================
  // HELPER FUNCTIONS
  // ========================================

  // Helper: check if applied
  const hasAppliedToJob = useCallback(
    (jobId: string): boolean => {
      return myApplications.some(
        (app) => app.job_id === jobId && app.status !== 'rejected'
      );
    },
    [myApplications]
  );

  // Helper: get job details
  const getJobById = useCallback(
    async (jobId: string): Promise<Job | null> => {
      try {
        const { data, error } = await supabase
          .from('jobs')
          .select(`*, client:profiles!jobs_client_id_fkey(*)`)
          .eq('id', jobId)
          .single();

        if (error) {
          console.error('❌ Error fetching job:', error);
          return null;
        }

        // ✅ FIX 1: Map 'budget' to 'budget_min' for TypeScript interface
        if (data) {
          const mappedJob = {
            ...data,
            budget_min: (data as any).budget !== undefined ? (data as any).budget : ((data as any).budget_min || 0),
            budget_max: (data as any).budget_max || (data as any).budget || (data as any).budget_min || 0,
          };
          return mappedJob as Job;
        }

        return null;
      } catch (err) {
        console.error('❌ Error in getJobById:', err);
        return null;
      }
    },
    []
  );

  // ========================================
  // RETURN
  // ========================================

  return {
    availableJobs,
    myApplications,
    myJobs,
    isLoading,
    isRefreshing,
    error,
    refetch: () => fetchJobsData(true),
    applyToJob,
    withdrawApplication,
    hasAppliedToJob,
    getJobById,
  };
}
