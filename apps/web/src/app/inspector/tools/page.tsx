'use client';
// /inspector/tools — Engineering Tool Foundry (list surface).
// 100% data-driven from `engineering_tools` via fetchEngineeringTools():
// categories, search and cards all come from rows. Adding a tool in SQL makes it
// appear here with no code change. Mirrors mobile app/tools/index.tsx.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Calculator, FileText, Lock, ChevronRight, Construction } from 'lucide-react';
import {
  fetchEngineeringTools,
  catLabel,
  catColor,
  type EngineeringTool,
} from '@/lib/data/tools';

export default function ToolsListPage() {
  const [tools, setTools] = useState<EngineeringTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');

  useEffect(() => {
    fetchEngineeringTools()
      .then(setTools)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load tools.'))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => Array.from(new Set(tools.map((t) => t.category))).sort(),
    [tools],
  );
  const chips = useMemo(() => ['all', ...categories], [categories]);
  const list = useMemo(
    () =>
      tools.filter(
        (tl) =>
          (cat === 'all' || tl.category === cat) &&
          (q.trim() === '' ||
            `${tl.title} ${tl.subtitle ?? ''}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [tools, cat, q],
  );

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-widest text-violet-glow">
            Engineering
          </p>
          <h1 className="mt-1 text-2xl font-extrabold">Engineering Tools</h1>
          <p className="mt-1 text-sm text-white/60">Field-grade calculators, sealed results</p>
        </div>
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet/15 sm:flex">
          <Construction size={20} className="text-violet-glow" />
        </span>
      </header>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-xl border border-ink-600 bg-ink-800 px-3.5">
        <Search size={16} className="shrink-0 text-white/40" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tools…"
          className="h-11 w-full bg-transparent text-sm text-white placeholder-white/40 outline-none"
        />
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => {
          const active = c === cat;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setCat(c)}
              className={
                active
                  ? 'rounded-full border border-violet bg-violet px-3.5 py-1.5 text-xs font-bold text-white'
                  : 'rounded-full border border-ink-600 bg-ink-800 px-3.5 py-1.5 text-xs font-semibold text-white/60 transition hover:border-violet/60 hover:text-white'
              }
            >
              {catLabel(c)}
            </button>
          );
        })}
      </div>

      {/* Cards */}
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-ink-600 bg-ink-800" />
          ))}
        </div>
      ) : error ? (
        <p className="rounded-xl border border-accent-red/40 bg-accent-red/10 p-4 text-sm text-accent-red">
          {error}
        </p>
      ) : list.length === 0 ? (
        <p className="rounded-xl border border-ink-600 bg-ink-800 p-10 text-center text-sm text-white/50">
          No tools match your search.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((tool) => {
            const accent = catColor(tool.category);
            const Icon = tool.engine === 'edge' ? FileText : Calculator;
            return (
              <Link
                key={tool.key}
                href={`/inspector/tools/${tool.key}`}
                className="group flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 p-4 transition hover:border-violet/60"
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${accent}22` }}
                >
                  <Icon size={20} style={{ color: accent }} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate text-sm font-bold">{tool.title}</p>
                    {tool.access_tier === 'pro' && (
                      <Lock size={12} className="shrink-0 text-white/40" />
                    )}
                  </div>
                  {tool.subtitle && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-white/55">{tool.subtitle}</p>
                  )}
                  <p
                    className="mt-1 text-[10px] font-extrabold uppercase tracking-widest"
                    style={{ color: accent }}
                  >
                    {catLabel(tool.category)}
                  </p>
                </div>
                <ChevronRight
                  size={16}
                  className="shrink-0 text-white/30 transition group-hover:text-white/60"
                />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
