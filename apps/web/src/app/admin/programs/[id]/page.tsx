// ════════════════════════════════════════════════════════════════════════════
//  app/admin/programs/[id]/page.tsx — one program, its rollup, its projects
//
//  The linkage surface. A program is a bucket of EXISTING projects, so the only
//  membership operations are attach and detach — this page never offers to
//  create a project, because a program does not own one.
//
//  Candidate projects are restricted to the program's OWN organisation before
//  they are ever offered. That is a usability decision, not a security one:
//  trg_projects_program_same_org refuses a cross-org link at the database and
//  raises PROGRAM_ORG_MISMATCH regardless of what this page shows.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ProgramDetail } from './ProgramDetail';
import type {
  ProgramRollup,
  ProgramRow,
  ProjectRow,
  RollupResult,
} from '../types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const PROGRAM_COLUMNS =
  'id, organization_id, name, code, description, status, budget, start_date, end_date, created_at';
const PROJECT_COLUMNS =
  'id, organization_id, program_id, name, status, budget, spent, start_date, end_date, created_at';

function isForbidden(e: { message?: string; code?: string } | null): boolean {
  if (!e) return false;
  return (
    e.code === '42501' ||
    e.code === 'PGRST301' ||
    /not[_ ]authorized|permission denied|row-level security/i.test(
      e.message ?? '',
    )
  );
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from('programs')
    .select('name')
    .eq('id', id)
    .maybeSingle();
  const name = (data as { name?: string } | null)?.name;
  return { title: name ? `${name} · Programs · NEXPEC Admin` : 'Program · NEXPEC Admin' };
}

function Shell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main>
      <Link
        href="/admin/programs"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 transition hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        All programs
      </Link>
      <div className="mt-4">{children}</div>
    </main>
  );
}

export default async function AdminProgramDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const programRes = await supabase
    .from('programs')
    .select(PROGRAM_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  // Permission refusal and read failure are separated from "no such program",
  // because all three would otherwise look like an empty page.
  if (programRes.error) {
    const forbidden = isForbidden(programRes.error);
    return (
      <Shell>
        <h1 className="text-2xl font-semibold text-white">Program</h1>
        <div
          role="alert"
          className={`mt-4 rounded-2xl border p-5 text-sm ${
            forbidden
              ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
              : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}
        >
          {forbidden
            ? 'You do not have permission to read this program. It belongs to an organisation you are not a member of.'
            : 'Could not load this program. This is a read failure — nothing has been changed.'}
          <span className="mt-2 block text-xs opacity-70">
            {programRes.error.message}
          </span>
        </div>
      </Shell>
    );
  }

  if (!programRes.data) notFound();

  const program = programRes.data as unknown as ProgramRow;

  const [rollupRes, linkedRes, candidatesRes, orgRes] = await Promise.all([
    supabase.rpc('nx_program_rollup', { p_program_id: program.id }),
    supabase
      .from('projects')
      .select(PROJECT_COLUMNS)
      .eq('program_id', program.id)
      .order('created_at', { ascending: false })
      .limit(200),
    // Same organisation, not yet in any program — the only projects that can
    // legally be attached here.
    supabase
      .from('projects')
      .select(PROJECT_COLUMNS)
      .eq('organization_id', program.organization_id)
      .is('program_id', null)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('organizations')
      .select('id, name')
      .eq('id', program.organization_id)
      .maybeSingle(),
  ]);

  const rollup: RollupResult = rollupRes.error
    ? isForbidden(rollupRes.error)
      ? { state: 'forbidden' }
      : { state: 'failed', message: rollupRes.error.message }
    : rollupRes.data
      ? { state: 'ok', rollup: rollupRes.data as unknown as ProgramRollup }
      : { state: 'failed', message: 'The rollup returned nothing.' };

  // The project reads are reported independently: a broken candidate query must
  // not make the linked-project list look empty, and vice versa.
  const linkedError = linkedRes.error
    ? isForbidden(linkedRes.error)
      ? 'forbidden'
      : linkedRes.error.message
    : null;
  const candidatesError = candidatesRes.error
    ? isForbidden(candidatesRes.error)
      ? 'forbidden'
      : candidatesRes.error.message
    : null;

  return (
    <Shell>
      <ProgramDetail
        program={program}
        organizationName={
          (orgRes.data as { name?: string } | null)?.name ?? null
        }
        rollup={rollup}
        linkedProjects={(linkedRes.data ?? []) as unknown as ProjectRow[]}
        linkedError={linkedError}
        candidateProjects={(candidatesRes.data ?? []) as unknown as ProjectRow[]}
        candidatesError={candidatesError}
      />
    </Shell>
  );
}
