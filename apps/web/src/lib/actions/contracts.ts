// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/contracts.ts — admin: generate a V3 job contract.
//
//  The Sprint-12D doc-library actions (contracts insert, contract_assignments
//  writes, sign_contract RPC, notify RPC) targeted a schema that never shipped
//  to prod. On the live V3 schema:
//    • generation  → admin_generate_job_contract (this file); the RPC enforces
//      nx_is_admin(), voids any prior active contract for the job, and
//      notifies the client itself via create_system_notification — no
//      web-side notify call needed.
//    • signing     → clientSignJobContract / inspectorSignJobContract in
//      lib/actions/jobContracts.ts, used by the role-scoped
//      /client/contracts/job/[id] and /inspector/contracts/job/[id] pages.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

/**
 * ★ 2026-08-06 — `returnTo` arrives from a form field and was validated only as
 * `z.string().min(1)` before being handed straight to next/navigation's
 * redirect(), which happily follows an absolute URL to another origin. Every
 * redirect target is now forced to a same-site absolute path, so a crafted post
 * can no longer bounce a signed-in admin off-platform.
 */
function safeReturnTo(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  // Must be a single-slash-rooted path. Rejects "https://evil", "//evil.com"
  // (protocol-relative) and "\\evil.com" (browser-normalised backslashes).
  if (!/^\/(?!\/)/.test(s) || s.includes('\\')) return '/admin/contracts';
  return s;
}

/* ─── Admin: generate a job contract from an application ───────────── */

const GenerateSchema = z
  .object({
    applicationId: z.string().uuid(),
    clientPriceDollars: z.preprocess(
      (v) => Number(v),
      z.number().int().min(0).max(10_000_000),
    ),
    inspectorPayoutDollars: z.preprocess(
      (v) => Number(v),
      z.number().int().min(0).max(10_000_000),
    ),
    contractTextMd: z.string().trim().max(200000).optional().or(z.literal('')),
    customContractUrl: z
      .string()
      .trim()
      .url()
      .regex(/^https?:\/\//)
      .max(2000)
      .optional()
      .or(z.literal('')),
    returnTo: z.string().min(1),
  })
  .refine((v) => (v.contractTextMd ?? '') !== '' || (v.customContractUrl ?? '') !== '', {
    message: 'Provide inline terms or a contract link.',
  });

export async function createContract(formData: FormData): Promise<void> {
  const parsed = GenerateSchema.safeParse({
    applicationId: formData.get('applicationId'),
    clientPriceDollars: formData.get('clientPriceDollars'),
    inspectorPayoutDollars: formData.get('inspectorPayoutDollars'),
    contractTextMd: formData.get('contractTextMd') ?? '',
    customContractUrl: formData.get('customContractUrl') ?? '',
    returnTo: formData.get('returnTo'),
  });
  const fallback = safeReturnTo(formData.get('returnTo'));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(fallback, { error: msg }));
  }
  const {
    applicationId,
    clientPriceDollars,
    inspectorPayoutDollars,
    contractTextMd,
    customContractUrl,
  } = parsed.data;
  const returnTo = safeReturnTo(parsed.data.returnTo);
  if (inspectorPayoutDollars > clientPriceDollars) {
    redirect(
      withQuery(returnTo, { error: 'Inspector payout cannot exceed client price.' }),
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  const { error } = await supabase.rpc('admin_generate_job_contract', {
    p_application_id: applicationId,
    p_client_price_cents: Math.round(clientPriceDollars * 100),
    p_inspector_payout_cents: Math.round(inspectorPayoutDollars * 100),
    p_contract_text_md:
      contractTextMd && contractTextMd.length > 0 ? contractTextMd : null,
    p_custom_contract_url:
      customContractUrl && customContractUrl.length > 0 ? customContractUrl : null,
  });
  if (error) {
    redirect(withQuery(returnTo, { error: 'Generation failed. ' + error.message }));
  }

  revalidatePath(returnTo);
  revalidatePath('/client/contracts');
  revalidatePath('/inspector/contracts');
  redirect(withQuery(returnTo, { created: '1' }));
}
