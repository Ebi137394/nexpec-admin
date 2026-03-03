import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface CriticalAlert {
  id: string;
  organization_id: string;
  title: string;
  message: string;
  severity: 'critical' | 'warning' | 'info';
  source: string;
  resolved: boolean;
  created_at: string;
  acknowledged_by: string | null;
}

export function useCriticalAlerts(organizationId?: string) {
  const [alerts, setAlerts] = useState<CriticalAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const { data, error: queryError } = await supabase
        .from('alerts')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('resolved', false)
        .in('severity', ['critical', 'warning'])
        .order('created_at', { ascending: false });

      if (queryError) throw queryError;
      setAlerts(data ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    fetchAlerts();

    if (!organizationId) return;

    const channel = supabase
      .channel(`critical-alerts:${organizationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'alerts',
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          switch (payload.eventType) {
            case 'INSERT': {
              const incoming = payload.new as CriticalAlert;
              if (!incoming.resolved && ['critical', 'warning'].includes(incoming.severity)) {
                setAlerts((prev) => [incoming, ...prev]);
              }
              break;
            }
            case 'UPDATE': {
              const updated = payload.new as CriticalAlert;
              if (updated.resolved) {
                setAlerts((prev) => prev.filter((a) => a.id !== updated.id));
              } else {
                setAlerts((prev) =>
                  prev.map((a) => (a.id === updated.id ? updated : a))
                );
              }
              break;
            }
            case 'DELETE': {
              const old = payload.old as { id: string };
              setAlerts((prev) => prev.filter((a) => a.id !== old.id));
              break;
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, fetchAlerts]);

  const acknowledgeAlert = useCallback(
    async (alertId: string) => {
      if (!organizationId) return;
      const user = await supabase.auth.getUser();
      const { error: ackError } = await supabase
        .from('alerts')
        .update({
          resolved: true,
          acknowledged_by: user.data.user?.id || null,
        })
        .eq('id', alertId)
        .eq('organization_id', organizationId);

      if (ackError) setError(ackError.message);
    },
    [organizationId]
  );

  return { alerts, loading, error, acknowledgeAlert, refresh: fetchAlerts };
}