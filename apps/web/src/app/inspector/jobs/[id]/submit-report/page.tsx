// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/jobs/[id]/submit-report/page.tsx — Submit the inspection
//
//  GOLDEN_RULE_6 — Inspector → Admin → Client.
//  The page renders the form only when:
//    • Inspector has an application with status='hired' or 'accepted'.
//    • Job.status is 'assigned' or 'in_progress'.
//    • No existing inspection_reports row for (job, inspector) — if one
//      exists, redirect to the job detail page with a soft notice.
//
//  Form structure:
//    • Result (Pass / Fail / Partial)
//    • Summary textarea (min 50 chars)
//    • Multi-file photo input (image MIME types only, 6 × 5MB cap)
//    • Attestation checkbox + typed inspector name (text-attestation MVP;
//      canvas signature lands in Sprint 6.5)
//
//  No client-side JS — submission goes through the server action which
//  handles photo upload to inspection-photos, JSON-encoded report doc
//  into inspection_reports, and the audit_events signal.
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  CircleDashed,
  Wallet,
  Building2,
  Camera,
  PenLine,
} from 'lucide-react';
import { fetchInspectorJob } from '@/lib/data/inspectorJobDetail';
import { fetchInspectorReport } from '@/lib/data/inspectorReport';
import { submitInspectionReport } from '@/lib/actions/submitReport';

export const metadata: Metadata = {
  title: 'Submit inspection report',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function SubmitReportPage({
  params,
  searchParams,
}: PageProps) {
  const { id: jobId } = await params;
  const qp = await searchParams;
  const job = await fetchInspectorJob(jobId);
  if (!job) notFound();

  // Authorisation: hired only.
  const isHired =
    job.myApplication?.status === 'hired' ||
    job.myApplication?.status === 'accepted';
  if (!isHired) {
    redirect(
      `/inspector/jobs/${jobId}?error=${encodeURIComponent('Only hired inspectors can submit a report.')}`,
    );
  }
  if (job.status !== 'assigned' && job.status !== 'in_progress') {
    redirect(
      `/inspector/jobs/${jobId}?error=${encodeURIComponent('Reports can only be submitted on active jobs.')}`,
    );
  }

  // Already submitted? Redirect with notice — Sprint 6 doesn't support
  // revision yet (Sprint 6.5).
  const existing = await fetchInspectorReport(jobId);
  if (existing) {
    redirect(`/inspector/jobs/${jobId}?already_reported=1`);
  }

  return (
    <div className="space-y-8">
      {/* Heading */}
      <header>
        <Link
          href={`/inspector/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Submit report
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {job.title}
        </h1>
        <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
          Submit your inspection findings + evidence. Our admin team
          reviews every report (technical + financial) before forwarding
          it to the client. The payout releases once both sides sign off.
        </p>
      </header>

      {qp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.error}
        </Banner>
      )}

      {/* Job summary */}
      <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryFact
            icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
            label="Inspector payout"
            value={formatPayout(job.inspectorPayoutCents)}
            tone="violet"
          />
          {job.clientCompanyName && (
            <SummaryFact
              icon={<Building2 className="h-4 w-4" strokeWidth={1.75} />}
              label="Client"
              value={job.clientCompanyName}
            />
          )}
          <SummaryFact
            icon={<CircleDashed className="h-4 w-4" strokeWidth={1.75} />}
            label="Job status"
            value={job.status.replace('_', ' ')}
          />
        </div>
      </section>

      {/* Submission form */}
      <form
        action={submitInspectionReport}
        encType="multipart/form-data"
        className="space-y-8"
      >
        <input type="hidden" name="jobId" value={job.id} />

        {/* Section: Result */}
        <Section
          title="Result"
          subtitle="One-line verdict. Admin uses this for the cover summary."
        >
          <fieldset>
            <legend className="sr-only">Inspection result</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <ResultRadio value="pass" label="Pass" tone="green" />
              <ResultRadio value="partial" label="Partial" tone="amber" />
              <ResultRadio value="fail" label="Fail" tone="red" />
            </div>
          </fieldset>
        </Section>

        {/* Section: Summary */}
        <Section
          title="Findings summary"
          subtitle="Cover what you observed, methods used, acceptance criteria, anything anomalous. Admin reads this first; clarity here shortens the review."
        >
          <textarea
            id="summary"
            name="summary"
            required
            minLength={50}
            maxLength={8000}
            rows={12}
            placeholder={`UT inspection on 18 inch pipeline, segment 4A. Calibrated per ASME B31.3.\n\nFindings:\n  • Three indications above reportable threshold near girth weld 4A-12.\n  • Wall thickness within tolerance across remaining segment.\n\nMethod: dual-element transducer, 5 MHz, couplant per spec.`}
            className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
          />
          <p className="mt-1.5 text-[11px] text-zinc-500">
            Min 50 chars. Plain text. Line breaks preserved. Attach photos
            in the next section.
          </p>
        </Section>

        {/* Section: Evidence */}
        <Section
          title="Evidence photos"
          subtitle="Up to 6 photos. JPEG, PNG, WebP, or HEIC. Max 5 MB each. Stored privately, only admin and the client see them on approval."
        >
          <label
            htmlFor="photos"
            className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02] p-8 transition-colors hover:border-violet/40 hover:bg-white/[0.04]"
          >
            <Camera
              className="h-8 w-8 text-zinc-500 transition-colors group-hover:text-violet-glow"
              strokeWidth={1.5}
            />
            <span className="text-sm font-medium text-zinc-300 group-hover:text-white">
              Click to select up to 6 photos
            </span>
            <span className="text-[11px] text-zinc-500">
              Or drag and drop. We&apos;ll upload them when you submit.
            </span>
            <input
              id="photos"
              name="photos"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
              multiple
              className="sr-only"
            />
          </label>
        </Section>

        {/* Section: Signed documents — link-based (avoids 5MB+ uploads). */}
        <Section
          title="Signed documents (optional)"
          subtitle="Paste a URL to the signed PDFs, scanned forms, or DocuSign envelope so the admin and client can verify the paperwork. Use Google Drive, OneDrive, Dropbox, anywhere with a stable link. Add notes if any sheet is unsigned or missing."
        >
          <div>
            <label
              htmlFor="signedDocsUrl"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Signed-documents URL
            </label>
            <input
              id="signedDocsUrl"
              name="signedDocsUrl"
              type="url"
              inputMode="url"
              maxLength={2048}
              placeholder="https://drive.google.com/drive/folders/…"
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Make sure the link permission is set to &ldquo;anyone with the
              link can view&rdquo;. Otherwise admin can&rsquo;t verify.
            </p>
          </div>
          <div>
            <label
              htmlFor="signedDocsNotes"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Notes on signed / unsigned documents
            </label>
            <textarea
              id="signedDocsNotes"
              name="signedDocsNotes"
              rows={2}
              maxLength={1000}
              placeholder="e.g. Page 4 of the safety checklist was unsigned, client signed everything else."
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
          </div>
        </Section>

        {/* Section: Attestation */}
        <Section
          title="Attestation"
          subtitle="Your typed name + the box below carry the same weight as a wet signature for the purposes of this submission. Canvas signature lands in a follow-up."
        >
          <div>
            <label
              htmlFor="attestInspectorName"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Your full name
              <span className="ml-1 text-violet-glow">*</span>
            </label>
            <input
              id="attestInspectorName"
              name="attestInspectorName"
              type="text"
              required
              minLength={2}
              maxLength={80}
              placeholder="Alex Doe"
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
          </div>
          <label className="group mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm leading-relaxed text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] has-[:checked]:border-violet/40 has-[:checked]:bg-violet/10 has-[:checked]:text-white">
            <input
              type="checkbox"
              name="attestation"
              value="on"
              required
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40 focus:ring-offset-0"
            />
            <span>
              I attest the information above is accurate and complete to
              the best of my professional judgment. I understand this
              submission becomes part of the audit trail and is reviewed
              by NEXPEC operations before reaching the client.
            </span>
          </label>
        </Section>

        {/* Submit row */}
        <div className="flex flex-col items-stretch gap-3 border-t border-white/[0.06] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">
            On submit, our admin team reviews the report. The payout
            releases once both sides sign off.
          </p>
          <div className="flex gap-2 sm:flex-row-reverse">
            <button
              type="submit"
              className="btn-primary inline-flex items-center justify-center gap-2"
            >
              <PenLine className="h-4 w-4" strokeWidth={2} />
              Submit for review
            </button>
            <Link
              href={`/inspector/jobs/${jobId}`}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:text-white"
            >
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ─── form primitives ────────────────────────────────────────────────── */

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
      <header className="mb-6">
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          {title}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ResultRadio({
  value,
  label,
  tone,
}: {
  value: 'pass' | 'partial' | 'fail';
  label: string;
  tone: 'green' | 'amber' | 'red';
}) {
  const icon =
    tone === 'green' ? (
      <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
    ) : tone === 'amber' ? (
      <CircleDashed className="h-5 w-5" strokeWidth={1.75} />
    ) : (
      <XCircle className="h-5 w-5" strokeWidth={1.75} />
    );
  const checked =
    tone === 'green'
      ? 'has-[:checked]:border-accent-green/50 has-[:checked]:bg-accent-green/10 has-[:checked]:text-accent-green'
      : tone === 'amber'
        ? 'has-[:checked]:border-accent-amber/50 has-[:checked]:bg-accent-amber/10 has-[:checked]:text-accent-amber'
        : 'has-[:checked]:border-accent-red/50 has-[:checked]:bg-accent-red/10 has-[:checked]:text-accent-red';
  return (
    <label
      className={`group flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:text-white ${checked}`}
    >
      <input
        type="radio"
        name="result"
        value={value}
        required
        className="sr-only"
      />
      {icon}
      <span>{label}</span>
    </label>
  );
}

function SummaryFact({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'violet';
}) {
  const valueColor = tone === 'violet' ? 'text-violet-glow' : 'text-white';
  return (
    <div>
      <div className="flex items-center gap-2 text-zinc-500">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-industrial">
          {label}
        </p>
      </div>
      <p
        className={`mt-1 font-mono text-base font-semibold tracking-tight ${valueColor}`}
      >
        {value}
      </p>
    </div>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'red' | 'cyan';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const classes =
    tone === 'red'
      ? 'border-accent-red/30 bg-accent-red/10 text-accent-red'
      : 'border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow';
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${classes}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-sm">{children}</p>
    </div>
  );
}

function formatPayout(cents: number | null): string {
  if (cents === null || cents === undefined || cents === 0)
    return 'Pending admin price';
  const dollars = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(dollars);
}
