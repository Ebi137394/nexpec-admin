// ════════════════════════════════════════════════════════════════════════════
//  components/flash-reports/FlashReportRaiseForm.tsx — the NCR raise form.
//
//  Shared by the inspector (field) and admin (broker) raise pages so both stay
//  byte-identical. Pure server component, no client JS — selection state is CSS
//  has-[:checked], matching the submit-report form. Posts to raiseFlashReport;
//  the hidden `portal` field drives the return URL only (the RPC authorises).
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { AlertCircle, ShieldAlert, Paperclip, Siren } from 'lucide-react';
import { raiseFlashReport } from '@/lib/actions/flashReports';
import {
  CATEGORY_LABEL,
  SEVERITY_LABEL,
  type FlashReportCategory,
  type FlashReportSeverity,
} from '@/lib/data/flashReports';

const SEVERITIES: FlashReportSeverity[] = [
  'observation',
  'minor',
  'major',
  'critical',
];
const CATEGORIES: FlashReportCategory[] = [
  'safety',
  'calibration',
  'documentation',
  'procedure',
  'defect',
  'client_interference',
  'other',
];

export function FlashReportRaiseForm({
  jobId,
  portal,
  backHref,
  error,
}: {
  jobId: string;
  portal: 'inspector' | 'admin';
  backHref: string;
  error?: string;
}) {
  return (
    <>
      {error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {error}
        </Banner>
      )}

      <form
        action={raiseFlashReport}
        encType="multipart/form-data"
        className="space-y-8"
      >
        <input type="hidden" name="jobId" value={jobId} />
        <input type="hidden" name="portal" value={portal} />

        {/* Severity */}
        <Section
          title="Severity"
          subtitle="How serious is this? Critical issues are flagged for priority triage."
        >
          <fieldset>
            <legend className="sr-only">Severity</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SEVERITIES.map((s) => (
                <SeverityRadio key={s} value={s} defaultChecked={s === 'major'} />
              ))}
            </div>
          </fieldset>
          <p className="mt-3 flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
            <ShieldAlert
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-red/80"
              strokeWidth={2}
            />
            A critical severity raises a high-priority, critical-level entry in
            the audit trail and pings the client by email.
          </p>
        </Section>

        {/* Category */}
        <Section title="Category" subtitle="What kind of issue is this?">
          <fieldset>
            <legend className="sr-only">Category</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <CategoryChip key={c} value={c} defaultChecked={c === 'safety'} />
              ))}
            </div>
          </fieldset>
        </Section>

        {/* Title + description + site */}
        <Section
          title="What happened"
          subtitle="A short title plus the detail an admin needs to understand and act."
        >
          <div>
            <label
              htmlFor="title"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Title<span className="ml-1 text-violet-glow">*</span>
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              minLength={8}
              maxLength={160}
              placeholder="e.g. Calibration block missing for UT on segment 4A"
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">8–160 characters.</p>
          </div>
          <div>
            <label
              htmlFor="description"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Description<span className="ml-1 text-violet-glow">*</span>
            </label>
            <textarea
              id="description"
              name="description"
              required
              minLength={20}
              maxLength={5000}
              rows={8}
              placeholder={`What was observed, where, and why it's a concern.\n\ne.g. On arrival the certified calibration block for the 5 MHz probe was not on site. Cannot establish reference sensitivity per ASME B31.3 without it. Work paused on segment 4A pending a compliant block.`}
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Min 20 characters. Line breaks preserved.
            </p>
          </div>
          <div>
            <label
              htmlFor="locationText"
              className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
            >
              Site reference (optional)
            </label>
            <input
              id="locationText"
              name="locationText"
              type="text"
              maxLength={200}
              placeholder="e.g. Weld 4A-12, north skid, Level 2"
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
          </div>
        </Section>

        {/* Evidence */}
        <Section
          title="Evidence (optional)"
          subtitle="Up to 8 files. Photos (JPEG, PNG, WebP, HEIC) or PDF. Max 25 MB each. Stored privately; only job parties and admin can open them."
        >
          <label
            htmlFor="evidence"
            className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/10 bg-white/[0.02] p-8 transition-colors hover:border-violet/40 hover:bg-white/[0.04]"
          >
            <Paperclip
              className="h-8 w-8 text-zinc-500 transition-colors group-hover:text-violet-glow"
              strokeWidth={1.5}
            />
            <span className="text-sm font-medium text-zinc-300 group-hover:text-white">
              Click to attach photos or PDFs
            </span>
            <span className="text-[11px] text-zinc-500">
              Or drag and drop. Uploaded when you submit.
            </span>
            <input
              id="evidence"
              name="evidence"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,application/pdf"
              multiple
              className="sr-only"
            />
          </label>
        </Section>

        {/* Submit */}
        <div className="flex flex-col items-stretch gap-3 border-t border-white/[0.06] pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">
            The report is logged immediately and routed to admin. Track and
            resolve it from the job.
          </p>
          <div className="flex gap-2 sm:flex-row-reverse">
            <button
              type="submit"
              className="btn-primary inline-flex items-center justify-center gap-2"
            >
              <Siren className="h-4 w-4" strokeWidth={2} />
              Raise flash report
            </button>
            <Link
              href={backHref}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:text-white"
            >
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </>
  );
}

/* ─── primitives (match submit-report) ──────────────────────────────────── */

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

function SeverityRadio({
  value,
  defaultChecked,
}: {
  value: FlashReportSeverity;
  defaultChecked?: boolean;
}) {
  const checked =
    value === 'critical'
      ? 'has-[:checked]:border-accent-red/50 has-[:checked]:bg-accent-red/10 has-[:checked]:text-accent-red'
      : value === 'major'
        ? 'has-[:checked]:border-accent-amber/50 has-[:checked]:bg-accent-amber/10 has-[:checked]:text-accent-amber'
        : value === 'minor'
          ? 'has-[:checked]:border-cyan-glow/50 has-[:checked]:bg-cyan-glow/10 has-[:checked]:text-cyan-glow'
          : 'has-[:checked]:border-white/30 has-[:checked]:bg-white/10 has-[:checked]:text-white';
  return (
    <label
      className={`group flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-white/25 hover:text-white ${checked}`}
    >
      <input
        type="radio"
        name="severity"
        value={value}
        defaultChecked={defaultChecked}
        required
        className="sr-only"
      />
      <span>{SEVERITY_LABEL[value]}</span>
    </label>
  );
}

function CategoryChip({
  value,
  defaultChecked,
}: {
  value: FlashReportCategory;
  defaultChecked?: boolean;
}) {
  return (
    <label className="group cursor-pointer rounded-full border border-white/[0.08] bg-white/[0.02] px-3.5 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-white/25 hover:text-white has-[:checked]:border-violet/50 has-[:checked]:bg-violet/15 has-[:checked]:text-violet-glow">
      <input
        type="radio"
        name="category"
        value={value}
        defaultChecked={defaultChecked}
        required
        className="sr-only"
      />
      {CATEGORY_LABEL[value]}
    </label>
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
