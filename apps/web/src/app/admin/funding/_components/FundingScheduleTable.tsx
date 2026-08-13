// ════════════════════════════════════════════════════════════════════════════
//  _components/FundingScheduleTable.tsx
//
//  Every stage of one job's funding schedule: tranche, contracted basis, the
//  gate it governs, its share in basis points, the client-money amount, and
//  its status.
//
//  ADMIN-ONLY. It renders client money. It lives under app/admin/funding and
//  is imported by nothing else — do not lift it into components/.
//
//  Amounts come from trancheAmountCents() (integer truncation, mirroring the
//  SQL). The truncation residue is shown in the footer rather than folded
//  silently into a row: nx_funding_ensure_schedule folds it into the final
//  tranche, nx_admin_set_funding_terms does not, and a screen must not guess
//  which one wrote these rows.
// ════════════════════════════════════════════════════════════════════════════

import { formatCents } from '@nexpec/shared-core';
import { BPS_TOTAL, type FundingStageView } from '@nexpec/shared-core/domain';

import { cn } from '@/lib/cn';
import { formatBps, priceSchedule, stageStatusTone } from '../_lib/schedule';

interface FundingScheduleTableProps {
  clientPriceCents: number;
  stages: readonly FundingStageView[];
}

const STATUS_STYLES: Record<
  ReturnType<typeof stageStatusTone>,
  { chip: string; note: string }
> = {
  funded: {
    chip: 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow',
    note: 'Client money is in. Satisfies its gate.',
  },
  waived: {
    chip: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
    note: 'Admin waiver. Satisfies its gate without payment — the platform carries it.',
  },
  refunded: {
    chip: 'border-accent-red/40 bg-accent-red/10 text-accent-red',
    note: 'Returned to the client. Does NOT satisfy its gate.',
  },
  scheduled: {
    chip: 'border-white/15 bg-white/[0.04] text-zinc-300',
    note: 'Contracted, not yet funded.',
  },
};

export function FundingScheduleTable({
  clientPriceCents,
  stages,
}: FundingScheduleTableProps) {
  if (stages.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
        <p className="font-display text-base font-semibold text-white">
          No funding schedule on this job.
        </p>
        <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-500">
          Nothing has been materialised in{' '}
          <span className="font-mono text-cyan-glow/80">job_funding_stages</span>{' '}
          yet. Jobs that predate the staged-funding spine look like this and are
          dispatched against the legacy{' '}
          <span className="font-mono text-cyan-glow/80">client_settled_at</span>{' '}
          stamp. Setting terms below writes a real schedule.
        </p>
      </div>
    );
  }

  const priced = priceSchedule(clientPriceCents, stages);
  const totalsMatch = priced.totalBps === BPS_TOTAL;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/50 to-ink-900/20">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Funding schedule: every contracted tranche for this job, with its
            trigger basis, share in basis points, amount in client money, and
            settlement status.
          </caption>
          <thead>
            <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-industrial text-zinc-500">
              <th scope="col" className="px-5 py-3 font-semibold">
                Tranche
              </th>
              <th scope="col" className="px-5 py-3 font-semibold">
                Trigger basis
              </th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">
                Share
              </th>
              <th scope="col" className="px-5 py-3 text-right font-semibold">
                Amount (client)
              </th>
              <th scope="col" className="px-5 py-3 font-semibold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {priced.rows.map(({ stage, meaning, amountCents }) => {
              const tone = stageStatusTone(stage.status);
              const style = STATUS_STYLES[tone];
              return (
                <tr
                  key={`${stage.code}-${stage.trancheNo}`}
                  className="border-b border-white/[0.04] align-top last:border-b-0"
                >
                  <th scope="row" className="px-5 py-4 font-normal">
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] text-zinc-600">
                        #{stage.trancheNo}
                      </span>
                      <span className="font-display text-sm font-semibold text-white">
                        {meaning.title}
                      </span>
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-zinc-600">
                      {stage.code}
                    </span>
                  </th>
                  <td className="px-5 py-4">
                    <span className="text-xs font-medium text-zinc-200">
                      {meaning.basis}
                    </span>
                    <span className="mt-1 block max-w-sm text-[11px] leading-relaxed text-zinc-500">
                      {meaning.gate}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span className="font-mono text-sm font-semibold text-white">
                      {formatBps(stage.pctBps)}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-zinc-600">
                      {stage.pctBps} bps
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <span className="font-mono text-sm font-semibold text-cyan-glow">
                      {formatCents(amountCents)}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-industrial',
                        style.chip,
                      )}
                    >
                      {stage.status}
                    </span>
                    <span className="mt-1.5 block max-w-[16rem] text-[11px] leading-relaxed text-zinc-500">
                      {style.note}
                    </span>
                    {stage.fundedAt && (
                      <span className="mt-1 block font-mono text-[10px] text-zinc-600">
                        {new Date(stage.fundedAt).toISOString().replace('T', ' ').slice(0, 16)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/[0.08] bg-white/[0.02]">
              <td colSpan={2} className="px-5 py-3.5">
                <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                  Contracted total
                </span>
              </td>
              <td className="px-5 py-3.5 text-right">
                <span
                  className={cn(
                    'font-mono text-sm font-semibold',
                    totalsMatch ? 'text-white' : 'text-accent-red',
                  )}
                >
                  {formatBps(priced.totalBps)}
                </span>
              </td>
              <td className="px-5 py-3.5 text-right">
                <span className="font-mono text-sm font-semibold text-white">
                  {formatCents(priced.allocatedCents)}
                </span>
              </td>
              <td className="px-5 py-3.5">
                <span className="text-[11px] text-zinc-500">
                  of {formatCents(clientPriceCents)} client price
                </span>
              </td>
            </tr>
            {priced.residueCents !== 0 && (
              <tr className="bg-white/[0.02]">
                <td colSpan={5} className="px-5 pb-4 pt-0">
                  <p className="text-[11px] leading-relaxed text-zinc-500">
                    <span className="font-mono text-amber-300">
                      {formatCents(priced.residueCents)}
                    </span>{' '}
                    rounding residue. Each tranche truncates at{' '}
                    <span className="font-mono text-zinc-400">
                      (price × bps) / {BPS_TOTAL}
                    </span>
                    , exactly as the database does. The platform-seeded default
                    schedule folds this into the final tranche; an Admin
                    override leaves it unallocated. Shown here rather than
                    hidden inside a row.
                  </p>
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  );
}
