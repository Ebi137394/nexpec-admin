// ════════════════════════════════════════════════════════════════════════════
//  UserRoleMessagePanel — Command Console › Users › User detail
//
//  Two admin capabilities that sit alongside the existing moderation panel and
//  reuse its visual language:
//    ACCOUNT ROLE        correct a mis-registered account (e.g. someone who
//                        signed up as client but is an inspector)
//    ADMIN COMMUNICATION message that user directly
//
//  Neither writes to the database from the browser. Both post to server
//  actions that call SECURITY DEFINER RPCs, which re-verify nx_is_admin() and
//  enforce the privilege rules independently — the UI is a convenience, never
//  the authority.
//
//  Elevated roles (admin / super_admin) are deliberately absent from the role
//  selector: promotion is super_admin-only and is rejected by the database.
//  Messages append to the existing helpdesk_messages support thread, which the
//  already-released mobile apps read and subscribe to, so nothing here needs a
//  new mobile build. It is a support channel and opens no client↔inspector path.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { IdCard, MessageSquare, ShieldAlert } from 'lucide-react';
import {
  adminChangeUserRole,
  adminSendUserMessage,
} from '@/lib/actions/adminUserModeration';

const OPERATIONAL_ROLES = [
  'client',
  'inspector',
  'agency',
  'enterprise',
  'supplier',
  'senior',
] as const;

const ELEVATED = ['admin', 'super_admin'];

interface Props {
  userId: string;
  email: string | null;
  fullName: string | null;
  role: string | null;
  returnTo: string;
}

export function UserRoleMessagePanel({
  userId,
  email,
  fullName,
  role,
  returnTo,
}: Props) {
  const currentRole = role ?? 'unknown';
  const isElevated = ELEVATED.includes(currentRole);
  const [nextRole, setNextRole] = useState<string>('');

  const options = OPERATIONAL_ROLES.filter((r) => r !== currentRole);

  return (
    <section className="rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8">
      <header className="mb-5">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Account role &amp; communication
        </h2>
        <p className="mt-1 text-xs text-zinc-400">
          Correct a mis-registered account, or contact this user directly.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* ── ACCOUNT ROLE ── */}
        <Block
          title="Account role"
          subtitle={`Current: ${currentRole}`}
          icon={<IdCard className="h-4 w-4" strokeWidth={1.75} />}
        >
          {isElevated ? (
            <p className="rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-[11px] text-accent-amber">
              <ShieldAlert className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
              This is an administrative account. Its role can only be changed by
              a super&nbsp;admin, and not from this panel.
            </p>
          ) : (
            <details className="group rounded-xl border border-violet/20 bg-violet/[0.04]">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow">
                Change role
              </summary>
              <form action={adminChangeUserRole} className="space-y-2 p-3 pt-1">
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="returnTo" value={returnTo} />

                <p className="text-[11px] text-zinc-400">
                  Current role:{' '}
                  <span className="font-mono text-zinc-200">{currentRole}</span>
                </p>

                <select
                  name="newRole"
                  required
                  value={nextRole}
                  onChange={(e) => setNextRole(e.target.value)}
                  className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-2 py-1.5 text-xs text-white outline-none"
                >
                  <option value="">Select the correct role…</option>
                  {options.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>

                <textarea
                  name="reason"
                  rows={2}
                  maxLength={1000}
                  placeholder="Optional reason, e.g. User selected the wrong role during registration."
                  className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-2 py-1.5 text-xs text-white outline-none placeholder:text-zinc-600"
                />

                <p className="text-[11px] text-zinc-500">
                  The account, its id, jobs, documents and history are all kept.
                  The user is notified and the change is written to the audit log.
                </p>

                <button
                  type="submit"
                  disabled={!nextRole}
                  onClick={(e) => {
                    if (
                      !window.confirm(
                        `Change user role\n\nCurrent role: ${currentRole}\nNew role: ${nextRole}\n\n${
                          email ?? userId
                        } will be notified. Continue?`,
                      )
                    ) {
                      e.preventDefault();
                    }
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-violet px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                >
                  Change role
                </button>
              </form>
            </details>
          )}
        </Block>

        {/* ── ADMIN COMMUNICATION ── */}
        <Block
          title="Admin communication"
          subtitle={fullName ?? email ?? userId.slice(0, 8)}
          icon={<MessageSquare className="h-4 w-4" strokeWidth={1.75} />}
        >
          <details className="group rounded-xl border border-violet/20 bg-violet/[0.04]">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow">
              Send message
            </summary>
            <form action={adminSendUserMessage} className="space-y-2 p-3 pt-1">
              <input type="hidden" name="userId" value={userId} />
              <input type="hidden" name="returnTo" value={returnTo} />

              <p className="text-[11px] text-zinc-400">
                To:{' '}
                <span className="font-mono text-zinc-200">
                  {email ?? userId}
                </span>
              </p>

              <textarea
                name="message"
                required
                minLength={2}
                maxLength={4000}
                rows={4}
                placeholder="Hi, it looks like you may have selected the wrong account type during registration…"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-2 py-1.5 text-xs text-white outline-none placeholder:text-zinc-600"
              />

              <p className="text-[11px] text-zinc-500">
                Delivered to the user&apos;s existing Help &amp; Support thread
                in the app, where they can reply.
              </p>

              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-violet px-4 py-1.5 text-xs font-semibold text-white"
              >
                Send message
              </button>
            </form>
          </details>
        </Block>
      </div>
    </section>
  );
}

function Block({
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
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet/15 text-violet-glow ring-1 ring-violet/20">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-industrial text-zinc-200">
            {title}
          </p>
          <p className="truncate text-[11px] text-zinc-500">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
