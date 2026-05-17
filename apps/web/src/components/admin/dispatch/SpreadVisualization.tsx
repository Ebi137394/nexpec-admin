'use client';

import { formatCents, jobSpread } from '@nexpec/shared-core';

interface SpreadVisualizationProps {
  clientPriceCents: number | null;
  payoutCents: number | null;
}

/**
 * Three-cell margin visualization. Recomputes on every keystroke as the
 * operator types into the form. Null inputs render dashes — never zero
 * (zero would imply a real $0 spread).
 */
export function SpreadVisualization({
  clientPriceCents,
  payoutCents,
}: SpreadVisualizationProps) {
  const { spreadCents, inspectorSharePct } = jobSpread(clientPriceCents, payoutCents);
  const sharePctSafe = inspectorSharePct ?? 0;

  const overcommitted =
    clientPriceCents !== null &&
    payoutCents !== null &&
    payoutCents > clientPriceCents;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Cell label="Client charge" value={formatCents(clientPriceCents)} tone="default" />
        <Cell
          label="Inspector payout"
          value={formatCents(payoutCents)}
          tone={overcommitted ? 'red' : 'cyan'}
        />
        <Cell
          label="Platform margin"
          value={
            overcommitted
              ? formatCents(spreadCents)
              : spreadCents !== null
                ? formatCents(spreadCents)
                : '—'
          }
          tone={overcommitted ? 'red' : 'violet'}
        />
      </div>

      {/* Margin bar — only render once we have both numbers and they're sane */}
      {clientPriceCents !== null && payoutCents !== null && !overcommitted && (
        <div>
          <div className="flex justify-between text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            <span>Inspector share · {sharePctSafe}%</span>
            <span>Platform share · {Math.max(100 - sharePctSafe, 0)}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className="h-full bg-gradient-to-r from-cyan-glow to-violet"
              style={{ width: `${Math.max(0, Math.min(100, sharePctSafe))}%` }}
            />
          </div>
        </div>
      )}

      {overcommitted && (
        <p className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          Payout exceeds client price — the dispatch RPC will refuse this
          combination. Adjust one of the values.
        </p>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'default' | 'violet' | 'cyan' | 'red';
}) {
  const valueColor =
    tone === 'violet'
      ? 'text-violet-glow'
      : tone === 'cyan'
        ? 'text-cyan-glow'
        : tone === 'red'
          ? 'text-accent-red'
          : 'text-white';

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[9px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className={`mt-1 font-mono text-base font-semibold tracking-tight ${valueColor}`}>
        {value}
      </p>
    </div>
  );
}
