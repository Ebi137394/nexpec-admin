import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { CheckCircle, XCircle, MessageCircle, Lock, AlertTriangle } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert, showConfirm } from '@/lib/alert';

// ============================================================================
// TYPES
// ============================================================================

interface ActionButtonsProps {
  status: string;
  applicationId: string;
  jobId: string;
  jobTitle: string;
  jobPrice: number;
  isUpdating: boolean;
  onAcceptSuccess: () => void;
  onDecline: () => void;
  onWithdraw: () => void;
  onMessage: () => void;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount);
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const ActionButtons: React.FC<ActionButtonsProps> = ({
  status,
  applicationId,
  jobId,
  jobTitle,
  jobPrice,
  isUpdating,
  onAcceptSuccess,
  onDecline,
  onWithdraw,
  onMessage,
}) => {
  const [isAccepting, setIsAccepting] = useState(false);

  const handleAccept = async () => {
    showConfirm(
      'Accept Offer',
      `Accept this job for ${formatCurrency(jobPrice)}?\n\nThe payment will be held for payout until the job is completed.`,
      async () => {
        setIsAccepting(true);
        
        try {
          // این عملیات تریگر trigger_job_acceptance را در دیتابیس فعال می‌کند
          const { error } = await supabase
            .from('applications')
            .update({ status: 'accepted' })
            .eq('id', applicationId);

          if (error) {
            // بررسی خطای کمبود موجودی کارفرما که توسط تریگر SQL صادر می‌شود
            if (error.message?.includes('INSUFFICIENT_BALANCE')) {
              showAlert(
                'Payment Not Secured',
                'The client does not have enough balance to cover the payment hold. Please contact the client to top up their wallet.'
              );
            } else {
              throw error;
            }
            return;
          }

          // موفقیت در قفل شدن پول در Payment hold
          showAlert(
            '🎉 Congratulations!',
            'Offer accepted. The payment is now securely held for payout and will be released upon completion.',
            () => onAcceptSuccess()
          );
        } catch (error) {
          console.error('Accept error:', error);
          showAlert('Error', 'Failed to accept offer. Please try again.');
        } finally {
          setIsAccepting(false);
        }
      }
    );
  };

  // حالت لودینگ در زمان پردازش تراکنش مالی
  if (isUpdating || isAccepting) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text style={styles.loadingText}>
          {isAccepting ? 'Processing Payout...' : 'Updating...'}
        </Text>
      </View>
    );
  }

  // مدیریت دکمه‌ها بر اساس وضعیت پروژه
  switch (status) {
    case 'offered':
      return (
        <View style={styles.actionRow}>
          <View style={styles.escrowBanner}>
            <Lock size={14} color="#3B82F6" />
            <Text style={styles.escrowBannerText}>
              Payment will be secured for payout
            </Text>
          </View>
          
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.acceptButton]}
              onPress={() => {
                // Navigate to job details instead of accepting directly
                // This should be handled by the parent component passing the correct navigation
                console.log('Navigate to job details for:', jobId);
              }}
              activeOpacity={0.8}
            >
              <CheckCircle size={20} color="#FFFFFF" />
              <Text style={styles.acceptButtonText}>View Details</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.actionButton, styles.declineButton]}
              onPress={onDecline}
              activeOpacity={0.8}
            >
              <XCircle size={20} color="#EF4444" />
              <Text style={styles.declineButtonText}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      );

    case 'accepted':
    case 'in_progress':
      return (
        <View style={styles.actionRow}>
          <View style={[styles.escrowBanner, styles.escrowLockedBanner]}>
            <Lock size={14} color="#22C55E" />
            <Text style={[styles.escrowBannerText, styles.escrowLockedText]}>
              {formatCurrency(jobPrice)} Secured for Payout
            </Text>
          </View>
          
          <TouchableOpacity
            style={[styles.actionButton, styles.messageButton]}
            onPress={onMessage}
            activeOpacity={0.8}
          >
            <MessageCircle size={20} color="#FFFFFF" />
            <Text style={styles.messageButtonText}>Chat with Client</Text>
          </TouchableOpacity>
        </View>
      );

    case 'pending':
    case 'shortlisted':
      return (
        <TouchableOpacity
          style={[styles.actionButton, styles.withdrawButton]}
          onPress={onWithdraw}
          activeOpacity={0.8}
        >
          <XCircle size={18} color="#64748B" />
          <Text style={styles.withdrawButtonText}>Withdraw Application</Text>
        </TouchableOpacity>
      );

    default:
      return null;
  }
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748B',
    fontWeight: '500',
  },
  actionRow: {
    gap: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  acceptButton: {
    backgroundColor: '#22C55E',
  },
  acceptButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  declineButton: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  declineButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },
  messageButton: {
    backgroundColor: '#3B82F6',
  },
  messageButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  withdrawButton: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
  },
  withdrawButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  escrowBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
  },
  escrowBannerText: {
    fontSize: 13,
    color: '#3B82F6',
    fontWeight: '600',
  },
  escrowLockedBanner: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#DCFCE7',
  },
  escrowLockedText: {
    color: '#166534',
  },
});

export default ActionButtons;

