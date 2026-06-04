#!/usr/bin/env node
// ============================================================================
//  scripts/ops/merge-bucket.mjs
//
//  Storage-API bucket maintenance (SQL cannot touch storage.* rows —
//  storage.protect_delete blocks it). Two modes:
//
//   1) MERGE:  move every object from SOURCE → DEST (preserving paths), then
//      optionally delete the source object and finally the empty source bucket.
//        SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//          node scripts/ops/merge-bucket.mjs <source> <dest> [--delete]
//
//   2) DROP-EMPTY: delete an already-empty bucket.
//        SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
//          node scripts/ops/merge-bucket.mjs --drop-empty <bucket>
//
//  Safe by default: merge copies only. Pass --delete to remove source objects
//  after a verified copy and then drop the emptied source bucket. Re-runnable
//  (skips dest objects that already exist).
// ============================================================================

import { createClient } from '@supabase/supabase-js';

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith('--'));
const positionals = argv.filter((a) => !a.startsWith('--'));
const DROP_EMPTY = flags.includes('--drop-empty');
const DELETE = flags.includes('--delete');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(2);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

async function bucketCount(bucket) {
  // Walk to count (list is paginated); cheap enough for retirement checks.
  let n = 0;
  for await (const _ of walk(bucket)) n += 1;
  return n;
}

async function* walk(bucket, prefix = '') {
  const LIMIT = 100;
  let page = 0;
  for (;;) {
    const { data, error } = await db.storage
      .from(bucket)
      .list(prefix, { limit: LIMIT, offset: page * LIMIT, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) yield* walk(bucket, path); // folder
      else yield path;
    }
    if (data.length < LIMIT) break;
    page += 1;
  }
}

async function dropBucket(bucket) {
  const count = await bucketCount(bucket);
  if (count > 0) {
    console.error(`refuse: ${bucket} still holds ${count} object(s). Merge/empty first.`);
    process.exit(1);
  }
  const { error } = await db.storage.deleteBucket(bucket);
  if (error) { console.error(`deleteBucket(${bucket}) failed: ${error.message}`); process.exit(1); }
  console.log(`✓ dropped empty bucket ${bucket}`);
}

// ── Mode 2: drop-empty ──
if (DROP_EMPTY) {
  const bucket = positionals[0];
  if (!bucket) { console.error('usage: merge-bucket.mjs --drop-empty <bucket>'); process.exit(2); }
  await dropBucket(bucket);
  process.exit(0);
}

// ── Mode 1: merge ──
const [SRC, DEST] = positionals;
if (!SRC || !DEST) {
  console.error('usage: merge-bucket.mjs <source> <dest> [--delete]   |   --drop-empty <bucket>');
  process.exit(2);
}

let copied = 0, skipped = 0, removed = 0;
console.log(`merge-bucket: ${SRC} → ${DEST}${DELETE ? ' (+delete source)' : ' (copy-only)'}`);

for await (const path of walk(SRC)) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const base = path.slice(path.lastIndexOf('/') + 1);
  const { data: existing } = await db.storage.from(DEST).list(dir, { search: base, limit: 1 });
  if (existing && existing.some((e) => e.name === base)) { skipped += 1; continue; }

  const { data: blob, error: dlErr } = await db.storage.from(SRC).download(path);
  if (dlErr) { console.error(`  ✗ download ${path}: ${dlErr.message}`); continue; }
  const buf = Buffer.from(await blob.arrayBuffer());
  const { error: upErr } = await db.storage.from(DEST).upload(path, buf, {
    contentType: blob.type || 'application/octet-stream', upsert: false,
  });
  if (upErr) { console.error(`  ✗ upload ${path}: ${upErr.message}`); continue; }
  copied += 1;

  if (DELETE) {
    const { error: rmErr } = await db.storage.from(SRC).remove([path]);
    if (rmErr) console.error(`  ! copied but could not delete source ${path}: ${rmErr.message}`);
    else removed += 1;
  }
}

console.log(`done: ${copied} copied, ${skipped} already present, ${removed} source removed.`);

if (DELETE) {
  const left = await bucketCount(SRC);
  if (left === 0) await dropBucket(SRC);
  else console.log(`source still has ${left} object(s) — re-run, then --drop-empty ${SRC}.`);
} else {
  console.log(`copy-only: re-run with --delete once verified to remove source objects + drop the empty bucket.`);
}
