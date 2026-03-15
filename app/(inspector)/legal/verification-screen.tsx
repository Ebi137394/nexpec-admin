import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  RefreshControl,
  StyleSheet,
  TextInput,
  Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  adminService,
  ContractorWithCertificates,
  VerificationStatus,
} from '../../../lib/adminService';

export const VerificationScreen: React.FC = () => {
  const [contractors, setContractors] = useState<ContractorWithCertificates[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedContractor, setSelectedContractor] = useState<ContractorWithCertificates | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [processing, setProcessing] = useState(false);

  const fetchPendingVerifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminService.getPendingVerifications();
      setContractors(data);
    } catch (error) {
      console.error('Error fetching verifications:', error);
      Alert.alert('Error', 'Failed to load pending verifications');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchPendingVerifications();
    }, [fetchPendingVerifications])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchPendingVerifications();
    setRefreshing(false);
  };

  const handleVerify = async (contractor: ContractorWithCertificates) => {
    const validCerts = contractor.certificates.filter(
      (c) => c.is_verified && new Date(c.expiry_date) > new Date()
    );

    if (validCerts.length === 0) {
      Alert.alert(
        'Cannot Verify',
        'This contractor has no valid, verified certificates. Please verify their certificates first.',
        [{ text: 'OK' }]
      );
      return;
    }

    Alert.alert(
      'Confirm Verification',
      `Are you sure you want to verify ${contractor.full_name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Verify',
          style: 'default',
          onPress: () => processVerification(contractor.id, 'verified'),
        },
      ]
    );
  };

  const handleReject = (contractor: ContractorWithCertificates) => {
    setSelectedContractor(contractor);
    setRejectionReason('');
    setShowRejectModal(true);
  };

  const submitRejection = async () => {
    if (!selectedContractor) return;

    if (!rejectionReason.trim()) {
      Alert.alert('Error', 'Please provide a reason for rejection');
      return;
    }

    setShowRejectModal(false);
    await processVerification(selectedContractor.id, 'rejected', rejectionReason);
    setSelectedContractor(null);
    setRejectionReason('');
  };

  const processVerification = async (
    contractorId: string,
    status: VerificationStatus,
    reason?: string
  ) => {
    setProcessing(true);
    try {
      const result = await adminService.verifyContractor({
        contractorId,
        newStatus: status,
        rejectionReason: reason,
      });

      if (result.success) {
        Alert.alert(
          'Success',
          `Contractor has been ${status}. ${
            result.data?.notification.sent
              ? 'Notification sent.'
              : 'Notification not sent.'
          }`
        );
        fetchPendingVerifications();
      } else {
        Alert.alert('Error', result.error || 'Failed to update verification status');
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setProcessing(false);
    }
  };

  const renderCertificate = (cert: ContractorWithCertificates['certificates'][0]) => {
    const isExpired = new Date(cert.expiry_date) < new Date();
    
    return (
      <View style={styles.certificate} key={cert.id}>
        <Text style={styles.certName}>{cert.certificate_name}</Text>
        <View style={styles.certMeta}>
          <Text style={[styles.certExpiry, isExpired && styles.expired]}>
            Expires: {new Date(cert.expiry_date).toLocaleDateString()}
          </Text>
          <View
            style={[
              styles.verifiedBadge,
              cert.is_verified ? styles.verified : styles.unverified,
            ]}
          >
            <Text style={styles.badgeText}>
              {cert.is_verified ? '✓ Verified' : 'Unverified'}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  const renderContractor = ({ item }: { item: ContractorWithCertificates }) => {
    const validCertsCount = item.certificates.filter(
      (c) => c.is_verified && new Date(c.expiry_date) > new Date()
    ).length;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.name}>{item.full_name}</Text>
          <Text style={styles.email}>{item.email}</Text>
          <Text style={styles.date}>
            Applied: {new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>

        <View style={styles.certificatesSection}>
          <Text style={styles.sectionTitle}>
            Certificates ({validCertsCount} valid)
          </Text>
          {item.certificates.length > 0 ? (
            item.certificates.map(renderCertificate)
          ) : (
            <Text style={styles.noCerts}>No certificates uploaded</Text>
          )}
        </View>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.rejectButton]}
            onPress={() => handleReject(item)}
            disabled={processing}
          >
            <Text style={styles.buttonText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.button,
              styles.verifyButton,
              validCertsCount === 0 && styles.disabledButton,
            ]}
            onPress={() => handleVerify(item)}
            disabled={processing || validCertsCount === 0}
          >
            <Text style={styles.buttonText}>Verify</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pending Verifications</Text>
      
      <FlatList
        data={contractors}
        renderItem={renderContractor}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {loading ? 'Loading...' : 'No pending verifications'}
            </Text>
          </View>
        }
        contentContainerStyle={styles.list}
      />

      <Modal
        visible={showRejectModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowRejectModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Reject Verification</Text>
            <Text style={styles.modalSubtitle}>
              Rejecting: {selectedContractor?.full_name}
            </Text>
            
            <TextInput
              style={styles.reasonInput}
              placeholder="Reason for rejection..."
              value={rejectionReason}
              onChangeText={setRejectionReason}
              multiline
              numberOfLines={4}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.button, styles.cancelButton]}
                onPress={() => setShowRejectModal(false)}
              >
                <Text style={styles.buttonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.button, styles.rejectButton]}
                onPress={submitRejection}
              >
                <Text style={styles.buttonText}>Submit</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    padding: 16,
    backgroundColor: '#fff',
  },
  list: {
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    marginBottom: 12,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
  },
  email: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  date: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  certificatesSection: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 12,
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  certificate: {
    backgroundColor: '#f9f9f9',
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  certName: {
    fontSize: 14,
    fontWeight: '500',
  },
  certMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  certExpiry: {
    fontSize: 12,
    color: '#666',
  },
  expired: {
    color: '#e74c3c',
  },
  verifiedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  verified: {
    backgroundColor: '#27ae60',
  },
  unverified: {
    backgroundColor: '#95a5a6',
  },
  badgeText: {
    fontSize: 10,
    color: '#fff',
    fontWeight: '600',
  },
  noCerts: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 16,
    gap: 12,
  },
  button: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    minWidth: 80,
    alignItems: 'center',
  },
  verifyButton: {
    backgroundColor: '#27ae60',
  },
  rejectButton: {
    backgroundColor: '#e74c3c',
  },
  cancelButton: {
    backgroundColor: '#95a5a6',
  },
  disabledButton: {
    backgroundColor: '#bdc3c7',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    minHeight: 100,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
});