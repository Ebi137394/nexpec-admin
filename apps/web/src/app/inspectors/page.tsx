// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/app/inspectors/page.tsx
//
//  Public Inspector Directory — accessible to anyone (anonymous +
//  authenticated). Server component. URL-driven filter state.
//
//  Reads from public.inspectors_directory view (see migration
//  20260630120000_public_inspectors_directory_view.sql). The view is
//  the column-whitelisted public surface; this page never touches
//  public.profiles directly.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import {
  Search,
  MapPin,
  Filter,
  Star,
  ShieldCheck,
  Briefcase,
  ArrowRight,
  Users,
} from 'lucide-react';
import { DISCIPLINES } from '@nexpec/shared-core';
import {
  fetchInspectorsDirectoryPage,
  parseSpecialtiesParam,
  parseSortParam,
  parseMinRatingParam,
  DIRECTORY_DEFAULTS,
  type InspectorDirectoryRow,
  type DirectorySort,
} from '@/lib/data/inspectorsDirectory';

export const metadata: Metadata = {
  title: 'Find an inspector · NEXPEC',
  description:
    'Browse verified industrial, civil, electrical, mechanical, and chemical inspectors. Filter by location, specialty, and rating.',
  alternates: { canonical: '/inspectors' },
  openGraph: {
    title: 'Find an inspector · NEXPEC',
    description:
      'Browse verified industrial, civil, electrical, mechanical, and chemical inspectors. Filter by location, specialty, and rating.',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{
    search?: string;
    city?: string;
    specialties?: string | string[];
    minRating?: string;
    verified?: string;
    sort?: string;
    page?: string;
  }>;
}

export default async function InspectorsDirectoryPage({
  searchParams,
}: PageProps) {
  const sp = (await searchParams) ?? {};
  const search = typeof sp.search === 'string' ? sp.search.trim() : '';
  const city = typeof sp.city === 'string' ? sp.city.trim() : '';
  const specialties = parseSpecialtiesParam(sp.specialties);
  const minRating = parseMinRatingParam(sp.minRating);
  const verifiedOnly = sp.verified === '1' || sp.verified === 'true';
  const sort: DirectorySort = parseSortParam(sp.sort);
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);

  const result = await fetchInspectorsDirectoryPage({
    search: search || undefined,
    city: city || undefined,
    specialties,
    minRating,
    verifiedOnly,
    sort,
    page,
    pageSize: DIRECTORY_DEFAULTS.PAGE_SIZE,
  });

  const allSpecialtySlugs = DISCIPLINES.map((d) => d.slug).sort();

  return (
    <main className="container-narrow py-12 sm:py-16">
      <DirectoryHeader total={result.total} />

      <FilterCard
        defaultSearch={search}
        defaultCity={city}
        defaultSpecialties={specialties.join(',')}
        defaultMinRating={minRating ?? ''}
        defaultVerified={verifiedOnly}
        defaultSort={sort}
        allSpecialtySlugs={allSpecialtySlugs}
      />

      <SortStrip
        sort={sort}
        total={result.total}
        page={page}
        pageSize={result.pageSize}
        echoFilters={{
          search,
          city,
          specialties,
          minRating,
          verified: verifiedOnly,
        }}
      />

      {result.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <section
          aria-label="Inspector results"
          className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {result.rows.map((row) => (
            <InspectorCard key={row.id} row={row} />
          ))}
        </section>
      )}

      <Pagination
        currentPage={result.page}
        totalPages={result.totalPages}
        echoFilters={{
          search,
          city,
          specialties: specialties.join(','),
          minRating: minRating ?? '',
          verified: verifiedOnly,
          sort,
        }}
      />

      <Footnote />
    </main>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function DirectoryHeader({ total }: { total: number }) {
  return (
    <header className="space-y-3">
      <p className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-300">
        <Users className="h-3 w-3" strokeWidth={2} />
        Inspector Directory
      </p>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Find an inspector
      </h1>
      <p className="max-w-2xl text-pretty text-sm leading-relaxed text-zinc-400">
        Browse verified industrial, civil, electrical, mechanical, and
        chemical inspectors. Filter by city, specialty, and rating to
        find the right person for the job, then click through to a
        public trust profile with reviews.{' '}
        <strong className="text-zinc-200">{total.toLocaleString()}</strong>{' '}
        active inspector{total === 1 ? '' : 's'} indexed.
      </p>
    </header>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function FilterCard({
  defaultSearch,
  defaultCity,
  defaultSpecialties,
  defaultMinRating,
  defaultVerified,
  defaultSort,
  allSpecialtySlugs,
}: {
  defaultSearch: string;
  defaultCity: string;
  defaultSpecialties: string;
  defaultMinRating: number | '';
  defaultVerified: boolean;
  defaultSort: DirectorySort;
  allSpecialtySlugs: string[];
}) {
  return (
    <article className="mt-8 rounded-2xl border border-white/[0.08] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <Filter className="h-4 w-4 text-violet-300" strokeWidth={2} />
        <h2 className="font-display text-lg font-semibold text-white">
          Filter
        </h2>
      </div>

      <form
        action="/inspectors"
        method="GET"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        <Field label="Search name or headline" name="search">
          <input
            type="text"
            name="search"
            defaultValue={defaultSearch}
            placeholder="e.g. CWI senior, API 510"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="City" name="city">
          <input
            type="text"
            name="city"
            defaultValue={defaultCity}
            placeholder="e.g. Toronto"
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Specialties (kebab slugs, comma-separated)" name="specialties">
          <input
            type="text"
            name="specialties"
            defaultValue={defaultSpecialties}
            placeholder="e.g. aws-cwi,api-510"
            list="dir-specialties-list"
            className={`${INPUT_CLASS} font-mono text-[12px]`}
          />
          <datalist id="dir-specialties-list">
            {allSpecialtySlugs.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label="Min rating (0-5)" name="minRating">
          <select
            name="minRating"
            defaultValue={defaultMinRating === '' ? '' : String(defaultMinRating)}
            className={INPUT_CLASS}
          >
            <option value="">Any</option>
            <option value="3">3 ★ and up</option>
            <option value="4">4 ★ and up</option>
            <option value="4.5">4.5 ★ and up</option>
          </select>
        </Field>

        <div className="flex items-center gap-2 sm:col-span-2">
          <input
            id="filter-verified"
            type="checkbox"
            name="verified"
            value="1"
            defaultChecked={defaultVerified}
            className="h-4 w-4 cursor-pointer rounded border-white/[0.18] bg-ink-900 text-violet-500 focus:ring-violet-500/40"
          />
          <label
            htmlFor="filter-verified"
            className="cursor-pointer text-sm text-zinc-300"
          >
            Verified inspectors only
          </label>
        </div>

        {/* Persist current sort across filter applies */}
        <input type="hidden" name="sort" value={defaultSort} />

        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            className="rounded-lg border border-violet-500/40 bg-violet-500/[0.12] px-4 py-2 text-sm font-semibold text-violet-200 transition-colors hover:border-violet-500/60 hover:bg-violet-500/[0.2] hover:text-violet-100"
          >
            Apply filter
          </button>
          <Link
            href="/inspectors"
            className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          >
            Reset
          </Link>
        </div>
      </form>
    </article>
  );
}

function Field({
  label,
  name,
  children,
}: {
  label: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="block font-mono text-[10px] uppercase tracking-industrial text-zinc-500"
      >
        {label}
      </label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

const INPUT_CLASS =
  'w-full rounded-lg border border-white/[0.08] bg-ink-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500/40 focus:bg-ink-950 focus:outline-none focus:ring-2 focus:ring-violet-500/20';

/* ─────────────────────────────────────────────────────────────────── */

function SortStrip({
  sort,
  total,
  page,
  pageSize,
  echoFilters,
}: {
  sort: DirectorySort;
  total: number;
  page: number;
  pageSize: number;
  echoFilters: {
    search: string;
    city: string;
    specialties: string[];
    minRating?: number;
    verified: boolean;
  };
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <p className="font-mono text-[11px] text-zinc-500">
        Showing{' '}
        <span className="text-zinc-300">
          {from.toLocaleString()}–{to.toLocaleString()}
        </span>{' '}
        of <span className="text-zinc-300">{total.toLocaleString()}</span>{' '}
        inspectors
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
          Sort
        </span>
        <SortLink current={sort} value="top_rated" label="Top rated" echo={echoFilters} />
        <SortLink current={sort} value="most_jobs" label="Most jobs" echo={echoFilters} />
        <SortLink current={sort} value="newest" label="Newest" echo={echoFilters} />
        <SortLink current={sort} value="alphabetical" label="A-Z" echo={echoFilters} />
      </div>
    </div>
  );
}

function SortLink({
  current,
  value,
  label,
  echo,
}: {
  current: DirectorySort;
  value: DirectorySort;
  label: string;
  echo: {
    search: string;
    city: string;
    specialties: string[];
    minRating?: number;
    verified: boolean;
  };
}) {
  const params = new URLSearchParams();
  if (echo.search) params.set('search', echo.search);
  if (echo.city) params.set('city', echo.city);
  if (echo.specialties.length > 0)
    params.set('specialties', echo.specialties.join(','));
  if (echo.minRating != null) params.set('minRating', String(echo.minRating));
  if (echo.verified) params.set('verified', '1');
  params.set('sort', value);

  const active = current === value;
  const classes = active
    ? 'border-violet-500/40 bg-violet-500/[0.16] text-violet-200'
    : 'border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:border-violet-500/30 hover:bg-violet-500/[0.08] hover:text-violet-300';

  return (
    <Link
      href={`/inspectors?${params.toString()}`}
      className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-industrial transition-colors ${classes}`}
    >
      {label}
    </Link>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function InspectorCard({ row }: { row: InspectorDirectoryRow }) {
  const name = row.full_name?.trim() || 'Inspector';
  const initials = name.slice(0, 2).toUpperCase();
  const isVerified = row.verification_status === 'verified';
  const rating = row.rating_average ?? 0;
  const ratingCount = row.rating_count ?? 0;
  const jobs = row.completed_jobs_count ?? 0;

  return (
    <Link
      href={`/p/${row.id}`}
      className="group flex h-full flex-col rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-5 transition-colors hover:border-violet-500/30 hover:bg-violet-500/[0.04]"
    >
      <div className="flex items-start gap-3">
        <div className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet to-cyan-glow ring-1 ring-white/[0.06]">
          {row.avatar_url ? (
            <Image
              src={row.avatar_url}
              alt={name}
              width={48}
              height={48}
              className="h-full w-full object-cover"
              unoptimized
            />
          ) : (
            <span className="font-display text-base font-semibold text-white">
              {initials}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-display text-base font-semibold text-white">
            <span className="truncate">{name}</span>
            {isVerified && (
              <ShieldCheck
                className="h-3.5 w-3.5 shrink-0 text-cyan-glow"
                strokeWidth={2}
                aria-label="Verified"
              />
            )}
          </p>
          {row.headline && (
            <p className="line-clamp-2 text-[12px] text-zinc-400">
              {row.headline}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        {(row.location_city || row.location_province) && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" strokeWidth={2} />
            {[row.location_city, row.location_province]
              .filter(Boolean)
              .join(', ')}
          </span>
        )}
        {rating > 0 && (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3 w-3 text-amber-300" strokeWidth={2} />
            <span className="text-zinc-300">{rating.toFixed(2)}</span>
            <span className="text-zinc-600">({ratingCount})</span>
          </span>
        )}
        {jobs > 0 && (
          <span className="inline-flex items-center gap-1">
            <Briefcase className="h-3 w-3" strokeWidth={2} />
            <span className="text-zinc-300">{jobs}</span>
            <span className="text-zinc-600">jobs</span>
          </span>
        )}
      </div>

      {row.specialty_slugs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {row.specialty_slugs.slice(0, 4).map((s) => (
            <span
              key={s}
              className="rounded border border-white/[0.06] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
            >
              {s}
            </span>
          ))}
          {row.specialty_slugs.length > 4 && (
            <span className="font-mono text-[10px] text-zinc-500">
              +{row.specialty_slugs.length - 4}
            </span>
          )}
        </div>
      )}

      <div className="mt-auto pt-4">
        <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-industrial text-violet-300 transition-colors group-hover:text-violet-200">
          View profile
          <ArrowRight
            className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
            strokeWidth={2}
          />
        </span>
      </div>
    </Link>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function EmptyState() {
  return (
    <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-8 text-center">
      <Search
        className="mx-auto h-6 w-6 text-amber-400"
        strokeWidth={2}
      />
      <h2 className="mt-3 font-display text-lg font-semibold text-white">
        No inspectors match those filters
      </h2>
      <p className="mt-1 text-sm text-zinc-400">
        Loosen the city filter, drop the verified-only checkbox, or
        clear the specialty slugs and re-apply.
      </p>
      <Link
        href="/inspectors"
        className="mt-4 inline-block rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-200 hover:border-violet-500/40 hover:text-white"
      >
        Reset filters
      </Link>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Pagination({
  currentPage,
  totalPages,
  echoFilters,
}: {
  currentPage: number;
  totalPages: number;
  echoFilters: {
    search: string;
    city: string;
    specialties: string;
    minRating: number | '';
    verified: boolean;
    sort: DirectorySort;
  };
}) {
  if (totalPages <= 1) return null;

  const buildHref = (p: number) => {
    const params = new URLSearchParams();
    if (echoFilters.search) params.set('search', echoFilters.search);
    if (echoFilters.city) params.set('city', echoFilters.city);
    if (echoFilters.specialties)
      params.set('specialties', echoFilters.specialties);
    if (echoFilters.minRating !== '')
      params.set('minRating', String(echoFilters.minRating));
    if (echoFilters.verified) params.set('verified', '1');
    params.set('sort', echoFilters.sort);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `/inspectors?${qs}` : '/inspectors';
  };

  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;

  return (
    <nav
      aria-label="Directory pagination"
      className="mt-10 flex items-center justify-between"
    >
      <Link
        href={prevDisabled ? '#' : buildHref(currentPage - 1)}
        aria-disabled={prevDisabled}
        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
          prevDisabled
            ? 'cursor-not-allowed border-white/[0.04] bg-white/[0.01] text-zinc-600'
            : 'border-white/[0.08] bg-white/[0.02] text-zinc-300 hover:border-violet-500/40 hover:bg-violet-500/[0.08] hover:text-violet-200'
        }`}
      >
        ← Previous
      </Link>
      <p className="font-mono text-[11px] text-zinc-500">
        Page <span className="text-zinc-300">{currentPage}</span> of{' '}
        <span className="text-zinc-300">{totalPages}</span>
      </p>
      <Link
        href={nextDisabled ? '#' : buildHref(currentPage + 1)}
        aria-disabled={nextDisabled}
        className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
          nextDisabled
            ? 'cursor-not-allowed border-white/[0.04] bg-white/[0.01] text-zinc-600'
            : 'border-white/[0.08] bg-white/[0.02] text-zinc-300 hover:border-violet-500/40 hover:bg-violet-500/[0.08] hover:text-violet-200'
        }`}
      >
        Next →
      </Link>
    </nav>
  );
}

/* ─────────────────────────────────────────────────────────────────── */

function Footnote() {
  return (
    <p className="mt-10 text-[11px] leading-relaxed text-zinc-500">
      Inspector profiles are sourced from the{' '}
      <code className="font-mono text-zinc-400">
        public.inspectors_directory
      </code>{' '}
      view — a strict column-projected public surface that excludes
      sensitive fields (rates, residency, payment data). Suspended or
      deleted inspectors are filtered out at the view layer and do not
      appear in this directory.
    </p>
  );
}
