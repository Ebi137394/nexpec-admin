// ════════════════════════════════════════════════════════════════════════════
//  app/client/team/page.tsx — read-only roster + pending invitations
//
//  Multi-role: client / agency / enterprise. Shows the caller's first org
//  (most B2B users belong to one). Invitations are provisioned by NEXPEC via
//  the admin console — there is no self-serve invite/revoke flow here.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Users,
  CheckCircle2,
  AlertCircle,
  Building2,
  Clock,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchMyOrganizations,
  fetchMembersOfOrg,
  fetchInvitationsOfOrg,
} from '@/lib/data/clientTeam';
import { ORG_MEMBER_ROLE_LABELS } from '@/lib/data/clientTeam.types';

export const metadata: Metadata = { title: 'Team' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{
    error?: string;
    invited?: string;
    revoked?: string;
    joined?: string;
    org?: string;
  }>;
}

export default async function ClientTeamPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/client/team'));

  const orgs = await fetchMyOrganizations();

  if (orgs.length === 0) {
    return (
      <div className="space-y-6">
        <header>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Client Portal, Team
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Team management
          </h1>
        </header>
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <Building2 className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-zinc-300">
            You&apos;re not in an organization yet.
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Solo accounts don&apos;t need this page. If you&apos;re onboarding an
            enterprise or agency, contact support to provision your org.
          </p>
          <Link
            href="/contact"
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/20"
          >
            Talk to support
          </Link>
        </div>
      </div>
    );
  }

  // TypeScript's `length === 0` early return doesn't narrow the array type,
  // so we resolve the selected org in two safe steps:
  //   1. If the search param `org` matches a row, prefer it.
  //   2. Otherwise fall back to the first org.
  // Both branches use safe operators, then a defensive null-check fully
  // narrows `org` for the rest of the function.
  const requestedOrg = sp.org
    ? orgs.find((o) => o.id === sp.org) ?? null
    : null;
  const org = requestedOrg ?? orgs[0];
  if (!org) {
    // Unreachable in practice — we returned the empty-state above when
    // orgs.length === 0 — but TypeScript needs this to narrow `org`.
    return null;
  }
  const [members, invitations] = await Promise.all([
    fetchMembersOfOrg(org.id),
    fetchInvitationsOfOrg(org.id),
  ]);
  const pendingInvites = invitations.filter((i) => i.status === 'pending');

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Client Portal, Team
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            {org.name}
          </h1>
          <p className="mt-1 text-xs uppercase tracking-industrial text-zinc-500">
            {org.kind === 'enterprise' ? 'Enterprise' : 'Agency'}, {members.length}{' '}
            {members.length === 1 ? 'member' : 'members'},{' '}
            {pendingInvites.length} pending
          </p>
        </div>
        {orgs.length > 1 && (
          <form method="GET" action="/client/team" className="flex items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                Org
              </span>
              <select
                name="org"
                defaultValue={org.id}
                className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
              >
                {orgs.map((o) => (
                  <option key={o.id} value={o.id} className="bg-ink-900">
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-full bg-violet/15 px-4 py-2 text-xs font-semibold text-violet-glow ring-1 ring-violet/30 hover:bg-violet/25"
            >
              Switch
            </button>
          </form>
        )}
      </header>

      {sp.error && (
        <Banner tone="error">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {sp.error}
        </Banner>
      )}
      {sp.invited && (
        <Banner tone="ok">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Invitation sent.
        </Banner>
      )}
      {sp.revoked && (
        <Banner tone="ok">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Invitation revoked.
        </Banner>
      )}
      {sp.joined && (
        <Banner tone="ok">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          You joined the organization.
        </Banner>
      )}

      {/* Members */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Members
        </h2>
        <ul className="mt-4 divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 px-4 py-3 sm:px-5"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet/30 to-cyan-glow/30 ring-1 ring-white/10">
                <Users className="h-4 w-4 text-white" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {m.userLabel ?? m.userEmail ?? m.userId.slice(0, 8)}
                </p>
                <p className="truncate text-[11px] text-zinc-500">
                  {m.userEmail ?? 'no email'},{' '}
                  {ORG_MEMBER_ROLE_LABELS[m.role]}, joined{' '}
                  {new Date(m.createdAt).toLocaleDateString()}
                </p>
              </div>
              {m.userId === user.id && (
                <span className="rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                  You
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <section>
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Pending invitations ({pendingInvites.length})
          </h2>
          <ul className="mt-4 divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
            {pendingInvites.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-amber/10 text-accent-amber ring-1 ring-inset ring-accent-amber/30">
                  <Clock className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">
                    {inv.email}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {ORG_MEMBER_ROLE_LABELS[inv.role]}, expires{' '}
                    {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Invitations are managed by NEXPEC */}
      <p className="text-[11px] text-zinc-500">
        Team invitations are handled by NEXPEC — contact support or your
        account manager to add or remove teammates.
      </p>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'ok';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'error'
      ? 'border-accent-red/40 bg-accent-red/10 text-accent-red'
      : 'border-accent-green/40 bg-accent-green/10 text-accent-green';
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${cls}`}>
      {children}
    </div>
  );
}
