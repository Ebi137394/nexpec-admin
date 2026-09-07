'use client';

import { useState } from 'react';
import { acceptEngagement } from '@/lib/actions/partnerEngagements';

type Row = Record<string, unknown>;

function money(cents: unknown, currency = 'USD'): string {
  const n = typeof cents === 'string' ? Number(cents) : (cents as number);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n / 100);
}

export function EngagementAcceptance({
  customerRows,
  inspectorRows,
  obligations,
}: {
  customerRows: Row[];
  inspectorRows: Row[];
  obligations: Row[];
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function accept(id: string) {
    setNotice(null);
    setError(null);
    const fd = new FormData();
    fd.set('commercialId', id);
    const r = await acceptEngagement(fd);
    if (r.ok) setNotice(r.message ?? 'Accepted.');
    else setError(r.error ?? 'Could not accept.');
  }

  function Block({
    row,
    label,
    amountKey,
    hint,
  }: {
    row: Row;
    label: string;
    amountKey: string;
    hint: string;
  }) {
    const basis = String(row.pricing_basis ?? 'fixed_engagement');
    const perUnit = basis !== 'fixed_engagement';
    return (
      <section className="rounded-3xl border border-white/[0.08] bg-white/[0.01] p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-xs text-zinc-500">
            engagement {String(row.job_id).slice(0, 8)}
          </p>
          <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
            {String(row.status)}
          </span>
        </div>
        <p className="mt-4 text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="mt-1 font-display text-2xl text-zinc-100">
          {money(row[amountKey], String(row.currency ?? 'USD'))}
          {perUnit ? ` per ${basis.replace('per_', '')}` : ''}
        </p>
        {perUnit && row.scope_units ? (
          <p className="mt-1 text-[11px] text-amber-300/80">
            Agreed scope: {String(row.scope_units)} {basis.replace('per_', '')}s.
          </p>
        ) : null}
        {row.scope_note ? (
          <p className="mt-2 text-sm text-zinc-300">{String(row.scope_note)}</p>
        ) : null}
        <p className="mt-2 text-[11px] text-zinc-500">
          v{String(row.version)} · terms {String(row.terms_version)} · {hint}
        </p>
        {String(row.status) === 'presented' && (
          <button
            onClick={() => accept(String(row.id))}
            className="mt-4 rounded-full border border-emerald-500/40 px-4 py-1.5 text-xs text-emerald-300"
          >
            Accept these terms
          </button>
        )}
        {String(row.status) === 'accepted' && (
          <p className="mt-4 text-xs text-emerald-300">
            Accepted{row.accepted_at ? ` ${String(row.accepted_at).slice(0, 19)}` : ''}.
          </p>
        )}
      </section>
    );
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

      {customerRows.map((r) => (
        <Block
          key={`c-${String(r.id)}`}
          row={r}
          label="What you pay NEXPEC"
          amountKey="customer_amount_cents"
          hint={
            r.has_partner
              ? 'A NEXPEC partner agency is supplying the inspector for this engagement.'
              : 'Direct engagement.'
          }
        />
      ))}

      {inspectorRows.map((r) => {
        const ob = obligations.find((o) => String(o.job_id) === String(r.job_id));
        return (
          <div key={`i-${String(r.id)}`}>
            <Block
              row={r}
              label="Your payout"
              amountKey="inspector_payout_cents"
              hint="This is your own payout. It is not the customer's price."
            />
            {ob && (
              <p className="mt-2 px-6 text-xs text-zinc-400">
                Payout {money(ob.amount_cents, String(ob.currency))} ·{' '}
                <span className="uppercase tracking-wide">{String(ob.status)}</span>. NEXPEC settles
                by bank transfer outside the platform.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
