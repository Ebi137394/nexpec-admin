// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/error.tsx — error boundary for the client jobs area
//
//  Next.js renders this when /client/jobs (or any child segment, e.g.
//  /client/jobs/[id], /applications, /release) throws during render. Replaces
//  the full-screen platform 500 with a contained, in-portal card (sidebar +
//  header stay), a retry, AND the actual error message so the cause is visible
//  instead of buried behind a digest.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCcw, ArrowLeft } from 'lucide-react';

export default function ClientJobsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== 'undefined') {
      console.error('[client/jobs error]', error);
    }
  }, [error]);

  return (
    <div className="rounded-3xl border border-accent-red/30 bg-accent-red/5 p-8">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-red/15 text-accent-red ring-1 ring-inset ring-accent-red/30">
          <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold text-white">
            We couldn&apos;t load this job
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            This is usually transient. Most failures clear on a retry. Your
            session and the rest of your workspace are unaffected.
          </p>
          {error.digest && (
            <p className="mt-3 inline-block rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 font-mono text-[10px] text-zinc-400">
              digest, {error.digest}
            </p>
          )}
          {error.message && (
            <details className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-zinc-400">
              <summary className="cursor-pointer text-zinc-300">
                Show error detail
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-500">
                {error.message}
              </pre>
            </details>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center gap-2 rounded-full bg-violet px-4 py-2 text-xs font-semibold text-white hover:bg-violet/90"
            >
              <RefreshCcw className="h-3 w-3" strokeWidth={2} />
              Try again
            </button>
            <Link
              href="/client/jobs"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={2} />
              Back to my jobs
            </Link>
            <Link
              href="/client/dashboard"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
            >
              Back to dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
