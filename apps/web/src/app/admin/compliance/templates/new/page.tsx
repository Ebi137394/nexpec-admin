// ════════════════════════════════════════════════════════════════════════════
//  app/admin/compliance/templates/new/page.tsx — Create scope template
//
//  Server Component shell around the shared ScopeTemplateForm. Pulls the
//  existing category list so the form can offer them as autocomplete
//  suggestions — admins are encouraged but not forced to reuse buckets.
//
//  The form posts to createScopeTemplateAction which inserts and then
//  redirects to /admin/compliance/templates/[id]?created=1 so the admin
//  can immediately wire up evidence requirements on the Edit page.
//
//  Admin-only: RLS at templates_admin_write rejects writes from
//  non-admins; the action layer does a friendly pre-check too.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, PlusCircle, ScrollText, Sparkles } from 'lucide-react';
import { fetchAdminScopeTemplateCounts } from '@/lib/data/scopeTemplates';
import { ScopeTemplateForm } from '@/components/admin/scope-templates/ScopeTemplateForm';

export const metadata: Metadata = {
  title: 'New scope template',
  description:
    'Create a new compliance inspection scope template that clients can pick from when posting jobs.',
};

export const dynamic = 'force-dynamic';

export default async function NewScopeTemplatePage() {
  // Pull existing categories so the form can suggest them via <datalist>.
  // Failing silently is fine — empty list just disables the suggestions.
  const counts = await fetchAdminScopeTemplateCounts().catch(() => ({
    total: 0,
    active: 0,
    inactive: 0,
    byCategory: [] as Array<{ category: string; count: number }>,
  }));
  const categorySuggestions = counts.byCategory.map((c) => c.category);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* ── Header / breadcrumb ───────────────────────────────────── */}
      <header>
        <Link
          href="/admin/compliance/templates"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Scope template library
        </Link>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Command Console · Compliance · Authoring
            </p>
            <h1 className="mt-2 flex items-center gap-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-violet/15 ring-1 ring-inset ring-violet/30">
                <PlusCircle
                  className="h-5 w-5 text-violet-glow"
                  strokeWidth={2}
                />
              </span>
              New scope template
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
              Stand up a new compliance scope clients can pick from. The
              template will start at <span className="font-mono text-violet-glow">v1</span>;
              every subsequent edit bumps the version so historical jobs stay
              auditable against the contract they were posted under.
            </p>
          </div>
        </div>
      </header>

      {/* ── Authoring tip strip ──────────────────────────────────── */}
      <aside
        aria-label="Authoring guidance"
        className="rounded-2xl border border-cyan-glow/20 bg-cyan-glow/[0.04] p-4"
      >
        <div className="flex items-start gap-3">
          <Sparkles
            className="mt-0.5 h-4 w-4 shrink-0 text-cyan-glow"
            strokeWidth={2}
          />
          <div className="space-y-2 text-xs leading-relaxed text-zinc-300">
            <p>
              <span className="font-semibold text-white">Naming.</span> The
              display name should read like a deliverable — what the inspector
              will actually do. Slugs are immutable, so pick one you can live
              with: lowercase, underscores, no spaces.
            </p>
            <p>
              <span className="font-semibold text-white">Credential gate.</span>
              {' '}Inspectors below the chosen CCI tier won't see the job in
              their discovery feed. Pick the lowest tier that can complete the
              work safely.
            </p>
            <p>
              <span className="font-semibold text-white">Next step.</span> After
              you save, you'll land on the template's detail page where you can
              wire up evidence requirements (photo, GPS pin, signature, etc.).
            </p>
          </div>
        </div>
      </aside>

      {/* ── Form ──────────────────────────────────────────────────── */}
      <ScopeTemplateForm
        mode="create"
        categorySuggestions={categorySuggestions}
        defaults={{
          region: 'global',
          validityMonths: 12,
          requiresCredentialTier: 'cci_basic',
          isActive: true,
        }}
      />

      {/* ── Cross-link to existing library ────────────────────────── */}
      <footer className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4 text-xs text-zinc-500">
        <p className="flex items-center gap-2">
          <ScrollText className="h-3.5 w-3.5" strokeWidth={1.75} />
          Reviewing what already exists?{' '}
          <Link
            href="/admin/compliance/templates"
            className="font-semibold text-violet-glow hover:underline"
          >
            Back to the library →
          </Link>
        </p>
      </footer>
    </div>
  );
}
