#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  wda-region-roundtrip.mjs — REAL persistence round-trip for a WDA region
//  finding through pi_record_ai_detection → ai_detections. Proves the accepted
//  DB row keeps the full structured aggregation (finding_kind, geometry_role,
//  every member's class/confidence/geometry) and stays bound to the signed model.
//
//  This talks to the LIVE database, so it runs in YOUR environment (it cannot run
//  in the assistant sandbox). It never prints secrets.
//
//  Prerequisites:
//    • env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
//    • env: PARITY_INSPECTOR_EMAIL + PARITY_INSPECTOR_PASSWORD  (a test inspector)
//    • env: PARITY_JOB_ID  (a job whose contractor_id === that inspector)
//    • the WDA model row must exist in model_artifacts: slug wda-fissure-detector,
//      version 1, status published, tier student, signed, sha256 = 38ee7cc4…
//  Run:  node scripts/qa/wda-region-roundtrip.mjs
//  Exit 0 = all assertions passed against the real DB; exit 1 = failure.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.PARITY_INSPECTOR_EMAIL;
const PASSWORD = process.env.PARITY_INSPECTOR_PASSWORD;
const JOB_ID = process.env.PARITY_JOB_ID;
const WDA_SLUG = 'wda-fissure-detector', WDA_VERSION = 1;
const WDA_SHA = '38ee7cc44ad6290dcc1f9c6c8cb9c7e7453a8a08f453f642a443230c81194b5d';

for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, PARITY_INSPECTOR_EMAIL: EMAIL, PARITY_INSPECTOR_PASSWORD: PASSWORD, PARITY_JOB_ID: JOB_ID })) {
  if (!v) { console.error(`Missing env ${k}. Aborting (no fake results).`); process.exit(1); }
}

let ok = true;
const A = (n, c, extra = '') => { console.log(`${c ? '✓' : '✗'} ${n}${extra ? ' — ' + extra : ''}`); if (!c) ok = false; };

const sb = createClient(URL, ANON, { auth: { persistSession: false } });
const { error: authErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (authErr) { console.error('sign-in failed:', authErr.message); process.exit(1); }

// A minimal but complete WDA region payload (mixed Porosity/Spatters).
const region = {
  clusterId: 0, memberCount: 2,
  members: [
    { memberId: 0, classId: 2, label: 'Porosity', confidence: 0.81, box: [0.40, 0.40, 0.46, 0.46], polygon: [[0.40, 0.40], [0.46, 0.40], [0.46, 0.46], [0.40, 0.46]] },
    { memberId: 1, classId: 3, label: 'Spatters', confidence: 0.74, box: [0.47, 0.47, 0.53, 0.53], polygon: [[0.47, 0.47], [0.53, 0.47], [0.53, 0.53], [0.47, 0.53]] },
  ],
  classComposition: { 2: 1, 3: 1 }, dominantClass: 2,
  maxConfidence: 0.81, meanConfidence: 0.775, confWeightedCount: 1.55,
  summedArea: 0.0072, unionArea: 0.0072, bboxDiagonal: 0.184, maxPairwiseMemberDist: 0.099,
};
const p_raw = {
  source: 'web_client_tfjs', task: 'instance-segmentation', finding_kind: 'region', geometry_role: 'display_hull',
  class_id: region.dominantClass, box: [0.40, 0.40, 0.53, 0.53],
  polygon: [[0.40, 0.40], [0.53, 0.40], [0.53, 0.53], [0.40, 0.53]], region,
};

const { data: newId, error: rpcErr } = await sb.rpc('pi_record_ai_detection', {
  p_job_id: JOB_ID, p_defect_id: 'weld_defect_region', p_label: 'Weld defect cluster · 2 indications',
  p_confidence: region.maxConfidence, p_model_slug: WDA_SLUG, p_model_version: WDA_VERSION, p_model_sha256: WDA_SHA,
  p_severity: null, p_severity_scale: null, p_standard_refs: null, p_accepted: true, p_raw,
  p_client_op_id: (globalThis.crypto?.randomUUID?.() ?? `rt-${Date.now()}`),
});
if (rpcErr) { console.error('pi_record_ai_detection failed:', rpcErr.message); process.exit(1); }
A('RPC returned a new ai_detections id', !!newId, String(newId));

const { data: row, error: selErr } = await sb.from('ai_detections')
  .select('id, defect_id, model_slug, model_version, model_sha256, raw').eq('id', newId).single();
if (selErr) { console.error('fetch ai_detections failed:', selErr.message); process.exit(1); }

const raw = row.raw ?? {};
A("raw.finding_kind === 'region'", raw.finding_kind === 'region');
A("raw.geometry_role === 'display_hull'", raw.geometry_role === 'display_hull');
A('defect_id persisted as weld_defect_region', row.defect_id === 'weld_defect_region');
A('raw.region.members.length === raw.region.memberCount', raw.region?.members?.length === raw.region?.memberCount);
A('every member retains classId, confidence, box, polygon', Array.isArray(raw.region?.members) && raw.region.members.every((m) =>
  Number.isInteger(m.classId) && Number.isFinite(m.confidence) && Array.isArray(m.box) && m.box.length === 4 && Array.isArray(m.polygon) && m.polygon.length >= 3));
A('class composition (mixed) preserved', raw.region?.classComposition?.[2] === 1 && raw.region?.classComposition?.[3] === 1);
A('model binding: slug/version/sha', row.model_slug === WDA_SLUG && row.model_version === WDA_VERSION && String(row.model_sha256).toLowerCase() === WDA_SHA);

console.log(ok ? '\nROUND-TRIP PASSED (real DB)' : '\nROUND-TRIP FAILED');
process.exit(ok ? 0 : 1);
