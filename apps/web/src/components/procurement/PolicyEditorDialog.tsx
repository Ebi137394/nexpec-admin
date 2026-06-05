'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/procurement/PolicyEditorDialog.tsx
//
//  Create or edit one approval-policy band. Calls setApprovalPolicyAction.
//
//  Form fields:
//    · name
//    · min amount + max amount (max blank = "unbounded")
//    · currency
//    · required approver roles (multi-select chips)
//    · min approvers count (numeric)
//    · requires_sod toggle (default ON; warning when OFF)
//    · scope department (optional — defaults to org-wide)
//    · is_active toggle
//
//  Band overlap is enforced by the DB constraint trigger. We surface the
//  resulting 23P01 error inline as "this band overlaps an existing one"
//  so the user immediately knows what to adjust.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  Loader2,
  Coins,
} from 'lucide-react';

import {
  ORG_MEMBER_ROLES,
  SUPPORTED_CURRENCIES,
  type CurrencyCode,
  type OrgMemberRole,
} from '@nexpec/shared-core';
import type { ApprovalPolicyRow } from '@/lib/data/procurement.types';
import { setApprovalPolicyAction } from '@/lib/actions/procurement';
import type { DepartmentPickerOption } from '@/lib/data/orgStructure.types';
import { cn } from '@/lib/cn';

interface Props {
  open: boolean;
  onClose: () => void;
  orgId: string;
  /** When set, the dialog edits this policy; otherwise it creates a new one. */
  policy?: ApprovalPolicyRow | null;
  /** All departments in the org for the scope picker (depth-annotated). */
  departments: DepartmentPickerOption[];
}

export function PolicyEditorDialog({
  open,
  onClose,
  orgId,
  policy,
  departments,
}: Props) {
  const router = useRouter();
  const editing = !!policy;

  const [name, setName] = useState('');
  const [minDollars, setMinDollars] = useState('0');
  const [maxDollars, setMaxDollars] = useState(''); // empty = unbounded
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [requiredRoles, setRequiredRoles] = useState<OrgMemberRole[]>([
    'owner',
  ]);
  const [minApprovers, setMinApprovers] = useState(1);
  const [requiresSod, setRequiresSod] = useState(true);
  const [scopeDeptId, setScopeDeptId] = useState<string>(''); // '' = org-wide
  const [isActive, setIsActive] = useState(true);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  // Seed when opening.
  useEffect(() => {
    if (!open) return;
    if (policy) {
      setName(policy.name);
      setMinDollars((policy.min_amount_cents / 100).toString());
      setMaxDollars(
        policy.max_amount_cents === null
          ? ''
          : (policy.max_amount_cents / 100).toString(),
      );
      setCurrency(policy.currency as CurrencyCode);
      setRequiredRoles(policy.required_approver_roles as OrgMemberRole[]);
      setMinApprovers(policy.min_approvers_count);
      setRequiresSod(policy.requires_sod);
      setScopeDeptId(policy.scope_department_id ?? '');
      setIsActive(policy.is_active);
    } else {
      setName('');
      setMinDollars('0');
      setMaxDollars('');
      setCurrency('USD');
      setRequiredRoles(['owner']);
      setMinApprovers(1);
      setRequiresSod(true);
      setScopeDeptId('');
      setIsActive(true);
    }
    setError(null);
    setTimeout(() => nameRef.current?.focus(), 50);
  }, [open, policy]);

  // Esc + body lock
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

  if (!open) return null;

  const toggleRole = (role: OrgMemberRole) => {
    setRequiredRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const minCents = Math.round(parseFloat(minDollars || '0') * 100);
    const maxCents = maxDollars.trim()
      ? Math.round(parseFloat(maxDollars) * 100)
      : null;

    if (Number.isNaN(minCents) || minCents < 0) {
      setError('Minimum amount must be a non-negative number.');
      return;
    }
    if (maxCents !== null && (Number.isNaN(maxCents) || maxCents <= minCents)) {
      setError('Maximum must be a number greater than minimum (or blank).');
      return;
    }
    if (requiredRoles.length === 0) {
      setError('Pick at least one required approver role.');
      return;
    }

    startTransition(async () => {
      const res = await setApprovalPolicyAction({
        orgId,
        name: name.trim(),
        minAmountCents: minCents,
        maxAmountCents: maxCents,
        currency,
        requiredApproverRoles: requiredRoles,
        minApproversCount: minApprovers,
        requiresSod,
        scopeDepartmentId: scopeDeptId || null,
        isActive,
        id: policy?.id ?? null,
      });
      if (!res.ok) {
        // Friendly translation of the overlap error.
        const msg = res.error ?? 'Could not save policy.';
        if (/overlap/i.test(msg)) {
          setError(
            'This band overlaps an existing active band for the same currency / scope. Adjust the min / max, or deactivate the conflicting band first.',
          );
        } else {
          setError(msg);
        }
        return;
      }
      router.refresh();
      setTimeout(onClose, 200);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? 'Edit approval policy' : 'Create approval policy'}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/95 shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
              Procurement, Approval band
            </p>
            <h3 className="mt-1 font-display text-base font-semibold text-white">
              {editing ? `Edit "${policy?.name}"` : 'New approval band'}
            </h3>
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

        <form onSubmit={submit} className="max-h-[70vh] overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            {/* Name */}
            <Field label="Policy name">
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                placeholder="e.g. Dept Head Tier, $10K–$50K"
                className={inputCls}
              />
            </Field>

            {/* Amount range + currency */}
            <div className="grid grid-cols-3 gap-2">
              <Field label="Min (≥)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={minDollars}
                  onChange={(e) => setMinDollars(e.target.value)}
                  className={`${inputCls} font-mono`}
                />
              </Field>
              <Field label="Max (<)">
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={maxDollars}
                  onChange={(e) => setMaxDollars(e.target.value)}
                  placeholder="∞"
                  className={`${inputCls} font-mono`}
                />
              </Field>
              <Field label="Currency">
                <div className="relative">
                  <Coins className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                    className={`${inputCls} appearance-none pl-8 font-mono`}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            </div>

            <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
              Jobs whose amount falls in [{minDollars || 0},{' '}
              {maxDollars || '∞'}) {currency} match this band.
            </p>

            {/* Required approver roles */}
            <Field
              label="Required approver roles"
              hint="Any user whose org_member.role is in this set may decide."
            >
              <div className="flex flex-wrap gap-2">
                {ORG_MEMBER_ROLES.map((r) => {
                  const active = requiredRoles.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => toggleRole(r)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial transition-colors',
                        active
                          ? 'border-violet/50 bg-violet/15 text-violet-glow'
                          : 'border-white/[0.08] bg-white/[0.02] text-zinc-400 hover:border-violet/30 hover:text-violet-glow',
                      )}
                    >
                      {active && <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />}
                      {prettyRole(r)}
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* Min approvers count */}
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Min approvers required"
                hint="Co-sign workflows: set to 2+ for SOX-grade dual approval."
              >
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={1}
                  value={minApprovers}
                  onChange={(e) => setMinApprovers(Number(e.target.value))}
                  className={`${inputCls} font-mono`}
                />
              </Field>

              <Field
                label="Scope (optional)"
                hint="Leave blank to apply org-wide."
              >
                <select
                  value={scopeDeptId}
                  onChange={(e) => setScopeDeptId(e.target.value)}
                  className={`${inputCls} appearance-none`}
                >
                  <option value="">Org-wide</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {'  '.repeat(Math.max(0, d.depth)) +
                        (d.depth > 0 ? '↳ ' : '') +
                        d.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* SoD toggle */}
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <input
                type="checkbox"
                checked={requiresSod}
                onChange={(e) => setRequiresSod(e.target.checked)}
                className="mt-1 h-3.5 w-3.5 cursor-pointer accent-violet-glow"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-medium text-white">
                  <ShieldCheck
                    className="h-3.5 w-3.5 text-violet-glow"
                    strokeWidth={1.75}
                  />
                  Enforce Segregation of Duties
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  The poster cannot approve their own request. SOX 404 standard
                  — schema-enforced. Leave on unless you have a deliberate
                  reason.
                </p>
                {!requiresSod && (
                  <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-2 py-1 text-[10px] text-amber-200">
                    <AlertTriangle className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                    SoD off, auditors will flag this. Justify in policy notes.
                  </p>
                )}
              </div>
            </label>

            {/* Active toggle */}
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-emerald-400"
              />
              <span className="text-sm text-white">
                Active,{' '}
                <span className="text-zinc-500">
                  inactive bands don&apos;t gate new jobs but stay in history
                </span>
              </span>
            </label>

            {error && (
              <p className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span>{error}</span>
              </p>
            )}
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-300 transition-colors hover:bg-white/[0.04] hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !name.trim()}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-industrial transition-colors',
                'bg-violet/25 text-violet-glow ring-1 ring-inset ring-violet/40 hover:bg-violet/35',
                'disabled:opacity-50',
              )}
            >
              {isPending && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
              )}
              {editing ? 'Save policy' : 'Create policy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── primitives ──────────────────────────────────────────────────── */

const inputCls =
  'w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function prettyRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
