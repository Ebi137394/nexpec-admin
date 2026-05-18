// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/verify-affidavit/index.ts
//
//  STEP 7 — Anonymous signature verification for public verify pages.
//
//  Input:   { token: string }   OR   query string ?token=...
//  Output:  { ok, signature_valid, recomputed_sha256_matches, key_id,
//             algorithm, revoked, expired, summary }
//
//  Pipeline:
//    1. Load the affidavit by public_verify_token (service-role).
//    2. Resolve the active signing key by signing_key_id.
//    3. Strip tamper_evidence from json_payload, canonicalize, sha256.
//    4. Compare to stored json_payload_sha256 (catches payload edits).
//    5. Import the public PEM and verify the Ed25519 signature against
//       the recomputed sha256 string (signature anchors the canonical
//       sha, not the raw payload).
//    6. Return a flat verdict — no payload fields beyond a summary
//       block. Anything privacy-bearing is intentionally not exposed.
//
//  Anon-callable. CORS open. Idempotent / side-effect-free.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Canonical JSON — must match the client + generate-vca algorithm.
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) parts.push(JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]));
  return '{' + parts.join(',') + '}';
}

const enc = new TextEncoder();
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pemPublicToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importPublicKey(pem: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('spki', pemPublicToDer(pem), { name: 'Ed25519' }, false, ['verify']);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Accept token from POST body OR query string.
    let token: string | null = null;
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      token = body?.token ?? null;
    } else {
      const url = new URL(req.url);
      token = url.searchParams.get('token');
    }
    if (!token) return json({ ok: false, error: 'token required' }, 400);

    // Load the affidavit (full payload via service-role).
    const { data: aff, error: aErr } = await admin
      .from('verification_affidavits')
      .select(`
        id, status, public_verify_token,
        valid_from, valid_until, issued_at, revoked_at, revoked_reason,
        json_payload, json_payload_sha256
      `)
      .eq('public_verify_token', token)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!aff) return json({ ok: false, error: 'not found' }, 404);
    if (!aff.json_payload || typeof aff.json_payload !== 'object') {
      return json({ ok: false, error: 'payload missing' }, 500);
    }

    const payload = aff.json_payload as Record<string, unknown>;
    const tamper = (payload.tamper_evidence ?? {}) as Record<string, unknown>;
    const signature = String(tamper.platform_signature ?? '');
    const keyId = String(tamper.platform_signing_key_id ?? '');
    const algorithm = String(tamper.signing_algorithm ?? 'Ed25519');

    if (!signature || !keyId) {
      return json({ ok: false, error: 'no signature or key id in payload' }, 422);
    }

    // Resolve the public signing key. Even though signing_keys has an
    // anon-readable policy, we use service-role here for simplicity.
    const { data: keyRow } = await admin
      .from('signing_keys')
      .select('id, public_pem, algorithm, active')
      .eq('id', keyId)
      .maybeSingle();
    if (!keyRow) {
      return json({
        ok: false,
        signature_valid: false,
        key_unknown: true,
        key_id: keyId,
      }, 200);
    }
    if (keyRow.algorithm !== algorithm) {
      return json({
        ok: false,
        signature_valid: false,
        key_algorithm_mismatch: true,
        key_id: keyId,
      }, 200);
    }

    // Strip tamper_evidence, canonicalize, re-hash. The signature was
    // computed over the SHA-256 hex string of the canonical payload
    // (see generate-vca/index.ts), so we sign-verify against that
    // recomputed hex.
    const { tamper_evidence: _ignored, ...payloadForHash } = payload as Record<string, unknown>;
    const canonical = canonicalJsonStringify(payloadForHash);
    const recomputedSha = await sha256Hex(canonical);
    const recomputedShaMatches = recomputedSha === aff.json_payload_sha256;

    // Verify the Ed25519 signature over the recomputed sha.
    let signatureValid = false;
    try {
      const publicKey = await importPublicKey(keyRow.public_pem);
      signatureValid = await crypto.subtle.verify(
        { name: 'Ed25519' },
        publicKey,
        b64ToBytes(signature),
        enc.encode(recomputedSha),
      );
    } catch (e) {
      console.warn('[verify-affidavit] verify failed:', e);
      signatureValid = false;
    }

    const now = Date.now();
    const revoked = !!aff.revoked_at;
    const expired = aff.valid_until ? new Date(aff.valid_until).getTime() < now : false;
    const allOk = recomputedShaMatches && signatureValid && !revoked && !expired;

    // Pull a thin summary (no privacy-bearing fields).
    const scope = (payload.scope ?? {}) as Record<string, unknown>;
    const chain = (payload.chain_of_custody ?? {}) as Record<string, unknown>;
    const validity = (payload.validity ?? {}) as Record<string, unknown>;
    const summary = {
      scope_name: scope.template_name ?? null,
      scope_slug: scope.template_slug ?? null,
      scope_version: scope.template_version ?? null,
      scope_category: scope.category ?? null,
      scope_region: scope.region ?? null,
      validity_from: validity.from ?? aff.valid_from,
      validity_until: validity.until ?? aff.valid_until,
      issued_at: payload.issued_at ?? aff.issued_at,
      total_captures: chain.total_captures ?? null,
      chain_intact: chain.chain_intact ?? null,
      vca_version: payload.vca_version ?? null,
    };

    return json({
      ok: allOk,
      signature_valid: signatureValid,
      recomputed_sha256_matches: recomputedShaMatches,
      revoked,
      expired,
      revoked_reason: aff.revoked_reason ?? null,
      key_id: keyId,
      algorithm,
      json_payload_sha256: aff.json_payload_sha256,
      recomputed_sha256: recomputedSha,
      summary,
    });
  } catch (e) {
    console.error('[verify-affidavit] failed:', e);
    return json({ ok: false, error: (e as Error).message ?? 'internal error' }, 500);
  }
});
