// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/admin/users/specialties-bulk/BulkClient.tsx
//
//  Client island — selection state, slug input, add/remove choice,
//  submit. Server provides the filtered inspector list as props and the
//  full canonical slug list for the autocomplete datalist.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  Plus,
  X as RemoveX,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { bulkAssignSpecialties } from '@/lib/actions/inspectorSpecialties';
import type { BulkInspectorRow } from '@/lib/data/inspectorBulkList';

interface Props {
  inspectors: readonly BulkInspectorRow[];
  allSlugs: readonly string[];
  /** Echoes the active filter so the apply banner can describe context. */
  filterEcho: { has: string[]; hasnt: string[]; search: string };
}

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; updated: number; slug: string; mode: 'add' | 'remove' }
  | { kind: 'error'; message: string };

export function BulkClient({ inspectors, allSlugs, filterEcho }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [slug, setSlug] = useState('');
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const inspectorById = useMemo(
    () => new Map(inspectors.map((i) => [i.id, i])),
    [inspectors],
  );

  const allVisibleSelected =
    inspectors.length > 0 && inspectors.every((i) => selectedIds.has(i.id));

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      inspectors.forEach((i) => next.add(i.id));
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: 'idle' });
    const ids = [...selectedIds].filter((id) => inspectorById.has(id));
    const trimmedSlug = slug.trim().toLowerCase();
    if (ids.length === 0) {
      setStatus({ kind: 'error', message: 'Select at least one inspector.' });
      return;
    }
    if (!trimmedSlug || !/^[a-z][a-z0-9-]*$/.test(trimmedSlug)) {
      setStatus({
        kind: 'error',
        message: 'Slug must be lowercase kebab-case (a-z, 0-9, hyphen).',
      });
      return;
    }

    startTransition(async () => {
      const result = await bulkAssignSpecialties({
        inspectorIds: ids,
        slug: trimmedSlug,
        mode,
      });
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error ?? 'Update failed.' });
        return;
      }
      setStatus({
        kind: 'success',
        updated: result.updated ?? 0,
        slug: trimmedSlug,
        mode,
      });
      // Refresh server data so the table reflects the new specialty_slugs.
      router.refresh();
      // Optimistically clear the slug input but keep selection so the
      // admin can run another mutation on the same batch (e.g. add a
      // second slug to the same group).
      setSlug('');
    });
  }

  return (
    <article className="space-y-5 rounded-2xl border border-white/[0.08] bg-ink-900/40 p-6">
      <div className="flex items-center gap-2.5">
        <Users className="h-4 w-4 text-violet-300" strokeWidth={2} />
        <h3 className="font-display text-lg font-semibold text-white">
          Inspector pool
        </h3>
      </div>

      <FilterEcho filterEcho={filterEcho} />

      <AggregateStrip
        matching={inspectors.length}
        selected={selectedIds.size}
      />

      <ActionPanel
        slug={slug}
        setSlug={setSlug}
        mode={mode}
        setMode={setMode}
        allSlugs={allSlugs}
        selectedCount={selectedIds.size}
        isPending={isPending}
        onSubmit={onSubmit}
      />

      <StatusBanner status={status} />

      {inspectors.length === 0 ? (
        <EmptyState />
      ) : (
        <InspectorTable
          inspectors={inspectors}
          selectedIds={selectedIds}
          onToggle={toggle}
          allVisibleSelected={allVisibleSelected}
          onSelectAll={selectAllVisible}
          onClearAll={clearSelection}
        />
      )}
    </article>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function FilterEcho({
  filterEcho,
}: {
  filterEcho: { has: string[]; hasnt: string[]; search: string };
}) {
  const { has, hasnt, search } = filterEcho;
  const hasFilter = has.length > 0 || hasnt.length > 0 || search.length > 0;
  if (!hasFilter) {
    return (
      <p className="text-[12px] leading-relaxed text-zinc-500">
        No filter active, listing all inspectors (capped at 200).
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        Active filter
      </span>
      {has.map((s) => (
        <FilterChip key={`has-${s}`} kind="has" slug={s} />
      ))}
      {hasnt.map((s) => (
        <FilterChip key={`hasnt-${s}`} kind="hasnt" slug={s} />
      ))}
      {search && (
        <span className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 font-mono text-[11px] text-zinc-300">
          search:&nbsp;{search}
        </span>
      )}
    </div>
  );
}

function FilterChip({ kind, slug }: { kind: 'has' | 'hasnt'; slug: string }) {
  const isInclude = kind === 'has';
  const classes = isInclude
    ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300'
    : 'border-rose-500/30 bg-rose-500/[0.08] text-rose-300';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] ${classes}`}
    >
      {isInclude ? '+' : '−'} {slug}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function AggregateStrip({
  matching,
  selected,
}: {
  matching: number;
  selected: number;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-xl border border-white/[0.06] bg-ink-950/40 p-4 sm:grid-cols-3">
      <div>
        <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Matching the filter
        </dt>
        <dd className="mt-1 font-display text-xl font-semibold text-white">
          {matching}
        </dd>
      </div>
      <div>
        <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Selected
        </dt>
        <dd className="mt-1 font-display text-xl font-semibold text-white">
          {selected}
        </dd>
      </div>
      <div className="hidden sm:block">
        <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          Batch cap
        </dt>
        <dd className="mt-1 font-display text-xl font-semibold text-zinc-400">
          500
        </dd>
      </div>
    </dl>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function ActionPanel({
  slug,
  setSlug,
  mode,
  setMode,
  allSlugs,
  selectedCount,
  isPending,
  onSubmit,
}: {
  slug: string;
  setSlug: (s: string) => void;
  mode: 'add' | 'remove';
  setMode: (m: 'add' | 'remove') => void;
  allSlugs: readonly string[];
  selectedCount: number;
  isPending: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const disabled = isPending || selectedCount === 0 || slug.trim().length === 0;
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-xl border border-white/[0.06] bg-ink-950/40 p-4"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        Bulk action
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Mode toggle */}
        <div
          className="inline-flex rounded-lg border border-white/[0.08] bg-ink-900/60 p-0.5"
          role="radiogroup"
          aria-label="Add or remove"
        >
          <ModeButton
            label="Add"
            icon={Plus}
            active={mode === 'add'}
            onClick={() => setMode('add')}
          />
          <ModeButton
            label="Remove"
            icon={RemoveX}
            active={mode === 'remove'}
            onClick={() => setMode('remove')}
          />
        </div>

        {/* Slug input */}
        <div className="flex-1">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="kebab discipline slug, e.g. vibration-analysis"
            list="bulk-action-slug-list"
            className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 font-mono text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/40 focus:bg-ink-950 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
          <datalist id="bulk-action-slug-list">
            {allSlugs.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={disabled}
          className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors ${
            disabled
              ? 'cursor-not-allowed border-white/[0.06] bg-white/[0.02] text-zinc-600'
              : mode === 'add'
                ? 'border-emerald-500/40 bg-emerald-500/[0.12] text-emerald-200 hover:border-emerald-500/60 hover:bg-emerald-500/[0.2]'
                : 'border-rose-500/40 bg-rose-500/[0.12] text-rose-200 hover:border-rose-500/60 hover:bg-rose-500/[0.2]'
          }`}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : mode === 'add' ? (
            <Plus className="h-4 w-4" strokeWidth={2} />
          ) : (
            <RemoveX className="h-4 w-4" strokeWidth={2} />
          )}
          {mode === 'add' ? 'Add' : 'Remove'} for {selectedCount || '0'} selected
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        One slug per submit. The same selection persists after a
        successful apply so you can chain multiple slug edits on the
        same batch, handy when seeding several disciplines from one
        specialty group.
      </p>
    </form>
  );
}

function ModeButton({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] transition-colors ${
        active
          ? 'bg-violet-500/[0.18] text-violet-200'
          : 'text-zinc-400 hover:text-zinc-200'
      }`}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {label}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function StatusBanner({ status }: { status: Status }) {
  if (status.kind === 'idle') return null;
  if (status.kind === 'success') {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-300" strokeWidth={2} />
        <p className="text-sm text-emerald-200">
          {status.mode === 'add' ? 'Added' : 'Removed'}{' '}
          <code className="font-mono text-emerald-100">{status.slug}</code>{' '}
          on <strong className="font-semibold">{status.updated}</strong>{' '}
          inspector{status.updated === 1 ? '' : 's'}.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3">
      <AlertTriangle className="h-4 w-4 text-rose-300" strokeWidth={2} />
      <p className="text-sm text-rose-200">{status.message}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function InspectorTable({
  inspectors,
  selectedIds,
  onToggle,
  allVisibleSelected,
  onSelectAll,
  onClearAll,
}: {
  inspectors: readonly BulkInspectorRow[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  allVisibleSelected: boolean;
  onSelectAll: () => void;
  onClearAll: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSelectAll}
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-violet-500/30 hover:bg-violet-500/[0.08] hover:text-violet-300"
          disabled={allVisibleSelected}
        >
          Select all visible
        </button>
        <button
          type="button"
          onClick={onClearAll}
          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-white/[0.12] hover:text-zinc-200"
        >
          Clear selection
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/[0.06]">
        <table className="w-full text-left">
          <thead className="bg-white/[0.02] text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-500">
            <tr>
              <th className="w-10 px-3 py-2"></th>
              <th className="px-3 py-2 font-medium">Inspector</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">
                Specialties
              </th>
              <th className="hidden px-3 py-2 text-right font-medium md:table-cell">
                Rating
              </th>
              <th className="hidden px-3 py-2 text-right font-medium lg:table-cell">
                Jobs
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            {inspectors.map((i) => (
              <InspectorRow
                key={i.id}
                inspector={i}
                selected={selectedIds.has(i.id)}
                onToggle={() => onToggle(i.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InspectorRow({
  inspector,
  selected,
  onToggle,
}: {
  inspector: BulkInspectorRow;
  selected: boolean;
  onToggle: () => void;
}) {
  const label =
    inspector.full_name?.trim() ||
    inspector.email ||
    inspector.id.slice(0, 8);
  return (
    <tr className={selected ? 'bg-violet-500/[0.04]' : undefined}>
      <td className="px-3 py-2.5 align-top">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${label}`}
          className="h-4 w-4 cursor-pointer rounded border-white/[0.18] bg-ink-900 text-violet-500 focus:ring-violet-500/40"
        />
      </td>
      <td className="px-3 py-2.5">
        <Link
          href={`/admin/users/${inspector.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-100 transition-colors hover:text-violet-300"
        >
          {label}
          <ExternalLink className="h-3 w-3 text-zinc-500" strokeWidth={2} />
        </Link>
        {inspector.email && inspector.full_name && (
          <p className="font-mono text-[10px] text-zinc-500">
            {inspector.email}
          </p>
        )}
        {inspector.specialty_slugs.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {inspector.specialty_slugs.slice(0, 6).map((s) => (
              <span
                key={s}
                className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
              >
                {s}
              </span>
            ))}
            {inspector.specialty_slugs.length > 6 && (
              <span className="font-mono text-[10px] text-zinc-500">
                +{inspector.specialty_slugs.length - 6} more
              </span>
            )}
          </div>
        )}
      </td>
      <td className="hidden px-3 py-2.5 text-right align-top font-mono text-[11px] text-zinc-400 sm:table-cell">
        {inspector.specialty_slugs.length}
      </td>
      <td className="hidden px-3 py-2.5 text-right align-top md:table-cell">
        {inspector.rating_average == null ? (
          <span className="font-mono text-[11px] text-zinc-600">—</span>
        ) : (
          <span className="font-mono text-[11px] text-zinc-300">
            {inspector.rating_average.toFixed(2)}
            <span className="text-zinc-500">
              {' '}
              ({inspector.rating_count ?? 0})
            </span>
          </span>
        )}
      </td>
      <td className="hidden px-3 py-2.5 text-right align-top font-mono text-[11px] text-zinc-400 lg:table-cell">
        {inspector.completed_jobs_count ?? 0}
      </td>
    </tr>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-5 text-center">
      <p className="text-sm leading-relaxed text-zinc-300">
        No inspectors match the current filter.
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-zinc-500">
        Loosen the <span className="font-mono">has</span> filter, drop
        the <span className="font-mono">hasnt</span> filter, or clear
        the search box and re-apply.
      </p>
    </div>
  );
}
