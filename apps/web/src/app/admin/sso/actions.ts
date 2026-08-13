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
//
//  It is also never logged. There is no console.* call anywhere in this file
//  that could take `raw_token` as an argument, and the value is never written
//  to any store — only sha256(raw) exists server-side, so nothing here or in
//  the database can reproduce it after the response is sent.
//
//  ── WHY EVERY WRITE IS A TOKEN WRITE ───────────────────────────────────────
//  This lane's migration grants `authenticated` SELECT and nothing else on all
//  seven SSO/SCIM tables, and its self-test FAILS if that ever changes
//  ("every write path in this lane must go through a SECURITY DEFINER RPC").
//  The RPCs it exposes to an org identity administrator are the token
//  lifecycle only — nx_scim_issue_token and nx_scim_revoke_token. There is no
//  RPC for connection, domain or group-mapping writes, so this file offers no
//  action for them: an admin console must not offer a control the server
//  would refuse. The console surfaces that constraint in words instead.
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
  /** On a rotation, the non-secret prefix of the credential that was retired. */
  retiredPrefix?: string;
  /** A problem that occurred AFTER the secret was minted. Never fatal. */
  warning?: string;
  error?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function messageOf(e: unknown, fallback: string): string {
  return typeof e === 'object' && e !== null && 'message' in e
    ? String((e as { message: unknown }).message)
    : fallback;
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

const RotateSchema = z.object({
  tokenId: z.string().uuid({ message: 'Choose the credential to rotate.' }),
  name: z
    .string()
    .trim()
    .min(2, { message: 'Name the replacement so the roster stays readable.' })
    .max(80),
  expiresInDays: z
    .number()
    .int()
    .min(1, { message: 'A token must last at least a day.' })
    .max(730, { message: 'A SCIM token may not outlive 730 days.' }),
});

/**
 * ROTATION — issue the replacement, then kill the credential it replaces.
 *
 * Two things make this a rotation rather than "issue a second token":
 *
 *   1. `p_rotates_token_id` records the lineage (org_scim_tokens.rotated_from_id)
 *      and makes the migration shorten the OUTGOING token's expiry. Passing
 *      `p_grace_hours: 0` collapses that window to nothing —
 *      `LEAST(expires_at, now())` — so the old secret stops resolving the
 *      instant this transaction commits (nx_scim_resolve_token rejects
 *      `expires_at <= now()`).
 *   2. The outgoing token is then explicitly REVOKED, which stamps revoked_at
 *      and writes a `token.revoke` row to the provisioning history. Expiry
 *      alone would already have killed it; the revoke makes the death
 *      unambiguous in the roster and in the audit trail.
 *
 * The two calls are ordered mint-then-retire on purpose. Retiring first would
 * leave the organization with no working credential at all if the mint then
 * failed. Both tokens are never left live: the replacement is usable and the
 * outgoing one is dead before this function returns.
 *
 * The migration also supports a grace-window rotation (its default is a 24h
 * overlap so an IdP can cut over without a provisioning outage). This console
 * does not offer it: two live secrets for one connection doubles the window in
 * which a leaked credential works, and the operator here can see exactly when
 * the new secret was handed over. Re-point the IdP immediately after rotating.
 */
export async function rotateScimToken(
  _prev: IssueTokenState,
  formData: FormData,
): Promise<IssueTokenState> {
  const parsed = RotateSchema.safeParse({
    tokenId: formData.get('tokenId'),
    name: formData.get('name'),
    expiresInDays: Number(formData.get('expiresInDays') ?? 365),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const supabase = await createSupabaseServerClient();

  // The cross-organization guard, and it is the DATABASE that enforces it, not
  // this process: the read runs as the signed-in caller, so RLS
  // (nx_is_org_identity_admin) decides whether the row exists at all. A token
  // belonging to another tenant is simply not found, and org_id is then taken
  // FROM THAT ROW rather than from anything the browser sent — the client
  // cannot name an organization it does not administer. nx_scim_issue_token
  // and nx_scim_revoke_token re-check the same predicate server-side anyway.
  //
  // Explicit column list, never select('*'): the migration withholds
  // token_sha256 from `authenticated` by column-level grant, so a star select
  // would be refused outright — as intended. The digest is not readable here.
  const { data: outgoing, error: readError } = await supabase
    .from('org_scim_tokens')
    .select('id, org_id, connection_id, name, token_prefix, revoked_at, expires_at')
    .eq('id', parsed.data.tokenId)
    .maybeSingle();

  if (readError) {
    return { error: messageOf(readError, 'Could not read the credential to rotate.') };
  }
  if (!outgoing) {
    return {
      error:
        'That credential is not visible to you. Rotation is scoped to organizations you administer.',
    };
  }
  if (outgoing.revoked_at) {
    return {
      error:
        'That credential is already revoked. Issue a new token instead — rotating a dead credential would only record a misleading lineage.',
    };
  }

  // 1. Mint the replacement, with lineage and a zero-length overlap.
  const { data, error } = await supabase.rpc('nx_scim_issue_token', {
    p_org_id: outgoing.org_id,
    p_name: parsed.data.name,
    p_connection_id: outgoing.connection_id,
    p_expires_in_days: parsed.data.expiresInDays,
    p_rotates_token_id: outgoing.id,
    p_grace_hours: 0,
  });

  if (error) {
    return {
      error: `${messageOf(error, 'Rotation failed.')} — nothing was changed; the existing credential still works.`,
    };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.raw_token) {
    return { error: 'The replacement token was not returned. Nothing was issued.' };
  }

  // 2. Retire the outgoing credential outright. Its expiry is already now(),
  //    so it has stopped resolving; this stamps revoked_at and writes the
  //    token.revoke audit row so the roster and the history both say so.
  const { error: revokeError } = await supabase.rpc('nx_scim_revoke_token', {
    p_token_id: outgoing.id,
    p_reason: `superseded by rotation (${String(row.token_prefix ?? '')})`,
  });

  revalidatePath('/admin/sso');

  return {
    rawToken: row.raw_token as string,
    tokenPrefix: row.token_prefix as string,
    expiresAt: row.expires_at as string,
    retiredPrefix: outgoing.token_prefix as string,
    warning: revokeError
      ? `The replacement was issued and the outgoing credential's lifetime was cut to zero, so it no longer authenticates. Stamping it as revoked failed (${messageOf(revokeError, 'unknown error')}) — revoke it from the roster so the audit trail reads cleanly.`
      : undefined,
  };
}

const RevokeSchema = z.object({
  tokenId: z.string().uuid(),
  reason: z.string().trim().max(200).optional(),
});

/**
 * Immediate, irreversible revocation with no grace window. This is the control
 * for a suspected-compromised secret; the provisioning outage it causes is the
 * intended effect. To swap a credential as planned maintenance, use
 * rotateScimToken instead — it mints the replacement before retiring this one,
 * so there is never a moment with no working credential.
 *
 * Authority is re-checked inside nx_scim_revoke_token against the token's own
 * org_id, so a token id belonging to another organization is refused by the
 * database rather than by this function.
 */
export async function revokeScimToken(
  tokenId: string,
  reason?: string,
): Promise<ActionResult> {
  const parsed = RevokeSchema.safeParse({ tokenId, reason: reason || undefined });
  if (!parsed.success) {
    return { ok: false, error: 'That is not a valid credential id.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('nx_scim_revoke_token', {
    p_token_id: parsed.data.tokenId,
    p_reason: parsed.data.reason || 'revoked from the admin console',
  });

  if (error) {
    return { ok: false, error: messageOf(error, 'Could not revoke the credential.') };
  }

  revalidatePath('/admin/sso');
  return { ok: true };
}

/**
 * `<form action={...}>` shape for revocation.
 *
 * A React form action is called with FormData and its return value is discarded,
 * so the typed revokeScimToken() above cannot be passed to one directly. Rather
 * than loosen that signature — the client islands call it directly and want the
 * ActionResult — this adapter reads the field the form posts and delegates.
 *
 * A failure is deliberately not swallowed: the progressive-enhancement form has
 * nowhere to render an ActionResult, so a failed revoke throws and surfaces on
 * the route's error boundary instead of silently appearing to succeed. A
 * credential the operator believes is revoked but is not is the worse outcome.
 */
export async function revokeScimTokenForm(formData: FormData): Promise<void> {
  const tokenId = String(formData.get('tokenId') ?? '');
  const reason = String(formData.get('reason') ?? '') || undefined;

  const result = await revokeScimToken(tokenId, reason);
  if (!result.ok) {
    throw new Error(result.error ?? 'Could not revoke the credential.');
  }
}
