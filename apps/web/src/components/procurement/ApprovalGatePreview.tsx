'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/procurement/ApprovalGatePreview.tsx
//
//  Live in-form banner that tells the buyer, BEFORE they submit, whether
//  this job will:
//    · auto-post                                  → green chip
//    · trigger an approval gate                   → violet chip with details
//    · exceed the department budget envelope      → amber warning chip
//    · rate-unavailable / unknown                 → silent
//
//  How it watches the form
//  ───────────────────────
//  The job-post form is a Server Component with uncontrolled inputs and
//  a FormData server action. To avoid refactoring the whole form into
//  client state, this component instead listens to `input` / `change`
//  events on its closest <form> ancestor and reads the relevant field
//  values via FormData(form). This is the lightest-touch integration
//  pattern — drop the component in, no other code changes.
//
//  After a 450ms debounce, we call evaluateJobForApprovalAction with the
//  current amount + department and render the resulting verdict.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Building2,
  TrendingUp,
  Users,
  Coins,
} from 'lucide-react';

import type { ApprovalEvaluation } from '@nexpec/shared-core';
import { evaluateJobForApprovalAction } from '@/lib/actions/procurement';
import { cn } from '@/lib/cn';

interface Props {
  orgId: string;
  /** The org's name — surfaced in the banner copy. */
  orgName: string;
  /** Hide entirely when the buyer has no department to attribute to. */
  fallbackHidden?: boolean;
}

type Verdict =
  | { kind: 'idle' }
  | { kind: 'evaluating' }
  | { kind: 'auto_post'; budget: ApprovalEvaluation['budget'] }
  | { kind: 'gated'; evaluation: ApprovalEvaluation }
  | { kind: 'budget_warning'; budget: ApprovalEvaluation['budget'] }
  | { kind: 'error' };

export function ApprovalGatePreview({ orgId, orgName }: Props) {
  const [amount, setAmount] = useState<string>('');
  const [departmentId, setDepartmentId] = useState<string>('');
  const [verdict, setVerdict] = useState<Verdict>({ kind: 'idle' });
  const [, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  // Subscribe to the closest form's input + change events. Reading via
  // FormData(form) on every event is dirt-cheap and lets us stay
  // uncontrolled — no refactor of the surrounding form needed.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const form = root.closest('form');
    if (!form) return;

    const read = () => {
      const data = new FormData(form);
      setAmount(String(data.get('budgetDollars') ?? ''));
      setDepartmentId(String(data.get('departmentId') ?? ''));
    };

    form.addEventListener('input', read);
    form.addEventListener('change', read);
    read(); // initial
    return () => {
      form.removeEventListener('input', read);
      form.removeEventListener('change', read);
    };
  }, []);

  // Debounced evaluate.
  useEffect(() => {
    if (!orgId) {
      setVerdict({ kind: 'idle' });
      return;
    }
    if (!departmentId) {
      // Buyer hasn't picked a department yet → no preview possible.
      setVerdict({ kind: 'idle' });
      return;
    }
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum < 1) {
      setVerdict({ kind: 'idle' });
      return;
    }

    setVerdict({ kind: 'evaluating' });
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await evaluateJobForApprovalAction({
          orgId,
          departmentId,
          amountCents: Math.round(amountNum * 100),
          currency: 'USD',
        });

        if (!res.ok || !res.payload) {
          setVerdict({ kind: 'error' });
          return;
        }
        const ev = res.payload;
        const budget = ev.budget;
        const budgetExceeds = budget?.has_budget && budget?.would_exceed;

        if (ev.requires_approval) {
          setVerdict({ kind: 'gated', evaluation: ev });
        } else if (budgetExceeds) {
          setVerdict({ kind: 'budget_warning', budget });
        } else {
          setVerdict({ kind: 'auto_post', budget });
        }
      });
    }, 450);

    return () => clearTimeout(t);
  }, [amount, departmentId, orgId]);

  return (
    <div ref={rootRef}>
      <Banner verdict={verdict} orgName={orgName} />
    </div>
  );
}

/* ─── banner renderer ─────────────────────────────────────────────── */

function Banner({ verdict, orgName }: { verdict: Verdict; orgName: string }) {
  if (verdict.kind === 'idle') {
    return null;
  }

  if (verdict.kind === 'evaluating') {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <Loader2
          className="h-3.5 w-3.5 animate-spin text-violet-glow"
          strokeWidth={2}
        />
        <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          Checking against {orgName} policies…
        </p>
      </div>
    );
  }

  if (verdict.kind === 'error') {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3">
        <AlertTriangle
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-300"
          strokeWidth={1.75}
        />
        <p className="text-xs text-rose-200">
          Couldn&apos;t evaluate this job against approval policies. The
          post will still go through, gating decisions are re-evaluated
          server-side at submit.
        </p>
      </div>
    );
  }

  if (verdict.kind === 'auto_post') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.06] px-4 py-3">
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-emerald-100">
            Auto-post, no approval gate triggered
          </p>
          <p className="mt-0.5 text-[11px] text-emerald-200/70">
            This amount falls below every active approval band for{' '}
            {orgName}. The job will be live for inspectors immediately
            after moderation.
          </p>
          <BudgetHeadroom budget={verdict.budget} tone="positive" />
        </div>
      </div>
    );
  }

  if (verdict.kind === 'budget_warning') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3">
        <AlertTriangle
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
          strokeWidth={1.75}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-100">
            Auto-post, but this exceeds the department budget envelope
          </p>
          <p className="mt-0.5 text-[11px] text-amber-200/80">
            No approval band intercepts this amount, but the department&apos;s
            fiscal-period allocation will be over-spent. Procurement teams
            who watch the envelopes panel will see the warning.
          </p>
          <BudgetHeadroom budget={verdict.budget} tone="warning" />
        </div>
      </div>
    );
  }

  // verdict.kind === 'gated'
  const ev = verdict.evaluation;
  const required = ev.required_approver_roles ?? [];
  const minCount = ev.min_approvers_count ?? 1;
  const policyName = ev.policy_name ?? 'Approval policy';
  return (
    <div className="rounded-2xl border border-violet/30 bg-violet/[0.06] p-4">
      <header className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet/20 text-violet-glow ring-1 ring-inset ring-violet/40">
          <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">
            This job will route for approval before going live
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Matched band:{' '}
            <span className="text-zinc-200">{policyName}</span>, scope{' '}
            <span className="text-zinc-200">
              {ev.scope_department_id ? 'department' : 'org-wide'}
            </span>
          </p>
        </div>
      </header>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Tile
          icon={<Users className="h-3 w-3" strokeWidth={1.75} />}
          label="Required approvals"
          value={`${minCount} of ${required.length} role${
            required.length === 1 ? '' : 's'
          }`}
        />
        <Tile
          icon={<Building2 className="h-3 w-3" strokeWidth={1.75} />}
          label="Approvers from"
          value={required.map((r) => prettyRole(String(r))).join(', ') || '—'}
        />
        <Tile
          icon={<Coins className="h-3 w-3" strokeWidth={1.75} />}
          label="Segregation of Duties"
          value={
            ev.requires_sod === false
              ? 'Opted out, audit-flagged'
              : 'Enforced, you cannot approve your own request'
          }
          tone={ev.requires_sod === false ? 'amber' : 'violet'}
        />
      </div>

      <BudgetHeadroom budget={ev.budget} tone="neutral" />
    </div>
  );
}

/* ─── small subcomponents ─────────────────────────────────────────── */

function Tile({
  icon,
  label,
  value,
  tone = 'violet',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'violet' | 'amber';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-white/[0.02] px-3 py-2',
        tone === 'amber'
          ? 'border-amber-400/25'
          : 'border-white/[0.06]',
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        <span className="text-violet-glow">{icon}</span>
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-[11px]',
          tone === 'amber' ? 'text-amber-100' : 'text-white',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function BudgetHeadroom({
  budget,
  tone,
}: {
  budget: ApprovalEvaluation['budget'];
  tone: 'positive' | 'warning' | 'neutral';
}) {
  if (!budget?.has_budget) return null;

  const allocated = budget.allocated_cents ?? 0;
  const projected = budget.projected_remaining ?? 0;
  const currency = budget.currency ?? 'USD';
  const consumedPct =
    allocated > 0
      ? Math.min(100, Math.max(0, 100 - (projected / allocated) * 100))
      : 0;

  const barTone =
    tone === 'warning'
      ? 'bg-amber-400/70'
      : projected < 0
        ? 'bg-rose-400/70'
        : 'bg-violet/70';

  return (
    <div className="mt-3 border-t border-white/[0.04] pt-2">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="flex items-center gap-1.5 font-mono uppercase tracking-industrial text-zinc-500">
          <TrendingUp className="h-3 w-3 text-violet-glow" strokeWidth={1.75} />
          Budget envelope
        </span>
        <span className="font-mono text-zinc-300">
          {projected < 0
            ? `${formatMoney(Math.abs(projected), currency)} over`
            : `${formatMoney(projected, currency)} headroom after this`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className={cn('h-full transition-all', barTone)}
          style={{ width: `${consumedPct}%` }}
        />
      </div>
    </div>
  );
}

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

function prettyRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
