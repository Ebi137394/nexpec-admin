// ════════════════════════════════════════════════════════════════════════════
//  app/admin/compliance/page.tsx — Compliance review (Sprint 4: drawer live)
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import {
  fetchComplianceQueue,
  fetchComplianceCredential,
  type CredentialStatus,
} from '@/lib/data/compliance';
import { ComplianceTable } from '@/components/admin/compliance/ComplianceTable';
import { ComplianceStatusFilter } from '@/components/admin/compliance/ComplianceStatusFilter';
import { ComplianceDrawer } from '@/components/admin/compliance/ComplianceDrawer';

export const metadata: Metadata = { title: 'Compliance' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ status?: string; inspect?: string }>;
}

export default async function CompliancePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const status = sp.status as CredentialStatus | undefined;

  const [{ credentials, total, totalPending, tableMissing }, inspected] =
    await Promise.all([
      fetchComplianceQueue({ status }),
      sp.inspect ? fetchComplianceCredential(sp.inspect) : Promise.resolve(null),
    ]);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-cyan-glow/90">
          Command Console · Live
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Compliance
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          CCI credential applications. Click any row to open the review
          drawer — approve, suspend, or reject with audit-captured notes.
          Decisions fire{' '}
          <span className="font-mono text-cyan-glow">admin_review_credential</span>.
        </p>
      </header>

      {!tableMissing && (
        <section className="grid grid-cols-3 gap-3">
          <Stat label="Total credentials" value={String(total)} />
          <Stat
            label="Pending review"
            value={String(totalPending)}
            tone={totalPending > 0 ? 'amber' : 'default'}
          />
          <Stat label="Decision paths" value="3" sub="approve · suspend · reject" />
        </section>
      )}

      <ComplianceStatusFilter />

      <ComplianceTable
        credentials={credentials}
        tableMissing={tableMissing}
        selectedId={sp.inspect ?? null}
      />

      <ComplianceDrawer credential={inspected} />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'amber';
}) {
  const valueColor = tone === 'amber' ? 'text-accent-amber' : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className={`mt-2 font-mono text-3xl font-semibold tracking-tight ${valueColor}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}
