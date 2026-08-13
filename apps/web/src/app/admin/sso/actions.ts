// ════════════════════════════════════════════════════════════════════════════
//  app/admin/sso/actions.ts — SCIM token lifecycle (server actions)
//
//  Every write goes through a SECURITY DEFINER RPC from
//  20260801472000_enterprise_sso_scim.sql. Nothing here writes a table
//  directly: `authenticated` holds no INSERT/UPDATE/DELETE on any SSO or SCIM
//  table by design, so a direct write would fail anyway — the RPC is the only
//  door, and it re-checks authority server-side via nx_is_org_identity_admin().
//
//  ── WHY THE RAW TOKEN NEVER TOUCHES A URL ──────────────────────────────────
//  nx_scim_issue_token() returns the raw bearer token exactly once. It is
//  returned to the browser in the SERVER ACTION'S RESPONSE BODY and nowhere
//  else. It is deliberately NOT passed through redirect(), a query string or a
//  cookie: a secret in a URL leaks into server access logs, browser history,
//  the Referer header of the next outbound request, and any proxy in between.
//  That is why issueScimToken returns state instead of redirecting, and why
//  the caller is a useActionState form rather than a plain <form action>.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface IssueTokenState {
  /** Present exactly once, immediately after a successful mint. */
  rawToken?: string;
  tokenPrefix?: string;
  expiresAt?: string;
  error?: string;
}

const IssueSchema = z.object({
  orgId: z.string().uuid({ message: 'Pick an organization.' }),
  name: z
    .string()
    .trim()
    .min(2, { message: 'Name the token so it can be told apart at rotation time.' })
    .max(80),
  connectionId: z.string().uuid().optional().nullable(),
  expiresInDays: z
    .number()
    .int()
    .min(1, { message: 'A token must last at least a day.' })
    .max(730, { message: 'A SCIM token may not outlive 730 days.' }),
  rotatesTokenId: z.string().uuid().optional().nullable(),
});

export async function issueScimToken(
  _prev: IssueTokenState,
  formData: FormData,
): Promise<IssueTokenState> {
  const rawConnection = formData.get('connectionId');
  const rawRotates = formData.get('rotatesTokenId');

  const parsed = IssueSchema.safeParse({
    orgId: formData.get('orgId'),
    name: formData.get('name'),
    connectionId: rawConnection ? String(rawConnection) : null,
    expiresInDays: Number(formData.get('expiresInDays') ?? 365),
    rotatesTokenId: rawRotates ? String(rawRotates) : null,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('nx_scim_issue_token', {
    p_org_id: parsed.data.orgId,
    p_name: parsed.data.name,
    p_connection_id: parsed.data.connectionId,
    p_expires_in_days: parsed.data.expiresInDays,
    p_rotates_token_id: parsed.data.rotatesTokenId,
    p_grace_hours: 24,
  });

  if (error) {
    return { error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.raw_token) {
    return { error: 'The token was not returned. Nothing was issued.' };
  }

  revalidatePath('/admin/sso');

  return {
    rawToken: row.raw_token as string,
    tokenPrefix: row.token_prefix as string,
    expiresAt: row.expires_at as string,
  };
}

const RevokeSchema = z.object({
  tokenId: z.string().uuid(),
  reason: z.string().trim().max(200).optional(),
});

/**
 * Immediate, irreversible revocation with no grace window. This is the control
 * for a suspected-compromised secret; the provisioning outage it causes is the
 * intended effect. To swap a token WITHOUT an outage, issue a replacement with
 * `rotatesTokenId` set instead — that leaves the outgoing token alive for a
 * 24-hour overlap.
 */
export async function revokeScimToken(formData: FormData): Promise<void> {
  const parsed = RevokeSchema.safeParse({
    tokenId: formData.get('tokenId'),
    reason: formData.get('reason') ?? undefined,
  });
  if (!parsed.success) return;

  const supabase = await createSupabaseServerClient();
  await supabase.rpc('nx_scim_revoke_token', {
    p_token_id: parsed.data.tokenId,
    p_reason: parsed.data.reason || 'revoked from the admin console',
  });

  revalidatePath('/admin/sso');
}
