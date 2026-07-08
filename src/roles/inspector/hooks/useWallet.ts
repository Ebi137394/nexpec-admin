import { useState, useEffect, useCallback, useId } from 'react';
import { supabase } from '@/lib/supabase';
import { useRealtimeSubscription } from '@/src/core/realtime/useRealtimeSubscription';
import type { Wallet, Transaction } from '@/types/core';
import { useAuth } from '@/src/contexts/AuthContext';

// ============================================================================
// TYPES
// ============================================================================

interface UseWalletReturn {
  wallet: Wallet | null;
  transactions: Transaction[];
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const TRANSACTIONS_PER_PAGE = 50;

// ============================================================================
// HOOK
// ============================================================================

export function useWallet(): UseWalletReturn {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ========================================
  // DATA FETCHING
  // ========================================

  const fetchWalletData = useCallback(
    async (showRefresh = false) => {
      if (!user?.id) return;

      try {
        if (showRefresh) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
        }
        setError(null);

        // 1. Fetch wallet data
        //   New accounts have no wallets row yet. .single() throws PGRST116
        //   (0 rows) → redbox, so use .maybeSingle() and fall back to a
        //   zeroed wallet so the hook never crashes and the balance UI reads $0.
        const { data: walletData, error: walletError } = await supabase
          .from('wallets')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle();

        if (walletError) {
          throw walletError;
        }

        if (!walletData) {
          // No wallet row yet — present a $0 wallet rather than null so
          // consumers (available/pending/earned reads) render zeros cleanly.
          setWallet({
            user_id: user.id,
            balance: 0,
            available_balance: 0,
            pending_amount: 0,
            pending_payouts: 0,
            escrow_amount: 0,
            total_earned: 0,
            total_spent: 0,
            total_volume: 0,
            agency_revenue: 0,
            currency: 'CAD',
          } as Wallet);
          setTransactions([]);
          return;
        }

        setWallet(walletData as Wallet);

        // 2. Fetch transactions
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(TRANSACTIONS_PER_PAGE);

        if (transactionsError) {
          throw transactionsError;
        }

        setTransactions((transactionsData || []) as Transaction[]);
      } catch (err: any) {
        console.error('❌ Error fetching wallet data:', err);
        setError(err?.message || 'Failed to fetch wallet data');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [user?.id]
  );

  // ========================================
  // INITIAL LOAD
  // ========================================

  useEffect(() => {
    if (user?.id) {
      fetchWalletData();
    }
  }, [fetchWalletData, user?.id]);

  // ========================================
  // REALTIME SUBSCRIPTION
  // ========================================

  // Realtime — reconnect-aware: refetch on desync so the balance can't silently
  // freeze after a network drop. Channel name is scoped per user + instance.
  const walletChannelId = useId();
  useRealtimeSubscription({
    channelName: `wallet_updates:${user?.id ?? 'anon'}:${walletChannelId}`,
    bindings: [
      {
        event: 'UPDATE',
        table: 'wallets',
        filter: user?.id ? `user_id=eq.${user.id}` : undefined,
      },
    ],
    onChange: (payload) => setWallet(payload.new as Wallet),
    onDesync: () => {
      void fetchWalletData(true);
    },
    enabled: !!user?.id,
  });

  // ========================================
  // RETURN
  // ========================================

  return {
    wallet,
    transactions,
    isLoading,
    isRefreshing,
    error,
    refetch: () => fetchWalletData(true),
  };
}