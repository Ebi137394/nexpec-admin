// ════════════════════════════════════════════════════════════════════════════
//  app/(admin)/audit/page.tsx — Audit Trail Command Center
//
//  The compliance surface. Server Component. Reads audit_events through
//  RLS (super_admin gets every row). URL search params drive page +
//  filters + drawer:
//
//    /admin/audit
//    /admin/audit?page=2
//    /admin/audit?eventType=job.status_changed
//    /admin/audit?severity=critical
//    /admin/audit?correlationId=<uuid>
//    /admin/audit?inspect=<event-id>
//
//  This is the page an auditor would open during diligence — every
//  consequential mutation across jobs / applications / contracts /
//  payout_requests appears here, with intent, correlation, and diff.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import {
  fetchAuditPage,
  fetchAuditEvent,
  fetchDistinctEventTypes,
  type AuditSeverity,
} from '@/lib/data/audit';
import { AuditTable } from '@/components/admin/audit/AuditTable';
import { AuditFilters } from '@/components/admin/audit/AuditFilters';
import { Pagination } from '@/components/admin/audit/Pagination';
import { AuditDetailDrawer } from '@/components/admin/audit/AuditDetailDrawer';

export const metadata: Metadata = {
  title: 'Audit Trail',
  description: 'Industrial Black Box, every consequential mutation, audit-grade.',
};

interface PageProps {
  searchParams: Promise<{
    page?: string;
    eventType?: string;
    severity?: string;
    correlationId?: string;
    inspect?: string;
  }>;
}

const VALID_SEVERITIES: AuditSeverity[] = ['info', 'warning', 'critical'];

export default async function AuditPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const page = parseInt(sp.page ?? '1', 10) || 1;
  const severity = VALID_SEVERITIES.includes(sp.severity as AuditSeverity)
    ? (sp.severity as AuditSeverity)
    : undefined;

  const [{ events, total, totalPages, pageSize }, eventTypes, inspected] =
    await Promise.all([
      fetchAuditPage({
        page,
        eventType: sp.eventType,
        severity,
        correlationId: sp.correlationId,
      }),
      fetchDistinctEventTypes(),
      sp.inspect ? fetchAuditEvent(sp.inspect) : Promise.resolve(null),
    ]);

  // Reconstruct the current search string so row links preserve filters.
  const search = new URLSearchParams();
  if (sp.page) search.set('page', sp.page);
  if (sp.eventType) search.set('eventType', sp.eventType);
  if (sp.severity) search.set('severity', sp.severity);
  if (sp.correlationId) search.set('correlationId', sp.correlationId);

  const filterActive = !!(sp.eventType || sp.severity || sp.correlationId);

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Industrial Black Box
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Audit Trail Command Center
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Every mutation across jobs, applications, contracts, and payout
          requests writes a row here through a SECURITY DEFINER trigger.
          Append-only, RLS-gated, indexed for fast per-job timelines and
          per-correlation grouping.
        </p>
      </header>

      {/* Active filter banner */}
      {sp.correlationId && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-violet/30 bg-violet/10 px-4 py-3">
          <p className="text-sm text-violet-glow">
            Showing events in correlation{' '}
            <span className="font-mono text-xs">{sp.correlationId}</span>
          </p>
          <a
            href="/admin/audit"
            className="rounded-md border border-violet/40 bg-violet/15 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-violet/25"
          >
            Clear
          </a>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <AuditFilters eventTypes={eventTypes} />
        <p className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          {filterActive ? 'filtered' : 'all events'}, {total.toLocaleString()} rows
        </p>
      </div>

      {/* Table */}
      <AuditTable
        events={events}
        selectedId={sp.inspect}
        currentSearch={search.toString()}
      />

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={pageSize}
      />

      {/* Detail drawer (rendered server-side via the inspected prop) */}
      <AuditDetailDrawer event={inspected} />
    </div>
  );
}
