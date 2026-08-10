// ════════════════════════════════════════════════════════════════════════════
//  components/qcp/QcpStageBoard.tsx — stages, in sequence, and what they pull in
//
//  A stage is the QCP's unit of sequencing: an ordered name plus a responsible
//  party plus the set of scope templates it orchestrates. UNIQUE (revision_id,
//  sequence_no) makes the order a database fact, so this component displays
//  sequence_no rather than the array index — a gap in the numbering is real
//  information and must not be hidden by re-numbering on screen.
//
//  ── RESPONSIBLE PARTY IS FREE TEXT, ON PURPOSE ─────────────────────────────
//  Same rationale as itp_points.responsible_party: "the responsible party" is a
//  contractual role (contractor / third-party / client rep / notified body)
//  that varies per client and does not map onto a NEXPEC account. It is
//  rendered as written and never resolved to a user.
//
//  ── THE ITP IS SHOWN, NOT OWNED ────────────────────────────────────────────
//  Selecting a template into a stage is what produces the ITP: the points
//  already exist on itp_points.template_id and arrive with the template. This
//  board summarises what arrives — how many points, how many are holds,
//  witnesses or sign-offs — and offers no control to change any of it, because
//  editing a point belongs to the template library, not to one plan. The counts
//  are counts of DEFINITION rows; live blocking state is nx_job_itp's answer on
//  a job and is not, and must not be, reproduced here.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  Layers, ListOrdered, UserCog, OctagonAlert, Eye, Stamp, ClipboardList,
} from 'lucide-react';
import { QcpScopeTemplatePicker } from './QcpScopeTemplatePicker';
import type {
  QcpItpPointSummary, QcpScopeTemplateOption, QcpStage,
} from '@/lib/data/qcp';

export function QcpStageBoard({
  stages,
  templatesByStage,
  templateIndex,
  itpSummary,
  editable,
  templateOptions,
  setTemplatesAction,
  notEditableReason,
}: {
  stages: QcpStage[];
  /** templateIds per stage id, as stored in qcp_stage_templates. */
  templatesByStage: Map<string, string[]>;
  /** Price-blind template rows, by id, for naming a selection. */
  templateIndex: Map<string, QcpScopeTemplateOption>;
  /** ITP consequence per template id, read-only. */
  itpSummary: Map<string, QcpItpPointSummary>;
  /** Draft-only, and the RPC re-decides regardless. */
  editable: boolean;
  templateOptions: QcpScopeTemplateOption[];
  setTemplatesAction: (formData: FormData) => void | Promise<void>;
  notEditableReason?: string;
}) {
  const ordered = [...stages].sort((a, b) => a.sequenceNo - b.sequenceNo);

  return (
    <section className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <ListOrdered className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
        Stages and scope
        <span className="text-xs font-normal text-zinc-500">
          ({ordered.length} stage{ordered.length === 1 ? '' : 's'})
        </span>
      </h2>

      {ordered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
          <Layers className="mx-auto h-7 w-7 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-zinc-400">This revision has no stages.</p>
          <p className="mx-auto mt-2 max-w-2xl text-xs leading-relaxed text-zinc-500">
            A stage is what a template selection attaches to —
            nx_qcp_set_stage_templates takes a stage id — so a revision with no
            stages cannot yet orchestrate anything. The frozen RPC surface
            defines no function that creates a stage, and this page will not
            write qcp_stages directly to invent one: every QCP write goes
            through a canonical RPC, and a control that silently did nothing
            would be worse than the gap it hid. Reported to the Lead as a
            missing RPC.
          </p>
        </div>
      ) : (
        <ol className="space-y-4">
          {ordered.map((s) => {
            const selected = templatesByStage.get(s.id) ?? [];
            const totals = selected.reduce(
              (acc, id) => {
                const sum = itpSummary.get(id);
                if (!sum) return acc;
                acc.points += sum.pointCount;
                acc.holds += sum.holdCount;
                acc.witness += sum.witnessCount;
                acc.signoff += sum.signoffCount;
                return acc;
              },
              { points: 0, holds: 0, witness: 0, signoff: 0 },
            );

            return (
              <li
                key={s.id}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-white">
                      #{s.sequenceNo} · {s.name || 'Unnamed stage'}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                      <UserCog className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      Responsible party:{' '}
                      {s.responsibleParty?.trim()
                        ? s.responsibleParty
                        : 'not stated on this stage'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip icon={ClipboardList} tone="zinc" label={`${totals.points} ITP points`} />
                    {totals.holds > 0 && (
                      <Chip icon={OctagonAlert} tone="rose" label={`${totals.holds} hold`} />
                    )}
                    {totals.witness > 0 && (
                      <Chip icon={Eye} tone="violet" label={`${totals.witness} witness`} />
                    )}
                    {totals.signoff > 0 && (
                      <Chip icon={Stamp} tone="sky" label={`${totals.signoff} sign-off`} />
                    )}
                  </div>
                </div>

                {/* ── Current selection, read-only ─────────────────────── */}
                <div className="mt-3 border-t border-white/[0.05] pt-3">
                  {selected.length === 0 ? (
                    <p className="text-[11px] text-zinc-600">
                      No scope template is attached to this stage, so it
                      contributes no ITP points.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {/* Iterate the STORED ids, not a parallel array of
                          resolved rows — a template that is no longer readable
                          must still be listed, and pairing two arrays by index
                          is how one of them silently goes missing. */}
                      {selected.map((id) => {
                        const t = templateIndex.get(id) ?? null;
                        const sum = itpSummary.get(id) ?? null;
                        return (
                          <li
                            key={id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.02] px-3 py-2"
                          >
                            <span className="min-w-0 text-[11px] text-zinc-300">
                              {t ? (
                                <>
                                  {t.name}{' '}
                                  <span className="font-mono text-zinc-600">
                                    v{t.version} · {t.slug}
                                  </span>
                                  {!t.isActive && (
                                    <span className="ml-2 text-amber-300/80">retired</span>
                                  )}
                                </>
                              ) : (
                                <span className="font-mono text-zinc-500">
                                  template {id.slice(0, 8)} — not readable
                                </span>
                              )}
                            </span>
                            <span className="text-[10px] text-zinc-500">
                              {sum
                                ? `${sum.pointCount} point${sum.pointCount === 1 ? '' : 's'}${
                                    sum.stages.length > 0
                                      ? ` · ITP stages: ${sum.stages.join(', ')}`
                                      : ''
                                  }`
                                : 'no ITP points defined on this template'}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* ── Selection control, draft only ────────────────────── */}
                <div className="mt-3 border-t border-white/[0.05] pt-3">
                  <QcpScopeTemplatePicker
                    stageId={s.id}
                    stageName={s.name || `Stage ${s.sequenceNo}`}
                    templates={templateOptions}
                    selectedIds={selected}
                    action={setTemplatesAction}
                    disabled={!editable}
                    disabledReason={notEditableReason}
                  />
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <p className="text-[11px] leading-relaxed text-zinc-600">
        Points are defined on the scope template and are edited in the{' '}
        <Link href="/admin/compliance/templates" className="text-zinc-400 underline">
          Scope Template Library
        </Link>
        , never here — a plan that could edit a point would be a second template
        system. The counts above are definition counts; what has actually been
        recorded on site is the ITP&apos;s answer on a job.
      </p>
    </section>
  );
}

const CHIP_TONE: Record<string, string> = {
  zinc: 'bg-white/[0.04] text-zinc-300 ring-white/[0.08]',
  rose: 'bg-rose-500/10 text-rose-300 ring-rose-500/20',
  violet: 'bg-violet-500/10 text-violet-300 ring-violet-500/20',
  sky: 'bg-sky-500/10 text-sky-300 ring-sky-500/20',
};

function Chip({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof Layers;
  label: string;
  tone: keyof typeof CHIP_TONE;
}) {
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ring-inset ' +
        (CHIP_TONE[tone] ?? CHIP_TONE.zinc)
      }
    >
      <Icon className="h-3 w-3" strokeWidth={1.75} />
      {label}
    </span>
  );
}
