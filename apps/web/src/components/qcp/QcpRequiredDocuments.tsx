// ════════════════════════════════════════════════════════════════════════════
//  components/qcp/QcpRequiredDocuments.tsx — what the plan demands on paper
//
//  qcp_required_documents LINKS existing documents; it does not store files.
//  document_id NULL is not a defect, it is the meaningful state "required but
//  not yet supplied", and this component renders that difference as the primary
//  signal — an outstanding mandatory document is the single most useful thing
//  a quality plan can tell a reader.
//
//  There is no second document store here and no upload control. Uploading and
//  linking are the documents lane's (Agent 3, migration 20260801408000) and the
//  existing document surfaces'; §3 as frozen defines no RPC that writes this
//  table, so this component displays and does not offer to write. A button that
//  silently did nothing would be worse than the gap it hid — the same call the
//  ITP page made about sign-off.
//
//  ACCEPTANCE CRITERIA live on the required-document row (§2), which is why
//  they are rendered here rather than in a section of their own: the criterion
//  is what makes the document acceptable, and separating the two would invite
//  someone to invent a criteria table that the contract does not have.
// ════════════════════════════════════════════════════════════════════════════

import { FileText, FileWarning, FileCheck2, CircleDashed } from 'lucide-react';
import type { QcpRequiredDocument } from '@/lib/data/qcp';

export function QcpRequiredDocuments({
  documents,
  documentTitles,
}: {
  documents: QcpRequiredDocument[];
  documentTitles: Map<string, string>;
}) {
  const mandatory = documents.filter((d) => d.isMandatory);
  const outstanding = mandatory.filter((d) => d.documentId === null);

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <FileText className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
        Required documents and acceptance criteria
        <span className="text-xs font-normal text-zinc-500">
          ({documents.length} required, {mandatory.length} mandatory)
        </span>
      </h2>

      {outstanding.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" strokeWidth={1.75} />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            {outstanding.length} mandatory document
            {outstanding.length === 1 ? ' is' : 's are'} required by this
            revision and not yet linked. That is a statement about the plan, not
            a gate: nothing on this surface blocks a job because of it, and
            wiring the two together would be a separate, explicit decision that
            has not been taken.
          </p>
        </div>
      )}

      {documents.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] px-5 py-6 text-center text-xs leading-relaxed text-zinc-500">
          This revision names no required documents. Linking one writes
          qcp_required_documents, for which the frozen RPC surface defines no
          function — so no control is offered here. Reported to the Lead.
        </p>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => {
            const supplied = d.documentId !== null;
            const title = d.documentId ? documentTitles.get(d.documentId) ?? null : null;
            return (
              <li
                key={d.id}
                className={
                  'rounded-2xl border px-5 py-4 ' +
                  (supplied
                    ? 'border-white/[0.06] bg-white/[0.02]'
                    : d.isMandatory
                      ? 'border-amber-500/20 bg-amber-500/[0.04]'
                      : 'border-white/[0.06] bg-white/[0.02]')
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  {supplied ? (
                    <FileCheck2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" strokeWidth={1.75} />
                  ) : (
                    <CircleDashed className="h-3.5 w-3.5 shrink-0 text-zinc-500" strokeWidth={1.75} />
                  )}
                  <span className="font-medium text-white">{d.label}</span>
                  <span
                    className={
                      'rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ' +
                      (d.isMandatory
                        ? 'bg-rose-500/10 text-rose-300 ring-rose-500/20'
                        : 'bg-white/[0.04] text-zinc-400 ring-white/[0.08]')
                    }
                  >
                    {d.isMandatory ? 'Mandatory' : 'Optional'}
                  </span>
                  <span
                    className={
                      'rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ' +
                      (supplied
                        ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/20'
                        : 'bg-white/[0.04] text-zinc-400 ring-white/[0.08]')
                    }
                  >
                    {supplied ? 'Linked' : 'Not yet supplied'}
                  </span>
                </div>

                {supplied && (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    <span className="text-zinc-600">Document: </span>
                    {title ?? (
                      <span className="font-mono">
                        {d.documentId?.slice(0, 8)} — title not readable from here
                      </span>
                    )}
                  </p>
                )}

                {d.acceptanceCriteria?.trim() && (
                  <p className="mt-2 text-[11px] leading-relaxed text-zinc-400">
                    <span className="text-zinc-600">Acceptance criteria: </span>
                    {d.acceptanceCriteria}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-600">
        These rows link documents that already exist; the plan stores no files of
        its own. A missing link means the document has not been supplied, not
        that it was lost.
      </p>
    </section>
  );
}
