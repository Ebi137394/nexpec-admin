// ════════════════════════════════════════════════════════════════════════════
//  app/(auth)/reset-password/page.tsx — set a new password (recovery link)
//
//  Client-side: the Supabase browser client (detectSessionInUrl, default on)
//  exchanges the recovery code from the emailed link for a session shortly
//  after hydration. Once a session exists we let the user set a new password
//  via supabase.auth.updateUser. No session after a grace period → the link
//  is dead, so point back at /forgot-password.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthField } from '@/components/auth/AuthField';

type Phase = 'checking' | 'ready' | 'saving' | 'done' | 'expired';

export default function ResetPasswordPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [phase, setPhase] = useState<Phase>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The recovery-code exchange can land after our first check, so listen
    // for the session as well as reading it, and only declare the link dead
    // after a grace period.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setPhase((p) => (p === 'checking' || p === 'expired' ? 'ready' : p));
      }
    });
    let cancelled = false;

    // Two shapes can legitimately land here, and only one is the common case:
    //
    //  1. PKCE (the emailed link). /auth/callback already exchanged ?code= on
    //     the SERVER and wrote the auth cookies, so getSession() below finds a
    //     session immediately. This is the path requestPasswordReset now uses.
    //
    //  2. IMPLICIT (#access_token=…&type=recovery). Admin-generated links
    //     (auth.admin.generateLink) still come back this way — verified against
    //     Staging — and a fragment is NEVER sent to the server, so no callback
    //     can help. createBrowserClient pins flowType:'pkce', so it does not
    //     adopt an implicit hash on its own; we do it explicitly here.
    //
    // Reading the hash and then clearing it keeps the tokens out of history,
    // out of any later Referer header, and out of anything that logs the URL.
    async function adoptImplicitHash() {
      if (typeof window === 'undefined') return;
      const raw = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.hash;
      if (!raw) return;
      const p = new URLSearchParams(raw);
      const access_token = p.get('access_token');
      const refresh_token = p.get('refresh_token');
      if (!access_token || !refresh_token) return;
      const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      if (setErr && !cancelled) {
        setError(setErr.message);
        setPhase('expired');
      }
    }

    void adoptImplicitHash().then(() =>
      supabase.auth.getSession().then(({ data }) => {
        if (!cancelled && data.session) {
          setPhase((p) => (p === 'checking' ? 'ready' : p));
        }
      }),
    );
    const timer = setTimeout(() => {
      if (!cancelled) setPhase((p) => (p === 'checking' ? 'expired' : p));
    }, 3500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    // Mirror the sign-up password policy (SignUpSchema in lib/auth/actions).
    if (password.length < 10) {
      setError('Use at least 10 characters.');
      return;
    }
    if (password.length > 72) {
      setError('Password is too long.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setPhase('saving');

    // Never claim success without a real recovery session. updateUser() would
    // otherwise fail with a confusing auth error, or — worse — appear to
    // succeed against some unrelated session.
    const { data: pre } = await supabase.auth.getSession();
    if (!pre.session) {
      setError('That reset link is no longer valid. Request a fresh one.');
      setPhase('expired');
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      // Surface the real reason (weak password, reused link, expired session).
      setError(updateError.message);
      setPhase('ready');
      return;
    }

    // Success. Burn the recovery session so the emailed link cannot be reused
    // and no half-authenticated session is left behind, then send them to
    // sign-in to authenticate with the password they just chose.
    await supabase.auth.signOut();
    setPhase('done');
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle="Set a new password for your NEXPEC account."
    >
      {phase === 'checking' && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin text-violet-glow" />
          Verifying your reset link…
        </div>
      )}

      {phase === 'expired' && (
        <div className="space-y-6">
          <p className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs leading-relaxed text-accent-red">
            That reset link has expired or was already used. Request a fresh
            one and try again.
          </p>
          <Link href="/forgot-password" className="btn-primary w-full justify-center">
            Request a new link
          </Link>
        </div>
      )}

      {phase === 'done' && (
        <div className="space-y-6">
          <p className="rounded-lg border border-violet/30 bg-violet/10 px-3 py-2 text-xs leading-relaxed text-violet-glow">
            Password updated. Use it the next time you sign in.
          </p>
          <Link href="/sign-in" className="btn-primary w-full justify-center">
            Continue to sign in
          </Link>
        </div>
      )}

      {(phase === 'ready' || phase === 'saving') && (
        <form onSubmit={onSubmit} className="space-y-4">
          <AuthField
            label="New password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            placeholder="••••••••••"
            hint="At least 10 characters."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <AuthField
            label="Confirm password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            placeholder="••••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          {error && (
            <p className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
              {error}
            </p>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={phase === 'saving'}
              className="btn-primary w-full justify-center disabled:opacity-60"
            >
              {phase === 'saving' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Working…</span>
                </>
              ) : (
                'Update password'
              )}
            </button>
          </div>
        </form>
      )}
    </AuthCard>
  );
}
