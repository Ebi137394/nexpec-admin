// src/screens/Wallet/WithdrawalRequestScreen.tsx
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { supabase } from '@/lib/supabase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

type RootStackParamList = {
  WithdrawalRequest: { currentBalance: number };
  Wallet: undefined;
};

type Props = NativeStackScreenProps<RootStackParamList, 'WithdrawalRequest'>;

interface BankInfo {
  bankName: string;
  accountNo: string;
  ownerName: string;
}

export const WithdrawalRequestScreen: React.FC<Props> = ({ route, navigation }) => {
  const { currentBalance } = route.params;
  const [amount, setAmount] = useState<string>('');
  const [bankInfo, setBankInfo] = useState<BankInfo>({
    bankName: '',
    accountNo: '',
    ownerName: ''
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      return Alert.alert("Error", "Please enter a valid amount.");
    }

    if (amountNum > currentBalance) {
      return Alert.alert("Error", "Insufficient balance.");
    }

    if (!bankInfo.bankName || !bankInfo.accountNo || !bankInfo.ownerName) {
      return Alert.alert("Error", "Please fill in all bank information fields.");
    }

    setIsLoading(true);

    try {
      const { data: userData, error: authError } = await supabase.auth.getUser();
      
      if (authError || !userData.user) {
        throw new Error('Authentication failed');
      }

      const { error } = await supabase.from('withdrawals').insert({
        user_id: userData.user.id,
        amount: amountNum,
        bank_info: bankInfo,
        status: 'pending',
        created_at: new Date().toISOString()
      });

      if (error) {
        throw error;
      }

      // Success
      Alert.alert(
        "Success", 
        "Your withdrawal request has been submitted and is being processed by admin.",
        [
          {
            text: "OK",
            onPress: () => {
              navigation.goBack();
            }
          }
        ]
      );

    } catch (error) {
      console.error('Withdrawal request error:', error);
      Alert.alert(
        "Error", 
        error instanceof Error ? error.message : "Failed to submit withdrawal request. Please try again.",
        [{ text: "OK" }]
      );
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (value: string): string => {
    // Remove non-numeric characters except decimal point
    const numericValue = value.replace(/[^0-9.]/g, '');
    return numericValue;
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Request Withdrawal</Text>
      <Text style={styles.balanceInfo}>Available Balance: ${currentBalance.toLocaleString()} CAD</Text>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Amount to Withdraw</Text>
        <TextInput 
          style={styles.input} 
          placeholder="0.00" 
          keyboardType="numeric"
          value={amount}
          onChangeText={(text) => setAmount(formatCurrency(text))}
          placeholderTextColor="#9CA3AF"
        />
        {amount && (
          <Text style={styles.amountPreview}>
            You will request: ${parseFloat(amount).toLocaleString()} CAD
          </Text>
        )}
      </View>
      
      <View style={styles.inputContainer}>
        <Text style={styles.label}>Bank Name</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Enter your bank name" 
          value={bankInfo.bankName}
          onChangeText={(v) => setBankInfo({...bankInfo, bankName: v})}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Account Number / IBAN</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Enter your account number" 
          value={bankInfo.accountNo}
          onChangeText={(v) => setBankInfo({...bankInfo, accountNo: v})}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Account Owner Name</Text>
        <TextInput 
          style={styles.input} 
          placeholder="Enter account owner name" 
          value={bankInfo.ownerName}
          onChangeText={(v) => setBankInfo({...bankInfo, ownerName: v})}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <TouchableOpacity 
        style={[styles.submitBtn, isLoading && styles.disabledBtn]} 
        onPress={handleSubmit}
        disabled={isLoading}
        activeOpacity={0.7}
      >
        <Text style={styles.btnText}>
          {isLoading ? "Submitting..." : "Submit Request"}
        </Text>
      </TouchableOpacity>

      <Text style={styles.note}>
        Note: Withdrawal requests are reviewed by admin and may take 3-5 business days to process.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    padding: 20, 
    backgroundColor: '#F9FAFB' 
  },
  header: { 
    fontSize: 24, 
    fontWeight: 'bold', 
    marginBottom: 10,
    color: '#111827',
    textAlign: 'center'
  },
  balanceInfo: { 
    fontSize: 16, 
    color: '#6B7280', 
    marginBottom: 30,
    textAlign: 'center',
    fontWeight: '600'
  },
  inputContainer: {
    marginBottom: 20
  },
  label: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 8,
    fontWeight: '600'
  },
  input: { 
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  amountPreview: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 6,
    fontStyle: 'italic'
  },
  submitBtn: { 
    backgroundColor: '#10B981', 
    padding: 16, 
    borderRadius: 12, 
    alignItems: 'center',
    shadowColor: '#10B981',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  disabledBtn: {
    backgroundColor: '#9CA3AF',
  },
  btnText: { 
    color: '#FFF', 
    fontWeight: 'bold', 
    fontSize: 16 
  },
  note: {
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 20,
    lineHeight: 18
  }
});