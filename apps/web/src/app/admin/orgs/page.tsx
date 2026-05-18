// ════════════════════════════════════════════════════════════════════════════
//  app/admin/orgs/page.tsx — Organizations management (read-only scaffold)
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { fetchOrganizations } from '@/lib/data/organizations';
import { OrgsTable } from '@/components/admin/orgs/OrgsTable';

export const metadata: Metadata = { title: 'Organizations' };
export const dynamic = 'force-dynamic';

export default async function OrgsPage() {
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
