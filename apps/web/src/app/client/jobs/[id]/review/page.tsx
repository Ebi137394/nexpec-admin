// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/review/page.tsx — Client leaves a review for the inspector
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, AlertCircle, CheckCircle2 } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ReviewForm } from '@/components/reviews/ReviewForm';
import { canReviewJob } from '@/lib/data/reviews';

export const metadata: Metadata = { title: 'Leave a review' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; reviewed?: string }>;
}

export default async function ClientReviewPage({ params, searchParams }: PageProps) {
  const { id: jobId } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/client/jobs/${jobId}/review`));

  // Fetch the job + inspector label
  const { data: job } = await supabase
    .from('jobs')
    .select('id, title, status, contractor_id, client_id, inspector:profiles!jobs_contractor_id_fkey(full_name, email)')
    .eq('id', jobId)
    .eq('client_id', user.id)
    .maybeSingle();

  if (!job) redirect('/client/jobs');

  const j = job as unknown as Record<string, unknown>;
  const assignedInspectorId = (j.contractor_id as string | null) ?? null;
  const status = (j.status as string | null) ?? '';
  const inspectorLabel =
    ((j.inspector as { full_name?: string | null; email?: string | null } | null) ?? null)
      ?.full_name ?? null;

  const eligible =
    status === 'completed' && !!assignedInspectorId
      ? await canReviewJob(jobId, 'client_to_inspector')
      : false;

  const returnTo = `/client/jobs/${jobId}/review`;

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/client/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal, Review
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Rate the inspector
        </h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          {(j.title as string | null) ?? 'This inspection'}, published on the
          inspector&apos;s public profile.
        </p>
      </header>

      {sp.error && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-red" />
          <p className="text-sm text-accent-red">{sp.error}</p>
        </div>
      )}

      {sp.reviewed && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-green" />
          <p className="text-sm text-accent-green">
            Thanks, your review is live on the inspector&apos;s profile.
          </p>
        </div>
      )}

      {!eligible ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
          <p className="text-sm text-zinc-400">
            {status !== 'completed'
              ? 'This job needs to be completed before you can leave a review.'
              : 'You\'ve already reviewed this inspector for this job, or you\'re not the eligible party.'}
          </p>
          <Link
            href={`/client/jobs/${jobId}`}
            className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-200 hover:border-violet/40 hover:text-white"
          >
            Return to job
          </Link>
        </div>
      ) : (
        <ReviewForm
          jobId={jobId}
          revieweeId={assignedInspectorId!}
          direction="client_to_inspector"
          returnTo={returnTo}
          counterpartyLabel={inspectorLabel}
        />
      )}
    </div>
  );
}
