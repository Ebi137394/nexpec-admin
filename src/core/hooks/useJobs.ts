import { useState, useEffect, useCallback, useId } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import type { Job, JobApplication } from '@/types/core';
import { useAuth } from '@/src/contexts/AuthContext';
// GR2 (blind pricing) allowlists — the single source of truth for which
// columns each role may read off `jobs`. INSPECTOR_JOB_FIELDS contains the
// inspector's OWN payout but never client_price_cents, platform_spread_cents
// or the budget_* family. Never replace these with select('*').
import { INSPECTOR_JOB_FIELDS } from '@/lib/jobsProjection';

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
          // GR2: explicit inspector allowlist. GOLDEN_RULE_4/7: the client embed
          // is company_name only — never full_name / email / phone.
          .select(`${INSPECTOR_JOB_FIELDS}, client:profiles!jobs_client_id_fkey(id, company_name)`)
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

        // 2. Fetch My Applications
        //
        // ★ PGRST200 FIX (2026-08-05). This used to embed `job:jobs(...)`, which
        //   PostgREST can only resolve through a real foreign key. There is NO
        //   applications.job_id → jobs.id constraint in the schema (applications
        //   only has applicant_id → profiles.id and user_id → auth.users.id), so
        //   every call failed with:
        //     "Could not find a relationship between 'applications' and 'jobs'".
        //   Because the error was thrown, step 3 below never ran: Active Missions
        //   stayed empty AND myApplications stayed [], which silently made
        //   hasAppliedToJob() always return false and let an inspector submit a
        //   second application that the DB then rejected.
        //
        //   Fixed with the same manual fetch/stitch already used by
        //   app/(admin)/pending-hires.tsx rather than by adding an FK, so no
        //   schema change and no RLS change is required.
        console.log('🔍 Fetching my applications...');
        const { data: applicationsData, error: applicationsError } = await supabase
          .from('applications')
          .select('*')
          .eq('applicant_id', user.id)
          .order('created_at', { ascending: false });

        if (applicationsError) {
          throw applicationsError;
        }

        // Stitch the jobs on separately. GOLDEN_RULE_2: this is an INSPECTOR
        // surface, so it uses the shared GR2 allowlist INSPECTOR_JOB_FIELDS.
        const appJobIds = Array.from(
          new Set(
            (applicationsData || [])
              .map((a: any) => a?.job_id)
              .filter((v: any): v is string => typeof v === 'string' && v.length > 0)
          )
        );

        let jobsById = new Map<string, any>();
        if (appJobIds.length > 0) {
          const { data: appJobs, error: appJobsError } = await supabase
            .from('jobs')
            .select(INSPECTOR_JOB_FIELDS)
            .in('id', appJobIds);

          // Non-fatal: a missing job row must not blank out My Applications or
          // abort the Active Missions fetch below.
          if (appJobsError) {
            console.warn('⚠️ Could not load jobs for applications', appJobsError);
          } else {
            jobsById = new Map((appJobs || []).map((j: any) => [j.id, j]));
          }
        }

        const mappedApplications = (applicationsData || []).map((app: any) => {
          const job = jobsById.get(app.job_id);
          if (!job) return app;
          return {
            ...app,
            job: {
              ...job,
              is_featured: job.is_featured ?? false,
              urgency: job.urgency || 'normal',
            },
          };
        });

        setMyApplications(mappedApplications as JobApplication[]);

        // 3. Fetch My Active Missions
        console.log('🔍 Fetching my active jobs...');
        const { data: myJobsData, error: myJobsError } = await supabase
          .from('jobs')
          // GR2 + GOLDEN_RULE_4/7, as above. Being the assigned inspector does
          // not entitle them to the client price or the platform spread.
          .select(`${INSPECTOR_JOB_FIELDS}, client:profiles!jobs_client_id_fkey(id, company_name)`)
          .eq('contractor_id', user.id)
          .in('status', ['assigned', 'in_progress'])
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
        filter: user?.id ? `contractor_id=eq.${user.id}` : undefined,
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
          // Was `*, client:profiles(*)` — that shipped client_price_cents,
          // platform_spread_cents and the client's ENTIRE profile row
          // (email/phone/cv_url) to any inspector opening the apply screen.
          .select(`${INSPECTOR_JOB_FIELDS}, client:profiles!jobs_client_id_fkey(id, company_name)`)
          .eq('id', jobId)
          .single();

        if (error) {
          return null;
        }

        if (data) {
          // supabase-js parses the select string at the TYPE level, so a
          // template literal (`${INSPECTOR_JOB_FIELDS}, …`) is not statically
          // analyzable and `data` degrades to a non-object parser type. Narrow
          // once here rather than casting at every property access.
          const row = data as unknown as Record<string, unknown>;
          const mappedJob = {
            ...row,
            budget_min: row.budget !== undefined ? row.budget : (row.budget_min || 0),
            budget_max: row.budget_max || row.budget || row.budget_min || 0,
          };
          return mappedJob as unknown as Job;
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
