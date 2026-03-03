import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export type MemberStatus = 'ACTIVE' | 'IDLE' | 'ON_SITE' | 'OFFLINE';

export interface TeamMember {
  id: string;
  organization_id: string;
  full_name: string;
  role: string;
  status: MemberStatus;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  last_active: string | null;
  current_project: string | null;
}

export interface TeamTrackerPayload {
  members: TeamMember[];
  statusCounts: Record<MemberStatus, number>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTeamTracker(organizationId?: string): TeamTrackerPayload {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const { data, error: qErr } = await supabase
        .from('profiles')
        .select(
          'id, organization_id, full_name, role, status, avatar_url, phone, email, last_active, current_project'
        )
        .eq('organization_id', organizationId)
        .order('full_name', { ascending: true });

      if (qErr) throw qErr;
      setMembers((data ?? []) as TeamMember[]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchTeam();

    if (!organizationId) return;

    const channel = supabase
      .channel(`team:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          switch (payload.eventType) {
            case 'UPDATE': {
              const updated = payload.new as TeamMember;
              setMembers((prev) =>
                prev.map((m) => (m.id === updated.id ? updated : m))
              );
              break;
            }
            case 'INSERT': {
              const inserted = payload.new as TeamMember;
              setMembers((prev) => [...prev, inserted]);
              break;
            }
            case 'DELETE': {
              const deleted = payload.old as { id: string };
              setMembers((prev) =>
                prev.filter((m) => m.id !== deleted.id)
              );
              break;
            }
            default:
              fetchTeam();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, fetchTeam]);

  const statusCounts = members.reduce(
    (acc, m) => {
      acc[m.status] = (acc[m.status] || 0) + 1;
      return acc;
    },
    { ACTIVE: 0, IDLE: 0, ON_SITE: 0, OFFLINE: 0 } as Record<
      MemberStatus,
      number
    >
  );

  return { members, statusCounts, loading, error, refresh: fetchTeam };
}