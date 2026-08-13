'use client';

// app/admin/programs/error.tsx — segment error boundary for Programs.
//
// This catches a THROW (an unexpected failure in the segment). An expected
// read failure is handled inside the page and rendered as an explicit error
// panel, so the two are never confused with an empty portfolio.

import { AlertTriangle } from 'lucide-react';

export default function ProgramsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <h1 className="text-2xl font-semibold text-white">Programs</h1>
      <div
        role="alert"
        className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200"
      >
        <span className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
          The Programs console failed to render.
        </span>
        <p className="mt-2 text-xs opacity-80">
          Nothing was changed. This is a failure, not an empty portfolio — no
          program has been created, modified or unlinked.
          {error.digest ? ` (digest: ${error.digest})` : null}
        </p>
        <button
          type="button"
          onClick={reset}
          aria-label="Retry loading the Programs console"
          className="mt-4 rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
