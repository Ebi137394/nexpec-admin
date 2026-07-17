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
//  view component, different mode — controls only the route prefix used
//  by the by-department cost-center panel (window-selector links + the
//  "drill into structure" CTA route through /admin/* when admin viewers
//  click them, /client/* when buyers do).
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { BudgetOverviewView } from '@/app/client/budget/page';

export const metadata: Metadata = {
  title: 'Budget Overview, Platform-wide',
  description:
    'Live platform-wide spend tracker, committed budget, payment holds, paid-out amounts, 12-month trend, top inspectors by spend, and per-department cost-center roll-up.',
};

export const dynamic = 'force-dynamic';

interface AdminBudgetPageProps {
  searchParams?: Promise<{ window?: string }>;
}

export default async function AdminBudgetPage(
  props: AdminBudgetPageProps = {},
) {
  return BudgetOverviewView({ ...props, mode: 'admin' });
}
