// ════════════════════════════════════════════════════════════════════════════
//  lib/auth/actions.ts — Server Actions for sign-in / sign-up / sign-out
//
//  Own-Your-Form strategy: no Supabase Auth UI library. Forms POST to these
//  actions, errors come back through `redirect(...)` with a search-param so
//  the page can re-render with the message inline. Cookies are persisted by
//  @supabase/ssr automatically — caller doesn't manage them.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { z } from 'zod';

/* ─── Schemas ────────────────────────────────────────────────────────── */

const SignInSchema = z.object({
  email: z.string().email({ message: 'Enter a valid email address.' }),
  password: z.string().min(1, { message: 'Password is required.' }),
  next: z.string().optional(),
});

/**
 * Roles a public signup form is allowed to set. `super_admin` and
 * `enterprise` are NOT in this list — those are administered out-of-band
 * by an existing operator. If an unknown role arrives, we fall through
 * to the default 'client'.
 */
const PUBLIC_SIGNUP_ROLES = ['client', 'inspector', 'agency', 'enterprise'] as const;

const SignUpSchema = z.object({
  email: z.string().email({ message: 'Enter a valid email address.' }),
  password: z
    .string()
    .min(10, { message: 'Use at least 10 characters.' })
    .max(72, { message: 'Password is too long.' }),
  fullName: z
    .string()
    .trim()
    .min(2, { message: 'Tell us your name.' })
    .max(80, { message: 'Name is too long.' }),
  role: z
    .enum(PUBLIC_SIGNUP_ROLES)
    .optional()
    .default('client'),
});

/* ─── Helpers ────────────────────────────────────────────────────────── */

/**
 * Resolve the post-sign-in destination by role.
 * Admins land in the console; everyone else lands on the marketing root
 * (the web client product surfaces are scaffolded in later sprints).
 */
async function destinationForUser(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return '/';

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const normalisedRole = (profile?.role ?? '').toString().trim().toLowerCase();
  if (normalisedRole === 'super_admin' || normalisedRole === 'admin') return '/admin/dashboard';
  if (normalisedRole === 'inspector') return '/inspector/dashboard';
  // client / agency / enterprise all share the same Client Portal — the
  // surface is UI-identical, data isolation is enforced by client_id = uid().
  if (
    normalisedRole === 'client' ||
    normalisedRole === 'agency' ||
    normalisedRole === 'enterprise'
  ) {
    return '/client/dashboard';
  }
  return '/';
}

function buildErrorRedirect(base: string, message: string, fields?: Record<string, string>) {
  const params = new URLSearchParams({ error: message });
  if (fields?.email) params.set('email', fields.email);
  return `${base}?${params.toString()}`;
}

/* ─── signIn ─────────────────────────────────────────────────────────── */

export async function signIn(formData: FormData) {
  const parsed = SignInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid sign-in input.';
    redirect(buildErrorRedirect('/sign-in', msg));
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    redirect(
      buildErrorRedirect('/sign-in', error.message, { email: parsed.data.email }),
    );
  }

  // Role-aware destination, unless caller asked for a specific path.
  const dest =
    parsed.data.next && parsed.data.next.startsWith('/')
      ? parsed.data.next
      : await destinationForUser(supabase);

  revalidatePath('/', 'layout');
  redirect(dest);
}

/* ─── signUp ─────────────────────────────────────────────────────────── */

export async function signUp(formData: FormData) {
  const parsed = SignUpSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    fullName: formData.get('fullName'),
    // `role` arrives from the hidden field populated by ?role= search-param
    // on /sign-up. Unknown values fall through to the schema default ('client').
    role: formData.get('role') ?? undefined,
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid sign-up input.';
    redirect(buildErrorRedirect('/sign-up', msg));
  }

  const supabase = await createSupabaseServerClient();
  const { error, data } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: {
        full_name: parsed.data.fullName,
        // Stored in auth.users.raw_user_meta_data. The Supabase trigger that
        // creates the profiles row should pick this up; if not, an operator
        // can elevate the user via the admin Users surface.
        role: parsed.data.role,
      },
      // After email confirmation, Supabase redirects here.
      emailRedirectTo: process.env.NEXT_PUBLIC_SITE_URL
        ? `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
        : undefined,
    },
  });

  if (error) {
    redirect(
      buildErrorRedirect('/sign-up', error.message, { email: parsed.data.email }),
    );
  }

  // If the project requires email confirmation, no session is created yet.
  if (!data.session) {
    redirect('/sign-up?pending=1&email=' + encodeURIComponent(parsed.data.email));
  }

  revalidatePath('/', 'layout');
  redirect(await destinationForUser(supabase));
}

/* ─── signOut ────────────────────────────────────────────────────────── */

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/sign-in');
}

/* ─── signInWithOAuth ────────────────────────────────────────────────── */

export async function signInWithOAuth(formData: FormData) {
  const provider = String(formData.get('provider') ?? '').toLowerCase();
  if (provider !== 'google' && provider !== 'apple') {
    redirect(buildErrorRedirect('/sign-in', 'Unsupported OAuth provider.'));
  }

  const supabase = await createSupabaseServerClient();

  // ── Origin resolution for the OAuth `redirectTo` ─────────────────
  // Precedence:
  //   1. NEXT_PUBLIC_SITE_URL (explicit production / preview override)
  //   2. VERCEL_URL (auto-injected on Vercel deploys, no protocol)
  //   3. localhost fallback for `yarn dev:web`
  // The provider needs an absolute https URL it can route back to.
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    'http://localhost:3000';

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider as 'google' | 'apple',
    options: {
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error || !data?.url) {
    redirect(
      buildErrorRedirect(
        '/sign-in',
        error?.message ?? 'OAuth provider unavailable.',
      ),
    );
  }

  redirect(data.url);
}
