// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/backends.ts — pluggable inference backends
//
//  Phase A.5 ships the SECURE PIPELINE (resolve → download → verify → cache);
//  the actual tensor execution lives behind this interface. The DEFAULT backend
//  is a Noop that reports "no backend" — so the foundation is fully wired with
//  ZERO native dependencies and ZERO breakage. When you're ready to run real
//  inference, install a native runtime (ExecuTorch / ONNX / TFLite) and register
//  it once at boot via registerInferenceBackend(). Nothing else changes.
// ════════════════════════════════════════════════════════════════════════════

import type { ModelRuntime } from '@nexpec/shared-core';

export interface LoadedModel {
  run(input: unknown): Promise<unknown>;
  release(): void;
}

export interface BackendLoadArgs {
  localUri: string;
  params: Record<string, unknown>;
  runtime: ModelRuntime;
  /** Artifact identity, threaded through so results can be attributed to the
   *  exact signed model (slug + version) — used by DefectAnalysis. */
  slug?: string;
  version?: number;
}

export interface InferenceBackend {
  /** Runtimes this backend handles. Use '*' to register a catch-all fallback. */
  readonly runtimes: ReadonlyArray<ModelRuntime | '*'>;
  load(args: BackendLoadArgs): Promise<LoadedModel>;
}

class NoopBackend implements InferenceBackend {
  readonly runtimes: ReadonlyArray<ModelRuntime | '*'> = ['*'];
  async load(): Promise<LoadedModel> {
    return {
      async run() {
        throw new Error(
          '[ml] no inference backend registered. Phase A.5 provides the secure model pipeline; ' +
            'register a backend (ExecuTorch / ONNX / TFLite) via registerInferenceBackend() to run inference.',
        );
      },
      release() {
        /* noop */
      },
    };
  }
}

const _registry = new Map<ModelRuntime, InferenceBackend>();
let _fallback: InferenceBackend = new NoopBackend();

/** Register a backend for one or more runtimes (or '*' as fallback). */
export function registerInferenceBackend(backend: InferenceBackend): void {
  for (const r of backend.runtimes) {
    if (r === '*') _fallback = backend;
    else _registry.set(r, backend);
  }
}

export function getBackend(runtime: ModelRuntime): InferenceBackend {
  return _registry.get(runtime) ?? _fallback;
}
