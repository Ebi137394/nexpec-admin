// ════════════════════════════════════════════════════════════════════════════
//  app/admin/orgs/page.tsx — Organizations management (read-only scaffold)
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { fetchOrganizations } from '@/lib/data/organizations';
import { OrgsTable } from '@/components/admin/orgs/OrgsTable';
import { createOrganization } from '@/lib/actions/createOrg';

export const metadata: Metadata = { title: 'Organizations' };
export const dynamic = 'force-dynamic';

export default async function OrgsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const { orgs, total, tableMissing } = await fetchOrganizations();

  const enterprise = orgs.filter((o) => o.kind === 'enterprise').length;
  const agencies = orgs.filter((o) => o.kind === 'agency').length;
  const totalSeats = orgs.reduce((sum, o) => sum + o.member_count, 0);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Command Console · Live
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Organizations
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Enterprise buyers and inspection agencies. Each org carries a
          member roster scoped by RLS — super_admin reads everything; org
          members see only their own.
        </p>
      </header>

      {sp.created ? (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          Organization created — you&apos;re the owner. Open its structure to add departments and invite your team.
        </div>
      ) : null}
      {sp.error ? (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {sp.error}
        </div>
      ) : null}

      <details className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-white">
          <span className="text-lg leading-none text-violet-glow">+</span> New organization
        </summary>
        <form action={createOrganization} className="mt-4 grid max-w-lg gap-3">
          <input type="hidden" name="returnTo" value="/admin/orgs" />
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">Name</span>
            <input
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder="Acme Inspections LLC"
              className="rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-violet-glow/50 focus:outline-none"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">Kind</span>
            <select
              name="kind"
              defaultValue="enterprise"
              className="rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2 text-sm text-white focus:border-violet-glow/50 focus:outline-none"
            >
              <option value="enterprise">Enterprise · buyer</option>
              <option value="agency">Agency · inspection</option>
            </select>
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
            >
              Create organization
            </button>
            <span className="text-[10px] text-zinc-500">You&apos;ll be recorded as the owner.</span>
          </div>
        </form>
      </details>

      {!tableMissing && (
        <section className="grid grid-cols-3 gap-3">
          <Stat label="Total organizations" value={String(total)} />
          <Stat label="Enterprise buyers" value={String(enterprise)} tone="violet" />
          <Stat label="Inspection agencies" value={String(agencies)} tone="cyan" />
        </section>
      )}

      <OrgsTable orgs={orgs} tableMissing={tableMissing} />

      {!tableMissing && orgs.length > 0 && (
        <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          {totalSeats} total member seat{totalSeats === 1 ? '' : 's'} ·
          membership mutations land in Sprint 4
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'violet' | 'cyan';
}) {
  const valueColor =
    tone === 'violet'
      ? 'text-violet-glow'
      : tone === 'cyan'
        ? 'text-cyan-glow'
        : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${valueColor}`}>
        {value}
      </p>
    </div>
  );
}
