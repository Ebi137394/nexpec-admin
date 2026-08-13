'use client';
// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/funding/error.tsx
//
//  Segment error boundary. On a money surface the reassurance matters as much
//  as the recovery: a failure to RENDER the schedule never charged anything and
//  never changed a funding state, and the copy says so plainly.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default function ClientJobFundingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== 'undefined') {
      console.error('[client/funding] segment error:', error);
    }
  }, [error]);

  return (
    <div
      role="alert"
      className="rounded-3xl border border-accent-red/30 bg-accent-red/[0.07] p-6 sm:p-8"
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-red/10 text-accent-red ring-1 ring-inset ring-accent-red/30">
        <AlertCircle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </span>
      <h1 className="mt-4 font-display text-xl font-semibold tracking-tight text-white">
        We could not open your funding schedule
      </h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-zinc-400">
        Nothing was charged and no funding state changed, this is a display
        failure only. Your tranches are exactly as they were.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-[11px] text-zinc-600">
          Reference: {error.digest}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-full border border-violet/40 bg-violet/10 px-4 py-2.5 text-sm font-medium text-violet-glow transition-colors hover:bg-violet/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={2} aria-hidden />
          Try again
        </button>
        <Link
          href="/client/finance"
          className="inline-flex items-center rounded-full border border-white/10 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/5"
        >
          Back to finance
        </Link>
      </div>
    </div>
  );
}
