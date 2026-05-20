// app/client/finance/index.tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  RefreshControl,
  SafeAreaView,
  StatusBar,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInLeft,
  FadeInRight,
} from 'react-native-reanimated';
import { useTheme } from '@/providers/ThemeProvider';
import { getColors } from '@/src/constants/theme';
import { useLanguage } from '@/src/i18n/LanguageProvider';

interface FinanceSummary {
  totalBudget: number;
  spentBudget: number;
  remainingBudget: number;
  pendingInvoices: number;
  approvedInvoices: number;
  complianceIssues: number;
}

export default function FinanceHubScreen() {
  const { isDarkMode } = useTheme();
  const colors = getColors(isDarkMode);
  const { t, isRTL } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<FinanceSummary>({
    totalBudget: 0,
    spentBudget: 0,
    remainingBudget: 0,
    pendingInvoices: 0,
    approvedInvoices: 0,
    complianceIssues: 0,
  });

  const fetchSummary = async () => {
    try {
      setLoading(true);
      // Mock data for now - would integrate with actual finance service
      setSummary({
        totalBudget: 50000,
        spentBudget: 28500,
        remainingBudget: 21500,
        pendingInvoices: 3,
        approvedInvoices: 12,
        complianceIssues: 1,
      });
    } catch (error) {
      console.error('Error fetching finance summary:', error);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchSummary();
  }, []);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await fetchSummary();
    setRefreshing(false);
  }, []);

  const getBudgetPercentage = () => {
    return (summary.spentBudget / summary.totalBudget) * 100;
  };

  const renderFinanceCard = ({ item }: { item: any }) => (
    <Animated.View
      entering={FadeInLeft}
      style={[
        styles.financeCard,
        { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }
      ]}
    >
      <View style={styles.financeHeader}>
        <View style={styles.financeIconContainer}>
          <Ionicons name={item.icon} size={24} color={item.color} />
        </View>
        <View style={styles.financeInfo}>
          <Text style={[styles.financeLabel, { color: colors.textSecondary }]}>{item.label}</Text>
          <Text style={[styles.financeValue, { color: colors.text }]}>{item.value}</Text>
        </View>
      </View>
      
      {item.subLabel && (
        <Text style={[styles.financeSubLabel, { color: colors.textMuted }]}>{item.subLabel}</Text>
      )}
    </Animated.View>
  );

  const financeCards = [
    {
      id: '1',
      icon: 'cash-outline',
      color: '#10B981',
      label: t('Total Budget'),
      value: `SAR ${summary.totalBudget.toLocaleString()}`,
      subLabel: t('Overall project budget')
    },
    {
      id: '2',
      icon: 'trending-down-outline',
      color: '#EF4444',
      label: t('Spent Budget'),
      value: `SAR ${summary.spentBudget.toLocaleString()}`,
      subLabel: `${getBudgetPercentage().toFixed(1)}% used`
    },
    {
      id: '3',
      icon: 'trending-up-outline',
      color: '#3B82F6',
      label: t('Remaining Budget'),
      value: `SAR ${summary.remainingBudget.toLocaleString()}`,
      subLabel: t('Available funds')
    },
    {
      id: '4',
      icon: 'document-text-outline',
      color: '#F59E0B',
      label: t('Pending Invoices'),
      value: summary.pendingInvoices.toString(),
      subLabel: t('Awaiting approval')
    },
    {
      id: '5',
      icon: 'checkmark-circle-outline',
      color: '#10B981',
      label: t('Approved Invoices'),
      value: summary.approvedInvoices.toString(),
      subLabel: t('Processed payments')
    },
    {
      id: '6',
      icon: 'alert-circle-outline',
      color: '#EF4444',
      label: t('Compliance Issues'),
      value: summary.complianceIssues.toString(),
      subLabel: t('Require attention')
    },
  ];

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDarkMode ? "light-content" : "dark-content"} />
      
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#3B82F6"
          />
        }
      >
        {/* Header Section */}
        <Animated.View entering={FadeInDown} style={styles.header}>
          <LinearGradient
            colors={['rgba(59, 130, 246, 0.15)', 'transparent']}
            style={styles.headerGradient}
          />
          
          <Text style={[styles.welcomeText, { color: colors.text }]}>
            {t('Financial Hub')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            {t('Manage your project finances and compliance')}
          </Text>
        </Animated.View>

        {/* Budget Progress */}
        <Animated.View
          entering={FadeInDown.delay(100)}
          style={styles.section}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Budget Overview')}</Text>
          
          <View style={[styles.budgetCard, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
            <View style={styles.budgetHeader}>
              <Text style={[styles.budgetTitle, { color: colors.text }]}>
                {t('Budget Utilization')}
              </Text>
              <Text style={[styles.budgetPercentage, { color: colors.primary }]}>
                {getBudgetPercentage().toFixed(1)}%
              </Text>
            </View>
            
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill,
                  { 
                    width: `${getBudgetPercentage()}%`,
                    backgroundColor: getBudgetPercentage() > 80 ? '#EF4444' : '#3B82F6'
                  }
                ]} 
              />
            </View>
            
            <View style={styles.budgetDetails}>
              <View style={styles.budgetDetail}>
                <Text style={[styles.budgetDetailLabel, { color: colors.textSecondary }]}>{t('Spent')}</Text>
                <Text style={[styles.budgetDetailValue, { color: colors.text }]}>
                  SAR {summary.spentBudget.toLocaleString()}
                </Text>
              </View>
              <View style={styles.budgetDetail}>
                <Text style={[styles.budgetDetailLabel, { color: colors.textSecondary }]}>{t('Remaining')}</Text>
                <Text style={[styles.budgetDetailValue, { color: colors.text }]}>
                  SAR {summary.remainingBudget.toLocaleString()}
                </Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* Finance Cards */}
        <Animated.View
          entering={FadeInDown.delay(200)}
          style={styles.section}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Financial Summary')}</Text>
          <FlatList
            data={financeCards}
            renderItem={renderFinanceCard}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.cardRow}
            showsVerticalScrollIndicator={false}
          />
        </Animated.View>

        {/* Quick Actions */}
        <Animated.View
          entering={FadeInDown.delay(300)}
          style={styles.section}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Quick Actions')}</Text>
          <View style={[styles.quickActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            {/*
              Budget Overview is LIVE as of the M1 Financial Suite (Round 1).
              Invoice Approver + Compliance Vault still scaffolded — kept
              behind the "Coming soon" alert until their rounds ship.
            */}
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
              onPress={() => router.push('/(client)/finance/budget' as any)}
            >
              <View style={[styles.actionIcon, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                <Ionicons name="cash-outline" size={24} color="#10B981" />
              </View>
              <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>{t('Budget Overview')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)', opacity: 0.55 }]}
              onPress={() => Alert.alert(t('Coming soon'), t('Invoice Approver ships in a future release.'))}
            >
              <View style={[styles.actionIcon, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
                <Ionicons name="document-text-outline" size={24} color="#3B82F6" />
              </View>
              <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>{t('Invoice Approver')}</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.quickActions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)', opacity: 0.55 }]}
              onPress={() => Alert.alert(t('Coming soon'), t('Compliance Vault ships in a future release.'))}
            >
              <View style={[styles.actionIcon, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
                <Ionicons name="shield-checkmark-outline" size={24} color="#F59E0B" />
              </View>
              <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>{t('Compliance Vault')}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}
              onPress={() => router.push('/contracts')}
            >
              <View style={[styles.actionIcon, { backgroundColor: 'rgba(139, 92, 246, 0.2)' }]}>
                <Ionicons name="contract-outline" size={24} color="#8B5CF6" />
              </View>
              <Text style={[styles.actionLabel, { color: colors.textSecondary }]}>{t('View Contracts')}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>

        {/* Recent Activity */}
        <Animated.View
          entering={FadeInDown.delay(400)}
          style={styles.section}
        >
          <Text style={[styles.sectionTitle, { color: colors.textSecondary, textAlign: isRTL ? 'right' : 'left' }]}>{t('Recent Activity')}</Text>
          
          <View style={[styles.activityList, { backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.03)', borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)' }]}>
            <View style={[styles.activityItem, { borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' }]}>
              <View style={[styles.activityIcon, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                <Ionicons name="checkmark-circle-outline" size={20} color="#10B981" />
              </View>
              <View style={styles.activityContent}>
                <Text style={[styles.activityTitle, { color: colors.text }]}>
                  Invoice #INV-2024-001 approved
                </Text>
                <Text style={[styles.activitySubtitle, { color: colors.textSecondary }]}>
                  SAR 2,500.00 - Project Alpha
                </Text>
              </View>
              <Text style={[styles.activityTime, { color: colors.textMuted }]}>2h ago</Text>
            </View>
            
            <View style={[styles.activityItem, { borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' }]}>
              <View style={[styles.activityIcon, { backgroundColor: 'rgba(245, 158, 11, 0.2)' }]}>
                <Ionicons name="alert-circle-outline" size={20} color="#F59E0B" />
              </View>
              <View style={styles.activityContent}>
                <Text style={[styles.activityTitle, { color: colors.text }]}>
                  Compliance check required
                </Text>
                <Text style={[styles.activitySubtitle, { color: colors.textSecondary }]}>
                  Safety documentation review
                </Text>
              </View>
              <Text style={[styles.activityTime, { color: colors.textMuted }]}>1d ago</Text>
            </View>
            
            <View style={styles.activityItem}>
              <View style={[styles.activityIcon, { backgroundColor: 'rgba(59, 130, 246, 0.2)' }]}>
                <Ionicons name="trending-up-outline" size={20} color="#3B82F6" />
              </View>
              <View style={styles.activityContent}>
                <Text style={[styles.activityTitle, { color: colors.text }]}>
                  Budget utilization at 57%
                </Text>
                <Text style={[styles.activitySubtitle, { color: colors.textSecondary }]}>
                  Monitor spending trends
                </Text>
              </View>
              <Text style={[styles.activityTime, { color: colors.textMuted }]}>3d ago</Text>
            </View>
          </View>
        </Animated.View>

        {/* App Version */}
        <Animated.View
          entering={FadeIn.delay(500)}
          style={styles.versionContainer}
        >
          <Text style={styles.versionText}>{t('NEXPEC v1.0.0')}</Text>
          <Text style={styles.versionSubtext}>{t('Property Inspection Management')}</Text>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020420',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#020420',
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 30,
    paddingHorizontal: 20,
    position: 'relative',
  },
  headerGradient: {
    ...StyleSheet.absoluteFillObject,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
  },
  section: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  budgetCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  budgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  budgetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  budgetPercentage: {
    fontSize: 18,
    fontWeight: '800',
  },
  progressBar: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    marginBottom: 12,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  budgetDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  budgetDetail: {
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 8,
  },
  budgetDetailLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  budgetDetailValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  cardRow: {
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  financeCard: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 6,
  },
  financeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  financeIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  financeInfo: {
    flex: 1,
  },
  financeLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 2,
  },
  financeValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  financeSubLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginHorizontal: 6,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  actionLabel: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  activityList: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  activityIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activityContent: {
    flex: 1,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
    marginBottom: 2,
  },
  activitySubtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  activityTime: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  versionContainer: {
    alignItems: 'center',
    paddingVertical: 30,
  },
  versionText: {
    fontSize: 14,
    color: '#4B5563',
  },
  versionSubtext: {
    fontSize: 12,
    color: '#374151',
    marginTop: 4,
  },
});