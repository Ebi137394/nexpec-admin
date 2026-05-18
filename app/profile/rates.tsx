// app/profile/rates.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Switch,
  Animated,
  Pressable,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  DollarSign,
  Briefcase,
  Car,
  Receipt,
  Save,
  Clock,
  CreditCard,
  Building2,
  FileCheck,
  ChevronDown,
  Check,
  Info,
  Calculator,
  Percent,
  Calendar,
  Banknote,
  X,
} from 'lucide-react-native';
import { supabase } from '../../lib/supabase';
import { toCents, fromCents } from '../../lib/money';
import {
  FinancialFormData,
  FinancialUpdatePayload,
  Currency,
  TravelRateUnit,
  CurrencyConfig,
  CURRENCIES,
  DEFAULT_FINANCIAL_SETTINGS,
  OVERTIME_MULTIPLIERS,
  PAYMENT_TERMS_OPTIONS,
  formatCurrency,
  parseCurrencyInput,
} from '../../types/financial';

// ============================================
// Theme Constants
// ============================================
const COLORS = {
  background: '#020617',
  card: '#1E293B',
  cardSecondary: '#0F172A',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  primaryLight: '#60A5FA',
  border: '#334155',
  error: '#EF4444',
  success: '#22C55E',
  warning: '#F59E0B',
  inputBackground: '#0F172A',
  switchTrack: '#475569',
  switchThumb: '#F8FAFC',
} as const;

// ============================================
// Helper Components
// ============================================
interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
}

const SectionHeader: React.FC<SectionHeaderProps> = ({ icon, title, subtitle }) => (
  <View style={styles.sectionHeader}>
    <View style={styles.sectionIconContainer}>
      {icon}
    </View>
    <View style={styles.sectionHeaderText}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
  </View>
);

interface CurrencyInputProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  currency: Currency;
  hint?: string;
}

const CurrencyInput: React.FC<CurrencyInputProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  currency,
  hint,
}) => {
  const currencyConfig = CURRENCIES.find(c => c.code === currency);
  const symbol = currencyConfig?.symbol || '$';

  const handleChange = (text: string) => {
    // Allow only numbers and one decimal point
    const cleaned = text.replace(/[^0-9.]/g, '');
    // Ensure only one decimal point
    const parts = cleaned.split('.');
    if (parts.length > 2) return;
    // Limit decimal places to 2
    if (parts[1] && parts[1].length > 2) return;
    onChangeText(cleaned);
  };

  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.currencyInputContainer}>
        <View style={styles.currencySymbol}>
          <Text style={styles.currencySymbolText}>{symbol}</Text>
        </View>
        <TextInput
          style={styles.currencyInput}
          value={value}
          onChangeText={handleChange}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textMuted}
          keyboardType="decimal-pad"
          returnKeyType="done"
        />
      </View>
      {hint && <Text style={styles.inputHint}>{hint}</Text>}
    </View>
  );
};

interface SelectFieldProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSelect: (value: string) => void;
  icon?: React.ReactNode;
}

const SelectField: React.FC<SelectFieldProps> = ({
  label,
  value,
  options,
  onSelect,
  icon,
}) => {
  const [showPicker, setShowPicker] = useState(false);
  const selectedOption = options.find(o => o.value === value);

  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TouchableOpacity
        style={styles.selectButton}
        onPress={() => setShowPicker(true)}
        activeOpacity={0.7}
      >
        {icon && <View style={styles.selectIcon}>{icon}</View>}
        <Text style={styles.selectButtonText}>
          {selectedOption?.label || 'Select...'}
        </Text>
        <ChevronDown size={20} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setShowPicker(false)}
        >
          <Pressable style={styles.pickerModal} onPress={e => e.stopPropagation()}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{label}</Text>
              <TouchableOpacity onPress={() => setShowPicker(false)}>
                <X size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
              {options.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    styles.pickerOption,
                    option.value === value && styles.pickerOptionSelected,
                  ]}
                  onPress={() => {
                    onSelect(option.value);
                    setShowPicker(false);
                  }}
                >
                  <Text style={[
                    styles.pickerOptionText,
                    option.value === value && styles.pickerOptionTextSelected,
                  ]}>
                    {option.label}
                  </Text>
                  {option.value === value && (
                    <Check size={20} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

interface CurrencySelectorProps {
  value: Currency;
  onSelect: (currency: Currency) => void;
}

const CurrencySelector: React.FC<CurrencySelectorProps> = ({ value, onSelect }) => {
  const [showPicker, setShowPicker] = useState(false);
  const selectedCurrency = CURRENCIES.find(c => c.code === value);

  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>Currency</Text>
      <TouchableOpacity
        style={styles.currencySelector}
        onPress={() => setShowPicker(true)}
        activeOpacity={0.7}
      >
        <Text style={styles.currencyFlag}>{selectedCurrency?.flag}</Text>
        <View style={styles.currencySelectorText}>
          <Text style={styles.currencyCode}>{selectedCurrency?.code}</Text>
          <Text style={styles.currencyName}>{selectedCurrency?.name}</Text>
        </View>
        <ChevronDown size={20} color={COLORS.textSecondary} />
      </TouchableOpacity>

      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}
      >
        <Pressable 
          style={styles.modalOverlay}
          onPress={() => setShowPicker(false)}
        >
          <Pressable style={styles.pickerModal} onPress={e => e.stopPropagation()}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select Currency</Text>
              <TouchableOpacity onPress={() => setShowPicker(false)}>
                <X size={24} color={COLORS.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.pickerScroll} showsVerticalScrollIndicator={false}>
              {CURRENCIES.map((currency) => (
                <TouchableOpacity
                  key={currency.code}
                  style={[
                    styles.currencyOption,
                    currency.code === value && styles.currencyOptionSelected,
                  ]}
                  onPress={() => {
                    onSelect(currency.code);
                    setShowPicker(false);
                  }}
                >
                  <Text style={styles.currencyOptionFlag}>{currency.flag}</Text>
                  <View style={styles.currencyOptionText}>
                    <Text style={styles.currencyOptionCode}>{currency.code}</Text>
                    <Text style={styles.currencyOptionName}>{currency.name}</Text>
                  </View>
                  {currency.code === value && (
                    <Check size={20} color={COLORS.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
};

interface ToggleRowProps {
  label: string;
  description?: string;
  value: boolean;
  onToggle: (value: boolean) => void;
  icon: React.ReactNode;
}

const ToggleRow: React.FC<ToggleRowProps> = ({
  label,
  description,
  value,
  onToggle,
  icon,
}) => (
  <View style={styles.toggleRow}>
    <View style={styles.toggleIconContainer}>{icon}</View>
    <View style={styles.toggleTextContainer}>
      <Text style={styles.toggleLabel}>{label}</Text>
      {description && <Text style={styles.toggleDescription}>{description}</Text>}
    </View>
    <Switch
      value={value}
      onValueChange={onToggle}
      trackColor={{ false: COLORS.switchTrack, true: COLORS.primary }}
      thumbColor={COLORS.switchThumb}
      ios_backgroundColor={COLORS.switchTrack}
    />
  </View>
);

interface RatePreviewProps {
  formData: FinancialFormData;
}

const RatePreview: React.FC<RatePreviewProps> = ({ formData }) => {
  const hourlyRate = parseCurrencyInput(formData.hourly_rate);
  const dailyRate = parseCurrencyInput(formData.daily_rate);
  const travelRate = parseCurrencyInput(formData.travel_rate);
  const overtimeMultiplier = parseFloat(formData.overtime_multiplier) || 1.5;

  if (!hourlyRate && !dailyRate) return null;

  // Calculate example: 10 hours with 2 overtime, 50km travel
  const regularHours = 8;
  const overtimeHours = 2;
  const travelDistance = 50;

  const regularCost = hourlyRate ? regularHours * hourlyRate : 0;
  const overtimeCost = hourlyRate ? overtimeHours * hourlyRate * overtimeMultiplier : 0;
  const travelCost = travelRate ? travelDistance * travelRate : 0;
  const totalCost = regularCost + overtimeCost + travelCost;

  return (
    <View style={styles.previewCard}>
      <View style={styles.previewHeader}>
        <Calculator size={20} color={COLORS.primary} />
        <Text style={styles.previewTitle}>Example Quote</Text>
      </View>
      <Text style={styles.previewSubtitle}>
        10 hours (8 regular + 2 overtime) + 50{formData.travel_rate_unit} travel
      </Text>
      
      <View style={styles.previewBreakdown}>
        <View style={styles.previewRow}>
          <Text style={styles.previewLabel}>Regular (8 hrs)</Text>
          <Text style={styles.previewValue}>
            {formatCurrency(regularCost, formData.currency)}
          </Text>
        </View>
        <View style={styles.previewRow}>
          <Text style={styles.previewLabel}>
            Overtime (2 hrs × {overtimeMultiplier}x)
          </Text>
          <Text style={styles.previewValue}>
            {formatCurrency(overtimeCost, formData.currency)}
          </Text>
        </View>
        {travelRate && (
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>
              Travel (50 {formData.travel_rate_unit})
            </Text>
            <Text style={styles.previewValue}>
              {formatCurrency(travelCost, formData.currency)}
            </Text>
          </View>
        )}
        <View style={[styles.previewRow, styles.previewTotal]}>
          <Text style={styles.previewTotalLabel}>Total</Text>
          <Text style={styles.previewTotalValue}>
            {formatCurrency(totalCost, formData.currency)}
          </Text>
        </View>
      </View>
    </View>
  );
};

// ============================================
// Main Component
// ============================================
export default function RatesScreen(): React.JSX.Element {
  const router = useRouter();
  
  // State
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [hasChanges, setHasChanges] = useState<boolean>(false);
  
  const [formData, setFormData] = useState<FinancialFormData>(DEFAULT_FINANCIAL_SETTINGS);
  const [originalData, setOriginalData] = useState<FinancialFormData>(DEFAULT_FINANCIAL_SETTINGS);

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  // ============================================
  // Data Fetching
  // ============================================
  useEffect(() => {
    fetchFinancialSettings();
  }, []);

  useEffect(() => {
    // Check if form has changes
    const changed = JSON.stringify(formData) !== JSON.stringify(originalData);
    setHasChanges(changed);
  }, [formData, originalData]);

  const fetchFinancialSettings = async (): Promise<void> => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError) throw userError;
      if (!user) {
        Alert.alert('Session Expired', 'Please log in again.', [
          { text: 'OK', onPress: () => router.replace('/auth/login') }
        ]);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select(`
          hourly_rate_cents,
          daily_rate,
          travel_rate,
          travel_rate_unit,
          currency,
          tax_id,
          overtime_multiplier,
          minimum_hours,
          payment_terms_days,
          accepts_credit_card,
          accepts_bank_transfer,
          accepts_check
        `)
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (data) {
        // ★ Task 4: hourly_rate is now hourly_rate_cents (bigint). Convert to dollars for the form input.
        const hourlyDollars = fromCents((data as any).hourly_rate_cents);
        const settings: FinancialFormData = {
          hourly_rate: hourlyDollars > 0 ? hourlyDollars.toString() : '',
          daily_rate: data.daily_rate?.toString() || '',
          travel_rate: data.travel_rate?.toString() || '',
          travel_rate_unit: (data.travel_rate_unit as TravelRateUnit) || 'km',
          currency: (data.currency as Currency) || 'USD',
          tax_id: data.tax_id || '',
          overtime_multiplier: data.overtime_multiplier?.toString() || '1.5',
          minimum_hours: data.minimum_hours?.toString() || '4',
          payment_terms_days: data.payment_terms_days?.toString() || '30',
          accepts_credit_card: data.accepts_credit_card || false,
          accepts_bank_transfer: data.accepts_bank_transfer ?? true,
          accepts_check: data.accepts_check ?? true,
        };
        setFormData(settings);
        setOriginalData(settings);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch settings';
      Alert.alert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // Form Handling
  // ============================================
  const updateFormField = useCallback(<K extends keyof FinancialFormData>(
    field: K,
    value: FinancialFormData[K]
  ): void => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const validateForm = (): boolean => {
    const hourlyRate = parseCurrencyInput(formData.hourly_rate);
    const dailyRate = parseCurrencyInput(formData.daily_rate);
    const travelRate = parseCurrencyInput(formData.travel_rate);

    // At least one rate should be set
    if (!hourlyRate && !dailyRate) {
      Alert.alert(
        'Rate Required',
        'Please set at least an hourly rate or daily rate.'
      );
      return false;
    }

    // Validate rate ranges
    if (hourlyRate !== null && (hourlyRate < 0 || hourlyRate > 10000)) {
      Alert.alert('Invalid Rate', 'Hourly rate must be between $0 and $10,000.');
      return false;
    }

    if (dailyRate !== null && (dailyRate < 0 || dailyRate > 50000)) {
      Alert.alert('Invalid Rate', 'Daily rate must be between $0 and $50,000.');
      return false;
    }

    if (travelRate !== null && (travelRate < 0 || travelRate > 10)) {
      Alert.alert('Invalid Rate', 'Travel rate must be between $0 and $10 per ' + formData.travel_rate_unit + '.');
      return false;
    }

    // Validate daily rate vs hourly rate consistency
    if (hourlyRate && dailyRate) {
      if (dailyRate < hourlyRate * 4) {
        Alert.alert(
          'Rate Warning',
          'Your daily rate is less than 4 hours of your hourly rate. Are you sure this is correct?',
          [
            { text: 'Fix It', style: 'cancel' },
            { text: 'Keep It', onPress: () => {} },
          ]
        );
      }
    }

    return true;
  };

  const handleSave = async (): Promise<void> => {
    if (!validateForm()) return;

    try {
      setSaving(true);

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError) throw userError;
      if (!user) throw new Error('No authenticated user found');

      const updates: FinancialUpdatePayload = {
        // ★ Task 4: hourly_rate column is now hourly_rate_cents (bigint).
        hourly_rate_cents: toCents(parseCurrencyInput(formData.hourly_rate)),
        daily_rate: parseCurrencyInput(formData.daily_rate),
        travel_rate: parseCurrencyInput(formData.travel_rate),
        travel_rate_unit: formData.travel_rate_unit,
        currency: formData.currency,
        tax_id: formData.tax_id.trim() || null,
        overtime_multiplier: parseFloat(formData.overtime_multiplier) || 1.5,
        minimum_hours: parseFloat(formData.minimum_hours) || 4,
        payment_terms_days: parseInt(formData.payment_terms_days, 10) || 30,
        accepts_credit_card: formData.accepts_credit_card,
        accepts_bank_transfer: formData.accepts_bank_transfer,
        accepts_check: formData.accepts_check,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

      if (error) throw error;

      setOriginalData(formData);
      Alert.alert('Success', 'Your rates have been updated successfully!', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to update rates';
      Alert.alert('Error', errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleBack = (): void => {
    if (hasChanges) {
      Alert.alert(
        'Unsaved Changes',
        'You have unsaved changes. Are you sure you want to leave?',
        [
          { text: 'Stay', style: 'cancel' },
          { text: 'Leave', style: 'destructive', onPress: () => router.back() },
        ]
      );
    } else {
      router.back();
    }
  };

  // ============================================
  // Render
  // ============================================
  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading your rates...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <ArrowLeft size={24} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Rates & Payment</Text>
          <TouchableOpacity
            style={[
              styles.saveHeaderButton,
              (!hasChanges || saving) && styles.saveHeaderButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!hasChanges || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <Text style={[
                styles.saveHeaderButtonText,
                !hasChanges && styles.saveHeaderButtonTextDisabled,
              ]}>
                Save
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <Animated.ScrollView
          style={[styles.scrollView, { opacity: fadeAnim }]}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Currency Selector */}
          <View style={styles.card}>
            <CurrencySelector
              value={formData.currency}
              onSelect={(currency) => updateFormField('currency', currency)}
            />
          </View>

          {/* Labor Rates Section */}
          <View style={styles.card}>
            <SectionHeader
              icon={<DollarSign size={20} color={COLORS.primary} />}
              title="Labor Rates"
              subtitle="Set your standard rates for inspection work"
            />
            
            <CurrencyInput
              label="Hourly Rate"
              value={formData.hourly_rate}
              onChangeText={(value) => updateFormField('hourly_rate', value)}
              placeholder="0.00"
              currency={formData.currency}
              hint="Standard rate per hour of work"
            />

            <CurrencyInput
              label="Daily Rate"
              value={formData.daily_rate}
              onChangeText={(value) => updateFormField('daily_rate', value)}
              placeholder="0.00"
              currency={formData.currency}
              hint="Full day rate (typically 8 hours)"
            />

            <SelectField
              label="Overtime Multiplier"
              value={formData.overtime_multiplier}
              options={OVERTIME_MULTIPLIERS}
              onSelect={(value) => updateFormField('overtime_multiplier', value)}
              icon={<Percent size={16} color={COLORS.textSecondary} />}
            />

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Minimum Hours</Text>
              <View style={styles.inlineInputContainer}>
                <TextInput
                  style={styles.inlineInput}
                  value={formData.minimum_hours}
                  onChangeText={(value) => {
                    const cleaned = value.replace(/[^0-9.]/g, '');
                    updateFormField('minimum_hours', cleaned);
                  }}
                  placeholder="4"
                  placeholderTextColor={COLORS.textMuted}
                  keyboardType="decimal-pad"
                  maxLength={4}
                />
                <Text style={styles.inlineInputSuffix}>hours per job</Text>
              </View>
            </View>
          </View>

          {/* Travel & Expenses Section */}
          <View style={styles.card}>
            <SectionHeader
              icon={<Car size={20} color={COLORS.primary} />}
              title="Travel & Expenses"
              subtitle="Mileage and travel compensation"
            />

            <View style={styles.travelRateRow}>
              <View style={styles.travelRateInput}>
                <CurrencyInput
                  label="Travel Rate"
                  value={formData.travel_rate}
                  onChangeText={(value) => updateFormField('travel_rate', value)}
                  placeholder="0.00"
                  currency={formData.currency}
                />
              </View>
              <View style={styles.travelUnitSelector}>
                <Text style={styles.inputLabel}>Per</Text>
                <View style={styles.unitToggle}>
                  <TouchableOpacity
                    style={[
                      styles.unitButton,
                      formData.travel_rate_unit === 'km' && styles.unitButtonActive,
                    ]}
                    onPress={() => updateFormField('travel_rate_unit', 'km')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      formData.travel_rate_unit === 'km' && styles.unitButtonTextActive,
                    ]}>
                      km
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.unitButton,
                      formData.travel_rate_unit === 'mile' && styles.unitButtonActive,
                    ]}
                    onPress={() => updateFormField('travel_rate_unit', 'mile')}
                  >
                    <Text style={[
                      styles.unitButtonText,
                      formData.travel_rate_unit === 'mile' && styles.unitButtonTextActive,
                    ]}>
                      mi
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>

          {/* Payment Terms Section */}
          <View style={styles.card}>
            <SectionHeader
              icon={<CreditCard size={20} color={COLORS.primary} />}
              title="Payment Terms"
              subtitle="How and when you accept payment"
            />

            <SelectField
              label="Payment Terms"
              value={formData.payment_terms_days}
              options={PAYMENT_TERMS_OPTIONS}
              onSelect={(value) => updateFormField('payment_terms_days', value)}
              icon={<Calendar size={16} color={COLORS.textSecondary} />}
            />

            <Text style={styles.paymentMethodsLabel}>Accepted Payment Methods</Text>
            
            <ToggleRow
              label="Bank Transfer / Wire"
              description="ACH, Wire transfer, or EFT"
              value={formData.accepts_bank_transfer}
              onToggle={(value) => updateFormField('accepts_bank_transfer', value)}
              icon={<Building2 size={20} color={COLORS.textSecondary} />}
            />

            <ToggleRow
              label="Check"
              description="Business or personal checks"
              value={formData.accepts_check}
              onToggle={(value) => updateFormField('accepts_check', value)}
              icon={<FileCheck size={20} color={COLORS.textSecondary} />}
            />

            <ToggleRow
              label="Credit Card"
              description="Visa, Mastercard, etc."
              value={formData.accepts_credit_card}
              onToggle={(value) => updateFormField('accepts_credit_card', value)}
              icon={<CreditCard size={20} color={COLORS.textSecondary} />}
            />
          </View>

          {/* Tax Information Section */}
          <View style={styles.card}>
            <SectionHeader
              icon={<Receipt size={20} color={COLORS.primary} />}
              title="Tax Information"
              subtitle="For invoicing purposes"
            />

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Tax ID / VAT Number</Text>
              <TextInput
                style={styles.textInput}
                value={formData.tax_id}
                onChangeText={(value) => updateFormField('tax_id', value)}
                placeholder="e.g., XX-XXXXXXX"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="characters"
              />
              <Text style={styles.inputHint}>
                This will appear on invoices generated through NEXPEC
              </Text>
            </View>
          </View>

          {/* Rate Preview */}
          <RatePreview formData={formData} />

          {/* Info Box */}
          <View style={styles.infoBox}>
            <Info size={18} color={COLORS.textSecondary} />
            <Text style={styles.infoText}>
              Your rates are visible to clients when they view your profile. 
              You can always provide custom quotes for specific jobs.
            </Text>
          </View>

          {/* Save Button */}
          <TouchableOpacity
            style={[
              styles.saveButton,
              (!hasChanges || saving) && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!hasChanges || saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color={COLORS.text} />
            ) : (
              <>
                <Save size={20} color={COLORS.text} />
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>

          <View style={styles.bottomSpacer} />
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============================================
// Styles
// ============================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.textSecondary,
    marginTop: 16,
    fontSize: 16,
    fontWeight: '500',
  },
  keyboardAvoid: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    letterSpacing: 0.3,
  },
  saveHeaderButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: COLORS.card,
  },
  saveHeaderButtonDisabled: {
    opacity: 0.5,
  },
  saveHeaderButtonText: {
    color: COLORS.primary,
    fontSize: 15,
    fontWeight: '600',
  },
  saveHeaderButtonTextDisabled: {
    color: COLORS.textMuted,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  bottomSpacer: {
    height: 40,
  },

  // Card
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // Section Header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  sectionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeaderText: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // Input Groups
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
  },
  inputHint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 6,
  },

  // Currency Input
  currencyInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  currencySymbol: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: COLORS.border,
    borderRightWidth: 1,
    borderRightColor: COLORS.border,
  },
  currencySymbolText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  currencyInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
  },

  // Text Input
  textInput: {
    backgroundColor: COLORS.inputBackground,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // Inline Input
  inlineInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingRight: 16,
  },
  inlineInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.text,
    maxWidth: 80,
  },
  inlineInputSuffix: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },

  // Select Field
  selectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBackground,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  selectIcon: {
    marginRight: 12,
  },
  selectButtonText: {
    flex: 1,
    fontSize: 16,
    color: COLORS.text,
  },

  // Currency Selector
  currencySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.inputBackground,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  currencyFlag: {
    fontSize: 24,
  },
  currencySelectorText: {
    flex: 1,
  },
  currencyCode: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  currencyName: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // Travel Rate Row
  travelRateRow: {
    flexDirection: 'row',
    gap: 12,
  },
  travelRateInput: {
    flex: 1,
  },
  travelUnitSelector: {
    width: 100,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: COLORS.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  unitButton: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unitButtonActive: {
    backgroundColor: COLORS.primary,
  },
  unitButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textSecondary,
  },
  unitButtonTextActive: {
    color: COLORS.text,
  },

  // Toggle Row
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  toggleIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.inputBackground,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  toggleTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: COLORS.text,
  },
  toggleDescription: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  paymentMethodsLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 4,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  pickerModal: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '60%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  pickerScroll: {
    paddingHorizontal: 20,
  },
  pickerOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  pickerOptionSelected: {
    backgroundColor: COLORS.primary + '10',
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  pickerOptionText: {
    fontSize: 16,
    color: COLORS.text,
  },
  pickerOptionTextSelected: {
    color: COLORS.primary,
    fontWeight: '600',
  },

  // Currency Option
  currencyOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },
  currencyOptionSelected: {
    backgroundColor: COLORS.primary + '10',
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  currencyOptionFlag: {
    fontSize: 24,
  },
  currencyOptionText: {
    flex: 1,
  },
  currencyOptionCode: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  currencyOptionName: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },

  // Preview Card
  previewCard: {
    backgroundColor: COLORS.primary + '10',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.primary + '30',
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  previewSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 16,
  },
  previewBreakdown: {
    gap: 8,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  previewLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  previewValue: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  previewTotal: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.primary + '30',
  },
  previewTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  previewTotalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.primary,
  },

  // Info Box
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  // Save Button
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 12,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  saveButtonDisabled: {
    backgroundColor: COLORS.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
});

