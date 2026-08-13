// ════════════════════════════════════════════════════════════════════════════
//  app/admin/funding/page.tsx — staged-funding roster
//
//  The route entry the Lane E agent never reached: _lib, _components and
//  _actions were all written and typecheck clean, but nothing rendered them,
//  so the whole surface was unreachable.
//
//  ── WHAT THIS IS FOR ───────────────────────────────────────────────────────
//  One place to see where every job stands against its funding schedule, and
//  to reach the per-job screen that can rewrite terms. It reuses the existing
//  admin shell and adds no second admin application.
//
//  ── ADMIN SEES BOTH SIDES; NOBODY ELSE IMPORTS THESE TYPES ─────────────────
//  FundingRosterEntry carries client price AND inspector payout, so it is
//  admin-only by construction (fundingAdmin.types.ts). Everything that renders
//  it lives under app/admin/funding/_components, which no other surface
//  imports. jobs_secure_view NULLs the payout columns for any non-admin
//  caller, so a non-admin reaching this route sees masked money, not a leak.
//
//  ── NO AUTOMATIC SETTLEMENT ────────────────────────────────────────────────
//  Nothing here pays anyone. Funding state records that the CLIENT paid;
//  inspector settlement and payout stay manual and live on /admin/payouts.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, CircleDollarSign, TriangleAlert } from 'lucide-react';

import {
  isDeliveryFundingSatisfied,
  isInitialFundingSatisfied,
  outstandingTranches,
  formatCents,
} from '@nexpec/shared-core/domain';

import { fetchFundingRoster } from './_lib/fundingAdmin';

export const metadata: Metadata = {
  title: 'Staged funding · NEXPEC Admin',
};

export const dynamic = 'force-dynamic';

export default async function AdminFundingPage() {
  const { entries, unavailable } = await fetchFundingRoster();

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Admin, Commercial
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Staged funding
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Where each job stands against its funding schedule. The initial
          tranche authorises dispatch; the remainder is required before the
          final signed report reaches the client. Funding a tranche never pays
          an inspector — settlement stays manual on{' '}
          <Link href="/admin/payouts" className="text-cyan-glow hover:underline">
            Payouts
          </Link>
          .
        </p>
      </header>

      {unavailable ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-accent-amber/30 bg-accent-amber/[0.06] px-4 py-4"
        >
          <TriangleAlert
            className="mt-0.5 h-4 w-4 shrink-0 text-accent-amber"
            strokeWidth={2}
          />
          <div>
            <p className="text-sm font-medium text-white">
              The funding roster could not be read.
            </p>
            <p className="mt-0.5 text-sm text-zinc-400">
              This is a read failure, not evidence that no jobs need funding.
              Nothing has been changed.
            </p>
          </div>
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
          <p className="font-display text-base font-semibold text-white">
            No priced jobs to fund.
          </p>
          <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-500">
            Jobs appear here once they carry a client price.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map(({ job, funding }) => {
            const outstanding = outstandingTranches(funding.stages);
            const authorised = isInitialFundingSatisfied(
              funding.stages,
              job.legacyClientSettledAt,
            );
            const deliverable = isDeliveryFundingSatisfied(
              funding.stages,
              job.legacyClientSettledAt,
            );
            const legacy = funding.stages.length === 0;

            return (
              <li key={job.id}>
                <Link
                  href={`/admin/funding/${job.id}`}
                  className="group flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.01] px-4 py-3.5 transition-colors hover:border-white/[0.12] hover:bg-white/[0.03]"
                >
                  <CircleDollarSign
                    className="h-4 w-4 shrink-0 text-cyan-glow"
                    strokeWidth={2}
                    aria-hidden="true"
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {job.title ?? 'Untitled job'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {job.clientName ?? 'Unknown client'} ·{' '}
                      {job.paymentMode ?? 'prepay'} ·{' '}
                      {legacy
                        ? 'legacy funding (no schedule)'
                        : `${outstanding.length} of ${funding.stages.length} tranche(s) outstanding`}
                    </p>
                  </div>

                  <div className="hidden shrink-0 text-right sm:block">
                    <p className="font-mono text-sm text-white">
                      {formatCents(funding.clientPriceCents)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      client price
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusChip
                      ok={authorised}
                      okLabel="Dispatch authorised"
                      pendingLabel="Awaiting initial"
                    />
                    <StatusChip
                      ok={deliverable}
                      okLabel="Delivery unblocked"
                      pendingLabel="Awaiting remainder"
                    />
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
      )}
    </div>
  );
}

function StatusChip({
  ok,
  okLabel,
  pendingLabel,
}: {
  ok: boolean;
  okLabel: string;
  pendingLabel: string;
}) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        ok
          ? 'border-accent-green/40 bg-accent-green/10 text-accent-green'
          : 'border-white/15 bg-white/[0.04] text-zinc-400'
      }`}
    >
      {ok ? okLabel : pendingLabel}
    </span>
  );
}
