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

const AVAILABILITY_VALUES = ['offline', 'available', 'busy'] as const;

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
  specialtySlugs: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  ndtMethods: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  // Certifications: comma-separated string parsed into an array (MVP).
  certifications: z.string().trim().max(4000).optional().or(z.literal('')),
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
    certifications: formData.get('certifications'),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not save — check the form.';
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

  // STRICT ALLOWLIST. Never expand this object with admin-controlled columns.
  // Form fields not in parsed.data are stripped by Zod, but the explicit
  // construction here is the second line of defense.
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
    specialty_slugs: parsed.data.specialtySlugs,
    ndt_methods: parsed.data.ndtMethods,
    certifications: certsArr,
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
