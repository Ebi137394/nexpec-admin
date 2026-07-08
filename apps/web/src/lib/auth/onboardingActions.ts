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

const ROLES = ['client', 'inspector', 'agency', 'enterprise', 'supplier'] as const;

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
  if (role === 'supplier') return '/suppliers/dashboard';
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
  if (provider !== 'google' && provider !== 'apple' && provider !== 'linkedin_oidc') {
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
    provider: provider as 'google' | 'apple' | 'linkedin_oidc',
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data?.url) {
    redirect(backToWizardWithError({ error: error?.message ?? 'OAuth provider unavailable.' }));
  }
  redirect(data.url);
}

/* ─── 4) Apply the cookie after OAuth callback ───────────────────────── */

/**
 * Result of applying the onboarding cookie. The callback uses
 * `appliedRole` to pick a destination — preferring this value over a
 * fresh profile re-read avoids a tiny but real race where the cookie
 * UPSERT and the destination resolver read different rows from
 * different replicas.
 */
export interface ApplyOnboardingResult {
  appliedRole: string | null;
  error: string | null;
}

/**
 * Called from /auth/callback after the session is established.
 *
 * Why this is an RPC (apply_onboarding_role) instead of a plain UPDATE:
 *
 * The old implementation did `supabase.from('profiles').update({ role }).eq('id', uid)`.
 * That call ran with the user's JWT and was silently filtered out by the
 * column-level RLS lockdown on `profiles.role` (only admins can flip
 * role). The UPDATE returned success with 0 rows affected and no error,
 * so the bug was completely invisible until users noticed they kept
 * landing on the wrong portal.
 *
 * The RPC runs SECURITY DEFINER, enforces the role allow-list and the
 * one-way "no demoting an admin/inspector via signup" guard inside the
 * function body, and returns the final canonical role so the callback
 * can route on first-paint without a second profile fetch.
 *
 * The migration that ships this RPC is
 * supabase/migrations/20260519010000_apply_onboarding_role_rpc.sql.
 */
export async function applyOnboardingCookieToProfile(): Promise<ApplyOnboardingResult> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ONBOARD_COOKIE)?.value;
  if (!raw) return { appliedRole: null, error: null };

  // Always clear the cookie — whether the apply succeeds or fails, we
  // don't want the stale payload reapplied on a subsequent visit.
  cookieStore.delete(ONBOARD_COOKIE);

  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error('[applyOnboardingCookieToProfile] cookie JSON parse failed:', err);
    return { appliedRole: null, error: 'Onboarding cookie was malformed.' };
  }

  const role =
    (typeof meta.role === 'string' && meta.role) ||
    (typeof meta.onboarding_role === 'string' && meta.onboarding_role) ||
    null;
  if (!role) {
    return { appliedRole: null, error: 'Onboarding cookie missing role.' };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { appliedRole: null, error: 'No authenticated user at callback.' };
  }

  // Retry briefly to absorb the race window between auth.users INSERT and
  // the BEFORE INSERT trigger on profiles completing on the read replica.
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase.rpc('apply_onboarding_role', {
      p_role: role,
      p_full_name: (meta.full_name as string | undefined) ?? null,
      p_company_name: (meta.company_name as string | undefined) ?? null,
      p_contact_person_name: (meta.contact_person_name as string | undefined) ?? null,
      p_specialty_slugs:
        (meta.specialty_slugs as string[] | undefined) ?? null,
      p_terms_accepted_at:
        (meta.terms_accepted_at as string | undefined) ?? null,
      p_terms_version: (meta.terms_version as string | undefined) ?? null,
    });

    if (!error && data) {
      const row = Array.isArray(data)
        ? (data[0] as { applied_role?: string } | undefined)
        : (data as { applied_role?: string });
      const appliedRole = row?.applied_role ?? role;
      return { appliedRole, error: null };
    }

    lastError = error?.message ?? 'Unknown RPC error';
    // Linear backoff — 200ms, 400ms — capped at 2 retries.
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }

  console.error(
    '[applyOnboardingCookieToProfile] apply_onboarding_role failed after 3 attempts:',
    lastError,
  );
  return { appliedRole: null, error: lastError };
}
