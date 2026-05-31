// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/anchor-inspection-seals/index.ts
//
//  WEAPON 1 — Verifiable Passport anchoring (OpenTimestamps, $0).
//
//  Finds sealed inspection reports that haven't been anchored yet and submits
//  each report's root_sha256 to the FREE public OpenTimestamps calendar servers
//  (no API key, no cost — a publicly-funded good that anchors into Bitcoin).
//  The returned calendar commitment is stored in inspection_seal_anchors with
//  status 'submitted'; get_inspection_passport() then surfaces it on the public
//  /passport/[sealId] page.
//
//  Runs with the service-role key (bypasses RLS) → writes inspection_seal_anchors
//  directly. Schedule it (pg_cron, every ~10 min) — see the deploy block in
//  NEXPEC_SECRET_WEAPONS_BUILD.md.
//
//  HONESTY NOTE: this records the calendar *commitment* + 'submitted' status.
//  Producing a fully self-verifiable standalone `.ots` proof and upgrading the
//  status to 'bitcoin_confirmed' after Bitcoin inclusion is a follow-up that
//  uses the `opentimestamps` client lib (it walks the calendar → Bitcoin
//  attestation). The DB + Passport UI already model that final state.
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CALENDAR = 'https://a.pool.opentimestamps.org';
const BATCH = 50;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).btoa(bin);
}

Deno.serve(async (req: Request) => {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'missing env' }), { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 1) Seals already anchored → skip set.
  const { data: anchored } = await supabase.from('inspection_seal_anchors').select('seal_id');
  const anchoredSet = new Set((anchored ?? []).map((a: { seal_id: string }) => a.seal_id));

  // 2) Recent seals needing an anchor.
  const { data: seals, error: sErr } = await supabase
    .from('pi_report_seals')
    .select('id, root_sha256')
    .order('created_at', { ascending: false })
    .limit(500);
  if (sErr) return new Response(JSON.stringify({ error: sErr.message }), { status: 500 });

  const pending = (seals ?? [])
    .filter((s: { id: string; root_sha256: string }) => !anchoredSet.has(s.id))
    .slice(0, BATCH);

  let ok = 0;
  const failures: Array<{ seal_id: string; reason: string }> = [];

  for (const seal of pending) {
    try {
      // Submit the 32-byte digest to a free OpenTimestamps calendar.
      const res = await fetch(`${CALENDAR}/digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', Accept: 'application/octet-stream' },
        body: hexToBytes(seal.root_sha256),
      });
      if (!res.ok) throw new Error(`calendar ${res.status}`);
      const proof = new Uint8Array(await res.arrayBuffer());

      const { error: upErr } = await supabase.from('inspection_seal_anchors').upsert(
        {
          seal_id: seal.id,
          root_sha256: seal.root_sha256.toLowerCase(),
          status: 'submitted',
          ots_proof: bytesToBase64(proof),
          calendar: CALENDAR,
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'seal_id' },
      );
      if (upErr) throw new Error(upErr.message);
      ok++;
    } catch (e) {
      failures.push({ seal_id: seal.id, reason: (e as Error)?.message ?? 'unknown' });
    }
  }

  return new Response(
    JSON.stringify({ scanned: seals?.length ?? 0, submitted: ok, failed: failures.length, failures }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
