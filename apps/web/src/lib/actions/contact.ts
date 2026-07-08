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

  // Best-effort operator notification via Resend (the platform's email
  // provider — same as the edge functions). The contact_submissions row above
  // is the source of truth; this email is a convenience ping and must NEVER
  // break the form, so every failure is logged and swallowed.
  // HOST CONFIG (Vercel env): RESEND_API_KEY, CONTACT_INBOX_EMAIL (where these
  // land — set this to your real inbox), optional RESEND_FROM_EMAIL.
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const inbox = process.env.CONTACT_INBOX_EMAIL;
    if (resendApiKey && inbox) {
      // This is a Node server action (the /contact page has no `edge` runtime),
      // so server-only env vars like RESEND_API_KEY resolve normally.
      //
      // ⚠️ The `from` domain decides whether delivery works at all:
      //   • A verified-domain sender (set RESEND_FROM_EMAIL, e.g.
      //     "notify@nexpec.app" after verifying nexpec.app in Resend) delivers
      //     to ANY recipient — this is what production needs.
      //   • The shared sandbox sender "onboarding@resend.dev" is TEST-ONLY:
      //     Resend delivers it ONLY to YOUR OWN Resend-account email and
      //     silently 403s every other recipient. So if CONTACT_INBOX_EMAIL is
      //     not your Resend signup address, the sandbox sender will never
      //     arrive. That is the most likely cause of "success in UI, no email".
      const fromEmail = process.env.RESEND_FROM_EMAIL;
      if (!fromEmail) {
        console.warn(
          '[contact] RESEND_FROM_EMAIL is not set — falling back to the ' +
          'onboarding@resend.dev SANDBOX sender, which only delivers to your ' +
          'own Resend-account email. Set RESEND_FROM_EMAIL to a verified-domain ' +
          'address to deliver to CONTACT_INBOX_EMAIL.',
        );
      }
      const sender = fromEmail || 'onboarding@resend.dev';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `NEXPEC Contact <${sender}>`,
          to: [inbox],
          reply_to: parsed.data.email,
          subject: `[${parsed.data.channel}] New contact from ${parsed.data.name}`,
          text:
            `Channel: ${parsed.data.channel}\n` +
            `From: ${parsed.data.name} <${parsed.data.email}>\n\n` +
            `${parsed.data.message}`,
        }),
      });
      // fetch does NOT throw on 4xx/5xx — inspect the parsed body so BOTH the
      // success id and the real failure reason land in the Vercel runtime log.
      const payload = await res.json().catch(() => null);
      if (res.ok) {
        console.log(`[contact] Resend accepted the email (id=${payload?.id ?? 'unknown'}, from=${sender}, to=${inbox}).`);
      } else {
        console.error(
          `[contact] Resend REJECTED the email (status ${res.status}, from=${sender}, to=${inbox}). ` +
          `If from=onboarding@resend.dev this is the sandbox restriction (recipient must be your ` +
          `Resend-account email); otherwise "${sender}" is not a verified sender/domain. Response:`,
          payload,
        );
      }
    } else {
      console.warn('[contact] email skipped: RESEND_API_KEY or CONTACT_INBOX_EMAIL not set');
    }
  } catch (e) {
    console.error('[contact] email dispatch failed (submission still saved):', e);
  }

  redirect('/contact?sent=1');
}
