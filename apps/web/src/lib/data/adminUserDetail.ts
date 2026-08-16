// ════════════════════════════════════════════════════════════════════════════
//  lib/data/adminUserDetail.ts — full profile read for the admin detail page
//
//  Admin is the ONE role that legitimately sees both client-side AND
//  inspector-side fields on a single profile (the GR2 partition exists
//  to keep client ↔ inspector visibility separate; admin oversees both).
//  This fetcher projects the union; the page renders subsets based on the
//  profile's `role`.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface AdminUserDetail {
  id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  avatar_url: string | null;
  phone: string | null;
  bio: string | null;
  headline: string | null;
  professional_title: string | null;
  company_name: string | null;
  location_city: string | null;
  location_province: string | null;
  location: string | null;

  created_at: string | null;
  updated_at: string | null;
  last_active: string | null;

  // Verification
  verification_status: string | null;
  verified_at: string | null;
  rejection_reason: string | null;
  terms_accepted: boolean | null;

  // Access state (Sprint 12J — admin moderation)
  status: string | null;
  suspension_reason: string | null;
  suspended_at: string | null;
  suspended_by: string | null;

  // Wallet / Stripe (admin sees both sides)
  balance_cents: number | null;
  stripe_connect_id: string | null;
  stripe_connect_status: string | null;
  stripe_connect_payouts_enabled: boolean | null;
  stripe_connect_onboarded_at: string | null;

  // Aggregate stats
  rating_average: number | null;
  rating_count: number | null;
  reviews_count: number | null;
  total_reviews: number | null;
  recommend_percent: number | null;
  completed_jobs_count: number | null;
  total_jobs: number | null;

  // Inspector specifics
  years_of_experience: string | null;
  hourly_rate_cents: number | null;
  response_time_hours: number | null;
  specialty_slugs: string[];
  ndt_methods: string[];
  certifications: string[];
  travel_radius_km: number | null;
  home_base_label: string | null;
  country_of_residence: string | null;
  work_authorized_countries: string[];
  open_to_sponsored_work: boolean | null;
  sponsored_countries: string[];
  currency: string | null;
  travel_rate_cents: number | null;
  overtime_multiplier: number | null;
  weekend_multiplier: number | null;
  holiday_multiplier: number | null;
  payment_terms: string | null;
  minimum_engagement_hours: number | null;
  resume_url: string | null;
  cv_url: string | null;

  // Client specifics
  company_logo_url: string | null;
  report_header_text: string | null;
  report_footer_text: string | null;
  use_custom_branding: boolean | null;
  organization_id: string | null;

  // Counts of related rows (computed below)
  counts: {
    jobsAsClient: number;
    jobsAsInspector: number;
    applications: number;
    reviewsReceived: number;
    disputesOpened: number;
  };
}

export async function fetchAdminUserDetail(
  userId: string,
): Promise<AdminUserDetail | null> {
  try {
    const supabase = await createSupabaseServerClient();

    // Two-phase fetch: a small "definitely exists" core projection first,
    // then a wide projection. If the wide one fails (a column doesn't
    // exist on this deployment — e.g., admin-moderation columns added in
    // a later migration), we still return the row with whatever we got.
    //
    // This stops the page from showing "User not found" the moment one
    // optional column is missing.

    const { data: coreRow, error: coreErr } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, avatar_url, created_at')
      .eq('id', userId)
      .maybeSingle();

    if (coreErr || !coreRow) {
      if (coreErr && typeof console !== 'undefined') {
        console.warn('[fetchAdminUserDetail] core failed:', coreErr.message);
      }
      return null;
    }

    // Wide projection — every column that exists on profiles for the full UI.
    const WIDE_COLUMNS = [
      'id',
      'email',
      'full_name',
      'first_name',
      'last_name',
      'role',
      'avatar_url',
      'phone',
      'bio',
      'headline',
      'professional_title',
      'company_name',
      'location_city',
      'location_province',
      'location',
      'created_at',
      'updated_at',
      'last_active',
      'verification_status',
      'verified_at',
      'rejection_reason',
      'terms_accepted',
      'status',
      'suspension_reason',
      'suspended_at',
      'suspended_by',
      'balance_cents',
      'stripe_connect_id',
      'stripe_connect_status',
      'stripe_connect_payouts_enabled',
      'stripe_connect_onboarded_at',
      'rating_average',
      'rating_count',
      'reviews_count',
      'total_reviews',
      'recommend_percent',
      'completed_jobs_count',
      'total_jobs',
      'years_of_experience',
      'hourly_rate_cents',
      'response_time_hours',
      'specialty_slugs',
      'ndt_methods',
      'certifications',
      'travel_radius_km',
      'home_base_label',
      'country_of_residence',
      'work_authorized_countries',
      'open_to_sponsored_work',
      'sponsored_countries',
      'currency',
      'travel_rate_cents',
      'overtime_multiplier',
      'weekend_multiplier',
      'holiday_multiplier',
      'payment_terms',
      'minimum_engagement_hours',
      'resume_url',
      'cv_url',
      'company_logo_url',
      'report_header_text',
      'report_footer_text',
      'use_custom_branding',
      'organization_id',
    ];

    let wideRow: Record<string, unknown> | null = null;
    {
      const { data, error } = await supabase
        .from('profiles')
        .select(WIDE_COLUMNS.join(', '))
        .eq('id', userId)
        .maybeSingle();
      if (error) {
        if (typeof console !== 'undefined') {
          console.warn(
            '[fetchAdminUserDetail] wide projection failed (likely a missing column on this deployment), falling back to a narrower set:',
            error.message,
          );
        }
        // Narrower fallback — drop the columns that arrived in late migrations.
        const NARROW_COLUMNS = WIDE_COLUMNS.filter(
          (c) => !['suspension_reason', 'suspended_at', 'suspended_by'].includes(c),
        );
        const { data: data2, error: err2 } = await supabase
          .from('profiles')
          .select(NARROW_COLUMNS.join(', '))
          .eq('id', userId)
          .maybeSingle();
        if (err2) {
          if (typeof console !== 'undefined') {
            console.warn('[fetchAdminUserDetail] narrow projection also failed:', err2.message);
          }
        } else {
          wideRow = data2 as unknown as Record<string, unknown>;
        }
      } else {
        wideRow = data as unknown as Record<string, unknown>;
      }
    }

    // Merge core + wide so we always have something to render.
    const r = { ...(coreRow as Record<string, unknown>), ...(wideRow ?? {}) };

    // Count related rows — best-effort, each guarded so a missing table
    // doesn't break the page.
    const counts = {
      jobsAsClient: await countRows(supabase, 'jobs', { client_id: userId }),
      jobsAsInspector: await countRows(supabase, 'jobs', {
        contractor_id: userId,
      }),
      applications: await countRows(supabase, 'applications', {
        inspector_id: userId,
      }),
      reviewsReceived: await countRows(supabase, 'reviews', {
        reviewee_id: userId,
      }),
      // job_disputes is the canonical table and raised_by is its raiser column;
      // `disputes.opener_id` exists on neither, so this counted nothing.
      disputesOpened: await countRows(supabase, 'job_disputes', {
        raised_by: userId,
      }),
    };

    return {
      id: String(r.id),
      email: (r.email as string | null) ?? null,
      full_name: (r.full_name as string | null) ?? null,
      first_name: (r.first_name as string | null) ?? null,
      last_name: (r.last_name as string | null) ?? null,
      role: (r.role as string | null) ?? null,
      avatar_url: (r.avatar_url as string | null) ?? null,
      phone: (r.phone as string | null) ?? null,
      bio: (r.bio as string | null) ?? null,
      headline: (r.headline as string | null) ?? null,
      professional_title: (r.professional_title as string | null) ?? null,
      company_name: (r.company_name as string | null) ?? null,
      location_city: (r.location_city as string | null) ?? null,
      location_province: (r.location_province as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      created_at: (r.created_at as string | null) ?? null,
      updated_at: (r.updated_at as string | null) ?? null,
      last_active: (r.last_active as string | null) ?? null,
      verification_status: (r.verification_status as string | null) ?? null,
      verified_at: (r.verified_at as string | null) ?? null,
      rejection_reason: (r.rejection_reason as string | null) ?? null,
      terms_accepted: (r.terms_accepted as boolean | null) ?? null,
      status: (r.status as string | null) ?? null,
      suspension_reason: (r.suspension_reason as string | null) ?? null,
      suspended_at: (r.suspended_at as string | null) ?? null,
      suspended_by: (r.suspended_by as string | null) ?? null,
      balance_cents: numOrNull(r.balance_cents),
      stripe_connect_id: (r.stripe_connect_id as string | null) ?? null,
      stripe_connect_status: (r.stripe_connect_status as string | null) ?? null,
      stripe_connect_payouts_enabled:
        (r.stripe_connect_payouts_enabled as boolean | null) ?? null,
      stripe_connect_onboarded_at:
        (r.stripe_connect_onboarded_at as string | null) ?? null,
      rating_average: numOrNull(r.rating_average),
      rating_count: numOrNull(r.rating_count),
      reviews_count: numOrNull(r.reviews_count),
      total_reviews: numOrNull(r.total_reviews),
      recommend_percent: numOrNull(r.recommend_percent),
      completed_jobs_count: numOrNull(r.completed_jobs_count),
      total_jobs: numOrNull(r.total_jobs),
      years_of_experience: (r.years_of_experience as string | null) ?? null,
      hourly_rate_cents: numOrNull(r.hourly_rate_cents),
      response_time_hours: numOrNull(r.response_time_hours),
      specialty_slugs: arr(r.specialty_slugs),
      ndt_methods: arr(r.ndt_methods),
      certifications: arr(r.certifications),
      travel_radius_km: numOrNull(r.travel_radius_km),
      home_base_label: (r.home_base_label as string | null) ?? null,
      country_of_residence: (r.country_of_residence as string | null) ?? null,
      work_authorized_countries: arr(r.work_authorized_countries),
      open_to_sponsored_work: (r.open_to_sponsored_work as boolean | null) ?? null,
      sponsored_countries: arr(r.sponsored_countries),
      currency: (r.currency as string | null) ?? null,
      travel_rate_cents: numOrNull(r.travel_rate_cents),
      overtime_multiplier: numOrNull(r.overtime_multiplier),
      weekend_multiplier: numOrNull(r.weekend_multiplier),
      holiday_multiplier: numOrNull(r.holiday_multiplier),
      payment_terms: (r.payment_terms as string | null) ?? null,
      minimum_engagement_hours: numOrNull(r.minimum_engagement_hours),
      resume_url: (r.resume_url as string | null) ?? null,
      cv_url: (r.cv_url as string | null) ?? null,
      company_logo_url: (r.company_logo_url as string | null) ?? null,
      report_header_text: (r.report_header_text as string | null) ?? null,
      report_footer_text: (r.report_footer_text as string | null) ?? null,
      use_custom_branding: (r.use_custom_branding as boolean | null) ?? null,
      organization_id: (r.organization_id as string | null) ?? null,
      counts,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchAdminUserDetail] threw:', e);
    }
    return null;
  }
}

/* ─── helpers ──────────────────────────────────────────────────────── */

function arr(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function countRows(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string,
  filter: Record<string, string>,
): Promise<number> {
  try {
    let q = supabase.from(table).select('id', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(filter)) {
      q = q.eq(k, v);
    }
    const { count, error } = await q;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
