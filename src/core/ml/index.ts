// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml — NEXPEC on-device Model Runtime (Phase A.5)
//
//  Public surface for the app. Import what you need:
//
//    import { useModel } from '@/src/core/ml';
//    const vision = useModel('vision_defect', { slug: 'corrosion-detector' });
//
//  Nothing here runs until EXPO_PUBLIC_ML_RUNTIME=1, and no existing screen
//  imports this module — so the foundation is inert by default (Law 1).
// ════════════════════════════════════════════════════════════════════════════

export {
  getModelRuntime,
  setSignatureVerifier,
  ModelDisabledError,
  ModelUnavailableError,
} from './runtime';
export type { ModelStatus, ModelStage, ModelHandle, NexpecModelRuntime } from './runtime';

export { registerInferenceBackend, getBackend } from './backends';
export type { InferenceBackend, LoadedModel, BackendLoadArgs } from './backends';

export { useModel } from './useModel';
export type { UseModelResult } from './useModel';

// AI Co-Inspector: run the universal defect model on an image. (The voice
// Copilot hook lives at ./voice/useVoiceFindings and is imported directly by a
// voice screen — kept out of this barrel so its optional STT dep isn't bundled
// until installed.)
export { useDefectAnalysis } from './useDefectAnalysis';
export type { UseDefectAnalysis, DefectAnalysisStatus } from './useDefectAnalysis';

export { ML_RUNTIME_ENABLED, ML_ALLOW_UNSIGNED } from './flags';

// Concrete Expo providers, exported for advanced wiring / tests.
export {
  expoHashProvider,
  expoFileStore,
  expoManifestCache,
  subtleSignatureVerifier,
} from './providers.expo';
