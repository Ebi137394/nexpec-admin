// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorProfile.types.ts — comprehensive inspector profile
//
//  Single canonical shape used by the wallet, compliance, AND settings
//  surfaces. Each consumes a subset; one fetcher, one type, three pages.
//
//  Admin-controlled vs inspector-editable boundary documented inline.
//  Server action accepts only the "inspector-editable" subset.
// ════════════════════════════════════════════════════════════════════════════

export type StripeConnectStatus =
  | 'not_connected'
  | 'pending'
  | 'verified'
  | 'restricted'
  | 'disabled'
  | (string & {});

export type VerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected'
  | (string & {});

export type AvailabilityStatus =
  | 'offline'
  | 'available'
  | 'busy'
  | (string & {});

export const PAYMENT_TERMS = [
  'net7',
  'net15',
  'net30',
  'net45',
  'net60',
  'on_completion',
] as const;
export type PaymentTerm = (typeof PAYMENT_TERMS)[number];

export const PAYMENT_TERM_LABELS: Record<PaymentTerm, string> = {
  net7: 'Net 7 days',
  net15: 'Net 15 days',
  net30: 'Net 30 days',
  net45: 'Net 45 days',
  net60: 'Net 60 days',
  on_completion: 'On completion',
};

/** Common ISO 4217 currency codes surfaced in the rates form. */
export const CURRENCY_CHOICES = [
  'USD',
  'CAD',
  'EUR',
  'GBP',
  'AUD',
  'SAR',
  'AED',
] as const;

export interface InspectorProfile {
  // ── Identity (inspector-editable) ─────────────────────────────────────
  id: string;
  email: string;
  fullName: string | null;
  headline: string | null;
  bio: string | null;
  professionalTitle: string | null;
  phone: string | null;
  avatarUrl: string | null;

  // ── Experience + rates (inspector-editable) ───────────────────────────
  yearsOfExperience: string | null;
  hourlyRateCents: number | null;
  responseTimeHours: number | null;

  // ── Rich rates (Sprint 11 — inspector-editable) ──────────────────────
  currency: string;                           // ISO 4217, default 'USD'
  travelRateCents: number | null;             // per-hour while travelling
  overtimeMultiplier: number | null;          // e.g. 1.50
  weekendMultiplier: number | null;
  holidayMultiplier: number | null;
  paymentTerms: PaymentTerm | null;
  minimumEngagementHours: number | null;

  // ── Resume / CV (inspector-editable) ─────────────────────────────────
  resumeUrl: string | null;                   // signed URL (10-min TTL)
  resumePath: string | null;                  // object key in resumes bucket

  // ── Skills + specialties (inspector-editable arrays) ─────────────────
  specialtySlugs: string[];
  ndtMethods: string[];
  certifications: string[];

  // ── Geography (inspector-editable) ────────────────────────────────────
  locationCity: string | null;
  locationProvince: string | null;
  travelRadiusKm: number | null;
  countryOfResidence: string | null;
  workAuthorizedCountries: string[];
  openToSponsoredWork: boolean;
  sponsoredCountries: string[];

  // ── Availability (inspector-editable) ─────────────────────────────────
  isAvailable: boolean;
  availabilityStatus: AvailabilityStatus;

  // ── Wallet (READ-ONLY — admin/Stripe-controlled) ─────────────────────
  balanceCents: number;
  stripeConnectId: string | null;
  stripeConnectStatus: StripeConnectStatus;
  stripeConnectPayoutsEnabled: boolean;
  stripeConnectOnboardedAt: string | null;

  // ── Verification (READ-ONLY — admin-controlled) ───────────────────────
  verificationStatus: VerificationStatus;
  verifiedAt: string | null;
  rejectionReason: string | null;

  // ── Stats (READ-ONLY — system-aggregated) ─────────────────────────────
  ratingAverage: number;
  ratingCount: number;
  completedJobsCount: number;
  totalJobs: number;
  reviewsCount: number;
  recommendPercent: number;

  // ── Meta (READ-ONLY) ──────────────────────────────────────────────────
  createdAt: string | null;
  lastActive: string | null;
}

/**
 * Subset of {@link InspectorProfile} that the inspector is allowed to
 * mutate via the settings form. Anything NOT in this list (verification,
 * payout, balance, stats, role) is rejected by the server action.
 */
export type InspectorEditableFields =
  | 'fullName'
  | 'headline'
  | 'bio'
  | 'professionalTitle'
  | 'phone'
  | 'yearsOfExperience'
  | 'hourlyRateCents'
  | 'responseTimeHours'
  | 'specialtySlugs'
  | 'ndtMethods'
  | 'certifications'
  | 'locationCity'
  | 'locationProvince'
  | 'travelRadiusKm'
  | 'isAvailable'
  | 'availabilityStatus'
  // Sprint 11 — rich rates
  | 'currency'
  | 'travelRateCents'
  | 'overtimeMultiplier'
  | 'weekendMultiplier'
  | 'holidayMultiplier'
  | 'paymentTerms'
  | 'minimumEngagementHours';

/**
 * NDT method choices the settings form exposes as chip selectors.
 * Mirrors the mobile picker. Source of truth for both platforms.
 */
export const NDT_METHOD_CHOICES: ReadonlyArray<{
  slug: string;
  label: string;
}> = [
  { slug: 'ut', label: 'UT · Ultrasonic' },
  { slug: 'rt', label: 'RT · Radiographic' },
  { slug: 'mt', label: 'MT · Magnetic Particle' },
  { slug: 'pt', label: 'PT · Liquid Penetrant' },
  { slug: 'vt', label: 'VT · Visual' },
  { slug: 'et', label: 'ET · Eddy Current' },
  { slug: 'ae', label: 'AE · Acoustic Emission' },
  { slug: 'lt', label: 'LT · Leak Testing' },
];
