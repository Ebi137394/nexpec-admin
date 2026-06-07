// ════════════════════════════════════════════════════════════════════════════
//  app/admin/jobs/[id]/flash-reports/new/page.tsx — Admin raises a Flash Report
//
//  Closes the last mobile↔web parity gap: on mobile an admin can raise an NCR
//  from the shared flash-reports route; this is the web equivalent. Uses the
//  shared FlashReportRaiseForm (portal=admin) so it's identical to the inspector
//  raise. The /admin route group already gates to admins; we also confirm the
//  role here and the flash_report_create RPC authorises as super_admin.
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft, Siren } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { FlashReportRaiseForm } from '@/components/flash-reports/FlashReportRaiseForm';

export const metadata: Metadata = {
  title: 'Raise a flash report',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function AdminNewFlashReportPage({
  params,
  searchParams,
}: PageProps) {
  const { id: jobId } = await params;
  const qp = await searchParams;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      '/sign-in?next=' +
        encodeURIComponent(`/admin/jobs/${jobId}/flash-reports/new`),
    );
  }

  // Belt-and-suspenders role guard (the /admin layout also gates). admin ==
  // super_admin per the Singular Platform Owner doctrine.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const role = ((profile as { role?: string } | null)?.role ?? '').toString();
  if (role !== 'admin' && role !== 'super_admin') {
    redirect('/admin/jobs');
  }

  // Admin can read any job (RLS). Just need the title for context.
  const { data: job } = await supabase
    .from('jobs')
    .select('id, title')
    .eq('id', jobId)
    .maybeSingle();
  if (!job) notFound();

  const backHref = `/admin/jobs?inspect=${encodeURIComponent(jobId)}#moderation`;

  return (
    <div className="space-y-8">
      <header>
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job moderation
        </Link>
        <p className="mt-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          <Siren className="h-3.5 w-3.5" strokeWidth={2} />
          Flash report, NCR
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Raise a flash report
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Log a non-conformance or concern on{' '}
          <span className="text-zinc-300">
            {String((job as { title?: string }).title ?? 'this job')}
          </span>{' '}
          on behalf of the platform. It enters the same workflow as an
          inspector-raised report and is tracked from the job moderation panel.
        </p>
      </header>

      <FlashReportRaiseForm
        jobId={String((job as { id: string }).id)}
        portal="admin"
        backHref={backHref}
        error={qp.error}
      />
    </div>
  );
}
