// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/admin/users/specialties-bulk/page.tsx
//
//  Server component. Drives the bulk specialty assigner page that
//  multiplies inspector-seeding throughput during a domain launch.
//
//  Route: /admin/users/specialties-bulk
//
//  Filter is URL-driven (GET form) — sharable + refresh-safe. The
//  table + checkbox selection + submit action all live in the
//  BulkClient island.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowLeft,
  Filter,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { DISCIPLINES } from '@nexpec/shared-core';
import {
  fetchBulkInspectorList,
  parseSlugList,
} from '@/lib/data/inspectorBulkList';
import { BulkClient } from './BulkClient';

export const metadata: Metadata = {
  title: 'Bulk specialty assigner · NEXPEC Admin',
  description:
    'Add or remove canonical kebab discipline slugs across multiple inspectors.',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{
    has?: string | string[];
    hasnt?: string | string[];
    search?: string;
  }>;
}

export default async function BulkSpecialtiesPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const has = parseSlugList(sp.has);
  const hasnt = parseSlugList(sp.hasnt);
  const search = typeof sp.search === 'string' ? sp.search.trim() : '';

  const inspectors = await fetchBulkInspectorList({
    has,
    hasnt,
    search: search.length > 0 ? search : undefined,
    limit: 200,
  });

  const allSlugs = DISCIPLINES.map((d) => d.slug).sort();

  return (
    <div className="space-y-8">
      <Header />
      <FilterCard
        defaultHas={has.join(',')}
        defaultHasnt={hasnt.join(',')}
        defaultSearch={search}
        allSlugs={allSlugs}
      />
      <BulkClient
        inspectors={inspectors}
        allSlugs={allSlugs}
        filterEcho={{ has, hasnt, search }}
      />
      <Footnote />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Header() {
  return (
    <header className="space-y-3">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={2} />
        Back to Users
      </Link>

      <p className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">
        <Sparkles className="h-3 w-3" strokeWidth={2} />
        Bulk User Management
      </p>

      <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Bulk specialty assigner
      </h1>

      <p className="max-w-3xl text-sm leading-relaxed text-zinc-400">
        Add or remove a single canonical kebab discipline slug across
        many inspector profiles in one transaction. Built to multiply the
        throughput of inspector-pool seeding during a domain launch — see{' '}
        <code className="font-mono text-zinc-300">
          DOMAIN_LAUNCH_PLAYBOOK.md
        </code>
        . Three-layer admin gate (server-action re-check, RPC
        re-check, RLS write policy).
      </p>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function FilterCard({
  defaultHas,
  defaultHasnt,
  defaultSearch,
  allSlugs,
}: {
  defaultHas: string;
  defaultHasnt: string;
  defaultSearch: string;
  allSlugs: string[];
}) {
  return (
    <article className="rounded-2xl border border-white/[0.08] bg-ink-900/40 p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <Filter className="h-4 w-4 text-violet-300" strokeWidth={2} />
        <h3 className="font-display text-lg font-semibold text-white">
          Filter inspector pool
        </h3>
      </div>

      <p className="mb-5 text-sm leading-relaxed text-zinc-400">
        URL-driven — filters persist on refresh and can be shared with a
        teammate by copy-pasting the URL. Slug inputs accept
        comma-separated lists and autocomplete from the canonical
        taxonomy.
      </p>

      <form
        action="/admin/users/specialties-bulk"
        method="GET"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <FilterField
          label="Has at least one of (kebab slugs, comma-separated)"
          name="has"
          defaultValue={defaultHas}
          placeholder="e.g. aws-cwi,api-510"
          allSlugs={allSlugs}
          listId="filter-has-list"
        />
        <FilterField
          label="Does NOT have any of"
          name="hasnt"
          defaultValue={defaultHasnt}
          placeholder="e.g. nuclear-inspection"
          allSlugs={allSlugs}
          listId="filter-hasnt-list"
        />
        <div className="sm:col-span-2">
          <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Name or email search
          </label>
          <input
            type="text"
            name="search"
            defaultValue={defaultSearch}
            placeholder="ilike substring"
            className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-ink-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/40 focus:bg-ink-950 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg border border-violet-500/40 bg-violet-500/[0.12] px-4 py-2 text-sm font-semibold text-violet-200 transition-colors hover:border-violet-500/60 hover:bg-violet-500/[0.2] hover:text-violet-100"
          >
            Apply filter
          </button>
          <Link
            href="/admin/users/specialties-bulk"
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Reset
          </Link>
        </div>
      </form>
    </article>
  );
}

function FilterField({
  label,
  name,
  defaultValue,
  placeholder,
  allSlugs,
  listId,
}: {
  label: string;
  name: string;
  defaultValue: string;
  placeholder: string;
  allSlugs: string[];
  listId: string;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </label>
      <input
        type="text"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        list={listId}
        className="mt-1.5 w-full rounded-lg border border-white/[0.08] bg-ink-950/60 px-3 py-2 font-mono text-[12px] text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/40 focus:bg-ink-950 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
      />
      <datalist id={listId}>
        {allSlugs.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Footnote() {
  return (
    <footer className="rounded-xl border border-white/[0.04] bg-white/[0.01] p-4">
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
        <ShieldCheck
          className="mt-0.5 h-3 w-3 shrink-0 text-violet-glow"
          strokeWidth={2}
        />
        <span>
          The bulk update is atomic at the database layer via{' '}
          <code className="font-mono text-zinc-400">
            bulk_update_inspector_specialties
          </code>
          {' '}— set semantics, duplicates collapsed,{' '}
          <code className="font-mono text-zinc-400">remove</code> beats{' '}
          <code className="font-mono text-zinc-400">add</code>. The RPC
          itself re-checks <code className="font-mono text-zinc-400">nx_is_admin()</code>{' '}
          and only ever touches profiles WHERE{' '}
          <code className="font-mono text-zinc-400">role = &apos;inspector&apos;</code>{' '}
          AND <code className="font-mono text-zinc-400">deleted_at IS NULL</code>{' '}
          — never a client or admin row. After every successful submit,{' '}
          <code className="font-mono text-zinc-400">/admin/domains</code>{' '}
          and its readiness pages are revalidated so the new pool counts
          reflect immediately.
        </span>
      </p>
    </footer>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

// BulkClient is the client island — selection state, slug input,
// add/remove radio, submit. Lives in ./BulkClient.tsx because the
// rest of this page is fully server-rendered.
