// ════════════════════════════════════════════════════════════════════════════
//  providers/AuthProvider.tsx — DEPRECATED SHIM (AUTH-DUAL-001 cleanup)
//
//  Every previous consumer of this path has been retargeted to the
//  canonical `@/src/contexts/AuthContext` as part of AUTH-DUAL-001.
//  This file persists only because the sandboxed shell tooling cannot
//  delete files in-place; it carries zero behaviour beyond a transparent
//  forward-only re-export.
//
//  IF YOU ARE IMPORTING FROM HERE: stop. Switch your import to:
//     import { useAuth, AuthProvider } from '@/src/contexts/AuthContext';
//
//  This stub will be deleted in a future Phase-4 filesystem sweep.
// ════════════════════════════════════════════════════════════════════════════

export {
  AuthProvider,
  useAuth,
} from '@/src/contexts/AuthContext';
