// ════════════════════════════════════════════════════════════════════════════
//  app/reviews/submit/[jobId].tsx
//  NEXPEC — Premium Review & Reputation Engine
//
//  Universal review submission route. Accessible from any role's job
//  detail screen via:
//      router.push(`/reviews/submit/${jobId}`)
//
//  RLS + the submit_review RPC handle authorization — this route is
//  just the host shell.
// ════════════════════════════════════════════════════════════════════════════

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ReviewSubmissionScreen from '@/src/components/reviews/ReviewSubmissionScreen';

export default function ReviewSubmitRoute() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  return <ReviewSubmissionScreen jobId={String(jobId)} />;
}
