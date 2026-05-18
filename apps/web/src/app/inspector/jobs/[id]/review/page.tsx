// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/jobs/[id]/review/page.tsx — Inspector leaves a review for the client
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

export default async function InspectorReviewPage({ params, searchParams }: PageProps) {
  const { id: jobId } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/inspector/jobs/${jobId}/review`));

  const { data: job } = await supabase
    .from('jobs')
    .select('id, title, status, client_id, assigned_inspector_id, client:profiles!jobs_client_id_fkey(full_name, email, company_name)')
    .eq('id', jobId)
    .eq('assigned_inspector_id', user.id)
    .maybeSingle();

  if (!job) redirect('/inspector/assignments');

  const j = job as unknown as Record<string, unknown>;
  const clientId = (j.client_id as string | null) ?? null;
  const status = (j.status as string | null) ?? '';
  const clientJoin = (j.client ?? null) as
    | { full_name?: string | null; email?: string | null; company_name?: string | null }
    | null;
  const clientLabel =
    clientJoin?.company_name ?? clientJoin?.full_name ?? clientJoin?.email ?? null;

  const eligible =
    status === 'completed' && !!clientId
      ? await canReviewJob(jobId, 'inspector_to_client')
      : false;

  const returnTo = `/inspector/jobs/${jobId}/review`;

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/inspector/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Inspector Portal · Review
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Rate the client
        </h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          {(j.title as string | null) ?? 'This engagement'} · published on the
          client&apos;s public profile.
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
            Thanks — your review is live on the client&apos;s profile.
          </p>
        </div>
      )}

      {!eligible ? (
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
          <p className="text-sm text-zinc-400">
            {status !== 'completed'
              ? 'This job needs to be completed before you can leave a review.'
              : 'You\'ve already reviewed this client for this job, or you\'re not the eligible party.'}
          </p>
        </div>
      ) : (
        <ReviewForm
          jobId={jobId}
          revieweeId={clientId!}
          direction="inspector_to_client"
          returnTo={returnTo}
          counterpartyLabel={clientLabel}
        />
      )}
    </div>
  );
}
