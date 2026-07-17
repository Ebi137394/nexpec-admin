// ════════════════════════════════════════════════════════════════════════════
//  app/client/reports/page.tsx — deliverables: reports admin has handed off
//
//  GOLDEN_RULE_6 — only reports admin has reviewed + forwarded show here.
//  GOLDEN_RULE_2 — the payout/spread breakdown is admin-only; this surface
//  shows the client's own price only.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import { FileCheck2, ChevronRight, Briefcase } from 'lucide-react';
import { fetchClientReports } from '@/lib/data/clientReports';
import type { ClientReportRow } from '@/lib/data/clientReports.types';

export const metadata: Metadata = {
  title: 'Reports',
};

export const dynamic = 'force-dynamic';

export default async function ClientReportsPage() {
  const reports = await fetchClientReports();

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal, Deliverables
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Reports
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Inspection reports reviewed by our team and ready for you.
          Reports stay private until our quality pass clears them.
        </p>
      </header>

      {reports.length === 0 ? <EmptyState /> : <ReportsTable rows={reports} />}
    </div>
  );
}

function EmptyState() {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 px-6 py-16 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
        <FileCheck2 className="h-5 w-5" strokeWidth={1.75} />
      </div>
      <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
        No reports yet.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-zinc-400">
        Reports appear here the moment our team finishes the quality
        review and hands them off. Until then, your active jobs live in
        the jobs list.
      </p>
      <Link
        href="/client/jobs"
        className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
      >
        <Briefcase className="h-4 w-4" strokeWidth={1.75} />
        View active jobs
      </Link>
    </section>
  );
}

function ReportsTable({ rows }: { rows: ClientReportRow[] }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
      <table className="w-full text-left">
        <thead className="border-b border-white/[0.06] bg-white/[0.02]">
          <tr>
            <Th>Job</Th>
            <Th>Inspector</Th>
            <Th>Handed off</Th>
            <Th>On hold</Th>
            <Th className="text-right">Price</Th>
            <th className="sr-only">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Row key={r.jobId} row={r} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Row({ row }: { row: ClientReportRow }) {
  return (
    <tr className="group border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.02]">
      <td className="px-5 py-4">
        <Link
          href={`/client/jobs/${row.jobId}`}
          className="block text-sm font-medium text-white transition-colors hover:text-violet-glow"
        >
          {row.jobTitle}
        </Link>
      </td>
      <td className="px-5 py-4 text-sm text-zinc-300">
        {row.inspectorFullName ?? '—'}
      </td>
      <td className="px-5 py-4 text-xs text-zinc-500">
        {row.adminConfirmedAt
          ? new Date(row.adminConfirmedAt).toLocaleString()
          : '—'}
      </td>
      <td className="px-5 py-4">
        <PayoutPill status={row.payoutStatus} />
      </td>
      <td className="px-5 py-4 text-right font-mono text-sm text-zinc-300">
        {formatPrice(row.clientPriceCents)}
      </td>
      <td className="px-5 py-4 text-right">
        <Link
          href={`/client/jobs/${row.jobId}`}
          aria-label={`Open ${row.jobTitle}`}
          className="inline-flex text-zinc-600 transition-colors group-hover:text-violet-glow"
        >
          <ChevronRight className="h-4 w-4" />
        </Link>
      </td>
    </tr>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-5 py-3 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500 ${className ?? ''}`}
      scope="col"
    >
      {children}
    </th>
  );
}

function PayoutPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-zinc-500">—</span>;
  const tone =
    status === 'paid'
      ? 'green'
      : status === 'processing'
        ? 'cyan'
        : status === 'disputed'
          ? 'red'
          : 'zinc';
  const classes = {
    green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
    cyan: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
    red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    zinc: 'border-white/[0.06] bg-white/[0.04] text-zinc-400',
  }[tone];
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${classes}`}
    >
      {status}
    </span>
  );
}

function formatPrice(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars);
}
