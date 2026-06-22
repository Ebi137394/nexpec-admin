// ============================================================================
// WALLET SCREEN
// ============================================================================
// Inspector wallet screen with balance, transactions, and withdrawal

import React, { useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useWallet } from '@/hooks/useWallet';
import type { Transaction } from '@/types/core';
import { GradientCard } from '@/components';
import { useLanguage } from '@/src/i18n/LanguageProvider';
// #QA — canonical USD/cents money formatter (single source of truth, mirrors web).
import { formatUsd, toCents } from '@/src/core/utils/money';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Delegates to the canonical USD formatter. Input is dollars (wallets table is
// numeric dollars); normalize to cents at this boundary, render USD. #QA
const formatCurrency = (amount: number): string =>
  formatUsd(toCents(amount), { fractionDigits: 2 });

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

// ============================================================================
// COMPONENTS
// ============================================================================

interface TransactionItemProps {
  transaction: Transaction;
  index: number;
}

function TransactionItem({ transaction, index }: TransactionItemProps) {
  // NEXPEC Logic: 'payment_received' is positive, 'withdrawal' is negative
  const isCredit = ['payment_received', 'escrow_release', 'refund'].includes(
    transaction.type
  );

  const getIcon = () => {
    switch (transaction.type) {
      case 'payment_received':
        return 'arrow-down-circle';
      case 'withdrawal':
        return 'arrow-up-circle';
      case 'escrow_release':
        return 'lock-open'; // Visual cue for funds released from job
      case 'fee':
        return 'ticket-outline';
      default:
        return 'cash';
    }
  };

  const getStatusColor = () => {
    switch (transaction.status) {
      case 'completed':
        return '#10B981';
      case 'pending':
        return '#F59E0B';
      case 'failed':
        return '#EF4444';
      case 'reversed':
        return '#6B7280';
      default:
        return '#94A3B8';
    }
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify()}
      style={styles.transactionItem}
    >
      <View
        style={[
          styles.transactionIconContainer,
          {
            backgroundColor: isCredit
              ? 'rgba(16, 185, 129, 0.1)'
              : 'rgba(239, 68, 68, 0.1)',
          },
        ]}
      >
        <Ionicons
          name={getIcon() as any}
          size={24}
          color={isCredit ? '#10B981' : '#EF4444'}
        />
      </View>
      <View style={styles.transactionDetails}>
        <Text style={styles.transactionTitle}>
          {transaction.description ||
            transaction.type.replace('_', ' ').replace(/\b\w/g, (l) =>
              l.toUpperCase()
            )}
        </Text>
        <View style={styles.transactionMeta}>
          <Text style={styles.transactionDate}>
            {formatDate(transaction.created_at)}
          </Text>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: `${getStatusColor()}20` },
            ]}
          >
            <Text style={[styles.statusText, { color: getStatusColor() }]}>
              {transaction.status}
            </Text>
          </View>
        </View>
      </View>
      <Text
        style={[
          styles.transactionAmount,
          { color: isCredit ? '#10B981' : '#EF4444' },
        ]}
      >
        {isCredit ? '+' : '-'}
        {formatCurrency(transaction.amount)}
      </Text>
    </Animated.View>
  );
}

function BalanceCard({
  wallet,
  isLoading,
}: {
  wallet: any;
  isLoading: boolean;
}) {
  const { t, isRTL, language } = useLanguage();
  return (
    <Animated.View entering={FadeInUp.springify()}>
      {/* ✅ FIX: Used GradientCard variant="primary" for consistency */}
      <GradientCard variant="primary" style={styles.balanceCard}>
        <View style={styles.balanceHeader}>
          <Text style={styles.balanceLabel}>{t('Available Balance')}</Text>
          <View style={styles.currencyBadge}>
            <Text style={styles.currencyText}>{wallet?.currency || 'CAD'}</Text>
          </View>
        </View>

        {isLoading ? (
          <ActivityIndicator
            size="large"
            color="#FFFFFF"
            style={{ marginVertical: 20 }}
          />
        ) : (
          <Text style={styles.balanceAmount}>
            {formatCurrency(wallet?.available_balance ?? wallet?.balance ?? 0)}
          </Text>
        )}
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 4 }}>
          {t('Cleared funds, ready to withdraw')}
        </Text>

        <View style={styles.balanceStats}>
          <View style={styles.balanceStat}>
            <Text style={styles.balanceStatLabel}>{t('Pending')}</Text>
            {/* Accrued on net-terms jobs; clears when the client settles. */}
            <Text style={styles.balanceStatValue}>
              {formatCurrency(wallet?.pending_amount || 0)}
            </Text>
          </View>
          <View style={styles.balanceStatDivider} />
          <View style={styles.balanceStat}>
            <Text style={styles.balanceStatLabel}>{t('Total Earned')}</Text>
            <Text style={styles.balanceStatValue}>
              {formatCurrency(wallet?.total_earned || 0)}
            </Text>
          </View>
        </View>

        <View style={styles.balanceActions}>
          <Pressable
            style={styles.withdrawButton}
            onPress={() => router.push('/(inspector)/wallet/withdraw')}
          >
            {/* Inner button uses a lighter gradient for contrast */}
            <LinearGradient
              colors={['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.1)']}
              style={styles.withdrawButtonGradient}
            >
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
              <Text style={styles.withdrawButtonText}>{t('Withdraw Funds')}</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </GradientCard>
    </Animated.View>
  );
}

function EmptyTransactions() {
  const { t, isRTL, language } = useLanguage();
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <Ionicons name="receipt-outline" size={48} color="#3B82F6" />
      </View>
      <Text style={styles.emptyTitle}>{t('No Transactions Yet')}</Text>
      <Text style={styles.emptySubtitle}>
        {t('Your transaction history will appear here once you start earning.')}
      </Text>
    </View>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function WalletScreen() {
  const { t, isRTL, language } = useLanguage();
  const { wallet, transactions, isLoading, isRefreshing, refetch } = useWallet();

  return (
    <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={[styles.header, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }]}>
          <Text style={styles.headerTitle}>{t('Wallet')}</Text>
          <Pressable onPress={() => router.push('/(inspector)/wallet/statement' as any)} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="receipt-outline" size={16} color="#A78BFA" />
            <Text style={{ color: '#A78BFA', fontSize: 13, fontWeight: '700' }}>{t('Statement')}</Text>
          </Pressable>
        </View>

        <FlatList
          data={transactions}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <>
              <BalanceCard wallet={wallet} isLoading={isLoading} />
              {transactions.length > 0 && (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{t('Recent Transactions')}</Text>
                </View>
              )}
            </>
          }
          ListEmptyComponent={!isLoading ? <EmptyTransactions /> : null}
          renderItem={({ item, index }) => (
            <TransactionItem transaction={item} index={index} />
          )}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={refetch}
              tintColor="#3B82F6"
              colors={['#3B82F6']}
            />
          }
        />
      </SafeAreaView>
    </LinearGradient>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800', // NEXPEC Bold
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 100,
  },
  balanceCard: {
    padding: 24,
    marginBottom: 24,
    // GradientCard handles borderRadius and border
  },
  balanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  balanceLabel: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '500',
  },
  currencyBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  currencyText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  balanceAmount: {
    fontSize: 42,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 24,
    letterSpacing: 1,
  },
  balanceStats: {
    flexDirection: 'row',
    marginBottom: 24,
  },
  balanceStat: { flex: 1 },
  balanceStatDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginHorizontal: 16,
  },
  balanceStatLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginBottom: 4,
  },
  balanceStatValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  balanceActions: { flexDirection: 'row' },
  withdrawButton: { flex: 1 },
  withdrawButtonGradient: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  withdrawButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  sectionHeader: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 95, 0.4)', // Slightly clearer background
    padding: 16,
    borderRadius: 16, // Softer corners
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.1)',
  },
  transactionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  transactionDetails: { flex: 1 },
  transactionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
    textTransform: 'capitalize',
  },
  transactionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  transactionDate: {
    fontSize: 12,
    color: '#94A3B8',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyIconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
  },
});
