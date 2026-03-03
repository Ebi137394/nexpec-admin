import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/src/i18n/LanguageProvider';

// Types
interface ContractItem {
  id: string;
  job_id: string;
  status: 'pending' | 'signed' | 'completed' | 'cancelled';
  created_at: string;
  jobs: {
    title: string;
    company_name: string;
    location: string;
  };
}

export default function ContractsListScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();

  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user) fetchContracts();
  }, [user]);

  const fetchContracts = async () => {
    try {
      const { data, error } = await supabase
        .from('contracts')
        .select(`
          id,
          job_id,
          status,
          created_at,
          jobs (
            title,
            location,
            client_id
          )
        `)
        .eq('inspector_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Manually fetch company names if they are in the profiles table
      // This is safer than complex joins if your schema is unsure
      const contractsWithCompany = await Promise.all(
        (data || []).map(async (contract: any) => {
          let companyName = 'Unknown Company';

          if (contract.jobs?.client_id) {
            const { data: clientData } = await supabase
              .from('profiles')
              .select('full_name, company_name') // Try both potential fields
              .eq('id', contract.jobs.client_id)
              .single();

            companyName = clientData?.company_name || clientData?.full_name || 'Unknown Company';
          }

          return {
            ...contract,
            jobs: {
              ...contract.jobs,
              company_name: companyName
            }
          };
        })
      );

      setContracts(contractsWithCompany);
    } catch (error) {
      console.error('Error fetching contracts:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'signed': return '#10B981';
      case 'completed': return '#3B82F6';
      case 'cancelled': return '#EF4444';
      default: return '#F59E0B'; // pending
    }
  };

  const renderItem = ({ item }: { item: ContractItem }) => (
    <TouchableOpacity
      style={[styles.card, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
      onPress={() => router.push(`/contracts/${item.job_id}`)}
    >
      <View style={[styles.iconContainer, { backgroundColor: getStatusColor(item.status) + '20' }]}>
        <Ionicons name="document-text" size={24} color={getStatusColor(item.status)} />
      </View>

      <View style={[styles.cardContent, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
        <Text style={styles.cardTitle}>{item.jobs?.title || 'Unknown Job'}</Text>
        <Text style={styles.cardSubtitle}>{item.jobs?.company_name}</Text>
        <Text style={[styles.cardStatus, { color: getStatusColor(item.status) }]}>
          {t(item.status.charAt(0).toUpperCase() + item.status.slice(1) as any)}
        </Text>
      </View>

      <Ionicons
        name={isRTL ? "chevron-back" : "chevron-forward"}
        size={20}
        color="#64748b"
        style={isRTL ? { marginRight: 'auto' } : { marginLeft: 'auto' }}
      />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name={isRTL ? "arrow-forward" : "arrow-back"} size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('Contracts')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#3B82F6" />
        </View>
      ) : (
        <FlatList
          data={contracts}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchContracts(); }} tintColor="#3B82F6" />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="documents-outline" size={64} color="#334155" />
              <Text style={styles.emptyText}>{t('No contracts found')}</Text>
              <Text style={styles.emptySubText}>{t('Contracts will appear here when you accept a job.')}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020420' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#FFF' },
  backButton: { padding: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16 },

  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    marginBottom: 4,
  },
  cardStatus: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFF',
    marginTop: 16,
  },
  emptySubText: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 8,
    textAlign: 'center',
  },
});
