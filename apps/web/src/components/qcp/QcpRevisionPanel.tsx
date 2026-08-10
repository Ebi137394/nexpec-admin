// ════════════════════════════════════════════════════════════════════════════
//  components/qcp/QcpRevisionPanel.tsx — one revision, its body, and its acts
//
//  The revision carries the content: quality scope, applicable standards,
//  procedures, and — once approved — who signed it and when. The plan above it
//  carries only identity. Keeping the two apart is what lets a plan be amended
//  without rewriting history.
//
//  ── THE STATE MACHINE IS THE DATABASE'S ────────────────────────────────────
//  draft → under_review → approved → superseded, and approved/superseded are
//  immutable but for the single approved → superseded transition. This panel
//  draws AT MOST the one act the current state permits, and every act is a
//  canonical RPC. The RPC re-decides authorisation in its own body; the
//  `canAuthor` / `canApprove` props only stop a control being drawn that the
//  viewer's role could never use, per §4 — Inspector and Supplier get read
//  access and no write, so they see this panel with no buttons at all.
//
//  ── AMENDING MEANS N+1 ─────────────────────────────────────────────────────
//  There is deliberately no "edit" control on an approved revision. The only
//  act offered there is "issue the next revision", which clones this one into a
//  fresh draft with supersedes_id set. The previously approved revision stays
//  effective until the new one is itself approved.
//
//  ── WHAT IS READ-ONLY BECAUSE THE CONTRACT HAS NO RPC FOR IT ───────────────
//  §3 defines no function that writes quality_scope, standards or procedures,
//  and none that creates a stage or a required document. Those fields are
//  therefore displayed and not edited here, with the gap stated in plain words
//  rather than papered over with a control that would fail or, worse, appear to
//  succeed. Reported to the Lead; this lane owns no migration and will not
//  write the tables directly to route around a missing RPC.
// ════════════════════════════════════════════════════════════════════════════

import {
  FileSignature, BookMarked, ScrollText, Stamp, Send, GitBranch, Lock,
} from 'lucide-react';
import { QcpStatusBadge, QcpEffectiveBadge, QcpImmutableNote } from './QcpStatusBadge';
import {
  QCP_STATUS_MEANING, formatQcpDateTime, isQcpRevisionEditable,
  type QcpRevision, type QcpStage,
} from '@/lib/data/qcp';

const input =
  'rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600';

function Block({
  icon: Icon,
  label,
  value,
  emptyNote,
}: {
  icon: typeof BookMarked;
  label: string;
  value: string | null;
  emptyNote: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        <Icon className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
        {label}
      </h3>
      {value?.trim() ? (
        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
          {value}
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">{emptyNote}</p>
      )}
    </div>
  );
}

export function QcpRevisionPanel({
  revision,
  isEffective,
  approverName,
  authorName,
  canAuthor,
  canApprove,
  submitAction,
  approveAction,
  newRevisionAction,
}: {
  revision: QcpRevision;
  isEffective: boolean;
  approverName: string | null;
  authorName: string | null;
  /** §4: Admin, Enterprise/client org and Agency may author. Inspector/Supplier may not. */
  canAuthor: boolean;
  canApprove: boolean;
  submitAction: (formData: FormData) => void | Promise<void>;
  approveAction: (formData: FormData) => void | Promise<void>;
  newRevisionAction: (formData: FormData) => void | Promise<void>;
}) {
  const editable = isQcpRevisionEditable(revision.status);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <FileSignature className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
          Revision {revision.revisionNo}
        </h2>
        <QcpStatusBadge status={revision.status} />
        <QcpEffectiveBadge effective={isEffective} />
        {!editable && (
          <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[11px] text-zinc-400 ring-1 ring-inset ring-white/[0.08]">
            <Lock className="h-3 w-3" strokeWidth={1.75} />
            read-only
          </span>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        {QCP_STATUS_MEANING[revision.status]}
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <Block
          icon={ScrollText}
          label="Quality scope"
          value={revision.qualityScope}
          emptyNote="No quality scope is recorded on this revision."
        />
        <Block
          icon={BookMarked}
          label="Procedures"
          value={revision.procedures}
          emptyNote="No procedures are recorded on this revision."
        />
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          <BookMarked className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
          Applicable standards
        </h3>
        {revision.standards.length === 0 ? (
          <p className="mt-2 text-[11px] text-zinc-600">
            No codes or standards are listed on this revision.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {revision.standards.map((s) => (
              <li
                key={s}
                className="rounded-full bg-white/[0.04] px-2.5 py-0.5 font-mono text-[11px] text-zinc-300 ring-1 ring-inset ring-white/[0.08]"
              >
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Sign-off record ────────────────────────────────────────────── */}
      <div className="grid gap-1 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4 sm:grid-cols-2">
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <FileSignature className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Authored by:{' '}
          {authorName ??
            (revision.createdBy ? `user ${revision.createdBy.slice(0, 8)}` : 'unattributed')}
        </p>
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          <Stamp className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          Approved:{' '}
          {revision.approvedAt
            ? `${formatQcpDateTime(revision.approvedAt)}${
                approverName
                  ? ` by ${approverName}`
                  : revision.approvedBy
                    ? ` by user ${revision.approvedBy.slice(0, 8)}`
                    : ''
              }`
            : 'not approved'}
        </p>
      </div>

      {/* ── The one act this state permits ─────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        {revision.status === 'draft' && canAuthor && (
          <form action={submitAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="revisionId" value={revision.id} />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-500/20 hover:bg-amber-500/20"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
              Submit for review
            </button>
            <span className="text-[11px] text-zinc-600">
              After this the template selection is locked — review is meaningless
              if the thing under review can still change.
            </span>
          </form>
        )}

        {revision.status === 'under_review' && canApprove && (
          <form action={approveAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="revisionId" value={revision.id} />
            <input
              name="note"
              placeholder="approval note (optional)"
              className={`${input} w-64`}
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20 hover:bg-emerald-500/20"
            >
              <Stamp className="h-3.5 w-3.5" strokeWidth={1.75} />
              Approve and make effective
            </button>
          </form>
        )}

        {revision.status === 'approved' && canAuthor && (
          <form action={newRevisionAction} className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-200 ring-1 ring-inset ring-white/[0.08] hover:bg-white/[0.06]"
            >
              <GitBranch className="h-3.5 w-3.5" strokeWidth={1.75} />
              Issue revision {revision.revisionNo + 1}
            </button>
            <span className="text-[11px] text-zinc-600">
              Clones this revision into a new draft and records that it
              supersedes it. This revision stays effective until the new one is
              approved.
            </span>
          </form>
        )}
      </div>

      <QcpImmutableNote status={revision.status} />

      {revision.status === 'under_review' && !canApprove && (
        <p className="text-[11px] leading-relaxed text-zinc-600">
          This revision is awaiting a decision. Approval is not yours to give on
          this surface, so no control is drawn — the database would refuse it in
          any case.
        </p>
      )}

      {editable && (
        <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[11px] leading-relaxed text-zinc-500">
          Quality scope, standards and procedures are shown as recorded and
          cannot be edited here. The frozen RPC surface carries no function that
          writes them, and every QCP write goes through a canonical RPC — so
          rather than draw a form that would fail, this surface reports the gap.
          The same is true of creating a stage and of adding a required
          document.
        </p>
      )}
    </section>
  );
}

/**
 * Responsibilities, rolled up across the revision.
 *
 * The same free text the stage board shows per stage, gathered so a reader can
 * answer "who is on the hook for what" without scrolling the whole plan. It is
 * a VIEW of qcp_stages.responsible_party and holds no data of its own — there
 * is no responsibilities table in the frozen schema and this must not become
 * the reason someone adds one.
 */
export function QcpResponsibilityMatrix({ stages }: { stages: QcpStage[] }) {
  const ordered = [...stages].sort((a, b) => a.sequenceNo - b.sequenceNo);
  const named = ordered.filter((s) => s.responsibleParty?.trim());

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <FileSignature className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
        Responsibilities
        <span className="text-xs font-normal text-zinc-500">
          ({named.length} of {ordered.length} stage{ordered.length === 1 ? '' : 's'} named)
        </span>
      </h2>

      {ordered.length === 0 ? (
        <p className="text-[11px] text-zinc-600">
          This revision has no stages, so it assigns no responsibility.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02]">
          {ordered.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5"
            >
              <span className="text-xs text-zinc-300">
                #{s.sequenceNo} · {s.name || 'Unnamed stage'}
              </span>
              <span
                className={
                  'text-[11px] ' +
                  (s.responsibleParty?.trim() ? 'text-zinc-400' : 'text-zinc-600')
                }
              >
                {s.responsibleParty?.trim() ?? 'not stated'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-600">
        Free text by design, the same rationale itp_points.responsible_party
        carries: the responsible party is a contractual role — contractor,
        third-party, client rep, notified body — that varies per client and does
        not map onto a NEXPEC account. It is shown as written and never resolved
        to a user.
      </p>
    </section>
  );
}
