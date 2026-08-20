// ════════════════════════════════════════════════════════════════════════════
//  app/client/contracts/job/[id]/page.tsx — Client signs a job contract
//
//  STRICT BLIND PRICING: this view CANNOT render inspector_payout_cents.
//  The fetcher uses `client_job_contracts_view` which doesn't even expose
//  that column. The Postgres view is the enforcement boundary; the page
//  just reads what's available.
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
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchClientJobContract } from '@/lib/data/jobContracts';
import { clientSignJobContract } from '@/lib/actions/jobContracts';
import { openJobChat } from '@/lib/actions/messages';
import JobChatActions from '@/components/messaging/JobChatActions';

export const metadata: Metadata = { title: 'Sign contract' };
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

export default async function ClientJobContractPage({
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
    redirect(
      '/sign-in?next=' + encodeURIComponent(`/client/contracts/job/${id}`),
    );
  }

  const contract = await fetchClientJobContract(id);
  if (!contract) {
    return (
      <div className="rounded-3xl border border-accent-red/30 bg-accent-red/5 p-8 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-accent-red" strokeWidth={1.5} />
        <h1 className="mt-4 font-display text-xl font-semibold text-white">
          Contract not found
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Either the contract id is wrong, or it&rsquo;s addressed to a
          different account.
        </p>
        <Link
          href="/client/contracts"
          className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
        >
          Back to contracts
        </Link>
      </div>
    );
  }

  const isClientSigned = !!contract.clientSignedAt;
  const isInspectorSigned = !!contract.inspectorSignedAt;
  const isFullyExecuted = contract.status === 'fully_executed';
  const isVoided = contract.status === 'voided';

  return (
    <div className="space-y-6">
      <Link
        href="/client/contracts"
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-violet-glow"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Back to contracts
      </Link>

      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal, Job contract
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {contract.jobTitle ?? 'Inspection contract'}
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Assigned inspector:{' '}
          {contract.inspectorDisplayName ? (
            <span className="font-semibold text-zinc-100">{contract.inspectorDisplayName}</span>
          ) : (
            <span className="font-mono text-zinc-200">{contract.inspectorHandle}</span>
          )}{' '}
          <span className="text-[11px] text-cyan-glow/70">(NEXPEC-Verified)</span>
        </p>
      </header>

      {/* Disclosed inspector identity — fields are resolved (redacted) server-side
          by client_job_contracts_view per the project identity_mode. The page
          renders only what it is given; it never decides disclosure. Email and
          phone arrive non-null ONLY when the Admin set this job to `full`
          (20260801566000); Project Messages remains the standard channel. */}
      {(contract.inspectorDisplayName ||
        contract.inspectorResumeSummary ||
        (contract.inspectorCertifications?.length ?? 0) > 0 ||
        (contract.inspectorQualifications?.length ?? 0) > 0 ||
        contract.inspectorEmail ||
        contract.inspectorPhone) && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6">
          <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} /> Inspector details
          </p>
          {contract.inspectorHeadline && (
            <p className="mt-3 text-sm text-zinc-200">{contract.inspectorHeadline}</p>
          )}
          {contract.inspectorResumeSummary && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{contract.inspectorResumeSummary}</p>
          )}
          {(contract.inspectorQualifications?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {contract.inspectorQualifications!.map((q) => (
                <span key={q} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-300">
                  {q}
                </span>
              ))}
            </div>
          )}
          {(contract.inspectorCertifications?.length ?? 0) > 0 && (
            <p className="mt-3 text-xs text-zinc-400">
              <span className="font-semibold text-zinc-300">Certifications:</span>{' '}
              {contract.inspectorCertifications!.join(', ')}
            </p>
          )}
          {contract.inspectorResumeUrl && (
            <a
              href={contract.inspectorResumeUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-glow hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} /> Résumé
            </a>
          )}
          {(contract.inspectorEmail || contract.inspectorPhone) && (
            <div className="mt-4 border-t border-white/[0.06] pt-3 text-xs text-zinc-300">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
                Direct contact, authorized by Full disclosure for this job
              </p>
              {contract.inspectorEmail && (
                <p>
                  <span className="font-semibold text-zinc-400">Email:</span>{' '}
                  <a
                    href={`mailto:${contract.inspectorEmail}`}
                    className="text-violet-glow hover:underline"
                  >
                    {contract.inspectorEmail}
                  </a>
                </p>
              )}
              {contract.inspectorPhone && (
                <p className="mt-1">
                  <span className="font-semibold text-zinc-400">Phone:</span>{' '}
                  <a
                    href={`tel:${contract.inspectorPhone}`}
                    className="text-violet-glow hover:underline"
                  >
                    {contract.inspectorPhone}
                  </a>
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {sp.signed && (
        <div className="rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4 text-sm text-accent-green">
          ✅ Signed. The inspector has been notified to sign on their side.
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
          <StatusStep
            label="Generated by admin"
            ts={contract.createdAt}
            done
          />
          <StatusStep
            label="You sign"
            ts={contract.clientSignedAt}
            done={isClientSigned}
            active={!isClientSigned && !isVoided}
          />
          <StatusStep
            label="Inspector signs"
            ts={contract.inspectorSignedAt}
            done={isInspectorSigned}
            active={isClientSigned && !isInspectorSigned && !isVoided}
          />
        </div>
        {isFullyExecuted && (
          <div className="mt-4 rounded-xl border border-accent-green/30 bg-accent-green/10 p-3 text-sm text-accent-green">
            ✅ Fully executed. Awaiting initial funding and admin dispatch —
            work has not started yet.
          </div>
        )}
        {isVoided && (
          <div className="mt-4 rounded-xl border border-accent-red/30 bg-accent-red/10 p-3 text-sm text-accent-red">
            ⚠ This contract was voided. Admin will issue a new one.
          </div>
        )}
      </section>

      {/* Pricing — CLIENT VIEW ONLY */}
      <section className="rounded-3xl border border-violet/25 bg-gradient-to-br from-violet/[0.10] to-transparent p-6">
        <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
          <Lock className="h-3 w-3" strokeWidth={2} />
          Total contract price
        </p>
        <p className="mt-2 font-mono text-3xl font-semibold text-violet-glow">
          {fmtCents(contract.clientPriceCents)}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          This is the total amount you pay under this agreement. Funds are
          released according to the agreed funding schedule after the
          required approvals.
        </p>
      </section>


      {/* COMMUNICATION (owner ruling 2026-08-19) — ALWAYS available to the
          client, independent of the identity mode and of whether the section
          above rendered anything:
            protected / professional → NEXPEC admin room only
            full                     → admin room PLUS the two-party direct
                                       room with the inspector
          JobChatActions self-resolves against nx_job_chat_counterparts, so the
          direct-chat control appears exactly when the Admin set this job to
          Full. This page grants nothing on its own. */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6">
        <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} /> Communication
        </p>
        <div className="mt-3">
          <JobChatActions
            jobId={contract.jobId}
            returnTo={`/client/contracts/job/${contract.id}`}
            heading="Direct messaging"
          />
        </div>
        <form action={openJobChat} className="mt-3 text-xs text-zinc-400">
          <input type="hidden" name="jobId" value={contract.jobId} />
          <input type="hidden" name="kind" value="job_client_admin" />
          <input type="hidden" name="returnToBase" value="/client/messages" />
          <p>
            Your NEXPEC admin room is always available for this job — admin
            relays to the inspector and every conversation stays scoped to
            this project.
          </p>
          <button
            type="submit"
            className="mt-2 inline-flex items-center gap-1.5 font-semibold text-violet-glow hover:underline"
          >
            Open NEXPEC admin chat
            <ExternalLink className="h-3 w-3" strokeWidth={2} />
          </button>
        </form>
      </section>

      {/* Custom contract URL (if uploaded by admin) */}
      {contract.customContractUrl && (
        <a
          href={contract.customContractUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2 text-xs font-semibold text-cyan-glow hover:bg-cyan-glow/20"
        >
          Open uploaded contract document
          <ExternalLink className="h-3 w-3" strokeWidth={2} />
        </a>
      )}

      {/* Contract body */}
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

      {/* Sign form */}
      {!isClientSigned && !isVoided && (
        <section className="rounded-3xl border border-violet/30 bg-violet/[0.05] p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Sign &amp; commit funds
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Type your full legal name, confirm the Terms, and the payment-hold
            placeholder fires. Stripe Connect funds capture lands in a
            follow-up sprint.
          </p>
          <form action={clientSignJobContract} className="mt-5 space-y-4">
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
                I agree to this Inspection Services Agreement, the{' '}
                <Link
                  href="/legal/terms"
                  target="_blank"
                  className="text-violet-glow underline hover:text-white"
                >
                  NEXPEC Terms
                </Link>
                , and authorise NEXPEC to place my payment on a payment hold until
                final report sign-off.
              </span>
            </label>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-violet px-6 py-2.5 text-sm font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-violet/90"
            >
              <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
              Sign &amp; commit funds
            </button>
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
              <Clock className="h-3 w-3" strokeWidth={1.75} />
              Your typed name + timestamp + IP + user-agent are recorded as
              an e-signature.
            </p>
          </form>
        </section>
      )}

      {isClientSigned && !isInspectorSigned && !isVoided && (
        <section className="rounded-3xl border border-accent-amber/30 bg-accent-amber/10 p-6">
          <h2 className="inline-flex items-center gap-2 font-display text-base font-semibold text-accent-amber">
            <Clock className="h-4 w-4" strokeWidth={1.75} />
            Waiting on the inspector
          </h2>
          <p className="mt-1 text-sm text-zinc-300">
            You signed on {new Date(contract.clientSignedAt!).toLocaleString()}.
            The inspector has been notified and the job will move to
            in-progress as soon as they counter-sign.
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
            className={
              'h-4 w-4 ' + (active ? 'text-violet-glow' : 'text-zinc-500')
            }
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
