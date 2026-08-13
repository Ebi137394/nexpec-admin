// ════════════════════════════════════════════════════════════════════════════
//  app/admin/programs/page.tsx — NEXPEC Programs console
//
//  20260801468000 shipped Programs as DATABASE ONLY: public.programs,
//  projects.program_id and nx_program_rollup() had zero callers anywhere
//  outside the migration, and no route reached any of them. A migration is not
//  a completed product phase until its workflow is reachable, so this is that
//  surface.
//
//  ── WHAT A PROGRAM IS ──────────────────────────────────────────────────────
//  The grouping tier above projects: jobs -> projects -> programs -> org. It is
//  a named, org-owned bucket of EXISTING projects. It introduces no parallel
//  project model and no second budget system.
//
//  ── THE ROLLUP IS NOT COMPUTED HERE ────────────────────────────────────────
//  Spend is never stored on a program row; projects.spent is the single source
//  of truth and nx_program_rollup() sums the children on read. This page
//  therefore calls the RPC for every program rather than summing the project
//  rows it happens to have loaded — a second summation in TypeScript would be
//  exactly the drifting second source the migration refuses to create.
//
//  ── PRIVACY ────────────────────────────────────────────────────────────────
//  Programs are a BUYER-side planning object. budget/spent are client-side
//  figures the organisation already sees on its own projects. No inspector
//  payout, no platform spread and no per-job commercial detail is read here.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ProgramsConsole } from './ProgramsConsole';
import type {
  OrganizationRow,
  ProgramRollup,
  ProgramRow,
  ProjectRow,
  RollupResult,
} from './types';

export const metadata: Metadata = { title: 'Programs · NEXPEC Admin' };
export const dynamic = 'force-dynamic';

/** Bounded so one enormous tenant cannot turn the console into a scan. */
const PROGRAM_LIMIT = 50;
const PROJECT_LIMIT = 500;

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

export default async function AdminProgramsPage() {
  const supabase = await createSupabaseServerClient();

  // Explicit column lists, never select('*') — the house rule. Each name here
  // is a real column of the migration's table.
  const [programsRes, orgsRes, projectsRes] = await Promise.all([
    supabase
      .from('programs')
      .select(
        'id, organization_id, name, code, description, status, budget, start_date, end_date, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(PROGRAM_LIMIT),
    supabase
      .from('organizations')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(500),
    supabase
      .from('projects')
      .select(
        'id, organization_id, program_id, name, status, budget, spent, start_date, end_date, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(PROJECT_LIMIT),
  ]);

  const readError = programsRes.error ?? orgsRes.error ?? projectsRes.error;

  // A failed read is NOT an empty console. An operator must never mistake
  // "the query broke" for "there is no work here".
  if (readError) {
    const forbidden = isForbidden(readError);
    return (
      <main>
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-white">Programs</h1>
        </header>
        <div
          role="alert"
          className={`rounded-2xl border p-5 text-sm ${
            forbidden
              ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
              : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}
        >
          {forbidden ? (
            <>
              You do not have permission to read programs. Programs are visible
              to platform admins and to members of the owning organisation —
              this is an authorisation refusal, not an empty list.
            </>
          ) : (
            <>
              Could not load the Programs console. This is a read failure, not
              an empty portfolio — nothing has been changed.
            </>
          )}
          <span className="mt-2 block text-xs opacity-70">
            {readError.message}
          </span>
        </div>
      </main>
    );
  }

  const programs = (programsRes.data ?? []) as unknown as ProgramRow[];
  const organizations = (orgsRes.data ?? []) as unknown as OrganizationRow[];
  const projects = (projectsRes.data ?? []) as unknown as ProjectRow[];

  // nx_program_rollup is the ONLY place a program total is produced. One call
  // per program; a program whose rollup fails is reported as unavailable, never
  // as zeroes, because a confident 0 asserts "no spend" when the truth is "we
  // do not know".
  const rollupEntries = await Promise.all(
    programs.map(async (p): Promise<[string, RollupResult]> => {
      const { data, error } = await supabase.rpc('nx_program_rollup', {
        p_program_id: p.id,
      });
      if (error) {
        return [
          p.id,
          isForbidden(error)
            ? { state: 'forbidden' }
            : { state: 'failed', message: error.message },
        ];
      }
      if (!data) {
        return [p.id, { state: 'failed', message: 'The rollup returned nothing.' }];
      }
      return [p.id, { state: 'ok', rollup: data as unknown as ProgramRollup }];
    }),
  );

  const rollups: Record<string, RollupResult> = Object.fromEntries(rollupEntries);

  return (
    <ProgramsConsole
      programs={programs}
      organizations={organizations}
      projects={projects}
      rollups={rollups}
      programLimit={PROGRAM_LIMIT}
    />
  );
}
