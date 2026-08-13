// ════════════════════════════════════════════════════════════════════════════
//  reviewReplay.test.mjs — Lane F offline: Senior Review decisions and
//  Inspector corrections through the REAL outbox path.
//
//  WHAT IS REAL AND WHAT IS FAKED. The modules under test are the shipped ones:
//  src/core/offline/index.ts (enqueueSeniorReviewDecide, enqueueReportResubmit),
//  outbox.ts (SQLite queue, INSERT OR IGNORE on client_op_id, attempt
//  accounting, markFatal) and operations.ts (the two new handlers). Only the
//  platform boundaries are faked: expo-sqlite, expo-file-system, the network
//  flag and the Supabase server. The server fake transcribes 20260801452000 §2
//  and 20260801454000 guard-for-guard.
//
//  THE POINT OF THIS SUITE is the offline window. A decision or correction is
//  composed on a device with no signal and replays minutes or hours later,
//  by which time an Admin may have reassigned the reviewer or replaced the
//  inspector. Authorisation must therefore be re-evaluated AT REPLAY, and a
//  refusal must be terminal rather than retried forever. Both properties are
//  asserted below against the real classifier.
//
//  A fake can only certify what it models. If a guard is added to either
//  migration and not to fakes/supabaseServer.mjs, this suite will happily
//  certify the opposite of production — the same trap a previous review caught.
// ════════════════════════════════════════════════════════════════════════════

// NOTE ON VOCABULARY: 'fatal' is a FailureClass, not an OperationStatus.
// markFatal() sets status='abandoned' AND failure_class='fatal' (outbox.ts:254).
// Asserting status==='fatal' silently never matches — check both.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  offlineApi,
  outbox,
  sync,
  server,
  setOnline,
  resetOutbox,
  rowFor,
  uuid,
} from './harness.mjs';

let JOB;
let REPORT;
let INSPECTOR;
let REVIEWER;
let OTHER_REVIEWER;

const T0 = '2026-08-01T00:00:00.000Z';

beforeEach(async () => {
  await resetOutbox();
  server.reset();
  setOnline(true);

  JOB = uuid();
  REPORT = uuid();
  INSPECTOR = uuid();
  REVIEWER = uuid();
  OTHER_REVIEWER = uuid();

  server.reports.set(REPORT, {
    job_id: JOB,
    inspector_id: INSPECTOR,
    status: 'returned_to_inspector',
    updated_at: T0,
    notes: 'original',
  });
  server.activeContract.set(`${JOB}|${INSPECTOR}`, true);
  server.reviewRounds.push({
    report_id: REPORT,
    reviewer_id: REVIEWER,
    decision: null,
    superseded: false,
  });
});

// ── senior_review_decide ────────────────────────────────────────────────────

describe('Senior Review decision through the outbox', () => {
  it('lands when the reviewer is still the assigned one', async () => {
    server.uid = REVIEWER;
    const opId = await offlineApi.enqueueSeniorReviewDecide({
      reportId: REPORT,
      decision: 'approved',
    });
    await sync.flushQueue();

    const row = await rowFor(opId);
    assert.ok(!row, 'a delivered op is removed from the queue');
    assert.equal(server.reports.get(REPORT).status, 'senior_approved');
  });

  it('queues while offline and lands on reconnect', async () => {
    server.uid = REVIEWER;
    setOnline(false);
    const opId = await offlineApi.enqueueSeniorReviewDecide({
      reportId: REPORT,
      decision: 'returned',
      comments: 'Re-shoot weld 4.',
    });
    await sync.flushQueue();
    assert.ok(await rowFor(opId), 'still queued while offline');

    setOnline(true);
    await sync.flushQueue();
    assert.ok(!(await rowFor(opId)), 'drained after reconnect');
    assert.equal(server.reports.get(REPORT).status, 'returned_to_inspector');
  });

  // THE REPLACEMENT CASE. This is the whole reason authorisation cannot be
  // decided at enqueue time.
  it('REFUSES a decision from a reviewer replaced during the offline window', async () => {
    server.uid = REVIEWER;
    setOnline(false);
    const opId = await offlineApi.enqueueSeniorReviewDecide({
      reportId: REPORT,
      decision: 'approved',
    });

    // ...meanwhile an Admin reassigns the report to someone else.
    server.reviewRounds[0].superseded = true;
    server.reviewRounds.push({
      report_id: REPORT,
      reviewer_id: OTHER_REVIEWER,
      decision: null,
      superseded: false,
    });

    setOnline(true);
    await sync.flushQueue();

    const row = await rowFor(opId);
    assert.ok(row, 'the op is retained, not silently dropped');
    assert.equal(row.status, 'abandoned', '42501 must be terminal, never retried');
    assert.equal(row.failure_class, 'fatal');
    assert.match(String(row.last_error), /NOT_THE_ASSIGNED_REVIEWER/);
    assert.equal(
      server.reports.get(REPORT).status,
      'returned_to_inspector',
      'the stale decision did not move the report',
    );
  });

  it('does not let a stale decision overwrite one already made', async () => {
    server.uid = REVIEWER;
    setOnline(false);
    const opId = await offlineApi.enqueueSeniorReviewDecide({
      reportId: REPORT,
      decision: 'approved',
    });

    // the same reviewer decided from another device first
    server.reviewRounds[0].decision = 'returned';
    server.reports.get(REPORT).status = 'returned_to_inspector';

    setOnline(true);
    await sync.flushQueue();

    const row = await rowFor(opId);
    assert.equal(row.status, 'abandoned');
    assert.equal(row.failure_class, 'fatal');
    assert.match(String(row.last_error), /NO_OPEN_REVIEW/);
    assert.equal(server.reviewRounds[0].decision, 'returned', 'first decision stands');
  });

  it('is idempotent on client_op_id — a double enqueue queues once', async () => {
    server.uid = REVIEWER;
    setOnline(false);
    const opId = uuid();
    await outbox.enqueue({
      client_op_id: opId,
      kind: 'senior_review_decide',
      payload: { reportId: REPORT, decision: 'approved' },
    });
    await outbox.enqueue({
      client_op_id: opId,
      kind: 'senior_review_decide',
      payload: { reportId: REPORT, decision: 'approved' },
    });

    setOnline(true);
    await sync.flushQueue();

    const decided = server.rpcCalls.filter((c) => c.name === 'nx_senior_review_decide');
    assert.equal(decided.length, 1, 'the RPC was reached exactly once');
  });
});

// ── report_resubmit ─────────────────────────────────────────────────────────

describe('Inspector correction through the outbox', () => {
  function resubmit(over = {}) {
    return {
      jobId: JOB,
      reportId: REPORT,
      expectedUpdatedAt: T0,
      summary: 'Corrected weld 4.',
      ...over,
    };
  }

  it('lands for the active author with a current lock token', async () => {
    server.uid = INSPECTOR;
    const opId = await offlineApi.enqueueReportResubmit(resubmit());
    await sync.flushQueue();

    assert.ok(!(await rowFor(opId)));
    assert.equal(server.reports.get(REPORT).status, 'submitted');
    assert.equal(server.reports.get(REPORT).notes, 'Corrected weld 4.');
  });

  // THE REPLACEMENT CASE for the inspector side.
  it('REFUSES a correction from an inspector replaced while offline', async () => {
    server.uid = INSPECTOR;
    setOnline(false);
    const opId = await offlineApi.enqueueReportResubmit(resubmit());

    server.activeContract.set(`${JOB}|${INSPECTOR}`, false); // replaced

    setOnline(true);
    await sync.flushQueue();

    const row = await rowFor(opId);
    assert.equal(row.status, 'abandoned', 'replacement denial is terminal');
    assert.equal(row.failure_class, 'fatal');
    assert.match(String(row.last_error), /NOT_ACTIVE_INSPECTOR/);
    assert.equal(
      server.reports.get(REPORT).status,
      'returned_to_inspector',
      'nothing was written',
    );
  });

  it('REFUSES when the report moved on during the offline window', async () => {
    server.uid = INSPECTOR;
    setOnline(false);
    const opId = await offlineApi.enqueueReportResubmit(resubmit());

    // a new review round bumped the row while the device was dark
    server.reports.get(REPORT).updated_at = '2026-08-02T00:00:00.000Z';

    setOnline(true);
    await sync.flushQueue();

    const row = await rowFor(opId);
    assert.equal(row.status, 'abandoned');
    assert.equal(row.failure_class, 'fatal');
    assert.match(String(row.last_error), /REPORT_CHANGED/);
    assert.equal(server.reports.get(REPORT).notes, 'original', 'not clobbered');
  });

  it('REFUSES a correction to a report the caller does not own', async () => {
    server.uid = uuid(); // some other inspector
    server.activeContract.set(`${JOB}|${server.uid}`, true);
    const opId = await offlineApi.enqueueReportResubmit(resubmit());
    await sync.flushQueue();

    const row = await rowFor(opId);
    assert.equal(row.status, 'abandoned');
    assert.equal(row.failure_class, 'fatal');
    assert.match(String(row.last_error), /NOT_THE_REPORT_AUTHOR/);
  });

  it('carries no money field in the queued payload', async () => {
    server.uid = INSPECTOR;
    setOnline(false);
    const opId = await offlineApi.enqueueReportResubmit(resubmit());
    const row = await rowFor(opId);
    assert.doesNotMatch(
      row.payload_json,
      /price|payout|spread|amount|cents|funding/i,
      'a correction is a report act — no commercial field may ride along',
    );
  });
});

// ── the absent capability ───────────────────────────────────────────────────

describe('offline financial mutation', () => {
  it('has no funding operation kind at all', async () => {
    const kinds = Object.keys(
      (await import('./harness.mjs')).operations.handlers,
    );
    for (const k of kinds) {
      assert.doesNotMatch(
        k,
        /funding|settle|payout_confirm|payment/i,
        `outbox kind "${k}" looks like an offline money mutation; funding is read-only offline`,
      );
    }
  });
});
