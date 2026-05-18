// ════════════════════════════════════════════════════════════════════════════
//  app/admin/contracts/page.tsx — Admin contracts list + creation form
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  FileCheck2,
  PlusCircle,
  ExternalLink,
  Link2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchAdminContracts } from '@/lib/data/contracts';
import { createContract, assignContract } from '@/lib/actions/contracts';
import { CONTRACT_KINDS, CONTRACT_KIND_LABELS } from '@/lib/data/contracts.types';
import { DocSourceToggle } from '@/components/forms/DocSourceToggle';

export const metadata: Metadata = { title: 'Admin · Contracts' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ error?: string; created?: string; assigned?: string }>;
}

export default async function AdminContractsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/admin/contracts'));
  const { data: isAdmin } = await supabase.rpc('nx_is_admin');
  if (!isAdmin) redirect('/');

  const contracts = await fetchAdminContracts();
  const today = new Date().toISOString().slice(0, 10);
  const returnTo = '/admin/contracts';

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Admin · Contracts
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Contracts library
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Author the platform&apos;s MSA / DPA / NDA / amendments. Each can be
          inline markdown, an uploaded PDF, or a link to DocuSign / Adobe
          Sign / the client&apos;s own legal pack. Assignments record signature
          evidence (typed name + IP + UA).
        </p>
      </header>

      {sp.error && (
        <Banner tone="error">
          <AlertCircle className="h-5 w-5 shrink-0" />
          {sp.error}
        </Banner>
      )}
      {sp.created && (
        <Banner tone="ok">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Contract created.
        </Banner>
      )}
      {sp.assigned && (
        <Banner tone="ok">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Assignment created. Recipient was notified.
        </Banner>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Library ({contracts.length})
        </h2>
        {contracts.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
            <FileCheck2 className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-zinc-300">No contracts published yet.</p>
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {contracts.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{c.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {CONTRACT_KIND_LABELS[c.kind]} · v{c.version} · effective{' '}
                      {new Date(c.effectiveFrom).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                        c.source === 'external_url'
                          ? 'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow'
                          : c.source === 'upload'
                            ? 'border-violet/30 bg-violet/10 text-violet-glow'
                            : 'border-white/10 bg-white/[0.03] text-zinc-400'
                      }`}
                    >
                      {c.source === 'external_url' ? 'External' : c.source === 'upload' ? 'PDF' : 'Inline'}
                    </span>
                    {c.pdfUrl && (
                      <a
                        href={c.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
                      >
                        View PDF
                        <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                      </a>
                    )}
                    {c.externalUrl && (
                      <a
                        href={c.externalUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 text-[11px] font-semibold text-cyan-glow"
                      >
                        <Link2 className="h-3 w-3" strokeWidth={1.75} />
                        Open
                      </a>
                    )}
                  </div>
                </div>

                {/* Assignment form */}
                <details className="mt-4 group">
                  <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow">
                    Assign to a user
                  </summary>
                  <form action={assignContract} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                    <input type="hidden" name="contractId" value={c.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <label className="flex flex-1 flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                        Party UUID
                      </span>
                      <input
                        name="partyId"
                        required
                        maxLength={36}
                        placeholder="Paste user UUID from /admin/users"
                        className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 font-mono text-xs text-white outline-none focus:border-violet/40"
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="required"
                        value="on"
                        defaultChecked
                        className="h-4 w-4 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40"
                      />
                      <span className="text-xs text-zinc-400">Required</span>
                    </label>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 rounded-full bg-violet px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-violet/90"
                    >
                      Assign
                    </button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Create-new form */}
      <details className="group rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8 open:bg-violet/[0.06]">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-industrial text-violet-glow">
          <PlusCircle className="h-4 w-4" strokeWidth={1.75} />
          Author a new contract
        </summary>
        <form
          action={createContract}
          encType="multipart/form-data"
          className="mt-5 grid gap-4 sm:grid-cols-2"
        >
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Kind <span className="ml-1 text-violet-glow">*</span>
            </span>
            <select
              name="kind"
              defaultValue="msa"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
            >
              {CONTRACT_KINDS.map((k) => (
                <option key={k} value={k} className="bg-ink-900">
                  {CONTRACT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Title <span className="ml-1 text-violet-glow">*</span>
            </span>
            <input
              name="title"
              required
              maxLength={200}
              placeholder="NEXPEC Master Services Agreement v2"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Effective from <span className="ml-1 text-violet-glow">*</span>
            </span>
            <input
              name="effectiveFrom"
              type="date"
              required
              defaultValue={today}
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
            />
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Inline body (markdown / plain text)
            </span>
            <textarea
              name="bodyMd"
              rows={8}
              maxLength={200000}
              placeholder="Canonical text shown inline to the signer. Leave empty if using an uploaded PDF or external link."
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
            />
          </label>

          <div className="sm:col-span-2">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Attachment (optional)
            </p>
            <DocSourceToggle
              fileAccept="application/pdf"
              defaultSource="upload"
              fileHelper="PDF only · max 25 MB. Leave the inline body empty if uploading."
              urlHelper="DocuSign envelope, Adobe Sign, or any HTTPS link to the canonical document."
            />
            {/* If neither file nor URL is desired, set source=inline via this radio: */}
            <p className="mt-2 text-[11px] text-zinc-500">
              Tip: if you want a pure-inline contract (markdown only, no
              attachment), choose &quot;Attach external link&quot; and leave the URL
              empty — the action will fall through to inline mode.
            </p>
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-violet/90"
            >
              <PlusCircle className="h-3 w-3" strokeWidth={1.75} />
              Publish contract
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'ok';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'error'
      ? 'border-accent-red/40 bg-accent-red/10 text-accent-red'
      : 'border-accent-green/40 bg-accent-green/10 text-accent-green';
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${cls}`}>
      {children}
    </div>
  );
}
