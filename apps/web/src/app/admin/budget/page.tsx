// ════════════════════════════════════════════════════════════════════════════
//  app/admin/budget/page.tsx — Platform-wide Budget Overview for Admin
//
//  Thin admin-side wrapper around the same Budget Overview surface served
//  to buyers at /client/budget. The underlying RPCs (get_budget_summary,
//  etc.) self-authorise via fin_visible_client_ids() which returns
//  EVERY buyer profile when the caller is admin/super_admin — so the
//  page renders platform-wide aggregates without any extra code path.
//
//  Why a separate route instead of re-using /client/budget?
//  Operator clarity: admins navigate inside /admin/* and shouldn't have
//  to context-switch to a "/client/..." URL to see global numbers. Same
//  component, different namespace.
//
//  The page component re-exports unchanged — the visibility scope chip
//  in the UI will read "Platform-wide" from fetchBudgetScopeMeta()
//  automatically based on profiles.role.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import BudgetOverviewPage from '@/app/client/budget/page';

export const metadata: Metadata = {
  title: 'Budget Overview · Platform-wide',
  description:
    'Live platform-wide spend tracker — committed budget, escrow holds, paid-out amounts, 12-month trend, and top inspectors by spend.',
};

export const dynamic = 'force-dynamic';

export default BudgetOverviewPage;
