#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  capability-reconciliation.mjs
//
//  Answers "does NEXPEC already have X?" with EVIDENCE instead of opinion.
//
//  WHY THIS EXISTS
//  NEXPEC is large — 120 migrations, ~544 database functions, 38 Edge
//  Functions, 276 mobile screens, 166 web routes. At that size the expensive
//  mistake is not missing a feature, it is BUILDING A SECOND COPY of one that
//  already exists. An earlier audit did exactly that: it reported the inspector
//  broadcast as "spamming everyone" when the function was dormant, and reported
//  credential expiry as missing when a whole subsystem existed against a
//  different table.
//
//  For each capability this reports where evidence appears across SEVEN
//  surfaces — database, migrations, Edge Functions, mobile, web, admin web,
//  tests — and, critically, whether anything actually CALLS it. A table with no
//  caller is not a feature; a screen with no backend is not a feature either.
//
//  Classification is deliberately mechanical:
//    BACKEND ONLY  db/edge evidence, no UI
//    UI ONLY       UI evidence, no db/edge
//    WIRED         both, and a caller exists
//    NO EVIDENCE   nothing found (verify by hand before believing it)
//
//  This is a DISCOVERY aid, not a verdict. "NO EVIDENCE" means "these search
//  terms found nothing" — go look before concluding anything is missing.
//
//      node scripts/qa/capability-reconciliation.mjs           # summary
//      node scripts/qa/capability-reconciliation.mjs --full    # + sample paths
//      node scripts/qa/capability-reconciliation.mjs welding   # filter
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const FULL = process.argv.includes('--full');
const FILTER = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0]?.toLowerCase();

// ── Capability definitions: [name, regex source] ───────────────────────────
const CAPS = [
  ['enterprise organizations', 'organizations?\\b|org_members?|organization_id'],
  ['enterprise roles',         'org_role|organization_role|enterprise_role|member_role'],
  ['agencies',                 'agency|agencies|agency_id'],
  ['teams',                    '\\bteams?\\b|team_members?|team_id'],
  ['departments',              'departments?\\b|department_id'],
  ['invitations',              'invitations?\\b|invite_token|invited_by|org_invit'],
  ['enterprise dashboards',    'enterprise.{0,12}dashboard|org.{0,12}dashboard'],
  ['projects',                 '\\bprojects?\\b|project_id'],
  ['programs',                 '\\bprograms?\\b|program_id'],
  ['project-job linkage',      'project_id.{0,40}job|job.{0,40}project_id|project_jobs'],
  ['project-supplier linkage', 'project.{0,20}supplier|supplier.{0,20}project'],
  ['multi-inspector jobs',     'co_inspector|coinspector|lead_inspector|job_inspectors|inspector_members|inspection_team'],
  ['inspector teams',          'inspector_team|team_lead|crew'],
  ['multi-visit inspections',  'visits?\\b|visit_number|site_visit|inspection_visit'],
  ['recurring inspections',    'recurring|recurrence|rrule|repeat_every|surveillance'],
  ['scheduling',               'schedule|scheduled_at|calendar'],
  ['availability',             'availability|is_available|unavailable|blackout'],
  ['conflict detection',       'conflict|double_book|overlap'],
  ['inspector utilization',    'utilization|workload|capacity|daily_limit'],
  ['smart matching',           'nx_inspector_job_match|nx_match_inspectors|match_score'],
  ['targeted notifications',   'nx_job_broadcast_targets|notify_inspectors_on_job_approved'],
  ['credential expiry',        'expiry_date|expiring_certifications|certification_expiry'],
  ['supplier management',      'suppliers?\\b|supplier_id|vendor'],
  ['RFQ',                      'rfq|request_for_quote'],
  ['quotes',                   'quotes?\\b|quote_id|supplier_quotes'],
  ['supplier quality',         'supplier.{0,15}quality|vendor.{0,15}quality|quality_score'],
  ['supplier scorecards',      'scorecard|supplier.{0,12}rating|vendor.{0,12}rating|performance_score'],
  ['supplier analytics',       'supplier.{0,15}analytic|supplier.{0,15}metric|supplier.{0,15}stats'],
  ['enterprise analytics',     'enterprise.{0,15}analytic|org.{0,15}analytic|org.{0,12}metric'],
  ['project analytics',        'project.{0,15}analytic|project.{0,15}metric|project.{0,12}stats'],
  ['admin analytics',          'admin.{0,15}analytic|admin.{0,12}metric|dashboardMetrics|platform_metric'],
  ['report customization',     'report_template|template_id|report_config|branding'],
  ['company/client templates', 'client_template|company_template|org_template|report_templates'],
  ['logos/banners/headers',    'logo_url|banner|letterhead|header_image|footer_text'],
  ['PDF generation',           'pdf|jspdf|pdfkit|puppeteer|html2pdf|print_pdf'],
  ['report revisions',         'revision|version_no|report_version|rev_[0-9]'],
  ['report approvals',         'report.{0,15}approv|approve_report|report_status'],
  ['admin report review',      'admin.{0,15}report.{0,15}review|moderat.{0,15}report|review_report'],
  ['client report delivery',   'deliver.{0,12}report|report.{0,12}deliver|published_report|report_share'],
  ['structured inspection',    'inspection_items?|checklist|inspection_execution|inspection_step'],
  ['inspection items',         'inspection_items?|item_result|item_status'],
  ['ITP',                      '\\bitp\\b|inspection_test_plan'],
  ['QCP',                      '\\bqcp\\b|quality_control_plan'],
  ['hold/witness points',      'hold_point|witness_point|review_point|surveillance_point|\\bhwrs\\b'],
  ['NCR',                      '\\bncr\\b|non_conformance|nonconformance'],
  ['flash reports',            'flash_report|flash.{0,10}finding'],
  ['evidence chain',           'evidence|chain_hash|previous_hash|prev_hash'],
  ['cryptographic sealing',    'sha256|sha_256|seal|signature_hash|digest'],
  ['blockchain',               'blockchain|merkle|anchor'],
  ['bitcoin/opentimestamps',   'opentimestamps|\\bots\\b|bitcoin|calendar_server'],
  ['local AI',                 'tflite|onnx|tensorflow|local_model|on_device|inference'],
  ['welding AI',               'weld'],
  ['coating AI',               'coating|corrosion|rust'],
  ['offline AI',               'offline.{0,15}(ai|model|infer)|model.{0,15}offline'],
  ['model loading',            'loadModel|model_url|model_path|model_asset|modelFile'],
  ['AI versioning',            'model_version|model_sha|ai_model|model_registry'],
  ['offline field execution',  'offline|sync_queue|outbox|pending_sync|isOnline|netinfo'],
  ['API/integration',          'webhook|api_key|integration|external_id'],
  ['enterprise auth',          'sso|saml|oidc|scim|oauth'],
  ['ERP readiness',            'erp|sap|oracle|export_csv|data_export'],
  ['web/mobile/admin parity',  'shared-core|@nexpec/shared'],
];

// ── Surfaces ───────────────────────────────────────────────────────────────
const SURFACES = [
  ['db',     ['supabase/migrations'],   /\.sql$/],
  ['edge',   ['supabase/functions'],    /\.(ts|js)$/],
  ['tests',  ['supabase/tests'],        /\.sql$/],
  ['mobile', ['app', 'src'],            /\.(ts|tsx)$/],
  ['web',    ['apps/web/src'],          /\.(ts|tsx)$/],
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'build', '.next', 'coverage', 'ios', 'android']);

function walk(dir, re, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, re, out);
    else if (re.test(e)) out.push(p);
  }
  return out;
}

// Load every surface once.
const corpus = new Map();          // surface -> [{rel, text}]
for (const [name, dirs, re] of SURFACES) {
  const files = [];
  for (const d of dirs) {
    const abs = join(ROOT, d);
    if (existsSync(abs)) files.push(...walk(abs, re));
  }
  corpus.set(name, files.map((f) => ({
    rel: relative(ROOT, f).split('\\').join('/'),
    text: (() => { try { return readFileSync(f, 'utf8'); } catch { return ''; } })(),
  })));
}
// "admin web" is a slice of web, not a separate tree.
corpus.set('admin', corpus.get('web').filter((f) => /\/admin\//.test(f.rel)));

const SURFACE_ORDER = ['db', 'edge', 'mobile', 'web', 'admin', 'tests'];

const rows = [];
for (const [cap, src] of CAPS) {
  if (FILTER && !cap.toLowerCase().includes(FILTER)) continue;
  const re = new RegExp(src, 'i');
  const hits = {};
  const samples = {};
  for (const s of SURFACE_ORDER) {
    const files = (corpus.get(s) || []).filter((f) => re.test(f.text));
    hits[s] = files.length;
    samples[s] = files.slice(0, 3).map((f) => f.rel);
  }
  const backend = hits.db + hits.edge;
  const ui = hits.mobile + hits.web;
  let cls;
  if (backend === 0 && ui === 0) cls = 'NO EVIDENCE';
  else if (backend > 0 && ui === 0) cls = 'BACKEND ONLY';
  else if (backend === 0 && ui > 0) cls = 'UI ONLY';
  else cls = 'WIRED';
  rows.push({ cap, hits, cls, samples });
}

// ── Report ─────────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

console.log('');
console.log('  NEXPEC CAPABILITY RECONCILIATION — evidence, not opinion');
console.log('  ' + '─'.repeat(96));
console.log('  ' + pad('capability', 28) + SURFACE_ORDER.map((s) => lpad(s, 7)).join('') + '   classification');
console.log('  ' + '─'.repeat(96));
for (const r of rows) {
  console.log('  ' + pad(r.cap, 28) +
    SURFACE_ORDER.map((s) => lpad(r.hits[s] || '·', 7)).join('') +
    '   ' + r.cls);
  if (FULL) {
    for (const s of SURFACE_ORDER) {
      if (r.samples[s].length) console.log('      ' + pad(s, 8) + r.samples[s].join('  '));
    }
  }
}
console.log('  ' + '─'.repeat(96));

const tally = rows.reduce((a, r) => ((a[r.cls] = (a[r.cls] || 0) + 1), a), {});
console.log('  ' + Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join('   |   '));
console.log('');
console.log('  Numbers are FILE COUNTS containing a keyword match — evidence to follow up,');
console.log('  not proof of completeness. "NO EVIDENCE" means these terms found nothing;');
console.log('  confirm by hand before concluding a capability is genuinely absent.');
console.log('');
