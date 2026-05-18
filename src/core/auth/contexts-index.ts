// ════════════════════════════════════════════════════════════════════════════
//  src/core/auth/contexts-index.ts — LANE-A-PHASE-3 barrel rebuild
//
//  Pre-strike: top-level contexts/index.ts re-exported './AuthContext'
//  from its sibling at the same level. Post-strike: the canonical
//  AuthContext lives at src/contexts/AuthContext.tsx (not moved by
//  Phase 3 — already inside src/). The barrel now points at it directly
//  so legacy `import { useAuth } from '@/contexts'` paths keep working
//  through the contexts/index.ts forwarding stub.
// ════════════════════════════════════════════════════════════════════════════

export * from '@/src/contexts/AuthContext';
