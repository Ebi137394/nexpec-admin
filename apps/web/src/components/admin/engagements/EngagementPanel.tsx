// ════════════════════════════════════════════════════════════════════════════
//  EngagementPanel — Admin's view of one engagement's commercials.
//
//  The residual is displayed, never stored: storing it would let it drift from
//  the three amounts it is derived from. It is computed on the SAME pricing
//  basis as its inputs, which is why a per-unit basis requires scope units —
//  a day rate and a fixed total cannot be subtracted from one another.
// ════════════════════════════════════════════════════════════════════════════
'use client';

import { useState } from 'react';
import {
  priceEngagement,
  presentEngagement,
  confirmEngagement,
  setPartnerPolicy,
  invitePartner,
  settleObligation,
} from '@/lib/actions/partnerEngagements';

type Row = Record<string, unknown>;

function money(cents: unknown, currency = 'USD'): string {
  const n = typeof cents === 'string' ? Number(cents) : (cents as number);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n / 100);
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/[0.08] bg-white/[0.01] p-6">
      <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-zinc-300">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function EngagementPanel(props: {
  jobId: string;
  job: Row;
  policy: Row | null;
  versions: Row[];
  live: Row | null;
  acceptances: Row[];
  obligations: Row[];
  opportunities: Row[];
  nominations: Row[];
  approvedPartners: Row[];
}) {
  const {
    jobId, policy, versions, live, acceptances, obligations,
    opportunities, nominations, approvedPartners,
  } = props;

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The draft's settlement model. Switching it changes WHICH amount fields
  // exist, not merely which are visible: the hidden ones are not submitted and
  // the action zeroes them anyway, so a stale value cannot smuggle in an
  // obligation the model forbids.
  const [model, setModel] = useState<'split' | 'agency_total'>(
    (live?.settlement_model as 'split' | 'agency_total') ?? 'split',
  );

  async function run(fn: (fd: FormData) => Promise<{ ok: boolean; error?: string; message?: string }>, fd: FormData) {
    setNotice(null);
    setError(null);
    const r = await fn(fd);
    if (r.ok) setNotice(r.message ?? 'Done.');
    else setError(r.error ?? 'Failed.');
  }

  const currency = (live?.currency as string) ?? 'USD';
  const cust = Number(live?.customer_amount_cents ?? 0);
  const insp = Number(live?.inspector_payout_cents ?? 0);
  const part = Number(live?.partner_commission_cents ?? 0);
  const agencyTotal = Number(live?.agency_total_cents ?? 0);
  const liveModel = (live?.settlement_model as string) ?? 'split';
  const isLiveB = liveModel === 'agency_total';
  // NEXPEC's cost is the sum of what NEXPEC actually owes under THIS model.
  // In Model B the inspector's compensation is Agency B's cost, not NEXPEC's,
  // so adding it here would double-count the same work.
  const nexpecCost = isLiveB ? agencyTotal : insp + part;
  const residual = cust - nexpecCost;
  const isB = model === 'agency_total';
  const basis = (live?.pricing_basis as string) ?? 'fixed_engagement';
  const perUnit = basis !== 'fixed_engagement';

  const consented = Boolean(policy?.customer_consented);
  const approved = Boolean(policy?.admin_approved);

  return (
    <div className="space-y-6">
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

      <Card title="Partner participation">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className={consented ? 'text-emerald-300' : 'text-zinc-400'}>
            Customer consent: {consented ? 'given' : 'not given'}
          </span>
          <span className="text-zinc-600">·</span>
          <span className={approved ? 'text-emerald-300' : 'text-zinc-400'}>
            Admin approval: {approved ? 'approved' : 'not approved'}
          </span>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Both are required before any partner can see this job. Consent belongs to the
          customer; approval belongs to NEXPEC. Neither implies the other.
        </p>
        <form
          className="mt-3"
          action={async (fd) => {
            fd.set('jobId', jobId);
            fd.set('approve', approved ? 'false' : 'true');
            await run(setPartnerPolicy, fd);
          }}
        >
          <button
            type="submit"
            disabled={!consented && !approved}
            className="rounded-full border border-violet/40 px-4 py-1.5 text-xs text-violet disabled:opacity-40"
          >
            {approved ? 'Withdraw partner distribution' : 'Approve partner distribution'}
          </button>
          {!consented && !approved && (
            <span className="ml-3 text-xs text-zinc-500">
              The customer has not consented yet.
            </span>
          )}
        </form>
      </Card>

      <Card title="Invited partners">
        {opportunities.length === 0 ? (
          <p className="text-xs text-zinc-400">No partner has been invited to this job.</p>
        ) : (
          <ul className="space-y-1 text-sm text-zinc-200">
            {opportunities.map((o) => (
              <li key={String(o.id)} className="font-mono text-xs">
                {String(o.partner_id)} · {String(o.status)}
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-3 flex flex-wrap gap-2"
          action={async (fd) => {
            fd.set('jobId', jobId);
            await run(invitePartner, fd);
          }}
        >
          <select
            name="partnerId"
            required
            className="rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-zinc-200"
          >
            <option value="">Select an approved partner…</option>
            {approvedPartners.map((p) => (
              <option key={String(p.partner_id)} value={String(p.partner_id)}>
                {String(p.display_name ?? p.partner_id)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!consented || !approved}
            className="rounded-full border border-violet/40 px-4 py-1.5 text-xs text-violet disabled:opacity-40"
          >
            Invite to this engagement
          </button>
        </form>
      </Card>

      <Card title="Nominations">
        {nominations.length === 0 ? (
          <p className="text-xs text-zinc-400">
            No inspector nominated. A partner must name a specific person.
          </p>
        ) : (
          <ul className="space-y-2">
            {nominations.map((n) => (
              <li key={String(n.id)} className="rounded-xl border border-white/[0.06] p-3 text-xs">
                <p className="text-zinc-200">
                  Inspector <span className="font-mono">{String(n.inspector_id)}</span> ·{' '}
                  {String(n.status)}
                </p>
                <p className="mt-1 text-zinc-500">by partner {String(n.partner_id)}</p>
                {n.proposed_note ? (
                  <p className="mt-1 text-zinc-400">{String(n.proposed_note)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">
          A nomination is not a credential check and not the inspector&apos;s consent. Job
          qualification rules remain authoritative.
        </p>
      </Card>

      <Card title="Commercial terms">
        {live ? (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Amount label="Customer pays" value={money(cust, currency)} />
            {isLiveB ? (
              <>
                <Amount label="NEXPEC pays Agency B" value={money(agencyTotal, currency)} />
                <Amount
                  label="Agency pays inspector"
                  value={
                    live.inspector_agency_comp_cents == null
                      ? 'Not disclosed'
                      : money(live.inspector_agency_comp_cents, currency)
                  }
                />
              </>
            ) : (
              <>
                <Amount label="Inspector payout" value={money(insp, currency)} />
                <Amount label="Partner commission" value={money(part, currency)} />
              </>
            )}
            <Amount
              label="NEXPEC residual"
              value={money(residual, currency)}
              tone={residual < 0 ? 'bad' : 'good'}
            />
            <p className="col-span-2 sm:col-span-4 rounded-xl border border-violet/25 bg-violet/5 px-3 py-2 text-xs text-zinc-200">
              {isLiveB ? (
                <>
                  NEXPEC will pay <strong>Agency B {money(agencyTotal, currency)}</strong>. Agency B
                  is responsible for paying the inspector. NEXPEC will not create a separate
                  inspector payable, and paying Agency B is not evidence the inspector has been paid.
                </>
              ) : (
                <>
                  NEXPEC will pay the <strong>inspector {money(insp, currency)}</strong> and{' '}
                  <strong>Agency B {money(part, currency)}</strong> as its own commission.
                </>
              )}
            </p>
            <div className="col-span-2 sm:col-span-4 text-[11px] text-zinc-500">
              v{String(live.version)} · {String(live.status)} · basis {basis}
              {perUnit ? ` × ${String(live.scope_units ?? '?')} units — amounts are PER UNIT` : ''}
              {live.margin_override_reason
                ? ` · override: ${String(live.margin_override_reason)}`
                : ''}
            </div>
            {perUnit && (
              <p className="col-span-2 sm:col-span-4 text-[11px] text-amber-300/80">
                Amounts above are per {basis.replace('per_', '')}. Engagement totals are
                these figures × {String(live.scope_units ?? '?')}.
              </p>
            )}
          </div>
        ) : (
          <p className="mb-4 text-xs text-zinc-400">No pricing drafted yet.</p>
        )}

        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          action={async (fd) => {
            fd.set('jobId', jobId);
            await run(priceEngagement, fd);
          }}
        >
          <label className="text-[11px] uppercase tracking-wide text-zinc-500 sm:col-span-3">
            Settlement model
            <select
              name="settlementModel"
              value={model}
              onChange={(e) => setModel(e.target.value as 'split' | 'agency_total')}
              className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="split">
                A — Pay the inspector directly, and pay Agency B a commission
              </option>
              <option value="agency_total">
                B — Pay Agency B the full service amount; Agency B pays its inspector
              </option>
            </select>
          </label>
          <Field name="customerAmount" label="Customer amount" placeholder="2000.00" required />
          {isB ? (
            <>
              <Field name="agencyTotal" label="Agency B total service amount" placeholder="1800.00" />
              <Field
                name="inspectorAgencyComp"
                label="Inspector compensation (AGENCY-payable, optional)"
                placeholder="1400.00"
              />
            </>
          ) : (
            <>
              <Field name="inspectorPayout" label="Inspector payout (NEXPEC pays)" placeholder="1500.00" />
              <Field
                name="partnerCommission"
                label="Partner commission (their own fee, NEXPEC pays)"
                placeholder="300.00"
              />
            </>
          )}
          <Field name="inspectorId" label="Inspector (uuid)" />
          <Field name="partnerId" label="Partner agency (uuid)" />
          <Field name="currency" label="Currency" defaultValue={currency} />
          <label className="text-[11px] uppercase tracking-wide text-zinc-500">
            Pricing basis
            <select
              name="pricingBasis"
              defaultValue={basis}
              className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-zinc-100"
            >
              <option value="fixed_engagement">Fixed engagement</option>
              <option value="per_day">Per day</option>
              <option value="per_hour">Per hour</option>
              <option value="per_visit">Per visit</option>
            </select>
          </label>
          <Field name="scopeUnits" label="Scope units (if per-unit)" placeholder="5" />
          <Field name="scopeNote" label="Scope note" />
          <div className="sm:col-span-3">
            <Field
              name="marginOverrideReason"
              label="Override reason (only if the allocation exceeds the customer amount)"
            />
          </div>
          <div className="sm:col-span-3">
            <Field
              name="amendmentReason"
              label="Amendment reason (required only when a version is already accepted)"
            />
          </div>
          {isB && (
            <p className="sm:col-span-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
              Model B creates ONE obligation to Agency B. No NEXPEC inspector payout and no separate
              commission are created. The inspector compensation above, if given, is what Agency B
              told us it pays — it is agency-payable, never a NEXPEC payable, and is shown to the
              inspector as such.
            </p>
          )}
          <div className="sm:col-span-3">
            <button
              type="submit"
              className="rounded-full bg-violet px-5 py-2 text-xs font-medium text-white"
            >
              Save as a new version
            </button>
            <span className="ml-3 text-[11px] text-zinc-500">
              An accepted version is never rewritten — this supersedes it.
            </span>
          </div>
        </form>
      </Card>

      {live && (
        <Card title="Acceptance">
          <ul className="space-y-1 text-xs text-zinc-300">
            {['customer', 'inspector', 'partner'].map((role) => {
              const a = acceptances.find((x) => String(x.party_role) === role);
              const applicable =
                role === 'customer' ||
                (role === 'inspector' && insp > 0) ||
                (role === 'partner' && part > 0);
              if (!applicable) return null;
              return (
                <li key={role}>
                  {role}:{' '}
                  {a ? (
                    <span className="text-emerald-300">
                      accepted {String(a.accepted_at).slice(0, 19)} (terms {String(a.terms_version)})
                    </span>
                  ) : (
                    <span className="text-zinc-500">awaiting</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <form
              action={async (fd) => {
                fd.set('commercialId', String(live.id));
                fd.set('jobId', jobId);
                await run(presentEngagement, fd);
              }}
            >
              <button
                type="submit"
                disabled={String(live.status) !== 'draft'}
                className="rounded-full border border-violet/40 px-4 py-1.5 text-xs text-violet disabled:opacity-40"
              >
                Present to parties
              </button>
            </form>
            <form
              action={async (fd) => {
                fd.set('commercialId', String(live.id));
                fd.set('jobId', jobId);
                await run(confirmEngagement, fd);
              }}
            >
              <button
                type="submit"
                className="rounded-full border border-emerald-500/40 px-4 py-1.5 text-xs text-emerald-300"
              >
                Confirm assignment
              </button>
            </form>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Confirming records separate settlement obligations. It moves no money.
          </p>
        </Card>
      )}

      <Card title="Settlement obligations">
        {obligations.length === 0 ? (
          <p className="text-xs text-zinc-400">None recorded.</p>
        ) : (
          <ul className="space-y-2">
            {obligations.map((o) => (
              <li
                key={String(o.id)}
                className="rounded-xl border border-white/[0.06] p-3 text-xs text-zinc-200"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {String(o.beneficiary_role)} · {money(o.amount_cents, String(o.currency))} ·{' '}
                    <span className="uppercase tracking-wide">{String(o.status)}</span>
                  </span>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    action={async (fd) => {
                      fd.set('obligationId', String(o.id));
                      fd.set('jobId', jobId);
                      await run(settleObligation, fd);
                    }}
                  >
                    <select
                      name="status"
                      className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-[11px]"
                    >
                      <option value="approved">approved</option>
                      <option value="invoiced">invoiced</option>
                      <option value="paid">paid</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                    <input
                      name="reference"
                      placeholder="bank reference"
                      className="w-36 rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-[11px]"
                    />
                    <button type="submit" className="rounded-full border border-white/15 px-3 py-1 text-[11px]">
                      Record
                    </button>
                  </form>
                </div>
                <p className="mt-1 font-mono text-[10px] text-zinc-600">
                  beneficiary {String(o.beneficiary_id)}
                  {o.paid_reference ? ` · ref ${String(o.paid_reference)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-zinc-500">
          Recording &quot;paid&quot; logs an external bank transfer that already happened. NEXPEC
          initiates no transfer here.
        </p>
      </Card>

      {versions.length > 1 && (
        <Card title="Version history">
          <ul className="space-y-1 text-[11px] text-zinc-400">
            {versions.map((v) => (
              <li key={String(v.id)}>
                v{String(v.version)} · {String(v.status)} ·{' '}
                {money(v.customer_amount_cents, String(v.currency))} customer ·{' '}
                {String(v.created_at).slice(0, 19)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Amount({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p
        className={
          'mt-1 font-display text-lg ' +
          (tone === 'bad' ? 'text-rose-300' : tone === 'good' ? 'text-emerald-300' : 'text-zinc-100')
        }
      >
        {value}
      </p>
    </div>
  );
}

function Field({
  name,
  label,
  placeholder,
  required,
  defaultValue,
}: {
  name: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="text-[11px] uppercase tracking-wide text-zinc-500">
      {label}
      <input
        name={name}
        placeholder={placeholder}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-zinc-100"
      />
    </label>
  );
}
