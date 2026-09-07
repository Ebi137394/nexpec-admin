#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-profile-write-contracts.mjs
//
//  Guards the class of defect behind the "inspector uploaded everything and
//  Admin shows nothing" incident: the CLIENT writes one column and the READER
//  reads a different one, so data lands in Production and stays invisible.
//
//  Nothing here needs database access. Every check is a static assertion over
//  the source, so it runs in CI on every PR.
//
//  Run: node scripts/qa/check-profile-write-contracts.mjs
//  Exit 0 = clean, 1 = a contract regressed.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const failures = [];
const passes = [];

function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function check(name, rel, fn) {
  const src = read(rel);
  if (src === null) {
    failures.push(`${name}\n    file not found: ${rel}`);
    return;
  }
  const problem = fn(src);
  if (problem) failures.push(`${name}\n    ${rel}: ${problem}`);
  else passes.push(name);
}

/* ── 1. Zero-row UPDATEs must not be reported as success ──────────────────
   PostgREST returns success for an UPDATE that matched no rows, so an RLS
   refusal silently renders as "Saved". Every profile write must therefore
   ask for a row back and check it. */
const MUST_GUARD = [
  ['web: inspector settings', 'apps/web/src/lib/actions/inspectorSettings.ts'],
  ['web: client settings', 'apps/web/src/lib/actions/clientSettings.ts'],
  ['web: resume upload', 'apps/web/src/lib/actions/uploadResume.ts'],
  ['web: avatar upload', 'apps/web/src/lib/actions/uploadAvatar.ts'],
  ['web: admin profile edit', 'apps/web/src/lib/actions/adminEditProfile.ts'],
  ['mobile: profile edit', 'app/profile/edit.tsx'],
  ['mobile: rates', 'app/profile/rates.tsx'],
  ['mobile: skills', 'app/profile/skills.tsx'],
  ['mobile: experience', 'app/profile/experience.tsx'],
];

for (const [label, rel] of MUST_GUARD) {
  check(`${label} — profiles UPDATE checks affected rows`, rel, (src) => {
    // Find each `.update(` on profiles and require a `.select(` before the
    // statement ends. Cheap but effective: the bug is always a missing
    // .select() on the same call chain.
    const chains = src.split('.update(');
    for (let i = 1; i < chains.length; i++) {
      const tail = chains[i].slice(0, 400);
      const before = chains[i - 1].slice(-200);
      if (!/from\(\s*['"]profiles['"]\s*\)/.test(before)) continue;
      if (!/\.select\(/.test(tail)) {
        return 'a profiles UPDATE has no .select() — a zero-row update would be reported as success';
      }
    }
    return null;
  });
}

/* ── 2. The professional-title split brain ────────────────────────────────
   public.profiles has BOTH `title` and `professional_title`. Mobile used to
   write only `title` while every reader read `professional_title`. */
check(
  'mobile: profile edit writes BOTH title columns',
  'app/profile/edit.tsx',
  (src) =>
    /updates\.professional_title\s*=/.test(src) && /updates\.title\s*=/.test(src)
      ? null
      : 'must write both `title` and `professional_title`, or the value is invisible on the other surface',
);

check(
  'admin: user detail reads BOTH title columns',
  'apps/web/src/lib/data/adminUserDetail.ts',
  (src) =>
    /'professional_title'/.test(src) && /'title'/.test(src)
      ? null
      : 'must select both `professional_title` and `title`',
);

/* ── 3. The CV column ─────────────────────────────────────────────────────
   `resumes` is a PRIVATE bucket. resume_path holds the object path and is
   signed at read time; resume_url is a legacy public-URL column and a path
   written there is invisible and unopenable. */
check(
  'mobile: CV upload writes resume_path, not resume_url',
  'app/profile/experience.tsx',
  (src) => {
    if (/\.update\(\s*\{\s*resume_url:\s*filePath/.test(src)) {
      return 'writes the storage path into resume_url; the live column is resume_path';
    }
    return /resume_path:\s*filePath/.test(src)
      ? null
      : 'does not write resume_path';
  },
);

check(
  'admin: user detail reads resume_path',
  'apps/web/src/lib/data/adminUserDetail.ts',
  (src) =>
    /'resume_path'/.test(src)
      ? null
      : 'does not select resume_path — an uploaded CV would be invisible',
);

check(
  'admin: dossier signs the CV rather than linking a dead public URL',
  'apps/web/src/lib/data/adminInspector360.ts',
  (src) =>
    /createSignedUrl/.test(src) && /RESUME_BUCKET/.test(src)
      ? null
      : 'must mint a signed URL for the private resumes bucket',
);

/* ── 4. Admin must read the tables users actually write ───────────────────
   Certificates, documents, work history and equipment all live outside
   `profiles`. Reading only `profiles` is what made a real inspector look
   like an empty account. */
for (const table of [
  'certifications',
  'inspector_documents',
  'work_experience',
  'inspector_credentials',
]) {
  check(
    `admin: dossier queries ${table}`,
    'apps/web/src/lib/data/adminInspector360.ts',
    (src) =>
      new RegExp(`['"]${table}['"]`).test(src)
        ? null
        : `does not query ${table} — evidence stored there would be invisible`,
  );
}

/* ── 5. Rates screen must only name columns that exist ────────────────────
   These nine were referenced by app/profile/rates.tsx and exist on no table,
   so the screen 400'd on load and rates could never be saved from mobile. */
const NONEXISTENT_COLUMNS = [
  'daily_rate',
  'travel_rate',
  'minimum_hours',
  'payment_terms_days',
  'tax_id',
];
// Only DB-facing surfaces are checked. The FORM may legitimately keep fields
// called daily_rate / minimum_hours — those are UI state, translated to real
// columns at the boundary. What must never contain them is the PostgREST
// .select() projection and the typed update payload.
check(
  'mobile: rates SELECT projection names no phantom columns',
  'app/profile/rates.tsx',
  (src) => {
    const projection = src.match(/\.select\(`([\s\S]*?)`\)/)?.[1];
    if (!projection) return 'could not find the profiles .select() projection';
    const hits = NONEXISTENT_COLUMNS.filter((c) =>
      new RegExp(`(^|[^_a-zA-Z])${c}\\s*(,|$)`, 'm').test(projection),
    );
    return hits.length
      ? `SELECTs columns that do not exist on public.profiles (PostgREST returns 400 and the screen cannot load): ${hits.join(', ')}`
      : null;
  },
);

check(
  'mobile: rates update payload names no phantom columns',
  'types/financial.ts',
  (src) => {
    const body = src.match(
      /interface FinancialUpdatePayload \{([\s\S]*?)\n\}/,
    )?.[1];
    if (!body) return 'could not find FinancialUpdatePayload';
    const code = body
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    const hits = NONEXISTENT_COLUMNS.filter((c) =>
      new RegExp(`(^|[^_a-zA-Z])${c}\\s*[?]?:`, 'm').test(code),
    );
    return hits.length
      ? `writes columns that do not exist on public.profiles: ${hits.join(', ')}`
      : null;
  },
);

/* ── 6. Verification semantics ────────────────────────────────────────────
   profiles.verification_status is an ADMIN decision about the ACCOUNT. It
   must never be rendered as a bare "Verified", which reads as "credentials
   confirmed". */
check(
  'admin: account verification is not labelled as bare "Verified"',
  'apps/web/src/app/admin/users/[id]/page.tsx',
  (src) =>
    /Account verified/.test(src)
      ? null
      : 'the header chip must distinguish account verification from credential verification',
);

/* ── 7. Admin edit must not be able to verify anyone ──────────────────────
   The generic profile editor is explicitly barred from the review columns. */
check(
  'admin: profile editor cannot write verification columns',
  'apps/web/src/lib/actions/adminEditProfile.ts',
  (src) => {
    const forbidden = [
      'verification_status',
      'is_verified',
      'verified_at',
      'verified_by',
      'marketplace_activated',
      'balance_cents',
    ];
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    // The allowlist is built with put('col', …) / u.col = …; a forbidden
    // column appearing in code (not prose) means the boundary leaked.
    const hits = forbidden.filter((c) =>
      new RegExp(`put\\(\\s*['"]${c}['"]|u\\.${c}\\s*=`).test(code),
    );
    return hits.length
      ? `writes columns it must never write: ${hits.join(', ')}`
      : null;
  },
);

/* ── 8. Completeness must not be re-implemented ───────────────────────────
   Admin, onboarding, the reminder sweep and Telegram /pending must all read
   the same SQL rule or they will disagree. */
check(
  'admin: completeness comes from the canonical SQL rule',
  'apps/web/src/lib/data/adminInspector360.ts',
  (src) =>
    /nx_role_missing_fields/.test(src)
      ? null
      : 'must call nx_role_missing_fields rather than deriving completeness locally',
);

/* ── report ───────────────────────────────────────────────────────────── */
console.log(`\nprofile write-contract guard — ${passes.length} passed, ${failures.length} failed\n`);
if (failures.length) {
  console.log('✗ FAILED\n');
  for (const f of failures) console.log(`  • ${f}\n`);
  console.log(
    'These are data-loss contracts: a break here means a user saves something\n' +
      'and nobody can see it. Fix the contract, do not relax the check.\n',
  );
  process.exit(1);
}
for (const p of passes) console.log(`  ✓ ${p}`);
console.log('\n✓ all profile write contracts intact\n');
