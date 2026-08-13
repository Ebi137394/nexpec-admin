'use client';

// ════════════════════════════════════════════════════════════════════════════
//  TalentConsole — the operator surface for NEXPEC Talent.
//
//  Shows the brokered-identity state explicitly. An operator should be able to
//  SEE that a candidate is still anonymous to the employer rather than having
//  to remember the rule, and there is deliberately no control here to lift it:
//  only the candidate can, and the server enforces that.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState, useTransition } from 'react';
import type {
  OpportunityRow,
  PlacementRow,
  SubmissionRow,
} from './page';
import { recordPlacement, setFeeStatus, submitCandidate } from './actions';

const money = (cents: number | null | undefined) =>
  cents == null ? '—' : `${(cents / 100).toLocaleString()}`;

const TONE: Record<string, string> = {
  open: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  draft: 'text-zinc-300 border-white/10 bg-white/5',
  filled: 'text-violet-300 border-violet-400/30 bg-violet-400/10',
  on_hold: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  cancelled: 'text-red-300 border-red-400/30 bg-red-400/10',
  accrued: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  invoiced: 'text-cyan-300 border-cyan-400/30 bg-cyan-400/10',
  settled: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  waived: 'text-zinc-300 border-white/10 bg-white/5',
  clawed_back: 'text-red-300 border-red-400/30 bg-red-400/10',
};

function Pill({ value }: { value: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        TONE[value] ?? 'text-zinc-300 border-white/10 bg-white/5'
      }`}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}

export function TalentConsole({
  opportunities,
  submissions,
  placements,
  disclosedSubmissionIds,
}: {
  opportunities: OpportunityRow[];
  submissions: SubmissionRow[];
  placements: PlacementRow[];
  disclosedSubmissionIds: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(
    opportunities[0]?.id ?? null,
  );
  const [candidateId, setCandidateId] = useState('');

  const disclosed = useMemo(
    () => new Set(disclosedSubmissionIds),
    [disclosedSubmissionIds],
  );

  const subsForSelected = useMemo(
    () => submissions.filter((s) => s.opportunity_id === selected),
    [submissions, selected],
  );

  const placementBySubmission = useMemo(() => {
    const m = new Map<string, PlacementRow>();
    for (const p of placements) m.set(p.submission_id, p);
    return m;
  }, [placements]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) setNotice(ok);
      else setError(r.error ?? 'That did not work.');
    });
  }

  return (
    <main className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Talent</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Permanent placement. Submissions are brokered by NEXPEC — an employer
          cannot submit to itself, and a candidate stays anonymous until they
          personally consent to disclosure.
        </p>
      </header>

      {notice && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200"
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {opportunities.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-8 text-center">
          <p className="text-sm text-zinc-300">No opportunities yet.</p>
          <p className="mt-1 text-xs text-zinc-500">
            An employer organisation creates one, then NEXPEC brokers matched
            candidates onto it.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          {/* Opportunities */}
          <section aria-label="Opportunities" className="space-y-2">
            {opportunities.map((o) => (
              <button
                key={o.id}
                onClick={() => setSelected(o.id)}
                aria-current={selected === o.id}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  selected === o.id
                    ? 'border-violet-400/40 bg-violet-400/10'
                    : 'border-white/[0.06] bg-ink-900/40 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">
                    {o.title}
                  </span>
                  <Pill value={o.status} />
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {o.region ?? 'Any region'} · comp {money(o.comp_min_cents)}–
                  {money(o.comp_max_cents)}
                </div>
                {/* Admin sees the fee; an employer surface must never render it
                    to a candidate, and a candidate surface never receives it. */}
                <div className="mt-0.5 text-[11px] text-zinc-500">
                  placement fee {(o.placement_fee_bps / 100).toFixed(1)}%
                </div>
              </button>
            ))}
          </section>

          {/* Submissions for the selected opportunity */}
          <section aria-label="Submissions" className="space-y-4">
            <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-4">
              <h2 className="text-sm font-semibold text-white">
                Broker a candidate
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Requires a live submission consent from the candidate. The
                server refuses without one.
              </p>
              <div className="mt-3 flex gap-2">
                <label htmlFor="candidate" className="sr-only">
                  Candidate profile id
                </label>
                <input
                  id="candidate"
                  value={candidateId}
                  onChange={(e) => setCandidateId(e.target.value)}
                  placeholder="Candidate profile id"
                  className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                />
                <button
                  disabled={pending || !selected || candidateId.trim() === ''}
                  onClick={() =>
                    run(
                      () => submitCandidate(selected!, candidateId.trim()),
                      'Candidate submitted. They have been notified that their profile is anonymous until they consent to disclosure.',
                    )
                  }
                  className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {pending ? 'Working…' : 'Submit'}
                </button>
              </div>
            </div>

            {subsForSelected.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-6 text-sm text-zinc-400">
                No submissions on this opportunity yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {subsForSelected.map((s) => {
                  const p = placementBySubmission.get(s.id);
                  const isDisclosed = disclosed.has(s.id);
                  return (
                    <li
                      key={s.id}
                      className="rounded-xl border border-white/[0.06] bg-ink-900/40 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill value={s.status} />
                        <span className="text-xs text-zinc-400">
                          match {s.match_score ?? '—'}
                        </span>
                        {/* The veil, made visible. */}
                        <span
                          className={`text-[11px] ${
                            isDisclosed ? 'text-amber-300' : 'text-emerald-300'
                          }`}
                        >
                          {isDisclosed
                            ? 'identity disclosed by candidate'
                            : 'anonymous to employer'}
                        </span>
                      </div>

                      {p ? (
                        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3">
                          <Pill value={p.fee_status} />
                          <span className="text-xs text-zinc-400">
                            comp {money(p.comp_cents)} · fee {money(p.fee_cents)}{' '}
                            ({(p.fee_bps / 100).toFixed(1)}%)
                          </span>
                          <select
                            aria-label="Fee status"
                            defaultValue={p.fee_status}
                            disabled={pending}
                            onChange={(e) =>
                              run(
                                () =>
                                  setFeeStatus(
                                    p.id,
                                    e.target.value as 'settled',
                                  ),
                                'Fee status updated. This records an Admin decision — no money moved.',
                              )
                            }
                            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                          >
                            {['accrued', 'invoiced', 'settled', 'waived', 'clawed_back'].map(
                              (v) => (
                                <option key={v} value={v}>
                                  {v.replace(/_/g, ' ')}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                      ) : (
                        s.status === 'offered' && (
                          <p className="mt-2 text-[11px] text-zinc-500">
                            Record a placement once the offer is accepted — the
                            server refuses while it is merely extended.
                          </p>
                        )
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
