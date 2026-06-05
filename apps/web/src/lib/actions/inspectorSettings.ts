// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/inspectorSettings.ts — update inspector profile
//
//  STRICT FIELD ALLOWLIST. The action ONLY accepts the inspector-editable
//  subset of profiles columns. Admin-controlled columns (verification_*,
//  balance_*, stripe_connect_*, completed_jobs_count, rating_*, role)
//  are never read from formData and never written.
//
//  Even if a malicious actor submits extra form fields with those names,
//  the Zod schema strips them; the UPDATE object is constructed from
//  parsed.data only.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PAYMENT_TERMS } from '@/lib/data/inspectorProfile.types';

const AVAILABILITY_VALUES = ['offline', 'available', 'busy'] as const;

// ── Rich rates (Sprint 11) ────────────────────────────────────────────────
// Multipliers are NUMERIC(4,2) in DB, banded 1.00–5.00 by CHECK.
// payment_terms enum mirrors the DB-side CHECK.
const optionalDecimal = (min: number, max: number) =>
  z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce
        .number({ message: 'Must be a number.' })
        .finite()
        .min(min)
        .max(max)
        .optional(),
    )
    .optional();

const optionalInt = (min: number, max: number) =>
  z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce
        .number({ message: 'Must be a whole number.' })
        .int()
        .min(min)
        .max(max)
        .optional(),
    )
    .optional();

const UpdateInspectorSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, { message: 'Tell us your name.' })
    .max(80, { message: 'Name is too long.' }),
  headline: z.string().trim().max(140).optional().or(z.literal('')),
  professionalTitle: z.string().trim().max(120).optional().or(z.literal('')),
  bio: z.string().trim().max(2000).optional().or(z.literal('')),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  yearsOfExperience: z.string().trim().max(20).optional().or(z.literal('')),
  hourlyRateDollars: z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce
        .number({ message: 'Rate must be a number.' })
        .int({ message: 'Whole dollars only.' })
        .min(0, { message: 'Rate cannot be negative.' })
        .max(10_000, { message: 'Rate exceeds the cap.' })
        .optional(),
    )
    .optional(),
  responseTimeHours: z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce
        .number({ message: 'Hours must be a number.' })
        .int()
        .min(1)
        .max(168) // 1 week
        .optional(),
    )
    .optional(),
  locationCity: z.string().trim().max(120).optional().or(z.literal('')),
  locationProvince: z.string().trim().max(120).optional().or(z.literal('')),
  travelRadiusKm: z
    .preprocess(
      (v) => (v === '' || v === null || v === undefined ? undefined : v),
      z.coerce
        .number({ message: 'Radius must be a number.' })
        .int()
        .min(1)
        .max(20_000)
        .optional(),
    )
    .optional(),
  availabilityStatus: z.enum(AVAILABILITY_VALUES).optional(),
  isAvailable: z
    .preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())
    .optional(),
  // Specialty slugs + NDT methods arrive as repeated form fields.
  // 300-cap because the curated taxonomy alone has 200+ items, and the
  // custom-add text input may push the total higher.
  specialtySlugs: z.array(z.string().trim().min(1).max(120)).max(300).default([]),
  ndtMethods: z.array(z.string().trim().min(1).max(120)).max(200).default([]),
  // Free-form overflow inputs — comma-separated strings parsed below.
  customSpecialties: z.string().trim().max(4000).optional().or(z.literal('')),
  customNdtMethods: z.string().trim().max(4000).optional().or(z.literal('')),
  // Certifications: comma-separated string parsed into an array (MVP).
  certifications: z.string().trim().max(4000).optional().or(z.literal('')),

  // ── JURISDICTION (Sprint 8A) — parity with mobile profile/edit ────────
  // FK to country_codes.code; profiles_country_of_residence_fk RESTRICTs
  // on delete so an unknown code raises a clean violation.
  countryOfResidence: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, { message: 'Country code must be ISO 3166-1 alpha-2.' })
    .optional()
    .or(z.literal('')),
  // 60-item caps mirror profiles_work_authorized_countries_cap and
  // profiles_sponsored_countries_cap CHECK constraints.
  workAuthorizedCountries: z
    .array(z.string().trim().toUpperCase().length(2))
    .max(60)
    .default([]),
  openToSponsoredWork: z
    .preprocess(
      (v) => v === 'on' || v === 'true' || v === true,
      z.boolean(),
    )
    .default(false),
  sponsoredCountries: z
    .array(z.string().trim().toUpperCase().length(2))
    .max(60)
    .default([]),

  // ── Rich rates (Sprint 11) ─────────────────────────────────────────
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, { message: 'Use 3-letter ISO currency code.' })
    .optional()
    .or(z.literal('')),
  travelRateDollars: optionalInt(0, 10_000),
  overtimeMultiplier: optionalDecimal(1, 5),
  weekendMultiplier: optionalDecimal(1, 5),
  holidayMultiplier: optionalDecimal(1, 5),
  paymentTerms: z.enum(PAYMENT_TERMS).optional(),
  minimumEngagementHours: optionalInt(1, 240),
});

function buildRedirect(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/inspector/settings?${qs}` : '/inspector/settings';
}

export async function updateInspectorSettings(
  formData: FormData,
): Promise<void> {
  const specialtySlugs = formData.getAll('specialtySlugs').map(String);
  const ndtMethods = formData.getAll('ndtMethods').map(String);
  // CountryMultiSelect emits one hidden input per selected code with the
  // shared field name; getAll() returns the array we expect.
  const workAuthorizedCountries = formData
    .getAll('workAuthorizedCountries')
    .map(String)
    .filter((s) => s.length > 0);
  const sponsoredCountries = formData
    .getAll('sponsoredCountries')
    .map(String)
    .filter((s) => s.length > 0);

  const parsed = UpdateInspectorSchema.safeParse({
    fullName: formData.get('fullName'),
    headline: formData.get('headline'),
    professionalTitle: formData.get('professionalTitle'),
    bio: formData.get('bio'),
    phone: formData.get('phone'),
    yearsOfExperience: formData.get('yearsOfExperience'),
    hourlyRateDollars: formData.get('hourlyRateDollars'),
    responseTimeHours: formData.get('responseTimeHours'),
    locationCity: formData.get('locationCity'),
    locationProvince: formData.get('locationProvince'),
    travelRadiusKm: formData.get('travelRadiusKm'),
    availabilityStatus: formData.get('availabilityStatus') ?? undefined,
    isAvailable: formData.get('isAvailable'),
    specialtySlugs,
    ndtMethods,
    customSpecialties: formData.get('customSpecialties') ?? '',
    customNdtMethods: formData.get('customNdtMethods') ?? '',
    certifications: formData.get('certifications'),
    countryOfResidence: formData.get('countryOfResidence') ?? '',
    workAuthorizedCountries,
    openToSponsoredWork: formData.get('openToSponsoredWork'),
    sponsoredCountries,
    // Sprint 11 — rich rates
    currency: formData.get('currency') ?? '',
    travelRateDollars: formData.get('travelRateDollars'),
    overtimeMultiplier: formData.get('overtimeMultiplier'),
    weekendMultiplier: formData.get('weekendMultiplier'),
    holidayMultiplier: formData.get('holidayMultiplier'),
    paymentTerms: formData.get('paymentTerms') ?? undefined,
    minimumEngagementHours: formData.get('minimumEngagementHours'),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not save, check the form.';
    redirect(buildRedirect({ error: msg }));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent('/inspector/settings'));
  }

  // Parse certifications: comma-separated string → trimmed array.
  const certsArr = (parsed.data.certifications ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 200)
    .slice(0, 40);

  // Merge curated checkbox slugs with free-form custom entries.
  // Custom entries are slugified (lowercase, kebab-case) so they fit
  // the same `specialty_slugs` text[] as the curated taxonomy.
  function toSlug(s: string): string {
    return s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 120);
  }
  function splitCsv(s: string | undefined | null): string[] {
    if (!s) return [];
    return s
      .split(',')
      .map(toSlug)
      .filter((v) => v.length > 0);
  }
  const mergedSpecialties = Array.from(
    new Set([...parsed.data.specialtySlugs, ...splitCsv(parsed.data.customSpecialties)]),
  ).slice(0, 300);
  const mergedNdtMethods = Array.from(
    new Set([...parsed.data.ndtMethods, ...splitCsv(parsed.data.customNdtMethods)]),
  ).slice(0, 200);

  // STRICT ALLOWLIST. Never expand this object with admin-controlled columns.
  // Form fields not in parsed.data are stripped by Zod, but the explicit
  // construction here is the second line of defense.
  // De-dupe + cap jurisdiction arrays defensively. Zod already enforces
  // the 60-item ceiling, but Set dedup is cheap insurance.
  const dedupedAuth = Array.from(new Set(parsed.data.workAuthorizedCountries)).slice(0, 60);
  const dedupedSponsored = parsed.data.openToSponsoredWork
    ? Array.from(new Set(parsed.data.sponsoredCountries)).slice(0, 60)
    : []; // Clear sponsored list when toggle is off — matches mobile behaviour.

  const update: Record<string, unknown> = {
    full_name: parsed.data.fullName,
    headline: parsed.data.headline?.trim() || null,
    professional_title: parsed.data.professionalTitle?.trim() || null,
    bio: parsed.data.bio?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
    years_of_experience: parsed.data.yearsOfExperience?.trim() || null,
    hourly_rate_cents:
      parsed.data.hourlyRateDollars !== undefined
        ? parsed.data.hourlyRateDollars * 100
        : null,
    response_time_hours: parsed.data.responseTimeHours ?? null,
    location_city: parsed.data.locationCity?.trim() || null,
    location_province: parsed.data.locationProvince?.trim() || null,
    travel_radius_km: parsed.data.travelRadiusKm ?? null,
    availability_status: parsed.data.availabilityStatus ?? 'offline',
    is_available: parsed.data.isAvailable ?? true,
    specialty_slugs: mergedSpecialties,
    ndt_methods: mergedNdtMethods,
    certifications: certsArr,
    // ── Jurisdiction (Sprint 8A) ────────────────────────────────────────
    country_of_residence: parsed.data.countryOfResidence?.trim() || null,
    work_authorized_countries: dedupedAuth,
    open_to_sponsored_work: parsed.data.openToSponsoredWork,
    sponsored_countries: dedupedSponsored,
    // ── Rich rates (Sprint 11) ──────────────────────────────────────────
    currency: parsed.data.currency?.trim() || 'USD',
    travel_rate_cents:
      parsed.data.travelRateDollars !== undefined
        ? parsed.data.travelRateDollars * 100
        : null,
    overtime_multiplier: parsed.data.overtimeMultiplier ?? null,
    weekend_multiplier: parsed.data.weekendMultiplier ?? null,
    holiday_multiplier: parsed.data.holidayMultiplier ?? null,
    payment_terms: parsed.data.paymentTerms ?? null,
    minimum_engagement_hours: parsed.data.minimumEngagementHours ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', user.id);

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[updateInspectorSettings] failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(
      buildRedirect({
        error:
          error.message?.includes('check') || error.message?.includes('constraint')
            ? 'A value failed validation. Check phone format, country codes, and arrays.'
            : 'Could not save profile. Try again or contact support.',
      }),
    );
  }

  revalidatePath('/inspector/settings');
  revalidatePath('/inspector/compliance');
  revalidatePath('/inspector/wallet');
  revalidatePath('/inspector', 'layout'); // refresh Header userLabel
  redirect(buildRedirect({ saved: '1' }));
}
