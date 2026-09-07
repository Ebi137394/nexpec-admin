'use client';

import { useState } from 'react';
import { nominateInspector, acceptEngagement } from '@/lib/actions/partnerEngagements';

type Row = Record<string, unknown>;

function money(cents: unknown, currency = 'USD'): string {
  const n = typeof cents === 'string' ? Number(cents) : (cents as number);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n / 100);
}

export function PartnerOpportunityList({
  opportunities,
  offers,
  nominations,
  obligations,
}: {
  opportunities: Row[];
  offers: Row[];
  nominations: Row[];
  obligations: Row[];
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(
    fn: (fd: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>,
    fd: FormData,
  ) {
    setNotice(null);
    setError(null);
    const r = await fn(fd);
    if (r.ok) setNotice(r.message ?? 'Done.');
    else setError(r.error ?? 'Failed.');
  }

  if (opportunities.length === 0) {
    return <p className="text-sm text-zinc-400">No open invitations.</p>;
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {opportunities.map((o) => {
        const jobId = String(o.job_id);
        const offer = offers.find((f) => String(f.job_id) === jobId) ?? null;
        const nom = nominations.find((n) => String(n.job_id) === jobId) ?? null;
        const ob = obligations.find((b) => String(b.job_id) === jobId) ?? null;

        return (
          <section
            key={String(o.id)}
            className="rounded-3xl border border-white/[0.08] bg-white/[0.01] p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs text-zinc-500">engagement {jobId.slice(0, 8)}</p>
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                {String(o.status)}
              </span>
            </div>

            {nom ? (
              <p className="mt-3 text-sm text-zinc-300">
                Nominated inspector{' '}
                <span className="font-mono text-xs">{String(nom.inspector_id)}</span> ·{' '}
                {String(nom.status)}
              </p>
            ) : (
              <form
                className="mt-4 space-y-2"
                action={async (fd) => {
                  fd.set('opportunityId', String(o.id));
                  await run(nominateInspector, fd);
                }}
              >
                <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
                  Inspector account id
                  <input
                    name="inspectorId"
                    required
                    placeholder="the inspector's NEXPEC account id"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-zinc-100"
                  />
                </label>
                <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
                  Why this person
                  <input
                    name="note"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-zinc-100"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-full bg-violet px-4 py-1.5 text-xs font-medium text-white"
                >
                  Nominate this inspector
                </button>
                <p className="text-[11px] text-zinc-500">
                  You must name a specific person with their own NEXPEC account. NEXPEC verifies
                  their credentials; nominating does not verify anything and gives you no control
                  over their account.
                </p>
              </form>
            )}

            {offer && (
              <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                  Your commission
                </p>
                <p className="mt-1 font-display text-xl text-zinc-100">
                  {money(offer.partner_commission_cents, String(offer.currency ?? 'USD'))}
                  {String(offer.pricing_basis) !== 'fixed_engagement'
                    ? ` per ${String(offer.pricing_basis).replace('per_', '')}`
                    : ''}
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  v{String(offer.version)} · {String(offer.status)} · terms{' '}
                  {String(offer.terms_version)}
                </p>
                {String(offer.status) === 'presented' && (
                  <form
                    className="mt-3"
                    action={async (fd) => {
                      fd.set('commercialId', String(offer.id));
                      await run(acceptEngagement, fd);
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded-full border border-emerald-500/40 px-4 py-1.5 text-xs text-emerald-300"
                    >
                      Accept these terms
                    </button>
                  </form>
                )}
              </div>
            )}

            {ob && (
              <p className="mt-3 text-xs text-zinc-400">
                Commission {money(ob.amount_cents, String(ob.currency))} ·{' '}
                <span className="uppercase tracking-wide">{String(ob.status)}</span>. NEXPEC settles
                by bank transfer outside the platform.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
