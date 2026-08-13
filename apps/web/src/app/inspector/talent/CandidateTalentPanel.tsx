'use client';

// ════════════════════════════════════════════════════════════════════════════
//  CandidateTalentPanel — opt-in, consent, and the identity veil.
//
//  The disclosure control is the point of this screen. It is the ONLY place in
//  the product where nx_talent_disclose_identity can be called, because the
//  server gates it on auth.uid() = the submission's profile_id. Admin has no
//  such control by design, and the employer surface has none either.
//
//  Consent is presented as reversible everywhere it appears, because it is:
//  every grant here has a matching withdraw, and disclosure can be taken back
//  per submission while it is still open.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useTransition } from 'react';
import type { CandidateProfile, CandidateSubmission } from './page';
import {
  discloseIdentity,
  grantConsent,
  revokeConsent,
  revokeDisclosure,
  saveCandidateProfile,
} from './actions';

const money = (c: number | null) => (c == null ? '' : String(c / 100));

export function CandidateTalentPanel({
  profile,
  discoverable,
  submissionConsent,
  submissions,
}: {
  profile: CandidateProfile | null;
  discoverable: boolean;
  submissionConsent: boolean;
  submissions: CandidateSubmission[];
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [openToWork, setOpenToWork] = useState(profile?.is_open_to_work ?? false);
  const [headline, setHeadline] = useState(profile?.headline ?? '');
  const [years, setYears] = useState(
    profile?.years_experience != null ? String(profile.years_experience) : '',
  );
  const [region, setRegion] = useState(profile?.region ?? '');
  const [minComp, setMinComp] = useState(money(profile?.desired_min_cents ?? null));
  const [maxComp, setMaxComp] = useState(money(profile?.desired_max_cents ?? null));
  const [notice_, setNoticeDays] = useState(
    profile?.notice_period_days != null ? String(profile.notice_period_days) : '',
  );

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) setNotice(ok);
      else setError(r.error ?? 'That did not work.');
    });
  }

  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  return (
    <main className="p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Permanent roles</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">
          NEXPEC can put you forward for permanent positions. Employers see your
          experience and domains — <strong className="text-zinc-200">never your
          name or contact details</strong> — until you choose to share them, for
          one role at a time. You can withdraw at any point.
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

      {/* ── Consent ────────────────────────────────────────────────────── */}
      <section
        aria-labelledby="consent-h"
        className="mb-6 rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
      >
        <h2 id="consent-h" className="text-sm font-semibold text-white">
          Your consent
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Both are reversible, and neither shares your identity — that is a
          separate choice you make per role.
        </p>

        <div className="mt-4 space-y-3">
          {(
            [
              ['discoverable', discoverable, 'Be discoverable for matching'],
              ['submission', submissionConsent, 'Allow NEXPEC to submit me to employers'],
            ] as const
          ).map(([scope, on, label]) => (
            <div key={scope} className="flex items-center justify-between gap-4">
              <span className="text-sm text-zinc-300">{label}</span>
              <button
                disabled={pending}
                onClick={() =>
                  run(
                    () => (on ? revokeConsent(scope) : grantConsent(scope)),
                    on ? 'Consent withdrawn.' : 'Consent recorded.',
                  )
                }
                aria-pressed={on}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  on
                    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                    : 'border-white/10 bg-white/5 text-zinc-300'
                } disabled:opacity-40`}
              >
                {on ? 'Granted — withdraw' : 'Not granted — allow'}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Preferences ────────────────────────────────────────────────── */}
      <section
        aria-labelledby="prefs-h"
        className="mb-6 rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
      >
        <h2 id="prefs-h" className="text-sm font-semibold text-white">
          Your preferences
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-zinc-400">
            Headline
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Region
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Years of experience
            <input
              inputMode="numeric"
              value={years}
              onChange={(e) => setYears(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Notice period (days)
            <input
              inputMode="numeric"
              value={notice_}
              onChange={(e) => setNoticeDays(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Desired minimum
            <input
              inputMode="numeric"
              value={minComp}
              onChange={(e) => setMinComp(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Desired maximum
            <input
              inputMode="numeric"
              value={maxComp}
              onChange={(e) => setMaxComp(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={openToWork}
              onChange={(e) => setOpenToWork(e.target.checked)}
            />
            Open to permanent work
          </label>
          <button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  saveCandidateProfile({
                    isOpenToWork: openToWork,
                    headline: headline.trim() || null,
                    yearsExperience: num(years),
                    region: region.trim() || null,
                    desiredMinCents:
                      num(minComp) == null ? null : Number(num(minComp)) * 100,
                    desiredMaxCents:
                      num(maxComp) == null ? null : Number(num(maxComp)) * 100,
                    noticePeriodDays: num(notice_),
                  }),
                'Preferences saved.',
              )
            }
            className="ml-auto rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      {/* ── Submissions + THE VEIL ─────────────────────────────────────── */}
      <section aria-labelledby="subs-h">
        <h2 id="subs-h" className="mb-3 text-sm font-semibold text-white">
          Roles you have been put forward for
        </h2>

        {submissions.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-6 text-sm text-zinc-400">
            You have not been submitted for any roles yet. Granting the two
            consents above lets NEXPEC match you.
          </div>
        ) : (
          <ul className="space-y-2">
            {submissions.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-white/[0.06] bg-ink-900/40 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {s.opportunity_title ?? 'Opportunity'}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">
                    {s.status.replace(/_/g, ' ')}
                  </span>
                  {s.match_score != null && (
                    <span className="text-[11px] text-zinc-500">
                      match {s.match_score}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3">
                  <span
                    className={`text-xs ${
                      s.disclosed ? 'text-amber-300' : 'text-emerald-300'
                    }`}
                  >
                    {s.disclosed
                      ? 'This employer can see your name and email'
                      : 'You are anonymous to this employer'}
                  </span>
                  <button
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          s.disclosed
                            ? revokeDisclosure(s.id)
                            : discloseIdentity(s.id),
                        s.disclosed
                          ? 'Your details are hidden again for this role.'
                          : 'Your details are now shared with this employer, for this role only.',
                      )
                    }
                    className="ml-auto rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {s.disclosed ? 'Hide my details again' : 'Share my details'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
