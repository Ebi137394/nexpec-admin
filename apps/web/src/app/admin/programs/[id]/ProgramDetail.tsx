'use client';

// ════════════════════════════════════════════════════════════════════════════
//  ProgramDetail — one program, its authoritative rollup, and its linkage.
//
//  Every number in the header band comes from nx_program_rollup. The project
//  table below it is the evidence for those numbers, not a second computation
//  of them — if the rollup and the listed rows ever disagreed, the rollup is
//  the one that read projects.spent, and the table is capped at 200 rows.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState, useTransition } from 'react';
import { Link2, Unlink, AlertTriangle } from 'lucide-react';
import {
  PROGRAM_STATUSES,
  formatAmount,
  formatDate,
  toNumber,
  type ProgramRow,
  type ProjectRow,
  type RollupResult,
} from '../types';
import { StatusPill } from '../ProgramsConsole';
import {
  linkProjectToProgram,
  setProgramStatus,
  unlinkProjectFromProgram,
  updateProgram,
} from '../actions';

function RollupBand({ result }: { result: RollupResult }) {
  if (result.state === 'forbidden') {
    return (
      <div
        role="status"
        className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-200"
      >
        The rollup is withheld — nx_program_rollup admits platform admins and
        members of the owning organisation only. This is an authorisation
        refusal, not a program with no projects.
      </div>
    );
  }

  if (result.state === 'failed') {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-sm text-red-200"
      >
        <span className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
          Rollup unavailable
        </span>
        <p className="mt-1 text-xs opacity-80">
          The read failed, so no totals are shown. A zero here would assert that
          nothing has been spent, which is not what we know.
        </p>
        <span className="mt-2 block text-xs opacity-70">{result.message}</span>
      </div>
    );
  }

  const r = result.rollup;
  const remaining = toNumber(r.budget_remaining);
  const overspent = remaining !== null && remaining < 0;

  const cells: Array<{ label: string; value: string; tone?: string }> = [
    { label: 'Program budget', value: formatAmount(r.program_budget) },
    { label: 'Projects', value: String(r.project_count) },
    { label: 'Active', value: String(r.active_projects) },
    { label: 'Completed', value: String(r.completed_projects) },
    { label: 'Projects budget', value: formatAmount(r.projects_budget) },
    { label: 'Projects spent', value: formatAmount(r.projects_spent) },
    {
      label: 'Budget remaining',
      value: formatAmount(r.budget_remaining),
      tone: overspent ? 'text-red-300' : 'text-emerald-300',
    },
  ];

  return (
    <section
      aria-label="Program rollup"
      className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
    >
      <h2 className="text-sm font-semibold text-white">Rollup</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Derived at read time by nx_program_rollup. Nothing here is stored on the
        program row — projects.spent is the single source of truth.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 lg:grid-cols-7">
        {cells.map((c) => (
          <div key={c.label}>
            <dt className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              {c.label}
            </dt>
            <dd className={`mt-1 font-mono text-sm ${c.tone ?? 'text-white'}`}>
              {c.value}
            </dd>
          </div>
        ))}
      </dl>
      {overspent && (
        <p role="status" className="mt-3 text-xs text-red-300">
          Linked projects have spent more than this program&apos;s budget.
        </p>
      )}
    </section>
  );
}

export function ProgramDetail({
  program,
  organizationName,
  rollup,
  linkedProjects,
  linkedError,
  candidateProjects,
  candidatesError,
}: {
  program: ProgramRow;
  organizationName: string | null;
  rollup: RollupResult;
  linkedProjects: ProjectRow[];
  linkedError: string | null;
  candidateProjects: ProjectRow[];
  candidatesError: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [editing, setEditing] = useState(false);

  const [name, setName] = useState(program.name);
  const [code, setCode] = useState(program.code ?? '');
  const [description, setDescription] = useState(program.description ?? '');
  const [budget, setBudget] = useState(String(toNumber(program.budget) ?? 0));
  const [startDate, setStartDate] = useState(program.start_date ?? '');
  const [endDate, setEndDate] = useState(program.end_date ?? '');

  const projectNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of candidateProjects) m.set(p.id, p.name);
    return m;
  }, [candidateProjects]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.ok) setNotice(ok);
      else setError(r.error ?? 'That did not work.');
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-white">{program.name}</h1>
            {program.code && (
              <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                {program.code}
              </span>
            )}
            <StatusPill value={program.status} />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {organizationName ?? 'Unknown organisation'} ·{' '}
            {formatDate(program.start_date)} → {formatDate(program.end_date)} ·
            created {formatDate(program.created_at)}
          </p>
          {program.description && (
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              {program.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="detail-status" className="sr-only">
            Program status
          </label>
          <select
            id="detail-status"
            aria-label="Change program status"
            defaultValue={program.status}
            disabled={pending}
            onChange={(e) =>
              run(
                () => setProgramStatus(program.id, e.target.value),
                `Status set to ${e.target.value}.`,
              )
            }
            className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white"
          >
            {PROGRAM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-controls="edit-program-panel"
            aria-label={editing ? 'Close the program editor' : 'Edit this program'}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-violet-400/40 hover:text-white"
          >
            {editing ? 'Cancel' : 'Edit'}
          </button>
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200"
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {editing && (
        <section
          id="edit-program-panel"
          aria-label="Edit program"
          className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
        >
          <h2 className="text-sm font-semibold text-white">Program details</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Planning fields only. There is no spend field to edit — a program
            never stores one.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label
                htmlFor="edit-name"
                className="block text-[11px] font-medium text-zinc-400"
              >
                Name
              </label>
              <input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label
                htmlFor="edit-code"
                className="block text-[11px] font-medium text-zinc-400"
              >
                Code
              </label>
              <input
                id="edit-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label
                htmlFor="edit-budget"
                className="block text-[11px] font-medium text-zinc-400"
              >
                Budget
              </label>
              <input
                id="edit-budget"
                type="number"
                min="0"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label
                htmlFor="edit-start"
                className="block text-[11px] font-medium text-zinc-400"
              >
                Start date
              </label>
              <input
                id="edit-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label
                htmlFor="edit-end"
                className="block text-[11px] font-medium text-zinc-400"
              >
                End date
              </label>
              <input
                id="edit-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label
                htmlFor="edit-description"
                className="block text-[11px] font-medium text-zinc-400"
              >
                Description
              </label>
              <textarea
                id="edit-description"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <button
                type="button"
                disabled={pending || name.trim() === ''}
                aria-label="Save program details"
                onClick={() =>
                  run(
                    () =>
                      updateProgram(program.id, {
                        name,
                        code,
                        description,
                        budget,
                        startDate,
                        endDate,
                      }),
                    'Program updated.',
                  )
                }
                className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
              >
                {pending ? 'Working…' : 'Save changes'}
              </button>
            </div>
          </div>
        </section>
      )}

      <RollupBand result={rollup} />

      {/* ── Linkage ─────────────────────────────────────────────────────── */}
      <section
        aria-label="Link a project"
        className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
      >
        <h2 className="text-sm font-semibold text-white">Link a project</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Only unassigned projects belonging to{' '}
          {organizationName ?? 'this organisation'} can be linked. A project may
          belong to one program at a time, and the database refuses a cross-org
          link outright.
        </p>

        {candidatesError === 'forbidden' ? (
          <p
            role="status"
            className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200"
          >
            You do not have permission to list this organisation&apos;s projects,
            so none can be offered.
          </p>
        ) : candidatesError ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-200"
          >
            Could not load candidate projects — this is a read failure, not an
            empty list.
            <span className="mt-1 block opacity-70">{candidatesError}</span>
          </p>
        ) : candidateProjects.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-400">
            Every project in this organisation already belongs to a program.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <label htmlFor="project-pick" className="sr-only">
              Project to link
            </label>
            <select
              id="project-pick"
              aria-label="Choose a project to link into this program"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="min-w-[16rem] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
            >
              <option value="">Choose an unassigned project…</option>
              {candidateProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.status ?? 'no status'})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending || pick === ''}
              aria-label="Link the selected project into this program"
              onClick={() =>
                run(
                  async () => {
                    const r = await linkProjectToProgram(pick, program.id);
                    if (r.ok) setPick('');
                    return r;
                  },
                  `${projectNameById.get(pick) ?? 'The project'} is now part of this program.`,
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
            >
              <Link2 className="h-4 w-4" strokeWidth={2} />
              {pending ? 'Working…' : 'Link'}
            </button>
          </div>
        )}
      </section>

      {/* ── Linked projects ─────────────────────────────────────────────── */}
      <section
        aria-label="Linked projects"
        className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
      >
        <h2 className="text-sm font-semibold text-white">Projects in this program</h2>

        {linkedError === 'forbidden' ? (
          <p
            role="status"
            className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200"
          >
            You do not have permission to read the projects in this program.
          </p>
        ) : linkedError ? (
          <p
            role="alert"
            className="mt-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-200"
          >
            Could not load the linked projects. This is a read failure, not an
            empty program.
            <span className="mt-1 block opacity-70">{linkedError}</span>
          </p>
        ) : linkedProjects.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">
            No projects are linked yet. Attach one above — a program groups
            existing projects and never creates them.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[42rem] text-left text-sm">
              <caption className="sr-only">
                Projects linked to {program.name}, with their budget and spend
              </caption>
              <thead>
                <tr className="border-b border-white/[0.06] text-[10px] uppercase tracking-industrial text-zinc-500">
                  <th scope="col" className="pb-2 pr-3 font-semibold">Project</th>
                  <th scope="col" className="pb-2 pr-3 font-semibold">Status</th>
                  <th scope="col" className="pb-2 pr-3 text-right font-semibold">Budget</th>
                  <th scope="col" className="pb-2 pr-3 text-right font-semibold">Spent</th>
                  <th scope="col" className="pb-2 pr-3 font-semibold">Window</th>
                  <th scope="col" className="pb-2 font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {linkedProjects.map((p) => {
                  const b = toNumber(p.budget);
                  const s = toNumber(p.spent);
                  const over = b !== null && s !== null && s > b;
                  return (
                    <tr key={p.id}>
                      <td className="py-2.5 pr-3 text-white">{p.name}</td>
                      <td className="py-2.5 pr-3">
                        <StatusPill value={p.status ?? 'unknown'} />
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-zinc-300">
                        {formatAmount(p.budget)}
                      </td>
                      <td
                        className={`py-2.5 pr-3 text-right font-mono ${
                          over ? 'text-red-300' : 'text-zinc-300'
                        }`}
                      >
                        {formatAmount(p.spent)}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-zinc-500">
                        {formatDate(p.start_date)} → {formatDate(p.end_date)}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          disabled={pending}
                          aria-label={`Detach ${p.name} from this program`}
                          onClick={() =>
                            run(
                              () =>
                                unlinkProjectFromProgram(p.id, program.id),
                              `${p.name} was detached. Its project and job history is untouched.`,
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 transition hover:border-red-400/40 hover:text-red-200 disabled:opacity-40"
                        >
                          <Unlink className="h-3 w-3" strokeWidth={2} />
                          Detach
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-zinc-600">
              Detaching sets the project&apos;s program to none. It never deletes
              project or job history.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
