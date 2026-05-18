// ════════════════════════════════════════════════════════════════════════════
//  lib/data/reviews.types.ts
// ════════════════════════════════════════════════════════════════════════════

export type ReviewDirection = 'client_to_inspector' | 'inspector_to_client';

export const REVIEW_DIRECTION_LABELS: Record<ReviewDirection, string> = {
  client_to_inspector: 'Client review of inspector',
  inspector_to_client: 'Inspector review of client',
};

export interface Review {
  id: string;
  jobId: string;
  jobTitle: string | null;
  reviewerId: string;
  reviewerLabel: string | null;
  revieweeId: string;
  direction: ReviewDirection;
  rating: number;             // 1–5
  wouldRecommend: boolean;
  body: string | null;
  publishedAt: string;
}

export interface ReviewAggregates {
  ratingAverage: number;       // numeric(3,2)
  ratingCount: number;
  recommendPercent: number;    // 0–100
  completedJobsCount: number;
}
