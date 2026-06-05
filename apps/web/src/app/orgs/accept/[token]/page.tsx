// ════════════════════════════════════════════════════════════════════════════
//  app/orgs/accept/[token]/page.tsx — accept an organization invitation
//
//  Public route (anyone with the token URL can land). If they're not signed
//  in, we redirect to /sign-in with a `next` back to this page. If they
//  sign in with a different email than the invited one, the RPC raises
//  "email mismatch" and we display a friendly error.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  Building2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Mail,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchInvitationByToken } from '@/lib/data/clientTeam';
import { acceptOrgInvitation } from '@/lib/actions/clientTeam';
import { ORG_MEMBER_ROLE_LABELS } from '@/lib/data/clientTeam.types';

export const metadata: Metadata = { title: 'Accept invitation, NEXPEC' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ error?: string }>;
}

export default async function AcceptInvitePage({ params, searchParams }: PageProps) {
  const { token } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const invitation = await fetchInvitationByToken(token);

  // Resolve the org name (only if invitation exists)
  let orgName: string | null = null;
  if (invitation) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', invitation.orgId)
      .maybeSingle();
    orgName = (org as { name?: string | null } | null)?.name ?? null;
  }

  return (
    <main className="container-narrow py-16 sm:py-24">
      <header className="text-center">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
          <Building2 className="h-6 w-6" strokeWidth={1.5} />
        </span>
        <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Organization invitation
        </h1>
      </header>

      <section className="mx-auto mt-10 max-w-xl">
        {!invitation ? (
          <Card tone="error">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Invitation not found.</p>
              <p className="mt-1 text-xs">
                The link may be wrong, or the invitation was revoked.
              </p>
            </div>
          </Card>
        ) : invitation.revokedAt ? (
          <Card tone="error">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Invitation revoked.</p>
              <p className="mt-1 text-xs">
                The org owner cancelled this invitation. Ask them to send a new one.
              </p>
            </div>
          </Card>
        ) : invitation.acceptedAt ? (
          <Card tone="ok">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Already accepted.</p>
              <p className="mt-1 text-xs">
                You joined this organization on{' '}
                {new Date(invitation.acceptedAt).toLocaleDateString()}.
              </p>
              <Link
                href="/client/team"
                className="mt-3 inline-flex rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/20"
              >
                Go to /client/team
              </Link>
            </div>
          </Card>
        ) : new Date(invitation.expiresAt) < new Date() ? (
          <Card tone="error">
            <Clock className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Invitation expired.</p>
              <p className="mt-1 text-xs">
                This link expired on{' '}
                {new Date(invitation.expiresAt).toLocaleDateString()}. Ask the
                org owner to send a fresh invite.
              </p>
            </div>
          </Card>
        ) : !user ? (
          <Card tone="info">
            <Mail className="h-5 w-5 shrink-0" />
            <div className="w-full">
              <p className="font-semibold">
                You&apos;ve been invited to {orgName ?? 'an organization'}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                Role: <span className="text-violet-glow">{ORG_MEMBER_ROLE_LABELS[invitation.invitedRole]}</span>
                {', '}invited as{' '}
                <span className="font-mono text-violet-glow">{invitation.invitedEmail}</span>
              </p>
              <p className="mt-3 text-xs">
                Sign in (or sign up) with the invited email to accept.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/sign-in?next=${encodeURIComponent(`/orgs/accept/${token}`)}`}
                  className="inline-flex items-center gap-2 rounded-full bg-violet px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-white hover:bg-violet/90"
                >
                  Sign in
                </Link>
                <Link
                  href={`/sign-up?next=${encodeURIComponent(`/orgs/accept/${token}`)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-200 hover:border-violet/40 hover:text-white"
                >
                  Sign up
                </Link>
              </div>
            </div>
          </Card>
        ) : (
          <Card tone="info">
            <Building2 className="h-5 w-5 shrink-0" />
            <div className="w-full">
              <p className="font-semibold">Confirm to join {orgName ?? 'this organization'}</p>
              <p className="mt-1 text-xs text-zinc-400">
                Role: <span className="text-violet-glow">{ORG_MEMBER_ROLE_LABELS[invitation.invitedRole]}</span>
                {', '}invited as{' '}
                <span className="font-mono text-violet-glow">{invitation.invitedEmail}</span>
              </p>
              {user.email?.toLowerCase() !== invitation.invitedEmail.toLowerCase() && (
                <p className="mt-3 rounded-lg border border-accent-amber/30 bg-accent-amber/10 p-3 text-[11px] text-accent-amber">
                  You&apos;re signed in as <span className="font-mono">{user.email}</span>{' '}
                  but the invitation is for{' '}
                  <span className="font-mono">{invitation.invitedEmail}</span>.
                  The accept action will fail. Sign out and sign back in with
                  the correct address.
                </p>
              )}
              {sp.error && (
                <p className="mt-3 rounded-lg border border-accent-red/30 bg-accent-red/10 p-3 text-[11px] text-accent-red">
                  {sp.error}
                </p>
              )}
              <form action={acceptOrgInvitation} className="mt-4">
                <input type="hidden" name="token" value={token} />
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-violet/90"
                >
                  <CheckCircle2 className="h-3 w-3" strokeWidth={1.75} />
                  Accept and join
                </button>
              </form>
            </div>
          </Card>
        )}
      </section>
    </main>
  );
}

function Card({
  tone,
  children,
}: {
  tone: 'error' | 'ok' | 'info';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'error'
      ? 'border-accent-red/30 bg-accent-red/10 text-accent-red'
      : tone === 'ok'
        ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
        : 'border-white/[0.08] bg-white/[0.02] text-zinc-200';
  return (
    <div className={`flex items-start gap-3 rounded-3xl border p-6 ${cls}`}>
      {children}
    </div>
  );
}
