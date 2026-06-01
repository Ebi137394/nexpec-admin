// ════════════════════════════════════════════════════════════════════════════
//  app/admin/compliance/templates/page.tsx — Scope Templates library
//
//  Mirror of the mobile (admin)/compliance-templates surface. Admins
//  curate the library of inspection scope templates that clients pick
//  from when posting a compliance-mode job. Each template snaps a
//  category + region + required CCI credential tier + base price into
//  a reusable bundle.
//
//  Routing model:
//    /admin/compliance/templates                  — this page (list + filters)
//    /admin/compliance/templates/[id]             — detail / edit (next round)
//    /admin/compliance/templates/new              — create (next round)
//
//  Data: public.inspection_scope_templates (migration 20260514100000_
//  compliance_mode_foundation.sql). Admin RLS allows full SELECT.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import type { Metadata } from 'next';
import {
  PlusCircle,
  ArrowLeft,
  ChevronRight,
  ScrollText,
  ShieldCheck,
  MapPin,
  Calendar,
  Wallet,
  Hash,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  fetchAdminScopeTemplates,
  fetchAdminScopeTemplateCounts,
  formatScopeCents,
  formatScopeRelativeTime,
  type AdminScopeTemplate,
} from '@/lib/data/scopeTemplates';
import { CCI_TIER_LABELS, type CciCredentialTier } from '@/lib/data/scopeTemplates.types';

export const metadata: Metadata = {
  title: 'Scope Templates',
  description:
    'Admin-curated library of inspection scope templates. Clients pick from these when posting compliance-mode jobs.',
};

export const dynamic = 'force-dynamic';

type FilterKey = 'all' | 'active' | 'inactive';

const FILTERS: Array<{ key: FilterKey; label: string; icon: LucideIcon }> = [
  { key: 'all', label: 'All', icon: ScrollText },
  { key: 'active', label: 'Active', icon: Eye },
  { key: 'inactive', label: 'Inactive', icon: EyeOff },
];

interface PageProps {
  searchParams: Promise<{ status?: string; category?: string }>;
}

function isFilterKey(v: string | undefined): v is FilterKey {
  return v === 'all' || v === 'active' || v === 'inactive';
}

export default async function ScopeTemplatesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const filter: FilterKey = isFilterKey(sp.status) ? sp.status : 'all';
  const category = sp.category && sp.category.length > 0 ? sp.category : undefined;

  const [templates, counts] = await Promise.all([
    fetchAdminScopeTemplates({
      activeOnly: filter === 'active',
      category,
      limit: 200,
    }),
    fetchAdminScopeTemplateCounts(),
  ]);

  // Apply inactive filter client-side (the fetcher's activeOnly only flips active)
  const filtered = filter === 'inactive' ? templates.filter((t) => !t.isActive) : templates;

  return (
    <div className="space-y-8">
      {/* Header */}
      <header>
        <Link
          href="/admin/compliance"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Compliance overview
        </Link>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Command Console · Compliance
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Scope Templates
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
              The curated library clients pick from when posting a
              compliance-mode job. Each template bundles a{' '}
              <span className="font-mono text-violet-glow">category</span>,{' '}
              <span className="font-mono text-violet-glow">region</span>, base
              price, credential tier requirement, and evidence schema. Versioned
              + audit-tracked — earlier versions stay readable for historical
              jobs even after edits.
            </p>
          </div>
          <Link
            href="/admin/compliance/templates/new"
            className="btn-primary inline-flex items-center gap-2 self-start sm:self-end"
          >
            <PlusCircle className="h-4 w-4" strokeWidth={2} />
            New template
          </Link>
        </div>
      </header>

      {/* Aggregate strip */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total templates" value={counts.total.toLocaleString()} />
        <Stat label="Active" value={counts.active.toLocaleString()} tone="green" />
        <Stat
          label="Inactive"
          value={counts.inactive.toLocaleString()}
          tone={counts.inactive > 0 ? 'mute' : 'default'}
        />
        <Stat
          label="Categories"
          value={String(counts.byCategory.length)}
          tone="violet"
        />
      </section>

      {/* Filter tabs */}
      <nav
        aria-label="Filter templates by activation state"
        className="flex flex-wrap gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-1.5"
      >
        {FILTERS.map((tab) => {
          const active = filter === tab.key;
          const count =
            tab.key === 'all'
              ? counts.total
              : tab.key === 'active'
                ? counts.active
                : counts.inactive;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.key}
              href={
                tab.key === 'all'
                  ? '/admin/compliance/templates'
                  : `/admin/compliance/templates?status=${tab.key}`
              }
              className={`flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors ${
                active
                  ? 'bg-violet/15 text-white ring-1 ring-inset ring-violet/30'
                  : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              <Icon
                className={`h-3.5 w-3.5 ${active ? 'text-violet-glow' : 'text-zinc-500'}`}
                strokeWidth={1.75}
              />
              <span>{tab.label}</span>
              <span
                className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  active
                    ? 'bg-violet/25 text-violet-glow'
                    : 'bg-white/[0.04] text-zinc-500'
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Category chip rail */}
      {counts.byCategory.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={
              filter === 'all'
                ? '/admin/compliance/templates'
                : `/admin/compliance/templates?status=${filter}`
            }
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
              !category
                ? 'border-violet/40 bg-violet/10 text-violet-glow'
                : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white'
            }`}
          >
            All categories
          </Link>
          {counts.byCategory.map((c) => {
            const active = category === c.category;
            const href =
              `/admin/compliance/templates?` +
              new URLSearchParams({
                ...(filter !== 'all' ? { status: filter } : {}),
                category: c.category,
              }).toString();
            return (
              <Link
                key={c.category}
                href={href}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                  active
                    ? 'border-violet/40 bg-violet/10 text-violet-glow'
                    : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white'
                }`}
              >
                <Hash className="h-3 w-3" strokeWidth={1.75} />
                {c.category}
                <span className="ml-1 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px]">
                  {c.count}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* List */}
      <section className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
            <ScrollText
              className="mx-auto h-8 w-8 text-zinc-600"
              strokeWidth={1.5}
            />
            <p className="mt-3 text-sm text-zinc-400">
              {category
                ? `No templates in the "${category}" category match this filter.`
                : filter === 'inactive'
                  ? 'No inactive templates.'
                  : 'No templates yet — create the first one.'}
            </p>
            <Link
              href="/admin/compliance/templates/new"
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-violet/40 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/15"
            >
              <PlusCircle className="h-3.5 w-3.5" strokeWidth={2} />
              New template
            </Link>
          </div>
        ) : (
          filtered.map((t) => <TemplateCard key={t.id} template={t} />)
        )}
      </section>

      <p className="text-[11px] text-zinc-600">
        Source:{' '}
        <span className="font-mono">public.inspection_scope_templates</span>.
        Authoring + editing surfaces ship in the next round.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function TemplateCard({ template: t }: { template: AdminScopeTemplate }) {
  const tier = (t.requiresCredentialTier as CciCredentialTier) ?? 'cci_basic';
  return (
    <article
      className={`rounded-3xl border bg-white/[0.01] p-5 sm:p-6 ${
        t.isActive ? 'border-white/[0.06]' : 'border-white/[0.04] opacity-70'
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              {t.name}
            </h2>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                t.isActive
                  ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                  : 'border-white/10 bg-white/[0.04] text-zinc-400'
              }`}
            >
              {t.isActive ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
              {t.isActive ? 'Active' : 'Inactive'}
            </span>
            <span className="rounded-full bg-violet/15 px-2 py-0.5 font-mono text-[10px] font-bold text-violet-glow">
              v{t.version}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-zinc-500">{t.slug}</p>
        </div>
        <Link
          href={`/admin/compliance/templates/${t.id}`}
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
        >
          Open
          <ChevronRight className="h-3 w-3" strokeWidth={2} />
        </Link>
      </header>

      {/* Description preview */}
      {t.description ? (
        <p className="mt-4 line-clamp-2 text-sm text-zinc-400">{t.description}</p>
      ) : (
        <p className="mt-4 text-xs italic text-zinc-600">
          No description — add one to help clients pick this template.
        </p>
      )}

      {/* Meta strip */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Meta
          icon={<Hash className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Category"
          value={t.category}
        />
        <Meta
          icon={<MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Region"
          value={t.region === 'global' ? 'Global' : t.region.toUpperCase()}
        />
        <Meta
          icon={<Calendar className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Validity"
          value={`${t.validityMonths} mo`}
        />
        <Meta
          icon={<Wallet className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Base price"
          value={formatScopeCents(t.basePriceCents)}
        />
      </div>

      {/* Credential + audit footer */}
      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.05] pt-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 text-[11px] font-semibold text-cyan-glow">
          <ShieldCheck className="h-3 w-3" strokeWidth={2} />
          Requires {CCI_TIER_LABELS[tier]}
        </span>
        <span className="font-mono text-[10px] text-zinc-500">
          Updated {formatScopeRelativeTime(t.updatedAt)}
        </span>
      </footer>
    </article>
  );
}

function Meta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        <span className="text-zinc-400">{icon}</span>
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'green' | 'amber' | 'mute' | 'violet';
}) {
  const cls =
    tone === 'green'
      ? 'text-accent-green'
      : tone === 'amber'
        ? 'text-accent-amber'
        : tone === 'mute'
          ? 'text-zinc-400'
          : tone === 'violet'
            ? 'text-violet-glow'
            : 'text-white';
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className={`mt-1 font-display text-2xl font-semibold ${cls}`}>{value}</p>
    </div>
  );
}
