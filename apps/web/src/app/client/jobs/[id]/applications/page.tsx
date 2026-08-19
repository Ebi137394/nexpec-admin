// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/[id]/applications/page.tsx — Application review surface
//
//  Card-grid of every application for the job. Each card shows inspector
//  identity, rating, bid, and cover note, with two server-action buttons:
//
//    Select  → status='CLIENT_SELECTED' (admin /admin/dispatch picks up
//              from there)
//    Reject  → status='rejected'
//
//  Banners surface the outcome of the most recent action via search params
//  (?selected=..., ?rejected=..., ?error=...).
// ════════════════════════════════════════════════════════════════════════════

import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Star,
  Briefcase,
  CalendarClock,
  Users,
  ExternalLink,
  MessageSquareQuote,
  ShieldCheck,
} from 'lucide-react';
import {
  fetchClientJob,
  fetchJobApplications,
} from '@/lib/data/jobApplications';
import { fetchClientInspectorDisclosureForJob } from '@/lib/data/jobContracts';
import { inspectorHandle } from '@/lib/identity/inspectorHandle';
import type {
  ApplicationStatus,
  JobApplicationRow,
} from '@/lib/data/jobApplications.types';
import {
  selectApplication,
  rejectApplication,
} from '@/lib/actions/applications';
import { openJobChat } from '@/lib/actions/messages';

export const metadata: Metadata = {
  title: 'Applications',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    selected?: string;
    rejected?: string;
    error?: string;
  }>;
}

export default async function ClientJobApplicationsPage({
  params,
  searchParams,
}: PageProps) {
  const { id: jobId } = await params;
  const qp = await searchParams;
  const job = await fetchClientJob(jobId);
  if (!job) notFound();

  const applications = await fetchJobApplications(jobId);

  // Routing + policy decision ONLY (contract id + mode, never an identity
  // value). Null unless a live non-voided contract exists for this job AND its
  // identity policy is professional/full.
  const inspectorDisclosure = await fetchClientInspectorDisclosureForJob(jobId);

  // Bucket by status for readable layout: client-selected first, then
  // pending, then closed-out (rejected / withdrawn / accepted).
  const grouped = bucket(applications);

  return (
    <div className="space-y-8">
      {/* Heading */}
      <header>
        <Link
          href={`/client/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
              Applications
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {job.title}
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
              {applications.length} application
              {applications.length === 1 ? '' : 's'}. Selecting an
              inspector routes the application into admin dispatch, they
              confirm credentials and finalise the hire.
            </p>
          </div>
        </div>
      </header>

      {/* Contract banner — shown once a fully executed contract exists whose
          policy is professional/full. Card identity itself is mode-governed
          (owner policy): under `protected` every card stays pseudonymous;
          under `professional`/`full` the DB releases name/photo and each card
          links to the job-scoped inspector detail page. */}
      {inspectorDisclosure && (
        <div className="flex flex-col gap-3 rounded-2xl border border-accent-green/25 bg-accent-green/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-accent-green"
              strokeWidth={1.75}
            />
            <div>
              <p className="text-sm font-semibold text-white">
                This job has a fully executed contract
              </p>
              <p className="mt-1 max-w-xl text-pretty text-sm text-zinc-400">
                Your hired inspector&rsquo;s{' '}
                {inspectorDisclosure.identityMode === 'full'
                  ? 'professional details and direct contact information are'
                  : 'professional details are'}{' '}
                available on the contract for this job; Project Messages
                remains the monitored standard channel.
              </p>
            </div>
          </div>
          <Link
            href={`/client/contracts/job/${inspectorDisclosure.contractId}`}
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-accent-green/30 bg-accent-green/10 px-5 py-2.5 text-sm font-medium text-accent-green transition-colors hover:border-accent-green/50 hover:bg-accent-green/15 sm:self-auto"
          >
            View inspector details
            <ExternalLink className="h-4 w-4" strokeWidth={2} />
          </Link>
        </div>
      )}

      {/* Action banners */}
      {qp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.error}
        </Banner>
      )}
      {qp.selected && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Inspector selected. The application is queued for admin dispatch.
        </Banner>
      )}
      {qp.rejected && (
        <Banner tone="zinc" icon={<XCircle className="h-5 w-5" />}>
          Application rejected. The inspector is notified automatically.
        </Banner>
      )}

      {/* Empty state */}
      {applications.length === 0 && (
        <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-ink-800/60 to-ink-900/40 px-6 py-16 text-center">
          <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
            <Users className="h-5 w-5" strokeWidth={1.75} />
          </div>
          {/*  This list shows only applications NEXPEC has vetted and released
              (applications.forwarded_to_client_at). Unreleased applications are
              correctly hidden by RLS, so "no applications" would be false — the
              copy must describe the review stage without revealing whether any
              hidden applicants exist, which would leak a count the buyer is not
              entitled to. */}
          <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-white">
            No vetted applications available yet.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-pretty text-sm text-zinc-400">
            NEXPEC reviews every applicant — credentials, specialty fit,
            experience and availability — before sharing a candidate with you.
            You&apos;ll be notified as soon as a vetted candidate is ready.
          </p>
        </section>
      )}

      {/* Grouped lists */}
      {grouped.hired.length > 0 && (
        <Group
          title="Hired inspector"
          subtitle="The engagement record for this job. It stays here permanently — through the inspection and after completion."
        >
          {grouped.hired.map((app) => (
            <Card key={app.id} app={app} jobId={jobId} />
          ))}
          {inspectorDisclosure && (
            <Link
              href={`/client/contracts/job/${inspectorDisclosure.contractId}`}
              className="inline-flex items-center gap-2 rounded-full border border-accent-green/30 bg-accent-green/10 px-4 py-2 text-xs font-semibold text-accent-green transition-colors hover:bg-accent-green/15"
            >
              <ShieldCheck className="h-3.5 w-3.5" strokeWidth={2} />
              View inspector details &amp; contract
            </Link>
          )}
        </Group>
      )}
      {grouped.selected.length > 0 && (
        <Group
          title="Your pick, pending admin dispatch"
          subtitle="Already routed to admin. They confirm the inspector's credentials and finalise."
        >
          {grouped.selected.map((app) => (
            <Card key={app.id} app={app} jobId={jobId} />
          ))}
        </Group>
      )}
      {grouped.pending.length > 0 && (
        <Group
          title={`Pending review, ${grouped.pending.length}`}
          subtitle="Open applications awaiting your decision."
        >
          {grouped.pending.map((app) => (
            <Card key={app.id} app={app} jobId={jobId} />
          ))}
        </Group>
      )}
      {grouped.closed.length > 0 && (
        <Group
          title={`Closed, ${grouped.closed.length}`}
          subtitle="Rejected or withdrawn."
          collapsible
        >
          {grouped.closed.map((app) => (
            <Card key={app.id} app={app} jobId={jobId} />
          ))}
        </Group>
      )}
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

function Group({
  title,
  subtitle,
  collapsible = false,
  children,
}: {
  title: string;
  subtitle?: string;
  collapsible?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-sm text-zinc-500">
            {subtitle}
            {collapsible && ' (Always visible, collapse arrives later.)'}
          </p>
        )}
      </header>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function Card({
  app,
  jobId,
}: {
  app: JobApplicationRow;
  jobId: string;
}) {
  const insp = app.inspector;
  // IDENTITY IS MODE-GOVERNED (owner policy, 20260801566000). fullName /
  // avatarUrl arrive from job_applicant_identity_view: NULL under `protected`
  // (the card stays pseudonymous), populated under `professional`/`full`. The
  // card renders what the DB released — it decides nothing itself. The NX
  // handle remains visible as the stable platform identity in every mode.
  const handle = inspectorHandle(app.applicantId);
  const disclosedName = insp?.fullName?.trim() || null;
  // An application is ACTIONABLE only while it is genuinely awaiting the
  // client's decision — 'pending', or 'CLIENT_SELECTED' (already picked, so
  // only Reject remains). Everything else is history.
  //
  // This was previously an explicit closed-list of rejected/withdrawn/accepted,
  // which omitted 'hired'. bucket() below files 'hired' under "Closed", so the
  // card sat in the Closed group yet still rendered Accept/Reject — and
  // rejecting it rewrote a completed hire to 'rejected', misrepresenting the
  // hiring history of a job whose contract had merely been voided. Inverting to
  // an allow-list keeps the two in agreement and makes any future status
  // non-actionable by default rather than actionable by default.
  const isSelected = app.status === 'CLIENT_SELECTED';
  const isClosed = app.status !== 'pending' && !isSelected;

  return (
    <article className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5">
      <header className="flex items-start gap-3">
        {/* JOB-SCOPED detail route — NOT the public /p/[userId] Trust Card.
            /p/ is anonymized by construction and must stay that way; this
            link carries the job context so the disclosure the Admin granted
            on THIS job (professional/full) actually renders. */}
        <Link
          href={`/client/jobs/${jobId}/inspector/${app.id}`}
          aria-label={`View ${disclosedName ?? handle}'s details for this job`}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet to-cyan-glow text-white transition-transform hover:scale-105"
        >
          {insp?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user-content avatar; next/image cannot optimize dynamic storage URLs
            <img src={insp.avatarUrl} alt="" className="h-10 w-10 object-cover" />
          ) : (
            <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            href={`/client/jobs/${jobId}/inspector/${app.id}`}
            className="group/name inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:text-violet-glow"
          >
            <span className={`truncate ${disclosedName ? '' : 'font-mono'}`}>
              {disclosedName ?? handle}
            </span>
            <ExternalLink
              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-100"
              strokeWidth={2}
            />
          </Link>
          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow/70">
            {disclosedName ? (
              <span className="font-mono">{handle} · NEXPEC-Verified</span>
            ) : (
              'NEXPEC-Verified inspector'
            )}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
            {insp?.ratingAverage !== null && insp?.ratingAverage !== undefined && (
              <span className="inline-flex items-center gap-1">
                <Star
                  className="h-3 w-3 text-accent-amber"
                  strokeWidth={2}
                  fill="currentColor"
                />
                {insp.ratingAverage.toFixed(1)}
              </span>
            )}
            {(insp?.completedJobsCount ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="h-3 w-3" strokeWidth={1.75} />
                {insp?.completedJobsCount} completed
              </span>
            )}
            {insp?.yearsOfExperience && (
              <span className="inline-flex items-center gap-1">
                <CalendarClock className="h-3 w-3" strokeWidth={1.75} />
                {insp.yearsOfExperience} yrs
              </span>
            )}
          </div>
        </div>
        <StatusChip status={app.status} />
      </header>

      {/* GOLDEN_RULE_2, bid_amount_cents intentionally hidden from
          client view. The inspector's bid is admin-only data. The client
          evaluates the inspector on profile signal (rating, experience,
          completed jobs) not on price. */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-y border-white/[0.04] py-3">
        <ProfileSignal
          label="Rating"
          value={
            insp?.ratingAverage !== null && insp?.ratingAverage !== undefined
              ? insp.ratingAverage.toFixed(1)
              : '—'
          }
        />
        <ProfileSignal
          label="Completed"
          value={String(insp?.completedJobsCount ?? 0)}
        />
        <ProfileSignal
          label="Experience"
          value={insp?.yearsOfExperience ? `${insp.yearsOfExperience}y` : '—'}
        />
      </div>

      {app.coverNote && (
        <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
            <MessageSquareQuote className="h-3 w-3" strokeWidth={1.75} />
            Inspector&rsquo;s Cover Note
          </p>
          <p className="mt-2 whitespace-pre-line text-pretty text-sm leading-relaxed text-zinc-200">
            {app.coverNote}
          </p>
        </div>
      )}

      {/* Quick-ask CTA — opens the job-scoped Client↔Admin chat. */}
      <form
        action={openJobChat}
        className="mt-4 rounded-xl border border-violet/25 bg-violet/[0.04] p-3"
      >
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="kind" value="job_client_admin" />
        <input type="hidden" name="returnToBase" value="/client/messages" />
        <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
          Need more info on this inspector?
        </p>
        <p className="mt-1 text-xs text-zinc-300">
          Open the admin chat for this job. Ask for additional docs, CV
          details, or a reference check. Admin relays, all conversations
          stay scoped to this project.
        </p>
        <button
          type="submit"
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-[11px] font-semibold text-violet-glow hover:bg-violet/20"
        >
          Ask admin about this inspector →
        </button>
      </form>

      {/* Action row — hidden once the application is closed-out. */}
      {!isClosed && (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {!isSelected && (
            <form action={selectApplication} className="contents">
              <input type="hidden" name="applicationId" value={app.id} />
              <input type="hidden" name="jobId" value={jobId} />
              <button
                type="submit"
                className="btn-primary inline-flex flex-1 items-center justify-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                Accept inspector
              </button>
            </form>
          )}
          <form action={rejectApplication} className="contents">
            <input type="hidden" name="applicationId" value={app.id} />
            <input type="hidden" name="jobId" value={jobId} />
            <button
              type="submit"
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
            >
              <XCircle className="h-4 w-4" strokeWidth={2} />
              Reject
            </button>
          </form>
        </div>
      )}

      <p className="mt-4 font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        Applied {formatRelative(app.createdAt)}
      </p>
    </article>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'cyan' | 'red' | 'zinc';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const classes = {
    cyan: 'border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow',
    red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
    zinc: 'border-white/[0.08] bg-white/[0.03] text-zinc-300',
  }[tone];
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${classes}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function StatusChip({ status }: { status: ApplicationStatus }) {
  const tone =
    status === 'CLIENT_SELECTED'
      ? 'cyan'
      : status === 'accepted' || status === 'hired'
        ? 'green'
        : status === 'rejected'
          ? 'red'
          : status === 'withdrawn'
            ? 'zinc'
            : 'violet';
  const label =
    status === 'CLIENT_SELECTED' ? 'your pick' : status.replace('_', ' ');
  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
        {
          cyan: 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow',
          green: 'border-accent-green/40 bg-accent-green/10 text-accent-green',
          red: 'border-accent-red/40 bg-accent-red/10 text-accent-red',
          zinc: 'border-white/[0.08] bg-white/[0.04] text-zinc-400',
          violet: 'border-violet/40 bg-violet/10 text-violet-glow',
        }[tone]
      }`}
    >
      {label}
    </span>
  );
}

/* ─── helpers ────────────────────────────────────────────────────────── */

function bucket(apps: JobApplicationRow[]) {
  const hired: JobApplicationRow[] = [];
  const selected: JobApplicationRow[] = [];
  const pending: JobApplicationRow[] = [];
  const closed: JobApplicationRow[] = [];
  for (const a of apps) {
    // The engagement record — permanent job history, shown first and kept
    // after completion (RLS 20260801562000 keeps it readable for life).
    if (a.status === 'hired' || a.status === 'accepted') hired.push(a);
    else if (a.status === 'CLIENT_SELECTED') selected.push(a);
    else if (a.status === 'rejected' || a.status === 'withdrawn') closed.push(a);
    else pending.push(a);
  }
  return { hired, selected, pending, closed };
}

function ProfileSignal({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-white">
        {value}
      </p>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
