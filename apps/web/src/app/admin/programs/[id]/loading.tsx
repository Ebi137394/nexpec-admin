// app/admin/programs/[id]/loading.tsx — skeleton for one program.
//
// Shaped like the detail page: title, rollup band, linkage panel, project
// table. A pending rollup must never render as zeroes.
export default function ProgramDetailLoading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading this program…</span>

      <div className="h-3 w-24 animate-pulse rounded bg-white/[0.04]" />
      <div className="mt-5 h-7 w-64 animate-pulse rounded bg-white/[0.06]" />
      <div className="mt-2 h-3 w-80 animate-pulse rounded bg-white/[0.04]" />

      <div className="mt-6 rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5">
        <div className="h-3.5 w-16 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i}>
              <div className="h-2.5 w-14 animate-pulse rounded bg-white/[0.04]" />
              <div className="mt-1.5 h-4 w-16 animate-pulse rounded bg-white/[0.06]" />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5">
        <div className="h-3.5 w-28 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-4 space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-8 w-full animate-pulse rounded bg-white/[0.03]"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
