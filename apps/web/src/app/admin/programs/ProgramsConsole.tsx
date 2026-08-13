'use client';

// ════════════════════════════════════════════════════════════════════════════
//  ProgramsConsole — the operator surface for the program tier.
//
//  Renders three things an operator actually needs: what programs exist, what
//  each one rolls up to, and which projects are still unassigned. The rollup
//  figures are whatever nx_program_rollup returned — this component performs no
//  arithmetic of its own on spend, because projects.spent is the single source
//  of truth and a second summation here would drift from it.
//
//  A program whose rollup could not be read renders as UNAVAILABLE, visually
//  distinct from a program that genuinely rolls up to zero.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { FolderKanban, Plus, ArrowRight, AlertTriangle } from 'lucide-react';
import {
  PROGRAM_STATUSES,
  formatAmount,
  formatDate,
  toNumber,
  type OrganizationRow,
  type ProgramRow,
  type ProjectRow,
  type RollupResult,
} from './types';
import { createProgram, setProgramStatus } from './actions';

const STATUS_TONE: Record<string, string> = {
  active: 'text-emerald-300 border-emerald-400/30 bg-emerald-400/10',
  pending: 'text-amber-300 border-amber-400/30 bg-amber-400/10',
  completed: 'text-violet-300 border-violet-400/30 bg-violet-400/10',
  archived: 'text-zinc-400 border-white/10 bg-white/5',
};

export function StatusPill({ value }: { value: string }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        STATUS_TONE[value] ?? 'text-zinc-300 border-white/10 bg-white/5'
      }`}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}

/** One rollup figure. `unknown` is rendered as an em dash, never as zero. */
function Stat({
  label,
  value,
  tone = 'text-white',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </dt>
      <dd className={`mt-0.5 font-mono text-sm ${tone}`}>{value}</dd>
    </div>
  );
}

export function RollupSummary({ result }: { result: RollupResult | undefined }) {
  if (!result || result.state === 'failed') {
    return (
      <p
        role="status"
        className="mt-3 flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-200"
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        Rollup unavailable — the read failed. This is not a zero rollup.
        {result?.state === 'failed' && (
          <span className="opacity-70">{result.message}</span>
        )}
      </p>
    );
  }

  if (result.state === 'forbidden') {
    return (
      <p
        role="status"
        className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200"
      >
        Rollup withheld — you are not a member of the owning organisation.
      </p>
    );
  }

  const r = result.rollup;
  const remaining = toNumber(r.budget_remaining);
  const overspent = remaining !== null && remaining < 0;

  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      <Stat label="Projects" value={String(r.project_count)} />
      <Stat
        label="Status"
        value={`${r.active_projects} active · ${r.completed_projects} done`}
      />
      <Stat label="Spent" value={formatAmount(r.projects_spent)} />
      <Stat
        label="Remaining"
        value={formatAmount(r.budget_remaining)}
        tone={overspent ? 'text-red-300' : 'text-emerald-300'}
      />
    </dl>
  );
}

export function ProgramsConsole({
  programs,
  organizations,
  projects,
  rollups,
  programLimit,
}: {
  programs: ProgramRow[];
  organizations: OrganizationRow[];
  projects: ProjectRow[];
  rollups: Record<string, RollupResult>;
  programLimit: number;
}) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const [orgId, setOrgId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const orgNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of organizations) m.set(o.id, o.name);
    return m;
  }, [organizations]);

  const unassigned = useMemo(
    () => projects.filter((p) => p.program_id === null),
    [projects],
  );

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
    <main>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Programs</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            The grouping tier above projects — a named, org-owned bucket of
            existing projects. Spend is never stored on a program; every figure
            below is summed from <code className="text-zinc-300">projects.spent</code>{' '}
            at read time by <code className="text-zinc-300">nx_program_rollup</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          aria-expanded={showCreate}
          aria-controls="create-program-panel"
          aria-label={showCreate ? 'Hide the new program form' : 'Show the new program form'}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-400"
        >
          <Plus className="h-4 w-4" strokeWidth={2} />
          New program
        </button>
      </header>

      {notice && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200"
        >
          {notice}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {showCreate && (
        <section
          id="create-program-panel"
          aria-label="Create a program"
          className="mb-6 rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
        >
          <h2 className="text-sm font-semibold text-white">New program</h2>
          <p className="mt-1 text-xs text-zinc-500">
            The owning organisation is chosen explicitly — the Command Console is
            platform-wide, so nothing is inferred from your own membership. A
            project can only join a program owned by the same organisation; the
            database enforces that.
          </p>

          {organizations.length === 0 ? (
            <p className="mt-4 text-sm text-amber-200">
              No active organisations are visible, so a program cannot be
              created yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label
                  htmlFor="program-org"
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Organisation
                </label>
                <select
                  id="program-org"
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                >
                  <option value="">Choose an organisation…</option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="program-name"
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Name
                </label>
                <input
                  id="program-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Gulf Refinery Turnaround 2026"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                />
              </div>

              <div>
                <label
                  htmlFor="program-code"
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Code <span className="text-zinc-600">(optional, unique per org)</span>
                </label>
                <input
                  id="program-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="GRT-26"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                />
              </div>

              <div>
                <label
                  htmlFor="program-budget"
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Budget
                </label>
                <input
                  id="program-budget"
                  type="number"
                  min="0"
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                />
              </div>

              <div>
                <label
                  htmlFor="program-start"
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Start date
                </label>
                <input
                  id="program-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </div>

              <div>
                <label
                  htmlFor="program-end"
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  End date
                </label>
                <input
                  id="program-end"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label
                  htmlFor="program-description"
                  className="block text-[11px] font-medium text-zinc-400"
                >
                  Description <span className="text-zinc-600">(optional)</span>
                </label>
                <textarea
                  id="program-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <button
                  type="button"
                  disabled={pending || orgId === '' || name.trim() === ''}
                  aria-label="Create this program"
                  onClick={() =>
                    run(async () => {
                      const r = await createProgram({
                        organizationId: orgId,
                        name,
                        code,
                        description,
                        budget,
                        startDate,
                        endDate,
                      });
                      if (r.ok) {
                        setName('');
                        setCode('');
                        setDescription('');
                        setBudget('');
                        setStartDate('');
                        setEndDate('');
                      }
                      return r;
                    }, 'Program created.')
                  }
                  className="rounded-lg bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-400 disabled:opacity-40"
                >
                  {pending ? 'Working…' : 'Create program'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {programs.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-10 text-center">
          <FolderKanban
            className="mx-auto h-8 w-8 text-zinc-600"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="mt-3 text-sm text-zinc-300">No programs yet.</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-zinc-500">
            This is an empty portfolio, not a failed read. Create a program
            above, then link existing projects into it — a program never creates
            projects of its own.
          </p>
          {unassigned.length > 0 && (
            <p className="mt-3 text-xs text-zinc-400">
              {unassigned.length} project
              {unassigned.length === 1 ? '' : 's'} are currently unassigned and
              ready to be grouped.
            </p>
          )}
        </div>
      ) : (
        <>
          <section aria-label="Programs" className="space-y-3">
            {programs.map((p) => (
              <article
                key={p.id}
                className="rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-white">
                        {p.name}
                      </h2>
                      {p.code && (
                        <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {p.code}
                        </span>
                      )}
                      <StatusPill value={p.status} />
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {orgNameById.get(p.organization_id) ?? 'Unknown organisation'}
                      {' · '}
                      budget {formatAmount(p.budget)}
                      {' · '}
                      {formatDate(p.start_date)} → {formatDate(p.end_date)}
                    </p>
                    {p.description && (
                      <p className="mt-2 max-w-3xl text-sm text-zinc-400">
                        {p.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor={`status-${p.id}`} className="sr-only">
                      Status for {p.name}
                    </label>
                    <select
                      id={`status-${p.id}`}
                      aria-label={`Change status of ${p.name}`}
                      defaultValue={p.status}
                      disabled={pending}
                      onChange={(e) =>
                        run(
                          () => setProgramStatus(p.id, e.target.value),
                          `"${p.name}" is now ${e.target.value}.`,
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

                    <Link
                      href={`/admin/programs/${p.id}`}
                      aria-label={`Open ${p.name} and manage its projects`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-violet-400/40 hover:text-white"
                    >
                      Open
                      <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
                    </Link>
                  </div>
                </div>

                <RollupSummary result={rollups[p.id]} />
              </article>
            ))}
          </section>

          <p className="mt-4 text-[11px] text-zinc-600">
            Showing the {programs.length} most recent program
            {programs.length === 1 ? '' : 's'}
            {programs.length === programLimit
              ? ` — the list is capped at ${programLimit}.`
              : '.'}
            {unassigned.length > 0 && (
              <> {unassigned.length} project(s) are not yet in any program.</>
            )}
          </p>
        </>
      )}
    </main>
  );
}
