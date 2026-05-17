import { cn } from '@/lib/cn';
import type { AuditSeverity } from '@/lib/data/audit';

/**
 * Severity badge — info / warning / critical. Sized for table cells.
 */
export function SeverityBadge({ severity }: { severity: AuditSeverity }) {
  const tone =
    severity === 'critical'
      ? 'border-accent-red/40 bg-accent-red/10 text-accent-red'
      : severity === 'warning'
        ? 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber'
        : 'border-white/10 bg-white/[0.03] text-zinc-300';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial',
        tone,
      )}
    >
      {severity}
    </span>
  );
}

/**
 * event_type badge. Renders the type name in mono, tinted by the leading
 * namespace (job.*, contract.*, payout.*, etc.).
 */
export function EventTypeBadge({ type }: { type: string }) {
  const ns = type.split('.')[0] ?? 'event';
  const tone =
    ns === 'job'
      ? 'text-violet-glow'
      : ns === 'contract'
        ? 'text-cyan-glow'
        : ns === 'payout' || ns === 'payment'
          ? 'text-accent-green'
          : ns === 'application'
            ? 'text-accent-amber'
            : 'text-zinc-300';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border border-white/10 bg-white/[0.02] px-2 py-0.5 font-mono text-xs',
        tone,
      )}
    >
      {type}
    </span>
  );
}
