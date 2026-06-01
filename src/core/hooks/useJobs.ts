import { useState, useEffect, useCallback, useId } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import type { Job, JobApplication } from '@/types/core';
import { useAuth } from '@/src/contexts/AuthContext';

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
          throw jobsError;
        }
        
        const mappedJobs = (jobsData || []).map((job: any) => ({
          ...job,
          budget_min: job.budget !== undefined ? job.budget : (job.budget_min || 0),
          budget_max: job.budget_max || job.budget || job.budget_min || 0,
          is_featured: job.is_featured ?? false, 
          urgency: job.urgency || 'normal', 
        }));
        
        setAvailableJobs(mappedJobs as Job[]);

        // 2. Fetch My Applications (FIXED: applications table, applicant_id column)
        console.log('🔍 Fetching my applications...');
        const { data: applicationsData, error: applicationsError } = await supabase
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

        if (applicationsError) {
          throw applicationsError;
        }
        
        const mappedApplications = (applicationsData || []).map((app: any) => {
          if (app.job && typeof app.job === 'object' && !Array.isArray(app.job)) {
            return {
              ...app,
              job: {
                ...app.job,
                budget_min: app.job.budget !== undefined ? app.job.budget : (app.job.budget_min || 0),
                budget_max: app.job.budget_max || app.job.budget || app.job.budget_min || 0,
                is_featured: app.job.is_featured ?? false, 
                urgency: app.job.urgency || 'normal', 
              },
            };
          }
          return app;
        });
        
        setMyApplications(mappedApplications as JobApplication[]);

        // 3. Fetch My Active Missions
        console.log('🔍 Fetching my active jobs...');
        const { data: myJobsData, error: myJobsError } = await supabase
          .from('jobs')
          .select(`
            *,
            client:profiles!jobs_client_id_fkey(full_name, avatar_url, company_name)
          `)
          .eq('hired_inspector_id', user.id)
          .eq('status', 'in_progress')
          .order('updated_at', { ascending: false });

        if (myJobsError) {
          throw myJobsError;
        }
        
        const mappedMyJobs = (myJobsData || []).map((job: any) => ({
          ...job,
          budget_min: job.budget !== undefined ? job.budget : (job.budget_min || 0),
          budget_max: job.budget_max || job.budget || job.budget_min || 0,
          is_featured: job.is_featured ?? false, 
          urgency: job.urgency || 'normal', 
        }));
        
        setMyJobs(mappedMyJobs as Job[]);
        
      } catch (err: any) {
        console.error('❌ ERROR FETCHING JOBS DATA', err);
        setError(err?.message || 'Failed to fetch jobs data');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user?.id]
  );

  // ========================================
  // INITIAL LOAD & REALTIME
  // ========================================

  useEffect(() => {
    if (!user?.id) return;
    fetchJobsData();
  }, [fetchJobsData, user?.id]);

  // FIXED: Realtime listener on 'applications' table and 'applicant_id' column
  const channelId = useId();
  useRealtimeSubscription({
    channelName: `jobs_realtime:${user?.id ?? 'anon'}:${channelId}`,
    bindings: [
      {
        event: '*', // 🔴 CRITICAL FIX: Changed from 'UPDATE'
        table: 'jobs',
        filter: user?.id ? `hired_inspector_id=eq.${user.id}` : undefined,
      },
      {
        event: '*', // 🔴 CRITICAL FIX: Changed from 'UPDATE'
        table: 'applications',
        filter: user?.id ? `applicant_id=eq.${user.id}` : undefined,
      },
    ],
    onChange: () => {
      fetchJobsData(true);
    },
    onDesync: () => {
      fetchJobsData(true);
    },
    enabled: !!user?.id,
  });

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
        const { data: { user: currentUser }, error: userError } = await supabase.auth.getUser();

        if (userError || !currentUser) {
          return { success: false, message: 'Authentication required. Please log in.' };
        }

        // FIXED: Insert into 'applications', mapped 'applicant_id' and added 'user_id'
        const { data, error } = await supabase
          .from('applications')
          .insert({
            job_id: jobId,
            applicant_id: currentUser.id,
            user_id: currentUser.id, 
            status: 'pending', 
            cover_letter: coverLetter,
            proposed_price: proposedPrice,
          })
          .select()
          .single();

        if (error) {
          console.error('❌ Application submission error:', error.message);
          if (error.code === '23505' || error.message?.includes('duplicate key')) {
            return { success: false, message: 'Already applied to this job' };
          }
          return {
            success: false,
            message: error.message || 'Failed to submit application',
          };
        }

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
        // FIXED: Update 'applications' table
        const { error } = await supabase
          .from('applications')
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

  const hasAppliedToJob = useCallback(
    (jobId: string): boolean => {
      return myApplications.some(
        (app) => app.job_id === jobId && app.status !== 'rejected'
      );
    },
    [myApplications]
  );

  const getJobById = useCallback(
    async (jobId: string): Promise<Job | null> => {
      try {
        const { data, error } = await supabase
          .from('jobs')
          .select(`*, client:profiles!jobs_client_id_fkey(*)`)
          .eq('id', jobId)
          .single();

        if (error) {
          return null;
        }

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
        return null;
      }
    },
    []
  );

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
