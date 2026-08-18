#!/usr/bin/env node
/**
 * scripts/qa/seed-evidence-requirements.mjs
 *
 * Durable, idempotent seed for the inspection evidence-requirement catalog.
 *
 * WHY THIS EXISTS
 *   The mobile compliance capture wizard reads
 *   `inspection_evidence_requirements` (keyed by scope template). On a fresh
 *   environment the catalog is EMPTY for every template, so the wizard
 *   dead-ends at "No requirements to capture." — discovered during the run-28
 *   mobile qualification. The rows were first added to Staging by hand; the
 *   FINAL COMPLETION ADDENDUM requires the seed to be durable and documented,
 *   not a one-off edit. This script is that record: re-runnable against any
 *   environment, upsert-by-natural-key, never destructive.
 *
 * WHAT IT SEEDS
 *   1. Three scope templates (by slug, created only if absent):
 *      - api_510_pressure_vessel_inspection  (2 photo requirements)
 *      - structural_weld_visual_inspection   (1 photo requirement)
 *      - radiographic_weld_review_rt         (1 photo requirement)
 *   2. Their `inspection_evidence_requirements` rows (kind 'photo',
 *      required, min/max counts) — keyed (template_id, sort_order).
 *
 * RUN
 *   NEXPEC_SUPABASE_URL=https://<ref>.supabase.co \
 *   NEXPEC_SERVICE_ROLE_KEY=<service-role key>    \
 *   node scripts/qa/seed-evidence-requirements.mjs
 *
 *   Refuses to run against the production project ref as a guard.
 */

const URL_ = process.env.NEXPEC_SUPABASE_URL;
const KEY = process.env.NEXPEC_SERVICE_ROLE_KEY;
const PROD_REF = 'sxqpjxhslzzcdrdctatm';

if (!URL_ || !KEY) {
  console.error('Set NEXPEC_SUPABASE_URL and NEXPEC_SERVICE_ROLE_KEY.');
  process.exit(1);
}
if (URL_.includes(PROD_REF)) {
  console.error('Refusing to seed the PRODUCTION project.');
  process.exit(1);
}

async function api(path, opts = {}) {
  const r = await fetch(URL_ + path, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const t = await r.text();
  if (r.status >= 400) throw new Error(`${path} -> ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const TEMPLATES = [
  {
    slug: 'api_510_pressure_vessel_inspection',
    name: 'API 510 Pressure Vessel Inspection',
    category: 'Pressure vessel inspection',
    domain: 'industrial_ndt',
    validity_months: 60,
    base_price_cents: 250000,
    requires_credential_tier: 'cci_advanced',
    description_md: 'Pressure vessel internal/external inspection to API 510.',
    requirements: [
      { sort_order: 1, kind: 'photo', label: 'Vessel nameplate photograph', hint: 'Legible data plate incl. MAWP and serial', required: true, min_count: 1, max_count: 3 },
      { sort_order: 2, kind: 'photo', label: 'Shell external condition', hint: 'General shot of the shell showing coating/corrosion state', required: true, min_count: 1, max_count: 5 },
    ],
  },
  {
    slug: 'structural_weld_visual_inspection',
    name: 'Structural Weld Visual Inspection',
    category: 'Weld inspection',
    domain: 'industrial_ndt',
    validity_months: 36,
    base_price_cents: 120000,
    requires_credential_tier: 'cci_advanced',
    description_md: 'Visual weld inspection of structural connections.',
    requirements: [
      { sort_order: 1, kind: 'photo', label: 'Weld bead close-up', hint: 'Perpendicular close-up of the weld bead surface', required: true, min_count: 1, max_count: 5 },
    ],
  },
  {
    slug: 'radiographic_weld_review_rt',
    name: 'Radiographic Weld Film Review (RT)',
    category: 'Pressure vessel inspection',
    domain: 'industrial_ndt',
    validity_months: 60,
    base_price_cents: 180000,
    requires_credential_tier: 'cci_advanced',
    description_md: 'QA owner-review fixture template for the on-device RT detector.',
    requirements: [
      { sort_order: 1, kind: 'photo', label: 'RT film photograph', hint: 'Photograph of the radiographic film on a viewer', required: true, min_count: 1, max_count: 3 },
    ],
  },
];

let createdT = 0, keptT = 0, createdR = 0, keptR = 0;

for (const t of TEMPLATES) {
  const found = await api(`/rest/v1/inspection_scope_templates?slug=eq.${t.slug}&select=id`);
  let id = found[0]?.id;
  if (!id) {
    const { requirements, ...cols } = t;
    const ins = await api('/rest/v1/inspection_scope_templates', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ ...cols, version: 1, region: 'global', is_active: true }),
    });
    id = ins[0].id; createdT++;
  } else { keptT++; }

  for (const req of t.requirements) {
    const ex = await api(
      `/rest/v1/inspection_evidence_requirements?template_id=eq.${id}&sort_order=eq.${req.sort_order}&select=id`,
    );
    if (ex[0]) { keptR++; continue; }
    await api('/rest/v1/inspection_evidence_requirements', {
      method: 'POST',
      body: JSON.stringify({ ...req, template_id: id }),
    });
    createdR++;
  }
  console.log(`${t.slug}: template ${id}`);
}

console.log(`templates: ${createdT} created, ${keptT} existing · requirements: ${createdR} created, ${keptR} existing`);
