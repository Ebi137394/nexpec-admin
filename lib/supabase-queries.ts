// lib/supabase-queries.ts
import { supabase } from './supabase';

// =====================================================
// TYPES
// =====================================================

export interface Contract {
  id: string;
  job_id: string;
  contractor_id?: string;
  worker_id?: string;
  inspector_id?: string;
  status: string;
  amount?: number;
  price?: number;
  created_at: string;
  updated_at?: string;
  job?: Job;
  jobs?: Job; // Supabase sometimes nests as singular
}

export interface Job {
  id: string;
  title: string;
  description?: string;
  location?: string;
  address?: string;
  status: string;
  budget?: number;
  budget_min?: number;
  budget_max?: number;
  property_type?: string;
  inspection_type?: string;
  created_at: string;
}

export interface DashboardData {
  activeJobs: number;
  completedJobs: number;
  pendingProposals: number;
  totalEarnings: number;
  unreadNotifications: number;
  recentJobs: Contract[];
}

// =====================================================
// STATUS CONSTANTS
// =====================================================

export const ACTIVE_STATUSES = ['in_progress', 'active', 'accepted', 'ongoing', 'assigned'];
export const COMPLETED_STATUSES = ['completed', 'done', 'finished', 'closed'];

// =====================================================
// FETCH MY JOBS (CONTRACTS)
// =====================================================

export async function fetchMyJobs(
  userId: string, 
  filter: 'active' | 'completed' | 'all'
): Promise<{ data: Contract[]; error: string | null }> {
  try {
    if (!userId) {
      return { data: [], error: null };
    }

    // ✅ Use contractor_id to match database column
    let query = supabase
      .from('contracts')
      .select('*, job:jobs(*)')
      .eq('contractor_id', userId) // ✅ FIX: Use contractor_id (primary column)
      .order('created_at', { ascending: false });
    
    if (filter === 'active') query = query.in('status', ACTIVE_STATUSES);
    if (filter === 'completed') query = query.in('status', COMPLETED_STATUSES);
    
    const { data, error } = await query;
    
    if (error) {
      console.error('❌ fetchMyJobs error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return { data: [], error: error.message || 'Failed to fetch jobs' };
    }
    
    const normalizedData = (data || []).map(d => ({ 
      ...d, 
      job: d.job || d.jobs || null 
    })) as Contract[];
    
    return { data: normalizedData, error: null };
  } catch (err) {
    console.error('❌ fetchMyJobs exception:', err);
    return { 
      data: [], 
      error: err instanceof Error ? err.message : 'An unexpected error occurred' 
    };
  }
}

// =====================================================
// FETCH PENDING PROPOSALS
// =====================================================

export async function fetchPendingProposals(
  userId: string
): Promise<{ data: Contract[]; error: string | null }> {
  try {
    if (!userId) {
      return { data: [], error: null };
    }

    // ✅ Fetch from proposals table (not contracts) for pending applications
    const { data, error } = await supabase
      .from('proposals')
      .select('*, job:jobs(*)')
      .eq('contractor_id', userId) // ✅ FIX: Use contractor_id to filter proposals
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('❌ fetchPendingProposals error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      return { data: [], error: error.message || 'Failed to fetch proposals' };
    }
    
    // ✅ Transform proposals to match Contract interface
    const normalizedData = (data || []).map((proposal: any) => ({
      id: proposal.id,
      job_id: proposal.job_id,
      contractor_id: proposal.contractor_id,
      status: 'pending', // Proposals are always pending
      amount: proposal.price || proposal.amount,
      price: proposal.price || proposal.amount,
      created_at: proposal.created_at,
      updated_at: proposal.updated_at,
      job: proposal.job || proposal.jobs || null,
    })) as Contract[];
    
    return { data: normalizedData, error: null };
  } catch (err) {
    console.error('❌ fetchPendingProposals exception:', err);
    return { 
      data: [], 
      error: err instanceof Error ? err.message : 'An unexpected error occurred' 
    };
  }
}

// =====================================================
// FETCH DASHBOARD DATA (Using Promise.allSettled)
// =====================================================

export async function fetchDashboardData(userId: string): Promise<{ data: DashboardData; errors: string[] }> {
  // Default data structure
  const defaultData: DashboardData = {
    activeJobs: 0,
    completedJobs: 0,
    pendingProposals: 0,
    totalEarnings: 0,
    unreadNotifications: 0,
    recentJobs: [],
  };

  if (!userId) return { data: defaultData, errors: ['No user ID'] };
  
  // ✅ Use allSettled so one failure doesn't crash the whole dashboard
  console.log('🔍 Dashboard: Fetching data for user:', userId);
  const results = await Promise.allSettled([
    supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('contractor_id', userId).in('status', ACTIVE_STATUSES),
    supabase.from('contracts').select('*', { count: 'exact', head: true }).eq('contractor_id', userId).in('status', COMPLETED_STATUSES),
    supabase.from('proposals').select('*', { count: 'exact', head: true }).eq('contractor_id', userId).eq('status', 'pending'), // ✅ FIX: Count from proposals table using contractor_id
    supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).eq('read', false)
  ]);
  
  // ✅ Debug logging
  console.log('📊 Dashboard results:', {
    activeJobs: results[0].status === 'fulfilled' ? results[0].value.count : 'error',
    completedJobs: results[1].status === 'fulfilled' ? results[1].value.count : 'error',
    pendingProposals: results[2].status === 'fulfilled' ? results[2].value.count : 'error',
  });

  const activeJobs = results[0].status === 'fulfilled' && !results[0].value.error ? results[0].value.count || 0 : 0;
  const completedJobs = results[1].status === 'fulfilled' && !results[1].value.error ? results[1].value.count || 0 : 0;
  const pendingProposals = results[2].status === 'fulfilled' && !results[2].value.error ? results[2].value.count || 0 : 0;
  // ✅ Notifications: Silent fail - never crash on notifications
  const unreadNotifications = results[3].status === 'fulfilled' && !results[3].value.error ? results[3].value.count || 0 : 0;

  return {
    data: { activeJobs, completedJobs, pendingProposals, unreadNotifications, totalEarnings: 0, recentJobs: [] },
    errors: results.filter(r => r.status === 'rejected').map(r => String((r as PromiseRejectedResult).reason))
  };
}
