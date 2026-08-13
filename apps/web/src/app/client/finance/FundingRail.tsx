'use client';

// ════════════════════════════════════════════════════════════════════════════
//  app/client/finance/FundingRail.tsx
//
//  The finance page's funding rail: which of my jobs are waiting on money from
//  me, and what is the next thing I can pay.
//
//  WHY THIS EXISTS AS A CLIENT ISLAND
//  fundingRailData.ts (server) resolves only job SCALARS — title, status,
//  client price, client_settled_at. It deliberately reads no funding row,
//  because the schedule must come through the audience-scoped accessor. So the
//  server hands down facts, and this island fans out one fetchClientFunding()
//  per job to get the stages. That is what FUNDING_RAIL_LIMIT (12) bounds.
//
//  PRIVACY
//  fetchClientFunding returns a ClientFundingProjection, whose type has no
//  inspector payout and no platform spread field at all — there is nothing
//  here to leak even by accident. Every figure rendered below is the buyer's
//  own obligation.
//
//  This rail is also the only inbound link to /client/jobs/[id]/funding. Before
//  it, that route was reachable only by typing the URL.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CircleDollarSign, CheckCircle2 } from 'lucide-react';

import {
  fetchClientFunding,
} from '@nexpec/shared-core/net';
import {
  formatCents,
  isDeliveryFundingSatisfied,
  isInitialFundingSatisfied,
  outstandingTranches,
  type ClientFundingProjection,
} from '@nexpec/shared-core/domain';

import { bindFundingCore } from '../jobs/[id]/funding/fundingCore';
import { STAGE_LABEL, type FundingJobFacts } from '../jobs/[id]/funding/fundingView';

interface RailRow {
  readonly facts: FundingJobFacts;
  readonly projection: ClientFundingProjection | null;
}

export function FundingRail({ jobs }: { jobs: readonly FundingJobFacts[] }) {
  const [rows, setRows] = useState<RailRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (jobs.length === 0) {
      setRows([]);
      return;
    }
    bindFundingCore();

    (async () => {
      try {
        const settled = await Promise.all(
          jobs.map(async (facts) => {
            try {
              const projection = await fetchClientFunding({
                jobId: facts.jobId,
                clientPriceCents: facts.clientPriceCents,
              });
              return { facts, projection };
            } catch {
              // one unreadable job must not blank the whole rail
              return { facts, projection: null };
            }
          }),
        );
        if (!cancelled) setRows(settled);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [jobs]);

  if (failed) {
    return (
      <p role="alert" className="text-sm text-zinc-500">
        Funding positions are unavailable right now. Your jobs are unaffected —
        open a job to see its funding schedule.
      </p>
    );
  }

  if (rows === null) {
    return (
      <p role="status" aria-live="polite" className="text-sm text-zinc-500">
        Loading funding positions…
      </p>
    );
  }

  // Only jobs that actually want money from the buyer. A job whose tranches are
  // all in is not an action, so it does not belong on an action rail.
  const actionable = rows.filter((r) => {
    if (!r.projection) return false;
    return (
      outstandingTranches(r.projection.stages).length > 0 ||
      (r.projection.stages.length === 0 && r.facts.legacyClientSettledAt === null)
    );
  });

  if (actionable.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.01] px-4 py-6 text-sm text-zinc-400">
        <CheckCircle2 className="h-4 w-4 text-accent-green" strokeWidth={2} />
        Nothing is waiting on funding from you.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {actionable.map(({ facts, projection }) => {
        const stages = projection!.stages;
        const next = outstandingTranches(stages)[0] ?? null;
        const workAuthorised = isInitialFundingSatisfied(
          stages,
          facts.legacyClientSettledAt,
        );
        const deliveryReady = isDeliveryFundingSatisfied(
          stages,
          facts.legacyClientSettledAt,
        );
        const dueCents = next
          ? (projection!.stageAmountsCents[next.code] ?? 0)
          : 0;

        return (
          <li key={facts.jobId}>
            <Link
              href={`/client/jobs/${facts.jobId}/funding`}
              className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.01] px-4 py-3 transition-colors hover:border-white/[0.12] hover:bg-white/[0.03]"
            >
              <CircleDollarSign
                className="h-4 w-4 shrink-0 text-cyan-glow"
                strokeWidth={2}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">
                  {facts.title}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {next
                    ? `${STAGE_LABEL[next.code] ?? next.code} due — ${formatCents(dueCents)}`
                    : 'Funding schedule not started'}
                  {!workAuthorised && ' · work not yet authorised'}
                  {workAuthorised && !deliveryReady && ' · needed before final delivery'}
                </p>
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-zinc-600 transition-colors group-hover:text-white"
                strokeWidth={2}
                aria-hidden="true"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
