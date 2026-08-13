// app/client/jobs/[id]/funding/loading.tsx — streamed skeleton for the funding
// shell. The schedule itself has its own in-component loading state; this
// covers the server read of the job facts.
export default function ClientJobFundingLoading() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div role="status" aria-live="polite" className="space-y-3">
        <span className="sr-only">Loading your funding schedule</span>
        <div className="h-3 w-40 animate-pulse rounded-full bg-white/[0.06]" />
        <div className="h-9 w-2/3 animate-pulse rounded-lg bg-white/[0.06]" />
        <div className="h-4 w-full max-w-2xl animate-pulse rounded-full bg-white/[0.04]" />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.02]"
          />
        ))}
      </div>
      <div className="space-y-3" aria-hidden>
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-3xl border border-white/[0.06] bg-white/[0.02]"
          />
        ))}
      </div>
    </div>
  );
}
