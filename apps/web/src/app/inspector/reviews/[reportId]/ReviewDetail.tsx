// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/reviews/[reportId]/ReviewDetail.tsx
//
//  One report under senior review: the report body and its evidence, the
//  decision, and the immutable history of rounds.
//
//  Three guarantees this file keeps structurally, not by convention:
//
//    NO DELIVERY CONTROL — deliverReportToClient is not imported here or in
//    any sibling module. Delivery to the Client is Admin-only, so the symbol
//    is absent from this surface entirely; there is no disabled button to
//    enable and no branch that could reveal one.
//
//    NO SELF-REVIEW — the decision UI lives in <DecisionPanel />, which builds
//    its controls inside `if (canDecide(...))`. The author of a report can
//    never hold a live round on it (trg_report_senior_reviews_no_self), so
//    canDecide() is false for them and no control is constructed.
//
//    NO MONEY — no funding import, no payment control, no amount anywhere on
//    this screen. The reads name their columns and none of them is a price,
//    payout or spread.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  AlertTriangle,
  FileText,
  ImageOff,
  Loader2,
  Lock,
} from 'lucide-react';
import { fetchReviewRounds } from '@nexpec/shared-core/net';
import {
  latestRound,
  liveRound,
  type SeniorReviewRound,
} from '@nexpec/shared-core/domain';
import {
  currentUserId,
  errorMessage,
  fetchJobTitles,
  fetchReportUnderReview,
  formatTimestamp,
  mintEvidenceUrls,
  type EvidenceItem,
  type ReportUnderReview,
} from '../reviewClient';
import { ReviewRoundList, RoundStatePill, roundState } from '../ReviewRoundList';
import { DecisionPanel } from '../DecisionPanel';

export function ReviewDetail({ reportId }: { reportId: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [rounds, setRounds] = useState<SeniorReviewRound[]>([]);
  const [report, setReport] = useState<ReportUnderReview | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [jobTitle, setJobTitle] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setFailure(null);
    try {
      const uid = await currentUserId();
      setUserId(uid);
      if (!uid) {
        setFailure('You must be signed in to review reports.');
        setStatus('error');
        return;
      }

      // The contract's reader. RLS scopes it to the rounds this reviewer is
      // party to, so an unassigned account sees an empty history and, through
      // canDecide(), no decision controls.
      const list = await fetchReviewRounds(reportId);
      setRounds(list);

      const body = await fetchReportUnderReview(reportId);
      setReport(body);
      setEvidence(body ? await mintEvidenceUrls(body.doc) : []);

      const jobId = body?.jobId ?? '';
      if (jobId) {
        const titles = await fetchJobTitles([jobId]);
        setJobTitle(titles.get(jobId) ?? null);
      } else {
        setJobTitle(null);
      }

      setStatus('ready');
    } catch (e) {
      setFailure(errorMessage(e, 'Could not load this review.'));
      setStatus('error');
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = liveRound(rounds) ?? latestRound(rounds);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/inspector/reviews"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:text-violet-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          Back to assigned reviews
        </Link>
      </div>

      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Senior Inspector, Quality review
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {jobTitle ?? `Report ${reportId.slice(0, 8)}`}
          </h1>
          {shown && <RoundStatePill state={roundState(shown)} />}
        </div>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Read the report and its evidence, then approve it or return it with
          comments. Your decision is a quality gate only: it transfers no funds,
          and the finished report is delivered to the Client by Admin, not from
          this screen.
        </p>
      </header>

      {status === 'loading' && (
        <div
          role="status"
          className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-ink-900/40 px-5 py-8 text-sm text-zinc-400"
        >
          <Loader2
            className="h-4 w-4 animate-spin text-violet-glow"
            strokeWidth={2}
            aria-hidden="true"
          />
          Loading this review…
        </div>
      )}

      {status === 'error' && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-2xl border border-accent-red/30 bg-accent-red/[0.07] px-5 py-6"
        >
          <p className="flex items-start gap-2 text-sm text-accent-red">
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0"
              strokeWidth={2}
              aria-hidden="true"
            />
            {failure ?? 'Could not load this review.'}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="btn-secondary px-5 py-2 text-xs"
          >
            Try again
          </button>
        </div>
      )}

      {status === 'ready' && (
        <>
          <ReportPanel report={report} evidence={evidence} />

          <DecisionPanel
            reportId={reportId}
            rounds={rounds}
            actingUserId={userId}
            onDecided={() => void load()}
          />

          <section aria-labelledby="review-history-heading" className="space-y-3">
            <header>
              <h2
                id="review-history-heading"
                className="font-display text-lg font-semibold tracking-tight text-white"
              >
                Decision history
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                Every round on your account for this report, oldest first. A
                decided round is permanent — the database refuses to rewrite or
                delete one, and nothing on this page can edit it.
              </p>
            </header>
            <ReviewRoundList rounds={rounds} headingId="review-history-heading" />
          </section>
        </>
      )}
    </div>
  );
}

/* ─── the report under review ─────────────────────────────────────────── */

function ReportPanel({
  report,
  evidence,
}: {
  report: ReportUnderReview | null;
  evidence: EvidenceItem[];
}) {
  if (!report) {
    return (
      <section
        aria-labelledby="report-body-heading"
        className="rounded-2xl border border-white/[0.08] bg-ink-900/40 p-5"
      >
        <h2
          id="report-body-heading"
          className="flex items-center gap-2 font-display text-lg font-semibold text-white"
        >
          <Lock className="h-4 w-4 text-zinc-500" strokeWidth={2} aria-hidden="true" />
          Report body not released to your account
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Your review assignment is valid — it is listed below — but the report
          record itself is not readable with your current access. Nothing is
          shown here rather than a partial or reconstructed version. Ask Admin
          to release the report to your reviewer account, then reload this page.
        </p>
      </section>
    );
  }

  const doc = report.doc;

  return (
    <section
      aria-labelledby="report-body-heading"
      className="space-y-4 rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="report-body-heading"
          className="flex items-center gap-2 font-display text-lg font-semibold text-white"
        >
          <FileText
            className="h-4 w-4 text-violet-glow"
            strokeWidth={2}
            aria-hidden="true"
          />
          Report under review
        </h2>
        {doc?.result && (
          <span className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-300">
            Result, {doc.result}
          </span>
        )}
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-zinc-500">Report status</dt>
          <dd className="text-zinc-300">{report.status ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-zinc-500">Submitted</dt>
          <dd className="text-zinc-300">{formatTimestamp(report.createdAt)}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-zinc-500">Last updated</dt>
          <dd className="text-zinc-300">{formatTimestamp(report.updatedAt)}</dd>
        </div>
      </dl>

      <div>
        <h3 className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Summary
        </h3>
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-200">
          {doc?.summary || report.notes || 'No written summary was submitted.'}
        </p>
      </div>

      {doc?.attestation?.inspectorName && (
        <p className="text-xs text-zinc-500">
          Attested by {doc.attestation.inspectorName} on{' '}
          {formatTimestamp(doc.attestation.attestedAt ?? null)}.
        </p>
      )}

      <EvidenceGallery evidence={evidence} />
    </section>
  );
}

function EvidenceGallery({ evidence }: { evidence: EvidenceItem[] }) {
  if (evidence.length === 0) {
    return (
      <div>
        <h3 className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Evidence
        </h3>
        <p className="mt-1.5 text-sm text-zinc-500">
          No photo evidence is attached to this report.
        </p>
      </div>
    );
  }

  const withheld = evidence.filter((e) => e.url == null).length;

  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        Evidence, {evidence.length}
      </h3>
      {withheld > 0 && (
        <p className="mt-1.5 text-xs text-accent-amber">
          {withheld} of {evidence.length} evidence files were not released to
          your account. Review what is shown, or ask Admin to grant access
          before deciding.
        </p>
      )}
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {evidence.map((item) => (
          <li
            key={item.path}
            className="overflow-hidden rounded-xl border border-white/[0.06] bg-ink-950/50"
          >
            {item.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.url}
                alt={item.caption ?? 'Inspection evidence photo'}
                className="aspect-square w-full object-cover"
              />
            ) : (
              <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 px-2 text-center">
                <ImageOff
                  className="h-5 w-5 text-zinc-600"
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                <span className="text-[10px] leading-tight text-zinc-500">
                  Not released to your account
                </span>
              </div>
            )}
            {item.caption && (
              <p className="px-2.5 py-2 text-[11px] text-zinc-400">
                {item.caption}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
