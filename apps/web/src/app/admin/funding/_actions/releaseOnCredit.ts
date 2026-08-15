// ════════════════════════════════════════════════════════════════════════════
//  app/admin/funding/_actions/releaseOnCredit.ts
//
//  Two Admin writes for the delivery policy added by 20260801500000:
//    • setClientDeliveryPolicyAction — the CLIENT-level default
//    • releaseOnCreditAction         — the one-time per-JOB override
//
//  Both go through the frozen accessors in @nexpec/shared-core/net, exactly
//  like setFundingTerms does. Neither reimplements authorization: the database
//  functions are SECURITY DEFINER and re-read the caller's role from profiles,
//  so a forged claim fails server-side regardless of what this file believes.
//
//  ── WHAT THESE ACTIONS MUST NEVER DO ───────────────────────────────────────
//  Releasing a job on credit records an OBLIGATION. It does not settle a
//  tranche, credit a wallet, write an earning, or pay an Inspector. There is
//  no automatic path from a delivery-policy change to a payout and this file
//  does not create one — Inspector settlement stays an explicit, manual,
//  Admin-initiated action through admin_mark_payout_processed on
//  /admin/payouts.
//
//  ── THE 20% IS NOT RELEASABLE ──────────────────────────────────────────────
//  releaseOnCreditAction only ever affects the `final` tranche. The database
//  enforces this (nx_admin_release_job_on_credit is restricted to
//  code = 'final'); releasing the initial tranche would dispatch an assignment
//  for free. The UI must never offer it, and this action never asks for it.
//
//  ── REASON IS MANDATORY ────────────────────────────────────────────────────
//  The database rejects an empty reason. It is validated here too so the
//  Admin sees it inline rather than as a raw SQLSTATE, but the server check is
//  the one that counts.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';

import {
  NET_TERM_DAYS,
  releaseJobOnCredit as releaseJobOnCreditRpc,
  setClientDeliveryPolicy as setClientDeliveryPolicyRpc,
  type DeliveryPolicyMode,
  type NetTermDays,
} from '@nexpec/shared-core/net';

import { withFundingCore } from '../_lib/core';

export interface DeliveryPolicyState {
  ok: boolean;
  error: string | null;
  /** Set when the Admin must confirm before the write is attempted. */
  needsConfirmation: boolean;
  confirmationDetail: string | null;
  applied: { scope: 'client' | 'job'; summary: string } | null;
}

export const deliveryPolicyInitialState: DeliveryPolicyState = {
  ok: false,
  error: null,
  needsConfirmation: false,
  confirmationDetail: null,
  applied: null,
};

function isNetTerm(value: number): value is NetTermDays {
  return (NET_TERM_DAYS as readonly number[]).includes(value);
}

function rpcMessage(error: unknown, fallback: string): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: unknown }).message)
    : fallback;
}

/** Human-readable due date for the confirmation copy, computed from today. */
function dueDateFrom(netTermDays: number): string {
  const due = new Date();
  due.setDate(due.getDate() + netTermDays);
  return due.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── per-JOB override ────────────────────────────────────────────────────────
export async function releaseOnCreditAction(
  _prev: DeliveryPolicyState,
  formData: FormData,
): Promise<DeliveryPolicyState> {
  const jobId = String(formData.get('jobId') ?? '');
  const netTermRaw = Number(formData.get('netTermDays'));
  const reason = String(formData.get('reason') ?? '').trim();
  const confirmed = formData.get('confirmed') === 'true';

  if (!jobId) {
    return { ...deliveryPolicyInitialState, error: 'No job selected.' };
  }
  if (!isNetTerm(netTermRaw)) {
    return {
      ...deliveryPolicyInitialState,
      error: `Unsupported Net term. Choose ${NET_TERM_DAYS.join(', ')} days.`,
    };
  }
  if (!reason) {
    return {
      ...deliveryPolicyInitialState,
      error:
        'A reason is required. It is written to the audit trail as the justification for releasing the balance.',
    };
  }

  //  Releasing money control is not an undo-able convenience — make the Admin
  //  read back what they are about to authorise before it happens.
  if (!confirmed) {
    return {
      ...deliveryPolicyInitialState,
      needsConfirmation: true,
      confirmationDetail:
        `Release the final report while the remaining 80% is unpaid. ` +
        `The balance becomes an invoice due Net-${netTermRaw} — by ${dueDateFrom(netTermRaw)}. ` +
        `Delivery will no longer be blocked, and an overdue invoice will not revoke the report. ` +
        `This does not pay the Inspector; settlement stays a separate manual action.`,
    };
  }

  const { error } = await withFundingCore(() =>
    releaseJobOnCreditRpc(jobId, netTermRaw, reason),
  );

  if (error) {
    return {
      ...deliveryPolicyInitialState,
      error: rpcMessage(error, 'The credit-release RPC failed.'),
    };
  }

  revalidatePath('/admin/funding');
  revalidatePath(`/admin/funding/${jobId}`);
  revalidatePath('/admin/funding/invoices');

  return {
    ok: true,
    error: null,
    needsConfirmation: false,
    confirmationDetail: null,
    applied: {
      scope: 'job',
      summary: `Released on Net-${netTermRaw}, due ${dueDateFrom(netTermRaw)}.`,
    },
  };
}

// ── CLIENT-level default ────────────────────────────────────────────────────
export async function setClientDeliveryPolicyAction(
  _prev: DeliveryPolicyState,
  formData: FormData,
): Promise<DeliveryPolicyState> {
  const clientId = String(formData.get('clientId') ?? '');
  const mode = String(formData.get('mode') ?? '') as DeliveryPolicyMode;
  const reason = String(formData.get('reason') ?? '').trim();
  const confirmed = formData.get('confirmed') === 'true';
  const rawTerm = formData.get('netTermDays');
  const netTermDays = rawTerm === null || rawTerm === '' ? null : Number(rawTerm);

  if (!clientId) {
    return { ...deliveryPolicyInitialState, error: 'No client selected.' };
  }
  if (mode !== 'STRICT_PREPAY' && mode !== 'CREDIT_RELEASE') {
    return { ...deliveryPolicyInitialState, error: `Unknown delivery mode: ${mode}.` };
  }
  //  The database has the same coherence rule as a CHECK constraint. Mirrored
  //  here only so the Admin sees a sentence instead of a constraint name.
  if (mode === 'CREDIT_RELEASE' && (netTermDays === null || !isNetTerm(netTermDays))) {
    return {
      ...deliveryPolicyInitialState,
      error: `Approved Credit Release requires a Net term (${NET_TERM_DAYS.join(', ')} days).`,
    };
  }
  if (mode === 'STRICT_PREPAY' && netTermDays !== null) {
    return {
      ...deliveryPolicyInitialState,
      error: 'Strict Prepay cannot carry a Net term — the balance is due before delivery.',
    };
  }
  if (!reason) {
    return {
      ...deliveryPolicyInitialState,
      error: 'A reason is required. It is recorded in the audit trail.',
    };
  }

  if (!confirmed) {
    return {
      ...deliveryPolicyInitialState,
      needsConfirmation: true,
      confirmationDetail:
        mode === 'CREDIT_RELEASE'
          ? `Every future job for this client will be releasable on Net-${netTermDays} ` +
            `at an Admin's discretion. The 20% initial funding is still required before dispatch.`
          : `Every future job for this client will require the full balance before ` +
            `final report delivery. Jobs already released on credit keep their existing terms.`,
    };
  }

  const { error } = await withFundingCore(() =>
    setClientDeliveryPolicyRpc(
      clientId,
      mode,
      mode === 'CREDIT_RELEASE' ? (netTermDays as NetTermDays) : null,
      reason,
    ),
  );

  if (error) {
    return {
      ...deliveryPolicyInitialState,
      error: rpcMessage(error, 'The delivery-policy RPC failed.'),
    };
  }

  revalidatePath('/admin/funding');
  revalidatePath('/admin/clients');

  return {
    ok: true,
    error: null,
    needsConfirmation: false,
    confirmationDetail: null,
    applied: {
      scope: 'client',
      summary:
        mode === 'CREDIT_RELEASE'
          ? `Default set to Approved Credit Release, Net-${netTermDays}.`
          : 'Default set to Strict Prepay.',
    },
  };
}
