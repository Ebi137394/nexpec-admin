// ════════════════════════════════════════════════════════════════════════════
//  app/admin/jobs/[id]/page.tsx — admin job detail + Brokered War Room
//
//  The admin is the broker: as meeting organizer they auto-satisfy the
//  schedule_meeting() golden-rule guard, so this is the surface where a
//  client + inspector (+ vendor) war room can actually be convened.
// ════════════════════════════════════════════════════════════════════════════
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { MeetingsPanel } from '@/components/marketplace/MeetingsPanel';
import { InspectionMarketplaceAdminPanel } from '@/components/admin/InspectionMarketplaceAdminPanel';

export const metadata: Metadata = { title: 'Job detail' };
export const dynamic = 'force-dynamic';

export default async function AdminJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: job } = await supabase
    .from('jobs')
    .select('id, title, status, client_id, contractor_id, scheduled_date, description, location, job_country, source_rfq_id, identity_mode, replacement_mode, client_price_cents')
    .eq('id', id)
    .maybeSingle();

  if (!job) notFound();

  const parties = ([
    job.client_id ? { id: job.client_id as string, label: 'Client', role: 'client' } : null,
    job.contractor_id ? { id: job.contractor_id as string, label: 'Inspector', role: 'inspector' } : null,
  ].filter(Boolean)) as { id: string; label: string; role: string }[];

  // Inspection Marketplace controls (Workflow A only — never for RFQ/brokered jobs).
  const isInspectionJob = !job.source_rfq_id;
  let activeContract: { id: string; status: string; clientApprovalType: string } | null = null;
  let applications: { id: string; applicantLabel: string; status: string }[] = [];
  if (isInspectionJob) {
    const { data: ac } = await supabase
      .from('job_contracts')
      .select('id, status, client_approval_type, inspector_id')
      .eq('job_id', id)
      .neq('status', 'voided')
      .maybeSingle();
    if (ac) {
      activeContract = {
        id: String(ac.id),
        status: String(ac.status),
        clientApprovalType: String(ac.client_approval_type ?? 'client_signature'),
      };
    }
    const { data: apps } = await supabase
      .from('applications')
      .select('id, applicant_id, status')
      .eq('job_id', id)
      .not('status', 'in', '("rejected","withdrawn")');
    const rows = (apps ?? []) as Array<Record<string, unknown>>;
    const currentInspectorId = (activeContract && (job.contractor_id as string | null)) || null;
    const applicantIds = Array.from(new Set(rows.map((r) => String(r.applicant_id))));
    const nameMap = new Map<string, string | null>();
    if (applicantIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', applicantIds);
      for (const p of (profs ?? []) as Array<Record<string, unknown>>) {
        nameMap.set(String(p.id), (p.full_name as string | null) ?? null);
      }
    }
    applications = rows
      .filter((r) => String(r.applicant_id) !== currentInspectorId)
      .map((r) => ({
        id: String(r.id),
        applicantLabel: nameMap.get(String(r.applicant_id)) ?? `Applicant ${String(r.applicant_id).slice(0, 8)}`,
        status: String(r.status),
      }));
  }

  return (
    <div className="space-y-6">
      <Link href="/admin/jobs" className="inline-flex items-center gap-1.5 text-sm text-white/60 transition-colors hover:text-white">
        <ArrowLeft size={15} /> All jobs
      </Link>

      <header>
        <p className="text-[10px] font-extrabold uppercase tracking-industrial text-violet-glow">Job</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-white">{job.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-ink-600 px-2.5 py-1 font-semibold capitalize text-white/70">{String(job.status).replace(/_/g, ' ')}</span>
          {job.scheduled_date && (
            <span className="rounded-full border border-ink-600 px-2.5 py-1 text-white/60">Scheduled {new Date(job.scheduled_date as string).toLocaleDateString()}</span>
          )}
          {job.job_country && <span className="rounded-full border border-ink-600 px-2.5 py-1 text-white/60">{job.job_country}</span>}
          {job.source_rfq_id && (
            <Link href={`/rfqs/${job.source_rfq_id}`} className="rounded-full border border-violet/60 px-2.5 py-1 font-semibold text-violet-glow hover:bg-violet/10">From RFQ →</Link>
          )}
        </div>
      </header>

      {job.description && <p className="max-w-2xl text-sm leading-relaxed text-zinc-400">{job.description}</p>}

      {isInspectionJob && (
        <InspectionMarketplaceAdminPanel
          jobId={String(job.id)}
          jobStatus={String(job.status)}
          identityMode={(job.identity_mode as 'protected' | 'professional' | 'full') ?? 'protected'}
          replacementMode={(job.replacement_mode as 'client_reapproval' | 'admin_authorized') ?? 'client_reapproval'}
          clientPriceCents={Number(job.client_price_cents ?? 0)}
          activeContract={activeContract}
          applications={applications}
        />
      )}

      {/* Brokered War Room — convene the cross-party call (admin = host) */}
      <MeetingsPanel jobId={String(job.id)} parties={parties} />
    </div>
  );
}
