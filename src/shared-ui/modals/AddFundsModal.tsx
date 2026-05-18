import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, CreditCard, Plus } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { showAlert } from '@/lib/alert';

interface AddFundsModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  minimumAmount?: number;
}

export const AddFundsModal: React.FC<AddFundsModalProps> = ({
  visible,
  onClose,
  onSuccess,
  minimumAmount = 0,
}) => {
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAddFunds = async () => {
    const numAmount = parseFloat(amount);
    
    if (isNaN(numAmount) || numAmount < 10) {
      showAlert('Error', 'Minimum deposit is $10.00');
      return;
    }

    setIsProcessing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      // ۱. دریافت اطلاعات کیف پول (که قبلاً توسط Trigger ساخته شده است)
      const { data: wallet, error: walletError } = await supabase
        .from('wallets')
        .select('id, balance')
        .eq('user_id', user.id)
        .single();

      if (walletError || !wallet) {
        throw new Error('Wallet not found. Please contact support.');
      }

      // ۲. آپدیت موجودی (در دنیای واقعی این کار باید در سمت سرور/Edge Function انجام شود)
      const { error: updateError } = await supabase
        .from('wallets')
        .update({ 
          balance: (wallet.balance || 0) + numAmount
        })
        .eq('id', wallet.id);

      if (updateError) throw updateError;

      // ۳. ثبت تاریخچه تراکنش
      const { error: transactionError } = await supabase.from('transactions').insert({
        wallet_id: wallet.id,
        amount: numAmount,
        type: 'deposit',
        status: 'completed',
        description: 'Funds added via mobile app',
      });

      if (transactionError) {
        console.error('Transaction insert error:', transactionError);
        // Don't throw - the balance was updated, transaction is just a log
      }

      showAlert(
        'Success!',
        `${numAmount.toFixed(2)} USD has been added to your wallet.`,
        () => {
          setAmount('');
          onClose();
          onSuccess();
        }
      );

    } catch (error: any) {
      console.error('Deposit error:', error);
      showAlert('Deposit Failed', error.message || 'Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const quickAmounts = [50, 100, 250, 500];

  const handleAmountChange = (text: string) => {
    // Only allow numbers and one decimal point
    const cleaned = text.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    if (parts[1]?.length > 2) return;
    setAmount(cleaned);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity 
            onPress={onClose} 
            style={styles.closeButton}
            disabled={isProcessing}
          >
            <X size={24} color={isProcessing ? '#CBD5E1' : '#0F172A'} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Top Up Wallet</Text>
          <View style={styles.headerPlaceholder} />
        </View>

        <View style={styles.content}>
          {minimumAmount > 0 && (
            <View style={styles.minimumBanner}>
              <Text style={styles.minimumText}>
                You need at least ${minimumAmount.toFixed(2)} for this hire
              </Text>
            </View>
          )}

          <View style={styles.inputSection}>
            <Text style={styles.inputLabel}>Enter Amount</Text>
            <View style={styles.amountInput}>
              <Text style={styles.currencySymbol}>$</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                placeholderTextColor="#CBD5E1"
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={handleAmountChange}
                editable={!isProcessing}
                autoFocus
              />
            </View>
          </View>

          <View style={styles.quickAmounts}>
            {quickAmounts.map((value) => (
              <TouchableOpacity
                key={value}
                style={[
                  styles.quickAmountButton,
                  parseFloat(amount) === value && styles.quickAmountActive,
                ]}
                onPress={() => setAmount(value.toString())}
                disabled={isProcessing}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.quickAmountText,
                  parseFloat(amount) === value && styles.quickAmountTextActive,
                ]}>
                  ${value}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.paymentMethod}>
            <CreditCard size={24} color="#3B82F6" />
            <View style={styles.paymentInfo}>
              <Text style={styles.paymentLabel}>Saved Card</Text>
              <Text style={styles.paymentValue}>•••• 4242 (Demo)</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.addButton,
              (isProcessing || !amount || parseFloat(amount) < 10) && styles.addButtonDisabled,
            ]}
            onPress={handleAddFunds}
            disabled={isProcessing || !amount || parseFloat(amount) < 10}
            activeOpacity={0.8}
          >
            {isProcessing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Plus size={20} color="#FFFFFF" />
                <Text style={styles.addButtonText}>
                  Deposit ${parseFloat(amount || '0').toFixed(2)}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerPlaceholder: {
    width: 40,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  minimumBanner: {
    backgroundColor: '#FEF3C7',
    padding: 14,
    borderRadius: 12,
    marginBottom: 24,
  },
  minimumText: {
    fontSize: 14,
    color: '#92400E',
    textAlign: 'center',
    fontWeight: '600',
  },
  inputSection: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    marginBottom: 12,
  },
  amountInput: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 2,
    borderColor: '#3B82F6',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: '700',
    color: '#0F172A',
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 32,
    fontWeight: '700',
    color: '#0F172A',
    padding: 0,
  },
  quickAmounts: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 32,
  },
  quickAmountButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  quickAmountActive: {
    backgroundColor: '#3B82F6',
  },
  quickAmountText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#64748B',
  },
  quickAmountTextActive: {
    color: '#FFFFFF',
  },
  paymentMethod: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    padding: 16,
    borderRadius: 16,
    gap: 14,
  },
  paymentInfo: {
    flex: 1,
  },
  paymentLabel: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 2,
  },
  paymentValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F172A',
  },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 30 : 20,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22C55E',
    paddingVertical: 18,
    borderRadius: 16,
    gap: 10,
  },
  addButtonDisabled: {
    backgroundColor: '#CBD5E1',
  },
  addButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});

export default AddFundsModal;

