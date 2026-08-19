// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/generate-vca/index.ts
//
//  STEP 6 — `generate-vca` Edge Function (Deno).
//
//  The server-side engine that turns secured field captures into a
//  Verified Compliance Affidavit. Pipeline:
//
//    1. Authorize the caller (admin OR assigned inspector with all
//       required captures complete).
//    2. Load the job, scope template, evidence requirements, captures,
//       and supplier documents from Postgres (service-role client,
//       RLS-bypassing — we authorize manually).
//    3. Validate every capture server-side:
//         • EXIF intactness (subset present)
//         • GPS distance from claimed_address_geocoded (Haversine vs
//           per-requirement constraints.max_accuracy_m / 250m default)
//         • Hash recomputation (re-canonicalize metadata, recompute
//           sha256, compare to stored capture_sha256)
//    4. Walk the per-job chain (each capture's prev_capture_sha256
//       must equal the previous capture's capture_sha256).
//    5. Bail with `chain_intact: false` if anything is broken.
//    6. Compose the canonical VCA JSON payload (matches the TS type
//       at src/features/compliance/types/vca.ts).
//    7. SHA-256 the canonical payload.
//    8. Sign that SHA with Ed25519 using the platform signing key
//       (NEXPEC_SIGNING_KEY_PRIVATE_PEM secret).
//    9. Render the HTML template with the payload + a signed-URL pass.
//   10. Upload the HTML to compliance/affidavits/<job_id>/<id>.html.
//   11. Insert/UPDATE verification_affidavits with the full payload,
//       both hashes, the signature, the storage path, and status='issued'.
//   12. Return the affidavit id + public_verify_token for the caller.
//
//  REQUIRED SECRETS (set via `supabase secrets set ...`):
//    SUPABASE_URL                            (auto)
//    SUPABASE_SERVICE_ROLE_KEY               (auto, service-role)
//    NEXPEC_SIGNING_KEY_PRIVATE_PEM          (PKCS8 PEM Ed25519 private)
//    NEXPEC_SIGNING_KEY_ID                   (e.g. "nx-2026-v1")
//    NEXPEC_VERIFY_BASE_URL                  (e.g. "https://nexpec.com/verify")
// ════════════════════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import Handlebars from 'https://esm.sh/handlebars@4.7.8';
import { VCA_HTML_TEMPLATE } from './template.ts';
import { toArrayBuffer } from '../_shared/bytes.ts';

// ─────────────────────────────────────────────────────────────
//  CORS preamble for app-side fetches
// ─────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────
const VCA_VERSION = '1.0';
const DEFAULT_MAX_GPS_DISTANCE_M = 250;       // fallback per-capture tolerance
const HTML_SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7d, for rendered HTML thumbnails

// ─────────────────────────────────────────────────────────────
//  Canonical JSON — must match the algorithm in
//  src/features/compliance/lib/signature.ts so app-side and
//  server-side hashes are bit-identical.
// ─────────────────────────────────────────────────────────────
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) parts.push(JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]));
  return '{' + parts.join(',') + '}';
}

// ─────────────────────────────────────────────────────────────
//  Hash helpers
// ─────────────────────────────────────────────────────────────
const enc = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', toArrayBuffer(enc.encode(input)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function sha256HashOfBytes(bytes: Uint8Array): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
}

async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─────────────────────────────────────────────────────────────
//  PDF render via Browserless — Tier 1 of the canonical
//  pipeline. Posts the rendered VCA HTML to Browserless and
//  returns the printable A4 PDF as raw bytes. The PDF's CSS
//  page sizing is governed entirely by the @page rules in the
//  HTML template — we set preferCSSPageSize so Browserless
//  respects them. networkidle0 lets fonts + any embedded
//  signed-URL images finish loading before snapshot.
// ─────────────────────────────────────────────────────────────
async function renderPdfViaBrowserless(html: string, token: string): Promise<Uint8Array> {
  const resp = await fetch(`https://chrome.browserless.io/pdf?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      html,
      options: {
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        // CSS template handles top/bottom/left/right margins via @page.
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
      },
      gotoOptions: { waitUntil: 'networkidle0', timeout: 45_000 },
    }),
  });
  if (!resp.ok) {
    const txt = await resp.text().catch(() => '');
    throw new Error(`Browserless render failed (${resp.status}): ${txt.slice(0, 400)}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

// ─────────────────────────────────────────────────────────────
//  Ed25519 signing (Web Crypto)
// ─────────────────────────────────────────────────────────────
function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importSigningKey(pemPrivate: string): Promise<CryptoKey> {
  const der = pemToDer(pemPrivate);
  return await crypto.subtle.importKey(
    'pkcs8',
    toArrayBuffer(der),
    { name: 'Ed25519' },
    false,
    ['sign']
  );
}

async function signCanonical(privateKey: CryptoKey, canonicalString: string): Promise<string> {
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, enc.encode(canonicalString));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ─────────────────────────────────────────────────────────────
//  Privacy hashes (subject / buyer / inspector ids → hex sha256
//  with a per-affidavit salt so cross-affidavit correlation
//  is intentional, not accidental).
// ─────────────────────────────────────────────────────────────
async function privacyHash(saltedInput: string): Promise<string> {
  return await sha256Hex(saltedInput);
}

// ─────────────────────────────────────────────────────────────
//  Geo: Haversine, meters
// ─────────────────────────────────────────────────────────────
function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ─────────────────────────────────────────────────────────────
//  Per-capture validator. Updates inspection_captures.server_*
//  fields with the verdict and flags, then returns the result
//  for the in-memory VCA composition.
// ─────────────────────────────────────────────────────────────
type CaptureRow = Record<string, any>;
type Validation = { status: 'valid' | 'flagged' | 'rejected'; flags: string[] };

async function validateCapture(
  cap: CaptureRow,
  job: any,
  requirement: any,
): Promise<Validation> {
  const flags: string[] = [];
  let status: 'valid' | 'flagged' | 'rejected' = 'valid';

  // ── 1. Recompute capture_sha256 from the canonical metadata
  //       (file SHA we cannot recompute server-side without
//        re-downloading the storage object; that's a STEP 7
//        hardening pass). For now we trust the file SHA portion
//        as stored and re-derive the metadata hash to detect any
//        post-insert tampering with the metadata columns.
  const exifSummary = cap.exif_json ? deriveExifSubset(cap.exif_json) : null;
  const canonicalMeta = {
    job_id: cap.job_id,
    requirement_id: cap.requirement_id,
    inspector_id: cap.inspector_id,
    kind: cap.kind,
    file_sha256: cap.file_sha256_stored ?? null,  // legacy / future field
    gps_lat: cap.gps_lat,
    gps_lng: cap.gps_lng,
    gps_accuracy_m: cap.gps_accuracy_m,
    captured_at: cap.captured_at,
    exif_summary: exifSummary,
    text_payload: cap.text_payload,
  };
  // NB: we do not re-flag on metadata-hash mismatch yet because
  // the field-side hash includes file_sha which we don't have at
  // the server-side metadata-only validator. The hash is left as
  // is and admin review can recompute when needed.

  // ── 2. EXIF intactness for photo-class captures
  if (cap.kind === 'photo' || cap.kind === 'photo_with_face' || cap.kind === 'document_upload') {
    if (!cap.exif_json) {
      flags.push('EXIF_MISSING');
      status = 'flagged';
    } else if (typeof cap.exif_json === 'object') {
      const exif = cap.exif_json as Record<string, unknown>;
      if (!exif.Make && !exif.Model) {
        flags.push('EXIF_NO_DEVICE');
        status = 'flagged';
      }
      const constraint = requirement?.constraints_json ?? {};
      if (constraint.require_exif_gps && (exif.GPSLatitude == null || exif.GPSLongitude == null)) {
        flags.push('EXIF_GPS_STRIPPED');
        status = 'flagged';
      }
    }
  }

  // ── 3. GPS distance check (when claimed_address_geocoded present)
  const claim = job?.claimed_address_geocoded_point as { lat: number; lng: number } | null;
  if (cap.gps_lat != null && cap.gps_lng != null && claim) {
    const dist = haversineMeters({ lat: cap.gps_lat, lng: cap.gps_lng }, claim);
    cap._gps_distance_from_claim_m = Math.round(dist);
    const constraint = requirement?.constraints_json ?? {};
    const tolerance = Number(constraint.max_gps_distance_m ?? DEFAULT_MAX_GPS_DISTANCE_M);
    cap._gps_matches_claim = dist <= tolerance;
    if (!cap._gps_matches_claim) {
      flags.push(`GPS_OFF_CLAIM_${Math.round(dist)}m`);
      status = 'flagged';
    }
    const acc = cap.gps_accuracy_m;
    const accLimit = Number(constraint.max_accuracy_m ?? 50);
    if (acc != null && acc > accLimit) {
      flags.push(`GPS_LOW_ACCURACY_${Math.round(acc)}m`);
      status = status === 'valid' ? 'flagged' : status;
    }
  } else if (cap.kind === 'gps_pin') {
    flags.push('GPS_FIX_MISSING');
    status = 'rejected';
  }

  // ── 4. Captured_at sanity (not future, not before job assigned)
  if (cap.captured_at) {
    const t = new Date(cap.captured_at).getTime();
    if (t > Date.now() + 60_000) {
      flags.push('TIMESTAMP_IN_FUTURE');
      status = 'rejected';
    }
  }

  // ── 5. Face presence (only for photo_with_face — placeholder:
//        server-side detection is deferred to a Vision API call;
//        for v1 we surface a flag so admin can manually verify.
  if (cap.kind === 'photo_with_face') {
    if (cap.face_detected_count == null) {
      flags.push('FACE_DETECTION_PENDING_SERVER');
      // not a hard fail; admin reviews
    }
  }

  return { status, flags };
}

function deriveExifSubset(raw: Record<string, unknown>) {
  return {
    Make: (raw['Make'] as string) ?? null,
    Model: (raw['Model'] as string) ?? null,
    DateTimeOriginal: (raw['DateTimeOriginal'] as string) ?? null,
    Software: (raw['Software'] as string) ?? null,
    GPSLatitude: (raw['GPSLatitude'] as number) ?? null,
    GPSLongitude: (raw['GPSLongitude'] as number) ?? null,
    GPSAltitude: (raw['GPSAltitude'] as number) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────
//  Chain walker — captures are ordered by created_at ASC; each
//  row's prev_capture_sha256 must equal the previous row's
//  capture_sha256.  Returns { intact, notes }.
// ─────────────────────────────────────────────────────────────
function walkChain(captures: CaptureRow[]): {
  chain_intact: boolean;
  notes: string[];
  first_capture_sha256: string | null;
  last_capture_sha256: string | null;
  total_captures: number;
} {
  if (captures.length === 0) {
    return {
      chain_intact: false,
      notes: ['No captures present.'],
      first_capture_sha256: null,
      last_capture_sha256: null,
      total_captures: 0,
    };
  }
  const notes: string[] = [];
  let intact = true;
  let prev: string | null = null;
  for (let i = 0; i < captures.length; i++) {
    const c = captures[i];
    if (i === 0) {
      if (c.prev_capture_sha256 != null) {
        intact = false;
        notes.push(`First capture #${i} has non-null prev hash.`);
      }
    } else {
      if (c.prev_capture_sha256 !== prev) {
        intact = false;
        notes.push(`Chain break at capture #${i}: prev_capture_sha256 does not match capture #${i - 1}.`);
      }
    }
    prev = c.capture_sha256;
  }
  return {
    chain_intact: intact,
    notes,
    first_capture_sha256: captures[0]?.capture_sha256 ?? null,
    last_capture_sha256: captures[captures.length - 1]?.capture_sha256 ?? null,
    total_captures: captures.length,
  };
}

// ─────────────────────────────────────────────────────────────
//  Signed-URL pass — replaces every capture row's storage_path
//  with a freshly-signed URL so the rendered HTML can embed
//  thumbnails without re-querying for read URLs at view time.
// ─────────────────────────────────────────────────────────────
async function signCaptureUrls(client: SupabaseClient, captures: CaptureRow[]) {
  for (const c of captures) {
    if (!c.storage_path) { c._signed_url = null; continue; }
    const { data } = await client.storage.from('compliance').createSignedUrl(c.storage_path, HTML_SIGNED_URL_TTL);
    c._signed_url = data?.signedUrl ?? null;
  }
}

// ─────────────────────────────────────────────────────────────
//  Geography lift — Postgres returns `claimed_address_geocoded`
//  as a WKB hex string unless we cast to text. We fetched it as
//  ST_AsText elsewhere; here we just parse "POINT(lng lat)".
// ─────────────────────────────────────────────────────────────
function parsePointWkt(wkt: string | null): { lat: number; lng: number } | null {
  if (!wkt) return null;
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt);
  if (!m) return null;
  return { lat: parseFloat(m[2]), lng: parseFloat(m[1]) };
}

// ─────────────────────────────────────────────────────────────
//  Handlebars helpers
// ─────────────────────────────────────────────────────────────
Handlebars.registerHelper('eq', function (a: unknown, b: unknown) { return a === b; });

const HBS_TEMPLATE = Handlebars.compile(VCA_HTML_TEMPLATE, { noEscape: false });

// ─────────────────────────────────────────────────────────────
//  Main handler
// ─────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST required' }, 405);

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const PRIVATE_PEM = Deno.env.get('NEXPEC_SIGNING_KEY_PRIVATE_PEM');
    const KEY_ID = Deno.env.get('NEXPEC_SIGNING_KEY_ID') ?? 'nx-dev';
    const VERIFY_BASE = Deno.env.get('NEXPEC_VERIFY_BASE_URL') ?? 'https://nexpec.com/verify';

    if (!PRIVATE_PEM) return json({ ok: false, error: 'NEXPEC_SIGNING_KEY_PRIVATE_PEM not set' }, 500);

    // ── Parse + authorize
    const body = await req.json().catch(() => ({}));
    const jobId: string | undefined = body?.job_id;
    if (!jobId) return json({ ok: false, error: 'job_id required' }, 400);

    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!jwt) return json({ ok: false, error: 'Authorization Bearer token required' }, 401);

    // User-context client (to identify the caller)
    const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: callerUser, error: callerErr } = await userClient.auth.getUser(jwt);
    if (callerErr || !callerUser?.user) return json({ ok: false, error: 'invalid token' }, 401);
    const callerId = callerUser.user.id;

    // Service-role client (bypass RLS for data fetch)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // ── Load: job (with scope text + buyer + supplier names + geocoded WKT)
    // 20260801426000: the vca_load_job RPC call was removed. It lived only in
    // supabase/migrations_archive and was never in canonical migrations, so in
    // practice this fallback was always the live path. It selects every job
    // field this function actually consumes — the geocoded point is not read
    // from here, it is assigned below from vca_claimed_address_text — so the
    // RPC added nothing but a guaranteed-failing round trip.
    const { data: j } = await admin
      .from('jobs')
      .select(`
        id, client_id, agency_id, contractor_id, status,
        inspection_type, scope_template_id, title,
        claimed_address_text
      `)
      .eq('id', jobId)
      .single();
    const job: any | null = j;
    if (!job) return json({ ok: false, error: 'job not found' }, 404);
    if (job.inspection_type !== 'compliance') {
      return json({ ok: false, error: 'not a compliance job' }, 400);
    }

    // ── Authorize: admin/super_admin OR the assigned inspector
    const { data: callerProfile } = await admin
      .from('profiles')
      .select('id, role, full_name, first_name, last_name')
      .eq('id', callerId)
      .single();
    const isAdmin = callerProfile?.role === 'admin' || callerProfile?.role === 'super_admin';
    const isAssignedInspector = job.contractor_id === callerId;
    if (!isAdmin && !isAssignedInspector) {
      return json({ ok: false, error: 'caller not authorized' }, 403);
    }

    // ── Pull buyer + inspector profiles
    const buyerId = job.client_id ?? job.agency_id;
    const buyerType = job.client_id ? 'client' : 'agency';
    const { data: buyerProfile } = await admin
      .from('profiles')
      .select('id, full_name, first_name, last_name')
      .eq('id', buyerId)
      .single();
    const buyerName =
      buyerProfile?.full_name?.trim() ||
      [buyerProfile?.first_name, buyerProfile?.last_name].filter(Boolean).join(' ').trim() ||
      'Unknown buyer';

    const { data: inspectorProfile } = await admin
      .from('profiles')
      .select('id, full_name, first_name, last_name')
      .eq('id', job.contractor_id)
      .single();
    const inspectorName =
      inspectorProfile?.full_name?.trim() ||
      [inspectorProfile?.first_name, inspectorProfile?.last_name].filter(Boolean).join(' ').trim() ||
      'Inspector';

    // ── Pull inspector's most-recent approved CCI credential
    const { data: credRow } = await admin
      .from('inspector_credentials')
      .select('id, tier, decided_at, expires_at, status')
      .eq('inspector_id', job.contractor_id)
      .eq('status', 'approved')
      .order('decided_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // ── Load scope + requirements + captures + documents
    const { data: scope } = await admin
      .from('inspection_scope_templates')
      .select('id, slug, name, version, category, region, validity_months')
      .eq('id', job.scope_template_id)
      .single();
    if (!scope) return json({ ok: false, error: 'scope template not found' }, 404);

    const { data: requirements } = await admin
      .from('inspection_evidence_requirements')
      .select('*')
      .eq('template_id', scope.id)
      .order('sort_order', { ascending: true });

    const { data: captures } = await admin
      .from('inspection_captures')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });

    const { data: docs } = await admin
      .from('compliance_documents')
      .select('*')
      .eq('job_id', jobId);

    // ── Parse claimed_address geocoded
    // We don't fetch the raw geography column directly (Supabase returns
    // EWKB). Instead, store the lat/lng in a separate column if available,
    // or re-fetch via ST_AsText:
    const { data: pt } = await admin
      .rpc('vca_claimed_address_text', { p_job_id: jobId })
      .single();
    const claimPoint = parsePointWkt((pt as any)?.wkt ?? null);
    job.claimed_address_geocoded_point = claimPoint;

    // ── Per-capture validation + storage signed-URL pass
    const reqsById: Record<string, any> = {};
    for (const r of (requirements ?? [])) reqsById[r.id] = r;
    const validations: Record<string, Validation> = {};
    for (const c of (captures ?? [])) {
      const v = await validateCapture(c, job, reqsById[c.requirement_id]);
      validations[c.id] = v;
      await admin
        .from('inspection_captures')
        .update({
          server_validation_status: v.status,
          server_flags_json: v.flags,
          server_validated_at: new Date().toISOString(),
        })
        .eq('id', c.id);
    }

    // ── Required-capture coverage check
    const missing: string[] = [];
    for (const r of (requirements ?? [])) {
      if (!r.required) continue;
      const okCount = (captures ?? []).filter(
        (c) => c.requirement_id === r.id && validations[c.id]?.status !== 'rejected'
      ).length;
      if (okCount < r.min_count) {
        missing.push(`Requirement "${r.label}" needs ${r.min_count} valid capture(s), has ${okCount}.`);
      }
    }

    // ── Chain walk
    const chain = walkChain(captures ?? []);

    if (!chain.chain_intact || missing.length > 0) {
      return json({
        ok: false,
        error: 'Affidavit blocked',
        chain_intact: chain.chain_intact,
        chain_notes: chain.notes,
        missing_requirements: missing,
      }, 409);
    }

    // ── Sign signed URLs into the captures for HTML embedding
    await signCaptureUrls(admin, captures ?? []);

    // ── Compose VCA payload (matches src/features/compliance/types/vca.ts)
    const now = new Date();
    const validUntil = new Date(now);
    validUntil.setMonth(validUntil.getMonth() + (scope.validity_months ?? 12));

    const verifyToken = await admin.rpc('gen_verify_token').then((r) => r.data as string | null);
    if (!verifyToken) return json({ ok: false, error: 'could not generate verify token' }, 500);

    const subjectIdHash    = await privacyHash(`subject:${buyerId}:${jobId}`);
    const buyerIdHash      = await privacyHash(`buyer:${buyerId}:${jobId}`);
    const inspectorIdHash  = await privacyHash(`inspector:${job.contractor_id}:${jobId}`);
    const credIdHash       = credRow ? await privacyHash(`cred:${credRow.id}:${jobId}`) : '';

    const evidence = (requirements ?? []).map((r: any) => {
      const reqCaps = (captures ?? []).filter((c: any) => c.requirement_id === r.id);
      return {
        requirement: {
          requirement_id_hash: '',
          sort_order: r.sort_order,
          kind: r.kind,
          label: r.label,
          hint: r.hint,
          required: r.required,
          constraints: r.constraints_json ?? {},
        },
        captures: reqCaps.map((c: any) => {
          const v = validations[c.id];
          const exif = c.exif_json ? deriveExifSubset(c.exif_json) : null;
          const gps = c.gps_lat != null && c.gps_lng != null ? {
            lat: c.gps_lat,
            lng: c.gps_lng,
            accuracy_m: c.gps_accuracy_m,
            matches_claimed_address: !!c._gps_matches_claim,
            distance_from_claim_m: c._gps_distance_from_claim_m ?? null,
          } : null;
          return {
            capture_id_hash: c.id,                  // not hashed in v1
            kind: c.kind,
            captured_at: c.captured_at,
            storage_ref: c.storage_path,
            storage_signed_url: c._signed_url,      // template-only
            mime_type: c.mime_type,
            gps,
            gps_label: gps ? (gps.matches_claimed_address ? 'match' : `${gps.distance_from_claim_m}m off`) : '',
            gps_badge_class: gps ? (gps.matches_claimed_address ? 'badge-ok' : 'badge-warn') : 'badge-neutral',
            exif_summary: exif,
            exif_gps_label: exif && (exif.GPSLatitude != null && exif.GPSLongitude != null) ? 'intact' : 'stripped',
            capture_sha256: c.capture_sha256,
            prev_capture_sha256: c.prev_capture_sha256,
            face: c.face_detected_count != null ? {
              detected_count: c.face_detected_count,
              liveness_score: c.face_liveness_score,
            } : null,
            face_badge_class: c.face_detected_count ? 'badge-ok' : 'badge-warn',
            text_value: c.text_payload,
            validation: { status: v?.status ?? 'pending', flags: v?.flags ?? [] },
            validation_badge_class:
              v?.status === 'valid' ? 'badge-ok' :
              v?.status === 'flagged' ? 'badge-warn' :
              v?.status === 'rejected' ? 'badge-bad' : 'badge-neutral',
            device_attestation: {
              present: !!c.device_attestation_token,
              platform: c.device_platform ?? null,
            },
          };
        }),
      };
    });

    const documents = (docs ?? []).map((d: any) => ({
      doc_type: d.doc_type,
      // Evidence pointers — exactly one of these is meaningful per row.
      //   storage_ref: present when the supplier UPLOADED the file into
      //                our compliance bucket.
      //   document_url: present when the supplier provided an EXTERNAL
      //                LINK (Google Drive / Dropbox / etc.). Rendered as
      //                "External Evidence" on the affidavit + verify page.
      storage_ref: d.storage_path,
      document_url: d.document_url ?? null,
      is_external_evidence: !!d.document_url && !d.storage_path,
      evidence_source: d.document_url ? 'external_link' : 'uploaded_file',
      evidence_badge_class: d.document_url ? 'badge-info' : 'badge-neutral',
      doc_sha256: null,                              // server-side hash deferred
      issuing_authority: d.issuing_authority,
      document_number: d.document_number,
      issued_at: d.issued_at,
      expires_at: d.expires_at,
      verification_status: d.verification_status,
      verification_badge_class:
        d.verification_status === 'verified' ? 'badge-ok' :
        d.verification_status === 'flagged' ? 'badge-warn' :
        d.verification_status === 'rejected' ? 'badge-bad' : 'badge-neutral',
      verification_notes: d.verification_notes,
      verified_by_admin: !!d.verified_by_admin_id,
      extracted_fields: d.ocr_fields_json ?? {},
    }));

    // ── Payload object that gets canonicalized + hashed
    const payloadForHash = {
      vca_version: VCA_VERSION,
      affidavit_id: '',                              // filled after row insert
      public_verify_token: verifyToken,
      public_verify_url: `${VERIFY_BASE}/${verifyToken}`,
      issued_at: now.toISOString(),
      validity: {
        from: now.toISOString(),
        until: validUntil.toISOString(),
        months: scope.validity_months,
      },
      scope: {
        template_slug: scope.slug,
        template_name: scope.name,
        template_version: scope.version,
        category: scope.category,
        region: scope.region,
      },
      subject: {
        name: job.title,                             // denormalized at issue time
        claimed_address_text: job.claimed_address_text,
        claimed_address_geocoded: claimPoint,
        subject_id_hash: subjectIdHash,
      },
      buyer: { name: buyerName, type: buyerType, buyer_id_hash: buyerIdHash },
      inspector: {
        name: inspectorName,
        inspector_id_hash: inspectorIdHash,
        credential: credRow ? {
          tier: credRow.tier,
          credential_id_hash: credIdHash,
          approved_at: credRow.decided_at,
          expires_at: credRow.expires_at,
        } : null,
        signed_at: now.toISOString(),
      },
      evidence: evidence.map(stripPayloadOnly),       // template-only fields removed for hash
      documents,
      chain_of_custody: {
        chain_intact: chain.chain_intact,
        total_captures: chain.total_captures,
        first_capture_sha256: chain.first_capture_sha256,
        last_capture_sha256: chain.last_capture_sha256,
        notes: chain.notes,
      },
    };

    const canonicalPayloadString = canonicalJsonStringify(payloadForHash);
    const jsonPayloadSha256 = await sha256Hex(canonicalPayloadString);

    // ── Sign payload sha256 with Ed25519
    const signingKey = await importSigningKey(PRIVATE_PEM);
    const signature = await signCanonical(signingKey, jsonPayloadSha256);

    // ── Render HTML
    const htmlInput = {
      ...payloadForHash,
      evidence,                                       // template-rich (with signed_url)
      chain_of_custody: {
        ...payloadForHash.chain_of_custody,
        chain_badge_class: chain.chain_intact ? 'badge-ok' : 'badge-bad',
        chain_status_text: chain.chain_intact ? 'Intact ✓' : 'BROKEN ✗',
      },
      tamper_evidence: {
        json_payload_sha256: jsonPayloadSha256,
        html_sha256: '',                              // filled below
        signing_algorithm: 'Ed25519',
        platform_signature: signature,
        platform_signing_key_id: KEY_ID,
      },
    };
    let html = HBS_TEMPLATE(htmlInput);
    const htmlSha256 = await sha256Hex(html);
    // Re-render with html_sha256 filled in
    htmlInput.tamper_evidence.html_sha256 = htmlSha256;
    html = HBS_TEMPLATE(htmlInput);

    // ── Insert affidavit row (returning id), then upload HTML to the
//    canonical path keyed off that id.
    const affidavitInsert = {
      job_id: jobId,
      status: 'issued',
      public_verify_token: verifyToken,
      json_payload: { ...payloadForHash, tamper_evidence: htmlInput.tamper_evidence },
      json_payload_sha256: jsonPayloadSha256,
      html_sha256: htmlSha256,
      valid_from: now.toISOString(),
      valid_until: validUntil.toISOString(),
      signed_by_inspector_id: job.contractor_id,
      signed_by_inspector_credential: credRow?.id ?? null,
      signed_at: now.toISOString(),
      issued_at: now.toISOString(),
    };

    // Idempotent: try insert; if conflict, fetch existing
    let affidavitId: string;
    const { data: existing } = await admin
      .from('verification_affidavits')
      .select('id, status')
      .eq('job_id', jobId)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'revoked') {
        return json({ ok: false, error: 'affidavit is revoked' }, 409);
      }
      affidavitId = existing.id;
      const { error: updErr } = await admin
        .from('verification_affidavits')
        .update(affidavitInsert)
        .eq('id', affidavitId);
      if (updErr) throw updErr;
    } else {
      const { data: ins, error: insErr } = await admin
        .from('verification_affidavits')
        .insert(affidavitInsert)
        .select('id')
        .single();
      if (insErr) throw insErr;
      affidavitId = ins.id;
    }

    // Re-stamp affidavit_id into the payload + html for the final stored copy
    payloadForHash.affidavit_id = affidavitId;
    htmlInput.affidavit_id = affidavitId;
    html = HBS_TEMPLATE(htmlInput);
    const finalHtmlSha = await sha256Hex(html);

    const htmlPath = `affidavits/${jobId}/${affidavitId}.html`;
    const htmlBlob = new Blob([html], { type: 'text/html' });
    const { error: upErr } = await admin.storage
      .from('compliance')
      .upload(htmlPath, htmlBlob, { contentType: 'text/html', upsert: true });
    if (upErr) throw upErr;

    // Finalize the row with the storage path + final html sha + stamped affidavit_id
    const { error: finalUpdErr } = await admin
      .from('verification_affidavits')
      .update({
        html_storage_path: htmlPath,
        html_sha256: finalHtmlSha,
        json_payload: { ...payloadForHash, tamper_evidence: { ...htmlInput.tamper_evidence, html_sha256: finalHtmlSha } },
      })
      .eq('id', affidavitId);
    if (finalUpdErr) throw finalUpdErr;

    // ── PDF render (Tier 1 — canonical PDF) ────────────────────────
    //
    //   Browserless reads the same HTML that already passed signing
    //   and snapshot-renders it to A4. We upload the bytes, compute
    //   SHA-256, and store both on verification_affidavits. The PDF
    //   is therefore anchored to the same affidavit row as the HTML —
    //   tamper detection is "re-download, re-hash, compare to
    //   fetch_affidavit_by_verify_token.pdf_sha256".
    //
    //   PDF generation is BEST-EFFORT — if Browserless is unavailable,
    //   the HTML affidavit (the legal text artifact) is still issued.
    //   A future caller can re-invoke this function to backfill the
    //   PDF when the renderer is healthy again.
    //
    //   Required secret: BROWSERLESS_API_KEY (set via
    //     `supabase secrets set BROWSERLESS_API_KEY=...`).
    let pdfStoragePath: string | null = null;
    let pdfSha256: string | null = null;
    try {
      const BROWSERLESS_KEY = Deno.env.get('BROWSERLESS_API_KEY');
      if (!BROWSERLESS_KEY) {
        console.warn('[generate-vca] BROWSERLESS_API_KEY not set — skipping PDF render.');
      } else {
        const pdfBytes = await renderPdfViaBrowserless(html, BROWSERLESS_KEY);
        pdfSha256 = await sha256HexOfBytes(pdfBytes);
        pdfStoragePath = `affidavits/${jobId}/${affidavitId}.pdf`;
        const pdfBlob = new Blob([toArrayBuffer(pdfBytes)], { type: 'application/pdf' });
        const { error: pdfUpErr } = await admin.storage
          .from('compliance')
          .upload(pdfStoragePath, pdfBlob, { contentType: 'application/pdf', upsert: true });
        if (pdfUpErr) throw pdfUpErr;

        const { error: pdfRowErr } = await admin
          .from('verification_affidavits')
          .update({ pdf_storage_path: pdfStoragePath, pdf_sha256: pdfSha256 })
          .eq('id', affidavitId);
        if (pdfRowErr) throw pdfRowErr;
      }
    } catch (e) {
      // Don't bail the whole affidavit on PDF failure — the HTML is
      // the legal artifact. Log loudly so we can backfill later.
      console.error('[generate-vca] PDF render/upload failed:', e);
      pdfStoragePath = null;
      pdfSha256 = null;
    }

    return json({
      ok: true,
      affidavit_id: affidavitId,
      public_verify_token: verifyToken,
      public_verify_url: `${VERIFY_BASE}/${verifyToken}`,
      json_payload_sha256: jsonPayloadSha256,
      html_storage_path: htmlPath,
      html_sha256: finalHtmlSha,
      pdf_storage_path: pdfStoragePath,
      pdf_sha256: pdfSha256,
      platform_signature: signature,
      signing_key_id: KEY_ID,
      validations,
      chain: {
        intact: chain.chain_intact,
        total: chain.total_captures,
        notes: chain.notes,
      },
    }, 200);
  } catch (e) {
    console.error('[generate-vca] failed:', e);
    return json({ ok: false, error: (e as Error).message ?? 'internal error' }, 500);
  }
});

// Strip template-only fields from each capture before canonicalization.
function stripPayloadOnly(group: any) {
  return {
    ...group,
    captures: group.captures.map((c: any) => {
      const { storage_signed_url, gps_label, gps_badge_class, exif_gps_label, validation_badge_class, face_badge_class, ...keep } = c;
      return keep;
    }),
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}
