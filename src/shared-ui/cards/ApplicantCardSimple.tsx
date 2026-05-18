import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ApplicationStatus,
  APPLICATION_STATUS_CONFIG,
  canTransitionTo,
  ApplicationWithProfile,
} from '@/types/application';
import { getApplicantName, getApplicantInitials } from '@/types/application';
import { showAlert } from '@/lib/alert';

interface ApplicantCardSimpleProps {
  application: ApplicationWithProfile;
  onUpdateStatus: (id: string, newStatus: ApplicationStatus) => Promise<void>;
}

export const ApplicantCardSimple: React.FC<ApplicantCardSimpleProps> = ({
  application,
  onUpdateStatus,
}) => {
  const [loading, setLoading] = useState(false);
  const { status } = application;
  const config = APPLICATION_STATUS_CONFIG[status as ApplicationStatus];
  const applicant = application.applicant;

  // Helper to handle status updates safely
  const handleAction = async (newStatus: ApplicationStatus) => {
    // Check if transition is allowed
    if (!canTransitionTo(status, newStatus)) {
      showAlert('Invalid Action', `Cannot transition from ${status} to ${newStatus}`);
      return;
    }

    try {
      setLoading(true);
      await onUpdateStatus(application.id, newStatus);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update status';
      showAlert('Error', message);
    } finally {
      setLoading(false);
    }
  };

  // 1. RENDER STATUS BADGE
  const renderStatusBadge = () => (
    <View style={[styles.badge, { backgroundColor: config.bgColor }]}>
      <Ionicons
        name={config.icon as any}
        size={14}
        color={config.color}
        style={{ marginRight: 4 }}
      />
      <Text style={[styles.badgeText, { color: config.color }]}>
        {config.label}
      </Text>
    </View>
  );

  // 2. RENDER ACTION BUTTONS (Based on STATUS_TRANSITIONS logic)
  const renderActions = () => {
    if (loading) {
      return (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#3B82F6" />
        </View>
      );
    }

    // Logic: 'pending' -> Show Shortlist & Reject
    if (status === 'pending' && canTransitionTo(status, 'shortlisted')) {
      return (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.button, styles.btnShortlist]}
            onPress={() => handleAction('shortlisted')}
            activeOpacity={0.8}
          >
            <Text style={styles.btnTextWhite}>Shortlist</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.btnReject]}
            onPress={() => handleAction('rejected')}
            activeOpacity={0.8}
          >
            <Text style={styles.btnTextWhite}>Reject</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Logic: 'shortlisted' -> Show Offer & Reject
    if (status === 'shortlisted' && canTransitionTo(status, 'offered')) {
      return (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.button, styles.btnOffer]}
            onPress={() => handleAction('offered')}
            activeOpacity={0.8}
          >
            <Ionicons name="paper-plane" size={16} color="white" style={{ marginRight: 6 }} />
            <Text style={styles.btnTextWhite}>Send Offer</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.btnReject]}
            onPress={() => handleAction('rejected')}
            activeOpacity={0.8}
          >
            <Text style={styles.btnTextWhite}>Reject</Text>
          </TouchableOpacity>
        </View>
      );
    }

    // Logic: 'offered' -> Show Waiting Label
    if (status === 'offered') {
      return (
        <View style={styles.infoRow}>
          <Text style={styles.infoText}>Waiting for inspector response...</Text>
        </View>
      );
    }

    // Logic: 'hired' -> Show Success Message
    if (status === 'hired') {
      return (
        <View style={styles.infoRow}>
          <Ionicons name="checkmark-circle" size={16} color="#22C55E" style={{ marginRight: 6 }} />
          <Text style={[styles.infoText, { color: '#22C55E' }]}>Inspector Hired</Text>
        </View>
      );
    }

    // Terminal states (Rejected/Withdrawn) show nothing or a message
    if (status === 'rejected' || status === 'withdrawn') {
      return (
        <View style={styles.infoRow}>
          <Text style={[styles.infoText, { color: '#EF4444' }]}>
            {status === 'rejected' ? 'Application Rejected' : 'Application Withdrawn'}
          </Text>
        </View>
      );
    }

    return null;
  };

  return (
    <View style={styles.card}>
      {/* Header: Avatar & Info */}
      <View style={styles.header}>
        {applicant.avatar_url ? (
          <Image source={{ uri: applicant.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{getApplicantInitials(applicant)}</Text>
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.name}>{getApplicantName(applicant)}</Text>
          <Text style={styles.date}>
            Applied: {new Date(application.created_at).toLocaleDateString()}
          </Text>
          {renderStatusBadge()}
        </View>
      </View>

      {/* Footer: Action Buttons */}
      <View style={styles.footer}>
        {renderActions()}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1E293B', // Dark theme
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  header: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#334155',
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#F8FAFC',
  },
  info: {
    marginLeft: 12,
    flex: 1,
    justifyContent: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8FAFC',
    marginBottom: 4,
  },
  date: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  footer: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btnShortlist: {
    backgroundColor: '#A855F7',
  },
  btnOffer: {
    backgroundColor: '#3B82F6',
  },
  btnReject: {
    backgroundColor: '#EF4444',
  },
  btnTextWhite: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  infoText: {
    color: '#64748B',
    fontStyle: 'italic',
    fontSize: 13,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
});

