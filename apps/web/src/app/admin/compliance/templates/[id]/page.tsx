// ════════════════════════════════════════════════════════════════════════════
//  app/admin/compliance/templates/[id]/page.tsx — Scope template detail + edit
//
//  Single-page surface that combines:
//    1. Metadata banner — name, slug, version, activation pill, audit dates
//    2. Edit form — same shared ScopeTemplateForm used by /new (in 'edit' mode)
//    3. Activation toggle — a tiny separate <form> hitting
//       toggleScopeTemplateActiveAction so admins can publish/retire
//       without going through the full save flow
//    4. Evidence requirements panel — read-only enumeration of the
//       photo / GPS / signature gates that the inspector mobile flow
//       enforces against this template. Authoring those is out of
//       scope for this round (next ship: requirements CRUD).
//
//  Toast strip at the top reads ?created=1, ?toggled=…, ?error=… so
//  redirects from Server Actions surface friendly feedback.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Hash,
  ShieldCheck,
  MapPin,
  Calendar,
  Wallet,
  Eye,
  EyeOff,
  Camera,
  FileSignature,
  Type,
  AlertTriangle,
  CheckCircle2,
  Power,
  PowerOff,
  ListChecks,
  Plus,
  Clock,
} from 'lucide-react';
import {
  fetchAdminScopeTemplateById,
  fetchAdminScopeTemplateCounts,
  fetchEvidenceRequirementsForTemplate,
  formatScopeCents,
  formatScopeRelativeTime,
  type ScopeEvidenceRequirement,
} from '@/lib/data/scopeTemplates';
import {
  CCI_TIER_LABELS,
  type CciCredentialTier,
} from '@/lib/data/scopeTemplates.types';
import { toggleScopeTemplateActiveAction } from '@/lib/actions/scopeTemplates';
import { ScopeTemplateForm } from '@/components/admin/scope-templates/ScopeTemplateForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await fetchAdminScopeTemplateById(id);
  return {
    title: t ? `Edit, ${t.name}` : 'Scope template',
  };
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    created?: string;
    toggled?: string;
    error?: string;
  }>;
}

export default async function ScopeTemplateDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const sp = await searchParams;

  const [template, counts, requirements] = await Promise.all([
    fetchAdminScopeTemplateById(id),
    fetchAdminScopeTemplateCounts().catch(() => ({
      total: 0,
      active: 0,
      inactive: 0,
      byCategory: [] as Array<{ category: string; count: number }>,
    })),
    fetchEvidenceRequirementsForTemplate(id),
  ]);

  if (!template) notFound();

  const tier = (template.requiresCredentialTier as CciCredentialTier) ?? 'cci_basic';
  const categorySuggestions = counts.byCategory.map((c) => c.category);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* ── Header / breadcrumb ───────────────────────────────────────── */}
      <header>
        <Link
          href="/admin/compliance/templates"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Scope template library
        </Link>

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Command Console, Compliance, Editing
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {template.name}
            </h1>
            <span className="rounded-full bg-violet/15 px-2.5 py-1 font-mono text-[11px] font-bold text-violet-glow">
              v{template.version}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial ${
                template.isActive
                  ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                  : 'border-white/10 bg-white/[0.04] text-zinc-400'
              }`}
            >
              {template.isActive ? (
                <Eye className="h-3 w-3" />
              ) : (
                <EyeOff className="h-3 w-3" />
              )}
              {template.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-zinc-500">
            {template.slug}
          </p>
        </div>
      </header>

      {/* ── Toast strip ───────────────────────────────────────────────── */}
      <ToastStrip created={sp.created} toggled={sp.toggled} error={sp.error} />

      {/* ── Meta card ─────────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetaCard
          icon={<Hash className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Category"
          value={template.category}
        />
        <MetaCard
          icon={<MapPin className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Region"
          value={template.region === 'global' ? 'Global' : template.region.toUpperCase()}
        />
        <MetaCard
          icon={<Calendar className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Validity"
          value={`${template.validityMonths} mo`}
        />
        <MetaCard
          icon={<Wallet className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Base price"
          value={formatScopeCents(template.basePriceCents)}
        />
      </section>

      {/* ── Credential gate + audit row ───────────────────────────────── */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1.5 text-[11px] font-semibold text-cyan-glow">
          <ShieldCheck className="h-3 w-3" strokeWidth={2} />
          Requires {CCI_TIER_LABELS[tier]}
        </span>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="inline-flex items-center gap-1.5 font-mono">
            <Clock className="h-3 w-3" strokeWidth={1.75} />
            Updated {formatScopeRelativeTime(template.updatedAt)}
          </span>
          <span className="text-zinc-700">·</span>
          <span className="font-mono">
            Created {formatScopeRelativeTime(template.createdAt)}
          </span>
        </div>
      </section>

      {/* ── Activation toggle (separate form to its own action) ─────── */}
      <ToggleActiveCard
        id={template.id}
        currentlyActive={template.isActive}
        slug={template.slug}
      />

      {/* ── Evidence requirements (read-only this round) ─────────────── */}
      <RequirementsSection requirements={requirements} />

      {/* ── Edit form ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">
            Edit fields
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Every save bumps <span className="font-mono text-violet-glow">version</span>.
            Historical jobs continue referencing the version they were posted
            under, they don't get retroactively re-scoped.
          </p>
        </div>
        <ScopeTemplateForm
          mode="edit"
          categorySuggestions={categorySuggestions}
          defaults={{
            id: template.id,
            slug: template.slug,
            name: template.name,
            category: template.category,
            region: template.region,
            validityMonths: template.validityMonths,
            basePriceCents: template.basePriceCents,
            requiresCredentialTier: tier,
            description: template.description,
            isActive: template.isActive,
            version: template.version,
          }}
        />
      </section>
    </div>
  );
}

// ─── Toast strip ──────────────────────────────────────────────────────────────

function ToastStrip({
  created,
  toggled,
  error,
}: {
  created?: string;
  toggled?: string;
  error?: string;
}) {
  if (!created && !toggled && !error) return null;
  return (
    <div className="space-y-2">
      {created ? (
        <Toast tone="success" icon={<CheckCircle2 className="h-4 w-4" />}>
          Template created. Wire up evidence requirements below, then flip it
          Active when ready.
        </Toast>
      ) : null}
      {toggled === 'active' ? (
        <Toast tone="success" icon={<Power className="h-4 w-4" />}>
          Published as <strong>Active</strong>. Clients can now pick this template.
        </Toast>
      ) : null}
      {toggled === 'inactive' ? (
        <Toast tone="amber" icon={<PowerOff className="h-4 w-4" />}>
          Retired to <strong>Inactive</strong>. Existing jobs are unaffected;
          new posts won't see this template.
        </Toast>
      ) : null}
      {error ? (
        <Toast tone="error" icon={<AlertTriangle className="h-4 w-4" />}>
          {error}
        </Toast>
      ) : null}
    </div>
  );
}

function Toast({
  tone,
  icon,
  children,
}: {
  tone: 'success' | 'amber' | 'error';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const cls =
    tone === 'success'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
        : 'border-red-500/30 bg-red-500/10 text-red-100';
  const iconCls =
    tone === 'success'
      ? 'text-emerald-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : 'text-red-300';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-2xl border p-3.5 text-sm ${cls}`}
    >
      <span className={`mt-0.5 ${iconCls}`}>{icon}</span>
      <div className="flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

// ─── Meta card ────────────────────────────────────────────────────────────────

function MetaCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        <span className="text-zinc-400">{icon}</span>
        {label}
      </p>
      <p className="mt-1.5 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

// ─── Activation toggle ───────────────────────────────────────────────────────

function ToggleActiveCard({
  id,
  currentlyActive,
  slug,
}: {
  id: string;
  currentlyActive: boolean;
  slug: string;
}) {
  const nextActive = !currentlyActive;
  return (
    <section
      className={`flex flex-col gap-4 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${
        currentlyActive
          ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
          : 'border-amber-500/20 bg-amber-500/[0.04]'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            currentlyActive
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-amber-500/15 text-amber-300'
          }`}
        >
          {currentlyActive ? (
            <Power className="h-4 w-4" strokeWidth={2} />
          ) : (
            <PowerOff className="h-4 w-4" strokeWidth={2} />
          )}
        </span>
        <div>
          <p className="text-sm font-semibold text-white">
            {currentlyActive
              ? 'Published, visible to clients.'
              : 'Retired, hidden from the client picker.'}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {currentlyActive
              ? 'Retire to remove this template from new compliance-mode job posts. Existing jobs that reference it are unaffected.'
              : 'Publish to re-expose this template in the client picker. The slug + version stay the same.'}
          </p>
        </div>
      </div>
      <form action={toggleScopeTemplateActiveAction}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="nextActive" value={String(nextActive)} />
        <input
          type="hidden"
          name="returnTo"
          value={`/admin/compliance/templates/${id}`}
        />
        <button
          type="submit"
          className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-industrial transition ${
            currentlyActive
              ? 'border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/15'
              : 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/15'
          }`}
          title={`Toggle template ${slug} ${currentlyActive ? 'off' : 'on'}`}
        >
          {currentlyActive ? (
            <>
              <PowerOff className="h-3.5 w-3.5" strokeWidth={2} />
              Retire (set inactive)
            </>
          ) : (
            <>
              <Power className="h-3.5 w-3.5" strokeWidth={2} />
              Publish (set active)
            </>
          )}
        </button>
      </form>
    </section>
  );
}

// ─── Evidence requirements (read-only) ───────────────────────────────────────

function RequirementsSection({
  requirements,
}: {
  requirements: ScopeEvidenceRequirement[];
}) {
  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-white">
            <ListChecks
              className="h-4 w-4 text-violet-glow"
              strokeWidth={2}
            />
            Evidence requirements
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            What inspectors must capture in the field for this template. The
            mobile capture flow enforces these, missing required items block
            submission.
          </p>
        </div>
        <span className="rounded-full border border-zinc-700/60 bg-zinc-800/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
          Read-only, authoring ships next
        </span>
      </header>

      {requirements.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
          <Plus
            className="mx-auto h-6 w-6 text-zinc-600"
            strokeWidth={1.5}
          />
          <p className="mt-2 text-sm text-zinc-400">
            No evidence requirements yet.
          </p>
          <p className="mt-1 text-[11px] text-zinc-600">
            Until requirements are added, this template won't satisfy
            compliance jobs, the mobile capture flow has nothing to enforce.
          </p>
        </div>
      ) : (
        <ol className="space-y-2">
          {requirements.map((req) => (
            <li
              key={req.id}
              className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4"
            >
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet/15 font-mono text-xs font-bold text-violet-glow">
                {req.sortOrder}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <KindPill kind={req.kind} />
                  {req.required ? (
                    <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-red-200">
                      Required
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                      Optional
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-zinc-500">
                    {req.minCount === req.maxCount
                      ? `×${req.minCount}`
                      : `×${req.minCount}–${req.maxCount}`}
                  </span>
                </div>
                <p className="mt-1.5 text-sm font-semibold text-white">
                  {req.label}
                </p>
                {req.hint ? (
                  <p className="mt-0.5 text-xs text-zinc-400">{req.hint}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function KindPill({ kind }: { kind: string }) {
  const { icon, label, cls } = describeKind(kind);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${cls}`}
    >
      {icon}
      {label}
    </span>
  );
}

function describeKind(kind: string): {
  icon: React.ReactNode;
  label: string;
  cls: string;
} {
  switch (kind) {
    case 'photo':
      return {
        icon: <Camera className="h-2.5 w-2.5" strokeWidth={2} />,
        label: 'Photo',
        cls: 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
      };
    case 'photo_with_face':
      return {
        icon: <Camera className="h-2.5 w-2.5" strokeWidth={2} />,
        label: 'Photo + Face',
        cls: 'border-violet/30 bg-violet/10 text-violet-glow',
      };
    case 'gps_pin':
      return {
        icon: <MapPin className="h-2.5 w-2.5" strokeWidth={2} />,
        label: 'GPS pin',
        cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      };
    case 'signature':
      return {
        icon: <FileSignature className="h-2.5 w-2.5" strokeWidth={2} />,
        label: 'Signature',
        cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      };
    case 'text_input':
      return {
        icon: <Type className="h-2.5 w-2.5" strokeWidth={2} />,
        label: 'Text input',
        cls: 'border-white/15 bg-white/[0.04] text-zinc-300',
      };
    case 'video':
      return {
        icon: <Camera className="h-2.5 w-2.5" strokeWidth={2} />,
        label: 'Video',
        cls: 'border-pink-500/30 bg-pink-500/10 text-pink-300',
      };
    default:
      return {
        icon: <Hash className="h-2.5 w-2.5" strokeWidth={2} />,
        label: kind,
        cls: 'border-white/10 bg-white/[0.04] text-zinc-300',
      };
  }
}
