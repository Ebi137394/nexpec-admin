'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  X,
  CheckCircle2,
  Ban,
  PauseCircle,
  AlertTriangle,
  Link2,
  ShieldCheck,
} from 'lucide-react';
import type { CredentialDecision } from '@nexpec/shared-core';
import {
  reviewCredential,
  reviewCredentialInitialState,
  type ReviewCredentialActionState,
} from '@/lib/actions/credentials';
import type { ComplianceCredential } from '@/lib/data/compliance.types';
import { cn } from '@/lib/cn';

interface ComplianceDrawerProps {
  credential: ComplianceCredential | null;
}

interface DecisionOption {
  value: CredentialDecision;
  label: string;
  copy: string;
  icon: typeof CheckCircle2;
  tone: 'green' | 'red' | 'amber';
}

const DECISIONS: DecisionOption[] = [
  {
    value: 'approved',
    label: 'Approve',
    copy: 'Credential active. Inspector can accept compliance-track jobs at this tier.',
    icon: CheckCircle2,
    tone: 'green',
  },
  {
    value: 'suspended',
    label: 'Suspend',
    copy: 'Pause activity while investigating. Reversible, re-approve any time.',
    icon: PauseCircle,
    tone: 'amber',
  },
  {
    value: 'rejected',
    label: 'Reject',
    copy: 'Terminal, inspector must reapply with new evidence. Audit-stamped.',
    icon: Ban,
    tone: 'red',
  },
];

export function ComplianceDrawer({ credential }: ComplianceDrawerProps) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const open = !!credential;

  const [decision, setDecision] = useState<CredentialDecision>('approved');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setDecision('approved');
    setNotes('');
  }, [credential?.id]);

  const [state, formAction] = useActionState<ReviewCredentialActionState, FormData>(
    reviewCredential,
    reviewCredentialInitialState,
  );

  useEffect(() => {
    if (!state.ok || !state.reviewed) return;
    const t = setTimeout(() => close(), 2500);
    return () => clearTimeout(t);
  }, [state.ok, state.reviewed?.credential_id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function close() {
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.delete('inspect');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <AnimatePresence>
      {open && credential && (
        <>
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col border-l border-white/[0.06] bg-ink-950 shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.8)]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
              <div className="min-w-0 flex-1">
                <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                  <ShieldCheck className="h-3 w-3" />
                  CCI Credential Review
                </p>
                <h2 className="mt-1 truncate font-display text-lg font-semibold tracking-tight text-white">
                  {credential.inspector_name ?? credential.inspector_email ?? credential.inspector_id ?? '—'}
                </h2>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  Tier <span className="font-mono text-cyan-glow">{credential.tier ?? '—'}</span>
                  {', '}current status{' '}
                  <span className="font-mono uppercase text-zinc-300">{credential.status}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                disabled={state.ok}
                className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-zinc-400 transition-colors hover:border-white/30 hover:text-white disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {state.ok && state.reviewed ? (
                <SuccessPanel state={state} />
              ) : (
                <Body
                  credential={credential}
                  decision={decision}
                  setDecision={setDecision}
                  notes={notes}
                  setNotes={setNotes}
                  state={state}
                  formAction={formAction}
                />
              )}
            </div>

            <footer className="border-t border-white/[0.06] px-6 py-3">
              <p className="font-mono text-[10px] tracking-wider text-zinc-600">
                rpc, admin_review_credential, FOR UPDATE lock, audit-stamped
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function Body({
  credential,
  decision,
  setDecision,
  notes,
  setNotes,
  state,
  formAction,
}: {
  credential: ComplianceCredential;
  decision: CredentialDecision;
  setDecision: (d: CredentialDecision) => void;
  notes: string;
  setNotes: (v: string) => void;
  state: ReviewCredentialActionState;
  formAction: (formData: FormData) => void;
}) {
  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="credentialId" value={credential.id} />
      <input type="hidden" name="decision" value={decision} />

      {/* Snapshot */}
      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Evidence snapshot
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
          <div>
            <dt className="text-zinc-500">Government ID</dt>
            <dd className="mt-0.5 font-medium text-zinc-200">
              {credential.gov_id_verified ? 'Verified' : 'Unverified'}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Experience (yrs)</dt>
            <dd className="mt-0.5 font-mono font-semibold text-zinc-200">
              {credential.experience_years_documented ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Applied</dt>
            <dd className="mt-0.5 font-mono text-zinc-200">
              {formatDate(credential.applied_at)}
            </dd>
          </div>
          <div>
            <dt className="text-zinc-500">Last decision</dt>
            <dd className="mt-0.5 font-mono text-zinc-200">
              {formatDate(credential.decided_at)}
            </dd>
          </div>
        </dl>
        {credential.decision_notes && (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              Previous notes
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-300">
              {credential.decision_notes}
            </p>
          </div>
        )}
      </section>

      {/* Decision picker */}
      <section>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Decision
        </p>
        <div className="space-y-2">
          {DECISIONS.map((opt) => (
            <DecisionRadio
              key={opt.value}
              option={opt}
              selected={decision === opt.value}
              onSelect={() => setDecision(opt.value)}
            />
          ))}
        </div>
      </section>

      {/* Notes */}
      <section>
        <label htmlFor="cred-notes" className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
            Notes (audit-captured, required)
          </span>
          <textarea
            id="cred-notes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            required
            maxLength={1000}
            rows={4}
            placeholder="Cite the evidence reviewed (gov_id storage path, experience artefact, references). This text is preserved verbatim in the audit trail."
            className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
          />
        </label>
        <p className="mt-1 text-right font-mono text-[10px] text-zinc-600">
          {notes.length} / 1000
        </p>
      </section>

      {state.error && (
        <div className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{state.error}</p>
        </div>
      )}

      <ReviewSubmit decision={decision} />
    </form>
  );
}

function DecisionRadio({
  option,
  selected,
  onSelect,
}: {
  option: DecisionOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const toneClasses = {
    green: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
    amber: 'border-accent-amber/40 bg-accent-amber/10 text-accent-amber',
    red: 'border-accent-red/40 bg-accent-red/10 text-accent-red',
  } as const;
  const Icon = option.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-all',
        selected
          ? `${toneClasses[option.tone]} ring-2 ring-inset ring-current/30`
          : 'border-white/[0.06] bg-white/[0.02] text-zinc-300 hover:border-white/20 hover:bg-white/[0.04]',
      )}
    >
      <span
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          selected ? 'bg-current/10' : 'bg-white/[0.04]',
        )}
      >
        <Icon className={cn('h-4 w-4', selected ? '' : 'text-zinc-400')} strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('font-medium', selected ? '' : 'text-zinc-100')}>{option.label}</p>
        <p className={cn('mt-0.5 text-xs leading-relaxed', selected ? 'opacity-90' : 'text-zinc-500')}>
          {option.copy}
        </p>
      </div>
    </button>
  );
}

function ReviewSubmit({ decision }: { decision: CredentialDecision }) {
  const { pending } = useFormStatus();
  const label =
    decision === 'approved'
      ? 'Confirm, approve credential'
      : decision === 'suspended'
        ? 'Confirm, suspend credential'
        : 'Confirm, reject credential';
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary group w-full justify-center disabled:opacity-60 disabled:hover:bg-violet disabled:hover:shadow-glow"
    >
      <ShieldCheck className="h-4 w-4" />
      {pending ? 'Recording…' : label}
    </button>
  );
}

function SuccessPanel({ state }: { state: ReviewCredentialActionState }) {
  if (!state.reviewed) return null;
  const { to_status, correlation_id } = state.reviewed;
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-accent-green/40 bg-accent-green/10 p-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent-green/20 text-accent-green">
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <div>
            <p className="font-display text-base font-semibold text-white">
              Credential review recorded.
            </p>
            <p className="text-xs text-zinc-400">
              Status moved to{' '}
              <span className="font-mono text-accent-green">{to_status}</span>.
            </p>
          </div>
        </div>
      </div>
      {correlation_id && (
        <Link
          href={`/admin/audit?correlationId=${correlation_id}`}
          className="inline-flex items-center gap-2 rounded-lg border border-violet/30 bg-violet/10 px-3 py-2 text-xs font-medium text-violet-glow transition-colors hover:bg-violet/20"
        >
          <Link2 className="h-3.5 w-3.5" />
          View this review in the Audit Trail
        </Link>
      )}
      <p className="text-[11px] text-zinc-500">This drawer will close in a moment.</p>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}
