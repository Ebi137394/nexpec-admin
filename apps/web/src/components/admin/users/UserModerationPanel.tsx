// ════════════════════════════════════════════════════════════════════════════
//  components/admin/users/UserModerationPanel.tsx
//
//  Admin-only mutation card on the user detail page. Four actions, each in
//  its own form so each can carry its own hidden fields + Zod validation
//  cleanly:
//
//    1. Verify (status = verified)
//    2. Mark pending / Reject (status with reason)
//    3. Suspend / Unsuspend (reason required to suspend)
//    4. Send password reset email
//
//  Each action redirects back to `returnTo` with ?saved=... or ?error=...
//  The parent page (admin/users/[id]/page.tsx) renders the flash banner.
// ════════════════════════════════════════════════════════════════════════════

import {
  ShieldCheck,
  ShieldAlert,
  Ban,
  Send,
  UserCheck,
  Clock,
  KeyRound,
} from 'lucide-react';
import {
  adminVerifyUser,
  adminSuspendUser,
  adminUnsuspendUser,
  adminSendPasswordReset,
} from '@/lib/actions/adminUserModeration';

interface Props {
  userId: string;
  email: string | null;
  role: string | null;
  verificationStatus: string | null;
  currentStatus: string | null; // active / suspended / etc.
  suspensionReason: string | null;
  returnTo: string;
}

export function UserModerationPanel({
  userId,
  email,
  role,
  verificationStatus,
  currentStatus,
  suspensionReason,
  returnTo,
}: Props) {
  const isSuspended = currentStatus === 'suspended';
  const isSuperAdmin = role === 'super_admin' || role === 'admin';

  return (
    <section className="rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8">
      <header className="mb-5">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Admin actions
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Moderation tools. Every action calls a SECURITY DEFINER RPC that
          re-verifies admin scope at the DB layer, emits a notification to
          the affected user, and is captured in audit_events.
        </p>
      </header>

      {isSuperAdmin && (
        <div className="mb-5 rounded-2xl border border-accent-amber/30 bg-accent-amber/10 p-3 text-xs text-accent-amber">
          This user is a <span className="font-semibold">super_admin</span>,
          suspend / verify actions on this account are blocked at the DB
          layer for safety.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* ─── Verification ──────────────────────────────────────── */}
        <ActionCard
          title="Verification"
          subtitle={`Current: ${verificationStatus ?? 'unverified'}`}
          icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />}
        >
          {/* Verify */}
          <form action={adminVerifyUser} className="space-y-2">
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="status" value="verified" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button
              type="submit"
              disabled={verificationStatus === 'verified' || isSuperAdmin}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent-green/15 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-accent-green ring-1 ring-accent-green/30 transition-colors hover:bg-accent-green/25 disabled:opacity-50"
            >
              <UserCheck className="h-3 w-3" strokeWidth={1.75} />
              Mark verified
            </button>
          </form>

          {/* Mark pending */}
          <form action={adminVerifyUser} className="space-y-2">
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="status" value="pending" />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button
              type="submit"
              disabled={verificationStatus === 'pending' || isSuperAdmin}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-cyan-glow/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-cyan-glow ring-1 ring-cyan-glow/30 transition-colors hover:bg-cyan-glow/20 disabled:opacity-50"
            >
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              Mark pending
            </button>
          </form>

          {/* Reject (with reason) */}
          <details className="group rounded-xl border border-accent-red/20 bg-accent-red/[0.04]">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-industrial text-accent-red">
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="h-3 w-3" strokeWidth={1.75} />
                Reject with reason
              </span>
            </summary>
            <form action={adminVerifyUser} className="space-y-2 p-3 pt-1">
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="status" value="rejected" />
              <input type="hidden" name="returnTo" value={returnTo} />
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={1000}
                rows={3}
                placeholder="Why is verification being rejected? (min 5 chars)"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-2 py-1.5 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-accent-red/40"
              />
              <button
                type="submit"
                disabled={isSuperAdmin}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent-red px-4 py-1.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-accent-red/90 disabled:opacity-50"
              >
                Reject
              </button>
            </form>
          </details>
        </ActionCard>

        {/* ─── Suspension ────────────────────────────────────────── */}
        <ActionCard
          title="Account access"
          subtitle={`Current: ${currentStatus ?? 'active'}`}
          icon={<Ban className="h-4 w-4" strokeWidth={1.75} />}
        >
          {isSuspended ? (
            <>
              {suspensionReason && (
                <p className="rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-[11px] text-accent-amber">
                  Suspension reason: {suspensionReason}
                </p>
              )}
              <form action={adminUnsuspendUser}>
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent-green/15 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-accent-green ring-1 ring-accent-green/30 transition-colors hover:bg-accent-green/25"
                >
                  <UserCheck className="h-3 w-3" strokeWidth={1.75} />
                  Unsuspend account
                </button>
              </form>
            </>
          ) : (
            <details className="group rounded-xl border border-accent-red/20 bg-accent-red/[0.04]">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-industrial text-accent-red">
                <span className="inline-flex items-center gap-2">
                  <Ban className="h-3 w-3" strokeWidth={1.75} />
                  Suspend account
                </span>
              </summary>
              <form action={adminSuspendUser} className="space-y-2 p-3 pt-1">
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={1000}
                  rows={3}
                  placeholder="Reason for suspension (min 5 chars). Visible to the user."
                  className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-2 py-1.5 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-accent-red/40"
                />
                <button
                  type="submit"
                  disabled={isSuperAdmin}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent-red px-4 py-1.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-accent-red/90 disabled:opacity-50"
                >
                  Suspend now
                </button>
              </form>
            </details>
          )}
        </ActionCard>
      </div>

      {/* ─── Password reset (full row) ─────────────────────────── */}
      <div className="mt-4">
        <ActionCard
          title="Password reset"
          subtitle={email ? `Email to ${email}` : 'No email on file'}
          icon={<KeyRound className="h-4 w-4" strokeWidth={1.75} />}
        >
          <form action={adminSendPasswordReset}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <button
              type="submit"
              disabled={!email}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-violet/15 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow ring-1 ring-violet/30 transition-colors hover:bg-violet/25 disabled:opacity-50 sm:w-auto"
            >
              <Send className="h-3 w-3" strokeWidth={1.75} />
              Send password reset email
            </button>
          </form>
          <p className="mt-2 text-[11px] text-zinc-500">
            Uses Supabase&apos;s <code className="font-mono text-zinc-400">auth.resetPasswordForEmail</code>{' '}
            with the SERVICE_ROLE_KEY. The user receives a recovery link
            redirecting to <code className="font-mono text-zinc-400">/auth/callback</code>.
          </p>
        </ActionCard>
      </div>
    </section>
  );
}

function ActionCard({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-industrial text-zinc-200">
            {title}
          </p>
          <p className="text-[11px] text-zinc-500">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
