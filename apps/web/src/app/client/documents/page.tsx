// ════════════════════════════════════════════════════════════════════════════
//  app/client/documents/page.tsx — Multi-role employer document surface
//
//  Serves client / agency / enterprise. Owner full CRUD. Two views toggled
//  via search-param `scope`: org-wide (job_id NULL) or all (org + per-job).
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  FileText,
  Trash2,
  Upload,
  ExternalLink,
  Link2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchMyClientDocuments } from '@/lib/data/clientDocuments';
import {
  CLIENT_DOC_KINDS,
  CLIENT_DOC_KIND_LABELS,
} from '@/lib/data/clientDocuments.types';
import {
  createClientDocument,
  deleteClientDocument,
} from '@/lib/actions/clientDocuments';
import { DocSourceToggle } from '@/components/forms/DocSourceToggle';

export const metadata: Metadata = { title: 'Documents' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ error?: string; saved?: string; deleted?: string }>;
}

export default async function ClientDocumentsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/client/documents'));

  const documents = await fetchMyClientDocuments();
  const returnTo = '/client/documents';

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal · Documents
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Operational documents
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Drawings, P&amp;IDs, spec sheets, NDAs, prior reports, vendor docs.
          Stored privately in the <span className="font-mono">client_documents</span> bucket.
          Documents tagged to a specific job are shared with that job&apos;s
          assigned inspector as read-only.
        </p>
      </header>

      {sp.error && (
        <Banner tone="error">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {sp.error}
        </Banner>
      )}
      {sp.saved && (
        <Banner tone="ok">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Document uploaded.
        </Banner>
      )}
      {sp.deleted && (
        <Banner tone="ok">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Document deleted.
        </Banner>
      )}

      {/* List */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Your dossier ({documents.length})
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Org-wide docs (no job tag) plus job-scoped docs you&apos;ve uploaded.
        </p>
        {documents.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
            <FileText className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-zinc-300">No documents yet.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Upload one below — attach to a specific job, or leave the job
              field empty for an org-wide reference.
            </p>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {doc.label}
                    </span>
                    <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                      {CLIENT_DOC_KIND_LABELS[doc.kind]}
                    </span>
                    {doc.jobId ? (
                      <span className="rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
                        Job · {(doc.jobTitle ?? doc.jobId.slice(0, 8)).slice(0, 40)}
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                        Org-wide
                      </span>
                    )}
                    {doc.source === 'external_url' && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                        <Link2 className="h-2.5 w-2.5" strokeWidth={1.75} />
                        External
                      </span>
                    )}
                  </div>
                  {doc.notes && (
                    <p className="mt-1 text-xs text-zinc-500">{doc.notes}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {doc.source === 'external_url' && doc.externalUrl ? (
                    <a
                      href={doc.externalUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1.5 text-xs font-semibold text-cyan-glow transition-colors hover:bg-cyan-glow/20"
                    >
                      <Link2 className="h-3 w-3" strokeWidth={1.75} />
                      Open link
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  ) : doc.fileUrl ? (
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
                    >
                      View
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  ) : null}
                  <form action={deleteClientDocument}>
                    <input type="hidden" name="id" value={doc.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <button
                      type="submit"
                      aria-label="Delete document"
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
                    >
                      <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Upload form */}
      <details className="group rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8 open:bg-violet/[0.06]">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-industrial text-violet-glow">
          <Upload className="h-4 w-4" strokeWidth={1.75} />
          Upload a document
        </summary>
        <form
          action={createClientDocument}
          encType="multipart/form-data"
          className="mt-5 grid gap-4 sm:grid-cols-2"
        >
          <input type="hidden" name="returnTo" value={returnTo} />

          <Field label="Kind" required>
            <select
              name="kind"
              defaultValue="drawing"
              className={inputCls}
            >
              {CLIENT_DOC_KINDS.map((k) => (
                <option key={k} value={k} className="bg-ink-900">
                  {CLIENT_DOC_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Label" required>
            <input
              name="label"
              required
              maxLength={160}
              placeholder="P&ID — Crude pipeline segment 4A"
              className={inputCls}
            />
          </Field>
          <Field label="Tag to job (optional — UUID)" className="sm:col-span-2">
            <input
              name="jobId"
              maxLength={36}
              placeholder="paste a job UUID, or leave empty for org-wide"
              className={`${inputCls} font-mono text-xs`}
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Job-scoped docs are visible to the assigned inspector (read-only).
              Org-wide docs are private to your org + admin.
            </p>
          </Field>
          <div className="sm:col-span-2">
            <DocSourceToggle />
          </div>
          <Field label="Notes (optional)" className="sm:col-span-2">
            <input
              name="notes"
              maxLength={500}
              placeholder="Version, source, anything the inspector or admin should know"
              className={inputCls}
            />
          </Field>
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-violet/90"
            >
              <Upload className="h-3 w-3" strokeWidth={1.75} />
              Upload
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

const inputCls =
  'w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40';

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
        {required && <span className="ml-1 text-violet-glow">*</span>}
      </span>
      {children}
    </label>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'ok';
  children: React.ReactNode;
}) {
  const classes =
    tone === 'error'
      ? 'border-accent-red/40 bg-accent-red/10 text-accent-red'
      : 'border-accent-green/40 bg-accent-green/10 text-accent-green';
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${classes}`}>
      {children}
    </div>
  );
}
