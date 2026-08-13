'use client';

// ════════════════════════════════════════════════════════════════════════════
//  EmployerTalentPanel — the hiring pipeline, with the veil intact.
//
//  Every candidate row renders from talent_submission_employer_view, so a
//  candidate who has not consented simply HAS no name in the data reaching
//  this component. The anonymity is not a CSS decision or a conditional render
//  — there is nothing to hide, because nothing was sent.
//
//  There is deliberately no "reveal" control. Only the candidate can disclose,
//  from their own surface. This screen states that plainly so an employer
//  understands the pipeline rather than hunting for a button that cannot exist.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState, useTransition } from 'react';
import type {
  EmployerInterview,
  EmployerOffer,
  EmployerOpportunity,
  EmployerSubmission,
} from './page';
import {
  extendOffer,
  recordInterviewOutcome,
  scheduleInterview,
  setSubmissionStatus,
  withdrawOffer,
} from './actions';

const money = (c: number | null | undefined) =>
  c == null ? '—' : (c / 100).toLocaleString();

const TONE: Record<string, string> = {
  submitted: 'border-white/10 bg-white/5 text-zinc-300',
  shortlisted: 'border-cyan-400/30 bg-cyan-400/10 text-cyan-200',
  interviewing: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  offered: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  placed: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  rejected: 'border-red-400/30 bg-red-400/10 text-red-200',
  withdrawn: 'border-white/10 bg-white/5 text-zinc-400',
};

function Pill({ v }: { v: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        TONE[v] ?? 'border-white/10 bg-white/5 text-zinc-300'
      }`}
    >
      {v.replace(/_/g, ' ')}
    </span>
  );
}

export function EmployerTalentPanel({
  opportunities,
  submissions,
  interviews,
  offers,
}: {
  opportunities: EmployerOpportunity[];
  submissions: EmployerSubmission[];
  interviews: EmployerInterview[];
  offers: EmployerOffer[];
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(
    opportunities[0]?.id ?? null,
  );
  const [offerDraft, setOfferDraft] = useState<Record<string, string>>({});

  const rows = useMemo(
    () => submissions.filter((s) => s.opportunity_id === selected),
    [submissions, selected],
  );
  const ivBySub = useMemo(() => {
    const m = new Map<string, EmployerInterview[]>();
    for (const i of interviews) {
      const a = m.get(i.submission_id) ?? [];
      a.push(i);
      m.set(i.submission_id, a);
    }
    return m;
  }, [interviews]);
  const offerBySub = useMemo(() => {
    const m = new Map<string, EmployerOffer>();
    for (const o of offers) if (o.status !== 'withdrawn') m.set(o.submission_id, o);
    return m;
  }, [offers]);

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
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">
          NEXPEC sources and submits candidates for your open roles. Candidates
          are <strong className="text-zinc-200">anonymous until they choose to
          share their details with you</strong>, for one role at a time — you
          will see their experience and domains immediately, and their name only
          if they consent.
        </p>
      </header>

      {notice && (
        <div role="alert" className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {opportunities.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-8 text-center">
          <p className="text-sm text-zinc-300">No open roles yet.</p>
          <p className="mt-1 text-xs text-zinc-500">
            Talk to NEXPEC to open a permanent role; matched candidates appear
            here once they are submitted.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <section aria-label="Open roles" className="space-y-2">
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
                  <span className="text-sm font-medium text-white">{o.title}</span>
                  <Pill v={o.status} />
                </div>
                <div className="mt-1 text-xs text-zinc-400">
                  {o.region ?? 'Any region'} · {money(o.comp_min_cents)}–
                  {money(o.comp_max_cents)}
                </div>
              </button>
            ))}
          </section>

          <section aria-label="Candidates">
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-6 text-sm text-zinc-400">
                No candidates submitted for this role yet.
              </div>
            ) : (
              <ul className="space-y-2">
                {rows.map((s) => {
                  const ivs = ivBySub.get(s.submission_id) ?? [];
                  const offer = offerBySub.get(s.submission_id);
                  return (
                    <li
                      key={s.submission_id}
                      className="rounded-xl border border-white/[0.06] bg-ink-900/40 p-4"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-white">
                          {/* If undisclosed, the name simply is not in the data. */}
                          {s.identity_disclosed && s.candidate_name
                            ? s.candidate_name
                            : 'Candidate (anonymous)'}
                        </span>
                        <Pill v={s.status} />
                        {s.match_score != null && (
                          <span className="text-[11px] text-zinc-500">
                            match {s.match_score}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 text-xs text-zinc-400">
                        {s.headline ?? 'No headline'} ·{' '}
                        {s.years_experience != null
                          ? `${s.years_experience} yrs`
                          : 'experience not stated'}{' '}
                        · {s.region ?? 'region not stated'}
                      </div>

                      {s.identity_disclosed && s.candidate_email && (
                        <div className="mt-1 text-xs text-emerald-300">
                          {s.candidate_email}
                        </div>
                      )}
                      {!s.identity_disclosed && (
                        <p className="mt-1 text-[11px] text-zinc-500">
                          This candidate has not shared their contact details for
                          this role. Only they can choose to.
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
                        {(['shortlisted', 'interviewing', 'rejected'] as const).map(
                          (st) => (
                            <button
                              key={st}
                              disabled={pending || s.status === st}
                              onClick={() =>
                                run(
                                  () => setSubmissionStatus(s.submission_id, st),
                                  `Candidate moved to ${st}.`,
                                )
                              }
                              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white disabled:opacity-30"
                            >
                              {st}
                            </button>
                          ),
                        )}

                        <button
                          disabled={pending}
                          onClick={() =>
                            run(
                              () =>
                                scheduleInterview(
                                  s.submission_id,
                                  new Date(Date.now() + 86400000).toISOString(),
                                  'video',
                                ),
                              'Interview scheduled for tomorrow — adjust from the interview list.',
                            )
                          }
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white disabled:opacity-30"
                        >
                          schedule interview
                        </button>
                      </div>

                      {ivs.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {ivs.map((i) => (
                            <li
                              key={i.id}
                              className="flex flex-wrap items-center gap-2 text-xs text-zinc-400"
                            >
                              <span>
                                {new Date(i.scheduled_at).toLocaleString()} · {i.mode}
                              </span>
                              {i.outcome ? (
                                <Pill v={i.outcome} />
                              ) : (
                                (['advance', 'reject', 'no_show'] as const).map((o) => (
                                  <button
                                    key={o}
                                    disabled={pending}
                                    onClick={() =>
                                      run(
                                        () => recordInterviewOutcome(i.id, o),
                                        'Interview outcome recorded.',
                                      )
                                    }
                                    className="rounded border border-white/10 bg-white/5 px-2 py-0.5 disabled:opacity-30"
                                  >
                                    {o}
                                  </button>
                                ))
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
                        {offer ? (
                          <>
                            <Pill v={offer.status} />
                            <span className="text-xs text-zinc-400">
                              offer {money(offer.comp_cents)}
                            </span>
                            {offer.status === 'extended' && (
                              <button
                                disabled={pending}
                                onClick={() =>
                                  run(
                                    () => withdrawOffer(offer.id),
                                    'Offer withdrawn.',
                                  )
                                }
                                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-white disabled:opacity-30"
                              >
                                withdraw offer
                              </button>
                            )}
                          </>
                        ) : (
                          <>
                            <label
                              htmlFor={`offer-${s.submission_id}`}
                              className="text-xs text-zinc-400"
                            >
                              Offer amount
                            </label>
                            <input
                              id={`offer-${s.submission_id}`}
                              inputMode="numeric"
                              value={offerDraft[s.submission_id] ?? ''}
                              onChange={(e) =>
                                setOfferDraft((d) => ({
                                  ...d,
                                  [s.submission_id]: e.target.value,
                                }))
                              }
                              className="w-32 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                            />
                            <button
                              disabled={
                                pending || !(offerDraft[s.submission_id] ?? '').trim()
                              }
                              onClick={() =>
                                run(
                                  () =>
                                    extendOffer(
                                      s.submission_id,
                                      Number(offerDraft[s.submission_id]) * 100,
                                      null,
                                    ),
                                  'Offer extended. NEXPEC records the placement once it is accepted.',
                                )
                              }
                              className="rounded-lg bg-violet-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-30"
                            >
                              extend offer
                            </button>
                          </>
                        )}
                      </div>
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
