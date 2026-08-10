// ─────────────────────────────────────────────────────────────────
//  Test harness for src/core/offline.
//
//  The repo's only JS test runner (vitest, packages/shared-core) cannot
//  execute here: its rolldown native binding is darwin-arm64-only and the
//  npm registry is blocked, so `npm test -w @nexpec/shared-core` dies with
//  MODULE_NOT_FOUND on rolldown-binding.linux-arm64-gnu.node. Its
//  vitest.config.ts `include` is also rooted at packages/shared-core, so it
//  never covered src/core/offline in the first place.
//
//  This harness therefore runs the REAL modules (outbox.ts, sync.ts,
//  operations.ts, index.ts — unmodified) under Node's built-in `node:test`
//  runner, substituting only the four platform boundaries:
//
//     expo-sqlite                    -> node:sqlite (real SQL, real migrations)
//     expo-file-system               -> in-memory file table
//     @/src/core/supabase/supabase   -> PostgREST + RLS simulator
//     ./network                      -> deterministic connectivity
//
//  @nexpec/shared-core resolves to the REAL classifier source, so failure
//  classification is not simulated.
//
//  Run:
//    NODE_OPTIONS=--experimental-sqlite \
//      node --test src/core/offline/__tests__/visitReplay.test.mjs
//
//  The tests are .mjs on purpose: the root tsconfig includes **/*.ts, so a .ts
//  test here would be pulled into every app-wide typecheck.
// ─────────────────────────────────────────────────────────────────

import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const offlineDir = path.resolve(here, '..');
const repoRoot = path.resolve(here, '../../../..');

const url = (p) => pathToFileURL(p).href;

const BARE = new Map([
  ['expo-sqlite', url(path.join(here, 'fakes/expoSqlite.mjs'))],
  ['expo-file-system', url(path.join(here, 'fakes/expoFileSystem.mjs'))],
  ['@/src/core/supabase/supabase', url(path.join(here, 'fakes/supabaseServer.mjs'))],
  ['@nexpec/shared-core', url(path.join(repoRoot, 'packages/shared-core/src/offline/syncErrors.ts'))],
]);

const NETWORK_FAKE = url(path.join(here, 'fakes/network.mjs'));
const offlineDirUrl = url(offlineDir) + '/';

registerHooks({
  resolve(spec, ctx, next) {
    const mapped = BARE.get(spec);
    if (mapped) return { url: mapped, shortCircuit: true };

    const fromOffline = ctx.parentURL?.startsWith(offlineDirUrl);
    if (fromOffline && (spec === './network' || spec === './network.ts')) {
      return { url: NETWORK_FAKE, shortCircuit: true };
    }
    // The source uses extensionless relative specifiers (Metro resolution).
    if (fromOffline && spec.startsWith('./') && path.extname(spec) === '') {
      return next(`${spec}.ts`, ctx);
    }
    return next(spec, ctx);
  },
});

// ── Load the real modules under test ──────────────────────────────
export const outbox = await import(url(path.join(offlineDir, 'outbox.ts')));
export const sync = await import(url(path.join(offlineDir, 'sync.ts')));
export const operations = await import(url(path.join(offlineDir, 'operations.ts')));
export const offlineApi = await import(url(path.join(offlineDir, 'index.ts')));
export const dbmod = await import(url(path.join(offlineDir, 'db.ts')));

export { server } from './fakes/supabaseServer.mjs';
export { fsState } from './fakes/expoFileSystem.mjs';
export { setOnline } from './fakes/network.mjs';

/** Wipe the outbox between tests without recreating the cached DB handle. */
export async function resetOutbox() {
  const db = await dbmod.getDb();
  await db.runAsync('DELETE FROM outbox_operations');
}

/** Every outbox row, oldest first. */
export async function allRows() {
  const db = await dbmod.getDb();
  return db.getAllAsync('SELECT * FROM outbox_operations ORDER BY id ASC');
}

export async function rowFor(clientOpId) {
  const db = await dbmod.getDb();
  return db.getFirstAsync('SELECT * FROM outbox_operations WHERE client_op_id = ?', [clientOpId]);
}

export function uuid() {
  return globalThis.crypto.randomUUID();
}
