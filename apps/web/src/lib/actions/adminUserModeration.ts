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

// Open-redirect guard shared by every returnTo: must be an app-internal
// path ('/x'), never absolute ('https://…') or protocol-relative ('//host').
const ReturnToSchema = z
  .string()
  .min(1)
  .startsWith('/')
  .refine((v) => !v.startsWith('//'));

/** Same guard for the parse-failure fallback (raw FormData value). */
function safeReturnTo(raw: FormDataEntryValue | null): string {
  const v = typeof raw === 'string' ? raw : '';
  return v.startsWith('/') && !v.startsWith('//') ? v : '/admin/users';
}

/* ─── Verify / Reject / Mark pending ─────────────────────────────── */

const VerifySchema = z.object({
  userId: z.string().uuid(),
  status: z.enum(['verified', 'pending', 'rejected', 'unverified']),
  reason: z.string().trim().max(1000).optional().or(z.literal('')),
  returnTo: ReturnToSchema,
});

export async function adminVerifyUser(formData: FormData): Promise<void> {
  const parsed = VerifySchema.safeParse({
    userId: formData.get('userId'),
    status: formData.get('status'),
    reason: formData.get('reason') ?? '',
    returnTo: formData.get('returnTo'),
  });
  const fallback = safeReturnTo(formData.get('returnTo'));
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
  returnTo: ReturnToSchema,
});

export async function adminSuspendUser(formData: FormData): Promise<void> {
  const parsed = SuspendSchema.safeParse({
    userId: formData.get('userId'),
    reason: formData.get('reason'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = safeReturnTo(formData.get('returnTo'));
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
  returnTo: ReturnToSchema,
});

export async function adminUnsuspendUser(formData: FormData): Promise<void> {
  const parsed = UnsuspendSchema.safeParse({
    userId: formData.get('userId'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = safeReturnTo(formData.get('returnTo'));
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
  returnTo: ReturnToSchema,
});

export async function adminSendPasswordReset(formData: FormData): Promise<void> {
  const parsed = PasswordResetSchema.safeParse({
    userId: formData.get('userId'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = safeReturnTo(formData.get('returnTo'));
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

/* ─── Marketplace activation ─────────────────────────────────────── */
//  Distinct from adminVerifyUser above. `verification_status` records whether
//  someone's DOCUMENTS have been checked; `marketplace_activated` records
//  whether the account may TRADE. Migration 20260801584000 keeps them separate
//  deliberately: 3 inspectors, 1 agency and 1 supplier on Production are still
//  'unverified' while trading normally, so collapsing the two would have
//  locked live users out the moment the pending-verification policy shipped.
//
//  Verify the documents first, then activate. The RPC re-checks nx_is_admin()
//  server-side and writes an audit_events row either way, so this action is a
//  thin, auditable wrapper and never the security boundary itself.

const ActivationSchema = z.object({
  userId: z.string().uuid(),
  activated: z.enum(['true', 'false']),
  reason: z.string().trim().max(1000).optional().or(z.literal('')),
  returnTo: ReturnToSchema,
});

export async function adminSetMarketplaceActivation(formData: FormData): Promise<void> {
  const parsed = ActivationSchema.safeParse({
    userId: formData.get('userId'),
    activated: formData.get('activated'),
    reason: formData.get('reason') ?? '',
    returnTo: formData.get('returnTo'),
  });
  const fallback = safeReturnTo(formData.get('returnTo'));
  if (!parsed.success) {
    redirect(
      withQuery(fallback, {
        error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      }),
    );
  }
  const { userId, activated, reason, returnTo } = parsed.data;
  const activate = activated === 'true';

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_set_marketplace_activation', {
    p_user: userId,
    p_activated: activate,
    p_reason: reason || null,
  });
  if (error) {
    redirect(
      withQuery(returnTo, {
        error: `${activate ? 'Activation' : 'Deactivation'} failed: ${error.message}`,
      }),
    );
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { saved: activate ? 'account-activated' : 'account-deactivated' }));
}

/* ─── Role correction ─────────────────────────────────────────────────────
   Calls admin_change_user_role, a SECURITY DEFINER RPC that re-verifies
   nx_is_admin() and enforces the privilege rules server-side: elevated roles
   (admin / super_admin) may only be granted or removed by a caller who IS a
   super_admin, and nobody may change their own role. The list below is only
   what the UI offers — the database is the authority, so a hand-crafted
   request cannot widen it. */

const OPERATIONAL_ROLES = [
  'client',
  'inspector',
  'agency',
  'enterprise',
  'supplier',
  'senior',
] as const;

const ChangeRoleSchema = z.object({
  userId: z.string().uuid(),
  newRole: z.enum(OPERATIONAL_ROLES),
  reason: z.string().trim().max(1000).optional().or(z.literal('')),
  returnTo: ReturnToSchema,
});

export async function adminChangeUserRole(formData: FormData): Promise<void> {
  const parsed = ChangeRoleSchema.safeParse({
    userId: formData.get('userId'),
    newRole: formData.get('newRole'),
    reason: formData.get('reason') ?? '',
    returnTo: formData.get('returnTo'),
  });
  const fallback = safeReturnTo(formData.get('returnTo'));
  if (!parsed.success) {
    redirect(
      withQuery(fallback, {
        error: parsed.error.issues[0]?.message ?? 'Invalid role selection.',
      }),
    );
  }
  const { userId, newRole, reason, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_change_user_role', {
    p_user_id: userId,
    p_new_role: newRole,
    p_reason: reason || null,
  });
  if (error) {
    redirect(withQuery(returnTo, { error: `Role change failed: ${error.message}` }));
  }

  revalidatePath(returnTo);
  revalidatePath('/admin/users');
  redirect(withQuery(returnTo, { saved: `role-changed-to-${newRole}` }));
}

/* ─── Admin → user message ────────────────────────────────────────────────
   Calls admin_send_user_message, which appends to helpdesk_messages — the
   existing support thread keyed by user_id. The released mobile apps already
   read that table and subscribe to realtime INSERTs on it, so the message
   reaches the user without any app update. It is a support channel only and
   opens no client↔inspector path. */

const SendMessageSchema = z.object({
  userId: z.string().uuid(),
  message: z
    .string()
    .trim()
    .min(2, { message: 'Message needs at least 2 characters.' })
    .max(4000),
  returnTo: ReturnToSchema,
});

export async function adminSendUserMessage(formData: FormData): Promise<void> {
  const parsed = SendMessageSchema.safeParse({
    userId: formData.get('userId'),
    message: formData.get('message'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = safeReturnTo(formData.get('returnTo'));
  if (!parsed.success) {
    redirect(
      withQuery(fallback, {
        error: parsed.error.issues[0]?.message ?? 'Invalid message.',
      }),
    );
  }
  const { userId, message, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('admin_send_user_message', {
    p_user_id: userId,
    p_content: message,
  });
  if (error) {
    redirect(withQuery(returnTo, { error: `Message failed to send: ${error.message}` }));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { saved: 'message-sent' }));
}
