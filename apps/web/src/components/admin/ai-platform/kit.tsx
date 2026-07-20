'use client';
// ════════════════════════════════════════════════════════════════════════════
//  components/admin/ai-platform/kit.tsx — shared AI Platform building blocks.
//  Reuses the existing admin design tokens (ink/violet, rounded-2xl, zinc text)
//  — NO new theme. Everything consumes the existing /api/ai-ops/* endpoints;
//  every list/stat handles loading, empty, error, and sparse-data safely.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, AlertCircle, Inbox, RefreshCw, ChevronLeft, ChevronRight, Search, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';

// ── formatting (consistent across the module) ──
export const nf = (n: number | null | undefined): string => (n == null ? '—' : new Intl.NumberFormat('en-US').format(n));
export const pct = (n: number | null | undefined, digits = 0): string => (n == null ? '—' : `${(n * 100).toFixed(digits)}%`);
export const dt = (s: string | null | undefined): string => {
  if (!s) return '—';
  const d = new Date(s); if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
export const dOnly = (s: string | null | undefined): string => {
  if (!s) return '—'; const d = new Date(s); return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};
export const short = (s: string | null | undefined, n = 10): string => (!s ? '—' : s.length <= n ? s : `${s.slice(0, n)}…`);

// ── data hook ──
export interface FetchState<T> { data: T | null; error: string | null; loading: boolean; reload: () => void; }
export function useAiOps<T = unknown>(url: string | null): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    if (!url) return;
    let alive = true; setLoading(true); setError(null);
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.code === 'not_provisioned' ? 'NOT_PROVISIONED' : (j?.error ?? `Request failed (${r.status}).`));
        return j;
      })
      .then((j) => { if (alive) { setData(j as T); setLoading(false); } })
      .catch((e) => { if (alive) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [url, nonce]);
  return { data, error, loading, reload };
}

// ── primitives ──
export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-2xl border border-white/[0.06] bg-ink-900/40 p-5', className)}>{children}</div>;
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-zinc-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, sub, href, tone = 'default', hint }: {
  label: string; value: React.ReactNode; sub?: string; href?: string;
  tone?: 'default' | 'violet' | 'green' | 'amber' | 'red'; hint?: string;
}) {
  const toneCls = {
    default: 'text-white', violet: 'text-violet-glow', green: 'text-accent-green',
    amber: 'text-accent-amber', red: 'text-accent-red',
  }[tone];
  const body = (
    <div className="group rounded-2xl border border-white/[0.06] bg-ink-900/40 p-4 transition hover:border-violet/30">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-industrial text-zinc-500" title={hint}>{label}</p>
      <p className={cn('mt-1.5 font-display text-2xl font-semibold', toneCls)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const BADGE: Record<string, string> = {
  pending: 'bg-white/10 text-zinc-300', reviewed: 'bg-sky-500/15 text-sky-300',
  accepted: 'bg-accent-green/15 text-accent-green', rejected: 'bg-accent-red/15 text-accent-red',
  hard_example: 'bg-accent-amber/15 text-accent-amber', golden_sample: 'bg-violet/15 text-violet-glow',
  training_candidate: 'bg-cyan-500/15 text-cyan-300', archived: 'bg-white/5 text-zinc-500', deleted: 'bg-accent-red/10 text-accent-red/80',
  completed: 'bg-accent-green/15 text-accent-green', running: 'bg-sky-500/15 text-sky-300', failed: 'bg-accent-red/15 text-accent-red',
  draft: 'bg-white/10 text-zinc-300', connected: 'bg-accent-green/15 text-accent-green', unconfigured: 'bg-white/5 text-zinc-500',
};
export function StatusBadge({ value }: { value: string | null | undefined }) {
  const v = (value ?? 'unknown').toString();
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', BADGE[v] ?? 'bg-white/10 text-zinc-300')}>{v.replace(/_/g, ' ')}</span>;
}

export function EmptyState({ title, body, cta }: { title: string; body: string; cta?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.03]"><Inbox size={22} className="text-zinc-500" /></div>
      <p className="mt-3 text-sm font-semibold text-white">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-zinc-500">{body}</p>
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
export function ErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  const provision = error === 'NOT_PROVISIONED' || /relation .* does not exist|not_provisioned|schema cache|Could not find the table/i.test(error);
  return (
    <div className="rounded-2xl border border-accent-amber/25 bg-accent-amber/[0.06] p-8 text-center">
      <AlertCircle className="mx-auto h-6 w-6 text-accent-amber" />
      <p className="mt-2 text-sm font-semibold text-white">{provision ? 'AI‑Ops backend not provisioned yet' : 'Could not load'}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-zinc-400">{provision ? 'The AI‑Ops foundation migration has not been applied to this database. Run `supabase db push`, then reload.' : error}</p>
      {onRetry && <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:text-white"><RefreshCw size={13} /> Retry</button>}
    </div>
  );
}
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return <div className="space-y-2">{Array.from({ length: rows }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.02]" />)}</div>;
}
export function Loading() {
  return <div className="flex items-center gap-2 py-10 text-sm text-zinc-500"><Loader2 size={15} className="animate-spin" /> Loading…</div>;
}

// ── AiTable: paginated/sortable/searchable list over /api/ai-ops/[resource] ──
export interface Column<R = Record<string, unknown>> {
  key: string; label: string; sortable?: boolean; className?: string;
  render?: (row: R) => React.ReactNode;
}
export interface ListResponse<R = Record<string, unknown>> { rows: R[]; page: number; pageSize: number; total: number; }

export function AiTable<R extends Record<string, unknown>>({
  resource, columns, defaultSort, searchable = true, initialFilters, emptyTitle, emptyBody, onRowClick, rightSlot,
}: {
  resource: string; columns: Column<R>[]; defaultSort?: string; searchable?: boolean;
  initialFilters?: Record<string, string>; emptyTitle?: string; emptyBody?: string;
  onRowClick?: (row: R) => void; rightSlot?: React.ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>(defaultSort);
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const filters = initialFilters ?? {};

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [debounced, sort, dir, JSON.stringify(initialFilters)]);

  const url = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '25', dir });
    if (sort) p.set('sort', sort);
    if (debounced) p.set('search', debounced);
    for (const [k, v] of Object.entries(filters)) if (v) p.set(`f.${k}`, v);
    return `/api/ai-ops/${resource}?${p.toString()}`;
  }, [resource, page, sort, dir, debounced, JSON.stringify(filters)]);

  const { data, error, loading, reload } = useAiOps<ListResponse<R>>(url);
  const toggleSort = (k: string) => { if (sort === k) setDir((d) => (d === 'asc' ? 'desc' : 'asc')); else { setSort(k); setDir('desc'); } };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {(searchable || rightSlot) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {searchable ? (
            <div className="relative w-full max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" aria-label="Search this table"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-950 py-2 pl-9 pr-3 text-sm text-white outline-none focus:border-violet" />
            </div>
          ) : <div />}
          {rightSlot}
        </div>
      )}
      {loading && !data ? <TableSkeleton /> : rows.length === 0 ? (
        <EmptyState title={emptyTitle ?? 'Nothing here yet'} body={emptyBody ?? 'This list populates as field inspections and reviews flow through the pipeline.'} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.02] text-[11px] uppercase tracking-wide text-zinc-500">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={cn('px-4 py-2.5 font-semibold', c.className)}>
                      {c.sortable ? (
                        <button onClick={() => toggleSort(c.key)} className={cn('inline-flex items-center gap-1 hover:text-white', sort === c.key && 'text-violet-glow')}>
                          {c.label} <ArrowUpDown size={11} />
                        </button>
                      ) : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rows.map((row, i) => (
                  <tr key={(row.id as string) ?? (row.image_id as string) ?? i}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn('transition', onRowClick && 'cursor-pointer hover:bg-white/[0.02]')}>
                    {columns.map((c) => (
                      <td key={c.key} className={cn('px-4 py-2.5 text-zinc-300', c.className)}>
                        {c.render ? c.render(row) : String(row[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.06] bg-white/[0.01] px-4 py-2.5 text-xs text-zinc-500">
            <span>{nf(total)} row{total === 1 ? '' : 's'} · page {page}/{maxPage}</span>
            <div className="flex items-center gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 disabled:opacity-40"><ChevronLeft size={13} /> Prev</button>
              <button disabled={page >= maxPage} onClick={() => setPage((p) => Math.min(maxPage, p + 1))} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 disabled:opacity-40">Next <ChevronRight size={13} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
