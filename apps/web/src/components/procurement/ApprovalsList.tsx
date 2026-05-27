'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/procurement/ApprovalsList.tsx
//
//  Client component for /client/approvals — renders the queue of
//  pending requests + owns the open/close state for the decision dialog.
//  Server page does the fetch + auth; this component is pure UI + state.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import {
  Building2,
  Clock,
  Hash,
  Receipt,
  ShieldCheck,
  Users,
} from 'lucide-react';

import type { PendingApprovalRow } from '@nexpec/shared-core';
import { ApprovalDecisionDialog } from './ApprovalDecisionDialog';
import { cn } from '@/lib/cn';

interface Props {
  requests: PendingApprovalRow[];
}

export function ApprovalsList({ requests }: Props) {
  const [active, setActive] = useState<PendingApprovalRow | null>(null);

  if (requests.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
        <ShieldCheck
          className="mx-auto h-7 w-7 text-violet-glow/70"
          strokeWidth={1.5}
        />
        <p className="mt-4 font-display text-base text-white">
          No pending approvals
        </p>
        <p className="mt-1 mx-auto max-w-md text-pretty text-xs text-zinc-500">
          You&apos;re all caught up. New requests routed to your role will
          appear here. Requests you posted yourself are deliberately hidden
          (Segregation of Duties).
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-3">
        {requests.map((r) => (
          <li key={r.request_id}>
            <button
              type="button"
              onClick={() => setActive(r)}
              className={cn(
                'group flex w-full items-start gap-4 rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5 text-left transition-all',
                'hover:-translate-y-px hover:border-violet/30 hover:bg-violet/[0.04]',
              )}
            >
              <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                <Receipt className="h-4 w-4" strokeWidth={1.75} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-semibold text-white">
                      {r.job_title}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 truncate text-[11px] text-zinc-500">
                      <span className="inline-flex items-center gap-1">
                        <Building2 className="h-3 w-3" strokeWidth={1.75} />
                        {r.org_name}
                      </span>
                      {r.department_name && (
                        <>
                          <span className="text-zinc-700">·</span>
                          <span>{r.department_name}</span>
                        </>
                      )}
                      {r.cost_center && (
                        <span className="inline-flex items-center gap-0.5 rounded border border-white/[0.08] bg-white/[0.03] px-1 py-px font-mono text-[10px] text-zinc-400">
                          <Hash className="h-2.5 w-2.5" strokeWidth={2} />
                          {r.cost_center}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="font-mono text-lg font-semibold text-white">
                      {formatMoney(r.amount_cents, r.currency)}
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                      requested
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.04] pt-3 text-[11px] text-zinc-400">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3 w-3 text-violet-glow" strokeWidth={1.75} />
                    By {r.requested_by_label}
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
                    <Clock className="h-3 w-3" strokeWidth={1.75} />
                    {formatRelative(r.requested_at)}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-industrial text-violet-glow/90">
                    {r.approved_count}/{r.min_approvers_required} approvals
                  </span>
                </div>
              </div>

              <span className="self-center font-mono text-[10px] uppercase tracking-industrial text-zinc-500 group-hover:text-violet-glow">
                REVIEW →
              </span>
            </button>
          </li>
        ))}
      </ul>

      <ApprovalDecisionDialog
        request={active}
        open={active !== null}
        onClose={() => setActive(null)}
      />
    </>
  );
}

/* ─── formatters ──────────────────────────────────────────────────── */

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
