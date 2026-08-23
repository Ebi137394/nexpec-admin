// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/accountDeletion.ts — public account-deletion request intake
//
//  WHY THIS EXISTS SEPARATELY FROM /account/delete
//  ------------------------------------------------
//  /account/delete is the in-app, authenticated flow: it verifies the session
//  and deletes immediately. App-store policy additionally requires a deletion
//  route reachable WITHOUT signing in (users who lost access, or who are
//  reviewing the policy before installing). This action backs that public page.
//
//  STORAGE
//  -------
//  Requests land in contact_submissions — the same table the public /contact
//  form uses, which already carries an anon-insert policy. `channel` has a DB
//  CHECK constraint (sales | support | security), so deletion requests route to
//  'support', where operators already triage this queue, and the account type
//  plus an explicit marker are recorded in the message body. No schema, RLS or
//  constraint change is required for this feature.
// ════════════════════════════════════════════════════════════════════════════
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const DeletionSchema = z.object({
  email: z.string().email({ message: 'Enter a valid email address.' }),
  // Every non-admin role in profiles.role's CHECK constraint. Admin and
  // super_admin are intentionally excluded: internal staff accounts are
  // removed through internal offboarding, not this public form.
  accountType: z.enum(
    ['inspector', 'senior', 'client', 'agency', 'enterprise', 'supplier'],
    { message: 'Choose your account type.' },
  ),
  message: z.string().trim().max(2000, { message: 'Message is too long.' }).optional(),
});

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  inspector: 'Inspector',
  senior: 'Senior Inspector',
  client: 'Client',
  agency: 'Agency',
  enterprise: 'Enterprise',
  supplier: 'Supplier',
};

function buildRedirect(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${path}?${qs}` : path;
}

export async function submitAccountDeletion(formData: FormData): Promise<void> {
  const parsed = DeletionSchema.safeParse({
    email: formData.get('email'),
    accountType: formData.get('accountType'),
    message: formData.get('message') || undefined,
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not send. Check the form.';
    redirect(buildRedirect('/account-deletion', { error: msg }));
  }

  const { email, accountType, message } = parsed.data;

  // Request metadata: retained with the request so operators can verify the
  // origin of a deletion request before acting on it.
  const h = await headers();
  const userAgent = h.get('user-agent')?.slice(0, 500) ?? null;
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip')?.trim() ??
    null;

  const body = [
    'ACCOUNT DELETION REQUEST (public form)',
    `Account type: ${ACCOUNT_TYPE_LABEL[accountType]}`,
    `Account email: ${email}`,
    '',
    message ? `User message:\n${message}` : 'User message: (none provided)',
  ].join('\n');

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('contact_submissions').insert({
    name: `Account deletion — ${ACCOUNT_TYPE_LABEL[accountType]}`,
    email,
    channel: 'support',
    message: body,
    user_agent: userAgent,
    ip_address: ip,
  });

  if (error) {
    // Never echo Supabase internals to an unauthenticated visitor.
    console.error('[account-deletion] insert failed', {
      code: error.code,
      message: error.message,
    });
    redirect(
      buildRedirect('/account-deletion', {
        error:
          'Could not submit your request. Please email privacy@nexpecapp.com directly while we look at this.',
      }),
    );
  }

  redirect(buildRedirect('/account-deletion', { sent: '1' }));
}
