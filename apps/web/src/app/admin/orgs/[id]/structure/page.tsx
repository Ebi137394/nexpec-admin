// ════════════════════════════════════════════════════════════════════════════
//  app/admin/orgs/[id]/structure/page.tsx
//  Enterprise org-chart workspace.
//
//  Server Component — does all the loading, then hands the prepared tree
//  + assignable-member pool to <OrgStructureWorkspace> (client).
//
//  Guard rails:
//    · `[id]` is validated as a UUID before any DB call.
//    · `tableMissing` triggers a dedicated empty state pointing the
//      operator at the un-run migration.
//    · Departments are an "enterprise-only" concept here — if the org's
//      kind is 'agency' we still render but warn (rather than block).
//      The Structure link from OrgsTable already filters to enterprise
//      orgs so this is just defense-in-depth.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Building2 } from 'lucide-react';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchOrgStructure,
  fetchAssignableOrgMembers,
  fetchDepartmentAuditTrail,
} from '@/lib/data/orgStructure';
import { OrgStructureWorkspace } from '@/components/admin/orgs/structure/OrgStructureWorkspace';
import { DepartmentAuditPanel } from '@/components/admin/orgs/structure/DepartmentAuditPanel';

export const metadata: Metadata = { title: 'Org Structure' };
export const dynamic = 'force-dynamic';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrgStructurePage({ params }: PageProps) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    notFound();
  }

  const supabase = await createSupabaseServerClient();

  // Org header info — small targeted read, not the full /admin/orgs query.
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .select('id, name, slug, kind, is_active')
    .eq('id', id)
    .maybeSingle();

  if (orgError || !org) {
    notFound();
  }

  const [tree, assignable, auditEvents] = await Promise.all([
    fetchOrgStructure(id),
    fetchAssignableOrgMembers(id),
    fetchDepartmentAuditTrail(id, 50),
  ]);

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Link
          href="/admin/orgs"
          className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-industrial text-zinc-400 transition-colors hover:text-violet-glow"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
          All organizations
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Command Console · Org Structure
            </p>
            <h1 className="mt-2 flex items-center gap-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                <Building2 className="h-5 w-5" strokeWidth={1.75} />
              </span>
              {org.name}
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
              Departments are nested under this organization. Each node can
              hold members and a cost-center code that joins to the budget
              roll-up in a later sprint.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-right">
            <Stat label="Departments" value={String(Object.keys(tree.byId).length)} />
            <Stat label="Org members" value={String(assignable.members.length)} />
            <Stat
              label="Kind"
              value={(org.kind ?? '—') as string}
              tone={org.kind === 'agency' ? 'cyan' : 'violet'}
            />
          </dl>
        </div>
        {org.kind === 'agency' && (
          <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-4 py-2 text-xs text-amber-200/90">
            This is an inspection agency. Department hierarchies are
            primarily a buyer / enterprise concept — proceed only if the
            agency has formal internal divisions.
          </p>
        )}
      </header>

      {tree.tableMissing ? (
        <div className="rounded-2xl border border-dashed border-violet/30 bg-violet/[0.04] p-12 text-center">
          <p className="font-display text-lg font-semibold text-white">
            The departments schema isn&apos;t live yet.
          </p>
          <p className="mt-2 mx-auto max-w-md text-pretty text-sm text-zinc-400">
            Run{' '}
            <code className="font-mono text-violet-glow">
              supabase/migrations/20260526120000_enterprise_department_hierarchy.sql
            </code>{' '}
            in the Supabase SQL editor. RLS grants super_admin full
            management; org members see read-only.
          </p>
        </div>
      ) : (
        <>
          <OrgStructureWorkspace
            orgId={id}
            orgName={org.name as string}
            initialTree={tree}
            assignableMembers={assignable.members}
          />

          {/* Super-admin oversight: every structural change — from this
              surface OR from /client/structure — is logged with the
              acting user's identity and shown here for review. */}
          <DepartmentAuditPanel events={auditEvents} />
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'violet' | 'cyan';
}) {
  const toneRing =
    tone === 'violet'
      ? 'ring-violet/30 text-violet-glow'
      : tone === 'cyan'
        ? 'ring-cyan-glow/30 text-cyan-glow'
        : 'ring-white/[0.08] text-white';
  return (
    <div className={`rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 ring-1 ring-inset ${toneRing}`}>
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm">{value}</p>
    </div>
  );
}
