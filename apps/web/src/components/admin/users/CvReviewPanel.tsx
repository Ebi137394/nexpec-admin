'use client';

// ════════════════════════════════════════════════════════════════════════════
//  CvReviewPanel — read the inspector's CV, propose values, let the admin
//  choose, then save through the ordinary audited admin-edit action.
//
//  Design rules this component exists to enforce:
//   • Nothing is pre-ticked. Every applied value is an explicit decision.
//   • Each row shows the CURRENT value beside the suggested one and the exact
//     line the suggestion came from, so an admin approves evidence, not a guess.
//   • Certifications appear in a separate read-only block. They can never be
//     applied here and this panel cannot mark anything verified.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useTransition } from 'react';
import { reviewInspectorCv, type CvReviewResult } from '@/lib/actions/cvSuggestions';
import { applyCvSuggestions } from '@/lib/actions/applyCvSuggestions';

type Row = NonNullable<CvReviewResult['suggestions']>[number];

const LABEL: Record<string, string> = {
  professional_title: 'Professional title',
  phone: 'Phone',
  location: 'Location',
  years_of_experience: 'Years of experience',
  ndt_methods: 'NDT methods',
  specialty_slugs: 'Specialties',
};

export function CvReviewPanel({ userId }: { userId: string }) {
  const [result, setResult] = useState<CvReviewResult | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const display = (v: string | string[]) => (Array.isArray(v) ? v.join(', ') : v);

  const run = () =>
    start(async () => {
      setSaved(null);
      setResult(await reviewInspectorCv(userId));
      setPicked({});
    });

  const apply = () =>
    start(async () => {
      const chosen = (result?.suggestions ?? []).filter((s) => picked[s.field]);
      if (!chosen.length) return;
      const r = await applyCvSuggestions(
        userId,
        chosen.map((s) => ({ field: s.field, value: display(s.value) })),
      );
      setSaved(r.ok ? `Saved ${r.applied} field${r.applied === 1 ? '' : 's'}.` : r.error ?? 'Failed.');
      if (r.ok) setResult(await reviewInspectorCv(userId));
    });

  const rows: Row[] = result?.suggestions ?? [];
  const chosenCount = rows.filter((s) => picked[s.field]).length;

  return (
    <div className="rounded-lg border border-zinc-800 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">Read the CV</h3>
          <p className="mt-1 text-[11px] text-zinc-500">
            Extracts text from the CV on file and proposes values. Nothing is saved
            until you tick it and confirm. Certifications are shown as evidence only
            and are never applied or verified here.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="shrink-0 rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
        >
          {pending ? 'Reading…' : 'Review CV'}
        </button>
      </div>

      {saved && <p className="mt-3 text-xs text-emerald-400">{saved}</p>}

      {result && !result.ok && (
        <p className="mt-3 rounded border border-amber-900/60 bg-amber-950/30 p-2 text-xs text-amber-300">
          {result.error}
        </p>
      )}

      {result?.ok && (
        <div className="mt-4 space-y-4">
          <p className="text-[11px] text-zinc-500">
            {result.meta?.fileName} · {result.meta?.pages} page
            {result.meta?.pages === 1 ? '' : 's'}
            {result.meta?.truncated && ' · long CV, only the first part was read'}
          </p>

          {rows.length === 0 ? (
            <p className="text-xs text-zinc-400">
              No fields could be read confidently from this CV. Edit the sections
              above by hand.
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {rows.map((s) => (
                  <li
                    key={s.field}
                    className="rounded border border-zinc-800 bg-zinc-950/40 p-3"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={!!picked[s.field]}
                        onChange={(e) =>
                          setPicked((p) => ({ ...p, [s.field]: e.target.checked }))
                        }
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-zinc-200">
                          {LABEL[s.field] ?? s.field}
                        </span>
                        <span className="mt-1 grid gap-1 sm:grid-cols-2">
                          <span className="block text-[11px] text-zinc-500">
                            Current:{' '}
                            <span className="text-zinc-300">
                              {s.current ?? 'Not provided'}
                            </span>
                          </span>
                          <span className="block text-[11px] text-zinc-500">
                            From CV:{' '}
                            <span className="text-emerald-300">{display(s.value)}</span>
                          </span>
                        </span>
                        <span className="mt-2 block border-l-2 border-zinc-700 pl-2 text-[11px] italic text-zinc-400">
                          line {s.line}: “{s.evidence}”
                        </span>
                        {!s.differs && (
                          <span className="mt-1 block text-[11px] text-zinc-500">
                            Already matches what is on file.
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={apply}
                disabled={pending || chosenCount === 0}
                className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-40"
              >
                {pending
                  ? 'Saving…'
                  : `Apply ${chosenCount} selected field${chosenCount === 1 ? '' : 's'}`}
              </button>
            </>
          )}

          {!!result.claims?.length && (
            <div className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-xs font-medium text-zinc-300">
                Certifications mentioned in this CV
              </p>
              <p className="mt-1 text-[11px] text-amber-400">
                Claims only. These are not applied to the profile and do not verify
                anything — a certificate is verified through credential review.
              </p>
              <ul className="mt-2 space-y-1">
                {result.claims.map((c) => (
                  <li key={c.line} className="text-[11px] text-zinc-400">
                    line {c.line}: {c.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
