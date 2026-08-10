// ════════════════════════════════════════════════════════════════════════════
//  components/qcp/QcpRevisionTimeline.tsx — the append-preserved history
//
//  A superseded revision is KEPT, not deleted, so this is an audit trail rather
//  than a changelog: every state the plan has been in is still a row, and the
//  supersession chain (supersedes_id) is drawn explicitly so "revision 3
//  replaced revision 2" is visible rather than inferred from the numbering.
//
//  The list is read-only by construction. It has no controls at all — the acts
//  that move a revision live on the detail page next to the revision they act
//  on, because approving the wrong row out of a history list is exactly the
//  mistake an immutable model exists to prevent.
// ════════════════════════════════════════════════════════════════════════════

import { History, Stamp, Link2, UserCheck } from 'lucide-react';
import { QcpStatusBadge, QcpEffectiveBadge } from './QcpStatusBadge';
import { formatQcpDateTime, type QcpRevision } from '@/lib/data/qcp';

export function QcpRevisionTimeline({
  revisions,
  effectiveRevisionId,
  activeRevisionId,
  actorNames,
  historyDegraded,
}: {
  /** Newest first. */
  revisions: QcpRevision[];
  /** The revision nx_project_qcp considers in force, when it named one. */
  effectiveRevisionId: string | null;
  /** The revision the page is currently showing, highlighted but not styled as effective. */
  activeRevisionId: string | null;
  actorNames: Map<string, string | null>;
  /**
   * True when the canonical history reader failed and these rows came from the
   * structural read instead. Said out loud rather than smoothed over.
   */
  historyDegraded?: boolean;
}) {
  const byId = new Map(revisions.map((r) => [r.id, r]));

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <History className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
        Revision history
        <span className="text-xs font-normal text-zinc-500">
          ({revisions.length} revision{revisions.length === 1 ? '' : 's'}, append-preserved)
        </span>
      </h2>

      {historyDegraded && (
        <p className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-2 text-[11px] leading-relaxed text-amber-200/90">
          nx_qcp_revision_history did not answer, so this history was read from
          the revision rows directly. The content is the same relations the
          reader projects, but if the reader is failing for an authorization
          reason then a revision you are not entitled to see would be missing
          from the canonical answer and present here — treat it as diagnostic,
          not as a released view, and report the reader failure.
        </p>
      )}

      {revisions.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] px-5 py-6 text-center text-xs text-zinc-500">
          No revisions are readable for this plan. A plan is always created with
          revision 1, so an empty history means the reader refused rather than
          that nothing exists.
        </p>
      ) : (
        <ol className="space-y-3">
          {revisions.map((r) => {
            const isEffective = effectiveRevisionId !== null && r.id === effectiveRevisionId;
            const isActive = activeRevisionId !== null && r.id === activeRevisionId;
            const superseded = r.supersedesId ? byId.get(r.supersedesId) ?? null : null;
            const approver = r.approvedBy ? actorNames.get(r.approvedBy) ?? null : null;
            const author = r.createdBy ? actorNames.get(r.createdBy) ?? null : null;

            return (
              <li
                key={r.id}
                className={
                  'rounded-2xl border px-5 py-4 ' +
                  (isEffective
                    ? 'border-violet-500/25 bg-violet-500/[0.04]'
                    : isActive
                      ? 'border-white/[0.12] bg-white/[0.03]'
                      : 'border-white/[0.06] bg-white/[0.02]')
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">Revision {r.revisionNo}</span>
                  <QcpStatusBadge status={r.status} />
                  <QcpEffectiveBadge effective={isEffective} />
                  {isActive && !isEffective && (
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-zinc-300 ring-1 ring-inset ring-white/[0.08]">
                      showing
                    </span>
                  )}
                </div>

                <div className="mt-3 grid gap-1 border-t border-white/[0.05] pt-3 sm:grid-cols-2">
                  <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <UserCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    Authored by:{' '}
                    {author ?? (r.createdBy ? `user ${r.createdBy.slice(0, 8)}` : 'unattributed')}
                  </p>
                  <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <History className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    Created: {formatQcpDateTime(r.createdAt)}
                  </p>
                  <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <Stamp className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    Approved:{' '}
                    {r.approvedAt
                      ? `${formatQcpDateTime(r.approvedAt)}${
                          approver
                            ? ` by ${approver}`
                            : r.approvedBy
                              ? ` by user ${r.approvedBy.slice(0, 8)}`
                              : ''
                        }`
                      : 'not approved'}
                  </p>
                  <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <Link2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    Supersedes:{' '}
                    {r.supersedesId
                      ? superseded
                        ? `revision ${superseded.revisionNo}`
                        : `revision ${r.supersedesId.slice(0, 8)}`
                      : 'nothing — this is the first in its chain'}
                  </p>
                </div>

                {r.standards.length > 0 && (
                  <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                    <span className="text-zinc-600">Standards: </span>
                    {r.standards.join(', ')}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
