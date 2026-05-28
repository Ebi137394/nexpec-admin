// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/onboarding/ChecklistRestoreButton.tsx
//
//  Inline "Show checklist" link that calls restoreOnboardingChecklist.
//  Used by the small banner that renders when a user has dismissed
//  the checklist but it is not yet 100% complete.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { restoreOnboardingChecklist } from '@/lib/actions/onboardingChecklist';

export function ChecklistRestoreButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const r = await restoreOnboardingChecklist();
      if (r.ok) router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="text-violet-300 underline decoration-violet-500/40 underline-offset-2 transition-colors hover:text-violet-200 disabled:cursor-not-allowed"
    >
      {isPending ? 'Restoring…' : 'Show checklist'}
    </button>
  );
}
