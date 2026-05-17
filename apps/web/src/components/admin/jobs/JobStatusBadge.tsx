import { cn } from '@/lib/cn';
import { jobStatusLabel, type JobStatus } from '@nexpec/shared-core';

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const tone =
    status === 'completed'
      ? 'border-accent-green/40 bg-accent-green/10 text-accent-green'
      : status === 'cancelled'
        ? 'border-white/15 bg-white/[0.04] text-zinc-400'
        : status === 'disputed'
          ? 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber'
          : status === 'in_progress'
            ? 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow'
            : status === 'assigned'
              ? 'border-violet/40 bg-violet/10 text-violet-glow'
              : 'border-white/15 bg-white/[0.04] text-zinc-300';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial',
        tone,
      )}
    >
      {jobStatusLabel(status)}
    </span>
  );
}
