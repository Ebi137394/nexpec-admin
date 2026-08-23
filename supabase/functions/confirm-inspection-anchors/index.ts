// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/confirm-inspection-anchors/index.ts
//
//  WEAPON 1 (phase 2) — upgrade pending OpenTimestamps anchors to Bitcoin.
//
//  anchor-inspection-seals submits each seal's root_sha256 to a free OTS
//  calendar and stores a PENDING proof (status 'submitted'). Hours later, the
//  calendar's aggregated commitment is included in a Bitcoin block. This
//  function walks each pending proof to recover the calendar commitment, asks
//  the calendar for the upgraded timestamp, and — once it carries a Bitcoin
//  attestation — flips the anchor to 'bitcoin_confirmed', records the block
//  height, and stores the upgraded (Bitcoin-anchored) proof. $0: OTS calendars
//  are a free public good; no Bitcoin node or API key required.
//
//  Runs with the service-role key (bypasses RLS). Schedule it via pg_cron
//  (hourly is plenty — Bitcoin confirmation is slow). Idempotent and fail-safe:
//  any parse/network error leaves the anchor 'submitted' to retry next run.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHash } from 'node:crypto';
import { type HashFn, parseOts, hexToBytes } from '../_shared/ots.ts';
import { fetchWithTimeout } from '../_shared/http.ts';

const BATCH = 100;
// QA-F1 — abort a calendar request that stops responding so one slow calendar
// can't stall the batch (the per-anchor loop just moves on / retries next run).
const CALENDAR_TIMEOUT_MS = 9000;

// Injected hasher — Deno supports node:crypto. sha256 covers the OTS calendar
// aggregation path; ripemd160/sha1 are supported too if a proof uses them.
const hash: HashFn = (name, data) =>
  Uint8Array.from(createHash(name).update(data).digest());

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

interface AnchorRow {
  seal_id: string;
  root_sha256: string;
  ots_proof: string | null;
  calendar: string | null;
}

Deno.serve(async (req: Request) => {
  // ── Auth gate (audit F-6, 2026-08-23) ────────────────────────────────────
  //  This endpoint drives privileged, service-role batch work. The Supabase
  //  gateway's verify_jwt only proves *a* valid JWT — and the publishable anon
  //  key is one — so without this check any internet caller could trigger the
  //  batch (forced/premature anchoring, calendar spam, cost amplification).
  //  Same Bearer idiom as dispatch-notification-emails / refresh-fx-rates.
  //  No client and no cron job calls this function, so nothing legitimate breaks.
  {
    const authHeader = req.headers.get('authorization') ?? '';
    const bearer = authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice(7).trim()
      : '';
    const cronSecret = Deno.env.get('CRON_SECRET');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorised =
      (!!serviceKey && bearer === serviceKey) ||
      (!!cronSecret && bearer === cronSecret);
    if (!authorised) {
      return new Response(JSON.stringify({ error: 'unauthorised' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'missing env' }), { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: rows, error } = await supabase
    .from('inspection_seal_anchors')
    .select('seal_id, root_sha256, ots_proof, calendar')
    .eq('status', 'submitted')
    .not('ots_proof', 'is', null)
    .order('submitted_at', { ascending: true })
    .limit(BATCH);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let confirmed = 0, stillPending = 0;
  const failures: Array<{ seal_id: string; reason: string }> = [];

  for (const row of (rows ?? []) as AnchorRow[]) {
    try {
      const proof = base64ToBytes(row.ots_proof as string);
      const seedDigest = hexToBytes(row.root_sha256);

      // 1) Recover the pending calendar commitments from the stored proof.
      const parsed = parseOts(proof, seedDigest, hash);
      if (parsed.bitcoin.length > 0) {
        // Already complete in the stored proof — just flip status.
        await markConfirmed(supabase, row, row.ots_proof as string, minHeight(parsed.bitcoin));
        confirmed++;
        continue;
      }
      if (parsed.pending.length === 0) { stillPending++; continue; }

      // 2) Ask each calendar for the upgraded timestamp at that commitment.
      let upgradedB64: string | null = null;
      let height: number | null = null;
      for (const p of parsed.pending) {
        const base = (row.calendar || p.uri).replace(/\/+$/, '');
        try {
          const res = await fetchWithTimeout(
            `${base}/timestamp/${p.commitment}`,
            { headers: { Accept: 'application/octet-stream' } },
            CALENDAR_TIMEOUT_MS,
          );
          if (!res.ok) continue; // 404 = not aggregated yet; try next / next run
          const upgraded = new Uint8Array(await res.arrayBuffer());
          // 3) The upgraded timestamp starts at the commitment. Bitcoin yet?
          const u = parseOts(upgraded, hexToBytes(p.commitment), hash);
          if (u.bitcoin.length > 0) {
            upgradedB64 = bytesToBase64(upgraded);
            height = minHeight(u.bitcoin);
            break;
          }
        } catch {
          // QA-F1 — timeout / network / parse error on this calendar: leave the
          // anchor 'submitted' and retry next run; never stall the batch.
          continue;
        }
      }

      if (upgradedB64 && height !== null) {
        await markConfirmed(supabase, row, upgradedB64, height);
        confirmed++;
      } else {
        stillPending++;
      }
    } catch (e) {
      failures.push({ seal_id: row.seal_id, reason: (e as Error)?.message ?? 'unknown' });
    }
  }

  return new Response(
    JSON.stringify({ scanned: rows?.length ?? 0, confirmed, still_pending: stillPending, failed: failures.length, failures }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});

function minHeight(atts: Array<{ height: number }>): number {
  return atts.reduce((a, b) => (b.height < a ? b.height : a), atts[0].height);
}

async function markConfirmed(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  row: AnchorRow,
  proofB64: string,
  height: number,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('inspection_seal_anchors')
    .update({
      status: 'bitcoin_confirmed',
      ots_proof: proofB64,
      bitcoin_block_height: height,
      confirmed_at: now,
      upgraded_at: now,
      updated_at: now,
    })
    .eq('seal_id', row.seal_id);
  if (error) throw new Error(error.message);
}
