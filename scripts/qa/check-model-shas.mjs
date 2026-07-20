#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
//  scripts/qa/check-model-shas.mjs — model-artifact integrity guard.
//
//  The shared registry (packages/shared-core/src/ml/modelRegistry.ts) pins the
//  SHA-256 of every trained model. This guard proves the ACTUAL bytes shipped
//  to BOTH shells match those pins:
//    • assets/<file>                  → bundled into the mobile app (Metro)
//    • apps/web/public/models/<file>  → served same-origin to the browser
//
//  Run: npm run qa:model-shas   (exit 1 on any mismatch / missing file)
// ════════════════════════════════════════════════════════════════════════════
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = resolve(ROOT, 'packages/shared-core/src/ml/modelRegistry.ts');

const src = readFileSync(REGISTRY, 'utf8');
// Parse each entry's { slug, sha256, assetFile } from the registry source.
const entries = [];
const re = /slug:\s*'([^']+)'[\s\S]*?sha256:\s*'([a-f0-9]{64})'[\s\S]*?assetFile:\s*'([^']+)'/g;
let m;
while ((m = re.exec(src)) !== null) entries.push({ slug: m[1], sha256: m[2], assetFile: m[3] });

if (entries.length === 0) {
  console.error('✗ model-shas: no entries parsed from modelRegistry.ts (regex drift?)');
  process.exit(1);
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
let fail = 0;
for (const e of entries) {
  for (const rel of [`assets/${e.assetFile}`, `apps/web/public/models/${e.assetFile}`]) {
    const p = resolve(ROOT, rel);
    if (!existsSync(p)) { console.error(`✗ ${e.slug}: MISSING ${rel}`); fail++; continue; }
    const h = sha256(p);
    if (h !== e.sha256) { console.error(`✗ ${e.slug}: SHA MISMATCH ${rel}\n    registry ${e.sha256}\n    actual   ${h}`); fail++; }
  }
}
if (fail) { console.error(`✗ model-shas: ${fail} problem(s).`); process.exit(1); }
console.log(`✓ model-shas: ${entries.length} model(s) × 2 locations verified against the shared registry.`);
