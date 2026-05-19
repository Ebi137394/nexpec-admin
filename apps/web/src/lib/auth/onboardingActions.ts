// ════════════════════════════════════════════════════════════════════════════
//  lib/auth/onboardingActions.ts — multi-step onboarding wizard backend
//
//  Three entry points, one shared payload:
//    • signUpWithProfileAndPassword — classic email+password
//    • signUpWithProfileAndOAuth    — Google OAuth (stashes profile in cookie)
//    • signUpWithProfileAndMagicLink — magic link email
//
//  All three:
//    1. Validate the payload (role + role-specific fields + terms accepted)
//    2. Persist the role-specific data into auth.users.raw_user_meta_data
//       (or a cookie, for OAuth) so the BEFORE INSERT trigger on profiles
//       can copy it onto the profile row.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ROLES = ['client', 'inspector', 'agency', 'enterprise'] as const;

const ProfileSchema = z.object({
  role: z.enum(ROLES),
  fullName: z.string().trim().min(2).max(120).optional().or(z.literal('')),
  contactPersonName: z.string().trim().min(2).max(120).optional().or(z.literal('')),
  companyName: z.string().trim().min(2).max(160).optional().or(z.literal('')),
  email: z.string().email().max(160),
  password: z
    .string()
    .min(10, { message: 'Use at least 10 characters.' })
    .max(72)
    .optional()
    .or(z.literal('')),
  specialtySlugs: z.array(z.string().trim().max(120)).max(300).default([]),
  termsAccepted: z.preprocess(
    (v) => v === 'on' || v === 'true' || v === true,
    z.literal(true, {
      message: 'You must accept the Terms of Service and Privacy Policy.',
    }),
  ),
});

const ONBOARD_COOKIE = 'nx_onboard';
const ONBOARD_COOKIE_MAX_AGE = 60 * 30; // 30 minutes

function destinationForRole(role: string): string {
  if (role === 'inspector') return '/inspector/dashboard';
  if (role === 'admin' || role === 'super_admin') return '/admin/dashboard';
  return '/client/dashboard';
}

function buildMeta(parsed: z.infer<typeof ProfileSchema>) {
  const fullName =
    parsed.role === 'inspector'
      ? parsed.fullName?.trim() || ''
      : (parsed.contactPersonName?.trim() ||
          parsed.fullName?.trim() ||
          '');
  return {
    full_name: fullName,
    onboarding_role: parsed.role,
    role: parsed.role,
    contact_person_name: parsed.contactPersonName?.trim() || null,
    company_name: parsed.companyName?.trim() || null,
    specialty_slugs:
      parsed.role === 'inspector' ? parsed.specialtySlugs : undefined,
    terms_accepted_at: new Date().toISOString(),
    terms_version: 'v1',
  } as Record<string, unknown>;
}

function readFormData(formData: FormData): unknown {
  return {
    role: formData.get('role'),
    fullName: formData.get('fullName') ?? '',
    contactPersonName: formData.get('contactPersonName') ?? '',
    companyName: formData.get('companyName') ?? '',
    email: formData.get('email'),
    password: formData.get('password') ?? '',
    specialtySlugs: formData.getAll('specialtySlugs').map(String),
    termsAccepted: formData.get('termsAccepted'),
  };
}

function backToWizardWithError(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `/sign-up?${qs}` : '/sign-up';
}

/* ─── 1) Email + password ────────────────────────────────────────────── */

export async function signUpWithProfileAndPassword(
  formData: FormData,
): Promise<void> {
  const parsed = ProfileSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
    redirect(backToWizardWithError({ error: msg }));
  }
  if (!parsed.data.password || parsed.data.password.length < 10) {
    redirect(
      backToWizardWithError({
        error: 'Password must be at least 10 characters.',
      }),
    );
  }
  const supabase = await createSupabaseServerClient();
  const { error, data } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: buildMeta(parsed.data),
      emailRedirectTo: process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
        : undefined,
    },
  });
  if (error) {
    redirect(backToWizardWithError({ error: error.message, email: parsed.data.email }));
  }

  // Email confirmation required → no session yet
  if (!data.session) {
    redirect(`/sign-up?pending=1&email=${encodeURIComponent(parsed.data.email)}`);
  }
  revalidatePath('/', 'layout');
  redirect(destinationForRole(parsed.data.role));
}

/* ─── 2) Magic link ──────────────────────────────────────────────────── */

export async function signUpWithProfileAndMagicLink(
  formData: FormData,
): Promise<void> {
  const parsed = ProfileSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
    redirect(backToWizardWithError({ error: msg }));
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      data: buildMeta(parsed.data),
      emailRedirectTo: process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
        : undefined,
      shouldCreateUser: true,
    },
  });
  if (error) {
    redirect(backToWizardWithError({ error: error.message, email: parsed.data.email }));
  }
  redirect(`/sign-up?pending=magic&email=${encodeURIComponent(parsed.data.email)}`);
}

/* ─── 3) Google OAuth ────────────────────────────────────────────────── */

export async function signUpWithProfileAndOAuth(formData: FormData): Promise<void> {
  const provider = String(formData.get('provider') ?? 'google').toLowerCase();
  if (provider !== 'google' && provider !== 'apple') {
    redirect(backToWizardWithError({ error: 'Unsupported provider.' }));
  }
  const parsed = ProfileSchema.safeParse(readFormData(formData));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input';
    redirect(backToWizardWithError({ error: msg }));
  }

  // Stash the onboarding payload in a short-lived cookie so /auth/callback
  // can apply it after the OAuth round-trip. OAuth providers strip arbitrary
  // query params, so the cookie is the only reliable carrier.
  const cookieStore = await cookies();
  cookieStore.set(
    ONBOARD_COOKIE,
    JSON.stringify(buildMeta(parsed.data)),
    {
      path: '/',
      maxAge: ONBOARD_COOKIE_MAX_AGE,
      sameSite: 'lax',
      httpOnly: true,
    },
  );

  const supabase = await createSupabaseServerClient();
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    'http://localhost:3000';

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as 'google' | 'apple',
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data?.url) {
    redirect(backToWizardWithError({ error: error?.message ?? 'OAuth provider unavailable.' }));
  }
  redirect(data.url);
}

/* ─── 4) Apply the cookie after OAuth callback ───────────────────────── */

/** Called from /auth/callback after the session is established. */
export async function applyOnboardingCookieToProfile(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(ONBOARD_COOKIE)?.value;
    if (!raw) return;
    cookieStore.delete(ONBOARD_COOKIE);

    const meta = JSON.parse(raw) as Record<string, unknown>;
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Best-effort merge into profiles. The BEFORE INSERT trigger covers new
    // users; existing rows just get the new metadata fields filled in.
    const update: Record<string, unknown> = {
      full_name: meta.full_name ?? undefined,
      role: meta.role ?? meta.onboarding_role ?? undefined,
      onboarding_role: meta.onboarding_role ?? undefined,
      company_name: meta.company_name ?? undefined,
      contact_person_name: meta.contact_person_name ?? undefined,
      terms_accepted_at: meta.terms_accepted_at ?? undefined,
      terms_version: meta.terms_version ?? undefined,
      specialty_slugs: meta.specialty_slugs ?? undefined,
      onboarding_completed_at: new Date().toISOString(),
    };
    Object.keys(update).forEach(
      (k) => update[k] === undefined && delete update[k],
    );
    await supabase.from('profiles').update(update).eq('id', user.id);
  } catch {
    /* ignore — onboarding cookie missing or malformed; fall through */
  }
}
