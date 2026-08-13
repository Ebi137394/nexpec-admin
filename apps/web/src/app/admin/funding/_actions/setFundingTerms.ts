// ════════════════════════════════════════════════════════════════════════════
//  app/admin/funding/_actions/setFundingTerms.ts
//
//  The ONLY write in this route. It rewrites a job's funding SCHEDULE — the
//  basis points the client is contracted to pay, and when. It calls exactly
//  one RPC, through the frozen accessor:
//
//      @nexpec/shared-core/net → setFundingTerms()  →  nx_admin_set_funding_terms
//
//  ── WHAT THIS ACTION MUST NEVER DO ─────────────────────────────────────────
//  It must never settle a tranche, credit a wallet, write an earning, or pay
//  an Inspector. There is no automatic path from a funding event to a payout
//  and this file does not create one: 20260801432000 detached
//  execute_auto_payout and 20260801444000 detached
//  trg_credit_inspector_on_confirm precisely so that no event could pay
//  anybody by itself. Inspector settlement stays an explicit, manual,
//  Admin-initiated action through admin_mark_payout_processed on
//  /admin/payouts — a control this route links to and does not reimplement.
//
//  nx_funding_mark_stage_funded is deliberately absent from the shared
//  accessor (service-role webhook work), so no surface — including this one —
//  can reach for it.
//
//  ── VALIDATION ─────────────────────────────────────────────────────────────
//  The split rule belongs to the contract. isValidFundingSplit() decides;
//  this file only turns its `false` into a sentence a human can act on, and
//  the database re-checks the same 10000 bps rule server-side regardless.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';

import {
  BPS_TOTAL,
  FUNDING_STAGE_CODE,
  isValidFundingSplit,
  type FundingStageCode,
} from '@nexpec/shared-core/domain';
import { setFundingTerms as setFundingTermsRpc } from '@nexpec/shared-core/net';

import { withFundingCore } from '../_lib/core';
import { fetchFundingForRewrite } from '../_lib/fundingAdmin';
import { assessRewriteRisk, formatBps } from '../_lib/schedule';

export interface SetFundingTermsState {
  ok: boolean;
  error: string | null;
  /** Set when the split itself is wrong — rendered against the bps fieldset. */
  splitError: string | null;
  /**
   * True when the job already has non-scheduled stages and the operator has
   * not yet acknowledged the rewrite. The form reveals its confirmation step.
   */
  needsConfirmation: boolean;
  /** Plain-language description of what would be overwritten. */
  confirmationDetail: string | null;
  applied?: {
    jobId: string;
    stages: number;
    summary: string;
  };
}

export const setFundingTermsInitialState: SetFundingTermsState = {
  ok: false,
  error: null,
  splitError: null,
  needsConfirmation: false,
  confirmationDetail: null,
};

/** Strict integer parse. Rejects "20.5", "", "1e3", NaN, negatives. */
function parseBps(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null;
  const s = String(raw).trim();
  if (!/^\d{1,5}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > BPS_TOTAL) return null;
  return n;
}

const STAGE_LABELS: Record<FundingStageCode, string> = {
  [FUNDING_STAGE_CODE.INITIAL]: 'Initial funding (before assignment)',
  [FUNDING_STAGE_CODE.FINAL]: 'Remaining funding (after report review)',
  [FUNDING_STAGE_CODE.RETENTION]: 'Retention (held back, not a delivery gate)',
};

export async function submitFundingTerms(
  _prev: SetFundingTermsState,
  formData: FormData,
): Promise<SetFundingTermsState> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  if (!jobId) {
    return { ...setFundingTermsInitialState, error: 'Missing job id.' };
  }

  /* ── 1. parse the bps fields ────────────────────────────────────────────── */

  const initialBps = parseBps(formData.get('bpsInitial'));
  const finalBps = parseBps(formData.get('bpsFinal'));

  const retentionRaw = String(formData.get('bpsRetention') ?? '').trim();
  const wantsRetention = formData.get('includeRetention') === 'on';
  const retentionBps = wantsRetention ? parseBps(retentionRaw || '0') : null;

  if (initialBps === null || finalBps === null) {
    return {
      ...setFundingTermsInitialState,
      splitError: `Every tranche needs a whole number of basis points between 0 and ${BPS_TOTAL}.`,
    };
  }
  if (wantsRetention && retentionBps === null) {
    return {
      ...setFundingTermsInitialState,
      splitError: `The retention tranche needs a whole number of basis points between 0 and ${BPS_TOTAL}, or untick it.`,
    };
  }

  const bpsList: number[] = [initialBps, finalBps];
  if (retentionBps !== null) bpsList.push(retentionBps);

  /* ── 2. the contract decides whether the split is legal ─────────────────── */

  if (!isValidFundingSplit(bpsList)) {
    const total = bpsList.reduce((a, b) => a + b, 0);
    const delta = total - BPS_TOTAL;
    const direction = delta > 0 ? 'over' : 'under';
    return {
      ...setFundingTermsInitialState,
      splitError:
        `The tranches total ${formatBps(total)} — ${formatBps(Math.abs(delta))} ${direction} 100.00%. ` +
        `A funding split must total exactly ${BPS_TOTAL} basis points; the database rejects anything else.`,
    };
  }

  /* ── 3. re-read the live schedule; never trust the form about money ─────── */

  const live = await fetchFundingForRewrite(jobId);
  if (!live) {
    return {
      ...setFundingTermsInitialState,
      error:
        'Could not read this job’s current funding schedule, so the rewrite was not attempted.',
    };
  }

  const risk = assessRewriteRisk(live.funding.stages);
  const confirmed = formData.get('confirmRewrite') === 'on';

  if (risk.requiresConfirmation && !confirmed) {
    const affected = risk.affected
      .map((s) => `${s.code} (${s.status})`)
      .join(', ');
    return {
      ...setFundingTermsInitialState,
      needsConfirmation: true,
      confirmationDetail: risk.serverWillRefuse
        ? `This job already has settled funding — ${affected}. nx_admin_set_funding_terms will refuse the rewrite (FUNDING_ALREADY_IN_FLIGHT); a schedule the client has paid against cannot be rewritten underneath them.`
        : `This job already has non-scheduled tranches — ${affected}. Rewriting deletes and re-creates every stage row. A waived tranche is NOT protected by the server’s in-flight check, so this confirmation is the only thing standing between you and overwriting it.`,
    };
  }

  /* ── 4. one RPC. Schedule rows only. No money moves. ────────────────────── */
  //
  //  `trigger_basis` is intentionally omitted: FundingStageView does not carry
  //  it, and nx_admin_set_funding_terms applies its own documented defaults
  //  (tranche 1 → before_assignment, the rest → after_report_review). The gate
  //  predicates key on the stage CODE, not the basis, so the server's default
  //  is the correct value rather than something for this surface to invent.

  const stages: ReadonlyArray<{
    code: FundingStageCode;
    pct_bps: number;
    label?: string;
  }> = [
    {
      code: FUNDING_STAGE_CODE.INITIAL,
      pct_bps: initialBps,
      label: STAGE_LABELS[FUNDING_STAGE_CODE.INITIAL],
    },
    {
      code: FUNDING_STAGE_CODE.FINAL,
      pct_bps: finalBps,
      label: STAGE_LABELS[FUNDING_STAGE_CODE.FINAL],
    },
    ...(retentionBps !== null
      ? [
          {
            code: FUNDING_STAGE_CODE.RETENTION,
            pct_bps: retentionBps,
            label: STAGE_LABELS[FUNDING_STAGE_CODE.RETENTION],
          },
        ]
      : []),
  ];

  const { error } = await withFundingCore(() =>
    setFundingTermsRpc(jobId, stages),
  );

  if (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : 'The funding terms RPC failed.';
    return { ...setFundingTermsInitialState, error: message };
  }

  revalidatePath('/admin/funding');
  revalidatePath(`/admin/funding/${jobId}`);

  return {
    ok: true,
    error: null,
    splitError: null,
    needsConfirmation: false,
    confirmationDetail: null,
    applied: {
      jobId,
      stages: stages.length,
      summary: bpsList.map((b) => formatBps(b).replace('%', '')).join(' / '),
    },
  };
}
