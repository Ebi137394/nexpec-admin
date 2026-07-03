// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/components/search/GlobalSearch.tsx
//
//  Sprint 13.4 — Cmd+K global search overlay.
//
//  Client-side only. Mounted once at the root layout. Listens for Cmd/Ctrl+K
//  (and forward-slash on inspector/admin contexts where the user expects
//  it). Renders a centred modal with a search input + grouped result list.
//
//  Calls the global_search RPC on every keystroke (debounced 180ms). The
//  RPC is SECURITY DEFINER and filters by viewer permission, so anonymous
//  visitors get inspector-only results and signed-in users get the full
//  permission-aware set.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import {
  Search,
  Loader2,
  Users,
  Briefcase,
  ClipboardList,
  ArrowRight,
} from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

interface ResultItem {
  kind: 'inspector' | 'job' | 'scope_template';
  id: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
}

interface RpcResponse {
  query: string;
  results: {
    inspectors: ResultItem[];
    jobs: ResultItem[];
    scopes: ResultItem[];
  };
}

const DEBOUNCE_MS = 180;

/**
 * Baseline global_search still emits stale routes: scope templates moved to
 * /admin/compliance/templates, job hits can arrive as public-profile paths
 * (/p/<uuid>), and the admin jobs deep-link param was renamed focus →
 * inspect. The server-side fix (rewriting the DB function) is deferred to a
 * future migration, so normalize hrefs client-side wherever they are used.
 */
function normalizeHref(kind: string, href: string): string {
  let out = href;
  // (a) Scope-template results → compliance templates. Prefix swap keeps any
  //     trailing segment or #fragment intact. No-op if already correct.
  if (kind.startsWith('scope') || out.startsWith('/admin/scope-templates')) {
    out = out.replace(/^\/admin\/scope-templates/, '/admin/compliance/templates');
  }
  // (b) Job results emitted as /p/<uuid> profile paths → /jobs/<uuid>.
  if (kind === 'job') {
    const m = out.match(
      /^\/p\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(.*)$/,
    );
    if (m) out = `/jobs/${m[1]}${m[2]}`;
  }
  // (c) Renamed admin jobs inspector-drawer param.
  if (out.startsWith('/admin/jobs?focus=')) {
    out = out.replace('?focus=', '?inspect=');
  }
  return out;
}

export function GlobalSearch() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RpcResponse['results'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ─── Keyboard shortcut: Cmd/Ctrl+K toggles ─────────────────────── */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (open && e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  /* ─── Auto-focus when opened ────────────────────────────────────── */
  useEffect(() => {
    if (open) {
      // Allow modal mount before focusing.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    } else {
      // Reset state on close.
      setQuery('');
      setResults(null);
      setActiveIdx(0);
    }
  }, [open]);

  /* ─── Debounced RPC call ────────────────────────────────────────── */
  const runSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (trimmed.length < 2) {
        setResults(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('global_search', {
          p_query: trimmed,
          p_limit: 8,
        });
        if (error) {
          console.error('[GlobalSearch] rpc error', error);
          setResults(null);
        } else {
          const payload = data as RpcResponse | null;
          setResults(payload?.results ?? null);
          setActiveIdx(0);
        }
      } catch (err) {
        console.error('[GlobalSearch] rpc threw', err);
        setResults(null);
      } finally {
        setLoading(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  /* ─── Flatten results for keyboard nav ──────────────────────────── */
  const flat = useMemo<ResultItem[]>(() => {
    if (!results) return [];
    return [
      ...(results.inspectors ?? []),
      ...(results.jobs ?? []),
      ...(results.scopes ?? []),
    ];
  }, [results]);

  const totalCount = flat.length;

  /* ─── Keyboard nav inside the modal ─────────────────────────────── */
  function onKeyDownInput(e: React.KeyboardEvent<HTMLInputElement>) {
    if (totalCount === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % totalCount);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + totalCount) % totalCount);
    } else if (e.key === 'Enter' && flat[activeIdx]) {
      const href = normalizeHref(flat[activeIdx].kind, flat[activeIdx].href);
      setOpen(false);
      // Native nav so the modal unmounts cleanly + focus follows.
      window.location.href = href;
    }
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm" aria-hidden />

      {/* Card */}
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-b from-ink-800/90 to-ink-900/90 shadow-2xl backdrop-blur-xl">
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-300" strokeWidth={2} />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-zinc-500" strokeWidth={2} />
          )}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDownInput}
            placeholder="Search inspectors, jobs, scope templates…"
            className="flex-1 bg-transparent text-base text-white placeholder:text-zinc-500 focus:outline-none"
            autoComplete="off"
          />
          <kbd className="hidden shrink-0 items-center rounded-md border border-white/[0.10] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-400 sm:inline-flex">
            Esc
          </kbd>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto">
          {!results && !loading && (
            <EmptyHint />
          )}
          {results && totalCount === 0 && !loading && (
            <NoResults query={query} />
          )}
          {results && totalCount > 0 && (
            <ResultGroups
              results={results}
              activeIdx={activeIdx}
              flat={flat}
              onSelect={() => setOpen(false)}
            />
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between border-t border-white/[0.06] bg-white/[0.01] px-4 py-2">
          <p className="text-[10px] font-mono uppercase tracking-industrial text-zinc-500">
            {totalCount > 0 ? `${totalCount} match${totalCount === 1 ? '' : 'es'}` : 'Type to search'}
          </p>
          <div className="hidden items-center gap-2 sm:flex">
            <Hint k="↑↓" t="navigate" />
            <Hint k="↵" t="open" />
            <Hint k="esc" t="close" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function ResultGroups({
  results,
  activeIdx,
  flat,
  onSelect,
}: {
  results: RpcResponse['results'];
  activeIdx: number;
  flat: ResultItem[];
  onSelect: () => void;
}) {
  const groups: Array<{ label: string; icon: typeof Users; rows: ResultItem[] }> = [
    { label: 'Inspectors', icon: Users, rows: results.inspectors ?? [] },
    { label: 'Jobs', icon: Briefcase, rows: results.jobs ?? [] },
    { label: 'Scope templates', icon: ClipboardList, rows: results.scopes ?? [] },
  ];
  return (
    <div className="divide-y divide-white/[0.04]">
      {groups.map((g, gi) => {
        if (g.rows.length === 0) return null;
        const Icon = g.icon;
        return (
          <section key={g.label} className="p-2">
            <p className="px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
              <Icon className="mr-1.5 inline-block h-3 w-3" strokeWidth={2} />
              {g.label}
            </p>
            <ul className="space-y-0.5">
              {g.rows.map((r) => {
                const idx = flat.indexOf(r);
                const isActive = idx === activeIdx;
                return (
                  <li key={`${r.kind}-${r.id}`}>
                    <Link
                      href={normalizeHref(r.kind, r.href)}
                      onClick={onSelect}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                        isActive
                          ? 'bg-violet-500/[0.12] text-white'
                          : 'text-zinc-200 hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.title}</p>
                        <p className="truncate text-[12px] text-zinc-500">{r.subtitle}</p>
                      </div>
                      <ArrowRight
                        className={`h-3.5 w-3.5 shrink-0 ${
                          isActive ? 'text-violet-300' : 'text-zinc-600'
                        }`}
                        strokeWidth={2}
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="px-4 py-8 text-center">
      <Search className="mx-auto h-5 w-5 text-zinc-600" strokeWidth={2} />
      <p className="mt-3 text-sm text-zinc-400">
        Search across inspectors, your jobs, and scope templates.
      </p>
      <p className="mt-1 text-[12px] text-zinc-500">
        Press <Kbd>⌘</Kbd>+<Kbd>K</Kbd> any time to reopen.
      </p>
    </div>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm text-zinc-300">
        No matches for <span className="font-mono text-zinc-100">{query}</span>
      </p>
      <p className="mt-1 text-[12px] text-zinc-500">
        Try fewer words, or another spelling.
      </p>
    </div>
  );
}

function Hint({ k, t }: { k: string; t: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
      <Kbd>{k}</Kbd>
      {t}
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded border border-white/[0.10] bg-white/[0.04] px-1 py-0.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-400">
      {children}
    </kbd>
  );
}
