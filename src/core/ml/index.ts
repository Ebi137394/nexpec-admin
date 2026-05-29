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
export type { ModelStatus, ModelHandle, NexpecModelRuntime } from './runtime';

export { registerInferenceBackend, getBackend } from './backends';
export type { InferenceBackend, LoadedModel, BackendLoadArgs } from './backends';

export { useModel } from './useModel';
export type { UseModelResult } from './useModel';

export { ML_RUNTIME_ENABLED } from './flags';

// Concrete Expo providers, exported for advanced wiring / tests.
export {
  expoHashProvider,
  expoFileStore,
  expoManifestCache,
  subtleSignatureVerifier,
} from './providers.expo';
