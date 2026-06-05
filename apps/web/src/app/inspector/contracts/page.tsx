// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/contracts/page.tsx — Inspector contract assignments
//
//  Mirrors /client/contracts. Same data layer (fetchMyAssignments) — the
//  contract_assignments table joins on party_id = auth.uid() regardless of
//  the user's role, so this works without role-specific RPCs.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  FileCheck2,
  ExternalLink,
  Link2,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchMyAssignments, fetchContractById } from '@/lib/data/contracts';
import { signContractAssignment } from '@/lib/actions/contracts';
import { CONTRACT_KIND_LABELS, type ContractKind } from '@/lib/data/contracts.types';
import { fetchMyInspectorJobContracts } from '@/lib/data/jobContracts';

export const metadata: Metadata = { title: 'Contracts' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ error?: string; signed?: string }>;
}

export default async function InspectorContractsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/inspector/contracts'));

  const assignments = await fetchMyAssignments();
  const jobContracts = await fetchMyInspectorJobContracts();
  const unsignedRequired = assignments.filter((a) => a.required && !a.signedAt);
  const returnTo = '/inspector/contracts';
  const fmtCents = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v / 100);

  const contractsById = new Map<string, Awaited<ReturnType<typeof fetchContractById>>>();
  for (const a of assignments) {
    if (!contractsById.has(a.contractId)) {
      contractsById.set(a.contractId, await fetchContractById(a.contractId));
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Inspector Portal, Contracts
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Contracts &amp; agreements
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Inspector services agreement, payout terms, NDAs. Read each one, then
          sign by typing your full legal name. We record the timestamp, your
          IP, and your browser&apos;s user-agent as evidence. Without a signed
          MSA, the platform cannot release payout on completed inspections.
        </p>
      </header>

      {unsignedRequired.length > 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-amber/30 bg-accent-amber/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-amber" />
          <p className="text-sm text-accent-amber">
            You have {unsignedRequired.length} required contract
            {unsignedRequired.length === 1 ? '' : 's'} waiting for your signature.
            Payouts and new dispatches may be paused until signed.
          </p>
        </div>
      )}

      {sp.error && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-red" />
          <p className="text-sm text-accent-red">{sp.error}</p>
        </div>
      )}
      {sp.signed && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-green" />
          <p className="text-sm text-accent-green">
            Signed. Your assignment record now has a timestamp, IP, and user-agent stamp.
          </p>
        </div>
      )}

      {/* JOB CONTRACTS — inspector view, blind to client price */}
      {jobContracts.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-xl font-semibold tracking-tight text-white">
            Job contracts ({jobContracts.length})
          </h2>
          <ul className="space-y-3">
            {jobContracts.map((c) => {
              const needsYou = c.status === 'pending_inspector_signature';
              const fullyExecuted = c.status === 'fully_executed';
              return (
                <li
                  key={c.id}
                  className={`rounded-3xl border p-5 ${
                    needsYou
                      ? 'border-cyan-glow/40 bg-cyan-glow/[0.06]'
                      : fullyExecuted
                        ? 'border-accent-green/30 bg-accent-green/[0.04]'
                        : 'border-white/[0.06] bg-white/[0.01]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">
                        {c.jobTitle ?? 'Inspection contract'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        Client: {c.clientName ?? '—'}
                      </p>
                      <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 font-mono text-[11px] font-semibold text-cyan-glow">
                        Your payout, {fmtCents(c.inspectorPayoutCents)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                        needsYou
                          ? 'border-cyan-glow/40 bg-cyan-glow/15 text-cyan-glow'
                          : fullyExecuted
                            ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                            : 'border-white/10 bg-white/[0.04] text-zinc-400'
                      }`}
                    >
                      {c.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <Link
                    href={`/inspector/contracts/job/${c.id}`}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-cyan-glow px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-ink-950 shadow-sm hover:bg-cyan-glow/90"
                  >
                    {needsYou ? 'Review & sign' : 'Open contract'}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <h2 className="font-display text-xl font-semibold tracking-tight text-white">
        Legal agreements ({assignments.length})
      </h2>

      {assignments.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <FileCheck2 className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-zinc-400">
            No contracts assigned. Admin will publish your MSA when onboarding starts.
          </p>
        </div>
      ) : (
        <ul className="space-y-4">
          {assignments.map((a) => {
            const c = contractsById.get(a.contractId) ?? null;
            const signed = !!a.signedAt;
            return (
              <li
                key={a.id}
                className={`rounded-3xl border bg-white/[0.01] p-6 sm:p-8 ${
                  signed
                    ? 'border-accent-green/30'
                    : a.required
                      ? 'border-accent-amber/30'
                      : 'border-white/[0.06]'
                }`}
              >
                <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-lg font-semibold tracking-tight text-white">
                        {a.contractTitle ?? c?.title ?? 'Contract'}
                      </h2>
                      <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                        {CONTRACT_KIND_LABELS[
                          (a.contractKind ?? c?.kind ?? 'other') as ContractKind
                        ]}
                      </span>
                      {a.required && !signed && (
                        <span className="rounded-full border border-accent-amber/30 bg-accent-amber/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-amber">
                          Required
                        </span>
                      )}
                      {signed && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
                          <CheckCircle2 className="h-2.5 w-2.5" strokeWidth={1.75} />
                          Signed
                        </span>
                      )}
                    </div>
                    {signed && (
                      <p className="mt-2 text-[11px] text-zinc-500">
                        Signed by {a.signerTypedName} on{' '}
                        {new Date(a.signedAt!).toLocaleString()}
                      </p>
                    )}
                  </div>

                  {c?.pdfUrl && (
                    <a
                      href={c.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
                    >
                      View PDF
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  )}
                  {c?.externalUrl && (
                    <a
                      href={c.externalUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1.5 text-xs font-semibold text-cyan-glow hover:bg-cyan-glow/20"
                    >
                      <Link2 className="h-3 w-3" strokeWidth={1.75} />
                      External
                    </a>
                  )}
                </header>

                {c?.bodyMd && c.bodyMd.length > 0 && (
                  <div className="mt-5 max-h-72 overflow-y-auto rounded-2xl border border-white/[0.04] bg-ink-950/40 p-4 text-sm text-zinc-300">
                    <pre className="whitespace-pre-wrap break-words font-sans">{c.bodyMd}</pre>
                  </div>
                )}

                {!signed && (
                  <form
                    action={signContractAssignment}
                    className="mt-5 rounded-2xl border border-violet/30 bg-violet/[0.04] p-4"
                  >
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <label
                      htmlFor={`typed-${a.id}`}
                      className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow"
                    >
                      Type your full legal name to sign
                    </label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        id={`typed-${a.id}`}
                        name="typedName"
                        required
                        minLength={2}
                        maxLength={160}
                        placeholder="Jane Q. Public"
                        className="flex-1 rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/60"
                      />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-violet/90"
                      >
                        <Clock className="h-3 w-3" strokeWidth={1.75} />
                        Sign &amp; record
                      </button>
                    </div>
                    <p className="mt-2 text-[11px] text-zinc-500">
                      Your name + timestamp + IP + user-agent will be stored.
                      Equivalent to a typed e-signature.
                    </p>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[11px] text-zinc-600">
        Questions?{' '}
        <Link href="/inspector/messages" className="underline hover:text-zinc-400">
          Help &amp; Support
        </Link>
        .
      </p>
    </div>
  );
}
