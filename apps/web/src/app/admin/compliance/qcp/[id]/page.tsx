// ════════════════════════════════════════════════════════════════════════════
//  app/admin/compliance/qcp/[id]/page.tsx — one Quality Control Plan
//
//  Everything a governing quality document has to answer, on one screen:
//  who it binds, what quality scope and standards apply, which stages run in
//  which order, who is responsible for each, which scope templates each stage
//  orchestrates, what ITP that produces, what documents are required and on
//  what acceptance criteria, which revision is effective, who approved it and
//  when, and what the whole thing has been before.
//
//  ── EVERY WRITE IS A CANONICAL RPC ─────────────────────────────────────────
//  Four acts are offered and each is one function: submit, approve, issue the
//  next revision, set a stage's templates. Nothing on this page writes
//  quality_control_plans, qcp_revisions, qcp_stages, qcp_stage_templates or
//  qcp_required_documents directly — those tables carry SELECT and no write
//  grant, which is deliberate, and the RPCs carry the invariants a raw INSERT
//  would skip.
//
//  ── APPROVED REVISIONS ARE IMMUTABLE ───────────────────────────────────────
//  No edit control is drawn on an approved or superseded revision, because a
//  trigger rejects the UPDATE. Amending means issuing revision N+1, which is
//  the only act offered there.
//
//  ── INSPECTORS AND SUPPLIERS DO NOT AUTHOR ─────────────────────────────────
//  §4 gives an inspector read access to the effective revision of a project
//  they are engaged on and no write at all; a supplier sees only the
//  requirements, documents and status of a plan naming them. This page is
//  admin-gated, so canAuthor/canApprove are true by construction here — they
//  exist as explicit props so the same components can be mounted on an
//  org-scoped surface without a fork, and so nobody has to guess later what the
//  matrix said.
//
//  ── NO MONEY, STRUCTURALLY ─────────────────────────────────────────────────
//  base_price_cents lives on inspection_scope_templates, the table this page
//  selects templates from. It is never selected, joined, returned or rendered:
//  the reader names its columns and the option type has no price field. No
//  payout, margin, spread or any *_cents appears anywhere on this surface, and
//  no act here has a settlement effect.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft, ClipboardCheck, FileWarning, GitBranch, Info, Layers,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchQcpPlan, fetchQcpContext, fetchQcpRevisions, fetchQcpRevisionBody,
  fetchQcpScopeTemplateOptions, fetchQcpItpSummary, fetchQcpActorNames,
  fetchQcpDocumentTitles, readProjectQcp, readQcpRevisionHistory,
  type QcpRevision,
} from '@/lib/data/qcp';
import {
  approveQcpRevision, addQcpRevision, setQcpStageTemplates, submitQcpRevision,
} from '@/lib/actions/qcp';
import { QcpPlanHeader } from '@/components/qcp/QcpPlanHeader';
import { QcpProgressStrip } from '@/components/qcp/QcpProgressStrip';
import {
  QcpRevisionPanel, QcpResponsibilityMatrix,
} from '@/components/qcp/QcpRevisionPanel';
import { QcpStageBoard } from '@/components/qcp/QcpStageBoard';
import { QcpRequiredDocuments } from '@/components/qcp/QcpRequiredDocuments';
import { QcpRevisionTimeline } from '@/components/qcp/QcpRevisionTimeline';

export const metadata: Metadata = { title: 'Admin, Quality Control Plan' };
export const dynamic = 'force-dynamic';

export default async function AdminQcpDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ rev?: string; created?: string; error?: string }>;
}) {
  const { id: qcpId } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(`/admin/compliance/qcp/${qcpId}`));
  }
  const { data: isAdminData } = await supabase.rpc('nx_is_admin');
  if (!isAdminData) redirect('/');

  const plan = await fetchQcpPlan(qcpId);
  if (!plan) notFound();

  // The canonical history reader is preferred. The structural read is a
  // FALLBACK, not a parallel source: it runs unconditionally because the
  // author needs the full body of a draft — which nx_project_qcp cannot
  // answer for, since a draft is by definition not the effective revision —
  // and it is only used AS the history when the canonical reader failed.
  const [context, history, structural, projectQcp] = await Promise.all([
    fetchQcpContext(plan),
    readQcpRevisionHistory(qcpId),
    fetchQcpRevisions(qcpId),
    readProjectQcp(plan.projectId),
  ]);

  const historyDegraded = !history.ok;
  const revisions: QcpRevision[] = history.ok && history.revisions.length > 0
    ? history.revisions
    : structural;

  // "Effective" is the reader's answer where it gave one. The approved row is
  // the fallback, and the schema's partial unique index on (qcp_id) WHERE
  // status = 'approved' guarantees there is at most one, so this picks the
  // effective revision — it does not decide which one is effective.
  const effectiveFromReader = projectQcp.effectiveRevision?.id ?? null;
  const approvedRow = revisions.find((r) => r.status === 'approved') ?? null;
  const effectiveRevisionId =
    effectiveFromReader && revisions.some((r) => r.id === effectiveFromReader)
      ? effectiveFromReader
      : approvedRow?.id ?? null;

  // Which revision the page is showing: the requested one, else the newest
  // draft or review (that is what an author came for), else the effective one.
  const requested = typeof sp.rev === 'string' ? sp.rev.trim() : '';
  const requestedRevision = revisions.find((r) => r.id === requested) ?? null;
  const unknownRevision = requested !== '' && requestedRevision === null;
  const openRevision =
    revisions.find((r) => r.status === 'draft' || r.status === 'under_review') ?? null;
  const active: QcpRevision | undefined =
    requestedRevision ??
    openRevision ??
    revisions.find((r) => r.id === effectiveRevisionId) ??
    revisions[0];

  if (!active) {
    // A plan ALWAYS has revision 1 — nx_qcp_create writes the two together — so
    // "no readable revision" is a read failure or a permission refusal, never
    // an empty plan. Saying which beats rendering a plausible blank page.
    return (
      <div className="space-y-6">
        <BackLink />
        <h1 className="font-display text-3xl font-semibold text-white">{plan.title}</h1>
        <p className="rounded-2xl border border-rose-500/25 bg-rose-500/[0.06] px-5 py-4 text-xs leading-relaxed text-rose-200">
          No revision of this plan is readable. A plan is always created with
          revision 1, so this is a read failure rather than an empty plan.
          {historyDegraded
            ? ` nx_qcp_revision_history said: ${history.message ?? 'nothing'}.`
            : ' The canonical reader answered but returned nothing, and the revision rows are not readable either — check RLS on qcp_revisions for this viewer.'}
        </p>
      </div>
    );
  }

  const body = await fetchQcpRevisionBody(active.id);
  const selectedTemplateIds = [...body.templatesByStage.values()].flat();

  const [templateOptions, selectedTemplates, itpSummary, actorNames, documentTitles] =
    await Promise.all([
      // Active templates are what a draft may newly select. Retired ones that a
      // revision already references are fetched separately so a retired
      // selection still renders by name instead of a bare uuid.
      fetchQcpScopeTemplateOptions({ activeOnly: true }),
      fetchQcpScopeTemplateOptions({ ids: selectedTemplateIds }),
      fetchQcpItpSummary(selectedTemplateIds),
      fetchQcpActorNames([
        ...revisions.map((r) => r.createdBy),
        ...revisions.map((r) => r.approvedBy ?? ''),
      ]),
      fetchQcpDocumentTitles(
        body.requiredDocuments
          .map((d) => d.documentId)
          .filter((v): v is string => typeof v === 'string'),
      ),
    ]);

  const templateIndex = new Map(
    [...templateOptions, ...selectedTemplates].map((t) => [t.id, t]),
  );

  const isEffective = effectiveRevisionId !== null && active.id === effectiveRevisionId;

  // ── Acts. Each is one canonical RPC; each re-decides server-side. ───────
  async function submitAction(formData: FormData) {
    'use server';
    const revisionId = String(formData.get('revisionId') ?? '');
    const res = await submitQcpRevision(qcpId, revisionId);
    if (!res.ok) {
      redirect(`/admin/compliance/qcp/${qcpId}?error=${encodeURIComponent(res.error)}`);
    }
    redirect(`/admin/compliance/qcp/${qcpId}?rev=${revisionId}`);
  }

  async function approveAction(formData: FormData) {
    'use server';
    const revisionId = String(formData.get('revisionId') ?? '');
    const note = String(formData.get('note') ?? '');
    const res = await approveQcpRevision(qcpId, revisionId, note || null);
    if (!res.ok) {
      redirect(`/admin/compliance/qcp/${qcpId}?error=${encodeURIComponent(res.error)}`);
    }
    redirect(`/admin/compliance/qcp/${qcpId}?rev=${revisionId}`);
  }

  async function newRevisionAction() {
    'use server';
    const res = await addQcpRevision(qcpId);
    if (!res.ok) {
      redirect(`/admin/compliance/qcp/${qcpId}?error=${encodeURIComponent(res.error)}`);
    }
    redirect(
      res.revisionId
        ? `/admin/compliance/qcp/${qcpId}?rev=${res.revisionId}`
        : `/admin/compliance/qcp/${qcpId}`,
    );
  }

  async function setTemplatesAction(formData: FormData) {
    'use server';
    const stageId = String(formData.get('stageId') ?? '');
    const templateIds = formData
      .getAll('templateIds')
      .map((v) => String(v))
      .filter(Boolean);
    const res = await setQcpStageTemplates(qcpId, stageId, templateIds);
    if (!res.ok) {
      redirect(`/admin/compliance/qcp/${qcpId}?error=${encodeURIComponent(res.error)}`);
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <BackLink />
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {plan.title || 'Untitled plan'}
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-400">
          The governing quality document for this project. It orchestrates
          existing scope templates — it owns no points, no documents and no
          nonconformance record of its own.
        </p>
      </header>

      {sp.created && (
        <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-2 text-xs text-emerald-200/90">
          Plan created. Revision 1 is a draft — bind its stages to scope
          templates below, then submit it for review.
        </p>
      )}
      {sp.error && (
        <p className="rounded-xl border border-rose-500/25 bg-rose-500/[0.06] px-4 py-2 text-xs leading-relaxed text-rose-200">
          {sp.error}
        </p>
      )}
      {unknownRevision && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-2 text-xs text-amber-200/90">
          The requested revision does not belong to this plan, so the plan&apos;s
          own current revision is shown instead.
        </p>
      )}
      {projectQcp.unauthorized && (
        <p className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-[11px] leading-relaxed text-zinc-500">
          nx_project_qcp refused this reader, so the effective-revision marker
          and derived progress fall back to the approved row and to nothing
          respectively. The plan itself is unaffected.
        </p>
      )}

      <QcpPlanHeader plan={plan} context={context} />

      <QcpProgressStrip
        progress={projectQcp.progress}
        effectiveRevisionNo={
          revisions.find((r) => r.id === effectiveRevisionId)?.revisionNo ?? null
        }
      />

      {/* ── Revision switcher ──────────────────────────────────────────── */}
      {revisions.length > 1 && (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <GitBranch className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
            Showing revision {active.revisionNo}
          </h2>
          <div className="flex flex-wrap gap-2">
            {revisions.map((r) => (
              <Link
                key={r.id}
                href={`/admin/compliance/qcp/${qcpId}?rev=${r.id}`}
                className={
                  'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ' +
                  (r.id === active.id
                    ? 'bg-white/[0.08] text-white ring-1 ring-inset ring-white/[0.12]'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white')
                }
              >
                Rev {r.revisionNo}
                {r.id === effectiveRevisionId ? ' · effective' : ''}
              </Link>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
            Switching revision changes what is displayed, never what is in
            force. The effective plan is the single approved revision, and only
            approving another one changes it.
          </p>
        </section>
      )}

      <QcpRevisionPanel
        revision={active}
        isEffective={isEffective}
        approverName={active.approvedBy ? actorNames.get(active.approvedBy) ?? null : null}
        authorName={active.createdBy ? actorNames.get(active.createdBy) ?? null : null}
        // True by construction on an admin-gated route. Explicit so the same
        // components can be mounted org-scoped without re-deriving §4.
        canAuthor
        canApprove
        submitAction={submitAction}
        approveAction={approveAction}
        newRevisionAction={newRevisionAction}
      />

      <QcpStageBoard
        stages={body.stages}
        templatesByStage={body.templatesByStage}
        templateIndex={templateIndex}
        itpSummary={itpSummary}
        editable={active.status === 'draft'}
        templateOptions={templateOptions}
        setTemplatesAction={setTemplatesAction}
        notEditableReason={
          active.status === 'under_review'
            ? 'This revision is under review. Template selection is a draft-only act — nx_qcp_set_stage_templates refuses any other state, because review is meaningless if the thing under review can still change.'
            : 'This revision is immutable. Amending the plan means issuing the next revision, which starts as a draft.'
        }
      />

      <QcpResponsibilityMatrix stages={body.stages} />

      <QcpRequiredDocuments
        documents={body.requiredDocuments}
        documentTitles={documentTitles}
      />

      {/* ── Nonconformance context ─────────────────────────────────────── */}
      <section className="space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <FileWarning className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
          Nonconformance
        </h2>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          There is no QCP nonconformance record and there must not be one. An
          NCR is an ordinary flash report, raised from a FAILED ITP point
          through nx_raise_ncr_from_itp_point — the same path structured
          inspection has used since 20260801366000, reused exactly rather than
          bridged.
        </p>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Which is also why none are listed here: a flash report is scoped to a{' '}
          <span className="font-mono text-zinc-400">job</span>, and{' '}
          <span className="font-mono text-zinc-400">public.jobs</span> carries no
          project column, so no report can be attributed to this plan without
          inventing the link the contract forbids. Nonconformances raised
          against this plan&apos;s scope are visible on the job that raised them,
          on its{' '}
          <span className="font-mono text-zinc-400">/admin/jobs/[id]/itp</span>{' '}
          surface. Reported to the Lead as the missing join, not routed around
          here.
        </p>
      </section>

      {/* ── Boundaries ─────────────────────────────────────────────────── */}
      <section className="space-y-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <ClipboardCheck className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
          What these controls do, and do not do
        </h2>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Submitting moves a draft to review and locks its template selection.
          Approving makes a revision the single effective plan and supersedes the
          previous one in the same transaction — the database, not this page,
          guarantees there is only ever one. Issuing the next revision clones the
          approved one into a fresh draft; nothing is overwritten and nothing is
          deleted, which is what append-preserving means.
        </p>
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Quality scope, standards, procedures, stage creation and required
          documents are shown as recorded and are not editable here. The frozen
          RPC surface carries no function that writes them, and this surface
          performs no direct table write to route around that — a control that
          silently did nothing would be worse than the gap it hid, the same call
          the ITP page made about sign-off.
        </p>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
          <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Points belong to the scope template, not to this plan. Selecting a
          template links to it; it copies nothing, so a template that is
          versioned later stays the single source of its own points.
        </p>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Nothing on this page moves money. No price, payout, margin or spread is
          read or rendered — including the base price on the templates this plan
          selects, which no QCP surface may touch.
        </p>
      </section>

      <QcpRevisionTimeline
        revisions={revisions}
        effectiveRevisionId={effectiveRevisionId}
        activeRevisionId={active.id}
        actorNames={actorNames}
        historyDegraded={historyDegraded}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/compliance/qcp"
      className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      Quality control plans
    </Link>
  );
}
