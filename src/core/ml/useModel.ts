// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/useModel.ts — React hook over the model runtime
//
//  Safe to drop into any screen. When the runtime is disabled it reports
//  status 'disabled' and does nothing — no network, no IO — so adding this hook
//  to a screen cannot change behavior until EXPO_PUBLIC_ML_RUNTIME=1.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelKind } from '@nexpec/shared-core';
import { getModelRuntime, type ModelStatus } from './runtime';
import { ML_RUNTIME_ENABLED } from './flags';

export interface UseModelResult {
  status: ModelStatus;
  error: Error | null;
  enabled: boolean;
  /** Resolve + download + verify the model. Returns true when ready. */
  prepare: () => Promise<boolean>;
  /** Run inference (loads on demand). Result is unknown — cast at call site. */
  infer: (input: unknown) => Promise<unknown>;
}

export function useModel(kind: ModelKind, opts?: { slug?: string; auto?: boolean }): UseModelResult {
  const [status, setStatus] = useState<ModelStatus>(ML_RUNTIME_ENABLED ? 'idle' : 'disabled');
  const [error, setError] = useState<Error | null>(null);
  const mounted = useRef(true);
  const slug = opts?.slug;
  const auto = opts?.auto;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const prepare = useCallback(async (): Promise<boolean> => {
    if (!ML_RUNTIME_ENABLED) {
      setStatus('disabled');
      return false;
    }
    try {
      setError(null);
      setStatus('resolving');
      const rt = getModelRuntime();
      setStatus('downloading');
      await rt.ensure(kind, slug);
      if (mounted.current) setStatus('ready');
      return true;
    } catch (e) {
      const err = e as Error & { name?: string };
      if (mounted.current) {
        setError(err);
        setStatus(err?.name === 'ModelUnavailableError' || err?.name === 'ModelDisabledError' ? 'unavailable' : 'error');
      }
      return false;
    }
  }, [kind, slug]);

  const infer = useCallback(
    async (input: unknown): Promise<unknown> => {
      const rt = getModelRuntime();
      return rt.infer(kind, input, slug);
    },
    [kind, slug],
  );

  useEffect(() => {
    if (auto && ML_RUNTIME_ENABLED) void prepare();
  }, [auto, prepare]);

  return { status, error, enabled: ML_RUNTIME_ENABLED, prepare, infer };
}
