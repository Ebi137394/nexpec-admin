// ─────────────────────────────────────────────────────────────────
//  src/core/ml/vision/modelLease.ts — single-slot model lifecycle engine.
//
//  Owns the THREE invariants the vision stack must never violate
//  (D37 follow-up: the eager dispose() fix exposed a lifecycle race —
//  "model not resident (mode superseded)" and dispose-under-use when a
//  swap was requested while an inference was still in flight):
//
//   1. TOTAL SERIALIZATION — every model operation (load, swap, run +
//      post-processing, disposal) executes on one chain, concurrency 1.
//      Overlapping analyze()/warm() calls queue; they never interleave.
//   2. LEASES — an inference holds the slot (activeRuns > 0) until its
//      `use` callback fully completes, post-processing included. A
//      superseded model is only MARKED doomed; dispose() fires when the
//      active-run count reaches zero, and exactly once (model ref is
//      nulled before disposing).
//   3. EAGER RELEASE (D37) — between jobs the run count is zero, so a
//      swap still disposes the outgoing model immediately in the normal
//      case; ~4 retained 42 MB models OOM a 192 MB-heap device.
//
//  Pure TS, no React Native imports — regression-tested directly under
//  node (vision/__tests__/modelLease.test.mjs).
// ─────────────────────────────────────────────────────────────────

export interface Disposable {
  dispose?: () => void;
}

interface Slot<M> {
  key: string;
  model: M | null;
  activeRuns: number;
  doomed: boolean;
}

export class SingleSlotLease<M extends Disposable> {
  private slot: Slot<M> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  // Plain field (not a TS parameter property): this module is executed
  // directly by node's strip-only TS loader in the regression suite.
  private readonly load: (key: string) => Promise<M>;

  constructor(load: (key: string) => Promise<M>) {
    this.load = load;
  }

  /** Key of the currently resident model (diagnostics). */
  residentKey(): string | null {
    return this.slot?.model ? this.slot.key : null;
  }

  /** Serialize a job onto the single operation chain (concurrency = 1). */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.chain.then(job);
    this.chain = next.catch(() => undefined); // an error must not wedge the chain
    return next;
  }

  private disposeIfIdle(slot: Slot<M>): void {
    if (!slot.doomed || slot.activeRuns !== 0 || slot.model == null) return;
    const m = slot.model;
    slot.model = null; // null BEFORE dispose → a second path can never double-dispose
    try {
      m.dispose?.();
    } catch {
      /* native side already released */
    }
  }

  /**
   * Run `use` with the model for `key` under a lease. Loads or swaps the
   * single slot first (evicting + eventually disposing any other model),
   * holds the lease until `use` fully settles, then releases it — which is
   * when a deferred dispose fires if the model was superseded mid-run.
   */
  withModel<T>(key: string, use: (model: M) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      if (this.slot && (this.slot.key !== key || this.slot.model == null)) {
        this.slot.doomed = true;
        this.disposeIfIdle(this.slot);
        this.slot = null;
      }
      if (!this.slot) {
        const model = await this.load(key);
        this.slot = { key, model, activeRuns: 0, doomed: false };
      }
      const slot = this.slot;
      slot.activeRuns += 1;
      try {
        return await use(slot.model as M);
      } finally {
        slot.activeRuns -= 1;
        this.disposeIfIdle(slot);
      }
    });
  }

  /** Preload without running (queued like every other operation). */
  warm(key: string): Promise<void> {
    return this.withModel(key, async () => undefined);
  }

  /**
   * Release the slot (screen unmount / memory pressure). Never disposes
   * under a live lease: an in-flight run finishes normally and the deferred
   * dispose fires at its release.
   */
  evict(): void {
    const s = this.slot;
    this.slot = null;
    if (s) {
      s.doomed = true;
      this.disposeIfIdle(s);
    }
  }
}
