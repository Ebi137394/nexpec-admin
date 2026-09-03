// ════════════════════════════════════════════════════════════════════════════
//  Command Console › Users › Incomplete profiles
//
//  The backend for this shipped in b76c14b (nx_profile_missing_fields, the
//  reminder ledger, the automatic nudge); what was missing was any way for an
//  admin to SEE who needs chasing. This page is that view.
//
//  The list is computed live by admin_list_incomplete_profiles(), so a user
//  drops off the moment their profile is complete — there is no cached flag to
//  go stale. Admin-only is enforced inside the RPC, not just by this route.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RequestCompletionButton } from '@/components/admin/users/RequestCompletionButton';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Incomplete profiles, Admin' };

const ROLES = ['client', 'inspector', 'agency', 'enterprise', 'supplier'] as const;

const FIELD_LABELS: Record<string, string> = {
  full_name: 'full name',
  company_name: 'company',
  phone: 'phone',
  location: 'location',
};

interface Row {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  created_at: string | null;
  verification_status: string | null;
  missing_fields: string[] | null;
  completeness_pct: number | null;
  reminder_sent_at: string | null;
  reminder_count: number | null;
}

function fmt(v: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default async function IncompleteProfilesPage({
  searchParams,
}: {
  searchParams?: Promise<{ role?: string; recent?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const roleParam = sp.role ?? '';
  const role = (ROLES as readonly string[]).includes(roleParam) ? roleParam : null;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc('admin_list_incomplete_profiles', {
    p_role: role,
    p_limit: 200,
  });

  let rows = (data ?? []) as Row[];
  // "Recently registered" is a client-side narrowing of the same result set, so
  // it cannot disagree with the list it filters.
  if (sp.recent === '1') {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    rows = rows.filter((r) => r.created_at && new Date(r.created_at).getTime() >= cutoff);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-white">
          Incomplete profiles
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Accounts missing required contact or organisation details. A user
          disappears from this list automatically once their profile is complete.
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Chip href="/admin/users/incomplete" active={!role && sp.recent !== '1'}>
          All incomplete
        </Chip>
        {ROLES.map((r) => (
          <Chip key={r} href={`/admin/users/incomplete?role=${r}`} active={role === r}>
            {r.charAt(0).toUpperCase() + r.slice(1)}
          </Chip>
        ))}
        <Chip href="/admin/users/incomplete?recent=1" active={sp.recent === '1'}>
          Recently registered
        </Chip>
      </div>

      {error && (
        <p className="rounded-xl border border-accent-red/30 bg-accent-red/10 p-4 text-sm text-accent-red">
          Could not load: {error.message}
        </p>
      )}

      {!error && rows.length === 0 && (
        <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-sm text-zinc-400">
          No incomplete profiles{role ? ` for ${role}` : ''}. Nothing to chase.
        </p>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const missing = r.missing_fields ?? [];
          return (
            <section
              key={r.id}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/admin/users/${r.id}`}
                    className="font-semibold text-white hover:text-violet-glow hover:underline"
                  >
                    {r.full_name?.trim() || 'Unnamed user'}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-zinc-400">{r.email ?? '—'}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-zinc-300">
                      {r.role ?? 'unknown'}
                    </span>
                    <span className="text-zinc-500">Joined {fmt(r.created_at)}</span>
                    <span className="text-zinc-500">·</span>
                    <span className="text-zinc-500">{r.verification_status ?? 'unverified'}</span>
                  </div>
                </div>

                <div className="text-right">
                  <p className="font-mono text-lg font-semibold text-accent-amber">
                    {r.completeness_pct ?? 0}%
                  </p>
                  <p className="text-[11px] text-zinc-500">complete</p>
                </div>
              </div>

              <p className="mt-3 border-t border-white/[0.06] pt-3 text-xs text-zinc-400">
                Missing:{' '}
                <span className="font-medium text-accent-amber">
                  {missing.length
                    ? missing.map((f) => FIELD_LABELS[f] ?? f.replace(/_/g, ' ')).join(', ')
                    : '—'}
                </span>
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] text-zinc-500">
                  {r.reminder_sent_at
                    ? `Reminder sent ${fmt(r.reminder_sent_at)}${
                        r.reminder_count && r.reminder_count > 1
                          ? ` (${r.reminder_count}×)`
                          : ''
                      }`
                    : 'No reminder sent yet'}
                </p>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/admin/users/${r.id}`}
                    className="rounded-full border border-white/10 px-3 py-1 text-[11px] font-semibold text-zinc-300 hover:bg-white/[0.04]"
                  >
                    View profile
                  </Link>
                  <RequestCompletionButton
                    userId={r.id}
                    email={r.email}
                    alreadySent={!!r.reminder_sent_at}
                  />
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? 'rounded-full border border-violet/40 bg-violet/15 px-3 py-1 text-xs font-semibold text-violet-glow'
          : 'rounded-full border border-white/10 bg-white/[0.02] px-3 py-1 text-xs text-zinc-400 hover:bg-white/[0.05]'
      }
    >
      {children}
    </Link>
  );
}
