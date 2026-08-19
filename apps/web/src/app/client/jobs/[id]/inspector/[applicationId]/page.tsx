// ════════════════════════════════════════════════════════════════════════════
//  /client/jobs/[id]/inspector/[applicationId] — JOB-SCOPED inspector detail
//
//  THE authorized client surface for applicant identity. The public
//  /p/[userId] Trust Card is anonymized BY CONSTRUCTION and must stay that
//  way; this page exists so the Full/Professional disclosure the Admin
//  granted on a specific job is actually reachable from that job's
//  Applications list without losing the job context (owner-review finding:
//  the applications card used to route to /p/…, which rendered the protected
//  experience even on a Full-mode job).
//
//  POLICY LIVES IN THE DATABASE. Every field below comes from
//  job_applicant_identity_view, which resolves nx_job_effective_identity_mode
//  (job-scoped, admin-set, audited) and RLS-gates rows to the owning client
//  (forwarded proposals + the engaged record). This component renders what it
//  is given and adds no disclosure of its own:
//      protected     → NX handle + reputation only (every identity field NULL)
//      professional  → + name, photo, headline, résumé/CV, certifications
//      full          → + email, phone (mailto/tel actions) — Admin-authorized
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  ArrowLeft,
  ShieldCheck,
  Star,
  BadgeCheck,
  FileText,
  Mail,
  Phone,
  MessageSquare,
  ExternalLink,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { inspectorHandle } from '@/lib/identity/inspectorHandle';

export const metadata: Metadata = { title: 'Inspector details' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string; applicationId: string }>;
}

interface DisclosureRow {
  application_id: string;
  job_id: string;
  applicant_id: string;
  application_status: string;
  identity_mode: 'protected' | 'professional' | 'full';
  inspector_display_name: string | null;
  inspector_headline: string | null;
  inspector_resume_summary: string | null;
  inspector_resume_url: string | null;
  inspector_cv_url: string | null;
  inspector_certifications: string[] | null;
  inspector_qualifications: string[] | null;
  inspector_avatar_url: string | null;
  inspector_email: string | null;
  inspector_phone: string | null;
  rating_average: number | null;
  reviews_count: number | null;
  completed_jobs_count: number | null;
  experience_years: number | null;
  professional_title: string | null;
  ndt_methods: string[] | null;
  location_city: string | null;
  location_province: string | null;
}

export default async function JobScopedInspectorPage({ params }: PageProps) {
  const { id: jobId, applicationId } = await params;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      '/sign-in?next=' +
        encodeURIComponent(`/client/jobs/${jobId}/inspector/${applicationId}`),
    );
  }

  const { data, error } = await supabase
    .from('job_applicant_identity_view')
    .select(
      'application_id, job_id, applicant_id, application_status, identity_mode, ' +
        'inspector_display_name, inspector_headline, inspector_resume_summary, ' +
        'inspector_resume_url, inspector_cv_url, inspector_certifications, ' +
        'inspector_qualifications, inspector_avatar_url, inspector_email, ' +
        'inspector_phone, rating_average, reviews_count, completed_jobs_count, ' +
        'experience_years, professional_title, ndt_methods, location_city, location_province',
    )
    .eq('application_id', applicationId)
    .eq('job_id', jobId)
    .maybeSingle();

  if (error || !data) notFound();
  const d = data as unknown as DisclosureRow;

  const handle = inspectorHandle(d.applicant_id);
  const disclosed = d.identity_mode !== 'protected';
  const isFull = d.identity_mode === 'full';
  const name = d.inspector_display_name?.trim() || null;

  return (
    <div className="space-y-6">
      <Link
        href={`/client/jobs/${jobId}/applications`}
        className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Back to applications
      </Link>

      {/* Identity header — per-mode */}
      <header className="rounded-3xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-6 sm:p-8">
        <div className="flex flex-wrap items-start gap-4">
          {disclosed && d.inspector_avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-content avatar from storage; next/image cannot optimize signed/dynamic URLs
            <img
              src={d.inspector_avatar_url}
              alt={name ?? handle}
              className="h-16 w-16 shrink-0 rounded-2xl border border-white/10 object-cover"
            />
          ) : (
            <span className="inline-flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet to-cyan-glow text-white">
              <ShieldCheck className="h-7 w-7" strokeWidth={1.5} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {disclosed && name ? name : 'NEXPEC-Verified Inspector'}
            </h1>
            <p className="mt-1 font-mono text-xs text-violet-glow">{handle}</p>
            {disclosed && d.inspector_headline && (
              <p className="mt-1 text-sm text-zinc-300">{d.inspector_headline}</p>
            )}
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
              <BadgeCheck className="h-3 w-3 text-cyan-glow" strokeWidth={2} />
              Disclosure, {d.identity_mode} · set by NEXPEC admin for this job
            </p>
          </div>
        </div>
        {!disclosed && (
          <p className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm leading-relaxed text-zinc-400">
            Identity is protected by NEXPEC on this job. You&rsquo;re seeing
            platform-verified capability and performance — no résumé, no bias.
            Ask your admin to raise the disclosure policy if you need the
            professional profile.
          </p>
        )}
      </header>

      {/* Reputation — every mode */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Rating" value={d.rating_average != null ? Number(d.rating_average).toFixed(1) : '—'} sub={`${d.reviews_count ?? 0} reviews`} />
        <Tile label="Jobs done" value={String(d.completed_jobs_count ?? 0)} sub="via NEXPEC" />
        <Tile label="Experience" value={d.experience_years != null ? `${d.experience_years}y` : '—'} sub={d.professional_title ?? 'Inspector'} />
        <Tile label="Location" value={d.location_city ?? '—'} sub={d.location_province ?? ''} />
      </section>

      {/* Professional profile — professional | full */}
      {disclosed && (
        <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Professional profile
          </h2>
          {d.inspector_resume_summary && (
            <p className="mt-3 text-sm leading-relaxed text-zinc-300">
              {d.inspector_resume_summary}
            </p>
          )}
          {(d.inspector_certifications?.length ?? 0) > 0 && (
            <p className="mt-4 text-xs text-zinc-400">
              <span className="font-semibold text-zinc-300">Certifications:</span>{' '}
              {d.inspector_certifications!.join(', ')}
            </p>
          )}
          {(d.inspector_qualifications?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d.inspector_qualifications!.map((q) => (
                <span
                  key={q}
                  className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-300"
                >
                  {q}
                </span>
              ))}
            </div>
          )}
          {(d.inspector_resume_url || d.inspector_cv_url) && (
            <div className="mt-4 flex flex-wrap gap-3">
              {d.inspector_resume_url && (
                <a
                  href={d.inspector_resume_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-glow hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" strokeWidth={2} /> Résumé
                  <ExternalLink className="h-3 w-3" strokeWidth={2} />
                </a>
              )}
              {d.inspector_cv_url && (
                <a
                  href={d.inspector_cv_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-glow hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" strokeWidth={2} /> CV
                  <ExternalLink className="h-3 w-3" strokeWidth={2} />
                </a>
              )}
            </div>
          )}
        </section>
      )}

      {/* Direct contact — FULL only (values arrive non-null only when the
          Admin set this job to `full`; the view is the authority) */}
      {isFull && (d.inspector_email || d.inspector_phone) && (
        <section className="rounded-3xl border border-accent-green/25 bg-accent-green/[0.05] p-6 sm:p-8">
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
            Direct contact, authorized by Full disclosure for this job
          </p>
          <div className="mt-3 space-y-2 text-sm text-zinc-200">
            {d.inspector_email && (
              <p className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-accent-green" strokeWidth={2} />
                <a href={`mailto:${d.inspector_email}`} className="text-violet-glow hover:underline">
                  {d.inspector_email}
                </a>
              </p>
            )}
            {d.inspector_phone && (
              <p className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-accent-green" strokeWidth={2} />
                <a href={`tel:${d.inspector_phone}`} className="text-violet-glow hover:underline">
                  {d.inspector_phone}
                </a>
              </p>
            )}
          </div>
        </section>
      )}

      {/* Project Messages — the monitored standard channel, every mode */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-400">
            Project Messages is the job&rsquo;s monitored communication room and
            the standard channel for this engagement.
          </p>
          <Link
            href={`/client/jobs/${jobId}/chat`}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:text-white"
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2} />
            Open Project Messages
          </Link>
        </div>
      </section>

      {(d.ndt_methods?.length ?? 0) > 0 && (
        <p className="text-xs text-zinc-500">
          <span className="font-semibold text-zinc-400">NDT methods:</span>{' '}
          {d.ndt_methods!.join(', ')}
        </p>
      )}

      <p className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600">
        <Star className="h-3 w-3" strokeWidth={2} />
        Application status: {d.application_status.replace(/_/g, ' ')}
      </p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-semibold text-white">{value}</p>
      {sub ? <p className="mt-0.5 truncate text-[11px] text-zinc-500">{sub}</p> : null}
    </div>
  );
}
