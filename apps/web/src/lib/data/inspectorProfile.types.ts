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
  | 'availabilityStatus';

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
