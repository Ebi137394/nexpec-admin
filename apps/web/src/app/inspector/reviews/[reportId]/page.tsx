// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/reviews/[reportId]/page.tsx — one report under senior review
//
//  Server shell only; see the note in ../page.tsx for why the work happens in
//  a Client Component. Role gating for the portal is enforced by
//  app/inspector/layout.tsx; per-report authorization is RLS plus the frozen
//  contract's canDecide().
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { ReviewDetail } from './ReviewDetail';

export const metadata: Metadata = {
  title: 'Report review',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ reportId: string }>;
}

export default async function InspectorReviewDetailPage({ params }: PageProps) {
  const { reportId } = await params;
  return <ReviewDetail reportId={reportId} />;
}
