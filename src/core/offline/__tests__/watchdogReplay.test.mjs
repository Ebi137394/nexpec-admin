// ════════════════════════════════════════════════════════════════════════════
//  D36 — the singleton drain worker must never wedge on one hung op.
//
//  Observed live on the release APK (2026-08-18): a capture upload whose
//  socket opened during a Wi-Fi reconnect flap never settled. `draining`
//  stayed true for the rest of the process, so every later trigger —
//  reconnect, foreground, the 60s poll — silently no-oped, and offline
//  captures stopped syncing until an app restart bounced the in_flight row.
//
//  This suite proves, against the REAL sync.ts/outbox.ts/operations.ts:
//    1. a never-settling handler is abandoned by the per-op watchdog and
//       flushQueue RESOLVES (the wedge is gone);
//    2. the abandoned op is bounced to pending with backoff, not lost and
//       not dead-lettered;
//    3. once the hang clears, the SAME op drains to completion (file +
//       row land), because capture_save is idempotent by contract.
//
//  Run:
//    NODE_OPTIONS=--experimental-sqlite node --test src/core/offline/__tests__/watchdogReplay.test.mjs
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  offlineApi,
  sync,
  server,
  fsState,
  setOnline,
  resetOutbox,
  rowFor,
  uuid,
} from './harness.mjs';
// Same module instance the handlers see (harness maps the app's supabase
// specifier to this file), so patching storage here patches the real path.
import { supabase } from './fakes/supabaseServer.mjs';

let JOB;
let INSPECTOR;

const realStorageFrom = supabase.storage.from;

beforeEach(async () => {
  server.reset();
  fsState.reset();
  await resetOutbox();
  setOnline(false);
  await sync.resumeSync();
  supabase.storage.from = realStorageFrom;

  JOB = uuid();
  INSPECTOR = uuid();
  server.addJob(JOB, INSPECTOR);
  server.setTeamStatus(JOB, INSPECTOR, 'active');
  server.signInAs(INSPECTOR);
});

function photoCapture(id) {
  return {
    id,
    job_id: JOB,
    requirement_id: uuid(),
    inspector_id: INSPECTOR,
    kind: 'photo',
    sort_index: 0,
    captured_at: new Date().toISOString(),
    device_platform: 'android',
    storage_path: `captures/${JOB}/req/${id}.jpg`,
    capture_sha256: 'sha-' + id,
    prev_capture_sha256: null,
    text_payload: null,
    server_validation_status: 'pending',
  };
}

describe('D36 per-op watchdog', () => {
  it('abandons a hung upload, releases the worker, and completes the op on retry', async () => {
    sync.setOpWatchdogMs(150);
    try {
      const capId = uuid();
      const localUri = `file:///cache/${capId}.jpg`;
      fsState.files.set(localUri, Buffer.from('jpeg-bytes').toString('base64'));

      // The live failure: an upload whose promise never settles.
      let hangs = 0;
      supabase.storage.from = () => ({
        upload: () => {
          hangs += 1;
          return new Promise(() => {});
        },
      });

      const opId = await offlineApi.enqueueCaptureSave({
        capture: photoCapture(capId),
        bucket: 'compliance',
        localFilePath: localUri,
      });

      setOnline(true);
      const t0 = Date.now();
      await sync.flushQueue(); // pre-fix: never resolves — the wedge
      const elapsed = Date.now() - t0;

      assert.equal(hangs, 1, 'the hung upload was attempted exactly once');
      assert.ok(elapsed < 5_000, `flushQueue resolved via watchdog (took ${elapsed}ms)`);

      // 2 — bounced for retry, not lost, not dead-lettered.
      const bounced = await rowFor(opId);
      assert.equal(bounced.status, 'pending', 'op stays pending');
      assert.equal(bounced.attempts, 1, 'one attempt burned');
      assert.ok(bounced.next_attempt_at > Date.now(), 'backoff scheduled');
      assert.match(bounced.last_error, /watchdog|abandoned/i, 'evidence names the watchdog');

      // The worker is free: a second pass right now must not wedge either
      // (the row is inside backoff, so the pass just finds nothing due).
      await sync.flushQueue();
      assert.equal(hangs, 1, 'row inside backoff is not re-attempted early');

      // 3 — hang clears (network sane again); expire the backoff and drain.
      supabase.storage.from = realStorageFrom;
      const { getDb } = await import('../db.ts');
      const db = await getDb();
      await db.runAsync('UPDATE outbox_operations SET next_attempt_at = ? WHERE client_op_id = ?', [
        Date.now() - 1,
        opId,
      ]);

      await sync.flushQueue();

      assert.equal(await rowFor(opId), null, 'op completed and left the queue');
      assert.equal(server.captures.has(capId), true, 'capture row landed');
      assert.equal(
        server.storageWrites.filter((w) => w.bucket === 'compliance' && w.path.includes(capId)).length,
        1,
        'file landed exactly once',
      );
    } finally {
      sync.setOpWatchdogMs(180_000);
      supabase.storage.from = realStorageFrom;
    }
  });
});
