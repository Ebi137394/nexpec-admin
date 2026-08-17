// ════════════════════════════════════════════════════════════════════════════
//  app/(inspector)/reviews/roundState.ts
//
//  Round classification for the mobile Senior Inspector inbox.
//
//  RECOVERED ARTIFACT. The mobile Lane B agent was terminated by the session
//  limit after writing index.tsx (which imports this module) but before
//  writing the module itself, leaving the root typecheck failing on TS2307.
//  This is a faithful mirror of the web sibling — apps/web/src/app/inspector/
//  reviews/ReviewRoundList.tsx:33 — so both platforms classify a round
//  identically. If you change one, change the other; the classification is a
//  contract behaviour, not a per-platform styling choice.
//
//  The four states are derived THROUGH the frozen contract rather than by
//  re-reading raw columns: isLiveRound() is the authority on "live" and
//  REVIEW_DECISION is the authority on the two decided states. Everything
//  else is a superseded round — the replacement case, which must never render
//  as the live one, because a Senior Inspector whose assignment was replaced
//  has no standing to act and the server will reject them.
// ════════════════════════════════════════════════════════════════════════════

// Deep path, not the "./domain" exports subpath: the mobile TS config does not
// honour package `exports`, so the subpath fails to resolve here (TS2307) even
// though apps/web resolves it fine. index.tsx and reviewClient.ts in this same
// route already import this way — matching them keeps the route consistent.
import {
  isLiveRound,
  REVIEW_DECISION,
  type SeniorReviewRound,
} from '@nexpec/shared-core/src/domain/seniorReview';

export type RoundState = 'live' | 'approved' | 'returned' | 'superseded';

export function roundState(r: SeniorReviewRound): RoundState {
  if (isLiveRound(r)) return 'live';
  if (r.decision === REVIEW_DECISION.APPROVED) return 'approved';
  if (r.decision === REVIEW_DECISION.RETURNED) return 'returned';
  return 'superseded';
}

/**
 * Presentation metadata. `label` and `description` are plain English strings
 * passed through the screen's `t()` — the mobile shell keys translations on
 * the English source, matching every other string in this route.
 *
 * `tone` is a single colour the screen composes into a pill (border at 55
 * alpha, background at 1A). Values come from the route's own palette so the
 * inbox stays consistent with the rest of the inspector surface.
 */
export const ROUND_STATE_META: Record<
  RoundState,
  { label: string; description: string; tone: string }
> = {
  live: {
    label: 'Awaiting your decision',
    description: 'This round is open and assigned to you.',
    tone: '#00FFFF',
  },
  approved: {
    label: 'Approved',
    description: 'You approved this round. It is final and cannot be edited.',
    tone: '#10B981',
  },
  returned: {
    label: 'Returned with comments',
    description:
      'You returned this round to the Inspector. It is final and cannot be edited.',
    tone: '#F59E0B',
  },
  superseded: {
    label: 'Superseded',
    description:
      'This assignment was replaced before it was decided. It is closed out, not rewritten.',
    tone: '#6B7390',
  },
};
