// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorProfile.ts — fetcher for the current inspector's profile
//
//  Single canonical fetch. Wallet, compliance, and settings pages all
//  read from this. Self-only — `id = auth.uid()`.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type {
  AvailabilityStatus,
  InspectorProfile,
  StripeConnectStatus,
  VerificationStatus,
} from './inspectorProfile.types';

export type { InspectorProfile };

export async function fetchInspectorProfile(): Promise<InspectorProfile | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select(
        [
          // Identity
          'id', 'email', 'full_name', 'headline', 'bio',
          'professional_title', 'phone', 'avatar_url',
          // Experience + rates
          'years_of_experience', 'hourly_rate_cents', 'response_time_hours',
          // Skills + specialties
          'specialty_slugs', 'ndt_methods', 'certifications',
          // Geography
          'location_city', 'location_province', 'travel_radius_km',
          'country_of_residence', 'work_authorized_countries',
          'open_to_sponsored_work', 'sponsored_countries',
          // Availability
          'is_available', 'availability_status',
          // Wallet
          'balance_cents', 'stripe_connect_id', 'stripe_connect_status',
          'stripe_connect_payouts_enabled', 'stripe_connect_onboarded_at',
          // Verification
          'verification_status', 'verified_at', 'rejection_reason',
          // Stats
          'rating_average', 'rating_count', 'completed_jobs_count',
          'total_jobs', 'reviews_count', 'recommend_percent',
          // Meta
          'created_at', 'last_active',
        ].join(', '),
      )
      .eq('id', user.id)
      .maybeSingle();

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchInspectorProfile] failed:', error.message);
      }
      return null;
    }

    const r = data as unknown as Record<string, unknown>;
    return {
      id: String(r.id),
      email: String(r.email ?? user.email ?? ''),
      fullName: (r.full_name as string | null) ?? null,
      headline: (r.headline as string | null) ?? null,
      bio: (r.bio as string | null) ?? null,
      professionalTitle: (r.professional_title as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      avatarUrl: (r.avatar_url as string | null) ?? null,

      yearsOfExperience: (r.years_of_experience as string | null) ?? null,
      hourlyRateCents: parseBigint(r.hourly_rate_cents),
      responseTimeHours:
        typeof r.response_time_hours === 'number'
          ? (r.response_time_hours as number)
          : null,

      specialtySlugs: arr(r.specialty_slugs),
      ndtMethods: arr(r.ndt_methods),
      certifications: arr(r.certifications),

      locationCity: (r.location_city as string | null) ?? null,
      locationProvince: (r.location_province as string | null) ?? null,
      travelRadiusKm:
        typeof r.travel_radius_km === 'number'
          ? (r.travel_radius_km as number)
          : null,
      countryOfResidence: (r.country_of_residence as string | null) ?? null,
      workAuthorizedCountries: arr(r.work_authorized_countries),
      openToSponsoredWork: Boolean(r.open_to_sponsored_work),
      sponsoredCountries: arr(r.sponsored_countries),

      isAvailable: r.is_available === false ? false : true,
      availabilityStatus:
        ((r.availability_status as string | null) ?? 'offline') as AvailabilityStatus,

      balanceCents: parseBigint(r.balance_cents) ?? 0,
      stripeConnectId: (r.stripe_connect_id as string | null) ?? null,
      stripeConnectStatus:
        ((r.stripe_connect_status as string | null) ?? 'not_connected') as StripeConnectStatus,
      stripeConnectPayoutsEnabled: Boolean(r.stripe_connect_payouts_enabled),
      stripeConnectOnboardedAt:
        (r.stripe_connect_onboarded_at as string | null) ?? null,

      verificationStatus:
        ((r.verification_status as string | null) ?? 'unverified') as VerificationStatus,
      verifiedAt: (r.verified_at as string | null) ?? null,
      rejectionReason: (r.rejection_reason as string | null) ?? null,

      ratingAverage: parseNumeric(r.rating_average) ?? 0,
      ratingCount:
        typeof r.rating_count === 'number' ? (r.rating_count as number) : 0,
      completedJobsCount:
        typeof r.completed_jobs_count === 'number'
          ? (r.completed_jobs_count as number)
          : 0,
      totalJobs:
        typeof r.total_jobs === 'number' ? (r.total_jobs as number) : 0,
      reviewsCount:
        typeof r.reviews_count === 'number' ? (r.reviews_count as number) : 0,
      recommendPercent:
        typeof r.recommend_percent === 'number'
          ? (r.recommend_percent as number)
          : 0,

      createdAt: (r.created_at as string | null) ?? null,
      lastActive: (r.last_active as string | null) ?? null,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchInspectorProfile] threw:', e);
    }
    return null;
  }
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function arr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

function parseBigint(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseNumeric(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
