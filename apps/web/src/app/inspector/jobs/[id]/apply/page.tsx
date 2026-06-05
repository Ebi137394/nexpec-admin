// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/jobs/[id]/apply/page.tsx — Submit an application
//
//  Server-action form. Inspector writes a cover note (min 50 chars) and
//  optionally proposes a bid. The action INSERTs into applications with
//  applicant_id = auth.uid() and status='pending'. DB triggers handle
//  audit, count increment, and rate limiting.
//
//  GOLDEN_RULE_2 — The job summary shown here references inspector_payout
//  (admin-set), never client budget. The bid field is optional and only
//  captures the inspector's counterproposal — never visible to the client
//  per Rule #2.
// ════════════════════════════════════════════════════════════════════════════

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Wallet,
  MapPin,
} from 'lucide-react';
import { fetchInspectorJob } from '@/lib/data/inspectorJobDetail';
import { submitApplication } from '@/lib/actions/inspectorApply';

export const metadata: Metadata = {
  title: 'Apply to job',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}

export default async function InspectorApplyPage({
  params,
  searchParams,
}: PageProps) {
  const { id: jobId } = await params;
  const qp = await searchParams;
  const job = await fetchInspectorJob(jobId);
  if (!job) notFound();

  // If the inspector has already applied OR the job isn't accepting
  // applications, bounce back to the detail page where the right state
  // surface is rendered.
  if (job.myApplication) {
    redirect(`/inspector/jobs/${jobId}?already=1`);
  }
  if (!job.isOpenForApplications) {
    redirect(
      `/inspector/jobs/${jobId}?error=${encodeURIComponent('Job is no longer accepting applications.')}`,
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <Link
          href={`/inspector/jobs/${jobId}`}
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to job
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Apply to job
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          {job.title}
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Make your case for this inspection. The client reviews vetted
          profiles like yours and recommends a candidate; admin finalises.
        </p>
      </header>

      {qp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.error}
        </Banner>
      )}

      {/* Job summary — payout-only, no client number */}
      <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/70 to-ink-900/40 p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryFact
            icon={<Wallet className="h-4 w-4" strokeWidth={1.75} />}
            label="Inspector payout"
            value={formatPayout(job.inspectorPayoutCents)}
            tone="violet"
          />
          <SummaryFact
            icon={<MapPin className="h-4 w-4" strokeWidth={1.75} />}
            label="Location"
            value={job.locationCity ?? job.locationLabel ?? '—'}
          />
          <SummaryFact
            icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />}
            label="Specialty fit"
            value={
              job.specialtySlugs.length === 0
                ? 'Any'
                : `${job.specialtySlugs.length} tag${job.specialtySlugs.length === 1 ? '' : 's'}`
            }
          />
        </div>
      </section>

      {/* Application form */}
      <form action={submitApplication} className="space-y-6">
        <input type="hidden" name="jobId" value={job.id} />

        <Section
          title="Cover note"
          subtitle="What makes you a strong fit. Certifications, similar past jobs, scheduling, equipment. Admin sees this, then routes to the client."
        >
          <Textarea
            name="coverNote"
            required
            minLength={50}
            maxLength={4000}
            rows={10}
            placeholder="I've completed 14 UT inspections on 18-inch crude pipeline segments this year. ASNT Level II certified, available the week of the scheduled date, own all required Olympus equipment."
            hint="Min 50 chars. Inspectors with detailed cover notes get accepted at ~3x the rate of one-liners."
          />
        </Section>

        <Section
          title="Counter-bid (optional)"
          subtitle="Leave blank to accept the admin-set payout shown above. Set a number only if you'd want to renegotiate, admin reviews every bid."
        >
          <Field
            name="bidDollars"
            type="number"
            min={50}
            max={1_000_000}
            placeholder="(optional) e.g. 2750"
            hint="Whole USD. Not shown to the client."
          />
        </Section>

        <div className="flex flex-col items-stretch gap-3 border-t border-white/[0.06] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">
            By submitting you agree to NEXPEC&apos;s contractor terms.
            Admin reviews every application.
          </p>
          <div className="flex gap-2 sm:flex-row-reverse">
            <button
              type="submit"
              className="btn-primary inline-flex items-center justify-center gap-2"
            >
              Submit application
              <span aria-hidden>→</span>
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

/* ─── form primitives (match the client/post-job page treatment) ─────── */

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
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({
  name,
  type = 'text',
  min,
  max,
  placeholder,
  hint,
  defaultValue,
}: {
  name: string;
  type?: string;
  min?: number;
  max?: number;
  placeholder?: string;
  hint?: string;
  defaultValue?: string;
}) {
  return (
    <div>
      <input
        id={name}
        name={name}
        type={type}
        min={min}
        max={max}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
      />
      {hint && <p className="mt-1.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function Textarea({
  name,
  required,
  minLength,
  maxLength,
  rows = 6,
  placeholder,
  hint,
}: {
  name: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <textarea
        id={name}
        name={name}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
      />
      {hint && <p className="mt-1.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
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
      <p className={`mt-1 font-mono text-base font-semibold tracking-tight ${valueColor}`}>
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
