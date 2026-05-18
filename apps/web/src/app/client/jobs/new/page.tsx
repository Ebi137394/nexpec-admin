// ════════════════════════════════════════════════════════════════════════════
//  app/client/jobs/new/page.tsx — Post a new inspection job
//
//  Server Component form. Mirrors the mobile post-new-job field shape:
//  title, description, location_city, budget, urgency, job_type,
//  specialty_slugs. Submission goes to the createJob server action which
//  redirects back to /client/jobs?created=<id> on success or
//  /client/jobs/new?error=... on validation/RLS failure.
//
//  No client-side JS for the form itself — server actions handle the
//  round-trip. Pure HTML + Tailwind so the page hydrates instantly.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { createJob } from '@/lib/actions/jobs';
import { COMMON_SPECIALTIES } from '@/lib/data/clientJobs.types';

export const metadata: Metadata = {
  title: 'Post a job',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    error?: string;
  }>;
}

export default async function NewClientJobPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const errorMsg = params.error;

  return (
    <div className="space-y-8">
      {/* Heading */}
      <header>
        <Link
          href="/client/jobs"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to my jobs
        </Link>
        <p className="mt-4 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Post a new inspection
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          Define the scope, pick a budget, choose the right specialties.
          Vetted inspectors see the listing as soon as moderation clears.
        </p>
      </header>

      {/* Error ribbon */}
      {errorMsg && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-red" />
          <p className="text-sm text-accent-red">{errorMsg}</p>
        </div>
      )}

      {/* Form */}
      <form action={createJob} className="space-y-8">
        {/* Section: scope */}
        <Section
          title="Scope"
          subtitle="Who's reading this needs to know the inspection in 30 seconds."
        >
          <Field
            label="Title"
            name="title"
            required
            minLength={5}
            maxLength={140}
            placeholder="Pre-commission UT on 18 inch crude pipeline, segment 4A"
          />
          <Textarea
            label="Description"
            name="description"
            required
            minLength={20}
            maxLength={8000}
            rows={8}
            placeholder="Cover scope, site access, acceptance criteria, reporting cadence, and any sponsor-specific standards (API, ASME, CSA, etc)."
            hint="Markdown isn't rendered, but line breaks are preserved. Attach diagrams via the job page after posting."
          />
        </Section>

        {/* Section: logistics */}
        <Section
          title="Logistics"
          subtitle="Geography + urgency + job-type drive who sees this in their feed."
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="City"
              name="locationCity"
              required
              maxLength={120}
              placeholder="Calgary, Alberta"
            />
            <Select label="Job type" name="jobType" defaultValue="on_site">
              <option value="on_site">On-site</option>
              <option value="remote">Remote / desk review</option>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Select label="Urgency" name="urgency" defaultValue="normal">
              <option value="low">Low — flexible scheduling</option>
              <option value="normal">Normal — standard turnaround</option>
              <option value="high">High — same-week response</option>
              <option value="critical">Critical — 24h dispatch</option>
            </Select>
            <Field
              label="Budget (USD)"
              name="budgetDollars"
              type="number"
              min={100}
              max={10_000_000}
              required
              placeholder="2500"
              hint="Whole dollars. Held in escrow until you release on a signed report."
            />
          </div>
        </Section>

        {/* Section: specialties */}
        <Section
          title="Specialties"
          subtitle="Pick what's relevant. Inspectors filter their feed by these tags."
        >
          <fieldset>
            <legend className="sr-only">Specialties</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {COMMON_SPECIALTIES.map((s) => (
                <label
                  key={s.slug}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] has-[:checked]:border-violet/40 has-[:checked]:bg-violet/10 has-[:checked]:text-white"
                >
                  <input
                    type="checkbox"
                    name="specialties"
                    value={s.slug}
                    className="h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40 focus:ring-offset-0"
                  />
                  <span className="flex-1">{s.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Section>

        {/* Submit */}
        <div className="flex flex-col items-stretch gap-3 border-t border-white/[0.06] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">
            Posting goes into <span className="text-zinc-300">moderation</span>{' '}
            before reaching inspectors. Average clearance: under 1 business hour.
          </p>
          <button
            type="submit"
            className="btn-primary inline-flex items-center justify-center gap-2"
          >
            Post for moderation
            <span aria-hidden>→</span>
          </button>
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
        {subtitle && (
          <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
        )}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  name,
  hint,
  type = 'text',
  required,
  minLength,
  maxLength,
  min,
  max,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  hint?: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
      >
        {label}
        {required && <span className="ml-1 text-violet-glow">*</span>}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        min={min}
        max={max}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
      />
      {hint && <p className="mt-1.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function Textarea({
  label,
  name,
  hint,
  required,
  minLength,
  maxLength,
  rows = 6,
  placeholder,
}: {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
      >
        {label}
        {required && <span className="ml-1 text-violet-glow">*</span>}
      </label>
      <textarea
        id={name}
        name={name}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        rows={rows}
        placeholder={placeholder}
        className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
      />
      {hint && <p className="mt-1.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function Select({
  label,
  name,
  defaultValue,
  children,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={name}
        className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
      >
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
      >
        {children}
      </select>
    </div>
  );
}
