// app/admin/programs/loading.tsx — streamed skeleton for the Programs console.
//
// Deliberately shaped like the console (header + program cards with a rollup
// band) so a slow read never flashes something that resembles an empty
// portfolio. "Loading" and "nothing here" must not look alike.
export default function ProgramsLoading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading programs…</span>

      <div className="mb-6 h-8 w-40 animate-pulse rounded bg-white/[0.06]" />

      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
          >
            <div className="h-4 w-56 animate-pulse rounded bg-white/[0.06]" />
            <div className="mt-2 h-3 w-72 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[0, 1, 2, 3].map((j) => (
                <div key={j}>
                  <div className="h-2.5 w-16 animate-pulse rounded bg-white/[0.04]" />
                  <div className="mt-1.5 h-4 w-20 animate-pulse rounded bg-white/[0.06]" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
