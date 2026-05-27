// ════════════════════════════════════════════════════════════════════════════
//  src/components/procurement/useEvaluateApproval.ts
//
//  Mobile counterpart to the web ApprovalGatePreview's evaluation flow.
//  Debounces calls to evaluate_job_for_approval(org_id, dept_id, amount,
//  currency) and returns a structured verdict suitable for an inline
//  banner on the mobile post-new-job form.
//
//  Validates input via the same shared-core schema the web uses —
//  schemas/organizations.ts/evaluateJobForApprovalInput — so the two
//  surfaces cannot drift on shape.
//
//  USAGE
//  ─────
//    const verdict = useEvaluateApproval({
//      orgId: activeOrg?.org_id,
//      departmentId: pickedDeptId,
//      amountCents: parseFloat(amountDollars) * 100,
//      currency: 'USD',
//    });
//    // verdict.kind === 'idle' | 'evaluating' | 'auto_post' | 'gated'
//    //               | 'budget_warning' | 'error'
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import {
  evaluateJobForApprovalInput,
  type ApprovalEvaluation,
} from '@nexpec/shared-core';
import { supabase } from '@/lib/supabase';

export type ApprovalVerdict =
  | { kind: 'idle' }
  | { kind: 'evaluating' }
  | { kind: 'auto_post'; budget: ApprovalEvaluation['budget'] }
  | { kind: 'gated'; evaluation: ApprovalEvaluation }
  | { kind: 'budget_warning'; budget: ApprovalEvaluation['budget'] }
  | { kind: 'error'; message: string };

export interface UseEvaluateApprovalInput {
  orgId: string | null | undefined;
  departmentId: string | null | undefined;
  /** Amount in cents (whole units × 100). 0/null/NaN → idle. */
  amountCents: number | null | undefined;
  currency: string;
  /** Debounce window. Default 450ms (matches the web preview). */
  debounceMs?: number;
}

export function useEvaluateApproval(
  input: UseEvaluateApprovalInput,
): ApprovalVerdict {
  const [verdict, setVerdict] = useState<ApprovalVerdict>({ kind: 'idle' });
  const debounceMs = input.debounceMs ?? 450;

  useEffect(() => {
    const { orgId, departmentId, amountCents, currency } = input;

    if (!orgId || !departmentId) {
      setVerdict({ kind: 'idle' });
      return;
    }
    if (
      amountCents == null ||
      !Number.isFinite(amountCents) ||
      amountCents < 100
    ) {
      setVerdict({ kind: 'idle' });
      return;
    }

    // Validate input shape against shared-core BEFORE the round-trip.
    const inputResult = evaluateJobForApprovalInput.safeParse({
      p_org_id: orgId,
      p_department_id: departmentId,
      p_amount_cents: Math.round(amountCents),
      p_currency: currency,
    });
    if (!inputResult.success) {
      setVerdict({ kind: 'idle' });
      return;
    }

    setVerdict({ kind: 'evaluating' });
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc(
        'evaluate_job_for_approval',
        inputResult.data,
      );
      if (cancelled) return;

      if (error) {
        // Function-missing means PCP isn't installed in this env — degrade
        // silently to auto-post with no budget context.
        if (/function .* does not exist/i.test(error.message ?? '')) {
          setVerdict({ kind: 'auto_post', budget: undefined });
          return;
        }
        setVerdict({ kind: 'error', message: error.message });
        return;
      }

      const ev = (data ?? {}) as ApprovalEvaluation;
      const budget = ev.budget;
      const budgetExceeds = budget?.has_budget && budget?.would_exceed;

      if (ev.requires_approval) {
        setVerdict({ kind: 'gated', evaluation: ev });
      } else if (budgetExceeds) {
        setVerdict({ kind: 'budget_warning', budget });
      } else {
        setVerdict({ kind: 'auto_post', budget });
      }
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    input.orgId,
    input.departmentId,
    input.amountCents,
    input.currency,
    debounceMs,
  ]);

  return verdict;
}
