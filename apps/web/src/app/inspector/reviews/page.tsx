// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/reviews/page.tsx — Senior Inspector review inbox (web)
//
//  Server shell only. The work is done in <ReviewInbox />, a Client Component,
//  because shared-core binds to ONE Supabase client via createCore() and that
//  binding is a module singleton. In the browser the singleton is per tab and
//  therefore per user; binding it on the server would share one user's
//  cookie-bound client across concurrent requests. The route's authorization
//  is RLS + the frozen contract's canDecide(), neither of which depends on
//  where the render happens.
//
//  Role gating for the whole portal is already enforced by
//  app/inspector/layout.tsx.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { ReviewInbox } from './ReviewInbox';

export const metadata: Metadata = {
  title: 'Assigned reviews',
};

export const dynamic = 'force-dynamic';

export default function InspectorReviewsPage() {
  return <ReviewInbox />;
}
