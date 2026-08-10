'use client';
// ════════════════════════════════════════════════════════════════════════════
//  components/qcp/QcpScopeTemplatePicker.tsx — selecting EXISTING templates
//
//  QCP orchestrates; it does not own points. This picker selects rows from
//  public.inspection_scope_templates — the one template spine that
//  jobs.scope_template_id and itp_points.template_id already hang off — and the
//  selection is stored as a link row in qcp_stage_templates. Nothing here
//  creates a template, edits a template, or copies a point out of one.
//
//  ── NO PRICE, STRUCTURALLY ─────────────────────────────────────────────────
//  The option type this component accepts (QcpScopeTemplateOption) HAS NO PRICE
//  FIELD, and the reader that produces it names its columns and omits
//  base_price_cents. There is therefore nothing to render even by mistake: a
//  future edit that wanted to show a price would have to change the reader, the
//  type and this file, and each of those carries the warning.
//
//  Client component for one reason: filtering three hundred templates by
//  keyword without a round trip. The submission is an ordinary form post to a
//  server action — no fetch, no optimistic state, no second source of truth
//  about what is selected. The server action calls nx_qcp_set_stage_templates,
//  which re-decides authorisation and refuses any revision that is not a draft.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Search, Layers, Check, ShieldCheck, MapPin, Hash } from 'lucide-react';
import type { QcpScopeTemplateOption } from '@/lib/data/qcp';

export function QcpScopeTemplatePicker({
  stageId,
  stageName,
  templates,
  selectedIds,
  action,
  disabled = false,
  disabledReason,
}: {
  stageId: string;
  stageName: string;
  templates: QcpScopeTemplateOption[];
  selectedIds: readonly string[];
  /** Server action bound by the page. This component never calls the RPC itself. */
  action: (formData: FormData) => void | Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedIds));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.region.toLowerCase().includes(q),
    );
  }, [templates, query]);

  // A template that was selected on an earlier revision but has since been
  // retired must stay visible and stay checked — dropping it from the list
  // would silently unselect it on the next save.
  const orphanedSelections = useMemo(
    () => [...selected].filter((id) => !templates.some((t) => t.id === id)),
    [selected, templates],
  );

  const dirty =
    selected.size !== selectedIds.length ||
    [...selected].some((id) => !selectedIds.includes(id));

  function toggle(id: string) {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (disabled) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <p className="text-[11px] leading-relaxed text-zinc-500">
          {disabledReason ??
            'Template selection is a draft-only act. nx_qcp_set_stage_templates refuses any other state, so no control is drawn here.'}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="stageId" value={stageId} />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="templateIds" value={id} />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[14rem]">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600"
            strokeWidth={1.75}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter templates for "${stageName}"`}
            className="w-full rounded-lg border border-white/[0.08] bg-zinc-900 py-1.5 pl-8 pr-2.5 text-xs text-zinc-200 placeholder:text-zinc-600"
          />
        </label>
        <span className="text-[11px] text-zinc-500">
          {selected.size} selected
        </span>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40"
          disabled={!dirty}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          {dirty ? 'Save selection' : 'No changes'}
        </button>
      </div>

      {orphanedSelections.length > 0 && (
        <p className="text-[11px] leading-relaxed text-amber-300/80">
          {orphanedSelections.length} selected template
          {orphanedSelections.length === 1 ? ' is' : 's are'} not in the current
          list — most likely retired from the library since this revision was
          authored. They stay selected and are re-sent on save, because dropping
          them here would quietly change a plan nobody asked to change.
        </p>
      )}

      <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <li className="rounded-xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-xs text-zinc-500">
            No template matches that filter.
          </li>
        ) : (
          filtered.map((t) => {
            const on = selected.has(t.id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => toggle(t.id)}
                  aria-pressed={on}
                  className={
                    'flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ' +
                    (on
                      ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]')
                  }
                >
                  <span
                    className={
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ' +
                      (on
                        ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                        : 'border-white/[0.12] text-transparent')
                    }
                  >
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-white">{t.name}</span>
                      <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                        v{t.version}
                      </span>
                      {!t.isActive && (
                        <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300 ring-1 ring-inset ring-amber-500/20">
                          retired
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-3 text-[10px] text-zinc-500">
                      <span className="inline-flex items-center gap-1">
                        <Hash className="h-3 w-3" strokeWidth={1.75} />
                        {t.category}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" strokeWidth={1.75} />
                        {t.region === 'global' ? 'global' : t.region}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
                        {t.requiresCredentialTier}
                      </span>
                      <span className="font-mono">{t.slug}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-zinc-600">
        <Layers className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
        Saving replaces this stage&apos;s whole selection. The link row carries a
        template reference and nothing else — no point, stage or acceptance
        criterion is copied — so a template&apos;s ITP points continue to belong
        to the template and follow it when it is versioned.
      </p>
    </form>
  );
}
