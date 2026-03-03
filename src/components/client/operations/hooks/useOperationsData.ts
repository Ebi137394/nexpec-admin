// ─────────────────────────────────────────────────────────────
// NEXPEC — Operations Data Hook
// ─────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from 'react';
import { OperationsData } from '../types/operations.types';
import { mockOperationsData } from '../data/mockOperationsData';

interface UseOperationsReturn {
  data: OperationsData;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  dismissAlert: (alertId: string) => void;
  lastRefreshTime: string;
}

export const useOperationsData = (): UseOperationsReturn => {
  const [data, setData] = useState<OperationsData>(mockOperationsData);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);

      // Simulate API latency
      await new Promise((resolve) => setTimeout(resolve, silent ? 600 : 1400));

      // In production, replace with:
      // const response = await apiClient.get('/operations/dashboard');
      // setData(response.data);

      setData({ ...mockOperationsData });
      setLastRefreshTime(new Date().toLocaleTimeString());
      setError(null);
    } catch (err) {
      setError('Failed to load operations data. Pull to retry.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  const dismissAlert = useCallback((alertId: string) => {
    setData((prev) => ({
      ...prev,
      criticalAlerts: prev.criticalAlerts.map((a) =>
        a.id === alertId ? { ...a, isNew: false } : a,
      ),
    }));
  }, []);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 30 seconds (live operations)
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      fetchData(true);
    }, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refresh,
    dismissAlert,
    lastRefreshTime,
  };
};