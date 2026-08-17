'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  X,
  Mail,
  UserPlus,
  Pencil,
  Trash2,
  Link2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {
  ORG_MEMBER_ROLES,
  type OrgMemberRole,
} from '@nexpec/shared-core';
import {
  inviteOrgMember,
  updateOrgMemberRole,
  removeOrgMember,
} from '@/lib/actions/organizations';
// Values live outside the 'use server' module — see lib/actions/dispatchState.ts.
import {
  inviteMemberInitialState,
  updateRoleInitialState,
  removeMemberInitialState,
  type InviteMemberActionState,
  type UpdateRoleActionState,
  type RemoveMemberActionState,
} from '@/lib/actions/organizationsState';
// ★ Import from the types-only modules — keeps the Client bundle free of
//   next/headers (the server.ts import chain) which would otherwise break
//   the build with "module needs next/headers" on `yarn build`.
import type { OrgMember, OrgInvitation } from '@/lib/data/orgMembers.types';
import type { AdminOrg } from '@/lib/data/organizations.types';
import { cn } from '@/lib/cn';

interface Props {
  org: AdminOrg | null;
  members: OrgMember[];
  invitations: OrgInvitation[];
}

type Tab = 'members' | 'invite';

export function OrgMembersDrawer({ org, members, invitations }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const searchParams = useSearchParams();
  const open = !!org;

  const [tab, setTab] = useState<Tab>('members');
  useEffect(() => {
    setTab(members.length === 0 ? 'invite' : 'members');
  }, [org?.id, members.length]);

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
    next.delete('orgId');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <AnimatePresence>
      {open && org && (
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
            aria-labelledby="org-drawer-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-white/[0.06] bg-ink-950 shadow-[-30px_0_60px_-30px_rgba(0,0,0,0.8)]"
          >
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-6 py-5">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
                  Organization
                </p>
                <h2
                  id="org-drawer-title"
                  className="mt-1 truncate font-display text-lg font-semibold tracking-tight text-white"
                >
                  {org.name}
                </h2>
                <p className="mt-1 truncate text-xs text-zinc-500">
                  {org.kind},{' '}
                  <span className="font-mono">
                    {members.length} member{members.length === 1 ? '' : 's'}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-zinc-400 transition-colors hover:border-white/30 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            {/* Tab bar */}
            <div className="flex border-b border-white/[0.06] px-2">
              <TabButton active={tab === 'members'} onClick={() => setTab('members')}>
                Members ({members.length})
              </TabButton>
              <TabButton active={tab === 'invite'} onClick={() => setTab('invite')}>
                Invite by email
              </TabButton>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {tab === 'members' ? (
                <MembersTab members={members} invitations={invitations} />
              ) : (
                <InviteTab orgId={org.id} />
              )}
            </div>

            <footer className="border-t border-white/[0.06] px-6 py-3">
              <p className="font-mono text-[10px] tracking-wider text-zinc-600">
                rpc, admin_invite_org_member, admin_update_org_member_role, admin_remove_org_member
              </p>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────────────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative px-4 py-3 text-sm font-medium transition-colors',
        active ? 'text-white' : 'text-zinc-500 hover:text-zinc-300',
      )}
    >
      {children}
      {active && (
        <span className="absolute inset-x-2 -bottom-px h-px bg-gradient-to-r from-transparent via-violet to-transparent" />
      )}
    </button>
  );
}

/* ── MEMBERS TAB ───────────────────────────────────────────────────── */

function MembersTab({
  members,
  invitations,
}: {
  members: OrgMember[];
  invitations: OrgInvitation[];
}) {
  return (
    <div className="space-y-6">
      {members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
          <p className="font-display text-sm font-semibold text-white">
            No members yet.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Use the Invite tab above to issue the first seat.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
        </ul>
      )}

      {invitations.length > 0 && (
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            Outstanding invitations
          </p>
          <ul className="space-y-2">
            {invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm text-zinc-200">{inv.email}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-industrial text-zinc-500">
                    <span>role, {inv.role}</span>
                    <span>·</span>
                    <span
                      className={cn(
                        inv.status === 'pending' && 'text-accent-amber',
                        inv.status === 'accepted' && 'text-accent-green',
                        inv.status === 'revoked' && 'text-zinc-500',
                      )}
                    >
                      {inv.status}
                    </span>
                  </p>
                </div>
                {inv.expires_at && (
                  <p className="font-mono text-[10px] text-zinc-500">
                    expires {new Date(inv.expires_at).toISOString().slice(0, 10)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function MemberRow({ member }: { member: OrgMember }) {
  const [mode, setMode] = useState<'view' | 'edit' | 'remove'>('view');

  if (mode === 'edit') {
    return <EditMemberForm member={member} onDone={() => setMode('view')} />;
  }
  if (mode === 'remove') {
    return <RemoveMemberForm member={member} onDone={() => setMode('view')} />;
  }

  return (
    <li className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet to-cyan-glow text-[11px] font-semibold text-white">
        {initials(member.user_name ?? member.user_email ?? '?')}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white">
          {member.user_name ?? member.user_email ?? member.user_id}
        </p>
        <p className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-industrial text-zinc-500">
          <span>{member.role.replace('_', ' ')}</span>
          {member.user_email && member.user_name && (
            <>
              <span>·</span>
              <span className="font-mono normal-case text-zinc-500">{member.user_email}</span>
            </>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode('edit')}
          className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-zinc-400 hover:border-violet/40 hover:text-white"
          aria-label="Change role"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setMode('remove')}
          className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-zinc-400 hover:border-accent-red/40 hover:text-accent-red"
          aria-label="Remove member"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function EditMemberForm({
  member,
  onDone,
}: {
  member: OrgMember;
  onDone: () => void;
}) {
  const [role, setRole] = useState<OrgMemberRole>(
    (ORG_MEMBER_ROLES as readonly string[]).includes(member.role)
      ? (member.role as OrgMemberRole)
      : 'viewer',
  );
  const [state, formAction] = useActionState<UpdateRoleActionState, FormData>(
    updateOrgMemberRole,
    updateRoleInitialState,
  );
  useEffect(() => {
    if (state.ok) setTimeout(onDone, 800);
  }, [state.ok]);

  return (
    <li className="rounded-xl border border-violet/40 bg-violet/[0.06] px-4 py-3">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="memberId" value={member.id} />
        <p className="text-sm font-medium text-white">
          Change role, {member.user_name ?? member.user_email ?? '—'}
        </p>
        <select
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value as OrgMemberRole)}
          className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white focus:border-violet/60 focus:outline-none"
        >
          {ORG_MEMBER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r.replace('_', ' ')}
            </option>
          ))}
        </select>
        {state.error && (
          <p className="text-xs text-accent-red">{state.error}</p>
        )}
        <div className="flex items-center gap-2">
          <SubmitPill>Save</SubmitPill>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}

function RemoveMemberForm({
  member,
  onDone,
}: {
  member: OrgMember;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [state, formAction] = useActionState<RemoveMemberActionState, FormData>(
    removeOrgMember,
    removeMemberInitialState,
  );
  useEffect(() => {
    if (state.ok) setTimeout(onDone, 800);
  }, [state.ok]);

  return (
    <li className="rounded-xl border border-accent-red/40 bg-accent-red/[0.06] px-4 py-3">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="memberId" value={member.id} />
        <p className="text-sm font-medium text-white">
          Remove, {member.user_name ?? member.user_email ?? '—'}
        </p>
        <textarea
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          maxLength={1000}
          rows={2}
          placeholder="Reason (audit-captured)"
          className="w-full resize-none rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-accent-red/60 focus:outline-none"
        />
        {state.error && (
          <p className="text-xs text-accent-red">{state.error}</p>
        )}
        <div className="flex items-center gap-2">
          <SubmitPill destructive>Remove</SubmitPill>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}

/* ── INVITE TAB ────────────────────────────────────────────────────── */

function InviteTab({ orgId }: { orgId: string }) {
  const [role, setRole] = useState<OrgMemberRole>('viewer');
  const [state, formAction] = useActionState<InviteMemberActionState, FormData>(
    inviteOrgMember,
    inviteMemberInitialState,
  );

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="orgId" value={orgId} />

      <label className="block">
        <span className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
          <Mail className="h-3 w-3" />
          Email
        </span>
        <input
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="member@company.com"
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
        />
      </label>

      <fieldset>
        <legend className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
          Seat role
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {ORG_MEMBER_ROLES.map((r) => (
            <label
              key={r}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                role === r
                  ? 'border-violet/60 bg-violet/15 text-white ring-1 ring-inset ring-violet/30'
                  : 'border-white/10 bg-white/[0.02] text-zinc-300 hover:border-white/25',
              )}
            >
              <input
                type="radio"
                name="role"
                value={r}
                checked={role === r}
                onChange={() => setRole(r)}
                className="sr-only"
              />
              <span className="capitalize">{r.replace('_', ' ')}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.error && (
        <div className="flex items-start gap-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2.5 text-sm text-accent-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{state.error}</p>
        </div>
      )}

      {state.ok && state.invited && (
        <div className="space-y-3 rounded-2xl border border-accent-green/40 bg-accent-green/10 p-4">
          <div className="flex items-center gap-2 text-sm text-white">
            <CheckCircle2 className="h-4 w-4 text-accent-green" />
            Invitation issued for{' '}
            <span className="font-mono text-accent-green">{state.invited.email}</span>{' '}
            as <span className="font-mono">{state.invited.role}</span>.
          </div>
          {state.invited.correlation_id && (
            <Link
              href={`/admin/audit?correlationId=${state.invited.correlation_id}`}
              className="inline-flex items-center gap-1.5 text-xs text-violet-glow hover:text-white"
            >
              <Link2 className="h-3 w-3" />
              View in Audit Trail
            </Link>
          )}
        </div>
      )}

      <InviteSubmit />

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Re-inviting an email that was previously revoked resets the row to{' '}
        <span className="font-mono">pending</span> with a fresh 14-day expiry.
      </p>
    </form>
  );
}

function InviteSubmit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary group w-full justify-center disabled:opacity-60 disabled:hover:bg-violet disabled:hover:shadow-glow"
    >
      <UserPlus className="h-4 w-4" />
      {pending ? 'Issuing invitation…' : 'Issue invitation'}
    </button>
  );
}

function SubmitPill({
  children,
  destructive,
}: {
  children: React.ReactNode;
  destructive?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
        destructive
          ? 'border border-accent-red/40 bg-accent-red/15 text-accent-red hover:bg-accent-red/25'
          : 'border border-violet/40 bg-violet/15 text-violet-glow hover:bg-violet/25',
      )}
    >
      {pending ? 'Saving…' : children}
    </button>
  );
}

function initials(s: string): string {
  const parts = s.trim().split(/\s+|@|\./).filter(Boolean);
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}
