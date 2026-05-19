// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/experience/page.tsx — Inspector work-history CRUD
//
//  Full CRUD over inspector_work_experience. Add new role inline; each
//  existing row exposes its own edit form (in a <details>) and a delete
//  button. is_current flips end_date to null at the action layer.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import {
  Briefcase,
  Pencil,
  Trash2,
  PlusCircle,
  Calendar,
  MapPin,
  AlertCircle,
} from 'lucide-react';
import { fetchInspectorProfile } from '@/lib/data/inspectorProfile';
import { fetchInspectorWorkExperience } from '@/lib/data/inspectorWorkExperience';
import type { InspectorWorkExperience } from '@/lib/data/inspectorWorkExperience.types';
import {
  createInspectorWorkExperience,
  updateInspectorWorkExperience,
  deleteInspectorWorkExperience,
} from '@/lib/actions/inspectorWorkExperience';

export const metadata: Metadata = {
  title: 'Work experience',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ error?: string; saved?: string; deleted?: string }>;
}

export default async function InspectorExperiencePage({
  searchParams,
}: PageProps) {
  const sp = (await searchParams) ?? {};
  const [profile, rows] = await Promise.all([
    fetchInspectorProfile(),
    fetchInspectorWorkExperience(),
  ]);
  if (!profile) {
    return (
      <div className="rounded-3xl border border-accent-red/30 bg-accent-red/5 p-8 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-accent-red" strokeWidth={1.5} />
        <h1 className="mt-4 font-display text-xl font-semibold text-white">
          Couldn&rsquo;t load your profile
        </h1>
        <p className="mt-2 max-w-md mx-auto text-sm text-zinc-400">
          The profile fetch failed — usually a missing column. Run{' '}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px]">
            20260518290000_inspector_profile_safety_net.sql
          </code>{' '}
          in Supabase, then refresh.
        </p>
        <div className="mt-5">
          <Link
            href="/inspector/dashboard"
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const flash = sp.error
    ? { tone: 'error' as const, msg: sp.error }
    : sp.saved
      ? { tone: 'ok' as const, msg: 'Saved.' }
      : sp.deleted
        ? { tone: 'ok' as const, msg: 'Deleted.' }
        : null;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Inspector Portal · Work experience
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Your professional history
          </h1>
          <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
            Roles, projects, and tenures that back up your credentials.
            Clients see this when admin shortlists you for a job; richer
            histories win more dispatches.
          </p>
        </div>
        <Link
          href="/inspector/settings"
          className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white sm:self-auto"
        >
          <Pencil className="h-4 w-4" strokeWidth={1.75} />
          Edit profile
        </Link>
      </header>

      {flash && (
        <div
          role="status"
          className={
            flash.tone === 'error'
              ? 'rounded-xl border border-accent-red/40 bg-accent-red/10 px-4 py-3 text-sm text-accent-red'
              : 'rounded-xl border border-accent-green/40 bg-accent-green/10 px-4 py-3 text-sm text-accent-green'
          }
        >
          {flash.msg}
        </div>
      )}

      {/* List */}
      <section className="space-y-3">
        {rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
            <Briefcase
              className="mx-auto h-8 w-8 text-zinc-600"
              strokeWidth={1.5}
            />
            <p className="mt-3 text-sm font-medium text-zinc-300">
              No work history listed yet.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Add your first role below — clients value detail.
            </p>
          </div>
        ) : (
          rows.map((row) => <ExperienceCard key={row.id} row={row} />)
        )}
      </section>

      {/* Add new */}
      <details className="group rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8 open:bg-violet/[0.06]">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-industrial text-violet-glow">
          <PlusCircle className="h-4 w-4" strokeWidth={1.75} />
          Add a role
        </summary>
        <ExperienceForm
          action={createInspectorWorkExperience}
          submitLabel="Save role"
        />
      </details>
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

function ExperienceCard({ row }: { row: InspectorWorkExperience }) {
  const startLabel = formatYearMonth(row.startDate);
  const endLabel = row.isCurrent
    ? 'Present'
    : row.endDate
      ? formatYearMonth(row.endDate)
      : '—';

  return (
    <article className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            {row.title}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-300">{row.company}</p>
          <p className="mt-1 inline-flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" strokeWidth={1.75} />
              {startLabel} — {endLabel}
            </span>
            {row.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" strokeWidth={1.75} />
                {row.location}
              </span>
            )}
            {row.isCurrent && (
              <span className="rounded-full border border-accent-green/40 bg-accent-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
                Current
              </span>
            )}
          </p>
        </div>
        <form action={deleteInspectorWorkExperience} className="shrink-0">
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            aria-label="Delete role"
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
          >
            <Trash2 className="h-3 w-3" strokeWidth={1.75} />
            Delete
          </button>
        </form>
      </div>

      {row.description && (
        <p className="mt-4 whitespace-pre-line text-sm text-zinc-400">
          {row.description}
        </p>
      )}

      {row.achievements.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {row.achievements.map((line, i) => (
            <li key={i} className="flex gap-2 text-sm text-zinc-400">
              <span className="text-violet-glow">·</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-5 group">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white">
          <Pencil className="h-3 w-3" strokeWidth={1.75} />
          Edit role
        </summary>
        <ExperienceForm
          action={updateInspectorWorkExperience}
          row={row}
          submitLabel="Save changes"
        />
      </details>
    </article>
  );
}

function ExperienceForm({
  action,
  row,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  row?: InspectorWorkExperience;
  submitLabel: string;
}) {
  return (
    <form
      action={action}
      className="mt-5 grid gap-4 sm:grid-cols-2"
    >
      {row && <input type="hidden" name="id" value={row.id} />}

      <Field label="Job title" required>
        <input
          name="title"
          required
          maxLength={160}
          defaultValue={row?.title ?? ''}
          placeholder="Senior NDT Inspector"
          className={inputCls}
        />
      </Field>
      <Field label="Company" required>
        <input
          name="company"
          required
          maxLength={160}
          defaultValue={row?.company ?? ''}
          placeholder="Acme Inspection Services"
          className={inputCls}
        />
      </Field>
      <Field label="Location">
        <input
          name="location"
          maxLength={160}
          defaultValue={row?.location ?? ''}
          placeholder="Montréal, QC"
          className={inputCls}
        />
      </Field>
      <Field label="Currently working here?">
        <label className="inline-flex items-center gap-2 rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            name="isCurrent"
            defaultChecked={row?.isCurrent ?? false}
            className="h-4 w-4 accent-violet"
          />
          Yes — this is my current role
        </label>
      </Field>
      <Field label="Start date" required>
        <input
          name="startDate"
          type="date"
          required
          defaultValue={row?.startDate ?? ''}
          className={inputCls}
        />
      </Field>
      <Field label="End date (leave blank if current)">
        <input
          name="endDate"
          type="date"
          defaultValue={row?.endDate ?? ''}
          className={inputCls}
        />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <textarea
          name="description"
          rows={4}
          maxLength={4000}
          defaultValue={row?.description ?? ''}
          placeholder="Scope of work, industries, notable projects, equipment operated."
          className={`${inputCls} resize-y`}
        />
      </Field>
      <Field label="Key achievements (one per line, max 20)" className="sm:col-span-2">
        <textarea
          name="achievementsText"
          rows={4}
          maxLength={4000}
          defaultValue={(row?.achievements ?? []).join('\n')}
          placeholder={
            'Performed 200+ UT thickness surveys on pressure vessels\nDelivered RT campaigns ahead of turnaround windows\nMentored 3 junior inspectors to CWB Level II'
          }
          className={`${inputCls} resize-y font-mono text-xs`}
        />
      </Field>
      <div className="sm:col-span-2">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-violet/90"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  'w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40';

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
        {required && <span className="ml-1 text-violet-glow">*</span>}
      </span>
      {children}
    </label>
  );
}

function formatYearMonth(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}
