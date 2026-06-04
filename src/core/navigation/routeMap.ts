// ════════════════════════════════════════════════════════════════════════════
//  src/core/navigation/routeMap.ts
//
//  PHASE 3 · ROUTING DEFRAGMENTATION — the single source of truth for where each
//  role lands and what the canonical route to a surface is. The AuthGate
//  (app/_layout.tsx) previously hard-coded the same role→destination logic TWICE
//  (auth-page redirect + unknown-path fallback) and the two copies had DRIFTED
//  (enterprise → enterprise-dashboard in one, → agency-dashboard in the other).
//  Centralising here removes the drift and gives every future screen one place
//  to ask "where does this role go?".
// ════════════════════════════════════════════════════════════════════════════

export type AppRole =
  | 'super_admin' | 'admin' | 'agency' | 'enterprise' | 'client' | 'inspector' | 'supplier';

/** Canonical paths. Anything navigating by role should reference these. */
export const ROUTES = {
  signIn:              '/(auth)/sign-in',
  adminDashboard:      '/(admin)/dashboard',
  adminInbox:          '/(admin)/admin-inbox',
  agencyDashboard:     '/(tabs)/agency-dashboard',
  enterpriseDashboard: '/(tabs)/enterprise-dashboard',
  clientDashboard:     '/(tabs)/client-dashboard',
  supplierDashboard:   '/(tabs)/supplier-dashboard',
  inspectorHome:       '/(tabs)',
} as const;

/** admin ≡ super_admin (god-mode, Phase 1). One predicate everywhere. */
export function isPlatformAdmin(role?: string | null): boolean {
  return role === 'admin' || role === 'super_admin';
}

/**
 * The canonical home route for a role. `super_admin` lands on the full admin
 * dashboard; `admin` (operator) lands on the inbox — both inside the (admin)
 * group, which both can enter after the Phase 1 god-mode routing fix.
 */
export function roleHome(role?: string | null): string {
  switch (role) {
    case 'super_admin': return ROUTES.adminDashboard;
    case 'admin':       return ROUTES.adminInbox;
    case 'agency':      return ROUTES.agencyDashboard;
    case 'enterprise':  return ROUTES.enterpriseDashboard;
    case 'client':      return ROUTES.clientDashboard;
    case 'inspector':   return ROUTES.inspectorHome;
    case 'supplier':    return ROUTES.supplierDashboard;
    default:            return ROUTES.inspectorHome;
  }
}
