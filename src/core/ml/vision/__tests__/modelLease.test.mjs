// ════════════════════════════════════════════════════════════════════════════
//  Model-lifecycle regression (D37 follow-up race).
//
//  Observed live on iOS (/mldiag): a swap requested while an inference was
//  still in flight produced "model not resident (mode superseded)" and could
//  dispose a model under a live run. This suite runs the REAL lifecycle
//  engine (modelLease.ts — the exact code SegModelManager delegates to) and
//  proves the owner-specified contract:
//
//    1. inference on model A starts (run() blocked on a gate);
//    2. model B is requested while A is still running;
//    3. A completes successfully;
//    4. A is disposed EXACTLY once, and only AFTER A's run fully completed;
//    5. B then loads and runs;
//    6. zero "model not resident" / dispose-under-use errors.
//
//  Plus: evict() during a live run defers disposal to the run's release.
//
//  Run:
//    node --test src/core/ml/vision/__tests__/modelLease.test.mjs
// ════════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SingleSlotLease } from '../modelLease.ts';

function gate() {
  let open;
  const p = new Promise((r) => { open = r; });
  return { p, open };
}

function makeModel(key, log) {
  return {
    key,
    disposed: 0,
    dispose() {
      this.disposed += 1;
      log.push(`dispose:${key}#${this.disposed}`);
    },
  };
}

describe('SingleSlotLease — D37 lifecycle race', () => {
  it('A completes, is disposed exactly once after completion, then B loads and runs', async () => {
    const log = [];
    const models = {};
    const lease = new SingleSlotLease(async (key) => {
      const m = makeModel(key, log);
      models[key] = m;
      log.push(`load:${key}`);
      return m;
    });

    const aGate = gate();

    // 1. Inference on A — blocks inside its leased run.
    const aRun = lease.withModel('A', async (model) => {
      log.push('A:run-start');
      assert.equal(model.key, 'A');
      await aGate.p; // still running...
      assert.equal(model.disposed, 0, 'A must NOT be disposed under the live run');
      log.push('A:run-end');
      return 'A-result';
    });

    // 2. Request B while A is still running (queued, never interleaved).
    const bRun = lease.withModel('B', async (model) => {
      log.push('B:run-start');
      assert.equal(model.key, 'B');
      assert.equal(models.A.disposed, 1, 'A already disposed exactly once before B runs');
      log.push('B:run-end');
      return 'B-result';
    });

    // Nothing from B may have happened yet.
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(!log.includes('load:B'), 'B must not load while A holds the chain');

    // 3. Let A finish.
    aGate.open();
    assert.equal(await aRun, 'A-result');
    assert.equal(await bRun, 'B-result');

    // 4-6. Exact global ordering: A fully completes → A disposed once → B loads/runs.
    assert.deepEqual(log, [
      'load:A',
      'A:run-start',
      'A:run-end',
      'dispose:A#1',
      'load:B',
      'B:run-start',
      'B:run-end',
    ]);
    assert.equal(models.A.disposed, 1, 'A disposed exactly once');
    assert.equal(models.B.disposed, 0, 'B still resident');
    assert.equal(lease.residentKey(), 'B');
  });

  it('evict() during a live run defers disposal to the run release; same-key reuse skips reload', async () => {
    const log = [];
    const models = {};
    const lease = new SingleSlotLease(async (key) => {
      const m = makeModel(key, log);
      models[key] = m;
      log.push(`load:${key}`);
      return m;
    });

    // Same-key back-to-back: one load, no dispose between runs.
    await lease.withModel('A', async () => log.push('run1'));
    await lease.withModel('A', async () => log.push('run2'));
    assert.deepEqual(log, ['load:A', 'run1', 'run2']);
    assert.equal(models.A.disposed, 0);

    // Evict mid-run: dispose must wait for the release, then fire once.
    const g = gate();
    const run = lease.withModel('A', async (model) => {
      lease.evict(); // superseded while running
      await g.p;
      assert.equal(model.disposed, 0, 'not disposed under the live run');
      return 'ok';
    });
    g.open();
    assert.equal(await run, 'ok');
    assert.equal(models.A.disposed, 1, 'deferred dispose fired exactly once at release');
    assert.equal(lease.residentKey(), null);

    // A failing run still releases the lease and keeps the chain alive.
    await assert.rejects(
      lease.withModel('A', async () => { throw new Error('boom'); }),
      /boom/,
    );
    const after = await lease.withModel('A', async () => 'alive');
    assert.equal(after, 'alive', 'chain survives a failed run');
  });
});
