// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/adminUserModeration.ts — Verify, Reject, Suspend, Password reset
//
//  Three actions call SECURITY DEFINER RPCs that re-verify nx_is_admin() on
//  the DB side (defence in depth). One action — sendPasswordReset — uses
//  the Supabase Admin client with the SERVICE_ROLE_KEY because admin
//  password-reset is not exposed via RLS.
//
//  ENV REQUIRED:
//    SUPABASE_SERVICE_ROLE_KEY   server-only, never reaches the browser
//    NEXT_PUBLIC_SUPABASE_URL    public
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

/* ─── Verify / Reject / Mark pending ─────────────────────────────── */

const VerifySchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(['verified', 'pending', 'rejected', 'unverified']),
  reason: z.string().trim().max(1000).optional().or(z.literal('')),
  returnTo: z.string().min(1),
});

export async function adminVerifyUser(formData: FormData): Promise<void> {
  const parsed = VerifySchema.safeParse({
    userId: formData.get('userId'),
    status: formData.get('status'),
    reason: formData.get('reason') ?? '',
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/admin/users';
  if (!parsed.success) {
    redirect(
      withQuery(fallback, {
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      }),
    );
  }
  const { userId, status, reason, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_verify_user', {
    p_user_id: userId,
    p_status: status,
    p_reason: reason || null,
  });
  if (error) {
    redirect(withQuery(returnTo, { error: `Verification update failed: ${error.message}` }));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { saved: `verified-as-${status}` }));
}

/* ─── Suspend / Unsuspend ────────────────────────────────────────── */

const SuspendSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(5, { message: 'Reason needs at least 5 characters.' }).max(1000),
  returnTo: z.string().min(1),
});

export async function adminSuspendUser(formData: FormData): Promise<void> {
  const parsed = SuspendSchema.safeParse({
    userId: formData.get('userId'),
    reason: formData.get('reason'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/admin/users';
  if (!parsed.success) {
    redirect(
      withQuery(fallback, {
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      }),
    );
  }
  const { userId, reason, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_suspend_user', {
    p_user_id: userId,
    p_reason: reason,
  });
  if (error) {
    redirect(withQuery(returnTo, { error: `Suspend failed: ${error.message}` }));
  }
  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { saved: 'suspended' }));
}

const UnsuspendSchema = z.object({
  userId: z.string().uuid(),
  returnTo: z.string().min(1),
});

export async function adminUnsuspendUser(formData: FormData): Promise<void> {
  const parsed = UnsuspendSchema.safeParse({
    userId: formData.get('userId'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/admin/users';
  if (!parsed.success) redirect(withQuery(fallback, { error: 'Bad request.' }));
  const { userId, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_unsuspend_user', { p_user_id: userId });
  if (error) {
    redirect(withQuery(returnTo, { error: `Unsuspend failed: ${error.message}` }));
  }
  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { saved: 'unsuspended' }));
}

/* ─── Password reset (Supabase Admin API) ─────────────────────────── */

const PasswordResetSchema = z.object({
  userId: z.string().uuid(),
  returnTo: z.string().min(1),
});

export async function adminSendPasswordReset(formData: FormData): Promise<void> {
  const parsed = PasswordResetSchema.safeParse({
    userId: formData.get('userId'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/admin/users';
  if (!parsed.success) redirect(withQuery(fallback, { error: 'Bad request.' }));
  const { userId, returnTo } = parsed.data;

  // Caller must be admin. Verify via the regular client first.
  const supabase = await createSupabaseServerClient();
  const { data: isAdmin } = await supabase.rpc('nx_is_admin');
  if (!isAdmin) {
    redirect(withQuery(returnTo, { error: 'Admin only.' }));
  }

  // Look up the target's email
  const { data: prof, error: profErr } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (profErr || !prof || !(prof as { email?: string | null }).email) {
    redirect(withQuery(returnTo, { error: 'User email not found.' }));
  }
  const email = (prof as { email: string }).email;

  // Service-role client — never reaches the browser.
  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceUrl || !serviceKey) {
    redirect(
      withQuery(returnTo, {
        error:
          'Password reset misconfigured: SUPABASE_SERVICE_ROLE_KEY missing on the server.',
      }),
    );
  }
  const admin = createClient(serviceUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Trigger a recovery email. Supabase sends the email using its built-in
  // SMTP / configured provider. If you're not using built-in email, switch
  // to generateLink({ type: 'recovery', email }) and surface the link.
  const { error } = await admin.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://nexpecapp.com'}/auth/callback`,
  });
  if (error) {
    redirect(withQuery(returnTo, { error: `Reset failed: ${error.message}` }));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { saved: 'password-reset-sent' }));
}
