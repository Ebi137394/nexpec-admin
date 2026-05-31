// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/useDefectAnalysis.ts — run the AI Co-Inspector on an image
//
//  One-line adoption for the capture-review screen: hand it an image URI, get
//  back a universal DefectAnalysis (multi-label, severity-graded, standards-
//  anchored). Registers the vision backend on demand; safe no-op when the
//  runtime is disabled or the dev-build native libs are absent.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import type { ModelKind, DefectAnalysis } from '@nexpec/shared-core';
import { getModelRuntime } from './runtime';
import { ML_RUNTIME_ENABLED } from './flags';
import { registerVisionBackend } from './vision/registerVision';
import type { VisionResult } from './vision/tfliteVision';

export type DefectAnalysisStatus =
  | 'idle'
  | 'disabled'
  | 'analyzing'
  | 'ready'
  | 'unavailable'
  | 'error';

export interface UseDefectAnalysis {
  status: DefectAnalysisStatus;
  analysis: DefectAnalysis | null;
  error: string | null;
  analyze: (imageUri: string, opts?: { kind?: ModelKind; slug?: string }) => Promise<DefectAnalysis | null>;
  reset: () => void;
}

export function useDefectAnalysis(defaults?: { kind?: ModelKind; slug?: string }): UseDefectAnalysis {
  const [status, setStatus] = useState<DefectAnalysisStatus>(ML_RUNTIME_ENABLED ? 'idle' : 'disabled');
  const [analysis, setAnalysis] = useState<DefectAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(
    async (imageUri: string, opts?: { kind?: ModelKind; slug?: string }): Promise<DefectAnalysis | null> => {
      if (!ML_RUNTIME_ENABLED) {
        setStatus('disabled');
        return null;
      }
      const kind = opts?.kind ?? defaults?.kind ?? 'vision_defect';
      const slug = opts?.slug ?? defaults?.slug ?? 'universal-detector';
      try {
        setError(null);
        setStatus('analyzing');
        const reg = await registerVisionBackend();
        if (!reg.ok) {
          setStatus('unavailable');
          setError(reg.reason ?? 'vision backend unavailable');
          return null;
        }
        const res = (await getModelRuntime().infer(kind, { imageUri }, slug)) as VisionResult;
        const a = res.analysis ?? null;
        setAnalysis(a);
        setStatus(a ? 'ready' : 'unavailable');
        return a;
      } catch (e) {
        const err = e as Error & { name?: string };
        setError(err?.message ?? 'analysis error');
        setStatus(err?.name === 'ModelUnavailableError' || err?.name === 'ModelDisabledError' ? 'unavailable' : 'error');
        return null;
      }
    },
    [defaults?.kind, defaults?.slug],
  );

  const reset = useCallback(() => {
    setAnalysis(null);
    setError(null);
    setStatus(ML_RUNTIME_ENABLED ? 'idle' : 'disabled');
  }, []);

  return { status, analysis, error, analyze, reset };
}
