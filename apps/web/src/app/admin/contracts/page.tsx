// ════════════════════════════════════════════════════════════════════════════
//  app/admin/contracts/page.tsx — Admin job-contracts list + generation form
//
//  V3 schema: job_contracts, generated per hired application via
//  admin_generate_job_contract, then counter-signed client → inspector.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  FileCheck2,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
  Link2,
  Clock,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchAdminContracts } from '@/lib/data/contracts';
import { createContract } from '@/lib/actions/contracts';
import { fetchAllDealAgreements } from '@/lib/data/unifiedContracts';

export const metadata: Metadata = { title: 'Admin, Contracts' };
export const dynamic = 'force-dynamic';

const DEAL_KIND_LABEL: Record<string, string> = {
  client_supply: 'Client Supply & Inspection',
  supplier_supply: 'Supplier Supply',
  inspector_engagement: 'Inspector Engagement',
};
const STATUS_CHIP: Record<string, string> = {
  pending_client_signature:
    'border-accent-amber/30 bg-accent-amber/10 text-accent-amber',
  pending_inspector_signature:
    'border-cyan-glow/30 bg-cyan-glow/10 text-cyan-glow',
  fully_executed: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
  voided: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
};
function fmtDealCents(v: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((v || 0) / 100);
}

interface PageProps {
  searchParams?: Promise<{ error?: string; created?: string }>;
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
  const dealAgreements = await fetchAllDealAgreements();
  const returnTo = '/admin/contracts';

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Admin, Contracts
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Job contracts
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Binding per-job agreements generated from a hired application. The
          client signs first, then the inspector counter-signs and the job
          moves to in-progress. Each side sees only its own price. Signatures
          record typed name + timestamp + IP.
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
          Contract generated. The client was notified to sign.
        </Banner>
      )}

      {/* Brokered deal agreements — supplier / client / inspector legs across all deals */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Brokered deal agreements ({dealAgreements.length})
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Every supplier, client, and inspector leg across all deals. Manage each from the matching Quote Review panel.
        </p>
        {dealAgreements.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-6 text-center text-sm text-zinc-400">
            No deal agreements yet. Supplier and client legs appear here automatically the moment an RFQ quote is awarded.
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {dealAgreements.map((a) => (
              <li key={a.contractId}>
                <Link
                  href={`/admin/contracts/agreement/${a.contractId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-violet/30 hover:bg-white/[0.04]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white">{DEAL_KIND_LABEL[a.kind] ?? a.kind}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      {fmtDealCents(a.amountCents)}, {new Date(a.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                      a.status === 'executed'
                        ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                        : a.status === 'presented'
                          ? 'border-violet/30 bg-violet/10 text-violet-glow'
                          : 'border-white/10 bg-white/[0.04] text-zinc-300'
                    }`}
                  >
                    {a.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Job contracts ({contracts.length})
        </h2>
        {contracts.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
            <FileCheck2 className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-zinc-300">No job contracts generated yet.</p>
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
                    <p className="text-sm font-semibold text-white">
                      {c.jobTitle ?? 'Inspection job'}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {c.clientName ?? 'Client'} → {c.inspectorName ?? 'Inspector'},{' '}
                      {new Date(c.createdAt).toLocaleDateString()}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-zinc-400">
                      Client {fmtDealCents(c.clientPriceCents)}, payout{' '}
                      {fmtDealCents(c.inspectorPayoutCents)}, spread{' '}
                      {fmtDealCents(c.spreadCents)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                        STATUS_CHIP[c.status] ?? 'border-white/10 bg-white/[0.03] text-zinc-400'
                      }`}
                    >
                      {c.status.replaceAll('_', ' ')}
                    </span>
                    {c.customContractUrl && (
                      <a
                        href={c.customContractUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 text-[11px] font-semibold text-cyan-glow"
                      >
                        <Link2 className="h-3 w-3" strokeWidth={1.75} />
                        Document
                      </a>
                    )}
                    <Link
                      href={`/admin/jobs?inspect=${c.jobId}`}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
                    >
                      Open job
                    </Link>
                  </div>
                </div>

                {/* Signature states */}
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  {c.clientSignedAt ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2 py-0.5 font-semibold text-accent-green">
                      <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={1.75} />
                      Client signed {new Date(c.clientSignedAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-semibold text-zinc-400">
                      <Clock className="h-2.5 w-2.5" strokeWidth={1.75} />
                      Client signature pending
                    </span>
                  )}
                  {c.inspectorSignedAt ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2 py-0.5 font-semibold text-accent-green">
                      <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={1.75} />
                      Inspector signed {new Date(c.inspectorSignedAt).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-semibold text-zinc-400">
                      <Clock className="h-2.5 w-2.5" strokeWidth={1.75} />
                      Inspector signature pending
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Generate form — V3 contracts are born from a hired application. */}
      <details className="group rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8 open:bg-violet/[0.06]">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-industrial text-violet-glow">
          <PlusCircle className="h-4 w-4" strokeWidth={1.75} />
          Generate a job contract
        </summary>
        <form action={createContract} className="mt-5 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Application UUID <span className="ml-1 text-violet-glow">*</span>
            </span>
            <input
              name="applicationId"
              required
              maxLength={36}
              placeholder="Paste the application UUID from /admin/jobs"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 font-mono text-xs text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Client price (USD) <span className="ml-1 text-violet-glow">*</span>
            </span>
            <input
              name="clientPriceDollars"
              type="number"
              required
              min={0}
              step={1}
              placeholder="4500"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Inspector payout (USD) <span className="ml-1 text-violet-glow">*</span>
            </span>
            <input
              name="inspectorPayoutDollars"
              type="number"
              required
              min={0}
              step={1}
              placeholder="3200"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
            />
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Contract terms (markdown)
            </span>
            <textarea
              name="contractTextMd"
              rows={8}
              maxLength={200000}
              placeholder="Binding terms shown to both signers. Leave empty only if linking an external document below."
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
            />
          </label>

          {/* V3 stores an external document URL (custom_contract_url); there is
              no PDF-upload storage path on job_contracts, so the old upload
              flow was dropped. */}
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              External document link (optional)
            </span>
            <input
              name="customContractUrl"
              type="url"
              maxLength={2000}
              placeholder="https:// — DocuSign envelope or any HTTPS link to the canonical document"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
            />
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-violet/90"
            >
              <PlusCircle className="h-3 w-3" strokeWidth={1.75} />
              Generate contract
            </button>
            <p className="mt-2 text-[11px] text-zinc-500">
              Generating voids any prior active contract for the job and
              notifies the client to review and sign. Tip: the Jobs
              moderation panel can generate with a pre-filled template.
            </p>
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
