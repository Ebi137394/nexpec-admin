// ════════════════════════════════════════════════════════════════════════════
//  src/components/procurement/useMyPendingApprovals.ts
//
//  Mobile hook that powers the approver dashboard. Consumes the exact
//  same RPCs the web app does:
//
//    fetch_my_pending_approvals()  → list (already SoD-filtered server-side)
//    submit_job_approval()          → record a decision
//
//  Shared-core zod schemas validate the payloads — web and mobile cannot
//  drift on shape. SoD is enforced at three depths (schema constraint
//  trigger, RPC, server-side filter); this hook trusts those and renders
//  whatever comes back.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  submitJobApprovalInput,
  type PendingApprovalRow,
} from '@nexpec/shared-core';
import { supabase } from '@/lib/supabase';

const pendingRowSchema = z.array(
  z.object({
    request_id: z.string().uuid(),
    job_id: z.string().uuid(),
    job_title: z.string(),
    org_id: z.string().uuid(),
    org_name: z.string(),
    department_id: z.string().uuid().nullable(),
    department_name: z.string().nullable(),
    cost_center: z.string().nullable(),
    requested_by: z.string().uuid(),
    requested_by_label: z.string(),
    requested_at: z.string(),
    amount_cents: z.number().int(),
    currency: z.string(),
    min_approvers_required: z.number().int(),
    approved_count: z.number().int(),
    required_approver_roles: z.array(z.string()),
  }),
);

export interface UseMyPendingApprovalsApi {
  loading: boolean;
  error: string | null;
  requests: PendingApprovalRow[];
  /** id of the request whose decision is in flight. */
  pendingDecisionFor: string | null;
  refresh: () => Promise<void>;
  submitDecision: (
    jobId: string,
    decision: 'approved' | 'rejected',
    comment?: string,
  ) => Promise<{ ok: boolean; error?: string; final?: string }>;
}

export function useMyPendingApprovals(): UseMyPendingApprovalsApi {
  const [requests, setRequests] = useState<PendingApprovalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDecisionFor, setPendingDecisionFor] = useState<string | null>(
    null,
  );

  const fetchOnce = useCallback(async () => {
    setError(null);
    const { data, error: rpcError } = await supabase.rpc(
      'fetch_my_pending_approvals',
    );
    if (rpcError) {
      setRequests([]);
      setError(rpcError.message);
      return;
    }
    const parsed = pendingRowSchema.safeParse(data ?? []);
    if (!parsed.success) {
      setRequests([]);
      setError('Could not parse approvals payload.');
      return;
    }
    setRequests(parsed.data as PendingApprovalRow[]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchOnce();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchOnce]);

  const submitDecision = useCallback<
    UseMyPendingApprovalsApi['submitDecision']
  >(
    async (jobId, decision, comment) => {
      const inputResult = submitJobApprovalInput.safeParse({
        p_job_id: jobId,
        p_decision: decision,
        p_comment: comment,
      });
      if (!inputResult.success) {
        return {
          ok: false,
          error: inputResult.error.issues[0]?.message ?? 'Invalid input.',
        };
      }

      setError(null);
      setPendingDecisionFor(jobId);

      const { data, error: rpcError } = await supabase.rpc(
        'submit_job_approval',
        inputResult.data,
      );

      if (rpcError) {
        setPendingDecisionFor(null);
        setError(rpcError.message);
        return { ok: false, error: rpcError.message };
      }

      const result = (data ?? {}) as { ok?: boolean; final?: string };
      if (!result.ok) {
        setPendingDecisionFor(null);
        return { ok: false, error: 'RPC returned a non-ok response.' };
      }

      // Optimistic remove — the request leaves the SoD-filtered queue
      // either way (approved or rejected). Re-fetch in the background
      // to reconcile against the server (e.g. partial-quorum scenarios).
      setRequests((prev) => prev.filter((r) => r.job_id !== jobId));
      await fetchOnce();
      setPendingDecisionFor(null);
      return { ok: true, final: result.final };
    },
    [fetchOnce],
  );

  return {
    loading,
    error,
    requests,
    pendingDecisionFor,
    refresh: fetchOnce,
    submitDecision,
  };
}
