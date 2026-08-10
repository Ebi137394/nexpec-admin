// ════════════════════════════════════════════════════════════════════════════
//  app/admin/compliance/qcp/new/page.tsx — create a Quality Control Plan
//
//  One act, one RPC: nx_qcp_create writes the plan AND revision 1 in `draft`,
//  because a plan with no revision has no content and would be an identity
//  nobody can author.
//
//  ── THREE FIELDS, AND WHY NOT A FOURTH ─────────────────────────────────────
//  Project, title, and optionally the supplier being inspected. The
//  organization is NOT a field: §2 denormalises it from the project and a
//  trigger enforces the two agree, so offering it here would only give the
//  form a way to disagree with the project it just picked. It is shown as a
//  consequence of the project choice instead.
//
//  ── NO MONEY ───────────────────────────────────────────────────────────────
//  Nothing on this form is commercial. The supplier is the inspected party, not
//  a buyer — the buyer principal on this platform is COALESCE(agency_id,
//  client_id) on the job side and has no part in a QCP. Creating a plan moves
//  nothing.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, ClipboardCheck, Info } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchQcpProjectOptions, fetchQcpSupplierOptions,
} from '@/lib/data/qcp';
import { createQcp } from '@/lib/actions/qcp';

export const metadata: Metadata = { title: 'Admin, New Quality Control Plan' };
export const dynamic = 'force-dynamic';

const field =
  'w-full rounded-lg border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600';

export default async function NewQcpPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; project?: string }>;
}) {
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/admin/compliance/qcp/new'));
  const { data: isAdminData } = await supabase.rpc('nx_is_admin');
  if (!isAdminData) redirect('/');

  const [projects, suppliers] = await Promise.all([
    fetchQcpProjectOptions(),
    fetchQcpSupplierOptions(),
  ]);

  async function createAction(formData: FormData) {
    'use server';
    const projectId = String(formData.get('projectId') ?? '').trim();
    const title = String(formData.get('title') ?? '');
    const supplierId = String(formData.get('supplierId') ?? '').trim();

    // The action returns a result rather than throwing, so the redirect below
    // is OUTSIDE any try block — a NEXT_REDIRECT signal caught by a catch is
    // the exact bug that broke admin approval earlier in this project.
    const res = await createQcp(projectId, title, supplierId || null);
    if (!res.ok) {
      redirect(
        '/admin/compliance/qcp/new?error=' + encodeURIComponent(res.error),
      );
    }
    redirect(
      res.qcpId
        ? `/admin/compliance/qcp/${res.qcpId}?created=1`
        : '/admin/compliance/qcp?created=1',
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/admin/compliance/qcp"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
          Quality control plans
        </Link>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          New quality control plan
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          Creates the plan and its first revision together. Revision 1 starts as
          a draft, which is the only state in which stages may be bound to scope
          templates.
        </p>
      </header>

      {sp.error && (
        <p className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-2 text-xs text-rose-200">
          {sp.error}
        </p>
      )}

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
          <ClipboardCheck className="mx-auto h-7 w-7 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-zinc-400">No projects are readable.</p>
          <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-zinc-500">
            A QCP requires a project — project_id is NOT NULL and the
            organization is derived from it — so there is nothing to create a
            plan against. This is a read result, not a failure: the form wrote
            nothing.
          </p>
        </div>
      ) : (
        <form action={createAction} className="max-w-2xl space-y-5">
          <div>
            <label htmlFor="projectId" className="mb-1.5 block text-xs font-medium text-zinc-300">
              Project
            </label>
            <select
              id="projectId"
              name="projectId"
              required
              defaultValue={sp.project ?? ''}
              className={field}
            >
              <option value="" disabled>
                Pick the project this plan governs
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.organizationName ? ` · ${p.organizationName}` : ''}
                  {p.status ? ` · ${p.status}` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">
              The organization is taken from the project and enforced equal by a
              trigger, so it is not asked for here.
            </p>
          </div>

          <div>
            <label htmlFor="title" className="mb-1.5 block text-xs font-medium text-zinc-300">
              Plan title
            </label>
            <input
              id="title"
              name="title"
              required
              minLength={3}
              maxLength={200}
              placeholder="e.g. Pressure vessel fabrication QCP"
              className={field}
            />
          </div>

          <div>
            <label htmlFor="supplierId" className="mb-1.5 block text-xs font-medium text-zinc-300">
              Supplier being inspected <span className="text-zinc-600">(optional)</span>
            </label>
            <select id="supplierId" name="supplierId" defaultValue="" className={field}>
              <option value="">No supplier named</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.companyName ? ` · ${s.companyName}` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">
              The supplier is the party being inspected, never a buyer. Naming
              one lets that supplier read this plan&apos;s requirements,
              documents and status — and nothing else, never another
              supplier&apos;s plan.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 ring-1 ring-inset ring-emerald-500/20 hover:bg-emerald-500/20"
            >
              <ClipboardCheck className="h-4 w-4" strokeWidth={1.75} />
              Create plan and revision 1
            </button>
            <Link
              href="/admin/compliance/qcp"
              className="text-xs text-zinc-400 underline hover:text-white"
            >
              cancel
            </Link>
          </div>
        </form>
      )}

      <p className="flex max-w-3xl items-start gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-zinc-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-600" strokeWidth={1.75} />
        The write goes through nx_qcp_create, which decides authorisation in its
        own body against the frozen matrix. This page adds no check of its own
        beyond the admin gate, because a third opinion only gives the three
        somewhere to disagree.
      </p>
    </div>
  );
}
