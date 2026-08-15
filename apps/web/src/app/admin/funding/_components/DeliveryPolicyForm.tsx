// ════════════════════════════════════════════════════════════════════════════
//  _components/DeliveryPolicyForm.tsx — Strict Prepay vs Approved Credit Release
//
//  Chooses whether the FINAL 80% must be settled before the report is
//  delivered, or becomes a Net-15/30/60 invoice due after delivery. The 20/80
//  split itself is NOT editable here — FundingTermsForm owns that, and the
//  20% initial tranche is never releasable because it gates DISPATCH.
//
//  THIS FORM MOVES NO MONEY. Releasing records an obligation; it never settles
//  a tranche and never pays an Inspector. Manual settlement lives on
//  /admin/payouts and is not duplicated here.
//
//  ── AUTHORITY ──────────────────────────────────────────────────────────────
//  The database re-reads the caller's role from profiles inside
//  nx_admin_release_job_on_credit, so this form is convenience, not security.
//  It is rendered only under /admin, and a non-admin who posted the form
//  anyway is refused server-side with 42501.
//
//  ── ACCESSIBILITY ──────────────────────────────────────────────────────────
//  Native controls throughout: a real <fieldset>/<legend> for the mode radios,
//  a visible <label> on every input, aria-describedby onto help text and the
//  live error, and a role="alert" confirmation region so the two-step
//  authorisation is announced rather than only shown.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState, useId, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { NET_TERM_DAYS, type DeliveryPolicyMode } from '@nexpec/shared-core/domain';

import {
  deliveryPolicyInitialState,
  releaseOnCreditAction,
  setClientDeliveryPolicyAction,
  type DeliveryPolicyState,
} from '../_actions/releaseOnCredit';

function SubmitButton({ label, confirm }: { label: string; confirm: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={[
        'rounded-lg px-4 py-2 text-sm font-semibold transition',
        confirm
          ? 'bg-amber-500 text-black hover:bg-amber-400'
          : 'bg-white/10 text-white hover:bg-white/15',
        pending ? 'cursor-wait opacity-60' : '',
      ].join(' ')}
    >
      {pending ? 'Working…' : confirm ? `Confirm — ${label}` : label}
    </button>
  );
}

function Feedback({ state }: { state: DeliveryPolicyState }) {
  if (state.error) {
    return (
      <p role="alert" className="mt-2 text-sm text-rose-300">
        {state.error}
      </p>
    );
  }
  if (state.needsConfirmation && state.confirmationDetail) {
    return (
      <div
        role="alert"
        className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100"
      >
        <p className="font-semibold">Confirm this authorisation</p>
        <p className="mt-1 text-amber-100/80">{state.confirmationDetail}</p>
      </div>
    );
  }
  if (state.ok && state.applied) {
    return (
      <p role="status" className="mt-2 text-sm text-emerald-300">
        {state.applied.summary}
      </p>
    );
  }
  return null;
}

// ── per-JOB override ────────────────────────────────────────────────────────
export function JobCreditReleaseForm({
  jobId,
  currentlyGating,
  netTermDays,
}: {
  jobId: string;
  /** job_funding_stages.gates_delivery for the final tranche. */
  currentlyGating: boolean;
  netTermDays: number | null;
}) {
  const [state, formAction] = useActionState<DeliveryPolicyState, FormData>(
    releaseOnCreditAction,
    deliveryPolicyInitialState,
  );
  const reasonId = useId();
  const termId = useId();

  if (!currentlyGating) {
    return (
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
        <p className="text-sm font-semibold text-emerald-200">
          Released on approved credit terms
        </p>
        <p className="mt-1 text-sm text-emerald-100/70">
          The final balance is invoiced on Net-{netTermDays ?? '—'} and no longer blocks
          delivery. An overdue invoice will not revoke the report.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="rounded-xl border border-white/[0.06] p-4">
      <input type="hidden" name="jobId" value={jobId} />
      {/* Second pass re-posts with confirmed=true; the action gates on it. */}
      <input
        type="hidden"
        name="confirmed"
        value={state.needsConfirmation ? 'true' : 'false'}
      />

      <h3 className="font-display text-base font-semibold text-white">
        Release this job on approved credit
      </h3>
      <p className="mt-1 text-sm text-zinc-400">
        Delivers the final report while the remaining 80% is unpaid. The 20% initial
        funding is still required before dispatch and is not affected.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={termId} className="block text-sm font-medium text-zinc-300">
            Net term
          </label>
          <select
            id={termId}
            name="netTermDays"
            defaultValue={30}
            className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white"
          >
            {NET_TERM_DAYS.map((d) => (
              <option key={d} value={d}>
                Net-{d} — due {d} days after delivery
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor={reasonId} className="block text-sm font-medium text-zinc-300">
          Reason <span className="text-rose-300">*</span>
        </label>
        <textarea
          id={reasonId}
          name="reason"
          required
          rows={2}
          aria-describedby={`${reasonId}-help`}
          className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white"
          placeholder="e.g. Approved enterprise buyer, PO 4512 on file"
        />
        <p id={`${reasonId}-help`} className="mt-1 text-xs text-zinc-500">
          Written to the audit trail with your identity, the previous terms and the new
          terms. Required by the database, not just this form.
        </p>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <SubmitButton label="Release on credit" confirm={state.needsConfirmation} />
        <a href="/admin/payouts" className="text-xs text-zinc-500 underline">
          Inspector settlement is separate and manual
        </a>
      </div>

      <Feedback state={state} />
    </form>
  );
}

// ── CLIENT-level default ────────────────────────────────────────────────────
export function ClientDeliveryPolicyForm({
  clientId,
  currentMode,
  currentNetTermDays,
}: {
  clientId: string;
  currentMode: DeliveryPolicyMode;
  currentNetTermDays: number | null;
}) {
  const [state, formAction] = useActionState<DeliveryPolicyState, FormData>(
    setClientDeliveryPolicyAction,
    deliveryPolicyInitialState,
  );
  const [mode, setMode] = useState<DeliveryPolicyMode>(currentMode);
  const reasonId = useId();

  return (
    <form action={formAction} className="rounded-xl border border-white/[0.06] p-4">
      <input type="hidden" name="clientId" value={clientId} />
      <input
        type="hidden"
        name="confirmed"
        value={state.needsConfirmation ? 'true' : 'false'}
      />

      <fieldset>
        <legend className="font-display text-base font-semibold text-white">
          Default delivery policy for this client
        </legend>
        <p className="mt-1 text-sm text-zinc-400">
          Applies to future jobs. Jobs already released on credit keep their existing
          terms.
        </p>

        <div className="mt-3 space-y-2">
          <label className="flex items-start gap-3 text-sm text-zinc-200">
            <input
              type="radio"
              name="mode"
              value="STRICT_PREPAY"
              checked={mode === 'STRICT_PREPAY'}
              onChange={() => setMode('STRICT_PREPAY')}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Strict Prepay</span>
              <span className="block text-zinc-400">
                Remaining 80% required before final report delivery.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-zinc-200">
            <input
              type="radio"
              name="mode"
              value="CREDIT_RELEASE"
              checked={mode === 'CREDIT_RELEASE'}
              onChange={() => setMode('CREDIT_RELEASE')}
              className="mt-1"
            />
            <span>
              <span className="font-medium">Approved Credit Release</span>
              <span className="block text-zinc-400">
                Report may be released with the 80% invoiced on Net terms.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {/*  Rendered only for CREDIT_RELEASE: the database CHECK rejects a term
          on STRICT_PREPAY, so offering one would build an unsubmittable form. */}
      {mode === 'CREDIT_RELEASE' && (
        <div className="mt-4">
          <label
            htmlFor={`${reasonId}-term`}
            className="block text-sm font-medium text-zinc-300"
          >
            Net term
          </label>
          <select
            id={`${reasonId}-term`}
            name="netTermDays"
            defaultValue={currentNetTermDays ?? 30}
            className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white sm:w-64"
          >
            {NET_TERM_DAYS.map((d) => (
              <option key={d} value={d}>
                Net-{d}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4">
        <label htmlFor={reasonId} className="block text-sm font-medium text-zinc-300">
          Reason <span className="text-rose-300">*</span>
        </label>
        <textarea
          id={reasonId}
          name="reason"
          required
          rows={2}
          className="mt-1 w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm text-white"
          placeholder="e.g. Signed MSA with Net-30 payment terms"
        />
      </div>

      <div className="mt-4">
        <SubmitButton label="Save default policy" confirm={state.needsConfirmation} />
      </div>

      <Feedback state={state} />
    </form>
  );
}
