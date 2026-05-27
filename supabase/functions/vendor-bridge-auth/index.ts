// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/vendor-bridge-auth/index.ts
//
//  COORDINATION BRIDGE — Sprint A · Vendor-side gateway.
//
//  This is the only entry point for vendor-side mutations on a Coordination
//  Bridge. The vendor never authenticates with NEXPEC; their identity is
//  the raw magic-link token (high-entropy 64-hex-char string) issued by
//  the inspector via bridge_create. Token semantics:
//
//    • Stored as SHA-256(raw) in coordination_bridges.token_sha256.
//    • Raw token never persisted.
//    • Token expires (default 60 days), revocable, rotatable.
//    • One token = one job = one bridge.
//
//  This Edge Function:
//    1. Validates the presented token via the SECURITY DEFINER RPC
//       bridge_vendor_resolve_token (which hashes and looks up).
//    2. Records a vendor session via bridge_vendor_touch.
//    3. Dispatches to the appropriate internal RPC based on `action`.
//    4. Returns role-redacted bridge state.
//
//  ACTIONS (POST body `action` field)
//  ──────────────────────────────────
//    get_state                  → bridge_vendor_get_state
//    accept_schedule            → bridge_vendor_accept_schedule(slot_id)
//    counter_schedule           → bridge_vendor_counter_schedule(slot_id, proposed_at_iso, timezone, notes?)
//    create_upload_url          → returns a Supabase Storage signed-upload URL
//    register_uploaded_document → bridge_vendor_register_uploaded_document(slot_id, storage_path, filename, mime, size, sha256)
//    declare_site_access        → bridge_vendor_declare_site_access(slot_id, payload)
//    sign_arrival               → bridge_vendor_sign_arrival(slot_id, typed_name)
//
//  AUTH MODEL
//  ──────────
//    POST body must include { token, action, payload? }.
//    The token IS the bearer credential. We do NOT use the Authorization
//    header for vendor calls because the vendor accesses NEXPEC via a URL
//    we generated for them; HTTP headers are inconvenient for that flow.
//
//  CORS
//  ────
//    Open CORS — the public vendor portal page at /bridge/[token] needs
//    to call this from a browser the vendor controls.
// ════════════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const BUCKET = 'bridge-documents';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

type Action =
  | 'get_state'
  | 'accept_schedule'
  | 'counter_schedule'
  | 'create_upload_url'
  | 'register_uploaded_document'
  | 'declare_site_access'
  | 'sign_arrival';

interface RequestBody {
  token?: string;
  action?: Action;
  payload?: Record<string, unknown>;
}

interface ResolveTokenRow {
  bridge_id: string;
  job_id: string;
  vendor_contact_id: string;
  status: string;
  token_expires_at: string;
  token_revoked_at: string | null;
  inspector_id: string;
  client_id: string | null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'method_not_allowed' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { error: 'missing_supabase_env' });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const action = body.action;
  const payload = (body.payload ?? {}) as Record<string, unknown>;

  if (!token || token.length < 32) {
    return jsonResponse(401, { error: 'invalid_token' });
  }
  if (!action) {
    return jsonResponse(400, { error: 'missing_action' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Resolve + validate the token ──
  const { data: resolveRows, error: resolveErr } = await supabase.rpc(
    'bridge_vendor_resolve_token',
    { p_raw_token: token },
  );

  if (resolveErr) {
    return jsonResponse(401, { error: 'token_resolution_failed', detail: resolveErr.message });
  }

  const row = Array.isArray(resolveRows) ? (resolveRows[0] as ResolveTokenRow | undefined) : null;
  if (!row || !row.bridge_id) {
    return jsonResponse(401, { error: 'unknown_token' });
  }
  if (row.token_revoked_at) {
    return jsonResponse(403, { error: 'token_revoked' });
  }
  if (row.token_expires_at && new Date(row.token_expires_at) < new Date()) {
    return jsonResponse(403, { error: 'token_expired' });
  }
  if (row.status === 'completed' || row.status === 'cancelled') {
    if (action !== 'get_state') {
      return jsonResponse(409, { error: 'bridge_in_terminal_state', status: row.status });
    }
  }

  // ── 2. Touch the session (best-effort; ignore errors) ──
  try {
    await supabase.rpc('bridge_vendor_touch', { p_raw_token: token });
  } catch (_) { /* swallow */ }

  // ── 3. Dispatch by action ──
  try {
    switch (action) {
      case 'get_state':
        return await dispatchGetState(supabase, token);

      case 'accept_schedule':
        return await dispatchAcceptSchedule(supabase, token, payload);

      case 'counter_schedule':
        return await dispatchCounterSchedule(supabase, token, payload);

      case 'create_upload_url':
        return await dispatchCreateUploadUrl(supabase, token, payload, row);

      case 'register_uploaded_document':
        return await dispatchRegisterDocument(supabase, token, payload);

      case 'declare_site_access':
        return await dispatchDeclareSiteAccess(supabase, token, payload);

      case 'sign_arrival':
        return await dispatchSignArrival(supabase, token, payload, req);

      default:
        return jsonResponse(400, { error: 'unknown_action', action });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(500, { error: 'dispatch_failed', detail: message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Dispatchers
// ─────────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function dispatchGetState(supabase: any, token: string): Promise<Response> {
  const { data, error } = await supabase.rpc('bridge_vendor_get_state', {
    p_raw_token: token,
  });
  if (error) return jsonResponse(500, { error: error.message });
  return jsonResponse(200, { ok: true, state: data });
}

// deno-lint-ignore no-explicit-any
async function dispatchAcceptSchedule(
  supabase: any,
  token: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const slotId = stringField(payload, 'slot_id');
  if (!slotId) return jsonResponse(400, { error: 'missing_slot_id' });

  const { data, error } = await supabase.rpc('bridge_vendor_accept_schedule', {
    p_raw_token: token,
    p_slot_id: slotId,
  });
  if (error) return jsonResponse(400, { error: error.message });
  return jsonResponse(200, { ok: true, slot: data });
}

// deno-lint-ignore no-explicit-any
async function dispatchCounterSchedule(
  supabase: any,
  token: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const slotId = stringField(payload, 'slot_id');
  const proposedAt = stringField(payload, 'proposed_at');
  const timezone = stringField(payload, 'timezone') ?? 'UTC';
  const notes = stringField(payload, 'notes');

  if (!slotId) return jsonResponse(400, { error: 'missing_slot_id' });
  if (!proposedAt) return jsonResponse(400, { error: 'missing_proposed_at' });

  const proposedAtDate = new Date(proposedAt);
  if (Number.isNaN(proposedAtDate.getTime())) {
    return jsonResponse(400, { error: 'invalid_proposed_at' });
  }

  const { data, error } = await supabase.rpc('bridge_vendor_counter_schedule', {
    p_raw_token: token,
    p_slot_id: slotId,
    p_proposed_at: proposedAtDate.toISOString(),
    p_timezone: timezone,
    p_notes: notes,
  });
  if (error) return jsonResponse(400, { error: error.message });
  return jsonResponse(200, { ok: true, slot: data });
}

// deno-lint-ignore no-explicit-any
async function dispatchCreateUploadUrl(
  supabase: any,
  token: string,
  payload: Record<string, unknown>,
  row: ResolveTokenRow,
): Promise<Response> {
  const slotId = stringField(payload, 'slot_id');
  const filename = stringField(payload, 'filename');
  const sizeBytes = numberField(payload, 'size_bytes');

  if (!slotId) return jsonResponse(400, { error: 'missing_slot_id' });
  if (!filename) return jsonResponse(400, { error: 'missing_filename' });
  if (sizeBytes == null || sizeBytes < 1) return jsonResponse(400, { error: 'invalid_size_bytes' });
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return jsonResponse(413, { error: 'file_too_large', max_bytes: MAX_UPLOAD_BYTES });
  }

  // Compose a deterministic storage path. Path embeds bridge id (not the
  // raw token) so storage logs don't leak the token, and slot id so we
  // can correlate later if needed.
  const safeName = sanitiseFilename(filename);
  const storagePath = `${row.bridge_id}/${slotId}/${crypto.randomUUID()}-${safeName}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    return jsonResponse(500, { error: 'signed_url_failed', detail: error?.message });
  }

  return jsonResponse(200, {
    ok: true,
    upload: {
      bucket: BUCKET,
      storage_path: storagePath,
      signed_url: data.signedUrl,
      token: data.token,
    },
  });
}

// deno-lint-ignore no-explicit-any
async function dispatchRegisterDocument(
  supabase: any,
  token: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const slotId = stringField(payload, 'slot_id');
  const storagePath = stringField(payload, 'storage_path');
  const filename = stringField(payload, 'filename');
  const mime = stringField(payload, 'mime_type');
  const sizeBytes = numberField(payload, 'size_bytes');
  const sha256 = stringField(payload, 'sha256');

  if (!slotId) return jsonResponse(400, { error: 'missing_slot_id' });
  if (!storagePath) return jsonResponse(400, { error: 'missing_storage_path' });
  if (!filename) return jsonResponse(400, { error: 'missing_filename' });
  if (!sha256 || !/^[a-f0-9]{64}$/i.test(sha256)) {
    return jsonResponse(400, { error: 'invalid_sha256' });
  }

  const { data, error } = await supabase.rpc('bridge_vendor_register_uploaded_document', {
    p_raw_token: token,
    p_slot_id: slotId,
    p_storage_path: storagePath,
    p_filename: filename,
    p_mime_type: mime ?? null,
    p_size_bytes: sizeBytes ?? null,
    p_sha256: sha256.toLowerCase(),
  });
  if (error) return jsonResponse(400, { error: error.message });
  return jsonResponse(200, { ok: true, document: data });
}

// deno-lint-ignore no-explicit-any
async function dispatchDeclareSiteAccess(
  supabase: any,
  token: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const slotId = stringField(payload, 'slot_id');
  const sitePayload = (payload?.['site_access'] ?? {}) as Record<string, unknown>;
  if (!slotId) return jsonResponse(400, { error: 'missing_slot_id' });

  const { data, error } = await supabase.rpc('bridge_vendor_declare_site_access', {
    p_raw_token: token,
    p_slot_id: slotId,
    p_payload: sitePayload,
  });
  if (error) return jsonResponse(400, { error: error.message });
  return jsonResponse(200, { ok: true, slot: data });
}

// deno-lint-ignore no-explicit-any
async function dispatchSignArrival(
  supabase: any,
  token: string,
  payload: Record<string, unknown>,
  req: Request,
): Promise<Response> {
  const slotId = stringField(payload, 'slot_id');
  const typedName = stringField(payload, 'typed_name');
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    null;

  if (!slotId) return jsonResponse(400, { error: 'missing_slot_id' });
  if (!typedName) return jsonResponse(400, { error: 'missing_typed_name' });

  const { data, error } = await supabase.rpc('bridge_vendor_sign_arrival', {
    p_raw_token: token,
    p_slot_id: slotId,
    p_typed_name: typedName,
    p_ip: ip,
  });
  if (error) return jsonResponse(400, { error: error.message });
  return jsonResponse(200, { ok: true, slot: data });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function stringField(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload?.[key];
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return undefined;
}

function numberField(payload: Record<string, unknown>, key: string): number | undefined {
  const v = payload?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim().length > 0) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function sanitiseFilename(name: string): string {
  return (name || 'document')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}
