// ════════════════════════════════════════════════════════════════════════════
//  supabase/functions/tool-document/index.ts
//
//  DOCUMENT TOOLS executor (engine='edge'). Auth → entitlement → assemble a
//  structured document from the tool inputs → canonical-JSON SHA-256 seal →
//  log a tool_run (same trust spine as the DSL tools). Returns result_cards the
//  existing runner sheet renders + the full `document` payload.
//
//  Tools: auto_wps (Welding Procedure Specification draft), itp_generator
//  (Inspection & Test Plan with H/W/R/S/M matrix). Both access_tier='pro'.
//
//  config.toml: verify_jwt = true (a signed-in professional generates the doc).
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// deterministic JSON (sorted keys) → matches a canonical-hash discipline
function canon(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
}
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// ── Auto WPS draft (indicative ranges — verify against the cited code) ──
function assembleWps(inp: any) {
  const t = num(inp.base_thickness_mm);
  const groove = (inp.joint_type ?? 'groove') === 'groove';
  // ASME IX QW-451 style base-metal thickness range (indicative approximation)
  let tMin: number, tMaxLabel: string;
  if (!groove) { tMin = 0; tMaxLabel = 'All thicknesses (fillet, per QW-451.3)'; }
  else if (t >= 19) { tMin = 5; tMaxLabel = 'Up to maximum to be welded (≥19 mm coupon — verify QW-451 notes)'; }
  else { tMin = Math.max(1.5, +(0.5 * t).toFixed(1)); tMaxLabel = `${+(2 * t).toFixed(1)} mm`; }

  const wpsNo = `WPS-${String(inp.code ?? 'CODE').toUpperCase()}-${(inp.process ?? 'PRC')}`.replace(/[^A-Z0-9-]/g, '');
  return {
    type: 'WPS', status: 'DRAFT', generated_by: 'NEXPEC Auto WPS Generator',
    wps_no: wpsNo, revision: '0', code: inp.code, process: inp.process,
    base_metal: { specification: inp.base_metal, coupon_thickness_mm: t },
    filler_metal: { classification: inp.filler },
    joint: { type: inp.joint_type, position: inp.position },
    electrical: { current_type: inp.current_type },
    preheat: { minimum_c: num(inp.preheat_min_c) },
    qualified_ranges: {
      base_metal_thickness: { min_mm: tMin, max: tMaxLabel },
      position: groove ? 'As tested + flat (verify per QW-461)' : 'As tested',
    },
    notes: inp.notes ?? null,
    disclaimer: 'AUTO-GENERATED DRAFT. Qualified ranges are indicative; confirm against the cited code (e.g. ASME IX QW-451/QW-461) and a PQR before use.',
  };
}

// ── ITP with an H(old)/W(itness)/R(eview)/S(urveillance)/M(onitor) matrix ──
function assembleItp(inp: any) {
  const D = (inp.discipline ?? 'welding');
  const base = [
    { no: 10, activity: 'Document & procedure review (WPS/PQR, ITP, drawings)', ref: 'Project specs', contractor: 'R', tpa: 'R', client: 'R' },
    { no: 20, activity: 'Material receiving & mill certificate verification', ref: 'EN 10204 3.1', contractor: 'H', tpa: 'W', client: 'M' },
  ];
  const perDiscipline: Record<string, any[]> = {
    welding: [
      { no: 30, activity: 'Fit-up & joint preparation inspection', ref: 'WPS', contractor: 'H', tpa: 'W', client: 'M' },
      { no: 40, activity: 'In-process welding parameter monitoring', ref: 'WPS', contractor: 'M', tpa: 'S', client: 'M' },
      { no: 50, activity: 'Visual weld inspection (VT)', ref: 'ISO 5817 / AWS D1.1', contractor: 'H', tpa: 'W', client: 'M' },
      { no: 60, activity: 'NDE (RT/UT/MT/PT as applicable)', ref: 'ASME V', contractor: 'H', tpa: 'W', client: 'R' },
    ],
    ndt: [
      { no: 30, activity: 'Technique sheet & calibration verification', ref: 'ASME V', contractor: 'H', tpa: 'W', client: 'M' },
      { no: 40, activity: 'NDE execution & interpretation', ref: 'ASME V / acceptance code', contractor: 'H', tpa: 'W', client: 'R' },
      { no: 50, activity: 'Report review & disposition', ref: 'Project', contractor: 'R', tpa: 'R', client: 'R' },
    ],
    coating: [
      { no: 30, activity: 'Surface prep & profile (SSPC/NACE)', ref: 'SSPC-SP / NACE', contractor: 'H', tpa: 'W', client: 'M' },
      { no: 40, activity: 'DFT & holiday testing', ref: 'SSPC-PA2', contractor: 'H', tpa: 'W', client: 'M' },
    ],
    civil: [
      { no: 30, activity: 'Rebar & formwork pre-pour inspection', ref: 'ACI 318', contractor: 'H', tpa: 'W', client: 'M' },
      { no: 40, activity: 'Concrete compressive strength testing', ref: 'ASTM C39', contractor: 'H', tpa: 'R', client: 'R' },
    ],
    mechanical: [
      { no: 30, activity: 'Alignment & bolt-up verification', ref: 'API 686 / PCC-1', contractor: 'H', tpa: 'W', client: 'M' },
      { no: 40, activity: 'Pressure / leak test', ref: 'ASME B31.3 §345', contractor: 'H', tpa: 'W', client: 'R' },
    ],
  };
  const closeout = [{ no: 90, activity: 'Final documentation & data book compilation', ref: 'Project', contractor: 'H', tpa: 'R', client: 'H' }];
  return {
    type: 'ITP', status: 'DRAFT', generated_by: 'NEXPEC ITP Generator',
    project: inp.project_name, client: inp.client_name, discipline: D, scope: inp.scope,
    legend: { H: 'Hold point', W: 'Witness', R: 'Review', S: 'Surveillance', M: 'Monitor' },
    activities: [...base, ...(perDiscipline[D] ?? perDiscipline.welding), ...closeout],
    disclaimer: 'AUTO-GENERATED DRAFT ITP. Tailor responsibilities, references and hold points to the project contract before issue.',
  };
}

function assemble(toolKey: string, inputs: any) {
  if (toolKey === 'auto_wps') return assembleWps(inputs);
  if (toolKey === 'itp_generator') return assembleItp(inputs);
  return null;
}

function summarize(toolKey: string, doc: any, seal: string) {
  const sealCard = { label: 'Sealed', value: `${seal.slice(0, 12)}…`, unit: '', tone: 'success' };
  if (toolKey === 'auto_wps') {
    return [
      { label: 'WPS No.', value: doc.wps_no, unit: '', tone: 'default' },
      { label: 'Process', value: String(doc.process ?? ''), unit: '', tone: 'default' },
      { label: 'Qualified thickness', value: `${doc.qualified_ranges?.base_metal_thickness?.min_mm} – ${doc.qualified_ranges?.base_metal_thickness?.max}`, unit: '', tone: 'default' },
      sealCard,
    ];
  }
  if (toolKey === 'itp_generator') {
    return [
      { label: 'Project', value: String(doc.project ?? ''), unit: '', tone: 'default' },
      { label: 'Activities', value: String((doc.activities ?? []).length), unit: 'steps', tone: 'default' },
      sealCard,
    ];
  }
  return [sealCard];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json(401, { ok: false, error: 'unauthorized' });

  // verify the caller
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: ures } = await userClient.auth.getUser();
  const user = ures?.user;
  if (!user) return json(401, { ok: false, error: 'unauthorized' });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { ok: false, error: 'invalid_json' }); }
  const toolKey: string = body?.tool_key;
  const inputs = body?.inputs ?? {};
  if (!toolKey) return json(400, { ok: false, error: 'tool_key_required' });

  const svc = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: tool } = await svc.from('engineering_tools')
    .select('key,title,engine,access_tier,spec_version,standards_refs')
    .eq('key', toolKey).eq('is_active', true).maybeSingle();
  if (!tool) return json(404, { ok: false, error: 'unknown_tool' });
  if (tool.engine !== 'edge') return json(400, { ok: false, error: 'not_an_edge_tool' });

  // entitlement (admins pass via tool_has_pro_access god-mode)
  if (tool.access_tier === 'pro') {
    const { data: hasPro } = await svc.rpc('tool_has_pro_access', { p_uid: user.id });
    if (!hasPro) {
      return json(200, { ok: false, locked: true, tool: toolKey,
        result_cards: [{ label: 'Pro tool', value: 'Upgrade to unlock', unit: '', tone: 'warn' }] });
    }
  }

  const doc = assemble(toolKey, inputs);
  if (!doc) return json(400, { ok: false, error: 'no_assembler', detail: `No generator for ${toolKey}` });

  const result_sha256 = await sha256Hex(canon(doc));
  const input_sha256 = await sha256Hex(canon(inputs));

  // log the run on the trust spine (best-effort; never blocks the response)
  try {
    await svc.from('tool_runs').insert({
      tool_key: toolKey, tool_version: tool.spec_version, actor_id: user.id,
      inputs, outputs: doc, input_sha256, result_sha256,
    });
  } catch (_e) { /* ignore logging failure */ }

  return json(200, {
    ok: true, tool: toolKey, title: tool.title, document: doc,
    result_sha256, citations: tool.standards_refs ?? [],
    result_cards: summarize(toolKey, doc, result_sha256),
  });
});
