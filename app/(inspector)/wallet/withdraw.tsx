// ============================================================================
// WITHDRAW SCREEN
// ============================================================================
// Inspector withdrawal screen with bank details form

import React, { useState, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Animated, {
  FadeInDown,
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { useWallet } from '@/hooks/useWallet';
import type { BankDetails } from '@/types/core';
import { LoadingOverlay, SuccessAnimation } from '@/components';
// #QA — withdrawals route through the offline outbox; the op's client_op_id is
// passed to the idempotent process_withdrawal RPC so a flaky retry can't double-charge.
import { enqueueWithdrawalRequest, isOnline, flushQueue, getOpStatus } from '@/lib/offline';
import { supabase } from '@/lib/supabase';
// #QA — canonical USD/cents money formatter (single source of truth, mirrors web).
import { formatUsd, toCents } from '@/src/core/utils/money';
import { useLanguage } from '@/src/i18n/LanguageProvider';

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Delegates to the canonical USD formatter (single source of truth). Input is
// dollars (wallet balance); normalize to cents at this boundary. #QA
const formatCurrency = (amount: number): string =>
  formatUsd(toCents(amount), { fractionDigits: 2 });

// ============================================================================
// TYPES
// ============================================================================

interface FormErrors {
  amount?: string;
  bankName?: string;
  accountNumber?: string;
  transitNumber?: string;
  institutionNumber?: string; // 👈 اضافه شد برای Stripe کانادا
  accountHolderName?: string;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function WithdrawScreen() {
  const { wallet } = useWallet();
  const { t, language } = useLanguage();

  // Form state
  const [amount, setAmount] = useState('');

  // Bank Form State (Always visible since we don't store banks in a separate table)
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [transitNumber, setTransitNumber] = useState('');
  const [institutionNumber, setInstitutionNumber] = useState(''); // 👈 State جدید برای کد موسسه
  const [accountHolderName, setAccountHolderName] = useState('');
  const [email, setEmail] = useState(''); // Optional for e-transfer logic

  // UI state
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Animation values
  const buttonScale = useSharedValue(1);

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }],
  }));

  const handlePressIn = () => {
    buttonScale.value = withSpring(0.95, { damping: 15 });
  };

  const handlePressOut = () => {
    buttonScale.value = withSpring(1, { damping: 15 });
  };

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    // Validate amount
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount)) {
      newErrors.amount = t('Please enter a valid amount');
    } else if (numAmount <= 0) {
      newErrors.amount = t('Amount must be greater than 0');
    } else if (numAmount > (wallet?.available_balance || 0)) {
      newErrors.amount = t('Amount exceeds available balance');
    } else if (numAmount < 25) {
      newErrors.amount = t('Minimum withdrawal amount is $25');
    }

    // Validate Bank Details
    if (!bankName.trim()) {
      newErrors.bankName = t('Bank name is required');
    }
    if (!accountHolderName.trim()) {
      newErrors.accountHolderName = t('Account holder name is required');
    }

    if (!accountNumber.trim()) {
      newErrors.accountNumber = t('Account number is required');
    } else if (!/^\d{7,12}$/.test(accountNumber.replace(/\s/g, ''))) {
      newErrors.accountNumber = t('Invalid account number (7-12 digits)');
    }

    if (!transitNumber.trim()) {
      newErrors.transitNumber = t('Transit number is required');
    } else if (!/^\d{5}$/.test(transitNumber.replace(/\s/g, ''))) {
      newErrors.transitNumber = t('Transit number must be 5 digits');
    }

    // 👈 اعتبارسنجی کد 3 رقمی موسسه
    if (!institutionNumber.trim()) {
      newErrors.institutionNumber = t('Institution number is required');
    } else if (!/^\d{3}$/.test(institutionNumber.replace(/\s/g, ''))) {
      newErrors.institutionNumber = t('Institution must be 3 digits');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [
    amount,
    wallet,
    bankName,
    accountNumber,
    transitNumber,
    institutionNumber,
    accountHolderName,
    language,
  ]);

  const handleWithdraw = async () => {
    if (!validateForm()) return;

    // Tax-info-before-money: pre-check the payee's tax status and route to the
    // Tax Center if not cleared. The DB gate (TAX_NOT_VERIFIED) is the hard
    // backstop; we pre-check here because the offline outbox can't surface the
    // specific error message back to this screen.
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: tp } = await supabase
          .from('tax_profiles')
          .select('tax_status, is_tax_exempt, expires_at')
          .eq('user_id', user.id)
          .maybeSingle();
        const verified =
          tp?.tax_status === 'verified' &&
          (!tp?.expires_at || new Date(tp.expires_at) > new Date());
        const cleared = verified || tp?.is_tax_exempt === true;
        if (!cleared) {
          router.push('/(inspector)/tax-center');
          return;
        }
      }
    } catch {
      /* non-blocking: the DB gate still enforces TAX_NOT_VERIFIED */
    }

    setIsSubmitting(true);

    try {
      const bankDetailsObj = {
        bank_name: bankName,
        account_number: accountNumber.replace(/\s/g, ''),
        transit_number: transitNumber.replace(/\s/g, ''),
        institution_number: institutionNumber.replace(/\s/g, ''), 
        account_holder_name: accountHolderName,
        email: email || undefined,
      };

      // Route through the outbox → request_withdrawal RPC (manual payout model):
      // reserves Available → pending_payouts and queues the request for the admin
      // Treasury Control Tower. client_op_id makes a flaky retry idempotent.
      const payoutNote =
        `${bankDetailsObj.account_holder_name} · ${bankDetailsObj.bank_name} · ` +
        `acct ${bankDetailsObj.account_number} · transit ${bankDetailsObj.transit_number} · ` +
        `inst ${bankDetailsObj.institution_number}` +
        (bankDetailsObj.email ? ` · ${bankDetailsObj.email}` : '');
      const opId = await enqueueWithdrawalRequest({
        p_amount_cents: toCents(parseFloat(amount)),
        p_method: 'bank_transfer',
        p_note: payoutNote,
      });
      if (isOnline()) {
        try {
          await flushQueue();
        } catch {
          /* drain error → op stays queued, reported below */
        }
      }
      const status = await getOpStatus(opId);

      if (status === null) {
        // Drained successfully — the withdrawal landed.
        if (wallet && 'refresh' in wallet) {
          (wallet as any).refresh();
        }
        Alert.alert(
          t('Withdrawal Successful! 🎉'),
          `${t('Your request to withdraw')} $${amount} ${t('has been submitted successfully.')}`,
          [{ text: t('Awesome'), onPress: () => router.back() }],
        );
      } else if (status === 'abandoned' || status === 'conflict') {
        // Server rejected it (e.g. insufficient funds) — deterministic, not retried.
        Alert.alert(
          t('Withdrawal not completed'),
          t('We couldn’t process this withdrawal. Please check your available balance and try again.'),
        );
      } else {
        // pending / in_flight / failed → offline or transient; it will retry.
        Alert.alert(
          t('Withdrawal queued'),
          t('You appear to be offline. Your withdrawal is queued and will be submitted automatically when you reconnect.'),
          [{ text: t('OK'), onPress: () => router.back() }],
        );
      }
    } catch (error: any) {
      Alert.alert(t('Error'), error.message || t('Failed to process withdrawal'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSuccessComplete = () => {
    setShowSuccess(false);
    router.back();
  };

  const handleQuickAmount = (value: number) => {
    if (value <= (wallet?.balance || 0)) {
      setAmount(value.toString());
      setErrors((prev) => ({ ...prev, amount: undefined }));
    }
  };

  return (
    <LinearGradient colors={['#0D1B2A', '#1B2838']} style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {/* Header */}
          <View style={styles.header}>
            <Pressable style={styles.backButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
            </Pressable>
            <Text style={styles.headerTitle}>{t('Withdraw Funds')}</Text>
            <View style={{ width: 44 }} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Available Balance Card */}
            <Animated.View entering={FadeInUp.springify()}>
              <LinearGradient
                colors={['#1E3A5F', '#0D1B2A']}
                style={styles.balanceCard}
              >
                <Text style={styles.balanceLabel}>{t('Available Balance')}</Text>
                <Text style={styles.balanceAmount}>
                  {formatCurrency(wallet?.balance || 0)}
                </Text>
              </LinearGradient>
            </Animated.View>

            {/* Amount Input */}
            <Animated.View
              entering={FadeInDown.delay(100).springify()}
              style={styles.section}
            >
              <Text style={styles.sectionTitle}>{t('Amount to Withdraw')}</Text>
              <View
                style={[
                  styles.amountInputContainer,
                  errors.amount && styles.inputError,
                ]}
              >
                <Text style={styles.currencySymbol}>$</Text>
                <TextInput
                  style={styles.amountInput}
                  value={amount}
                  onChangeText={(text) => {
                    setAmount(text.replace(/[^0-9.]/g, ''));
                    setErrors((prev) => ({ ...prev, amount: undefined }));
                  }}
                  placeholder="0.00"
                  placeholderTextColor="#4B5563"
                  keyboardType="decimal-pad"
                  autoFocus
                />
              </View>
              {errors.amount && (
                <Text style={styles.errorText}>{errors.amount}</Text>
              )}

              {/* Quick Amount Buttons */}
              <View style={styles.quickAmounts}>
                {[50, 100, 250, 500].map((value) => (
                  <Pressable
                    key={value}
                    style={[
                      styles.quickAmountButton,
                      value > (wallet?.balance || 0) &&
                        styles.quickAmountDisabled,
                    ]}
                    onPress={() => handleQuickAmount(value)}
                    disabled={value > (wallet?.balance || 0)}
                  >
                    <Text
                      style={[
                        styles.quickAmountText,
                        value > (wallet?.balance || 0) &&
                          styles.quickAmountTextDisabled,
                      ]}
                    >
                      ${value}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Animated.View>

            {/* Bank Details Form */}
            <Animated.View
              entering={FadeInDown.delay(200).springify()}
              style={styles.section}
            >
              <Text style={styles.sectionTitle}>{t('Direct Deposit Details')}</Text>

              <View style={styles.formContainer}>
                {/* Account Holder */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('Account Holder Name')}</Text>
                  <View style={styles.inputContainer}>
                    <Ionicons
                      name="person-outline"
                      size={20}
                      color="#64748B"
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.textInput}
                      value={accountHolderName}
                      onChangeText={setAccountHolderName}
                      placeholder={t('Full Name on Account')}
                      placeholderTextColor="#4B5563"
                    />
                  </View>
                </View>

                {/* Bank Name */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('Bank Name')}</Text>
                  <View
                    style={[
                      styles.inputContainer,
                      errors.bankName && styles.inputError,
                    ]}
                  >
                    <Ionicons
                      name="business-outline"
                      size={20}
                      color="#64748B"
                      style={styles.inputIcon}
                    />
                    <TextInput
                      style={styles.textInput}
                      value={bankName}
                      onChangeText={setBankName}
                      placeholder={t('e.g. TD, RBC, Scotiabank')}
                      placeholderTextColor="#4B5563"
                    />
                  </View>
                  {errors.bankName && (
                    <Text style={styles.errorText}>{errors.bankName}</Text>
                  )}
                </View>

                {/* Transit, Institution & Account Number Row (آپدیت شد) */}
                <View style={styles.row}>
                  {/* Transit (5 digits) */}
                  <View style={[styles.inputGroup, { flex: 1.1, marginRight: 8 }]}>
                    <Text style={styles.inputLabel}>{t('Transit(5)')}</Text>
                    <View
                      style={[
                        styles.inputContainer,
                        { paddingHorizontal: 10 },
                        errors.transitNumber && styles.inputError,
                      ]}
                    >
                      <TextInput
                        style={styles.textInput}
                        value={transitNumber}
                        onChangeText={setTransitNumber}
                        placeholder="12345"
                        placeholderTextColor="#4B5563"
                        keyboardType="number-pad"
                        maxLength={5}
                      />
                    </View>
                  </View>

                  {/* Institution (3 digits) */}
                  <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                    <Text style={styles.inputLabel}>{t('Inst(3)')}</Text>
                    <View
                      style={[
                        styles.inputContainer,
                        { paddingHorizontal: 10 },
                        errors.institutionNumber && styles.inputError,
                      ]}
                    >
                      <TextInput
                        style={styles.textInput}
                        value={institutionNumber}
                        onChangeText={setInstitutionNumber}
                        placeholder="004"
                        placeholderTextColor="#4B5563"
                        keyboardType="number-pad"
                        maxLength={3}
                      />
                    </View>
                  </View>

                  {/* Account Number */}
                  <View style={[styles.inputGroup, { flex: 1.8 }]}>
                    <Text style={styles.inputLabel}>{t('Account Number')}</Text>
                    <View
                      style={[
                        styles.inputContainer,
                        { paddingHorizontal: 10 },
                        errors.accountNumber && styles.inputError,
                      ]}
                    >
                      <TextInput
                        style={styles.textInput}
                        value={accountNumber}
                        onChangeText={setAccountNumber}
                        placeholder="0012345"
                        placeholderTextColor="#4B5563"
                        keyboardType="number-pad"
                        maxLength={12}
                      />
                    </View>
                  </View>
                </View>
                {(errors.transitNumber || errors.accountNumber || errors.institutionNumber) && (
                  <Text style={styles.errorText}>
                    {t('Invalid Transit, Institution, or Account Number')}
                  </Text>
                )}
              </View>
            </Animated.View>

            {/* Processing Info */}
            <Animated.View
              entering={FadeInDown.delay(300).springify()}
              style={styles.infoCard}
            >
              <Ionicons name="information-circle" size={24} color="#3B82F6" />
              <View style={styles.infoContent}>
                <Text style={styles.infoTitle}>{t('Processing Time')}</Text>
                <Text style={styles.infoText}>
                  {t('Withdrawals are typically processed within 10-20 business days.')}
                </Text>
              </View>
            </Animated.View>
          </ScrollView>

          {/* Submit Button */}
          <View style={styles.footer}>
            <Animated.View style={buttonAnimatedStyle}>
              <Pressable
                onPress={handleWithdraw}
                onPressIn={handlePressIn}
                onPressOut={handlePressOut}
                disabled={
                  isSubmitting || !amount || parseFloat(amount) <= 0
                }
              >
                <LinearGradient
                  colors={
                    isSubmitting || !amount || parseFloat(amount) <= 0
                      ? ['#374151', '#1F2937']
                      : ['#3B82F6', '#2563EB']
                  }
                  style={styles.submitButton}
                >
                  <Ionicons name="wallet-outline" size={22} color="#FFFFFF" />
                  <Text style={styles.submitButtonText}>
                    {isSubmitting
                      ? t('Processing...')
                      : `${t('Withdraw')} ${
                          amount ? formatCurrency(parseFloat(amount) || 0) : ''
                        }`}
                  </Text>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          </View>
        </KeyboardAvoidingView>

        <LoadingOverlay visible={isSubmitting} message={t('Processing withdrawal...')} />
        <SuccessAnimation
          visible={showSuccess}
          title={t('Request Sent')}
          message={t('Your funds are on the way!')}
          onComplete={handleSuccessComplete}
        />
      </SafeAreaView>
    </LinearGradient>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  scrollView: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  balanceCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    alignItems: 'center',
  },
  balanceLabel: { fontSize: 14, color: '#94A3B8', marginBottom: 4 },
  balanceAmount: { fontSize: 32, fontWeight: '700', color: '#FFFFFF' },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  amountInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 95, 0.5)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: '600',
    color: '#64748B',
    marginRight: 8,
  },
  amountInput: { flex: 1, fontSize: 32, fontWeight: '700', color: '#FFFFFF' },
  quickAmounts: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 8,
  },
  quickAmountButton: {
    flex: 1,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.2)',
    marginHorizontal: 4,
  },
  quickAmountDisabled: { opacity: 0.4 },
  quickAmountText: { fontSize: 14, fontWeight: '600', color: '#3B82F6' },
  quickAmountTextDisabled: { color: '#64748B' },
  formContainer: {
    backgroundColor: 'rgba(30, 58, 95, 0.3)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.1)',
  },
  inputGroup: { marginBottom: 16 },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#94A3B8',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 58, 95, 0.5)',
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.1)',
  },
  inputIcon: { marginRight: 12 },
  textInput: { flex: 1, fontSize: 16, color: '#FFFFFF', paddingVertical: 14 },
  inputError: { borderColor: '#EF4444' },
  errorText: { fontSize: 12, color: '#EF4444', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  infoCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  infoContent: { flex: 1 },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  infoText: { fontSize: 13, color: '#94A3B8', lineHeight: 20 },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(59, 130, 246, 0.1)',
  },
  submitButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 14,
    gap: 10,
  },
  submitButtonText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
});