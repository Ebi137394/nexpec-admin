// ════════════════════════════════════════════════════════════════════════════
//  app/suppliers/contracts/[id]/page.tsx — view + e-sign a Supplier Agreement.
//
//  Two-party brokered agreement (Supplier ↔ NEXPEC). The supplier signs first;
//  NEXPEC counter-signs to execute and seal it (content_sha256). The awarded
//  value shown is the supplier's OWN quote — price-blindness preserved.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  FileCheck2,
  Lock,
  Fingerprint,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchSupplierContractById } from '@/lib/data/supplierContracts';
import { supplierSignContract } from '@/lib/actions/supplierContracts';
import JobChatActions from '@/components/messaging/JobChatActions';

export const metadata: Metadata = { title: 'Sign agreement' };
export const dynamic = 'force-dynamic';

function fmtCents(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number(v) / 100);
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; signed?: string }>;
}

export default async function SupplierContractPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(`/suppliers/contracts/${id}`));
  }

  const contract = await fetchSupplierContractById(id);
  if (!contract) {
    return (
      <div className="rounded-3xl border border-accent-red/30 bg-accent-red/5 p-8 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-accent-red" strokeWidth={1.5} />
        <h1 className="mt-4 font-display text-xl font-semibold text-white">
          Agreement not found
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Either the id is wrong, or it&rsquo;s addressed to a different account.
        </p>
        <Link
          href="/suppliers/contracts"
          className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
        >
          Back to agreements
        </Link>
      </div>
    );
  }

  const isSupplierSigned = !!contract.supplierSignedAt;
  const isAdminSigned = !!contract.adminSignedAt;
  const isExecuted = contract.status === 'executed';
  const isVoided = contract.status === 'voided';
  const canSign =
    contract.status === 'pending_supplier_signature' && !isVoided;

  return (
    <div className="space-y-6">
      <Link
        href="/suppliers/contracts"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-violet-glow"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Back to agreements
      </Link>

      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Supplier Portal, NEXPEC Agreement
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {contract.rfqTitle ?? 'Supplier agreement'}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Counterparty:{' '}
          <span className="text-zinc-200">NEXPEC (Broker of record)</span>
        </p>

        {/* ★ Supplier-side entry points (20260801340000/342000). Rendered from
            nx_job_chat_counterparts when this contract names a job, so the
            supplier reaches the assigned inspector for site coordination and
            the buyer for commercial matters. Both are relationship-gated —
            neither depends on the buyer's identity_mode. */}
        {contract.jobId && (
          <div className="mt-5">
            <JobChatActions
              jobId={contract.jobId}
              returnTo={`/suppliers/contracts/${contract.id}`}
              heading="Messaging"
            />
          </div>
        )}
      </header>

      {sp.signed && (
        <div className="rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4 text-sm text-accent-green">
          ✅ Signed. NEXPEC has been notified to counter-sign and execute.
        </div>
      )}
      {sp.error && (
        <div className="rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4 text-sm text-accent-red">
          {decodeURIComponent(sp.error)}
        </div>
      )}

      {/* Status timeline */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatusStep label="Issued by NEXPEC" ts={contract.createdAt} done />
          <StatusStep
            label="You sign"
            ts={contract.supplierSignedAt}
            done={isSupplierSigned}
            active={canSign}
          />
          <StatusStep
            label="NEXPEC executes"
            ts={contract.adminSignedAt}
            done={isAdminSigned}
            active={isSupplierSigned && !isAdminSigned && !isVoided}
          />
        </div>
        {isExecuted && (
          <div className="mt-4 rounded-xl border border-accent-green/30 bg-accent-green/10 p-3 text-sm text-accent-green">
            ✅ Fully executed. Brokered milestone payouts can now be released to
            your wallet.
          </div>
        )}
        {isVoided && (
          <div className="mt-4 rounded-xl border border-accent-red/30 bg-accent-red/10 p-3 text-sm text-accent-red">
            ⚠ This agreement was voided. NEXPEC will issue a new one.
          </div>
        )}
      </section>

      {/* Awarded value — supplier's OWN number */}
      <section className="rounded-3xl border border-violet/25 bg-gradient-to-br from-violet/[0.10] to-transparent p-6">
        <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
          <Lock className="h-3 w-3" strokeWidth={2} />
          Awarded value, your payout
        </p>
        <p className="mt-2 font-mono text-3xl font-semibold text-violet-glow">
          {fmtCents(contract.amountCents)}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Administered by NEXPEC and released to your connected payout account
          against verified milestones. This is your awarded quote value.
        </p>
      </section>

      {/* Custom contract URL (if uploaded by admin) */}
      {contract.customContractUrl && (
        <a
          href={contract.customContractUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2 text-xs font-semibold text-cyan-glow hover:bg-cyan-glow/20"
        >
          Open uploaded agreement document
          <ExternalLink className="h-3 w-3" strokeWidth={2} />
        </a>
      )}

      {/* Agreement body */}
      {contract.contractTextMd && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          <header className="mb-4 flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Agreement
            </h2>
          </header>
          <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-zinc-300">
            {contract.contractTextMd}
          </pre>
        </section>
      )}

      {/* Execution seal */}
      {isExecuted && contract.contentSha256 && (
        <section className="rounded-3xl border border-accent-green/25 bg-accent-green/[0.05] p-6">
          <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold text-accent-green">
            <Fingerprint className="h-4 w-4" strokeWidth={1.75} />
            Tamper-evident execution seal
          </h2>
          <p className="mt-1 text-sm text-zinc-300">
            Signed by{' '}
            <span className="text-white">{contract.supplierSignedName}</span> and
            counter-signed by NEXPEC
            {contract.adminSignedName ? ` (${contract.adminSignedName})` : ''}.
          </p>
          <p className="mt-3 break-all rounded-xl border border-white/[0.06] bg-ink-950 p-3 font-mono text-[11px] text-accent-green/90">
            sha256:{contract.contentSha256}
          </p>
        </section>
      )}

      {/* Sign form */}
      {canSign && (
        <section className="rounded-3xl border border-violet/30 bg-violet/[0.05] p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Sign agreement
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Type your full legal name and confirm. NEXPEC counter-signs to
            execute. Funds release only after execution.
          </p>
          <form action={supplierSignContract} className="mt-5 space-y-4">
            <input type="hidden" name="contractId" value={contract.id} />
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
                Full legal name
              </span>
              <input
                type="text"
                name="typedName"
                required
                minLength={2}
                maxLength={160}
                placeholder="Alex Q. Public"
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.06] focus:outline-none focus:ring-2 focus:ring-violet/30"
              />
            </label>
            <label className="group flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-violet/40 has-[:checked]:border-violet/40 has-[:checked]:bg-violet/10">
              <input
                type="checkbox"
                name="termsAccepted"
                value="on"
                required
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40 focus:ring-offset-0"
              />
              <span className="flex-1 text-sm text-zinc-300">
                I accept this NEXPEC Supplier Agreement and the{' '}
                <Link
                  href="/legal/terms"
                  target="_blank"
                  className="text-violet-glow underline hover:text-white"
                >
                  NEXPEC Terms
                </Link>
                , and agree that brokered settlement is administered by NEXPEC.
              </span>
            </label>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-violet px-6 py-2.5 text-sm font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-violet/90"
            >
              <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
              Sign agreement
            </button>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              Your typed name + timestamp + IP + user-agent are recorded as an
              e-signature.
            </p>
          </form>
        </section>
      )}

      {isSupplierSigned && !isAdminSigned && !isVoided && (
        <section className="rounded-3xl border border-accent-amber/30 bg-accent-amber/10 p-6">
          <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold text-accent-amber">
            <Clock className="h-4 w-4" strokeWidth={1.75} />
            Waiting on NEXPEC
          </h2>
          <p className="mt-1 text-sm text-zinc-300">
            You signed on{' '}
            {new Date(contract.supplierSignedAt!).toLocaleString()}. NEXPEC has
            been notified and will counter-sign to execute the agreement.
          </p>
        </section>
      )}
    </div>
  );
}

function StatusStep({
  label,
  ts,
  done,
  active,
}: {
  label: string;
  ts: string | null;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div
      className={
        'rounded-2xl border p-4 ' +
        (done
          ? 'border-accent-green/30 bg-accent-green/5'
          : active
            ? 'border-violet/40 bg-violet/10'
            : 'border-white/[0.06] bg-white/[0.01]')
      }
    >
      <div className="flex items-center gap-2">
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-accent-green" strokeWidth={2} />
        ) : (
          <Clock
            className={'h-4 w-4 ' + (active ? 'text-violet-glow' : 'text-zinc-500')}
            strokeWidth={1.75}
          />
        )}
        <p
          className={
            'text-[10px] font-semibold uppercase tracking-industrial ' +
            (done
              ? 'text-accent-green'
              : active
                ? 'text-violet-glow'
                : 'text-zinc-500')
          }
        >
          {label}
        </p>
      </div>
      <p
        className={
          'mt-1.5 text-xs ' + (ts ? 'font-mono text-zinc-300' : 'text-zinc-600')
        }
      >
        {ts ? new Date(ts).toLocaleString() : 'Pending'}
      </p>
    </div>
  );
}
