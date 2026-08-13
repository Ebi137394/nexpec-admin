'use server';

// ════════════════════════════════════════════════════════════════════════════
//  app/admin/programs/actions.ts — the only write path for the Programs console
//
//  ── WHY THESE ARE TABLE WRITES AND NOT RPC CALLS ───────────────────────────
//  The house rule is that a mutation goes through an nx_* RPC, because the RPC
//  is where the authorisation and the contract live. 20260801468000 ships
//  exactly ONE function, nx_program_rollup(uuid), and it is STABLE — a reader.
//  There is no nx_program_create / nx_program_link_project anywhere in
//  supabase/migrations, and inventing one here would be a frontend reference to
//  an object no migration creates, which is precisely what
//  scripts/qa/check-db-refs.mjs exists to reject.
//
//  So the writes below go to the tables — and the contract is still enforced by
//  the database rather than by this file:
//
//    • public.programs has RLS ENABLED with programs_admin_all (nx_is_admin)
//      and programs_org_write (nx_is_org_member). anon is REVOKEd entirely.
//      A caller who should not write simply gets 42501 back.
//    • projects.program_id is guarded by trg_projects_program_same_org, which
//      fires BEFORE INSERT OR UPDATE and raises PROGRAM_ORG_MISMATCH if a
//      project tries to join a program owned by another organisation. The
//      migration is explicit that INSERT coverage is deliberate. This file
//      therefore cannot create a cross-org link even if it tried.
//    • programs_status_check, programs_budget_nonneg, programs_dates_ordered
//      and programs_code_unique_per_org reject bad rows at the constraint
//      level, so the validation below is a nicer error message, not the fence.
//
//  Nothing here writes projects.spent, and nothing here writes a program-level
//  spend column — the migration refuses to have one, because projects.spent is
//  the single source of truth and nx_program_rollup sums it on read.
//
//  ── NO COMMERCIAL LEAKAGE ──────────────────────────────────────────────────
//  Programs are a BUYER-side planning object. budget/spent are client-side
//  figures the organisation already sees on its own projects. No payout, no
//  platform spread, no per-job price is read or written anywhere in this route.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PROGRAM_STATUSES, type ProgramStatus } from './types';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** True when the database refused on authorisation rather than on validity. */
  forbidden?: boolean;
}

/**
 * Normalise a PostgREST / Postgres error into an ActionResult, keeping the
 * "you may not" case separate from the "that did not work" case so the UI can
 * render them differently.
 */
function fail(e: unknown, fallback: string): ActionResult {
  const err = (e ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof err.message === 'string' ? err.message : fallback;
  const code = typeof err.code === 'string' ? err.code : '';

  const forbidden =
    code === '42501' ||
    code === 'PGRST301' ||
    /not[_ ]authorized|permission denied|row-level security/i.test(message);

  if (/PROGRAM_ORG_MISMATCH/.test(message)) {
    return {
      ok: false,
      error:
        'That project belongs to a different organisation than the program. The database refused the link.',
    };
  }
  if (/PROGRAM_NOT_FOUND/.test(message)) {
    return { ok: false, error: 'That program no longer exists.' };
  }
  if (/programs_code_unique_per_org/.test(message)) {
    return {
      ok: false,
      error: 'Another program in this organisation already uses that code.',
    };
  }
  if (/programs_dates_ordered/.test(message)) {
    return { ok: false, error: 'The end date must not fall before the start date.' };
  }
  if (/programs_budget_nonneg/.test(message)) {
    return { ok: false, error: 'The budget cannot be negative.' };
  }

  return forbidden
    ? {
        ok: false,
        forbidden: true,
        error: 'You do not have permission to change this program.',
      }
    : { ok: false, error: message };
}

function revalidate(programId?: string) {
  revalidatePath('/admin/programs');
  if (programId) revalidatePath(`/admin/programs/${programId}`);
}

function isStatus(v: string): v is ProgramStatus {
  return (PROGRAM_STATUSES as readonly string[]).includes(v);
}

/** Trim to null so an empty form field stores NULL rather than ''. */
function orNull(v: string | undefined | null): string | null {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
}

export interface CreateProgramInput {
  organizationId: string;
  name: string;
  code?: string | null;
  description?: string | null;
  status?: string;
  budget?: string | number | null;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Create a program. The organisation is chosen explicitly rather than inferred,
 * because the Command Console is platform-wide and the operator is not acting
 * as a member of any one tenant.
 */
export async function createProgram(
  input: CreateProgramInput,
): Promise<ActionResult> {
  const name = (input.name ?? '').trim();
  if (name === '') return { ok: false, error: 'A program needs a name.' };
  if (!input.organizationId) {
    return { ok: false, error: 'Choose the owning organisation.' };
  }

  const status = (input.status ?? 'active').trim();
  if (!isStatus(status)) {
    return { ok: false, error: `"${status}" is not a valid program status.` };
  }

  let budget = 0;
  if (input.budget !== null && input.budget !== undefined && input.budget !== '') {
    const n = Number(input.budget);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'The budget must be a number of zero or more.' };
    }
    budget = n;
  }

  const supabase = await createSupabaseServerClient();

  // created_by is stamped from the session rather than accepted from the
  // client, so the audit trail cannot be forged by the form.
  const { data: auth } = await supabase.auth.getUser();
  const createdBy = auth.user?.id ?? null;

  const { data, error } = await supabase
    .from('programs')
    .insert({
      organization_id: input.organizationId,
      name,
      code: orNull(input.code),
      description: orNull(input.description),
      status,
      budget,
      start_date: orNull(input.startDate),
      end_date: orNull(input.endDate),
      created_by: createdBy,
    })
    // Explicit column list on the returning projection too — the same rule
    // applies to a write's read-back as to a read.
    .select('id')
    .single();

  if (error) return fail(error, 'Could not create the program.');

  revalidate((data as { id: string } | null)?.id);
  return { ok: true };
}

/** Move a program through its lifecycle. Status vocabulary is shared with projects. */
export async function setProgramStatus(
  programId: string,
  status: string,
): Promise<ActionResult> {
  if (!programId) return { ok: false, error: 'Missing program.' };
  if (!isStatus(status)) {
    return { ok: false, error: `"${status}" is not a valid program status.` };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('programs')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', programId);

  if (error) return fail(error, 'Could not update the program status.');
  revalidate(programId);
  return { ok: true };
}

/** Edit the planning fields of a program. Never touches spend — there is none. */
export async function updateProgram(
  programId: string,
  input: {
    name: string;
    code?: string | null;
    description?: string | null;
    budget?: string | number | null;
    startDate?: string | null;
    endDate?: string | null;
  },
): Promise<ActionResult> {
  if (!programId) return { ok: false, error: 'Missing program.' };
  const name = (input.name ?? '').trim();
  if (name === '') return { ok: false, error: 'A program needs a name.' };

  let budget = 0;
  if (input.budget !== null && input.budget !== undefined && input.budget !== '') {
    const n = Number(input.budget);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'The budget must be a number of zero or more.' };
    }
    budget = n;
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('programs')
    .update({
      name,
      code: orNull(input.code),
      description: orNull(input.description),
      budget,
      start_date: orNull(input.startDate),
      end_date: orNull(input.endDate),
      updated_at: new Date().toISOString(),
    })
    .eq('id', programId);

  if (error) return fail(error, 'Could not update the program.');
  revalidate(programId);
  return { ok: true };
}

/**
 * Link an existing project into a program.
 *
 * The org-match invariant is NOT checked here — trg_projects_program_same_org
 * enforces it BEFORE INSERT OR UPDATE and raises PROGRAM_ORG_MISMATCH. Doing it
 * in TypeScript as well would create a second, drifting definition of the rule;
 * the surfaced error message is the trigger's verdict, not this file's opinion.
 */
export async function linkProjectToProgram(
  projectId: string,
  programId: string,
): Promise<ActionResult> {
  if (!projectId || !programId) {
    return { ok: false, error: 'Choose a project to link.' };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('projects')
    .update({ program_id: programId })
    .eq('id', projectId);

  if (error) return fail(error, 'Could not link that project.');
  revalidate(programId);
  return { ok: true };
}

/**
 * Detach a project from its program. Sets program_id to NULL, which is the same
 * thing ON DELETE SET NULL does — real project and job history is never touched.
 */
export async function unlinkProjectFromProgram(
  projectId: string,
  programId: string,
): Promise<ActionResult> {
  if (!projectId) return { ok: false, error: 'Missing project.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('projects')
    .update({ program_id: null })
    .eq('id', projectId);

  if (error) return fail(error, 'Could not detach that project.');
  revalidate(programId);
  return { ok: true };
}
