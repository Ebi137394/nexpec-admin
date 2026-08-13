'use client';

// app/admin/programs/[id]/error.tsx — error boundary for one program.

import Link from 'next/link';
import { AlertTriangle, ArrowLeft } from 'lucide-react';

export default function ProgramDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main>
      <Link
        href="/admin/programs"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        All programs
      </Link>
      <div
        role="alert"
        className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200"
      >
        <span className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
          This program failed to render.
        </span>
        <p className="mt-2 text-xs opacity-80">
          No rollup is shown because none could be read — that is different from
          a program with no projects. Nothing was changed.
          {error.digest ? ` (digest: ${error.digest})` : null}
        </p>
        <button
          type="button"
          onClick={reset}
          aria-label="Retry loading this program"
          className="mt-4 rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-violet-500"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
