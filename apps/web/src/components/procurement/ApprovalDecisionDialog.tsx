'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/procurement/ApprovalDecisionDialog.tsx
//
//  Modal that captures an approver's decision (Approve or Reject) plus
//  an optional comment, then calls submitJobApprovalAction. On success
//  the dialog closes and the parent re-renders via router.refresh().
//
//  SoD enforcement is at three layers — schema, RPC, and UI. This UI
//  layer is the friendliest of the three: the parent (`/client/approvals`)
//  filters out the approver's own requests so this dialog is never
//  reachable for self-approval. The RPC catches anyone who hits it via
//  another path. The schema catches anyone who bypasses the RPC.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  AlertTriangle,
  Check,
  ThumbsDown,
  Building2,
  Hash,
  Loader2,
} from 'lucide-react';

import type { PendingApprovalRow } from '@nexpec/shared-core';
import { submitJobApprovalAction } from '@/lib/actions/procurement';
import { cn } from '@/lib/cn';

interface Props {
  request: PendingApprovalRow | null;
  open: boolean;
  onClose: () => void;
}

export function ApprovalDecisionDialog({ request, open, onClose }: Props) {
  const router = useRouter();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingDecision, setPendingDecision] = useState<
    'approved' | 'rejected' | null
  >(null);
  const [isPending, startTransition] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setComment('');
      setError(null);
      setPendingDecision(null);
      setTimeout(() => textRef.current?.focus(), 50);
    }
  }, [open, request?.request_id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !request) return null;

  const handle = (decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !comment.trim()) {
      setError('A reason is required for a rejection.');
      textRef.current?.focus();
      return;
    }
    setError(null);
    setPendingDecision(decision);
    startTransition(async () => {
      const res = await submitJobApprovalAction({
        jobId: request.job_id,
        decision,
        comment: comment.trim() || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? 'Could not record decision.');
        setPendingDecision(null);
        return;
      }
      router.refresh();
      // Tiny delay so the user sees the affirmative state.
      setTimeout(onClose, 250);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Approve or reject request"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/95 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
              Approval decision
            </p>
            <h3 className="mt-1 truncate font-display text-base font-semibold text-white">
              {request.job_title}
            </h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 truncate text-[11px] text-zinc-400">
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" strokeWidth={1.75} />
                {request.org_name}
              </span>
              {request.department_name && (
                <span>{request.department_name}</span>
              )}
              {request.cost_center && (
                <span className="inline-flex items-center gap-0.5 rounded border border-white/[0.08] bg-white/[0.03] px-1 py-px font-mono text-[10px] text-zinc-400">
                  <Hash className="h-2.5 w-2.5" strokeWidth={2} />
                  {request.cost_center}
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {/* Amount + requester */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-violet/30 bg-violet/[0.06] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
                Amount requested
              </p>
              <p className="mt-1 font-mono text-lg font-semibold text-white">
                {formatMoney(request.amount_cents, request.currency)}
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                Requested by
              </p>
              <p className="mt-1 truncate text-sm font-medium text-white">
                {request.requested_by_label}
              </p>
              <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
                {formatRelative(request.requested_at)}
              </p>
            </div>
          </div>

          {/* Approver context */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-zinc-300">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Quorum
            </p>
            <p className="mt-1">
              <span className="font-mono text-white">
                {request.approved_count}
              </span>{' '}
              of {request.min_approvers_required} approval
              {request.min_approvers_required === 1 ? '' : 's'} so far ·
              valid approvers:{' '}
              {request.required_approver_roles
                .map((r) => prettyRole(r as string))
                .join(', ')}
            </p>
          </div>

          {/* Comment */}
          <div>
            <label
              htmlFor="approval-comment"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Comment
              <span className="ml-1 text-zinc-600">
                (required for a rejection)
              </span>
            </label>
            <textarea
              id="approval-comment"
              ref={textRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="e.g. Confirmed against Q3 envelope; clear to proceed."
              disabled={isPending}
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30 disabled:opacity-50"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Audit-stamped with your identity, role, and decision time.
            </p>
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                strokeWidth={1.75}
              />
              <span>{error}</span>
            </p>
          )}

          {/* Decision buttons */}
          <div className="grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={() => handle('rejected')}
              disabled={isPending}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold uppercase tracking-industrial transition-colors',
                'border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
                'disabled:opacity-50',
              )}
            >
              {isPending && pendingDecision === 'rejected' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <ThumbsDown className="h-3.5 w-3.5" strokeWidth={1.75} />
              )}
              Reject
            </button>
            <button
              type="button"
              onClick={() => handle('approved')}
              disabled={isPending}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-xs font-semibold uppercase tracking-industrial transition-colors',
                'bg-violet/25 text-violet-glow ring-1 ring-inset ring-violet/40 hover:bg-violet/35',
                'disabled:opacity-50',
              )}
            >
              {isPending && pendingDecision === 'approved' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              ) : (
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── small formatters (zero-dep) ──────────────────────────────────── */

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toLocaleString()}`;
  }
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.round(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function prettyRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
