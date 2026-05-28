// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/onboarding/ChecklistDismissButton.tsx
//
//  Thin client island — single button that calls dismissOnboardingChecklist.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X, Loader2 } from 'lucide-react';
import { dismissOnboardingChecklist } from '@/lib/actions/onboardingChecklist';

export function ChecklistDismissButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const r = await dismissOnboardingChecklist();
      if (r.ok) router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      aria-label="Dismiss onboarding checklist"
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.02] text-zinc-400 transition-colors hover:border-white/[0.18] hover:text-zinc-100 disabled:cursor-not-allowed"
    >
      {isPending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
      ) : (
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      )}
    </button>
  );
}
