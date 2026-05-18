// ★ AUTH-DUAL-001 — Re-export from the canonical context. The legacy
//   `providers/AuthProvider` path was retired in this strike; any code
//   that imported `useAuth` via `src/index.ts` now transparently gets
//   the singleton hook.
export { useAuth } from './contexts/AuthContext';
