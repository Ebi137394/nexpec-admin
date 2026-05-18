// ════════════════════════════════════════════════════════════════════════════
//  components/forms/ReportExternalUrlField.tsx
//
//  Optional external-URL input the inspector can paste IN ADDITION to (or
//  instead of) the existing photo evidence on the submit-report flow. This
//  is the "report is a 200MB 4K video — host it on my Dropbox" path.
//
//  This component is a thin wrapper; the existing submitReport action can
//  be extended to read `externalUrl` from formData without changes here.
//  Drop into /inspector/jobs/[id]/submit-report/page.tsx as a sibling
//  field — the submitInspectionReport action remains untouched until you
//  wire it (separate one-line patch, deferred per no-regression mandate).
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Link2, AlertCircle } from 'lucide-react';

interface Props {
  /** Form field name. Defaults to "externalUrl". */
  name?: string;
  /** Form field name for the label. Defaults to "externalUrlLabel". */
  labelName?: string;
  defaultExpanded?: boolean;
}

export function ReportExternalUrlField({
  name = 'externalUrl',
  labelName = 'externalUrlLabel',
  defaultExpanded = false,
}: Props) {
  const [open, setOpen] = useState(defaultExpanded);

  return (
    <div className="rounded-2xl border border-cyan-glow/20 bg-cyan-glow/[0.04] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-industrial text-cyan-glow"
      >
        <Link2 className="h-3 w-3" strokeWidth={1.75} />
        {open ? 'Hide external link option' : 'Attach external link instead of (or alongside) photos'}
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="inline-flex items-start gap-1.5 rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-1.5 text-[11px] text-accent-amber">
            <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            For large 4K walk-throughs, CAD/BIM bundles, or full-resolution
            inspection footage that exceeds the upload cap. Ensure your link
            grants access to the assigned client and NEXPEC admin.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              External link
            </span>
            <input
              name={name}
              type="url"
              inputMode="url"
              placeholder="https://drive.google.com/… or https://dropbox.com/…"
              pattern="https?://.*"
              maxLength={2000}
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-cyan-glow/40"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Label (optional)
            </span>
            <input
              name={labelName}
              maxLength={120}
              placeholder='e.g. "Final walk-through video + CAD bundle (Drive)"'
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-cyan-glow/40"
            />
          </label>
        </div>
      )}
    </div>
  );
}
