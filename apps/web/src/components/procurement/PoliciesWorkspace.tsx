'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/procurement/PoliciesWorkspace.tsx
//
//  Client workspace for /client/budget/policies — owns the create/edit
//  dialog state, renders the ladder of active and inactive bands, and
//  handles the "activate / deactivate" toggle inline.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Pencil,
  Power,
  PowerOff,
  ShieldCheck,
  ShieldOff,
  Hash,
  Building2,
  AlertTriangle,
} from 'lucide-react';

import type { ApprovalPolicyRow } from '@/lib/data/procurement.types';
import type { DepartmentPickerOption } from '@/lib/data/orgStructure.types';
import { togglePolicyActiveAction } from '@/lib/actions/procurement';
import { PolicyEditorDialog } from './PolicyEditorDialog';
import { cn } from '@/lib/cn';

interface Props {
  orgId: string;
  orgName: string;
  policies: ApprovalPolicyRow[];
  departments: DepartmentPickerOption[];
}

export function PoliciesWorkspace({
  orgId,
  orgName,
  policies,
  departments,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<ApprovalPolicyRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Group by (currency, scope) for the ladder display.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { currency: string; scopeName: string | null; rows: ApprovalPolicyRow[] }
    >();
    for (const p of policies) {
      const key = `${p.currency}|${p.scope_department_id ?? ''}`;
      if (!map.has(key)) {
        map.set(key, {
          currency: p.currency,
          scopeName: p.scope_department_name,
          rows: [],
        });
      }
      map.get(key)!.rows.push(p);
    }
    // Sort each group's rows by min_amount_cents ascending for the ladder.
    for (const g of map.values()) {
      g.rows.sort((a, b) => a.min_amount_cents - b.min_amount_cents);
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.scopeName ?? '').localeCompare(b.scopeName ?? ''),
    );
  }, [policies]);

  const handleToggle = (p: ApprovalPolicyRow) => {
    setToggleError(null);
    setTogglingId(p.id);
    startTransition(async () => {
      const res = await togglePolicyActiveAction({
        orgId,
        policyId: p.id,
        isActive: !p.is_active,
      });
      if (!res.ok) {
        setToggleError(res.error ?? 'Could not toggle policy.');
      }
      setTogglingId(null);
      router.refresh();
    });
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-zinc-400">
          Tiered approval bands for{' '}
          <span className="text-white">{orgName}</span>. Jobs whose amount
          falls in an active band route to approvers with the listed roles.
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-violet/20 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow ring-1 ring-inset ring-violet/40 transition-colors hover:bg-violet/30"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New band
        </button>
      </div>

      {toggleError && (
        <p className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          <span>{toggleError}</span>
        </p>
      )}

      {policies.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <ShieldCheck
            className="mx-auto h-7 w-7 text-violet-glow/70"
            strokeWidth={1.5}
          />
          <p className="mt-4 font-display text-base text-white">
            No approval bands configured
          </p>
          <p className="mt-1 mx-auto max-w-md text-pretty text-xs text-zinc-500">
            Without bands, every job auto-posts. Add a first band to start
            gating spend over a threshold.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group, gi) => (
            <section
              key={gi}
              className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5"
            >
              <header className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                    <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                      Ladder
                    </p>
                    <p className="font-display text-sm text-white">
                      {group.scopeName ?? 'Org-wide'}{' '}
                      <span className="font-mono text-[11px] uppercase tracking-industrial text-zinc-500">
                        · {group.currency}
                      </span>
                    </p>
                  </div>
                </div>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 font-mono text-[10px] text-zinc-500">
                  {group.rows.length} band{group.rows.length === 1 ? '' : 's'}
                </span>
              </header>

              <ul className="mt-3 space-y-2">
                {group.rows.map((p) => (
                  <li
                    key={p.id}
                    className={cn(
                      'group flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3 text-xs',
                      p.is_active
                        ? 'border-white/[0.06] bg-white/[0.02]'
                        : 'border-white/[0.04] bg-white/[0.01] opacity-60',
                    )}
                  >
                    {/* Range chip */}
                    <span className="inline-flex items-center gap-1 rounded-md border border-violet/30 bg-violet/10 px-2 py-1 font-mono text-[11px] text-violet-glow">
                      <Hash className="h-3 w-3" strokeWidth={2} />
                      {formatRange(p.min_amount_cents, p.max_amount_cents, p.currency)}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {p.name}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        Roles:{' '}
                        {p.required_approver_roles
                          .map((r) => prettyRole(r))
                          .join(', ')}{' '}
                        · {p.min_approvers_count} approval
                        {p.min_approvers_count === 1 ? '' : 's'} required
                      </p>
                    </div>

                    {/* SoD pill */}
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial',
                        p.requires_sod
                          ? 'border-violet/30 bg-violet/10 text-violet-glow'
                          : 'border-amber-400/30 bg-amber-400/[0.06] text-amber-200',
                      )}
                      title={p.requires_sod ? 'Segregation of Duties enforced' : 'SoD disabled'}
                    >
                      {p.requires_sod ? (
                        <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
                      ) : (
                        <ShieldOff className="h-3 w-3" strokeWidth={1.75} />
                      )}
                      {p.requires_sod ? 'SoD' : 'No SoD'}
                    </span>

                    {/* Action buttons */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditing(p)}
                        className="inline-flex items-center gap-1 rounded-md border border-white/[0.06] px-2 py-1 text-[10px] font-semibold uppercase tracking-industrial text-zinc-300 transition-colors hover:border-violet/30 hover:text-violet-glow"
                      >
                        <Pencil className="h-3 w-3" strokeWidth={1.75} />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggle(p)}
                        disabled={isPending && togglingId === p.id}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-industrial transition-colors',
                          p.is_active
                            ? 'border-white/[0.06] text-zinc-300 hover:border-amber-400/30 hover:text-amber-200'
                            : 'border-emerald-400/30 text-emerald-200 hover:bg-emerald-500/10',
                          'disabled:opacity-50',
                        )}
                      >
                        {p.is_active ? (
                          <>
                            <PowerOff className="h-3 w-3" strokeWidth={1.75} />
                            Deactivate
                          </>
                        ) : (
                          <>
                            <Power className="h-3 w-3" strokeWidth={1.75} />
                            Activate
                          </>
                        )}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <PolicyEditorDialog
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        orgId={orgId}
        policy={editing}
        departments={departments}
      />
    </>
  );
}

/* ─── formatters ──────────────────────────────────────────────────── */

function formatRange(
  minCents: number,
  maxCents: number | null,
  currency: string,
): string {
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 0,
      }).format(n / 100);
    } catch {
      return `${currency} ${(n / 100).toLocaleString()}`;
    }
  };
  return maxCents === null
    ? `${fmt(minCents)}+`
    : `${fmt(minCents)} – ${fmt(maxCents)}`;
}

function prettyRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
