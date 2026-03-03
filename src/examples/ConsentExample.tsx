// src/examples/ConsentExample.tsx

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ShieldCheck, CheckCircle, AlertTriangle, Clock } from 'lucide-react-native';

import { LegalConsentModal } from '../components/LegalConsent';
import { consentService } from '../services/consentService';
import { ConsentCheckResult } from '../services/consentService';

export const ConsentExample: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [consentStatus, setConsentStatus] = useState<ConsentCheckResult | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [userId] = useState('example-user-id');
  const [documentId] = useState('inspection-report');

  useEffect(() => {
    checkConsentStatus();
  }, []);

  const checkConsentStatus = async () => {
    setIsLoading(true);
    try {
      const result = await consentService.checkConsent(userId, documentId);
      setConsentStatus(result);
    } catch (error) {
      console.error('Error checking consent:', error);
      Alert.alert('Error', 'Failed to check consent status');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConsentComplete = (result: any) => {
    Alert.alert(
      'Consent Completed',
      'Your consent has been successfully recorded and a receipt has been sent to your email.',
      [{ text: 'OK', onPress: checkConsentStatus }]
    );
  };

  const handleShowConsent = () => {
    if (consentStatus?.needsNewConsent) {
      Alert.alert(
        'Consent Expired',
        'Your previous consent has expired. You need to provide new consent to continue.',
        [{ text: 'OK', onPress: () => setShowConsentModal(true) }]
      );
    } else {
      setShowConsentModal(true);
    }
  };

  const handleViewHistory = async () => {
    try {
      const history = await consentService.getConsentHistory(userId);
      if (history.length === 0) {
        Alert.alert('No Consent History', 'You have not provided any consent yet.');
      } else {
        const historyText = history
          .map(
            (consent, index) =>
              `${index + 1}. ${consent.documentId} - ${new Date(
                consent.metadata.timestamp
              ).toLocaleDateString()}`
          )
          .join('\n');
        Alert.alert('Consent History', historyText);
      }
    } catch (error) {
      console.error('Error fetching consent history:', error);
      Alert.alert('Error', 'Failed to fetch consent history');
    }
  };

  const handleRevokeConsent = async () => {
    if (!consentStatus?.latestConsent?.id) {
      Alert.alert('No Consent', 'No active consent to revoke.');
      return;
    }

    Alert.alert(
      'Revoke Consent',
      'Are you sure you want to revoke your consent? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              const success = await consentService.revokeConsent(
                consentStatus.latestConsent!.id!
              );
              if (success) {
                Alert.alert('Success', 'Your consent has been revoked.');
                checkConsentStatus();
              } else {
                Alert.alert('Error', 'Failed to revoke consent.');
              }
            } catch (error) {
              console.error('Error revoking consent:', error);
              Alert.alert('Error', 'Failed to revoke consent.');
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <LinearGradient
          colors={['#020420', '#0F172A']}
          style={styles.gradient}
        >
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#7C3AED" />
            <Text style={styles.loadingText}>Checking consent status...</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#020420', '#0F172A']}
        style={styles.gradient}
      >
        <ScrollView style={styles.scrollContainer} contentContainerStyle={styles.contentContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <ShieldCheck size={32} color="#7C3AED" />
            </View>
            <Text style={styles.headerTitle}>Consent Management</Text>
            <Text style={styles.headerSubtitle}>
              Manage your legal consent and agreements
            </Text>
          </View>

          {/* Status Card */}
          <View style={styles.statusCard}>
            <View style={styles.statusHeader}>
              <Text style={styles.statusTitle}>Current Status</Text>
              {consentStatus && (
                <View style={[
                  styles.statusIndicator,
                  consentStatus.hasConsent && !consentStatus.needsNewConsent
                    ? styles.statusActive
                    : styles.statusInactive
                ]}>
                  <Text style={styles.statusIndicatorText}>
                    {consentStatus.hasConsent && !consentStatus.needsNewConsent
                      ? 'Active'
                      : 'Inactive'}
                  </Text>
                </View>
              )}
            </View>

            {consentStatus ? (
              <View style={styles.statusDetails}>
                {consentStatus.hasConsent && !consentStatus.needsNewConsent ? (
                  <>
                    <View style={styles.statusRow}>
                      <CheckCircle size={20} color="#10B981" />
                      <Text style={styles.statusDetailText}>
                        Valid consent on file
                      </Text>
                    </View>
                    {consentStatus.latestConsent && (
                      <View style={styles.statusRow}>
                        <Clock size={20} color="#64748B" />
                        <Text style={styles.statusDetailText}>
                          Signed: {new Date(consentStatus.latestConsent.metadata.timestamp).toLocaleDateString()}
                        </Text>
                      </View>
                    )}
                  </>
                ) : (
                  <>
                    <View style={styles.statusRow}>
                      <AlertTriangle size={20} color="#F59E0B" />
                      <Text style={styles.statusDetailText}>
                        {consentStatus.needsNewConsent
                          ? 'Consent expired - new consent required'
                          : 'No consent on file'}
                      </Text>
                    </View>
                    <Text style={styles.statusHelpText}>
                      You need to provide consent before accessing certain features.
                    </Text>
                  </>
                )}
              </View>
            ) : (
              <Text style={styles.statusDetailText}>Checking status...</Text>
            )}
          </View>

          {/* Actions */}
          <View style={styles.actionsContainer}>
            <Text style={styles.actionsTitle}>Actions</Text>

            <TouchableOpacity
              style={[
                styles.actionButton,
                (consentStatus?.hasConsent && !consentStatus?.needsNewConsent)
                  ? styles.actionButtonSecondary
                  : styles.actionButtonPrimary
              ]}
              onPress={handleShowConsent}
              disabled={consentStatus?.hasConsent && !consentStatus?.needsNewConsent}
            >
              <ShieldCheck size={20} color="#FFFFFF" />
              <Text style={styles.actionButtonText}>
                {consentStatus?.hasConsent && !consentStatus?.needsNewConsent
                  ? 'Consent Active'
                  : 'Provide Consent'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionButtonSecondary}
              onPress={handleViewHistory}
            >
              <Clock size={20} color="#7C3AED" />
              <Text style={styles.actionButtonTextSecondary}>View History</Text>
            </TouchableOpacity>

            {consentStatus?.hasConsent && (
              <TouchableOpacity
                style={styles.actionButtonDanger}
                onPress={handleRevokeConsent}
              >
                <AlertTriangle size={20} color="#EF4444" />
                <Text style={styles.actionButtonTextDanger}>Revoke Consent</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Information */}
          <View style={styles.infoContainer}>
            <Text style={styles.infoTitle}>About Consent</Text>
            <Text style={styles.infoText}>
              This consent management system ensures compliance with data protection
              regulations and provides you with control over your personal data.
            </Text>
            <Text style={styles.infoText}>
              Your consent is required for:
            </Text>
            <View style={styles.infoList}>
              <Text style={styles.infoListItem}>• Accessing confidential documents</Text>
              <Text style={styles.infoListItem}>• Processing personal data</Text>
              <Text style={styles.infoListItem}>• Electronic signature verification</Text>
              <Text style={styles.infoListItem}>• Audit trail creation</Text>
            </View>
          </View>
        </ScrollView>

        {/* Consent Modal */}
        <LegalConsentModal
          visible={showConsentModal}
          onClose={() => setShowConsentModal(false)}
          onConsentComplete={handleConsentComplete}
          userId={userId}
          documentId={documentId}
          documentTitle="Inspection Report Access"
          policyVersion="2.1.0"
          requireAllConsents={true}
          expirationDays={365}
        />
      </LinearGradient>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  scrollContainer: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: '#CBD5E1',
    fontSize: 16,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 4,
  },
  statusCard: {
    backgroundColor: '#0B1220',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 24,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  statusIndicator: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statusActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusInactive: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  statusIndicatorText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  statusDetails: {
    gap: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusDetailText: {
    color: '#CBD5E1',
    fontSize: 14,
    flex: 1,
  },
  statusHelpText: {
    color: '#64748B',
    fontSize: 12,
    fontStyle: 'italic',
    marginLeft: 30,
  },
  actionsContainer: {
    marginBottom: 24,
  },
  actionsTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#7C3AED',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginBottom: 12,
    shadowColor: '#7C3AED',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  actionButtonPrimary: {
    backgroundColor: '#7C3AED',
  },
  actionButtonSecondary: {
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(124, 58, 237, 0.4)',
  },
  actionButtonDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  actionButtonTextSecondary: {
    color: '#C084FC',
    fontSize: 16,
    fontWeight: '600',
  },
  actionButtonTextDanger: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '600',
  },
  infoContainer: {
    backgroundColor: '#0B1220',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  infoTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  infoText: {
    color: '#CBD5E1',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  infoList: {
    gap: 6,
  },
  infoListItem: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
  },
});

export default ConsentExample;