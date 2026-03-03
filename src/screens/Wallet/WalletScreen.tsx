// src/screens/Wallet/WalletScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';

interface Wallet {
  balance: number;
}

interface Transaction {
  id: string;
  type: 'payout' | 'deposit' | 'fee' | 'withdrawal';
  amount: number;
  description: string;
  created_at: string;
}

export const WalletScreen = () => {
  const [balance, setBalance] = useState<number>(0);
  const [history, setHistory] = useState<Transaction[]>([]);

  const loadWalletData = async () => {
    const { data: wallet, error: walletError } = await supabase.from('wallets').select('balance').single();
    const { data: txs, error: txsError } = await supabase.from('transactions').select('*').order('created_at', { ascending: false });
    
    if (walletError) {
      console.error('Error fetching wallet:', walletError);
    } else if (wallet) {
      setBalance(wallet.balance);
    }
    
    if (txsError) {
      console.error('Error fetching transactions:', txsError);
    } else if (txs) {
      setHistory(txs);
    }
  };

  useEffect(() => { loadWalletData(); }, []);

  return (
    <View style={styles.container}>
      <View style={styles.balanceCard}>
        <Text style={styles.label}>Available Balance</Text>
        <Text style={styles.amount}>${balance.toLocaleString()} CAD</Text>
      </View>

      <Text style={styles.title}>Recent Transactions</Text>
      <FlatList
        data={history}
        renderItem={({ item }) => (
          <View style={styles.txRow}>
            <Text style={item.type === 'payout' ? styles.plus : styles.minus}>
              {item.type === 'payout' ? '+' : '-'}${item.amount}
            </Text>
            <Text style={styles.txDate}>{new Date(item.created_at).toLocaleDateString()}</Text>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#F9FAFB' },
  balanceCard: { backgroundColor: '#1E293B', padding: 30, borderRadius: 20, alignItems: 'center' },
  amount: { fontSize: 32, fontWeight: 'bold', color: '#FFF', marginTop: 10 },
  label: { color: '#94A3B8', fontSize: 14 },
  title: { fontSize: 18, fontWeight: 'bold', marginVertical: 20 },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 15, backgroundColor: '#FFF', borderRadius: 10, marginBottom: 8 },
  plus: { color: '#10B981', fontWeight: 'bold' },
  minus: { color: '#EF4444', fontWeight: 'bold' },
  txDate: { color: '#6B7280' }
});