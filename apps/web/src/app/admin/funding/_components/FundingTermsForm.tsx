// ════════════════════════════════════════════════════════════════════════════
//  _components/FundingTermsForm.tsx — authorised contract-specific override
//
//  Rewrites the basis-point split for ONE job through
//  setFundingTerms() → nx_admin_set_funding_terms.
//
//  THIS FORM MOVES NO MONEY. It changes what the client is contracted to pay
//  and when. It cannot settle a tranche and it cannot pay an Inspector; those
//  are separate, manual, Admin-initiated actions elsewhere.
//
//  ── VALIDATION ─────────────────────────────────────────────────────────────
//  isValidFundingSplit() from the frozen contract decides, here and again in
//  the server action, and the database re-checks the same rule a third time.
//  The rule is not restated in this file — only its verdict is rendered.
//
//  ── ACCESSIBILITY ──────────────────────────────────────────────────────────
//  Native controls throughout, so keyboard and screen-reader behaviour is the
//  platform's rather than something reimplemented here: a real <fieldset>/
//  <legend>, a visible <label> bound to every input, aria-describedby onto
//  help text and the live error, aria-invalid while the split is illegal, and
//  a role="alert" region that announces validation as it changes. The submit
//  button is disabled while the split is illegal, but the server never trusts
//  that — it revalidates.
//
//  ADMIN-ONLY: it renders the client price to preview tranche amounts. It is
//  deliberately NOT given the inspector payout or the platform spread, which
//  it has no use for.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState, useEffect, useId, useMemo, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertTriangle, CheckCircle2, RotateCcw, ShieldAlert } from 'lucide-react';

import { formatCents } from '@nexpec/shared-core';
import {
  BPS_TOTAL,
  DEFAULT_FINAL_BPS,
  DEFAULT_INITIAL_BPS,
  isValidFundingSplit,
  trancheAmountCents,
  type FundingStageView,
} from '@nexpec/shared-core/domain';

import { cn } from '@/lib/cn';
import {
  assessRewriteRisk,
  DEFAULT_SPLIT_SUMMARY,
  formatBps,
} from '../_lib/schedule';
import {
  setFundingTermsInitialState,
  submitFundingTerms,
  type SetFundingTermsState,
} from '../_actions/setFundingTerms';

interface FundingTermsFormProps {
  jobId: string;
  /** Admin-only. Used solely to preview tranche amounts in client money. */
  clientPriceCents: number;
  stages: readonly FundingStageView[];
}

function bpsFrom(
  stages: readonly FundingStageView[],
  code: string,
  fallback: number,
): number {
  const found = stages.find((s) => s.code === code);
  return found ? found.pctBps : fallback;
}

export function FundingTermsForm({
  jobId,
  clientPriceCents,
  stages,
}: FundingTermsFormProps) {
  const uid = useId();
  const ids = {
    initial: `${uid}-initial`,
    final: `${uid}-final`,
    retention: `${uid}-retention`,
    retentionToggle: `${uid}-retention-toggle`,
    help: `${uid}-help`,
    status: `${uid}-status`,
    confirm: `${uid}-confirm`,
  };

  const existingRetention = stages.find((s) => s.code === 'retention');

  const [initialBps, setInitialBps] = useState(
    String(bpsFrom(stages, 'initial', DEFAULT_INITIAL_BPS)),
  );
  const [finalBps, setFinalBps] = useState(
    String(bpsFrom(stages, 'final', DEFAULT_FINAL_BPS)),
  );
  const [includeRetention, setIncludeRetention] = useState(!!existingRetention);
  const [retentionBps, setRetentionBps] = useState(
    String(existingRetention?.pctBps ?? 0),
  );
  const [confirmed, setConfirmed] = useState(false);

  const [state, formAction] = useActionState<SetFundingTermsState, FormData>(
    submitFundingTerms,
    setFundingTermsInitialState,
  );

  const risk = useMemo(() => assessRewriteRisk(stages), [stages]);

  // Once the operator has been told a confirmation is needed, keep the block
  // visible for the rest of the session on this job.
  const mustConfirm = risk.requiresConfirmation || state.needsConfirmation;

  useEffect(() => {
    if (state.ok) setConfirmed(false);
  }, [state.ok]);

  /* ── live, contract-owned validation ──────────────────────────────────── */

  const parsed = useMemo(() => {
    const parse = (raw: string): number | null =>
      /^\d{1,5}$/.test(raw.trim()) && Number(raw) <= BPS_TOTAL
        ? Number(raw)
        : null;

    const i = parse(initialBps);
    const f = parse(finalBps);
    const r = includeRetention ? parse(retentionBps) : null;

    const malformed =
      i === null || f === null || (includeRetention && r === null);

    const list: number[] = malformed
      ? []
      : r !== null
        ? [i as number, f as number, r]
        : [i as number, f as number];

    return { i, f, r, malformed, list };
  }, [initialBps, finalBps, retentionBps, includeRetention]);

  const splitValid = !parsed.malformed && isValidFundingSplit(parsed.list);
  const total = parsed.list.reduce((a, b) => a + b, 0);
  const delta = total - BPS_TOTAL;

  const isDefaultNow =
    !includeRetention &&
    parsed.i === DEFAULT_INITIAL_BPS &&
    parsed.f === DEFAULT_FINAL_BPS;

  const validationMessage = parsed.malformed
    ? `Every tranche needs a whole number of basis points between 0 and ${BPS_TOTAL}.`
    : splitValid
      ? `Totals ${formatBps(total)}. ${
          isDefaultNow
            ? 'This is the platform default.'
            : `Contract-specific — the platform default is ${DEFAULT_SPLIT_SUMMARY}.`
        }`
      : `Totals ${formatBps(total)} — ${formatBps(Math.abs(delta))} ${
          delta > 0 ? 'over' : 'under'
        } 100.00%. A split must total exactly ${BPS_TOTAL} basis points.`;

  const submitBlocked = !splitValid || (mustConfirm && !confirmed);

  function resetToDefault() {
    setInitialBps(String(DEFAULT_INITIAL_BPS));
    setFinalBps(String(DEFAULT_FINAL_BPS));
    setIncludeRetention(false);
    setRetentionBps('0');
  }

  /* ── render ───────────────────────────────────────────────────────────── */

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="jobId" value={jobId} />

      <fieldset className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/50 to-ink-900/20 p-6">
        <legend className="px-2 font-display text-base font-semibold text-white">
          Contract-specific funding terms
        </legend>

        <p id={ids.help} className="mt-1 max-w-2xl text-sm leading-relaxed text-zinc-400">
          Basis points, not percent: <span className="font-mono text-zinc-300">2000</span>{' '}
          is 20.00%. The tranches must total exactly{' '}
          <span className="font-mono text-cyan-glow">{BPS_TOTAL}</span>. Saving
          replaces this job&rsquo;s entire schedule; it never settles a tranche
          and never pays the inspector.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <BpsField
            id={ids.initial}
            name="bpsInitial"
            label="Initial tranche"
            hint="Gates dispatch — nothing is assigned until this is in."
            value={initialBps}
            onChange={setInitialBps}
            invalid={!splitValid}
            describedBy={`${ids.help} ${ids.status}`}
            clientPriceCents={clientPriceCents}
          />
          <BpsField
            id={ids.final}
            name="bpsFinal"
            label="Final tranche"
            hint="Gates final signed delivery to the client."
            value={finalBps}
            onChange={setFinalBps}
            invalid={!splitValid}
            describedBy={`${ids.help} ${ids.status}`}
            clientPriceCents={clientPriceCents}
          />
        </div>

        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <label
            htmlFor={ids.retentionToggle}
            className="flex cursor-pointer items-start gap-3"
          >
            <input
              id={ids.retentionToggle}
              name="includeRetention"
              type="checkbox"
              checked={includeRetention}
              onChange={(e) => setIncludeRetention(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.05] text-violet accent-violet focus:outline-none focus:ring-2 focus:ring-violet/50"
            />
            <span>
              <span className="block text-sm font-medium text-zinc-200">
                Add a retention tranche
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-500">
                Retention is excluded from the delivery gate
                (<span className="font-mono">code &lt;&gt; &apos;retention&apos;</span>), so an
                outstanding retention tranche does not block final delivery.
              </span>
            </span>
          </label>

          {includeRetention && (
            <div className="mt-4 sm:max-w-xs">
              <BpsField
                id={ids.retention}
                name="bpsRetention"
                label="Retention tranche"
                hint="Held back deliberately. Not a delivery gate."
                value={retentionBps}
                onChange={setRetentionBps}
                invalid={!splitValid}
                describedBy={`${ids.help} ${ids.status}`}
                clientPriceCents={clientPriceCents}
              />
            </div>
          )}
        </div>

        {/* Live validation. role=status keeps announcements polite while the
            operator is still typing; the visual tone carries the same signal. */}
        <p
          id={ids.status}
          role="status"
          aria-live="polite"
          className={cn(
            'mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed',
            splitValid
              ? isDefaultNow
                ? 'border-white/10 bg-white/[0.03] text-zinc-300'
                : 'border-violet/30 bg-violet/10 text-violet-glow'
              : 'border-accent-red/40 bg-accent-red/10 text-accent-red',
          )}
        >
          {!splitValid && (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          )}
          <span>{validationMessage}</span>
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={resetToDefault}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:text-white focus:outline-none focus:ring-2 focus:ring-violet/50"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Reset to platform default ({DEFAULT_SPLIT_SUMMARY})
          </button>
        </div>
      </fieldset>

      {/* Confirmation gate — required whenever any tranche is not `scheduled`. */}
      {mustConfirm && (
        <div className="rounded-2xl border border-amber-400/40 bg-amber-400/[0.07] p-5">
          <p className="flex items-center gap-2 font-display text-sm font-semibold text-amber-200">
            <ShieldAlert className="h-4 w-4" aria-hidden />
            This job already has settled or waived tranches
          </p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-amber-100/80">
            {state.confirmationDetail ??
              (risk.serverWillRefuse
                ? 'A funded or refunded tranche exists. nx_admin_set_funding_terms will refuse this rewrite (FUNDING_ALREADY_IN_FLIGHT) — a schedule the client has already paid against cannot be rewritten underneath them.'
                : 'Rewriting deletes and re-creates every stage row on this job. A waived tranche is not protected by the server’s in-flight check, so this confirmation is the only thing standing between you and overwriting it.')}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {risk.affected.map((s) => (
              <li
                key={`${s.code}-${s.trancheNo}`}
                className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-industrial text-amber-200"
              >
                {s.code} · {s.status}
              </li>
            ))}
          </ul>

          <label
            htmlFor={ids.confirm}
            className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-400/30 bg-ink-950/40 p-3"
          >
            <input
              id={ids.confirm}
              name="confirmRewrite"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400/40 bg-white/[0.05] accent-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/50"
            />
            <span className="text-xs font-medium leading-relaxed text-amber-100">
              I have authority to change the contracted terms on this job, and I
              understand every existing stage row will be deleted and re-created.
            </span>
          </label>
        </div>
      )}

      {state.splitError && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="leading-relaxed">{state.splitError}</span>
        </p>
      )}

      {state.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="leading-relaxed">{state.error}</span>
        </p>
      )}

      {state.ok && state.applied && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-cyan-glow/40 bg-cyan-glow/10 px-3 py-2.5 text-sm text-cyan-glow"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="leading-relaxed">
            Terms updated. {state.applied.stages} tranches at{' '}
            <span className="font-mono">{state.applied.summary}</span>. No money
            moved — settlement stays a separate, manual action.
          </span>
        </p>
      )}

      <SubmitButton blocked={submitBlocked} />
    </form>
  );
}

/* ───────────────────────────────────────────────────────────────────────── */

interface BpsFieldProps {
  id: string;
  name: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  describedBy: string;
  clientPriceCents: number;
}

function BpsField({
  id,
  name,
  label,
  hint,
  value,
  onChange,
  invalid,
  describedBy,
  clientPriceCents,
}: BpsFieldProps) {
  const numeric = /^\d{1,5}$/.test(value.trim()) ? Number(value) : null;
  const preview =
    numeric !== null && numeric <= BPS_TOTAL
      ? trancheAmountCents(clientPriceCents, numeric)
      : null;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400"
      >
        {label}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          min={0}
          max={BPS_TOTAL}
          step={1}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full rounded-xl border bg-white/[0.03] px-4 py-2.5 font-mono text-sm text-white transition-all focus:bg-white/[0.05] focus:outline-none focus:ring-2',
            invalid
              ? 'border-accent-red/50 focus:border-accent-red focus:ring-accent-red/30'
              : 'border-white/10 focus:border-cyan-glow/60 focus:ring-cyan-glow/30',
          )}
        />
        <span className="shrink-0 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          bps
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{hint}</p>
      <p className="mt-1 font-mono text-[11px] text-zinc-400">
        {numeric !== null && numeric <= BPS_TOTAL ? formatBps(numeric) : '—'}
        {preview !== null && (
          <>
            {' · '}
            <span className="text-cyan-glow">{formatCents(preview)}</span>
          </>
        )}
      </p>
    </div>
  );
}

function SubmitButton({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  const disabled = blocked || pending;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={disabled}
        className="btn-primary justify-center disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Applying terms…' : 'Apply funding terms'}
      </button>
      <p className="text-[11px] text-zinc-500">
        Writes <span className="font-mono text-zinc-400">job_funding_stages</span>{' '}
        only, via{' '}
        <span className="font-mono text-zinc-400">nx_admin_set_funding_terms</span>.
      </p>
    </div>
  );
}
