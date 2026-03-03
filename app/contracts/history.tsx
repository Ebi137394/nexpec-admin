import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';

export default function ContractHistoryScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      setLoading(true);

      // Fetch contracts based on user role (client or inspector)
      let query = supabase
        .from('contracts')
        .select(`
          *,
          jobs:job_id (title, location),
          clients:client_id (full_name, company_name)
        `)
        .order('created_at', { ascending: false });

      // If we have a specific user ID, filter by that user
      if (userId) {
        query = query.or(`client_id.eq.${userId},inspector_id.eq.${userId}`);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      setContracts(data || []);
    } catch (error: any) {
      console.error('Error fetching contracts:', error);
      Alert.alert('Error', 'Failed to load contract history');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'signed': return '#10B981';
      case 'pending': return '#F59E0B';
      case 'rejected': return '#EF4444';
      default: return '#9CA3AF';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'signed': return 'Signed';
      case 'pending': return 'Pending';
      case 'rejected': return 'Rejected';
      default: return 'Unknown';
    }
  };

  const renderContractItem = ({ item }: { item: any }) => {
    const clientName = item.clients?.company_name || item.clients?.full_name || 'Unknown Client';
    const jobTitle = item.jobs?.title || 'Untitled Job';
    const location = item.jobs?.location || '';

    return (
      <TouchableOpacity 
        style={styles.card}
        onPress={() => {
          if (item.pdf_url) {
            // Navigate to full-screen PDF viewer
            router.push({
              pathname: '/contracts/view',
              params: { 
                uri: item.pdf_url,
                contractNumber: jobTitle
              }
            });
          } else {
            // Navigate to contract details
            router.push(`/contracts/${item.id}`);
          }
        }}
      >
        <View style={styles.leftSection}>
          <View style={styles.headerRow}>
            <Text style={styles.contractNum}>{jobTitle}</Text>
            <View style={[styles.statusBadge, { borderColor: getStatusColor(item.status) }]}>
              <Text style={[styles.statusText, { color: getStatusColor(item.status) }]}>
                {getStatusText(item.status)}
              </Text>
            </View>
          </View>
          <Text style={styles.clientName}>{clientName}</Text>
          {location && <Text style={styles.location}>{location}</Text>}
          <Text style={styles.date}>
            {new Date(item.created_at).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            })}
          </Text>
        </View>
        
        <View style={styles.rightSection}>
          <Text style={styles.amount}>
            ${item.total_amount?.toLocaleString() || '0'}
          </Text>
          <Text style={styles.amountLabel}>Total Amount</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyComponent = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="document-text-outline" size={64} color="#9CA3AF" />
      <Text style={styles.emptyTitle}>No Contracts Found</Text>
      <Text style={styles.emptyText}>
        You don't have any contracts yet. Contracts will appear here once they are created.
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Contract History</Text>
        <View style={{width: 40}} />
      </View>

      {/* Stats */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{contracts.length}</Text>
          <Text style={styles.statLabel}>Total Contracts</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#10B981' }]}>
            {contracts.filter(c => c.status === 'signed').length}
          </Text>
          <Text style={styles.statLabel}>Signed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statNumber, { color: '#F59E0B' }]}>
            {contracts.filter(c => c.status === 'pending').length}
          </Text>
          <Text style={styles.statLabel}>Pending</Text>
        </View>
      </View>

      {/* Contract List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading contracts...</Text>
        </View>
      ) : (
        <FlatList
          data={contracts}
          keyExtractor={(item) => item.id.toString()}
          renderItem={renderContractItem}
          ListEmptyComponent={renderEmptyComponent}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#020420' 
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    padding: 20, 
    backgroundColor: '#020420',
    borderBottomWidth: 1,
    borderBottomColor: '#1C6BB1'
  },
  backBtn: {
    padding: 8,
    backgroundColor: '#1C6BB1',
    borderRadius: 8,
  },
  headerTitle: { 
    color: '#FFF', 
    fontWeight: 'bold',
    fontSize: 18,
    flex: 1,
    textAlign: 'center'
  },
  statsContainer: {
    flexDirection: 'row',
    padding: 20,
    gap: 15,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  statNumber: {
    color: '#FFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  statLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  listContainer: {
    padding: 20,
  },
  card: { 
    backgroundColor: '#1e293b', 
    padding: 20, 
    borderRadius: 12, 
    marginBottom: 15,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  leftSection: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  contractNum: { 
    color: '#FFF', 
    fontWeight: 'bold', 
    fontSize: 16,
    flex: 1,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  clientName: { 
    color: '#CBD5E1', 
    fontSize: 14,
    marginBottom: 4,
  },
  location: {
    color: '#9CA3AF',
    fontSize: 12,
    marginBottom: 8,
  },
  date: { 
    color: '#9CA3AF', 
    fontSize: 12 
  },
  rightSection: {
    alignItems: 'flex-end',
    marginLeft: 15,
  },
  amount: { 
    color: '#00CFD5', 
    fontWeight: 'bold',
    fontSize: 18,
  },
  amountLabel: {
    color: '#9CA3AF',
    fontSize: 10,
    marginTop: 4,
    textTransform: 'uppercase',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    color: '#9CA3AF',
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#9CA3AF',
    fontSize: 16,
  },
});