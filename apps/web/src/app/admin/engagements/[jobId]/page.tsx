// ════════════════════════════════════════════════════════════════════════════
//  /admin/engagements/[jobId] — the Admin commercial panel for one engagement.
//
//  Three amounts are agreed SEPARATELY and none of them is derived from
//  another:
//      customer_amount_cents     what the originating customer pays NEXPEC
//      inspector_payout_cents    what the named inspector receives
//      partner_commission_cents  Agency B's OWN commission, not a gross figure
//
//  This is the ONLY surface that sees all three. Each party reads a view that
//  contains exactly its own column, so nothing here can leak by being
//  forgotten in a template.
// ════════════════════════════════════════════════════════════════════════════
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { EngagementPanel } from '@/components/admin/engagements/EngagementPanel';

export const dynamic = 'force-dynamic';

export default async function AdminEngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams?: Promise<{ error?: string; saved?: string }>;
}) {
  const { jobId } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/admin/engagements/${jobId}`)}`);

  const { data: isAdmin } = await supabase.rpc('nx_is_admin');
  if (!isAdmin) redirect('/');

  const [{ data: job }, { data: policy }, { data: versions }, { data: opportunities }, { data: nominations }, { data: partners }] =
    await Promise.all([
      supabase
        .from('jobs')
        .select('id, title, status, client_id, agency_id, currency')
        .eq('id', jobId)
        .maybeSingle(),
      supabase.from('job_partner_policy').select('*').eq('job_id', jobId).maybeSingle(),
      supabase
        .from('engagement_commercials')
        .select('*')
        .eq('job_id', jobId)
        .order('version', { ascending: false }),
      supabase
        .from('partner_opportunities')
        .select('id, partner_id, status, invited_at')
        .eq('job_id', jobId),
      supabase
        .from('partner_nominations')
        .select('id, partner_id, inspector_id, status, proposed_note, created_at')
        .eq('job_id', jobId),
      supabase
        .from('partner_agencies')
        .select('partner_id, display_name, status')
        .eq('status', 'approved'),
    ]);

  if (!job) {
    return (
      <div className="rounded-3xl border border-dashed border-white/[0.08] p-12 text-center">
        <p className="text-sm text-zinc-300">Job not found.</p>
      </div>
    );
  }

  const live = (versions ?? []).find((v) => v.status === 'accepted')
    ?? (versions ?? []).find((v) => v.status === 'presented')
    ?? (versions ?? []).find((v) => v.status === 'draft')
    ?? null;

  const { data: acceptances } = live
    ? await supabase
        .from('engagement_acceptances')
        .select('party_role, party_id, accepted_at, terms_version')
        .eq('commercial_id', live.id)
    : { data: [] as unknown[] };

  const { data: obligations } = await supabase
    .from('settlement_obligations')
    .select('*')
    .eq('job_id', jobId);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/admin/jobs/${jobId}`}
          className="text-xs text-zinc-400 hover:text-white"
        >
          ← Back to job
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-white">
          Engagement commercials
        </h1>
        <p className="mt-1 text-sm text-zinc-400">{job.title ?? '(untitled job)'}</p>
      </div>

      {sp.error && (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {sp.error}
        </p>
      )}
      {sp.saved && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {sp.saved}
        </p>
      )}

      <EngagementPanel
        jobId={jobId}
        job={job as never}
        policy={(policy ?? null) as never}
        versions={(versions ?? []) as never}
        live={(live ?? null) as never}
        acceptances={(acceptances ?? []) as never}
        obligations={(obligations ?? []) as never}
        opportunities={(opportunities ?? []) as never}
        nominations={(nominations ?? []) as never}
        approvedPartners={(partners ?? []) as never}
      />
    </div>
  );
}
