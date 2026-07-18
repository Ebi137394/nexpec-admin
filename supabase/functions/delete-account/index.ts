// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/delete-account/index.ts
//  NEXPEC — safe self-service account deletion (hardened 2026-07-18).
//
//  Flow:
//    1. Authenticate the caller (Bearer JWT).
//    2. Privileged-account refusal BEFORE any mutation/ban: admin / super_admin
//       / Platform Owner can NEVER be deleted here. The ban is the only path an
//       authenticated flow can reach auth.users, so it is gated here in addition
//       to the DB trigger + RPC guard. Refusals are audit logged (never silent).
//    3. Run request_account_deletion() AS the caller (guards: no active jobs,
//       no unsettled money, supplier/dispute/org obligations; then anonymizes
//       PII in place → role-aware tombstone, retaining all business records).
//    4. BAN the auth login (updateUserById ban_duration) — NOT delete, so the
//       retained FK references stay valid.
//    5. Best-effort personal storage cleanup (avatars, resumes) by <uid>/
//       prefix. Evidence / business buckets are deliberately NOT touched.
//
//  Business rejections return HTTP 200 with { ok:false, error, code } carrying
//  the stable UPPER_SNAKE code from the RPC; non-2xx is reserved for
//  auth/transport failures.
//
//  config: own Bearer auth. Deploy via scripts/deploy-stripe-functions.sh.
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

// Personal storage buckets whose objects are namespaced under `<uid>/…`.
// Evidence/business buckets (inspection-photos, inspection-reports, contracts,
// client_documents, dispute-reports, receipts, …) are intentionally excluded:
// they are retained business records.
const PERSONAL_BUCKETS = ['avatars', 'resumes'] as const;

async function purgePersonalStorage(
  admin: ReturnType<typeof createClient>,
  uid: string,
): Promise<void> {
  for (const bucket of PERSONAL_BUCKETS) {
    try {
      const { data: listed, error: listErr } = await admin.storage
        .from(bucket)
        .list(uid, { limit: 1000 });
      if (listErr || !listed || listed.length === 0) continue;
      // Only files (name present); recurse one level is unnecessary given the
      // <uid>/<file> convention used by uploadAvatar / uploadResume.
      const paths = listed
        .filter((o) => o.name)
        .map((o) => `${uid}/${o.name}`);
      if (paths.length > 0) {
        await admin.storage.from(bucket).remove(paths);
      }
    } catch (e) {
      // Best-effort: the account is already anonymized + banned. An orphaned
      // avatar is low-risk and can be swept later; never fail the deletion.
      console.warn(`[delete-account] storage purge (${bucket}) failed for ${uid}:`, e);
    }
  }
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

    // ── Step 1b: Privileged-account refusal BEFORE any mutation/ban ──────────
    const [{ data: profile }, ownerRes] = await Promise.all([
      admin.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      admin.rpc('nx_is_platform_owner', { p_uid: user.id }),
    ]);
    const role = (profile?.role ?? '').toString().trim().toLowerCase();
    const isOwner = ownerRes.data === true;
    if (isOwner || role === 'admin' || role === 'super_admin') {
      await admin.from('audit_events').insert({
        event_type: 'account.deletion_refused_privileged',
        severity: 'warning',
        actor_id: user.id,
        actor_role: 'system',
        actor_label: 'delete-account edge fn',
        subject_table: 'profiles',
        subject_id: user.id,
        summary: 'Blocked self-service deletion of a privileged (admin/owner) account.',
        metadata: { role, is_owner: isOwner },
      });
      return jsonResponse(
        {
          ok: false,
          code: isOwner ? 'PLATFORM_OWNER_PROTECTED' : 'ADMIN_NOT_SELF_DELETABLE',
          error: isOwner
            ? 'The Platform Owner account cannot be deleted.'
            : 'Administrator accounts cannot be self-deleted. Contact NEXPEC operations.',
        },
        200,
      );
    }

    // ── Step 2: Guarded anonymize, executed AS the caller. Surfaces the full
    //    set of stable codes (ACTIVE_JOBS / WALLET_NOT_EMPTY / PENDING_PAYOUT /
    //    FAILED_PAYOUT / OPEN_INVOICE / OPEN_DISPUTE / SUPPLIER_* / ORG_*). ──
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: rpcErr } = await asUser.rpc('request_account_deletion');
    if (rpcErr) {
      const msg = rpcErr.message ?? 'Deletion blocked.';
      const codeMatch = /^([A-Z_]+):/.exec(msg);
      console.warn(`[delete-account] blocked for ${user.id}: ${msg}`);
      return jsonResponse({ ok: false, error: msg, code: codeMatch ? codeMatch[1] : 'BLOCKED' }, 200);
    }

    // ── Step 3: Ban the auth login (NOT delete — preserves FK integrity). ──
    const { error: banErr } = await admin.auth.admin.updateUserById(user.id, {
      ban_duration: '876000h', // ~100 years
      app_metadata: { account_deleted: true, deleted_at: new Date().toISOString() },
    });
    if (banErr) {
      console.error(`[delete-account] anonymized but ban failed for ${user.id}: ${banErr.message}`);
      return jsonResponse(
        { ok: false, error: 'Your data was anonymized, but we could not fully lock the login. Please contact support.', code: 'BAN_FAILED' },
        200,
      );
    }

    // ── Step 4: Best-effort personal storage cleanup (never fatal). ──
    await purgePersonalStorage(admin, user.id);

    console.log(`[delete-account] account anonymized + login banned: ${user.id}`);
    return jsonResponse({ ok: true }, 200);
  } catch (err) {
    console.error('[delete-account] fatal:', err);
    return jsonResponse({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
  }
});
