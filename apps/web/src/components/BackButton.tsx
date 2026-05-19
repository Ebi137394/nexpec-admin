// ════════════════════════════════════════════════════════════════════════════
//  components/BackButton.tsx — router.back() with a sane fallback
//
//  Tiny client component. If the user landed on this page directly
//  (history.length === 1), the back button routes to `fallbackHref`
//  instead of bouncing to about:blank.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

interface Props {
  fallbackHref?: string;
  label?: string;
}

export function BackButton({ fallbackHref = '/', label = 'Back' }: Props) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        try {
          if (typeof window !== 'undefined' && window.history.length > 1) {
            router.back();
            return;
          }
        } catch {
          /* fall through */
        }
        router.push(fallbackHref);
      }}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.06] hover:text-white"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
      {label}
    </button>
  );
}
