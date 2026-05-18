// ════════════════════════════════════════════════════════════════════════════
//  app/client/disputes/page.tsx — list + file a dispute (client side)
//
//  Filing one calls the file_dispute() RPC which atomically pauses escrow
//  AND notifies every admin. The form gates on a job UUID the caller owns;
//  the RPC + RLS enforce it independently.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Send,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchMyDisputes } from '@/lib/data/disputes';
import { fileDispute } from '@/lib/actions/disputeFile';
import {
  DISPUTE_CATEGORIES,
  DISPUTE_CATEGORY_LABELS,
  DISPUTE_STATUS_LABELS,
} from '@/lib/data/disputes.types';

export const metadata: Metadata = { title: 'Disputes' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{ error?: string; filed?: string; jobId?: string }>;
}

export default async function ClientDisputesPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent('/client/disputes'));

  const disputes = await fetchMyDisputes();
  const returnTo = '/client/disputes';

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal · Disputes
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Disputes
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          File a dispute on any of your jobs. Filing pauses escrow release on
          that job until admin reviews. Admin will reach out via Help &
          Support chat to gather more detail.
        </p>
      </header>

      {sp.error && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-red" />
          <p className="text-sm text-accent-red">{sp.error}</p>
        </div>
      )}
      {sp.filed && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-green" />
          <p className="text-sm text-accent-green">
            Dispute filed. Escrow on that job is now paused. Admin has been
            notified and will follow up shortly.
          </p>
        </div>
      )}

      {/* List */}
      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Your disputes ({disputes.length})
        </h2>
        {disputes.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
            <AlertTriangle className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-zinc-300">No disputes filed.</p>
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {disputes.map((d) => (
              <li
                key={d.id}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-white">
                    {d.jobTitle ?? d.jobId.slice(0, 8)}
                  </p>
                  <StatusChip status={d.status} />
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {DISPUTE_CATEGORY_LABELS[d.category]} · filed {new Date(d.createdAt).toLocaleDateString()}
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-400">{d.body}</p>
                {d.resolution && (
                  <div className="mt-4 rounded-xl border border-cyan-glow/30 bg-cyan-glow/10 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
                      Admin resolution
                    </p>
                    <p className="mt-1 text-xs text-zinc-200">{d.resolution}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* File-new form */}
      <details className="group rounded-3xl border border-accent-red/30 bg-accent-red/[0.06] p-6 sm:p-8 open:bg-accent-red/[0.08]">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-industrial text-accent-red">
          <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />
          File a new dispute
        </summary>
        <form action={fileDispute} className="mt-5 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Job UUID <span className="ml-1 text-accent-red">*</span>
            </span>
            <input
              name="jobId"
              required
              defaultValue={sp.jobId ?? ''}
              maxLength={36}
              placeholder="Paste the job UUID from /client/jobs"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 font-mono text-xs text-white outline-none focus:border-accent-red/40"
            />
            <span className="text-[11px] text-zinc-500">
              You must be the client on the job. Admin will verify.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Category <span className="ml-1 text-accent-red">*</span>
            </span>
            <select
              name="category"
              required
              defaultValue="quality"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-accent-red/40"
            >
              {DISPUTE_CATEGORIES.map((c) => (
                <option key={c} value={c} className="bg-ink-900">
                  {DISPUTE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              What happened? <span className="ml-1 text-accent-red">*</span>
            </span>
            <textarea
              name="body"
              required
              rows={6}
              minLength={20}
              maxLength={8000}
              placeholder="Walk through the issue. Include dates, deliverables, and what outcome you want."
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-accent-red/40"
            />
            <span className="text-[11px] text-zinc-500">20–8000 characters.</span>
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-accent-red px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-accent-red/90"
            >
              <Send className="h-3 w-3" strokeWidth={1.75} />
              File dispute · pauses escrow
            </button>
            <p className="mt-2 text-[11px] text-zinc-500">
              Filing immediately pauses escrow release on this job and pings
              every admin. Help & Support follow-up may take ~1 business day.
            </p>
          </div>
        </form>
      </details>

      <p className="text-[11px] text-zinc-600">
        <Link href="/client/messages" className="underline hover:text-zinc-400">
          Use Help &amp; Support
        </Link>{' '}
        if you want to discuss before filing formally.
      </p>
    </div>
  );
}

function StatusChip({ status }: { status: keyof typeof DISPUTE_STATUS_LABELS }) {
  const cls =
    status === 'open' || status === 'investigating'
      ? 'border-accent-amber/30 bg-accent-amber/10 text-accent-amber'
      : status === 'resolved' || status === 'closed'
        ? 'border-accent-green/30 bg-accent-green/10 text-accent-green'
        : 'border-accent-red/30 bg-accent-red/10 text-accent-red';
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${cls}`}
    >
      {DISPUTE_STATUS_LABELS[status]}
    </span>
  );
}
