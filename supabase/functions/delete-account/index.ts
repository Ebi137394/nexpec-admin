// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/delete-account/index.ts
//  NEXPEC — safe self-service account deletion.
//
//  Flow:
//    1. Authenticate the caller (Bearer JWT).
//    2. Run request_account_deletion() AS the caller (guards: no active jobs /
//       no unsettled wallet money; then anonymizes PII + soft-deletes the
//       profile, retaining all linked financial/contract/audit records).
//    3. BAN the auth login (auth.admin.updateUserById ban_duration) so the
//       anonymized user can't sign back in. We deliberately BAN rather than
//       DELETE auth.users — deleting it would cascade/orphan the retained
//       records that still reference this id.
//
//  Business rejections (active jobs / wallet not empty) return HTTP 200 with
//  { ok:false, error, code } so the client can show the reason cleanly;
//  non-2xx is reserved for auth/transport failures.
//
//  config: own Bearer auth (no special verify_jwt requirement). Deploy via
//  scripts/deploy-stripe-functions.sh (added to FUNCS).
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    // ── Step 1: Authenticate ────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing or malformed Authorization header', code: 'AUTH_MISSING' }, 401);
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) return jsonResponse({ error: 'Empty Bearer token', code: 'AUTH_MISSING' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) {
      return jsonResponse({ error: 'Invalid or expired token', code: 'AUTH_INVALID' }, 401);
    }

    // ── Step 2: Guarded anonymize, executed AS the caller (auth.uid() resolves
    //    from the forwarded JWT). Surfaces ACTIVE_JOBS / WALLET_NOT_EMPTY. ──
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: rpcErr } = await asUser.rpc('request_account_deletion');
    if (rpcErr) {
      // Guard rejection or RPC failure — business-level, not transport.
      console.warn(`[delete-account] anonymize blocked for ${user.id}: ${rpcErr.message}`);
      return jsonResponse({ ok: false, error: rpcErr.message, code: 'BLOCKED' }, 200);
    }

    // ── Step 3: Ban the auth login (NOT delete — preserves FK integrity). ──
    const { error: banErr } = await admin.auth.admin.updateUserById(user.id, {
      ban_duration: '876000h', // ~100 years
      app_metadata: { account_deleted: true, deleted_at: new Date().toISOString() },
    });
    if (banErr) {
      // PII is already scrubbed; report so the client knows the login wasn't
      // fully sealed (allows retry / manual admin follow-up).
      console.error(`[delete-account] anonymized but ban failed for ${user.id}: ${banErr.message}`);
      return jsonResponse(
        { ok: false, error: 'Your data was anonymized, but we could not fully lock the login. Please contact support.', code: 'BAN_FAILED' },
        200,
      );
    }

    console.log(`[delete-account] account anonymized + login banned: ${user.id}`);
    return jsonResponse({ ok: true }, 200);
  } catch (err: any) {
    console.error('[delete-account] fatal:', err);
    return jsonResponse({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
});
