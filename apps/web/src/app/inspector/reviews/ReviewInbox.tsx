// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/reviews/ReviewInbox.tsx — assigned-review inbox
//
//  The reports routed to THIS Senior Inspector for review, bucketed by what
//  they need from them:
//      Awaiting your decision | Decided | Superseded
//
//  Every bucket decision runs through the frozen contract — canDecide(),
//  liveRound(), latestRound(), isLiveRound() via roundState() — never through
//  a local re-reading of the columns. The rows themselves come back from
//  fetchReviewRounds(), so no screen invents its own round shape.
//
//  Carries no money column and no delivery control.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  ClipboardCheck,
  Loader2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { fetchReviewRounds } from '@nexpec/shared-core/net';
import {
  canDecide,
  latestRound,
  liveRound,
  type SeniorReviewRound,
} from '@nexpec/shared-core/domain';
import {
  currentUserId,
  errorMessage,
  fetchAssignedReportRefs,
  fetchJobTitles,
  formatTimestamp,
} from './reviewClient';
import { RoundStatePill, roundState } from './ReviewRoundList';

interface InboxEntry {
  reportId: string;
  jobId: string;
  jobTitle: string | null;
  rounds: SeniorReviewRound[];
  /** True only when the contract says this user may decide the live round. */
  actionable: boolean;
}

type Bucket = 'action' | 'decided' | 'superseded';

const BUCKETS: Array<{ key: Bucket; title: string; subtitle: string }> = [
  {
    key: 'action',
    title: 'Awaiting your decision',
    subtitle:
      'Open rounds assigned to you. Approve, or return with the changes you need.',
  },
  {
    key: 'decided',
    title: 'Decided',
    subtitle: 'Rounds you closed. Final, and never editable.',
  },
  {
    key: 'superseded',
    title: 'Superseded',
    subtitle:
      'Assignments replaced before you decided them. Closed out, not rewritten.',
  },
];

function bucketOf(entry: InboxEntry): Bucket {
  if (entry.actionable) return 'action';
  const latest = latestRound(entry.rounds);
  if (latest && latest.decision != null) return 'decided';
  return 'superseded';
}

export function ReviewInbox() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    else setStatus('loading');
    setFailure(null);

    try {
      const userId = await currentUserId();
      if (!userId) {
        setFailure('You must be signed in to review reports.');
        setStatus('error');
        return;
      }

      const refs = await fetchAssignedReportRefs(userId);

      // fetchReviewRounds() is the contract's per-report reader, so the inbox
      // hydrates each routed report through it rather than re-shaping rows.
      const rounds = await Promise.all(
        refs.map((r) => fetchReviewRounds(r.reportId)),
      );
      const titles = await fetchJobTitles(refs.map((r) => r.jobId));

      setEntries(
        refs.map((ref, i) => {
          const list = rounds[i] ?? [];
          return {
            reportId: ref.reportId,
            jobId: ref.jobId,
            jobTitle: titles.get(ref.jobId) ?? null,
            rounds: list,
            actionable: canDecide(list, userId),
          };
        }),
      );
      setStatus('ready');
    } catch (e) {
      setFailure(errorMessage(e, 'Could not load your review inbox.'));
      setStatus('error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const actionableCount = entries.filter((e) => e.actionable).length;

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Senior Inspector, Quality review
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Assigned reviews
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Reports routed to you for senior review. Your decision is a quality
          gate: it approves the work or sends it back with comments. It moves no
          money, and delivery of the finished report to the Client stays with
          Admin.
        </p>
      </header>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing || status === 'loading'}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:border-white/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-glow focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            strokeWidth={2}
            aria-hidden="true"
          />
          Refresh
        </button>
        <p aria-live="polite" className="text-xs text-zinc-500">
          {status === 'ready'
            ? `${actionableCount} awaiting your decision, ${entries.length} total.`
            : ''}
        </p>
      </div>

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
          Loading your assigned reviews…
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
            {failure ?? 'Could not load your review inbox.'}
          </p>
          <button
            type="button"
            onClick={() => void load(false)}
            className="btn-secondary px-5 py-2 text-xs"
          >
            Try again
          </button>
        </div>
      )}

      {status === 'ready' && entries.length === 0 && (
        <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 px-6 py-16 text-center">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
            <ClipboardCheck
              className="h-5 w-5"
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </div>
          <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
            Nothing routed to you.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-zinc-400">
            Reports appear here when Admin assigns you as their Senior
            Inspector. You will never be assigned a report you authored.
          </p>
        </section>
      )}

      {status === 'ready' &&
        entries.length > 0 &&
        BUCKETS.map((bucket) => {
          const items = entries.filter((e) => bucketOf(e) === bucket.key);
          if (items.length === 0) return null;
          return (
            <section key={bucket.key} className="space-y-3">
              <header>
                <h2 className="font-display text-lg font-semibold tracking-tight text-white">
                  {bucket.title}, {items.length}
                </h2>
                <p className="mt-0.5 text-sm text-zinc-500">
                  {bucket.subtitle}
                </p>
              </header>
              <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {items.map((entry) => (
                  <li key={entry.reportId}>
                    <InboxCard entry={entry} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}

function InboxCard({ entry }: { entry: InboxEntry }) {
  const live = liveRound(entry.rounds);
  const latest = latestRound(entry.rounds);
  const shown = live ?? latest;

  return (
    <article className="flex h-full flex-col rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5">
      <header className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-white">
          {entry.jobTitle ?? `Report ${entry.reportId.slice(0, 8)}`}
        </h3>
        {shown && <RoundStatePill state={roundState(shown)} />}
      </header>

      {!entry.jobTitle && (
        <p className="mt-1 text-xs text-zinc-500">
          Job title not released to your account.
        </p>
      )}

      <dl className="mt-4 grid grid-cols-1 gap-1.5 border-y border-white/[0.04] py-3 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-zinc-500">Round</dt>
          <dd className="text-zinc-300">{shown ? shown.round : '—'}</dd>
        </div>
        <div className="flex justify-between gap-3 sm:block">
          <dt className="text-zinc-500">Assigned</dt>
          <dd className="text-zinc-300">
            {formatTimestamp(shown?.assignedAt ?? null)}
          </dd>
        </div>
      </dl>

      <footer className="mt-auto pt-5">
        <Link
          href={`/inspector/reviews/${entry.reportId}`}
          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ring-1 ring-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 ${
            entry.actionable
              ? 'bg-cyan-glow/15 text-cyan-glow ring-cyan-glow/30 hover:bg-cyan-glow/25'
              : 'bg-white/[0.03] text-zinc-300 ring-white/10 hover:bg-white/[0.06]'
          }`}
        >
          {entry.actionable ? 'Review report' : 'View history'}
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          <span className="sr-only">
            {' '}
            for {entry.jobTitle ?? `report ${entry.reportId.slice(0, 8)}`}
          </span>
        </Link>
      </footer>
    </article>
  );
}
