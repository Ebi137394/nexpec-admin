// ════════════════════════════════════════════════════════════════════════════
//  app/admin/compliance/page.tsx — Compliance review (Sprint 4: drawer live)
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
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
        </div>

        {/* Cross-link to scope-template library — admin-curated catalog */}
        <Link
          href="/admin/compliance/templates"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2.5 text-sm font-semibold text-cyan-glow transition hover:border-cyan-glow/60 hover:bg-cyan-glow/15"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="9" y1="13" x2="15" y2="13" />
            <line x1="9" y1="17" x2="15" y2="17" />
          </svg>
          Scope Template Library
          <span className="text-cyan-glow/60">→</span>
        </Link>
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
