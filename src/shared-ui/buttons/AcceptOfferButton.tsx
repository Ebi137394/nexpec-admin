import React, { useState } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  View,
  Modal,
} from 'react-native';
import { CheckCircle, AlertTriangle, CreditCard, X } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert, showConfirm } from '@/lib/alert';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface AcceptOfferButtonProps {
  applicationId: string;
  jobId: string;
  jobTitle: string;
  jobPrice: number;
  onSuccess?: () => void;
  onError?: (error: string) => void;
}

interface EscrowError {
  type: 'INSUFFICIENT_BALANCE' | 'ALREADY_ACCEPTED' | 'JOB_NOT_FOUND' | 'UNKNOWN';
  message: string;
  details?: {
    required?: number;
    available?: number;
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
};

const parseEscrowError = (error: any): EscrowError => {
  const message = error?.message || error?.toString() || 'Unknown error';
  
  // تطبیق دقیق با پیام خطای تعریف شده در تریگر SQL
  if (message.includes('INSUFFICIENT_BALANCE')) {
    const match = message.match(/Required: ([\d.]+), Available: ([\d.]+)/);
    return {
      type: 'INSUFFICIENT_BALANCE',
      message: 'Client balance is lower than the job price.',
      details: match ? {
        required: parseFloat(match[1]),
        available: parseFloat(match[2]),
      } : undefined,
    };
  }
  
  if (message.includes('already locked') || message.includes('already accepted')) {
    return {
      type: 'ALREADY_ACCEPTED',
      message: 'This job has already been assigned or locked.',
    };
  }
  
  return {
    type: 'UNKNOWN',
    message: error?.details || 'An unexpected error occurred during payment setup.',
  };
};

// ============================================================================
// MODAL: INSUFFICIENT FUNDS
// ============================================================================

const InsufficientFundsModal: React.FC<{
  visible: boolean;
  onClose: () => void;
  required: number;
  available: number;
}> = ({ visible, onClose, required, available }) => {
  const shortfall = required - available;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <View style={styles.errorIconContainer}>
              <AlertTriangle size={32} color="#F59E0B" />
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <X size={24} color="#64748B" />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalTitle}>Insufficient Funds</Text>
          <Text style={styles.modalDescription}>
            The client's wallet does not have enough balance to place the payment hold for this job.
          </Text>

          <View style={styles.balanceDetails}>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Required Amount:</Text>
              <Text style={styles.balanceValue}>{formatCurrency(required)}</Text>
            </View>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Current Balance:</Text>
              <Text style={[styles.balanceValue, styles.balanceWarning]}>
                {formatCurrency(available)}
              </Text>
            </View>
            <View style={styles.balanceDivider} />
            <View style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>Shortfall:</Text>
              <Text style={[styles.balanceValue, styles.balanceError]}>
                {formatCurrency(shortfall)}
              </Text>
            </View>
          </View>

          <View style={styles.infoBox}>
            <CreditCard size={18} color="#3B82F6" />
            <Text style={styles.infoText}>
              Please inform the client to top up their wallet to proceed with hiring.
            </Text>
          </View>

          <TouchableOpacity style={styles.modalButton} onPress={onClose}>
            <Text style={styles.modalButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const AcceptOfferButton: React.FC<AcceptOfferButtonProps> = ({
  applicationId,
  jobId,
  jobTitle,
  jobPrice,
  onSuccess,
  onError,
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [showInsufficientFunds, setShowInsufficientFunds] = useState(false);
  const [escrowError, setEscrowError] = useState<EscrowError | null>(null);

  const performAccept = async () => {
    setIsLoading(true);
    setEscrowError(null);

    try {
      // مرحله اول: آپدیت وضعیت اپلیکیشن که تریگر SQL را فعال می‌کند
      const { error: acceptError } = await supabase
        .from('applications')
        .update({ status: 'accepted' })
        .eq('id', applicationId);

      if (acceptError) throw acceptError;

      // مرحله دوم: اعلام موفقیت پس از اجرای موفق تریگر و جابجایی پول
      showAlert(
        '🎉 Success!',
        `You have accepted "${jobTitle}". Payment of ${formatCurrency(jobPrice)} is now held for payout.`,
        () => onSuccess?.()
      );

    } catch (error: any) {
      const parsed = parseEscrowError(error);
      setEscrowError(parsed);

      if (parsed.type === 'INSUFFICIENT_BALANCE') {
        setShowInsufficientFunds(true);
      } else {
        showAlert('Error', parsed.message);
        onError?.(parsed.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePress = () => {
    showConfirm(
      'Confirm Acceptance',
      `Accepting this job will lock ${formatCurrency(jobPrice)} on payment hold. Proceed?`,
      performAccept
    );
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.acceptButton, isLoading && styles.acceptButtonDisabled]}
        onPress={() => {
          // Navigate to job details instead of accepting directly
          console.log('Navigate to job details for:', jobId);
        }}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <>
            <CheckCircle size={22} color="#FFFFFF" />
            <Text style={styles.acceptButtonText}>View Details</Text>
          </>
        )}
      </TouchableOpacity>

      <InsufficientFundsModal
        visible={showInsufficientFunds}
        onClose={() => setShowInsufficientFunds(false)}
        required={escrowError?.details?.required || jobPrice}
        available={escrowError?.details?.available || 0}
      />
    </>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  acceptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22C55E',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  acceptButtonDisabled: {
    backgroundColor: '#86EFAC',
  },
  acceptButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  errorIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButton: {
    padding: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 15,
  },
  modalDescription: {
    fontSize: 15,
    color: '#64748B',
    marginTop: 10,
    marginBottom: 15,
    lineHeight: 20,
  },
  balanceDetails: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 16,
    marginVertical: 15,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  balanceLabel: {
    fontSize: 14,
    color: '#64748B',
  },
  balanceValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0F172A',
  },
  balanceWarning: {
    color: '#F59E0B',
  },
  balanceError: {
    color: '#EF4444',
  },
  balanceDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: 8,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
    padding: 12,
    borderRadius: 10,
    gap: 10,
    marginTop: 10,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: '#1E40AF',
    lineHeight: 18,
  },
  modalButton: {
    backgroundColor: '#3B82F6',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default AcceptOfferButton;

