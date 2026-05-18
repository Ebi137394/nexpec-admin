// Re-export of the internal accessor under a stable public name.
import { _requireCore, type NexpecCore } from './createCore';

/**
 * Returns the bound NexpecCore. Throws if `createCore()` hasn't been called.
 * Internal helpers use this rather than reading a top-level singleton, so
 * the failure mode (forgot to initialize) is loud and immediate.
 */
export function getCore(): NexpecCore {
  return _requireCore();
}
