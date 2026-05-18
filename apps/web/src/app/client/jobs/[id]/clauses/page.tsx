// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/clauses/page.tsx — Client manages job-specific clauses
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  Scale,
  Trash2,
  PlusCircle,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchJobClauses } from '@/lib/data/jobClauses';
import {
  CLAUSE_KINDS,
  CLAUSE_KIND_LABELS,
} from '@/lib/data/jobClauses.types';
import { createJobClause, deleteJobClause } from '@/lib/actions/jobClauses';

export const metadata: Metadata = { title: 'Job clauses' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; saved?: string; deleted?: string }>;
}

export default async function ClientJobClausesPage({ params, searchParams }: PageProps) {
  const { id: jobId } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/client/jobs/${jobId}/clauses`));

  // Verify caller owns the job (RLS would also block, but earlier surfacing).
  const { data: job } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('id', jobId)
    .eq('client_id', user.id)
    .maybeSingle();
  if (!job) redirect('/client/jobs');

  const clauses = await fetchJobClauses(jobId);
  const returnTo = `/client/jobs/${jobId}/clauses`;

  return (
    <div className="space-y-8">
      <header>
        <Link
          href={`/client/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal · Legal clauses
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Job-specific clauses
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          {((job as { title?: string }).title) ?? 'This job'} · Inspectors must accept
          every <span className="text-violet-glow">required</span> clause before they
          can apply. Non-required clauses are advisory.
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
          Clause saved.
        </Banner>
      )}
      {sp.deleted && (
        <Banner tone="ok">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Clause deleted.
        </Banner>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Clauses on this job ({clauses.length})
        </h2>
        {clauses.length === 0 ? (
          <div className="mt-5 rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
            <Scale className="mx-auto h-8 w-8 text-zinc-600" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-zinc-300">No clauses defined.</p>
            <p className="mt-1 text-xs text-zinc-500">
              Add NDAs, exclusivity, safety, or compliance terms below. Inspectors
              will see these and must accept the required ones to apply.
            </p>
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {clauses.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-white">{c.title}</p>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                      {CLAUSE_KIND_LABELS[c.kind]}
                    </span>
                    {c.isRequired ? (
                      <span className="rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow">
                        Required
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                        Advisory
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-400">{c.body}</p>
                <form action={deleteJobClause} className="mt-4">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                    Delete clause
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="group rounded-3xl border border-violet/30 bg-violet/[0.04] p-6 sm:p-8 open:bg-violet/[0.06]">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-industrial text-violet-glow">
          <PlusCircle className="h-4 w-4" strokeWidth={1.75} />
          Add a clause
        </summary>
        <form action={createJobClause} className="mt-5 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="returnTo" value={returnTo} />

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Kind <span className="ml-1 text-violet-glow">*</span>
            </span>
            <select
              name="kind"
              defaultValue="nda"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
            >
              {CLAUSE_KINDS.map((k) => (
                <option key={k} value={k} className="bg-ink-900">
                  {CLAUSE_KIND_LABELS[k]}
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
              maxLength={160}
              placeholder="Mutual confidentiality"
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
            />
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
              Body <span className="ml-1 text-violet-glow">*</span>
            </span>
            <textarea
              name="body"
              required
              rows={6}
              minLength={1}
              maxLength={20000}
              placeholder="Full text of the clause. Plain text; line breaks preserved."
              className="rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
            />
            <span className="text-[11px] text-zinc-500">Max 20,000 characters.</span>
          </label>

          <label className="flex items-start gap-2 sm:col-span-2">
            <input
              type="checkbox"
              name="isRequired"
              value="on"
              defaultChecked
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40"
            />
            <span className="text-sm text-zinc-300">
              <span className="font-semibold text-white">Required.</span>{' '}
              Inspectors must accept this clause before applying. Uncheck for
              advisory clauses that don&apos;t block the application.
            </span>
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-violet/90"
            >
              <PlusCircle className="h-3 w-3" strokeWidth={1.75} />
              Save clause
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
