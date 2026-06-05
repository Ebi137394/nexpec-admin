// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/account/MfaSection.tsx
//
//  Two-factor authentication enrollment + management card. Mounts on
//  /inspector/settings, /client/settings, and /admin/settings.
//
//  Flow:
//    1. Disabled  — "Enable 2FA" button → enroll() returns QR + secret
//    2. Enrolling — show QR, accept 6-digit code, challenge() + verify()
//    3. Enrolled  — show status, "Disable", "Regenerate recovery codes"
//    4. Codes     — one-time-shown plaintext, must be acknowledged
//
//  Browser-side end to end. The server helper data/mfa.ts can pass an
//  initial summary as a prop for SSR-correct first paint; the component
//  refreshes its own state from supabase.auth.mfa.listFactors() on
//  every meaningful event.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  ShieldCheck,
  Shield,
  Lock,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import type { MfaStatusSummary } from '@/lib/data/mfa';

interface Props {
  /** Optional SSR-fetched initial status. Refreshed client-side on mount. */
  initial?: MfaStatusSummary | null;
}

type EnrollState =
  | { kind: 'loading' }
  | { kind: 'disabled' }
  | {
      kind: 'enrolling';
      factorId: string;
      qrCode: string; // svg data url
      secret: string;
    }
  | { kind: 'enrolled'; factorId: string; codesRemaining: number }
  | {
      kind: 'codes';
      codes: string[];
      previousFactorId: string;
      previousCodesRemaining: number;
    };

type Banner =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | null;

export function MfaSection({ initial }: Props) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [state, setState] = useState<EnrollState>(() => {
    if (!initial) return { kind: 'loading' };
    if (initial.enrolled && initial.factor) {
      return {
        kind: 'enrolled',
        factorId: initial.factor.id,
        codesRemaining: initial.recoveryCodesRemaining,
      };
    }
    return { kind: 'disabled' };
  });
  const [code, setCode] = useState('');
  const [banner, setBanner] = useState<Banner>(null);
  const [isPending, startTransition] = useTransition();

  // Refresh state client-side on mount (handles tab re-open after sign-in
  // on a different surface, etc.). Also refresh after every action.
  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const verified = (factors?.totp ?? []).find(
        (f) => f.status === 'verified',
      );
      if (verified) {
        const remaining = await countRemainingCodes();
        setState({
          kind: 'enrolled',
          factorId: verified.id,
          codesRemaining: remaining,
        });
      } else {
        // If there's a partial (unverified) factor lying around, clear it
        // so the next enrollment starts clean.
        for (const f of factors?.totp ?? []) {
          if (f.status !== 'verified') {
            try {
              await supabase.auth.mfa.unenroll({ factorId: f.id });
            } catch {
              // ignore — best-effort cleanup
            }
          }
        }
        setState({ kind: 'disabled' });
      }
    } catch (err) {
      console.error('[MfaSection] refresh failed', err);
      setBanner({
        kind: 'error',
        message: 'Could not load 2FA status. Refresh the page.',
      });
    }
  }

  async function countRemainingCodes(): Promise<number> {
    try {
      const { count } = await supabase
        .from('auth_recovery_codes')
        .select('id', { count: 'exact', head: true })
        .is('used_at', null);
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  /* ─── Enroll ─────────────────────────────────────────────────────── */
  function onEnable() {
    setBanner(null);
    setCode('');
    startTransition(async () => {
      try {
        const { data, error } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'TOTP',
        });
        if (error || !data) throw error ?? new Error('Enroll failed.');
        setState({
          kind: 'enrolling',
          factorId: data.id,
          qrCode: data.totp.qr_code,
          secret: data.totp.secret,
        });
      } catch (err) {
        setBanner({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Could not start enrollment.',
        });
      }
    });
  }

  /* ─── Verify ─────────────────────────────────────────────────────── */
  function onVerify(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind !== 'enrolling') return;
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setBanner({
        kind: 'error',
        message: 'Enter the 6-digit code from your authenticator app.',
      });
      return;
    }
    setBanner(null);
    const { factorId } = state;
    startTransition(async () => {
      try {
        const challenge = await supabase.auth.mfa.challenge({ factorId });
        if (challenge.error || !challenge.data) {
          throw challenge.error ?? new Error('Challenge failed.');
        }
        const verify = await supabase.auth.mfa.verify({
          factorId,
          challengeId: challenge.data.id,
          code: trimmed,
        });
        if (verify.error) throw verify.error;

        // Verification succeeded — generate recovery codes.
        const { data: rcData, error: rcError } = await supabase.rpc(
          'regenerate_recovery_codes',
        );
        if (rcError) throw rcError;

        const codes = (rcData ?? []) as string[];
        const previousCodesRemaining = codes.length;
        setState({
          kind: 'codes',
          codes,
          previousFactorId: factorId,
          previousCodesRemaining,
        });
        setCode('');
        setBanner({
          kind: 'success',
          message:
            'Two-factor authentication enabled. Save your recovery codes now, they will not be shown again.',
        });
      } catch (err) {
        setBanner({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Verification failed.',
        });
      }
    });
  }

  /* ─── Cancel pending enrollment ──────────────────────────────────── */
  function onCancelEnroll() {
    if (state.kind !== 'enrolling') return;
    const { factorId } = state;
    setBanner(null);
    setCode('');
    startTransition(async () => {
      try {
        await supabase.auth.mfa.unenroll({ factorId });
      } catch {
        // ignore — refresh handles cleanup
      }
      await refresh();
    });
  }

  /* ─── Acknowledge codes ──────────────────────────────────────────── */
  function onAcknowledgeCodes() {
    if (state.kind !== 'codes') return;
    setState({
      kind: 'enrolled',
      factorId: state.previousFactorId,
      codesRemaining: state.previousCodesRemaining,
    });
    setBanner(null);
  }

  /* ─── Disable ────────────────────────────────────────────────────── */
  function onDisable() {
    if (state.kind !== 'enrolled') return;
    if (
      !window.confirm(
        'Disable two-factor authentication? Your recovery codes will be invalidated.',
      )
    ) {
      return;
    }
    const { factorId } = state;
    setBanner(null);
    startTransition(async () => {
      try {
        const { error } = await supabase.auth.mfa.unenroll({ factorId });
        if (error) throw error;
        // Invalidate remaining codes by overwriting with fresh ones and
        // then immediately discarding the response — the table only
        // stores hashes anyway. Simpler: regenerate, ignore result; the
        // old hashes are wiped by the RPC.
        try {
          await supabase.rpc('regenerate_recovery_codes');
        } catch {
          // best-effort
        }
        await refresh();
        setBanner({
          kind: 'success',
          message: 'Two-factor authentication disabled.',
        });
      } catch (err) {
        setBanner({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Could not disable 2FA.',
        });
      }
    });
  }

  /* ─── Regenerate codes (already enrolled) ────────────────────────── */
  function onRegenerate() {
    if (state.kind !== 'enrolled') return;
    if (
      !window.confirm(
        'Regenerate recovery codes? Any existing recovery codes will be invalidated.',
      )
    ) {
      return;
    }
    setBanner(null);
    startTransition(async () => {
      try {
        const { data, error } = await supabase.rpc(
          'regenerate_recovery_codes',
        );
        if (error) throw error;
        const codes = (data ?? []) as string[];
        setState({
          kind: 'codes',
          codes,
          previousFactorId: state.factorId,
          previousCodesRemaining: codes.length,
        });
      } catch (err) {
        setBanner({
          kind: 'error',
          message:
            err instanceof Error ? err.message : 'Could not regenerate codes.',
        });
      }
    });
  }

  /* ─── Render ─────────────────────────────────────────────────────── */
  return (
    <section className="rounded-2xl border border-white/[0.08] bg-ink-900/40 p-6">
      <CardHeader state={state} />
      {banner && <BannerEl banner={banner} />}

      <div className="mt-5">
        {state.kind === 'loading' && <LoadingBlock />}
        {state.kind === 'disabled' && (
          <DisabledBlock onEnable={onEnable} isPending={isPending} />
        )}
        {state.kind === 'enrolling' && (
          <EnrollingBlock
            qrCode={state.qrCode}
            secret={state.secret}
            code={code}
            setCode={setCode}
            isPending={isPending}
            onVerify={onVerify}
            onCancel={onCancelEnroll}
          />
        )}
        {state.kind === 'enrolled' && (
          <EnrolledBlock
            codesRemaining={state.codesRemaining}
            isPending={isPending}
            onDisable={onDisable}
            onRegenerate={onRegenerate}
          />
        )}
        {state.kind === 'codes' && (
          <CodesBlock
            codes={state.codes}
            onAcknowledge={onAcknowledgeCodes}
          />
        )}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function CardHeader({ state }: { state: EnrollState }) {
  const enabled = state.kind === 'enrolled' || state.kind === 'codes';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1.5">
        <p className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
          <ShieldCheck className="h-3 w-3" strokeWidth={2} />
          Account Security
        </p>
        <h3 className="font-display text-lg font-semibold text-white">
          Two-factor authentication
        </h3>
        <p className="text-sm leading-relaxed text-zinc-400">
          Adds a second sign-in step using a code from your authenticator
          app (Google Authenticator, 1Password, Authy, etc.). Highly
          recommended for any account with payout or admin permissions.
        </p>
      </div>
      <StatusPill enabled={enabled} />
    </div>
  );
}

function StatusPill({ enabled }: { enabled: boolean }) {
  const classes = enabled
    ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300'
    : 'border-white/[0.10] bg-white/[0.04] text-zinc-400';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-industrial ${classes}`}
    >
      {enabled ? (
        <ShieldCheck className="h-3 w-3" strokeWidth={2} />
      ) : (
        <Shield className="h-3 w-3" strokeWidth={2} />
      )}
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  );
}

function BannerEl({ banner }: { banner: NonNullable<Banner> }) {
  const ok = banner.kind === 'success';
  const classes = ok
    ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200'
    : 'border-rose-500/30 bg-rose-500/[0.06] text-rose-200';
  const Icon = ok ? Check : AlertTriangle;
  return (
    <div
      className={`mt-4 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${classes}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
      <p className="leading-relaxed">{banner.message}</p>
    </div>
  );
}

function LoadingBlock() {
  return (
    <div className="flex items-center gap-2 text-sm text-zinc-400">
      <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      Checking 2FA status…
    </div>
  );
}

function DisabledBlock({
  onEnable,
  isPending,
}: {
  onEnable: () => void;
  isPending: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-ink-950/40 p-4">
      <button
        type="button"
        onClick={onEnable}
        disabled={isPending}
        className="inline-flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/[0.12] px-4 py-2 text-sm font-semibold text-violet-200 transition-colors hover:border-violet-500/60 hover:bg-violet-500/[0.2] hover:text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <Lock className="h-4 w-4" strokeWidth={2} />
        )}
        Enable 2FA
      </button>
      <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
        You will scan a QR code with your authenticator app and enter a
        6-digit verification code. Recovery codes are issued at the end
        of the flow so you can sign in if you lose your device.
      </p>
    </div>
  );
}

function EnrollingBlock({
  qrCode,
  secret,
  code,
  setCode,
  isPending,
  onVerify,
  onCancel,
}: {
  qrCode: string;
  secret: string;
  code: string;
  setCode: (c: string) => void;
  isPending: boolean;
  onVerify: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  const [secretCopied, setSecretCopied] = useState(false);

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setSecretCopied(true);
      setTimeout(() => setSecretCopied(false), 1500);
    } catch {
      // clipboard may be blocked; ignore
    }
  }

  return (
    <div className="space-y-5 rounded-xl border border-white/[0.06] bg-ink-950/40 p-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
            Step 1, Scan the QR code
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
            Open your authenticator app and scan this code. It will appear
            as a new entry called &quot;NEXPEC&quot;.
          </p>
          <div
            className="mt-3 inline-flex items-center justify-center rounded-xl border border-white/[0.08] bg-white p-3"
            // The QR code is an SVG data: URL. Render with <img>.
          >
            <img
              src={qrCode}
              alt="TOTP QR code"
              className="h-44 w-44"
              width={176}
              height={176}
            />
          </div>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
            Or enter the secret manually
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-white/[0.06] bg-ink-900/60 px-2 py-1.5 font-mono text-[12px] text-zinc-300">
              {secret}
            </code>
            <button
              type="button"
              onClick={copySecret}
              className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.02] px-2 py-1.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-300 transition-colors hover:border-violet-500/30 hover:text-violet-300"
            >
              {secretCopied ? (
                <Check className="h-3 w-3" strokeWidth={2} />
              ) : (
                <Copy className="h-3 w-3" strokeWidth={2} />
              )}
              {secretCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <form onSubmit={onVerify} className="space-y-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
              Step 2, Enter the 6-digit code
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
              Type the current code shown in your authenticator app.
            </p>
          </div>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) =>
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="123456"
            className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2.5 text-center font-mono text-xl tracking-[0.5em] text-white placeholder:text-zinc-700 focus:border-violet-500/40 focus:bg-ink-950 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            disabled={isPending}
            maxLength={6}
            autoFocus
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={isPending || code.length !== 6}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/[0.12] px-4 py-2 text-sm font-semibold text-violet-200 transition-colors hover:border-violet-500/60 hover:bg-violet-500/[0.2] hover:text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending && (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              )}
              Verify and enable
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isPending}
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-200 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EnrolledBlock({
  codesRemaining,
  isPending,
  onDisable,
  onRegenerate,
}: {
  codesRemaining: number;
  isPending: boolean;
  onDisable: () => void;
  onRegenerate: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-ink-950/40 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-zinc-300">
            Two-factor authentication is{' '}
            <span className="font-semibold text-emerald-300">active</span>.
            You will be asked for a 6-digit code on every new sign-in.
          </p>
          <p className="mt-1 text-[11px] text-zinc-500">
            <span className="font-semibold text-zinc-300">
              {codesRemaining}
            </span>{' '}
            recovery code{codesRemaining === 1 ? '' : 's'} remaining.
            {codesRemaining < 3 &&
              ' Consider regenerating, you should keep at least three on hand.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-violet-500/40 hover:bg-violet-500/[0.08] hover:text-violet-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Regenerate codes
          </button>
          <button
            type="button"
            onClick={onDisable}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.08] px-3 py-2 text-sm font-semibold text-rose-200 transition-colors hover:border-rose-500/60 hover:bg-rose-500/[0.16] hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Disable
          </button>
        </div>
      </div>
    </div>
  );
}

function CodesBlock({
  codes,
  onAcknowledge,
}: {
  codes: string[];
  onAcknowledge: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 1500);
    } catch {
      // clipboard may be blocked
    }
  }

  function downloadCodes() {
    const blob = new Blob(
      [
        'NEXPEC recovery codes\n',
        'Generated ' + new Date().toISOString() + '\n',
        '\n',
        ...codes.map((c) => c + '\n'),
        '\n',
        'Each code may be used ONCE if you lose access to your authenticator.\n',
        'Keep this file somewhere safe (password manager, encrypted backup).\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nexpec-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-5">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-industrial text-amber-300">
          Recovery codes, save now
        </p>
        <p className="mt-1 text-sm leading-relaxed text-zinc-300">
          These are your only way back in if you lose access to your
          authenticator. Each code can be used once. They will not be
          shown again.
        </p>
      </div>

      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {codes.map((code, i) => (
          <li
            key={code}
            className="rounded-md border border-white/[0.06] bg-ink-950/60 px-2.5 py-1.5 text-center font-mono text-[13px] text-zinc-100"
          >
            <span className="mr-1.5 font-mono text-[10px] text-zinc-500">
              {String(i + 1).padStart(2, '0')}
            </span>
            {code}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copyAll}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-violet-500/40 hover:text-violet-200"
        >
          {copiedAll ? (
            <Check className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Copy className="h-4 w-4" strokeWidth={2} />
          )}
          {copiedAll ? 'Copied' : 'Copy all'}
        </button>
        <button
          type="button"
          onClick={downloadCodes}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm font-semibold text-zinc-200 transition-colors hover:border-violet-500/40 hover:text-violet-200"
        >
          Save as .txt
        </button>
      </div>

      <label className="flex items-start gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-white/[0.18] bg-ink-900 text-violet-500 focus:ring-violet-500/40"
        />
        <span>
          I have saved my recovery codes in a secure location (password
          manager, encrypted file, or printed and stored offline).
        </span>
      </label>

      <button
        type="button"
        onClick={onAcknowledge}
        disabled={!acknowledged}
        className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/[0.12] px-4 py-2 text-sm font-semibold text-violet-200 transition-colors hover:border-violet-500/60 hover:bg-violet-500/[0.2] hover:text-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Done
      </button>
    </div>
  );
}
