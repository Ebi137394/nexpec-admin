// src/hooks/useMeetings.ts — Brokered War Room data (meetings on a Job or RFQ).
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface Meeting {
  id: string; job_id: string | null; rfq_id: string | null; organizer_id: string;
  title: string; provider: string; url: string; scheduled_at: string; duration_min: number; status: string;
}

export function useMeetings(opts: { jobId?: string; rfqId?: string }) {
  const [items, setItems] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  // ★ 2026-08-05: the query error used to be discarded (`const { data } = await q`),
  //   so a denied or failed read was indistinguishable from a genuinely empty
  //   list and the panel rendered a confident "No meetings scheduled." Callers
  //   now receive the error and must render it distinctly.
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    let q = supabase.from('job_meetings').select('*').order('scheduled_at', { ascending: true });
    if (opts.jobId) q = q.eq('job_id', opts.jobId);
    else if (opts.rfqId) q = q.eq('rfq_id', opts.rfqId);
    const { data, error: qError } = await q;
    if (qError) {
      console.error('[useMeetings] job_meetings read failed →', qError);
      setError(qError.message || 'Could not load meetings.');
      setItems([]);
    } else {
      setItems((data ?? []) as Meeting[]);
    }
    setLoading(false);
  }, [opts.jobId, opts.rfqId]);
  useEffect(() => { load(); }, [load]);
  return { items, loading, error, refetch: load };
}

export const scheduleMeeting = (a: {
  title: string; url: string; scheduled_at: string; participant_ids: string[];
  job_id?: string | null; rfq_id?: string | null; provider?: string; duration_min?: number;
}) =>
  supabase.rpc('schedule_meeting', {
    p_title: a.title, p_url: a.url, p_scheduled_at: a.scheduled_at, p_participant_ids: a.participant_ids,
    p_job_id: a.job_id ?? null, p_rfq_id: a.rfq_id ?? null, p_provider: a.provider ?? 'other', p_duration_min: a.duration_min ?? 30,
  });

export const cancelMeeting = (id: string) => supabase.rpc('cancel_meeting', { p_meeting_id: id });
