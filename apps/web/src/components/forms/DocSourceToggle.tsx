// ════════════════════════════════════════════════════════════════════════════
//  components/forms/DocSourceToggle.tsx
//
//  Radio toggle "Upload file" ↔ "Attach external link". Renders only the
//  fields matching the chosen mode, so the action receives one input or the
//  other but never both — mirroring the DB CHECK XOR.
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Upload, Link2, AlertCircle } from 'lucide-react';

interface Props {
  /** Form field name for the source toggle. Defaults to "source". */
  sourceName?: string;
  /** Form field name for the external URL input. Defaults to "externalUrl". */
  urlName?: string;
  /** Form field name for the file input. Defaults to "file". */
  fileName?: string;
  /** Accept attribute for the file input. */
  fileAccept?: string;
  /** Initial mode. Defaults to 'upload'. */
  defaultSource?: 'upload' | 'external_url';
  /** Custom helper line under the file input. */
  fileHelper?: string;
  /** Custom helper line under the URL input. */
  urlHelper?: string;
}

export function DocSourceToggle({
  sourceName = 'source',
  urlName = 'externalUrl',
  fileName = 'file',
  fileAccept = 'image/jpeg,image/png,image/webp,image/heic,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  defaultSource = 'upload',
  fileHelper = 'JPG / PNG / HEIC / PDF / Word / Excel, max 25 MB.',
  urlHelper = 'Paste a public or signed link from Google Drive, Dropbox, OneDrive, SharePoint, S3, DocuSign, etc.',
}: Props) {
  const [source, setSource] = useState<'upload' | 'external_url'>(defaultSource);

  return (
    <div className="space-y-4">
      {/* Hidden input carries the source value to the action */}
      <input type="hidden" name={sourceName} value={source} />

      {/* Toggle cards */}
      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <legend className="sr-only">Document source</legend>
        <Card
          checked={source === 'upload'}
          onSelect={() => setSource('upload')}
          icon={<Upload className="h-4 w-4" strokeWidth={1.75} />}
          title="Upload file"
          blurb="Standard upload to private NEXPEC storage. Best for sub-25 MB assets."
        />
        <Card
          checked={source === 'external_url'}
          onSelect={() => setSource('external_url')}
          icon={<Link2 className="h-4 w-4" strokeWidth={1.75} />}
          title="Attach external link"
          blurb="Use for large CAD / video / ZIPs hosted on your own Drive, Dropbox, OneDrive, S3, or DocuSign."
        />
      </fieldset>

      {/* Source-specific input */}
      {source === 'upload' ? (
        <div>
          <label
            htmlFor="doc-file"
            className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500"
          >
            File <span className="ml-1 text-violet-glow">*</span>
          </label>
          <input
            id="doc-file"
            name={fileName}
            type="file"
            required
            accept={fileAccept}
            className="mt-2 w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-violet/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-violet-glow hover:file:bg-violet/25"
          />
          <p className="mt-1.5 text-[11px] text-zinc-500">{fileHelper}</p>
        </div>
      ) : (
        <div>
          <label
            htmlFor="doc-url"
            className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500"
          >
            External link <span className="ml-1 text-violet-glow">*</span>
          </label>
          <input
            id="doc-url"
            name={urlName}
            type="url"
            required
            inputMode="url"
            placeholder="https://drive.google.com/file/d/…"
            pattern="https?://.*"
            maxLength={2000}
            className="mt-2 w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
          />
          <p className="mt-1.5 text-[11px] text-zinc-500">{urlHelper}</p>
          <p className="mt-2 inline-flex items-start gap-1.5 rounded-lg border border-accent-amber/30 bg-accent-amber/10 px-3 py-1.5 text-[11px] text-accent-amber">
            <AlertCircle className="h-3 w-3 shrink-0" strokeWidth={1.75} />
            Ensure the link has the appropriate sharing permissions for the
            assigned inspector and NEXPEC admin. Links are stored in plain
            text on our DB but the underlying file stays on your system.
          </p>
        </div>
      )}
    </div>
  );
}

function Card({
  checked,
  onSelect,
  icon,
  title,
  blurb,
}: {
  checked: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  blurb: string;
}) {
  return (
    <label
      className={
        'group flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition-colors ' +
        (checked
          ? 'border-violet/50 bg-violet/10 ring-1 ring-violet/30'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-violet/30 hover:bg-white/[0.04]')
      }
    >
      <input
        type="radio"
        name="_docSourceRadio"
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      <span
        className={
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset ' +
          (checked
            ? 'bg-violet/20 text-violet-glow ring-violet/40'
            : 'bg-white/[0.04] text-zinc-400 ring-white/10')
        }
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">{blurb}</p>
      </div>
    </label>
  );
}
