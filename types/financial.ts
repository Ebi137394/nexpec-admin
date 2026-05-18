// types/financial.ts

/**
 * Supported currencies
 */
export type Currency = 'USD' | 'CAD' | 'EUR' | 'GBP';

/**
 * Travel rate units
 */
export type TravelRateUnit = 'km' | 'mile';

/**
 * Currency configuration
 */
export interface CurrencyConfig {
  code: Currency;
  symbol: string;
  name: string;
  flag: string;
}

/**
 * All supported currencies with their configurations
 */
export const CURRENCIES: CurrencyConfig[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'CAD', symbol: '$', name: 'Canadian Dollar', flag: '🇨🇦' },
  { code: 'EUR', symbol: '€', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', symbol: '£', name: 'British Pound', flag: '🇬🇧' },
];

/**
 * Financial settings from the database
 */
export interface FinancialSettings {
  hourly_rate_cents: number | null;     // ★ Task 4
  daily_rate: number | null;
  travel_rate: number | null;
  travel_rate_unit: TravelRateUnit;
  currency: Currency;
  tax_id: string | null;
  overtime_multiplier: number;
  minimum_hours: number;
  payment_terms_days: number;
  accepts_credit_card: boolean;
  accepts_bank_transfer: boolean;
  accepts_check: boolean;
  bank_name: string | null;
  bank_account_last_four: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_postal_code: string | null;
  billing_country: string;
}

/**
 * Form data for editing financial settings
 */
export interface FinancialFormData {
  hourly_rate: string;
  daily_rate: string;
  travel_rate: string;
  travel_rate_unit: TravelRateUnit;
  currency: Currency;
  tax_id: string;
  overtime_multiplier: string;
  minimum_hours: string;
  payment_terms_days: string;
  accepts_credit_card: boolean;
  accepts_bank_transfer: boolean;
  accepts_check: boolean;
}

/**
 * Payload for updating financial settings
 */
export interface FinancialUpdatePayload {
  hourly_rate_cents: number | null;     // ★ Task 4
  daily_rate: number | null;
  travel_rate: number | null;
  travel_rate_unit: TravelRateUnit;
  currency: Currency;
  tax_id: string | null;
  overtime_multiplier: number;
  minimum_hours: number;
  payment_terms_days: number;
  accepts_credit_card: boolean;
  accepts_bank_transfer: boolean;
  accepts_check: boolean;
  updated_at: string;
}

/**
 * Job cost estimate result
 */
export interface JobEstimate {
  base_cost: number;
  travel_cost: number;
  overtime_cost: number;
  total_cost: number;
  currency: Currency;
}

/**
 * Default financial settings for new users
 */
export const DEFAULT_FINANCIAL_SETTINGS: FinancialFormData = {
  hourly_rate: '',
  daily_rate: '',
  travel_rate: '',
  travel_rate_unit: 'km',
  currency: 'USD',
  tax_id: '',
  overtime_multiplier: '1.5',
  minimum_hours: '4',
  payment_terms_days: '30',
  accepts_credit_card: false,
  accepts_bank_transfer: true,
  accepts_check: true,
};

/**
 * Common overtime multiplier options
 */
export const OVERTIME_MULTIPLIERS: { value: string; label: string }[] = [
  { value: '1.0', label: '1.0x (Standard)' },
  { value: '1.25', label: '1.25x' },
  { value: '1.5', label: '1.5x (Time and a half)' },
  { value: '1.75', label: '1.75x' },
  { value: '2.0', label: '2.0x (Double time)' },
  { value: '2.5', label: '2.5x' },
  { value: '3.0', label: '3.0x (Triple time)' },
];

/**
 * Payment terms options
 */
export const PAYMENT_TERMS_OPTIONS: { value: string; label: string }[] = [
  { value: '0', label: 'Due on Receipt' },
  { value: '7', label: 'Net 7' },
  { value: '14', label: 'Net 14' },
  { value: '15', label: 'Net 15' },
  { value: '30', label: 'Net 30' },
  { value: '45', label: 'Net 45' },
  { value: '60', label: 'Net 60' },
  { value: '90', label: 'Net 90' },
];

/**
 * Helper function to format currency amount
 */
export const formatCurrency = (
  amount: number | null | undefined,
  currency: Currency = 'USD'
): string => {
  if (amount === null || amount === undefined) return '—';
  
  const config = CURRENCIES.find(c => c.code === currency);
  const symbol = config?.symbol || '$';
  
  return `${symbol}${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/**
 * Helper function to parse currency input
 */
export const parseCurrencyInput = (value: string): number | null => {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : Math.round(parsed * 100) / 100;
};

