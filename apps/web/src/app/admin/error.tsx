// app/admin/error.tsx — segment error boundary (portal shell stays mounted).
'use client';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-sm text-zinc-400">
        Something went wrong loading this page.
        {error.digest ? ` (digest: ${error.digest})` : null}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-500"
      >
        Try again
      </button>
    </div>
  );
}
