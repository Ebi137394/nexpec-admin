// ════════════════════════════════════════════════════════════════════════════
//  Phase 2H — Multi-Visit offline compatibility proof.
//
//  Nine questions, each answered by executing the REAL offline modules
//  (src/core/offline/{index,outbox,sync,operations,db}.ts) end to end:
//  enqueue -> SQLite -> drain loop -> handler -> server, with the real
//  @nexpec/shared-core failure classifier in the loop.
//
//  The server side is a faithful transcription of the live RLS predicates
//  (see fakes/supabaseServer.mjs for the migration line references), because
//  PostgreSQL cannot run in this environment.
//
//  Run:
//    NODE_OPTIONS=--experimental-sqlite node --test src/core/offline/__tests__/visitReplay.test.mjs
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  offlineApi,
  outbox,
  sync,
  server,
  fsState,
  setOnline,
  resetOutbox,
  allRows,
  rowFor,
  uuid,
} from './harness.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────

let JOB;
let INSPECTOR;
let SUCCESSOR;
let VISIT_1;

/** Mirrors the row built by app/(inspector)/compliance/job/[id]/capture.tsx:375. */
function captureRow(over = {}) {
  return {
    id: uuid(),
    job_id: JOB,
    requirement_id: uuid(),
    inspector_id: INSPECTOR,
    kind: 'photo',
    sort_index: 0,
    captured_at: new Date().toISOString(),
    device_platform: 'ios',
    capture_sha256: 'sha-' + uuid(),
    prev_capture_sha256: null,
    text_payload: null,
    server_validation_status: 'pending',
    ...over,
  };
}

async function drain() {
  setOnline(true);
  await sync.flushQueue();
  setOnline(false);
}

beforeEach(async () => {
  server.reset();
  fsState.reset();
  await resetOutbox();
  setOnline(false);
  // Clear any auth pause left by a previous test (no-ops while offline).
  await sync.resumeSync();

  JOB = uuid();
  INSPECTOR = uuid();
  SUCCESSOR = uuid();
  VISIT_1 = uuid();

  server.addJob(JOB, INSPECTOR); // jobs.contractor_id = the working inspector
  server.setTeamStatus(JOB, INSPECTOR, 'active');
  server.addVisit(VISIT_1, JOB, 'scheduled');
  server.signInAs(INSPECTOR);
});

// ── Q1 · visit_id carried through queued operations ─────────────────────────

describe('Q1 visit_id survives the queue', () => {
  it('round-trips enqueue -> SQLite -> replay unchanged', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    const opId = await offlineApi.enqueueCaptureSave({ capture: cap });

    // Persisted, not just held in memory.
    const queued = await rowFor(opId);
    assert.equal(JSON.parse(queued.payload_json).capture.visit_id, VISIT_1);

    await drain();

    assert.equal(server.captures.size, 1);
    assert.equal(server.captures.get(cap.id).visit_id, VISIT_1);
  });

  it('neither injects nor strips visit_id: no visit_id enqueued stays job-level NULL', async () => {
    const cap = captureRow(); // exactly what the capture UI sends today
    await offlineApi.enqueueCaptureSave({ capture: cap });
    await drain();

    assert.equal(server.captures.get(cap.id).visit_id, null);
  });

  it('survives a queue that outlives several failed passes', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    await offlineApi.enqueueCaptureSave({ capture: cap });

    server.signOut(); // 401 on every attempt
    await drain();
    await sync.resumeSync();

    server.signInAs(INSPECTOR);
    await drain();

    assert.equal(server.captures.get(cap.id).visit_id, VISIT_1);
  });
});

// ── Q2/Q3 · inspector_id and job_id survive ─────────────────────────────────

describe('Q2/Q3 identity fields survive queue + replay', () => {
  it('inspector_id and job_id arrive byte-identical', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    await offlineApi.enqueueCaptureSave({ capture: cap });
    await drain();

    const landed = server.captures.get(cap.id);
    assert.equal(landed.inspector_id, INSPECTOR);
    assert.equal(landed.job_id, JOB);
    assert.equal(landed.capture_sha256, cap.capture_sha256);
  });

  it('no handler re-stamps inspector_id from the current session', async () => {
    // The authoring inspector is on the team; the CURRENT session is someone
    // else who also happens to be on it. The payload must not be rewritten.
    server.setTeamStatus(JOB, SUCCESSOR, 'active');
    const cap = captureRow({ visit_id: VISIT_1 });
    await offlineApi.enqueueCaptureSave({ capture: cap });

    server.signInAs(SUCCESSOR);
    await drain();

    // RLS requires inspector_id = auth.uid(), so this is REJECTED rather than
    // silently re-attributed to the signed-in user.
    assert.equal(server.captures.size, 0);
    const rows = await allRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'abandoned');
    assert.equal(rows[0].failure_class, 'fatal');
  });
});

// ── Q4 · CURRENT authorization is re-evaluated at replay time ──────────────

describe('Q4 authorization is evaluated at replay, not at enqueue', () => {
  it('enqueue performs NO authorization check at all', async () => {
    server.setTeamStatus(JOB, INSPECTOR, 'removed');
    server.addJob(JOB, SUCCESSOR); // contractor flipped away too

    const cap = captureRow({ visit_id: VISIT_1 });
    const opId = await offlineApi.enqueueCaptureSave({ capture: cap });

    assert.ok(await outbox.opStillQueued(opId), 'enqueue accepted the op offline');
  });

  it('authorization GRANTED after enqueue is honoured at replay', async () => {
    server.setTeamStatus(JOB, INSPECTOR, 'removed');
    server.addJob(JOB, SUCCESSOR);

    const cap = captureRow({ visit_id: VISIT_1 });
    await offlineApi.enqueueCaptureSave({ capture: cap });

    // Reinstated before the queue drains.
    server.setTeamStatus(JOB, INSPECTOR, 'active');
    await drain();

    assert.equal(server.captures.size, 1, 'current authorization applied at replay');
  });

  it('authorization REVOKED after enqueue is enforced at replay', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    await offlineApi.enqueueCaptureSave({ capture: cap });

    server.setTeamStatus(JOB, INSPECTOR, 'removed');
    server.addJob(JOB, SUCCESSOR);
    await drain();

    assert.equal(server.captures.size, 0, 'enqueue-time grant is not cached');
  });
});

// ── Q5 · a removed/replaced inspector cannot replay NEW visit work ─────────

describe('Q5 removed/replaced inspector cannot replay unauthorized visit work', () => {
  it('is refused, classified fatal, and preserved (never silently dropped)', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    const opId = await offlineApi.enqueueCaptureSave({ capture: cap });

    // Identity replacement: membership ends, contract moves to the successor.
    server.setTeamStatus(JOB, INSPECTOR, 'replaced');
    server.setTeamStatus(JOB, SUCCESSOR, 'active');
    server.addJob(JOB, SUCCESSOR);

    await drain();

    assert.equal(server.captures.size, 0, 'no unauthorized row landed');

    const row = await rowFor(opId);
    assert.ok(row, 'the op is preserved for the inspector, not deleted');
    assert.equal(row.status, 'abandoned');
    assert.equal(row.failure_class, 'fatal');
    assert.match(row.last_error, /row-level security/i);
  });

  it('retrying the abandoned op still cannot force the write through', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    const opId = await offlineApi.enqueueCaptureSave({ capture: cap });
    server.setTeamStatus(JOB, INSPECTOR, 'replaced');
    server.addJob(JOB, SUCCESSOR);
    await drain();

    const row = await rowFor(opId);
    await outbox.retryAbandoned(row.id);
    await drain();

    assert.equal(server.captures.size, 0);
    const after = await rowFor(opId);
    assert.equal(after.status, 'abandoned');
  });

  it('a NEW visit created after removal is equally unreachable', async () => {
    const visit2 = uuid();
    server.addVisit(visit2, JOB, 'scheduled');
    server.setTeamStatus(JOB, INSPECTOR, 'removed');
    server.addJob(JOB, SUCCESSOR);

    await offlineApi.enqueueCaptureSave({ capture: captureRow({ visit_id: visit2 }) });
    await drain();

    assert.equal(server.captures.size, 0);
  });
});

// ── Q6 · legitimate historical evidence still replays ──────────────────────

describe('Q6 legitimate evidence replays successfully', () => {
  it('photo + GPS + text captures for a visit all land and drain the queue', async () => {
    const localUri = 'file:///tmp/' + uuid() + '.jpg';
    fsState.files.set(localUri, Buffer.from('jpeg-bytes').toString('base64'));

    const photo = captureRow({
      visit_id: VISIT_1,
      kind: 'photo',
      storage_path: `captures/${JOB}/${VISIT_1}/a.jpg`,
      mime_type: 'image/jpeg',
    });
    const gps = captureRow({ visit_id: VISIT_1, kind: 'gps', gps_lat: 1, gps_lng: 2 });
    const text = captureRow({ visit_id: VISIT_1, kind: 'text', text_payload: 'ok' });

    await offlineApi.enqueueCaptureSave({
      capture: photo,
      bucket: 'compliance',
      localFilePath: localUri,
    });
    await offlineApi.enqueueCaptureSave({ capture: gps });
    await offlineApi.enqueueCaptureSave({ capture: text });

    await drain();

    assert.equal(server.captures.size, 3);
    for (const c of [photo, gps, text]) {
      assert.equal(server.captures.get(c.id).visit_id, VISIT_1);
    }
    assert.equal(server.storageWrites.length, 1);
    assert.equal(server.storageWrites[0].path, photo.storage_path);
    assert.deepEqual(await allRows(), [], 'queue fully drained');
    assert.ok(fsState.deleted.includes(localUri), 'local evidence cleaned up after landing');
  });

  it('a session that expires mid-drain costs no retry budget and loses nothing', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    const opId = await offlineApi.enqueueCaptureSave({ capture: cap });

    server.signOut(); // 401
    await drain();

    let row = await rowFor(opId);
    assert.equal(row.status, 'pending', 'bounced back to pending');
    assert.equal(row.attempts, 0, 'auth expiry never burns an attempt');
    assert.equal(row.failure_class, null);
    assert.equal(server.captures.size, 0);

    server.signInAs(INSPECTOR);
    await sync.resumeSync();
    await drain();

    assert.equal(server.captures.get(cap.id).visit_id, VISIT_1);
  });
});

// ── Q7 · duplicate replay is idempotent ────────────────────────────────────

describe('Q7 duplicate replay is idempotent', () => {
  it('the same client_op_id cannot be queued twice', async () => {
    await outbox.enqueue({ client_op_id: 'fixed-op', kind: 'capture_save', payload: { capture: captureRow() } });
    await outbox.enqueue({ client_op_id: 'fixed-op', kind: 'capture_save', payload: { capture: captureRow() } });

    const rows = await allRows();
    assert.equal(rows.length, 1);
  });

  it('a re-delivered capture dup-keys to success — exactly one server row', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    await offlineApi.enqueueCaptureSave({ capture: cap });
    await drain();
    assert.equal(server.captures.size, 1);

    // Same capture body, fresh op id (the classic "response was lost" replay).
    await offlineApi.enqueueCaptureSave({ capture: cap });
    await drain();

    assert.equal(server.captures.size, 1, 'no duplicate evidence');
    assert.deepEqual(await allRows(), [], 'the replay was treated as success');
  });

  it('crash recovery re-drains an in_flight row without duplicating it', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    const opId = await offlineApi.enqueueCaptureSave({ capture: cap });
    await drain();
    assert.equal(server.captures.size, 1);

    // Re-queue the identical op and strand it in_flight, as a kill mid-drain would.
    await outbox.enqueue({
      client_op_id: opId + '-retry',
      kind: 'capture_save',
      payload: { capture: cap },
    });
    const stranded = await rowFor(opId + '-retry');
    const { getDb } = await import('../db.ts');
    const db = await getDb();
    await db.runAsync("UPDATE outbox_operations SET status='in_flight' WHERE id = ?", [stranded.id]);

    assert.equal(await outbox.recoverInFlight(), 1);
    await drain();

    assert.equal(server.captures.size, 1, 'recovery did not duplicate the evidence');
  });
});

// ── Q8 · a visit reschedule must not corrupt queued evidence ───────────────

describe('Q8 visit reschedule does not corrupt queued evidence', () => {
  it('evidence captured before a reschedule is forwarded, never destroyed', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    const opId = await offlineApi.enqueueCaptureSave({ capture: cap });

    // nx_job_reschedule_visit (20260801384000:366, reordered by 394000)
    // supersedes the old row rather than deleting it, carries the ACTIVE crew
    // to the new visit, and — load-bearing here — stamps rescheduled_from_id
    // on the replacement so the chain is walkable.
    const visit2 = uuid();
    server.visits.get(VISIT_1).status = 'rescheduled';
    server.addVisit(visit2, JOB, 'scheduled');
    server.visits.get(visit2).rescheduled_from_id = VISIT_1;

    // The queued payload is untouched by the server-side reschedule.
    const queued = await rowFor(opId);
    assert.equal(JSON.parse(queued.payload_json).capture.visit_id, VISIT_1);

    await drain();

    // ★ This assertion was inverted before 20260801396000. It previously
    //   required the capture to stay on the superseded visit — which in
    //   production meant tg_guard_capture_visit raised 23514, shared-core
    //   classified it FATAL, and the inspector's field evidence was discarded
    //   permanently. The guard now walks rescheduled_from_id forward instead.
    const landed = server.captures.get(cap.id);
    assert.ok(landed, 'the capture must land — a reschedule must never destroy evidence');
    assert.equal(landed.visit_id, visit2, 'forwarded to the live successor visit');
  });
});

// ── Q8b · the offline path is not a way around the cross-job guard ─────────

describe('Q8b cross-job visit_id injection is rejected at replay', () => {
  it('a forged visit_id from another job cannot be laundered through the outbox', async () => {
    // The exploit the pre-integration review found against the raw API: stamp a
    // capture with a visit_id guessed from someone else's job. The outbox must
    // not be a softer path to the same thing — tg_guard_capture_visit
    // (20260801388000) is a BEFORE trigger, so it binds the replay writer too.
    const otherJob = uuid();
    const otherVisit = uuid();
    server.addJob(otherJob, uuid());
    server.addVisit(otherVisit, otherJob, 'scheduled');

    const cap = captureRow({ job_id: JOB, visit_id: otherVisit });
    await offlineApi.enqueueCaptureSave({ capture: cap });
    await drain();

    assert.equal(
      server.captures.get(cap.id),
      undefined,
      'a capture naming another job’s visit must never land',
    );
  });
});

// ── Q9 · cancelled/rescheduled visits cannot cause silent misattribution ───

describe('Q9 no silent misattribution from cancelled/rescheduled visits', () => {
  it('a cancelled visit keeps its own evidence, explicitly', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    await offlineApi.enqueueCaptureSave({ capture: cap });

    server.visits.get(VISIT_1).status = 'cancelled'; // nx_job_cancel_visit: in-place
    await drain();

    assert.equal(server.captures.get(cap.id).visit_id, VISIT_1);
  });

  it('job-level evidence is never auto-attached to an open visit', async () => {
    const openVisit = uuid();
    server.addVisit(openVisit, JOB, 'in_progress');

    const cap = captureRow(); // no visit_id — today's capture-UI behaviour
    await offlineApi.enqueueCaptureSave({ capture: cap });
    await drain();

    assert.equal(server.captures.get(cap.id).visit_id, null);
  });

  it('an unresolvable visit is refused, not silently downgraded to job-level', async () => {
    const cap = captureRow({ visit_id: VISIT_1 });
    const opId = await offlineApi.enqueueCaptureSave({ capture: cap });

    server.visits.delete(VISIT_1); // hard delete (not what the RPCs do)
    await drain();

    assert.equal(server.captures.size, 0, 'no row landed with a rewritten visit_id');
    const row = await rowFor(opId);
    assert.ok(row, 'the evidence is preserved for a human decision');
    assert.ok(['conflict', 'abandoned'].includes(row.status));
  });

  it('two visits on one job keep separate evidence through a single drain', async () => {
    const visit2 = uuid();
    server.addVisit(visit2, JOB, 'scheduled');

    const a = captureRow({ visit_id: VISIT_1 });
    const b = captureRow({ visit_id: visit2 });
    await offlineApi.enqueueCaptureSave({ capture: a });
    await offlineApi.enqueueCaptureSave({ capture: b });
    await drain();

    assert.equal(server.captures.get(a.id).visit_id, VISIT_1);
    assert.equal(server.captures.get(b.id).visit_id, visit2);
  });
});
