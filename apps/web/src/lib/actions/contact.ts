// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/contact.ts — public contact form submission
//
//  Writes to contact_submissions (see 20260524120000_contact_submissions.sql).
//  RLS allows anonymous INSERT; only super_admin can SELECT, so the operator
//  reads submissions through the admin console (future surface) while the
//  marketing form stays public.
//
//  Validation is server-only. The form trusts the channel select option
//  but the schema double-checks against the same enum the DB constraint
//  enforces — defense in depth.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ContactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: 'Tell us your name.' })
    .max(80, { message: 'Name is too long.' }),
  email: z.string().email({ message: 'Enter a valid email address.' }),
  channel: z.enum(['sales', 'support', 'security'], {
    message: 'Pick a channel.',
  }),
  message: z
    .string()
    .trim()
    .min(10, { message: 'Add at least a sentence so we can route this well.' })
    .max(2000, { message: 'Message is too long, link instead of pasting.' }),
});

function buildRedirect(
  base: string,
  params: Record<string, string>,
): string {
  const qs = new URLSearchParams(params).toString();
  return qs ? `${base}?${qs}` : base;
}

export async function submitContact(formData: FormData): Promise<void> {
  const parsed = ContactSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    channel: formData.get('channel'),
    message: formData.get('message'),
  });

  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Could not send. Check the form.';
    redirect(buildRedirect('/contact', { error: msg }));
  }

  // Light audit metadata. user_agent is informational only — never used to
  // make access decisions.
  const h = await headers();
  const userAgent = h.get('user-agent')?.slice(0, 500) ?? null;
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip')?.trim() ??
    null;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('contact_submissions').insert({
    name: parsed.data.name,
    email: parsed.data.email,
    channel: parsed.data.channel,
    message: parsed.data.message,
    user_agent: userAgent,
    ip_address: ip,
  });

  if (error) {
    // Don't echo Supabase's internal error message to the public. Log it
    // for the operator and show a friendly fallback.
    console.error('[contact] insert failed', {
      code: error.code,
      message: error.message,
    });
    redirect(
      buildRedirect('/contact', {
        error: 'Could not send. Please email us directly while we look at this.',
      }),
    );
  }

  redirect('/contact?sent=1');
}
