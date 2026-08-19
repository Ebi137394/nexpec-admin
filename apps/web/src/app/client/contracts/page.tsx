// ════════════════════════════════════════════════════════════════════════════
//  app/client/contracts/page.tsx — Client contracts (V3 + spine)
//
//  Lists the client's job_contracts (V3, own price only per price-blindness)
//  and brokered-spine supply agreements. The former Sprint-12D "legal
//  agreements" section was removed 2026-07-02: its backing schema (contracts
//  doc-model + contract_assignments + sign_contract) never shipped to prod,
//  so the list had always rendered empty.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileCheck2, CheckCircle2, AlertCircle } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchMyClientJobContracts } from '@/lib/data/jobContracts';
import { fetchMyNativeSpineContracts } from '@/lib/data/unifiedContracts';

export const metadata: Metadata = { title: 'Contracts' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ error?: string; signed?: string }>;
}

export default async function ClientContractsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/client/contracts'));

  const jobContracts = await fetchMyClientJobContracts();
  const spine = await fetchMyNativeSpineContracts('client_supply');
  const fmtCents = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v / 100);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal, Contracts
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Contracts &amp; agreements
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          MSAs, NDAs, data processing addenda. Read each one, then sign by
          typing your full legal name. We record the timestamp, your IP, and
          your browser&apos;s user-agent as evidence.
        </p>
      </header>

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
            Signed. Your assignment record now has a timestamp, IP, and
            user-agent stamp.
          </p>
        </div>
      )}

      {/* JOB CONTRACTS — per-project binding agreements */}
      {jobContracts.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-xl font-semibold tracking-tight text-white">
            Job contracts ({jobContracts.length})
          </h2>
          <ul className="space-y-3">
            {jobContracts.map((c) => {
              const needsYou = c.status === 'pending_client_signature';
              const fullyExecuted = c.status === 'fully_executed';
              return (
                <li
                  key={c.id}
                  className={`rounded-3xl border p-5 ${
                    needsYou
                      ? 'border-violet/40 bg-violet/[0.06]'
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
                      <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                        Inspector: {c.inspectorHandle}
                      </p>
                      <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 font-mono text-[11px] font-semibold text-violet-glow">
                        Total contract price, {fmtCents(c.clientPriceCents)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                        needsYou
                          ? 'border-violet/40 bg-violet/15 text-violet-glow'
                          : fullyExecuted
                            ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                            : 'border-white/10 bg-white/[0.04] text-zinc-400'
                      }`}
                    >
                      {c.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  <Link
                    href={`/client/contracts/job/${c.id}`}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-violet/90"
                  >
                    {needsYou ? 'Review & sign' : 'Open contract'}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* TURNKEY SUPPLY & INSPECTION — brokered spine */}
      {spine.length > 0 && (
        <section>
          <h2 className="mb-4 font-display text-xl font-semibold tracking-tight text-white">
            Turnkey supply &amp; inspection ({spine.length})
          </h2>
          <ul className="space-y-3">
            {spine.map((s) => {
              const needsYou = s.signable;
              const done = s.status === 'executed';
              return (
                <li
                  key={s.contractId}
                  className={`rounded-3xl border p-5 ${
                    needsYou
                      ? 'border-violet/40 bg-violet/[0.06]'
                      : done
                        ? 'border-accent-green/30 bg-accent-green/[0.04]'
                        : 'border-white/[0.06] bg-white/[0.01]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-white">Supply &amp; Inspection Agreement</p>
                      <p className="mt-2 inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 font-mono text-[11px] font-semibold text-violet-glow">
                        Total contract price, {fmtCents(s.amountCents)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                        needsYou
                          ? 'border-violet/40 bg-violet/15 text-violet-glow'
                          : done
                            ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                            : 'border-white/10 bg-white/[0.04] text-zinc-400'
                      }`}
                    >
                      {s.status.replaceAll('_', ' ')}
                    </span>
                  </div>
                  {s.dealId && (
                    <Link
                      href={`/deals/${s.dealId}/sign`}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-violet px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-violet/90"
                    >
                      {needsYou ? 'Review & sign' : 'Open agreement'}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {jobContracts.length === 0 && spine.length === 0 && (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <FileCheck2 className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-zinc-400">
            No contracts yet. Contracts appear here once NEXPEC issues one for a job you post.
          </p>
        </div>
      )}

      <p className="text-[11px] text-zinc-600">
        Questions? <Link href="/client/messages" className="underline hover:text-zinc-400">Help &amp; Support</Link>.
      </p>
    </div>
  );
}
