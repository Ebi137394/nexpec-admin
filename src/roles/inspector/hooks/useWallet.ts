import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Wallet, Transaction, BankDetails } from '@/types/core';
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
  // آپدیت شد تا کد موسسه رو هم بتونه دریافت کنه
  requestWithdrawal: (
    amount: number,
    bankDetails: BankDetails & { institution_number?: string }
  ) => Promise<{ success: boolean; message: string }>;
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
        const { data: walletData, error: walletError } = await supabase
          .from('wallets')
          .select('*')
          .eq('user_id', user.id)
          .single();

        if (walletError) {
          throw walletError;
        }

        setWallet(walletData as Wallet);

        // 2. Fetch transactions
        const { data: transactionsData, error: transactionsError } = await supabase
          .from('transactions')
          .select('*')
          .eq('wallet_id', walletData.id)
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

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('wallet_updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'wallets',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          setWallet(payload.new as Wallet);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // ========================================
  // WITHDRAWAL ACTIONS
  // ========================================

  const requestWithdrawal = useCallback(
    async (
      amount: number,
      bankDetails: BankDetails & { institution_number?: string }
    ): Promise<{ success: boolean; message: string }> => {
      if (!user?.id || !wallet) {
        return {
          success: false,
          message: 'Wallet not initialized',
        };
      }

      try {
        setError(null);

        // ─── 1. اتصال به داشبورد سوپر ادمین (مرحله جدید) ───
        // درخواست رو تو جدول payout_requests ثبت می‌کنیم تا ادمین بتونه تاییدش کنه
        const { error: payoutError } = await supabase
          .from('payout_requests')
          .insert({
            inspector_id: user.id,
            amount: amount,
            status: 'pending',
            bank_metadata: {
              bank_name: bankDetails.bank_name || '',
              account_number: bankDetails.account_number || '',
              transit_number: bankDetails.transit_number || '',
              institution_number: bankDetails.institution_number || '',
              account_holder_name: bankDetails.account_holder_name || '',
              email: bankDetails.email || user?.email || '',
            },
          });

        if (payoutError) {
          console.error('[requestWithdrawal] Supabase insert error:', payoutError);
          throw new Error('Failed to submit withdrawal request to Admin.');
        }

        // ─── 2. منطق اصلی خودت برای کم کردن موجودی (بدون تغییر) ───
        const { error: rpcError } = await supabase.rpc('request_withdrawal', {
          p_amount: amount,
          p_bank_details: bankDetails,
          p_payout_method: 'bank_transfer',
        });

        if (rpcError) {
          throw rpcError;
        }

        await fetchWalletData(true);
        return {
          success: true,
          message: 'Withdrawal requested successfully',
        };
      } catch (err: any) {
        const errorMessage = err?.message || 'Withdrawal failed';
        setError(errorMessage);
        console.error('❌ Error requesting withdrawal:', err);
        return {
          success: false,
          message: errorMessage,
        };
      }
    },
    [user?.id, user?.email, wallet, fetchWalletData]
  );

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
    requestWithdrawal,
  };
}