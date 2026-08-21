// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/funding/page.tsx — Client staged-funding surface (20/80)
//
//  Server shell. Its whole job is to prove the caller owns this job and to hand
//  down the handful of BUYER-SIDE scalars the funding contract needs as inputs;
//  the schedule itself is read through the sanctioned audience-scoped accessor
//  in JobFundingClient.
//
//  ── GOLDEN_RULE_2 / ABSOLUTE PRIVACY ───────────────────────────────────────
//  The select below is an EXPLICIT column list, never select('*'), and every
//  column on it is the buyer's own commercial fact. No inspector payout column,
//  no platform spread, nothing that would let a raw row carry the other side of
//  the trade into a client component. jobs_secure_view additionally NULLs every
//  seller-payout column for non-admins (20260801318000), so even a widened
//  projection could not leak a payout here — but we do not rely on that alone.
//
//  ── WHY THE OWNERSHIP CHECK IS client_id, NOT client_id OR agency_id ───────
//  RLS policy job_funding_stages_client_read (20260801448000 §7) matches only
//  `j.client_id = auth.uid()`. An agency buyer therefore reads ZERO stage rows —
//  and zero rows is exactly what the legacy tolerance in
//  isInitialFundingSatisfied() interprets as "pre-spine job". Rendering that
//  path for an agency buyer would state a funding position we cannot actually
//  see. So we resolve the job for either buyer column (jobs_owner_xor means an
//  agency job has a NULL client_id) but pass `scheduleReadable` down, and the
//  client component refuses to interpret rather than guess.
// ════════════════════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { JobFundingClient, BackToJob } from './JobFundingClient';
import { onlinePaymentsEnabled } from '@/lib/payments/onlinePayments';
import type { FundingJobFacts } from './fundingView';

export const metadata: Metadata = {
  title: 'Job funding',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/** Cents arrive as number or bigint-string on the wire. Never parsed as float. */
function parseCents(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

async function loadJobFacts(jobId: string): Promise<FundingJobFacts | null> {
  if (!jobId) return null;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('jobs_secure_view')
    .select(
      [
        'id',
        'title',
        'status',
        // Buyer pricing. Revoked on the base table for `authenticated`
        // (20260801312000); the row-gated buyer view returns it to the owner.
        'client_price_cents',
        // Legacy binary funding flag — REQUIRED by both gate predicates.
        'client_settled_at',
        'admin_confirmed_at',
        'payment_mode',
        'client_id',
      ].join(', '),
    )
    .eq('id', jobId)
    .or(`client_id.eq.${user.id},agency_id.eq.${user.id}`)
    .is('deleted_at', null)
    .maybeSingle();

  if (error || !data) {
    if (error && typeof console !== 'undefined') {
      console.warn('[client/funding] job lookup failed:', error.message);
    }
    return null;
  }

  const j = data as unknown as Record<string, unknown>;

  return {
    jobId: String(j.id),
    title: String(j.title ?? '(untitled job)'),
    status: String(j.status ?? ''),
    clientPriceCents: parseCents(j.client_price_cents),
    legacyClientSettledAt:
      typeof j.client_settled_at === 'string' ? j.client_settled_at : null,
    adminConfirmedAt:
      typeof j.admin_confirmed_at === 'string' ? j.admin_confirmed_at : null,
    paymentMode: String(j.payment_mode ?? 'prepay'),
    scheduleReadable: j.client_id === user.id,
  };
}

export default async function ClientJobFundingPage({ params }: PageProps) {
  const { id: jobId } = await params;
  const job = await loadJobFacts(jobId);
  if (!job) notFound();

  return (
    <div className="space-y-8">
      <header>
        <BackToJob jobId={job.jobId} />
        <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal, Job Funding
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {job.title}
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Your engagement is funded in stages. The first tranche authorises
          NEXPEC to dispatch an inspector; the remaining tranche is due after the
          report clears review and releases the final signed delivery. Each is
          paid separately, and neither pays the inspector directly.
        </p>
      </header>

      {/* Online card payment is flag-gated. While it is off NEXPEC settles
          manually, so the funding CTAs are not rendered at all — a button whose
          only outcome is ONLINE_PAYMENTS_DISABLED is a dead end. */}
      <JobFundingClient job={job} onlinePayments={await onlinePaymentsEnabled()} />
    </div>
  );
}
