// ============================================================================
//  supabase/functions/_shared/auth.ts
//
//  Dependency-free (no Stripe) JWT verification + self-guard for edge functions.
//  Closes IDOR on endpoints that accept a user_id in the request body.
//
//  Usage:
//    try {
//      const { userId } = await requireUser(req);
//      requireSelf(userId, body?.user_id);   // or just use userId directly
//    } catch (e) {
//      if (e instanceof Response) return e;   // auth failures are thrown Responses
//      throw e;
//    }
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Verify the caller's Supabase JWT from the Authorization header. Returns the
 * authenticated user id/email. THROWS a 401 Response on any failure — callers
 * should `if (e instanceof Response) return e;`.
 */
export async function requireUser(
  req: Request,
): Promise<{ userId: string; email: string | null }> {
  const authz = req.headers.get('Authorization') ?? '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!token) throw json(401, { error: 'missing_authorization', code: 'AUTH_MISSING' });

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) throw json(401, { error: 'invalid_token', code: 'AUTH_INVALID' });
  return { userId: data.user.id, email: data.user.email ?? null };
}

/**
 * Enforce that the caller is acting on THEIR OWN resource. If `requestedId` is
 * absent the caller is expected to fall back to their own id; if present and
 * mismatched, THROWS a 403 Response.
 */
export function requireSelf(callerId: string, requestedId: unknown): void {
  if (typeof requestedId !== 'string' || requestedId.length === 0) return;
  if (requestedId !== callerId) {
    throw json(403, { error: 'forbidden_not_self', code: 'AUTH_FORBIDDEN' });
  }
}
