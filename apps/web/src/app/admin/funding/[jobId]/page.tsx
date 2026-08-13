// ════════════════════════════════════════════════════════════════════════════
//  app/admin/funding/[jobId]/page.tsx — per-job funding control
//
//  Renders the two components Lane E wrote but never mounted:
//  FundingScheduleTable (read) and FundingTermsForm (authorised override),
//  plus the funding-relevant audit history fetchFundingRecord already returns.
//
//  ── OVERRIDE IS AUTHORISED, NOT UNLIMITED ──────────────────────────────────
//  The form posts to submitFundingTerms -> nx_admin_set_funding_terms, which
//  refuses any split that does not total 10000 bps and refuses outright to
//  rewrite a schedule the client has already paid against. The UI mirrors
//  those rules for inline feedback; the database is the authority.
//
//  ── NO AUTOMATIC SETTLEMENT ────────────────────────────────────────────────
//  Nothing on this page pays an inspector. Manual settlement lives on
//  /admin/payouts and is reached by link, not duplicated here — there is no
//  second payout path.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, TriangleAlert } from 'lucide-react';

import { fetchFundingRecord } from '../_lib/fundingAdmin';
import { FundingScheduleTable } from '../_components/FundingScheduleTable';
import { FundingTermsForm } from '../_components/FundingTermsForm';

export const metadata: Metadata = {
  title: 'Job funding · NEXPEC Admin',
};

export const dynamic = 'force-dynamic';

export default async function AdminJobFundingPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const record = await fetchFundingRecord(jobId);
  if (!record) notFound();

  const { job, funding, audit, auditUnavailable } = record;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/funding"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          All funding
        </Link>

        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {job.title ?? 'Untitled job'}
        </h1>
        <p className="mt-1.5 text-sm text-zinc-400">
          {job.clientName ?? 'Unknown client'}
          {job.contractorName ? ` · inspector ${job.contractorName}` : ''} ·{' '}
          {job.paymentMode ?? 'prepay'}
        </p>
      </div>

      <section aria-labelledby="schedule-heading">
        <h2
          id="schedule-heading"
          className="mb-4 font-display text-lg font-semibold tracking-tight text-white"
        >
          Funding schedule
        </h2>
        <FundingScheduleTable
          clientPriceCents={funding.clientPriceCents}
          stages={funding.stages}
        />
      </section>

      <section aria-labelledby="terms-heading">
        <h2
          id="terms-heading"
          className="mb-1 font-display text-lg font-semibold tracking-tight text-white"
        >
          Contract-specific terms
        </h2>
        <p className="mb-4 max-w-2xl text-sm text-zinc-500">
          The platform default is 20 / 80. An authorised override applies to
          this job only and must total 100%. Once the client has funded a
          tranche the schedule can no longer be rewritten.
        </p>
        <FundingTermsForm
          jobId={job.id}
          clientPriceCents={funding.clientPriceCents}
          stages={funding.stages}
        />
      </section>

      <section aria-labelledby="audit-heading">
        <h2
          id="audit-heading"
          className="mb-4 font-display text-lg font-semibold tracking-tight text-white"
        >
          Funding audit history
        </h2>

        {auditUnavailable ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-accent-amber/30 bg-accent-amber/[0.06] px-4 py-4"
          >
            <TriangleAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-accent-amber"
              strokeWidth={2}
            />
            <p className="text-sm text-zinc-300">
              The audit read failed. This is not the same as &ldquo;no
              events&rdquo; — do not treat this job as having no funding
              history.
            </p>
          </div>
        ) : audit.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-zinc-500">
            No funding events recorded for this job yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {audit.map((e) => (
              <li
                key={e.id}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.01] px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-white">{e.summary}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {e.actorLabel ?? 'system'}
                      {e.actorRole ? ` (${e.actorRole})` : ''} ·{' '}
                      <span className="font-mono">{e.eventType}</span>
                    </p>
                  </div>
                  <time
                    dateTime={e.createdAt}
                    className="shrink-0 text-xs text-zinc-600"
                  >
                    {new Date(e.createdAt).toLocaleString()}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-zinc-600">
        Inspector settlement and payout are manual and are not performed here.
        Use{' '}
        <Link href="/admin/payouts" className="text-cyan-glow hover:underline">
          Payouts
        </Link>
        .
      </p>
    </div>
  );
}
