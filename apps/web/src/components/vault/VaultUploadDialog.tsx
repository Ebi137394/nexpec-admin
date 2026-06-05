// ════════════════════════════════════════════════════════════════════════════
//  components/vault/VaultUploadDialog.tsx — inline upload form
//
//  Toggle-visible upload card that wraps uploadVaultDocumentAction.
//  Categories: insurance / license / nda / msa / regulatory / audit / other.
//  File limit 25 MB (enforced by storage bucket + server action).
// ════════════════════════════════════════════════════════════════════════════

'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { uploadVaultDocumentAction } from '@/lib/actions/vault';
import { vaultActionInitialState, type VaultActionState } from '@/lib/actions/vault.types';
import { VAULT_CATEGORY_LABEL, type VaultCategory } from '@/lib/data/vault.types';

const CATEGORY_VALUES: VaultCategory[] = [
  'insurance',
  'license',
  'nda',
  'msa',
  'regulatory',
  'audit',
  'other',
];

export function VaultUploadDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<VaultActionState, FormData>(
    uploadVaultDocumentAction,
    vaultActionInitialState,
  );
  const [fileName, setFileName] = useState<string | null>(null);

  // Auto-close on success
  useEffect(() => {
    if (state.ok) {
      const t = setTimeout(() => {
        setOpen(false);
        setFileName(null);
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [state.ok]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 self-start rounded-xl bg-violet-glow px-4 py-2.5 text-sm font-bold uppercase tracking-industrial text-ink-900 transition hover:bg-violet-glow/90"
      >
        <Upload className="h-4 w-4" strokeWidth={2} />
        Upload document
      </button>
    );
  }

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-3xl border border-violet/30 bg-violet/[0.04] p-5 sm:p-6"
    >
      <header className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-display text-base font-semibold text-white">
          <Upload className="h-4 w-4 text-violet-glow" strokeWidth={2} />
          Upload compliance document
        </h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full p-1.5 text-zinc-400 hover:bg-white/[0.05] hover:text-white"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      {state.error ? (
        <Alert tone="red" msg={state.error} />
      ) : state.ok && state.message ? (
        <Alert tone="green" msg={state.message} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Document name" required error={undefined}>
          <input
            name="label"
            type="text"
            required
            maxLength={120}
            minLength={2}
            placeholder="e.g. Liability Insurance 2026"
            className={inputCls()}
          />
        </Field>
        <Field label="Category" required>
          <select name="category" required defaultValue="insurance" className={inputCls()}>
            {CATEGORY_VALUES.map((c) => (
              <option key={c} value={c}>
                {VAULT_CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Valid from" hint="Optional, YYYY-MM-DD">
          <input name="validFrom" type="date" className={inputCls()} />
        </Field>
        <Field label="Valid until" hint="Optional, YYYY-MM-DD">
          <input name="validUntil" type="date" className={inputCls()} />
        </Field>
      </div>

      <Field label="Notes" hint="Optional">
        <textarea
          name="notes"
          rows={2}
          maxLength={2000}
          placeholder="Internal notes for your team"
          className={`${inputCls()} resize-y`}
        />
      </Field>

      <Field label="File" required hint="PDF, image, or Office doc, 25 MB max">
        <label
          htmlFor="vault-file"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-violet/30 bg-violet/[0.02] px-4 py-6 text-center transition hover:border-violet/60 hover:bg-violet/[0.06]"
        >
          <Upload className="h-5 w-5 text-violet-glow" strokeWidth={1.75} />
          <p className="text-sm font-semibold text-white">
            {fileName ?? 'Choose a file to upload'}
          </p>
          <p className="text-[10px] text-zinc-500">
            Accepted: PDF, JPG, PNG, WEBP, HEIC, DOC, DOCX, XLSX
          </p>
        </label>
        <input
          id="vault-file"
          name="file"
          type="file"
          required
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xlsx,application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          className="hidden"
        />
      </Field>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setFileName(null);
          }}
          className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:border-white/20 hover:text-white"
        >
          Cancel
        </button>
        <UploadButton />
      </div>
    </form>
  );
}

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-xl bg-violet-glow px-5 py-2.5 text-sm font-bold uppercase tracking-industrial text-ink-900 transition hover:bg-violet-glow/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
      {pending ? 'Uploading…' : 'Upload'}
    </button>
  );
}

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-industrial text-zinc-400">
        <span>
          {label}
          {required ? <span className="ml-1 text-violet-glow">*</span> : null}
        </span>
        {error ? (
          <span className="text-[10px] font-semibold normal-case tracking-normal text-red-300">
            {error}
          </span>
        ) : null}
      </label>
      <div className="mt-1.5">{children}</div>
      {hint && !error ? <p className="mt-1.5 text-[10px] text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function inputCls() {
  return 'w-full rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet-glow/40 focus:outline-none focus:ring-2 focus:ring-violet-glow/30';
}

function Alert({ tone, msg }: { tone: 'red' | 'green'; msg: string }) {
  const cls =
    tone === 'green'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
      : 'border-red-500/30 bg-red-500/10 text-red-200';
  const icon = tone === 'green' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />;
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${cls}`}>
      <span className="mt-0.5">{icon}</span>
      <span>{msg}</span>
    </div>
  );
}
