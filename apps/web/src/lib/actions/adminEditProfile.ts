// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/adminEditProfile.ts — Admin-assisted profile completion
//
//  WHY THIS EXISTS
//  ───────────────
//  Users routinely send their details to NEXPEC by email, phone or Help &
//  Support rather than typing them into the app. Before this action there was
//  no way to record them: the profile stayed empty, onboarding kept nagging,
//  and the inspector stayed invisible to the marketplace.
//
//  SECURITY MODEL — enforced by CONSTRUCTION, not by validation
//  ────────────────────────────────────────────────────────────
//  The UPDATE object is assembled field-by-field from `parsed.data` for the
//  ONE requested section. There is no spread of user input anywhere, so a
//  column that is not in a section's allowlist is unreachable no matter what
//  the client posts. In particular this action can NEVER write:
//
//      role, verification_status, is_verified, verified_at, verified_by,
//      status, suspended_*, balance_cents, stripe_connect_*,
//      marketplace_activated*, deleted_at, anonymized_at, email, id
//
//  Marking a credential verified is deliberately absent: verification lives
//  in the credential-review path, and a generic profile edit must never be
//  able to assert that someone's certification was reviewed.
//
//  Every successful edit writes an audit_events row carrying the before/after
//  delta and the stated reason, then tells the user in their canonical Help &
//  Support thread. The subject's user id never changes.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Sections map 1:1 to the cards in the Admin editor.
//
// NOT exported: a 'use server' module may only export async functions, so a
// const or type export here fails the build with
// "A 'use server' file can only export async functions, found object."
const ADMIN_EDIT_SECTIONS = [
  'contact',
  'professional',
  'skills',
  'rates',
  'work_auth',
] as const;
type AdminEditSection = (typeof ADMIN_EDIT_SECTIONS)[number];

const AVAILABILITY_VALUES = ['offline', 'available', 'busy'] as const;

const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional(),
  );

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.coerce.number().finite().min(min).max(max).optional(),
  );

/**
 * Comma / newline separated free text → a clean array. Used for the array
 * columns so an admin can paste straight out of an email.
 */
function toArray(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 120),
    ),
  ).slice(0, 300);
}

const Schema = z.object({
  userId: z.string().uuid(),
  section: z.enum(ADMIN_EDIT_SECTIONS),
  reason: optionalText(500),
  notifyUser: z.coerce.boolean().optional(),

  // contact
  fullName: optionalText(160),
  phone: optionalText(40),
  location: optionalText(200),
  locationCity: optionalText(120),
  locationProvince: optionalText(120),
  countryOfResidence: optionalText(2),
  companyName: optionalText(160),
  contactPersonName: optionalText(200),

  // professional
  professionalTitle: optionalText(120),
  headline: optionalText(140),
  bio: optionalText(2000),
  yearsOfExperience: optionalText(20),
  homeBaseLabel: optionalText(160),

  // skills (free-text lists)
  specialtySlugs: z.string().optional(),
  ndtMethods: z.string().optional(),
  customSpecialties: z.string().optional(),
  skills: z.string().optional(),

  // rates
  hourlyRateDollars: optionalNumber(0, 10_000),
  travelRateDollars: optionalNumber(0, 10_000),
  currency: optionalText(3),
  minimumEngagementHours: optionalNumber(0, 999),
  travelRadiusKm: optionalNumber(0, 20_000),
  availabilityStatus: z.enum(AVAILABILITY_VALUES).optional(),

  // work authorisation
  workAuthorizedCountries: z.string().optional(),
});

/** Columns an admin may set, per section. Nothing outside these is reachable. */
type UpdateShape = Record<string, string | number | boolean | string[] | null>;

function buildUpdate(
  section: AdminEditSection,
  d: z.infer<typeof Schema>,
): UpdateShape {
  const u: UpdateShape = {};
  const put = (col: string, val: string | number | string[] | undefined) => {
    if (val === undefined) return;
    // An explicitly cleared text box means "remove this value".
    u[col] = typeof val === 'string' && val.trim() === '' ? null : val;
  };

  switch (section) {
    case 'contact':
      put('full_name', d.fullName);
      put('phone', d.phone);
      put('location', d.location);
      put('location_city', d.locationCity);
      put('location_province', d.locationProvince);
      put('country_of_residence', d.countryOfResidence?.toUpperCase());
      put('company_name', d.companyName);
      // Captured at signup and read by the onboarding checklist, but with NO
      // post-signup write surface anywhere — so a client whose contact name was
      // missing could never clear that checklist step. Admin can now set it.
      put('contact_person_name', d.contactPersonName);
      break;

    case 'professional':
      // Write BOTH title columns. `professional_title` is the canonical one
      // the web app and Admin read; `title` is what the mobile profile editor
      // reads back. Writing one only would make the value vanish on the other
      // surface — the exact split-brain this whole incident came from.
      put('professional_title', d.professionalTitle);
      put('title', d.professionalTitle);
      put('headline', d.headline);
      put('bio', d.bio);
      put('years_of_experience', d.yearsOfExperience);
      put('home_base_label', d.homeBaseLabel);
      break;

    case 'skills':
      if (d.specialtySlugs !== undefined) u.specialty_slugs = toArray(d.specialtySlugs);
      if (d.ndtMethods !== undefined) u.ndt_methods = toArray(d.ndtMethods);
      if (d.customSpecialties !== undefined)
        u.custom_specialties = toArray(d.customSpecialties);
      if (d.skills !== undefined) u.skills = toArray(d.skills);
      break;

    case 'rates':
      if (d.hourlyRateDollars !== undefined)
        u.hourly_rate_cents = Math.round(d.hourlyRateDollars * 100);
      if (d.travelRateDollars !== undefined)
        u.travel_rate_cents = Math.round(d.travelRateDollars * 100);
      put('currency', d.currency?.toUpperCase());
      if (d.minimumEngagementHours !== undefined)
        u.minimum_engagement_hours = d.minimumEngagementHours;
      if (d.travelRadiusKm !== undefined) u.travel_radius_km = d.travelRadiusKm;
      put('availability_status', d.availabilityStatus);
      break;

    case 'work_auth':
      if (d.workAuthorizedCountries !== undefined)
        u.work_authorized_countries = toArray(d.workAuthorizedCountries).map((c) =>
          c.toUpperCase(),
        );
      break;
  }
  return u;
}

/** Human label for the audit summary and the user-facing notice. */
const SECTION_LABEL: Record<AdminEditSection, string> = {
  contact: 'contact details',
  professional: 'professional profile',
  skills: 'specialties and skills',
  rates: 'rates and availability',
  work_auth: 'work authorisation',
};

export async function adminUpdateUserProfile(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = Schema.safeParse(raw);

  const userIdRaw = typeof raw.userId === 'string' ? raw.userId : '';
  const back = (q: Record<string, string>) => {
    const sp = new URLSearchParams(q);
    return `/admin/users/${userIdRaw}?${sp.toString()}`;
  };

  if (!parsed.success) {
    redirect(back({ error: parsed.error.issues[0]?.message ?? 'Invalid input.' }));
  }
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: isAdmin } = await supabase.rpc('nx_is_admin');
  if (!isAdmin) redirect('/');

  const update = buildUpdate(d.section, d);
  if (Object.keys(update).length === 0) {
    redirect(back({ error: 'Nothing to change in that section.' }));
  }

  // Read the current values so the audit row can carry a real before/after.
  const columns = Object.keys(update);
  const { data: before } = await supabase
    .from('profiles')
    .select(['id', ...columns].join(', '))
    .eq('id', d.userId)
    .maybeSingle();

  if (!before) {
    redirect(back({ error: 'That user no longer exists.' }));
  }

  update.updated_at = new Date().toISOString();

  // `.select('id')` is required: PostgREST reports a zero-row UPDATE as a
  // success, so without it an RLS refusal would be announced to the admin —
  // and to the user — as a completed edit.
  const { data: updatedRows, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', d.userId)
    .select('id');

  if (error) {
    if (typeof console !== 'undefined') {
      console.error('[adminUpdateUserProfile] failed', {
        code: error.code,
        message: error.message,
      });
    }
    redirect(back({ error: `Could not save: ${error.message}` }));
  }
  if (!updatedRows || updatedRows.length === 0) {
    redirect(
      back({ error: 'No record was updated. Nothing was changed.' }),
    );
  }

  // ── Provenance ──────────────────────────────────────────────────────────
  // The column list is built at runtime, so PostgREST's generated types
  // cannot narrow it; go through `unknown` deliberately.
  const beforeRow = before as unknown as Record<string, unknown>;
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const col of columns) {
    const from = beforeRow[col] ?? null;
    const to = update[col] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changed[col] = { from, to };
    }
  }

  await supabase.from('audit_events').insert({
    event_type: 'admin_user.profile_edited',
    severity: 'warning',
    actor_id: user.id,
    subject_table: 'profiles',
    subject_id: d.userId,
    summary: `Admin updated ${SECTION_LABEL[d.section]} on behalf of the user.`,
    delta: changed,
    metadata: {
      section: d.section,
      reason: d.reason ?? null,
      source: 'admin_assisted',
      fields_changed: Object.keys(changed),
    },
  });

  // ── Tell the user ───────────────────────────────────────────────────────
  // Only when something actually changed; a no-op edit must not generate a
  // support message.
  if (d.notifyUser && Object.keys(changed).length > 0) {
    await supabase.rpc('nx_admin_notify_profile_edit', {
      p_user_id: d.userId,
      p_summary: `we updated your ${SECTION_LABEL[d.section]}${
        d.reason ? ` (${d.reason})` : ''
      }.`,
    });
  }

  revalidatePath(`/admin/users/${d.userId}`);
  revalidatePath('/inspector/settings');
  revalidatePath('/client/settings');
  redirect(back({ saved: '1' }));
}
