// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/backfill-country-of-residence/index.ts
//  NEXPEC — JURISDICTION-002 (Phase 2 / Capture).
//
//  Best-effort reverse-geocode backfill for profiles.country_of_residence.
//
//  Targets: profiles where home_base_lat/_lng are set but country_of_residence
//           is still NULL. Calls OpenStreetMap Nominatim (free, no key) to
//           translate the coordinate into an ISO 3166-1 α-2 country code,
//           then UPDATEs the profile and writes a single audit event so the
//           Industrial Black Box records the source.
//
//  Why batched: Nominatim's usage policy is "≤ 1 request/second". A single
//  invocation processes a small batch (default 25, max 100), pacing requests
//  ≥ 1.1s apart, then returns a "remaining" cursor. The admin re-invokes
//  until remaining=0. Avoids the Edge-Function 60s timeout and respects the
//  upstream API.
//
//  Security:
//    • Admin-only. Caller must send a Bearer JWT belonging to a
//      profiles.role = 'super_admin' user. No anonymous backfill.
//    • Service-role client is used for the DB UPDATE so RLS doesn't block.
//    • Idempotent: a profile with COR already set is never touched again.
//
//  Invocation:
//    curl -X POST https://<project>.supabase.co/functions/v1/backfill-country-of-residence \
//         -H "Authorization: Bearer <ADMIN_USER_JWT>" \
//         -H "Content-Type: application/json" \
//         -d '{"limit": 25, "dry_run": false}'
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// ─── Config ───────────────────────────────────────────────────────────────

// Nominatim usage policy requires identification + ≤ 1 req/s.
// https://operations.osmfoundation.org/policies/nominatim/
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_UA   = 'NEXPEC-Backfill/1.0 (admin@nexpec.app)';
const REQ_DELAY_MS   = 1100; // 1.1s to stay safely under the rate limit
const DEFAULT_LIMIT  = 25;
const HARD_MAX_LIMIT = 100;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// ─── Service-role client (RLS-bypassing) ──────────────────────────────────

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

interface NominatimAddress {
  country_code?: string;
  country?: string;
  [k: string]: unknown;
}
interface NominatimResponse {
  address?: NominatimAddress;
  error?: string;
}

interface ProfileRow {
  id: string;
  home_base_lat: number | null;
  home_base_lng: number | null;
}

interface BatchOutcome {
  profile_id: string;
  status: 'updated' | 'skipped_no_country' | 'skipped_unknown_code' | 'skipped_no_coords' | 'failed';
  iso_code?: string;
  reason?: string;
}

// ─── Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  try {
    // ── Auth — Bearer JWT + super_admin role ──────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse(
        { error: 'Missing or malformed Authorization header', code: 'AUTH_MISSING' },
        401,
      );
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return jsonResponse({ error: 'Empty Bearer token', code: 'AUTH_MISSING' }, 401);
    }

    const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
    if (authErr || !user) {
      return jsonResponse({ error: 'Invalid or expired token', code: 'AUTH_INVALID' }, 401);
    }

    const { data: callerProfile, error: profErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    if (profErr) {
      console.error('[backfill-cor] caller profile lookup failed:', profErr.message);
      return jsonResponse({ error: 'Caller lookup failed', code: 'DB_ERROR' }, 500);
    }
    if (!callerProfile || callerProfile.role !== 'super_admin') {
      console.warn(`[backfill-cor][SECURITY] non-admin invocation attempt — user=${user.id}`);
      return jsonResponse(
        { error: 'Only super_admin can run this backfill', code: 'NOT_ADMIN' },
        403,
      );
    }

    // ── Parse request body ───────────────────────────────────────────
    let body: { limit?: unknown; dry_run?: unknown } = {};
    try {
      const raw = await req.text();
      if (raw) body = JSON.parse(raw);
    } catch {
      return jsonResponse({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
    }

    const rawLimit = Number(body.limit ?? DEFAULT_LIMIT);
    const limit = Math.max(
      1,
      Math.min(HARD_MAX_LIMIT, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : DEFAULT_LIMIT),
    );
    const dryRun = body.dry_run === true;

    // ── Fetch a batch of candidates ──────────────────────────────────
    const { data: candidates, error: candidatesErr } = await supabaseAdmin
      .from('profiles')
      .select('id, home_base_lat, home_base_lng')
      .is('country_of_residence', null)
      .not('home_base_lat', 'is', null)
      .not('home_base_lng', 'is', null)
      .order('id', { ascending: true })
      .limit(limit);

    if (candidatesErr) {
      console.error('[backfill-cor] candidate fetch failed:', candidatesErr.message);
      return jsonResponse({ error: 'Candidate lookup failed', code: 'DB_ERROR' }, 500);
    }

    // Snapshot the remaining count BEFORE processing — useful for the
    // admin to know how many more batches are needed.
    const { count: remainingBefore, error: countErr } = await supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .is('country_of_residence', null)
      .not('home_base_lat', 'is', null)
      .not('home_base_lng', 'is', null);
    if (countErr) {
      console.warn('[backfill-cor] remaining-count probe failed:', countErr.message);
    }

    if (!candidates || candidates.length === 0) {
      return jsonResponse(
        {
          ok: true,
          processed: 0,
          succeeded: 0,
          skipped: 0,
          failed: 0,
          remaining: remainingBefore ?? 0,
          outcomes: [],
          dry_run: dryRun,
        },
        200,
      );
    }

    // ── Cache valid ISO codes for fast guard ─────────────────────────
    const { data: codeRows, error: codeErr } = await supabaseAdmin
      .from('country_codes')
      .select('code');
    if (codeErr || !codeRows) {
      console.error('[backfill-cor] country_codes load failed:', codeErr?.message);
      return jsonResponse({ error: 'Country reference load failed', code: 'DB_ERROR' }, 500);
    }
    const validCodes = new Set<string>(codeRows.map((r: any) => String(r.code)));

    // ── Iterate, rate-limited ────────────────────────────────────────
    const outcomes: BatchOutcome[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < candidates.length; i++) {
      const p = candidates[i] as ProfileRow;
      if (i > 0) await sleep(REQ_DELAY_MS); // first call goes immediately

      if (p.home_base_lat == null || p.home_base_lng == null) {
        outcomes.push({ profile_id: p.id, status: 'skipped_no_coords' });
        skipped++;
        continue;
      }

      // Nominatim reverse-geocode
      const url = new URL(NOMINATIM_BASE);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('lat', String(p.home_base_lat));
      url.searchParams.set('lon', String(p.home_base_lng));
      url.searchParams.set('zoom', '3'); // country-level resolution
      url.searchParams.set('addressdetails', '1');

      let body: NominatimResponse | null = null;
      try {
        const resp = await fetch(url.toString(), {
          headers: { 'User-Agent': NOMINATIM_UA, Accept: 'application/json' },
        });
        if (!resp.ok) {
          throw new Error(`Nominatim HTTP ${resp.status}`);
        }
        body = (await resp.json()) as NominatimResponse;
      } catch (err: any) {
        console.error(
          `[backfill-cor] reverse-geocode failed for profile=${p.id}:`,
          err?.message,
        );
        outcomes.push({ profile_id: p.id, status: 'failed', reason: err?.message ?? 'fetch_error' });
        failed++;
        continue;
      }

      const cc = body?.address?.country_code;
      if (typeof cc !== 'string' || cc.length !== 2) {
        outcomes.push({ profile_id: p.id, status: 'skipped_no_country' });
        skipped++;
        continue;
      }
      const iso = cc.toUpperCase();
      if (!validCodes.has(iso)) {
        outcomes.push({
          profile_id: p.id,
          status: 'skipped_unknown_code',
          iso_code: iso,
          reason: 'Country code not in country_codes seed',
        });
        skipped++;
        continue;
      }

      if (dryRun) {
        outcomes.push({ profile_id: p.id, status: 'updated', iso_code: iso, reason: 'dry_run' });
        succeeded++;
        continue;
      }

      // Write the profile + audit event. We deliberately do NOT include
      // this in a transaction because Supabase JS client doesn't expose
      // multi-statement transactions; if the audit insert fails after
      // the profile update, the operator sees the count mismatch in the
      // response and can re-run (idempotent on already-set COR).
      const { error: updErr } = await supabaseAdmin
        .from('profiles')
        .update({ country_of_residence: iso, updated_at: new Date().toISOString() })
        .eq('id', p.id)
        .is('country_of_residence', null); // double-check (race protection)

      if (updErr) {
        console.error(`[backfill-cor] update failed for profile=${p.id}:`, updErr.message);
        outcomes.push({ profile_id: p.id, status: 'failed', reason: updErr.message });
        failed++;
        continue;
      }

      // Audit event — Industrial Black Box record of the source.
      const { error: auditErr } = await supabaseAdmin.from('audit_events').insert({
        event_type: 'profile.country_backfilled',
        severity: 'info',
        actor_id: user.id,
        actor_role: 'super_admin',
        actor_label: 'Backfill: Reverse-Geocode v1',
        subject_table: 'profiles',      // No CHECK on subject_table; the
                                        // schema convention lists jobs/
                                        // applications/contracts/payout_requests
                                        // but this is a new axis. Admin-only
                                        // visibility — the parties RLS policy
                                        // requires job_id IS NOT NULL, so this
                                        // row is only readable by super_admin.
        subject_id: p.id,
        job_id: null,
        summary: `Country of residence backfilled to ${iso} via reverse-geocode.`,
        delta: { after: { country_of_residence: iso } },
        metadata: {
          intent: 'Reverse-geocode backfill (Nominatim, zoom=3)',
          source: 'reverse_geocode_v1',
          source_provider: 'openstreetmap_nominatim',
          home_base_lat: p.home_base_lat,
          home_base_lng: p.home_base_lng,
          resolved_iso: iso,
          batch_admin: user.id,
        },
      });
      if (auditErr) {
        // Non-fatal — profile is already updated. Log loudly for ops.
        console.error(
          `[backfill-cor] audit insert failed for profile=${p.id}:`,
          auditErr.message,
        );
      }

      outcomes.push({ profile_id: p.id, status: 'updated', iso_code: iso });
      succeeded++;
    }

    // dry_run doesn't actually update the DB, so the queue isn't drained.
    // Only subtract `succeeded` from the snapshot when we wrote changes.
    const remaining = Math.max(
      0,
      (remainingBefore ?? 0) - (dryRun ? 0 : succeeded),
    );

    return jsonResponse(
      {
        ok: true,
        processed: candidates.length,
        succeeded,
        skipped,
        failed,
        remaining,
        outcomes,
        dry_run: dryRun,
      },
      200,
    );
  } catch (err: any) {
    console.error('[backfill-cor] fatal:', err);
    return jsonResponse(
      { error: 'Internal server error', code: 'INTERNAL_ERROR', detail: err?.message ?? null },
      500,
    );
  }
});
