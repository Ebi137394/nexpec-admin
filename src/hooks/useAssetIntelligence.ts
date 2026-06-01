import { useState, useEffect, useCallback, useRef, useId } from 'react';
import { supabase } from '../lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';

export interface Asset {
  id: string;
  organization_id: string;
  name: string;
  serial_number: string;
  type: string;
  status: 'available' | 'deployed' | 'maintenance' | 'retired';
  location: string;
  assigned_to: string | null;
  last_maintenance: string | null;
  next_maintenance: string | null;
  purchase_date: string | null;
  notes: string | null;
}

export interface AssetIntelligencePayload {
  assets: Asset[];
  searchResults: Asset[];
  queryAssetIntelligence: (query: string) => void;
  searchQuery: string;
  loading: boolean;
  searching: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAssetIntelligence(
  organizationId?: string
): AssetIntelligencePayload {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [searchResults, setSearchResults] = useState<Asset[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchAssets = useCallback(async () => {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      const { data, error: qErr } = await supabase
        .from('equipment')
        .select('*')
        .eq('organization_id', organizationId)
        .order('name', { ascending: true });

      if (qErr) throw qErr;
      const all = (data ?? []) as Asset[];
      setAssets(all);
      if (!searchQuery) setSearchResults(all);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [organizationId, searchQuery]);

  const queryAssetIntelligence = useCallback(
    (query: string) => {
      setSearchQuery(query);

      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (!query.trim()) {
        setSearchResults(assets);
        setSearching(false);
        return;
      }

      setSearching(true);

      debounceRef.current = setTimeout(async () => {
        if (!organizationId) return;

        try {
          const q = query.trim().toLowerCase();

          const { data, error: sErr } = await supabase
            .from('equipment')
            .select('*')
            .eq('organization_id', organizationId)
            .or(
              `name.ilike.%${q}%,serial_number.ilike.%${q}%,type.ilike.%${q}%,location.ilike.%${q}%`
            )
            .order('name', { ascending: true });

          if (sErr) throw sErr;
          setSearchResults((data ?? []) as Asset[]);
        } catch (err: any) {
          setError(err.message);
        } finally {
          setSearching(false);
        }
      }, 300);
    },
    [organizationId, assets]
  );

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const channelId = useId();
  useRealtimeSubscription({
    channelName: `assets:${organizationId ?? 'none'}:${channelId}`,
    bindings: [
      {
        event: '*',
        table: 'equipment',
        filter: organizationId
          ? `organization_id=eq.${organizationId}`
          : undefined,
      },
    ],
    onChange: () => fetchAssets(),
    onDesync: () => {
      fetchAssets();
    },
    enabled: !!organizationId,
  });

  return {
    assets,
    searchResults,
    queryAssetIntelligence,
    searchQuery,
    loading,
    searching,
    error,
    refresh: fetchAssets,
  };
}