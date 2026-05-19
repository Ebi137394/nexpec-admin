// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/negotiations/page.tsx — Counter-offer inbox
//
//  Lists every application where admin has either sent a counter you
//  haven't responded to yet, or that's already been resolved. Pure server
//  component + plain forms posting to negotiation server actions.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeftRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchMyCounterOffers } from '@/lib/data/inspectorCounters';
import { inspectorRespondToCounter } from '@/lib/actions/negotiation';

export const metadata: Metadata = { title: 'Counter offers' };
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
  searchParams?: Promise<{ ok?: string; error?: string }>;
}

export default async function InspectorNegotiationsPage({
  searchParams,
}: PageProps) {
  const sp = (await searchParams) ?? {};
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/inspector/negotiations');

  const counters = await fetchMyCounterOffers();
  const pending = counters.filter((c) => c.negotiationStatus === 'admin_countered');
  const settled = counters.filter((c) => c.negotiationStatus !== 'admin_countered');
  const returnTo = '/inspector/negotiations';

  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/inspector/dashboard"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-violet-glow"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Back to dashboard
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Inspector Portal · Negotiations
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Counter offers
        </h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          When the admin proposes a different price than your bid, you can
          accept or decline here. The job only moves forward when you say so.
        </p>
      </header>

      {sp.ok === 'accepted' && (
        <div className="flex items-start gap-2 rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4 text-sm text-accent-green">
          <CheckCircle2 className="mt-0.5 h-4 w-4" />
          You accepted the counter. Admin can now forward you to the client.
        </div>
      )}
      {sp.ok === 'rejected' && (
        <div className="flex items-start gap-2 rounded-2xl border border-accent-amber/30 bg-accent-amber/10 p-4 text-sm text-accent-amber">
          <XCircle className="mt-0.5 h-4 w-4" />
          You rejected the counter. Admin has been notified.
        </div>
      )}
      {sp.error && (
        <div className="flex items-start gap-2 rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4 text-sm text-accent-red">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          {decodeURIComponent(sp.error)}
        </div>
      )}

      {/* PENDING — need your decision */}
      {pending.length > 0 ? (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-white">
            Waiting on you ({pending.length})
          </h2>
          <ul className="space-y-3">
            {pending.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-accent-amber/30 bg-gradient-to-br from-accent-amber/[0.08] to-transparent p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-amber/20 text-accent-amber ring-1 ring-inset ring-accent-amber/40">
                    <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">
                      {c.jobTitle ?? 'A job'}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                          Your bid
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-zinc-200">
                          {fmtCents(c.originalBidCents)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-accent-amber/30 bg-accent-amber/[0.08] px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-industrial text-accent-amber">
                          Admin counter
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-semibold text-accent-amber">
                          {fmtCents(c.adminCounterCents)}
                        </p>
                      </div>
                    </div>
                    {c.adminComment && (
                      <div className="mt-3 rounded-lg border border-white/[0.04] bg-ink-950/40 p-3 text-xs text-zinc-300">
                        <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                          Admin says
                        </span>
                        <p className="mt-1 italic">“{c.adminComment}”</p>
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <form action={inspectorRespondToCounter}>
                        <input type="hidden" name="applicationId" value={c.id} />
                        <input type="hidden" name="decision" value="accepted" />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input
                          type="text"
                          name="note"
                          maxLength={500}
                          placeholder="Optional note for admin"
                          className="mb-2 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
                        />
                        <button
                          type="submit"
                          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent-green px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-white hover:bg-accent-green/90"
                        >
                          <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
                          Accept counter
                        </button>
                      </form>
                      <form action={inspectorRespondToCounter}>
                        <input type="hidden" name="applicationId" value={c.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input
                          type="text"
                          name="note"
                          maxLength={500}
                          placeholder="Why are you declining?"
                          className="mb-2 w-full rounded-md border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white placeholder:text-zinc-600"
                        />
                        <button
                          type="submit"
                          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-accent-red/40 bg-accent-red/15 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-accent-red hover:bg-accent-red/25"
                        >
                          <XCircle className="h-3 w-3" strokeWidth={2} />
                          Decline counter
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <ArrowLeftRight
            className="mx-auto h-8 w-8 text-zinc-600"
            strokeWidth={1.5}
          />
          <p className="mt-3 text-sm text-zinc-400">No pending counters.</p>
          <p className="mt-1 text-[11px] text-zinc-600">
            When admin proposes a different payout on one of your applications,
            it lands here.
          </p>
        </section>
      )}

      {/* SETTLED — historical */}
      {settled.length > 0 && (
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
            Resolved ({settled.length})
          </h2>
          <ul className="space-y-2">
            {settled.map((c) => (
              <li
                key={c.id}
                className={`rounded-2xl border bg-white/[0.01] p-4 text-xs ${
                  c.negotiationStatus === 'counter_accepted'
                    ? 'border-accent-green/30'
                    : 'border-white/[0.06]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-zinc-200">
                    {c.jobTitle ?? 'A job'}
                  </p>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
                      c.negotiationStatus === 'counter_accepted'
                        ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
                        : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-400'
                    }`}
                  >
                    {c.inspectorDecision ?? c.negotiationStatus}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[11px] text-zinc-500">
                  Your bid {fmtCents(c.originalBidCents)} → admin counter{' '}
                  {fmtCents(c.adminCounterCents)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
