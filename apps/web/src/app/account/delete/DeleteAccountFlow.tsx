'use client';

// ════════════════════════════════════════════════════════════════════════════
//  DeleteAccountFlow — client half of /account/delete.
//
//  States: checking session → signed-out (CTA to /sign-in?next=…) →
//  signed-in confirm (type DELETE + checkbox) → busy → done | blocked | error.
//
//  Reuses the EXISTING `delete-account` Edge Function via
//  supabase.functions.invoke (Bearer JWT attached automatically from the
//  shared cookie session). No deletion logic is duplicated here; the
//  function's guards (ACTIVE_JOBS / WALLET_NOT_EMPTY) are surfaced verbatim
//  as human-readable reasons. Mirrors the mobile Security-screen flow.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader2, LogIn } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

type Phase =
  | 'checking'
  | 'signed-out'
  | 'admin-blocked'
  | 'confirm'
  | 'busy'
  | 'done'
  | 'blocked'
  | 'error';

const BLOCKED_REASONS: Record<string, string> = {
  ACTIVE_JOBS:
    'You still have active jobs. Complete or cancel them first, then return here.',
  WALLET_NOT_EMPTY:
    'Your wallet still has an unsettled balance. Request a payout (or settle outstanding amounts) first, then return here.',
  PENDING_PAYOUT:
    'You have a pending payout or withdrawal. Wait for it to settle first, then return here.',
  FAILED_PAYOUT:
    'You have an unresolved withdrawal (pending, processing, or failed). Resolve it with support first.',
  OPEN_INVOICE:
    'You have an unsettled invoice. Settle or void it first, then return here.',
  OPEN_DISPUTE:
    'You have an open dispute. It must be resolved before your account can be deleted.',
  SUPPLIER_ACTIVE_CONTRACT:
    'You have an active supplier contract. It must be completed or voided first.',
  SUPPLIER_OPEN_QUOTE:
    'You have an open quotation or procurement engagement. Close it first, then return here.',
  SUPPLIER_EARNINGS_UNSETTLED:
    'Your supplier earnings ledger still holds funds. Withdraw or settle them first.',
  ORG_OWNERSHIP_TRANSFER_REQUIRED:
    'You own an active organization. Transfer ownership before deleting your account.',
  ORG_MEMBERSHIP_TRANSFER_REQUIRED:
    'You are the owner-member of an organization. Reassign the owner role first.',
  ADMIN_NOT_SELF_DELETABLE:
    'Administrator accounts cannot be self-deleted. Please contact NEXPEC operations.',
  PLATFORM_OWNER_PROTECTED:
    'The Platform Owner account cannot be deleted.',
};

function humanizeBlockReason(message: string): string {
  const upper = message.toUpperCase();
  for (const [code, copy] of Object.entries(BLOCKED_REASONS)) {
    if (upper.includes(code)) return copy;
  }
  // Fallback: strip a leading "CODE: " prefix so raw codes never reach the user.
  return message.replace(/^[A-Z_]+:\s*/, '');
}

export function DeleteAccountFlow() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [phase, setPhase] = useState<Phase>('checking');
  const [email, setEmail] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!alive) return;
      if (user) {
        setEmail(user.email ?? null);
        // Front-line guard (2026-07-18): the request_account_deletion RPC has
        // no role restriction, so without this check a platform administrator
        // could anonymize + ban the ONLY admin login from a public page. The
        // RPC-side guard is tracked separately; this stops the accident.
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        const role = (profile?.role ?? '').toString().trim().toLowerCase();
        setPhase(
          role === 'admin' || role === 'super_admin' ? 'admin-blocked' : 'confirm',
        );
      } else {
        setPhase('signed-out');
      }
    })();
    return () => {
      alive = false;
    };
  }, [supabase]);

  const confirmed = typed.trim().toUpperCase() === 'DELETE' && acknowledged;

  async function requestDeletion() {
    if (!confirmed) return;
    setPhase('busy');
    setDetail(null);
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: {},
      });
      if (error) {
        setDetail(
          'The deletion service could not be reached. Please try again in a few minutes or contact support.',
        );
        setPhase('error');
        return;
      }
      const res = (data ?? {}) as { ok?: boolean; error?: string; code?: string };
      if (res.ok) {
        // PII is scrubbed and the login is banned server-side; clear the
        // local session cookie so the browser doesn't hold a dead token.
        // scope 'local' — a global sign-out would call GoTrue /logout with
        // the now-banned token and produce a guaranteed 403 AuthApiError
        // roundtrip; the server login is already sealed by the ban, so
        // clearing this browser's session is all that's left to do.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        setPhase('done');
        return;
      }
      setDetail(humanizeBlockReason(res.error ?? 'Deletion was declined.'));
      setPhase(res.code === 'BLOCKED' ? 'blocked' : 'error');
    } catch {
      setDetail(
        'Something went wrong while submitting the request. Please try again or contact support.',
      );
      setPhase('error');
    }
  }

  if (phase === 'checking') {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking your session…
      </div>
    );
  }

  if (phase === 'signed-out') {
    return (
      <div>
        <p className="text-sm text-zinc-400">
          You&apos;re not signed in. Sign in to your NEXPEC account to
          continue — you&apos;ll be brought straight back to this page.
        </p>
        <Link
          href={`/sign-in?next=${encodeURIComponent('/account/delete')}`}
          className="btn-primary mt-4 inline-flex items-center gap-2"
        >
          <LogIn className="h-4 w-4" />
          Sign in to continue
        </Link>
      </div>
    );
  }

  if (phase === 'admin-blocked') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
        <p className="text-sm text-amber-200">
          Platform administrator accounts can&apos;t be deleted from this
          page. Transfer or demote the account first, then retry, or handle
          it through operations tooling.
        </p>
      </div>
    );
  }

  if (phase === 'done') {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-green" />
        <div className="text-sm text-accent-green">
          <p className="font-semibold">Your account has been deleted.</p>
          <p className="mt-1 text-accent-green/90">
            Your personal data has been anonymized and your login permanently
            disabled. You&apos;ve been signed out. Legally retained records, if
            any, are kept in de-identified form as described above.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {email && (
        <p className="text-sm text-zinc-400">
          Signed in as <span className="font-mono text-zinc-200">{email}</span>.
          This is the account that will be deleted.
        </p>
      )}

      <label className="mt-4 block">
        <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
          Type DELETE to confirm
        </span>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="DELETE"
          autoComplete="off"
          disabled={phase === 'busy'}
          className="mt-2 w-full max-w-xs rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 font-mono text-sm text-white placeholder:text-zinc-600 focus:border-accent-red/60 focus:outline-none focus:ring-2 focus:ring-accent-red/30"
        />
      </label>

      <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          disabled={phase === 'busy'}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent accent-red-500"
        />
        <span>
          I understand this permanently deletes my account and personal data,
          cannot be undone, and that some records are retained in
          de-identified form where legally required.
        </span>
      </label>

      {(phase === 'blocked' || phase === 'error') && detail && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="text-sm text-amber-200">
            <p>{detail}</p>
            <p className="mt-1 text-amber-200/80">
              Need help?{' '}
              <Link
                href="/contact?channel=support&topic=account-deletion"
                className="underline hover:text-white"
              >
                Contact support
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={requestDeletion}
        disabled={!confirmed || phase === 'busy'}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent-red px-6 py-2.5 text-sm font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-accent-red/90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {phase === 'busy' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Deleting…
          </>
        ) : (
          'Permanently delete my account'
        )}
      </button>
    </div>
  );
}
