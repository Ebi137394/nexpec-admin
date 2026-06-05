// ════════════════════════════════════════════════════════════════════════════
//  src/core/ml/vision/registerVision.ts — lazy, guarded vision-backend registration
//
//  The vision backend pulls in native libraries (Skia, fast-tflite) that DON'T
//  exist in Expo Go. To keep Expo Go and the app boot path safe, we register it
//  via a DYNAMIC import behind a try/catch — the native modules are only
//  evaluated when this is actually called (in a dev build). If they're absent,
//  registration fails gracefully and the runtime keeps using the safe Noop
//  backend, so nothing crashes.
// ════════════════════════════════════════════════════════════════════════════

import { registerInferenceBackend } from '../backends';

let _registered = false;

export async function registerVisionBackend(): Promise<{ ok: boolean; reason?: string }> {
  if (_registered) return { ok: true };
  try {
    // Synchronous require (not dynamic import) keeps tsc happy under the
    // project's module setting; it's still lazy — the native libs are only
    // evaluated on this call, never at app boot / in Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./tfliteVision') as typeof import('./tfliteVision');
    if (!mod.isVisionAvailable()) {
      return {
        ok: false,
        reason:
          'native vision libs (@shopify/react-native-skia + react-native-fast-tflite) not present, run a dev build',
      };
    }
    registerInferenceBackend(mod.tfliteVisionBackend);
    _registered = true;
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message || 'vision backend unavailable' };
  }
}

export function isVisionBackendRegistered(): boolean {
  return _registered;
}
