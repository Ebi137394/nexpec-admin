// ════════════════════════════════════════════════════════════════════════════
//  itpReplay.test.mjs — ITP execution through the REAL offline path.
//
//  Lane 3 built the harness and the ITP fake server, then the session ended
//  before this file was written. Nothing here rebuilds that infrastructure.
//
//  WHAT IS REAL AND WHAT IS FAKED. The modules under test are the actual
//  shipped ones: src/core/offline/index.ts (enqueueItpRecordResult),
//  outbox.ts (SQLite queue, INSERT OR IGNORE, attempt accounting, markFatal)
//  and operations.ts (handleItpRecordResult → nx_itp_record_result). Only four
//  platform boundaries are faked: expo-sqlite (real node:sqlite underneath),
//  expo-file-system, the network flag, and the Supabase server. The server fake
//  transcribes 20260801398000's authorisation and conflict rules line by line.
//
//  A fake can only ever certify what it models — the Phase 2 review caught a
//  fake that omitted three guards and therefore certified the opposite of
//  production. So every assertion below is paired with a mutation check in the
//  commit message, and the one place the fake documents a REAL missing guard
//  (itp_point_results has no job-coherence trigger on visit_id, unlike
//  inspection_captures under 388000/396000) is asserted as the current
//  behaviour and reported, not quietly papered over.
// ════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  offlineApi,
  operations,
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

// operations.ts is reached THROUGH the harness, not imported directly: the
// harness installs the `@/src` resolve hook at runtime, and a static
// `../operations.ts` import here would be resolved before that hook exists.
const { itpRequestToRpcArgs } = operations;

// ── fixtures ────────────────────────────────────────────────────────────────

let JOB;
let OTHER_JOB;
let INSPECTOR;
let OTHER_INSPECTOR;
let VISIT_1;
let POINT_NORMAL;
let POINT_HOLD;
let POINT_WITNESS;

/** Mirrors the request built by src/lib/itp/execution.ts. */
function itpReq(over = {}) {
  return {
    pointId: POINT_NORMAL,
    jobId: JOB,
    result: 'passed',
    visitId: null,
    comments: null,
    witnessedBy: null,
    ...over,
  };
}

async function drain() {
  setOnline(true);
  await sync.flushQueue();
  setOnline(false);
}

/** The single result row the fake holds for a (job, point, visit) triple. */
function resultFor(jobId, pointId, visitId = null) {
  return server.itpResultFor(jobId, pointId, visitId);
}

beforeEach(async () => {
  server.reset();
  fsState.reset();
  await resetOutbox();
  setOnline(false);

  JOB = uuid();
  OTHER_JOB = uuid();
  INSPECTOR = uuid();
  OTHER_INSPECTOR = uuid();
  VISIT_1 = uuid();
  POINT_NORMAL = uuid();
  POINT_HOLD = uuid();
  POINT_WITNESS = uuid();

  server.addJob(JOB, uuid());
  server.addJob(OTHER_JOB, uuid());
  server.team.set(`${JOB}|${INSPECTOR}`, 'active');
  server.addVisit(VISIT_1, JOB, 'scheduled');
  server.addItpPoint(POINT_NORMAL);
  server.addItpPoint(POINT_HOLD, { point_type: 'hold', blocks_progress: true });
  server.addItpPoint(POINT_WITNESS, { point_type: 'witness' });
  server.uid = INSPECTOR;
});

// ── Q1 · the contract mapping is not re-invented per caller ────────────────

describe('Q1 the frozen request maps to the frozen RPC signature', () => {
  it('every field lands on its p_ parameter, visitId absent means job-level NULL', () => {
    const args = itpRequestToRpcArgs(
      itpReq({ visitId: VISIT_1, comments: 'ok', witnessedBy: 'A. Client' }),
    );
    assert.deepEqual(args, {
      p_point_id: POINT_NORMAL,
      p_job_id: JOB,
      p_result: 'passed',
      p_visit_id: VISIT_1,
      p_comments: 'ok',
      p_witnessed_by: 'A. Client',
    });
    assert.equal(itpRequestToRpcArgs(itpReq()).p_visit_id, null, 'omitted visit = job level');
  });
});

// ── Q2-Q6 · identity survives the queue byte-for-byte ──────────────────────

describe('Q2-Q6 job, point, visit, result and attribution survive replay', () => {
  it('the payload crosses SQLite unchanged and the row carries every field', async () => {
    const req = itpReq({
      pointId: POINT_WITNESS,
      result: 'passed',
      visitId: VISIT_1,
      comments: 'flange face clean',
      witnessedBy: 'A. Client',
    });
    const opId = await offlineApi.enqueueItpRecordResult(req);

    // Still queued: nothing reached the server while offline.
    const queued = JSON.parse((await rowFor(opId)).payload_json);
    assert.deepEqual(queued, req, 'payload survives JSON round-trip through SQLite');
    assert.equal(server.itpResults.size, 0, 'nothing recorded while offline');

    await drain();

    const row = resultFor(JOB, POINT_WITNESS, VISIT_1);
    assert.ok(row, 'the result landed');
    assert.equal(row.job_id, JOB);
    assert.equal(row.point_id, POINT_WITNESS);
    assert.equal(row.visit_id, VISIT_1);
    assert.equal(row.result, 'passed');
    assert.equal(row.comments, 'flange face clean');
    assert.equal(row.witnessed_by, 'A. Client');
    // Attribution is the DRAINING session, which is the same inspector here.
    assert.equal(row.inspector_id, INSPECTOR, 'inspector attribution survives');
    assert.ok(row.recorded_at, 'timestamp set server-side');
  });

  it('job-level (visit_id NULL) and visit-scoped results are separate rows', async () => {
    await offlineApi.enqueueItpRecordResult(itpReq({ visitId: null }));
    await offlineApi.enqueueItpRecordResult(itpReq({ visitId: VISIT_1, result: 'failed' }));
    await drain();

    assert.equal(server.itpResultsForJob(JOB).length, 2, 'NULL visit is its own key');
    assert.equal(resultFor(JOB, POINT_NORMAL, null).result, 'passed');
    assert.equal(resultFor(JOB, POINT_NORMAL, VISIT_1).result, 'failed');
  });
});

// ── Q7-Q8 · authorization is re-decided at drain, not at enqueue ───────────

describe('Q7-Q8 authorization is re-evaluated on replay', () => {
  it('there is no enqueue-time authz — an unauthorized op still queues', async () => {
    server.uid = OTHER_INSPECTOR; // never on this job
    const opId = await offlineApi.enqueueItpRecordResult(itpReq());
    assert.ok(await rowFor(opId), 'enqueue does not consult the server');
    assert.equal(server.rpcCalls.length, 0);
  });

  it('an inspector removed while offline cannot replay NEW ITP work', async () => {
    const opId = await offlineApi.enqueueItpRecordResult(itpReq());

    // nx_job_remove_inspector soft-deletes; membership flips to 'removed'.
    server.team.set(`${JOB}|${INSPECTOR}`, 'removed');

    await drain();

    assert.equal(server.itpResults.size, 0, 'no result was recorded');
    const row = await rowFor(opId);
    assert.equal(row.status, 'abandoned', '42501 is fatal — parked, not applied');
    assert.ok(row, 'the op is preserved for inspection, not silently deleted');
  });

  it('a replacement inspector recording the same point is attributed to THEM', async () => {
    // Historical work already recorded by the original inspector.
    await offlineApi.enqueueItpRecordResult(itpReq({ result: 'failed' }));
    await drain();
    assert.equal(resultFor(JOB, POINT_NORMAL, null).inspector_id, INSPECTOR);

    // Original removed, replacement added — Multi-Inspector replacement.
    server.team.set(`${JOB}|${INSPECTOR}`, 'replaced');
    server.team.set(`${JOB}|${OTHER_INSPECTOR}`, 'active');
    server.uid = OTHER_INSPECTOR;

    await offlineApi.enqueueItpRecordResult(itpReq({ result: 'passed' }));
    await drain();

    const row = resultFor(JOB, POINT_NORMAL, null);
    assert.equal(row.result, 'passed', 'the correction stands');
    assert.equal(row.inspector_id, OTHER_INSPECTOR, 're-attributed to who actually recorded');
    assert.equal(server.itpResultsForJob(JOB).length, 1, 'in place — never a second row');
  });
});

// ── Q9-Q10 · history survives, replay is idempotent ────────────────────────

describe('Q9-Q10 historical work survives and duplicate replay is idempotent', () => {
  it('a re-delivered op lands on the same row and creates no second result', async () => {
    const opId = await offlineApi.enqueueItpRecordResult(itpReq());
    await drain();
    const first = resultFor(JOB, POINT_NORMAL, null);
    assert.equal(first.write_count, 1);

    // Re-deliver the identical op — the outbox's INSERT OR IGNORE refuses it.
    await outbox.enqueue({
      client_op_id: opId,
      kind: 'itp_record_result',
      payload: itpReq(),
    });
    await drain();

    assert.equal(server.itpResultsForJob(JOB).length, 1, 'one ITP result, never two');
    assert.equal(resultFor(JOB, POINT_NORMAL, null).id, first.id, 'same result row id');
  });

  it('two genuine corrections made offline both replay, last one wins', async () => {
    // enqueueItpRecordResult mints a FRESH op id per call precisely so a
    // correction is not collapsed into the first payload by INSERT OR IGNORE.
    await offlineApi.enqueueItpRecordResult(itpReq({ result: 'failed' }));
    await offlineApi.enqueueItpRecordResult(itpReq({ result: 'passed' }));
    assert.equal((await allRows()).length, 2, 'two acts, two ops');

    await drain();

    const row = resultFor(JOB, POINT_NORMAL, null);
    assert.equal(server.itpResultsForJob(JOB).length, 1, 'still one result row');
    assert.equal(row.result, 'passed', 'FIFO — the truer, later answer stands');
    assert.equal(row.write_count, 2, 'updated in place, not duplicated');
  });
});

// ── Q11-Q12 · visit lifecycle cannot silently rebind ITP work ──────────────

describe('Q11-Q12 visit reschedule/cancel does not misattribute ITP work', () => {
  it('queued ITP work is never silently rebound to a replacement visit', async () => {
    const opId = await offlineApi.enqueueItpRecordResult(itpReq({ visitId: VISIT_1 }));

    const visit2 = uuid();
    server.visits.get(VISIT_1).status = 'rescheduled';
    server.addVisit(visit2, JOB, 'scheduled');
    server.visits.get(visit2).rescheduled_from_id = VISIT_1;

    assert.equal(
      JSON.parse((await rowFor(opId)).payload_json).visitId,
      VISIT_1,
      'the queued payload is untouched by a server-side reschedule',
    );

    await drain();

    // DIVERGENCE FROM EVIDENCE, ON PURPOSE — and reported, not hidden.
    // inspection_captures forwards to the successor (396000). itp_point_results
    // has no such trigger, so the result stays on the visit that was actually
    // worked. Critically it is NOT destroyed, which is the failure mode 396000
    // was written to end.
    const row = resultFor(JOB, POINT_NORMAL, VISIT_1);
    assert.ok(row, 'a reschedule must never destroy recorded ITP work');
    assert.equal(row.visit_id, VISIT_1, 'stays on the worked visit');
  });

  it('a visit id that does not exist is rejected by the FK, not accepted', async () => {
    await offlineApi.enqueueItpRecordResult(itpReq({ visitId: uuid() }));
    await drain();
    assert.equal(server.itpResults.size, 0, 'no orphan result');
  });

  it('a visit from ANOTHER job is rejected — coherence guard (404000)', async () => {
    // Was asserted as a known GAP when this suite was written; 20260801404000
    // added tg_guard_itp_result_visit, the ITP counterpart of the evidence
    // guard 388000 gave inspection_captures. The assertion is now inverted.
    const foreignVisit = uuid();
    server.addVisit(foreignVisit, OTHER_JOB, 'scheduled');
    const opId = await offlineApi.enqueueItpRecordResult(itpReq({ visitId: foreignVisit }));
    await drain();

    assert.equal(server.itpResults.size, 0, 'no result may be filed against another job’s visit');
    assert.equal((await rowFor(opId)).status, 'abandoned', '23514 is fatal, not retried forever');
  });

  it('a job-level (NULL visit) result is unaffected by the coherence guard', async () => {
    // Legacy semantics must survive the fix: NULL means job-level, not invalid.
    await offlineApi.enqueueItpRecordResult(itpReq({ visitId: null }));
    await drain();
    assert.ok(resultFor(JOB, POINT_NORMAL, null), 'NULL visit_id still lands');
  });
});

// ── Q13-Q15 · the offline path is not a way around ITP state rules ─────────

describe('Q13-Q15 canonical ITP rules hold on the replay path', () => {
  it('hold release is NOT an outbox operation — self-release is impossible here', async () => {
    // The frozen contract exposes exactly one offline ITP verb. Release goes
    // through nx_itp_release_hold from an admin surface only, so there is no
    // queued act an inspector could drain to release their own hold.
    assert.equal(
      typeof offlineApi.enqueueItpReleaseHold,
      'undefined',
      'no offline hold-release verb exists',
    );

    await offlineApi.enqueueItpRecordResult(itpReq({ pointId: POINT_HOLD, result: 'passed' }));
    await drain();

    const row = resultFor(JOB, POINT_HOLD, null);
    assert.equal(row.result, 'passed', 'the inspector may record the hold point');
    assert.equal(row.released_at, null, 'but recording it does NOT release the hold');
    assert.equal(
      server.rpcCalls.filter((c) => c.name === 'nx_itp_release_hold').length,
      0,
      'the replay path never calls the release RPC',
    );
  });

  it('an inspector cannot WAIVE their own blocking hold through the queue', async () => {
    // 20260801402000. 'waived' sits inside the cleared set (398000:272), so
    // before that migration recording it was a second, quieter road around
    // nx_itp_release_hold's admin/buyer rule — no forged column needed.
    const opId = await offlineApi.enqueueItpRecordResult(
      itpReq({ pointId: POINT_HOLD, result: 'waived' }),
    );
    await drain();

    assert.equal(server.itpResults.size, 0, 'the waiver is refused at replay');
    assert.equal((await rowFor(opId)).status, 'abandoned', '42501 is fatal, not retried');
  });

  it('the buyer principal MAY waive — the rule is authority, not a blanket ban', async () => {
    const buyer = uuid();
    server.jobs.get(JOB).client_id = buyer;
    server.team.set(`${JOB}|${buyer}`, 'active'); // buyer must still pass the row check
    server.uid = buyer;

    await offlineApi.enqueueItpRecordResult(itpReq({ pointId: POINT_HOLD, result: 'waived' }));
    await drain();

    const row = resultFor(JOB, POINT_HOLD, null);
    assert.ok(row, 'a waiver by the buyer principal is accepted');
    assert.equal(row.result, 'waived');
  });

  it('a witness point cannot be passed offline without naming the witness', async () => {
    const opId = await offlineApi.enqueueItpRecordResult(
      itpReq({ pointId: POINT_WITNESS, result: 'passed', witnessedBy: null }),
    );
    await drain();

    assert.equal(server.itpResults.size, 0, 'the DB rule is enforced at replay');
    assert.equal((await rowFor(opId)).status, 'abandoned', '22023 is fatal, not retried forever');
  });

  it('an invalid result value cannot be laundered through the queue', async () => {
    await offlineApi.enqueueItpRecordResult(itpReq({ result: 'definitely_fine' }));
    await drain();
    assert.equal(server.itpResults.size, 0, 'the server re-validates the enum');
  });

  it('an inactive point rejects new execution', async () => {
    server.itpPoints.get(POINT_NORMAL).is_active = false;
    await offlineApi.enqueueItpRecordResult(itpReq());
    await drain();
    assert.equal(server.itpResults.size, 0);
  });

  it('every ITP write goes through the canonical RPC — no direct table write', async () => {
    await offlineApi.enqueueItpRecordResult(itpReq());
    await drain();
    assert.deepEqual(
      [...new Set(server.rpcCalls.map((c) => c.name))],
      ['nx_itp_record_result'],
      'exactly one RPC, the canonical one',
    );
  });
});
