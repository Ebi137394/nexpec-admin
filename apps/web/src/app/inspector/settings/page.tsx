// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/settings/page.tsx — Inspector profile editor
//
//  STRICT inspector-editable field list. Admin columns (verification_status,
//  balance_cents, stripe_connect_*, ratings, completed_jobs_count) render
//  read-only at the bottom for transparency but are never inputs.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  ShieldCheck,
} from 'lucide-react';
import { fetchInspectorProfile } from '@/lib/data/inspectorProfile';
import { NDT_METHOD_CHOICES } from '@/lib/data/inspectorProfile.types';
import { updateInspectorSettings } from '@/lib/actions/inspectorSettings';
import { COMMON_SPECIALTIES } from '@/lib/data/clientJobs.types';

export const metadata: Metadata = {
  title: 'Inspector settings',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ saved?: string; error?: string }>;
}

export default async function InspectorSettingsPage({ searchParams }: PageProps) {
  const qp = await searchParams;
  const profile = await fetchInspectorProfile();
  if (!profile) redirect('/inspector/dashboard');

  const specialtySet = new Set(profile.specialtySlugs);
  const ndtSet = new Set(profile.ndtMethods);

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Inspector Portal · Settings
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Your profile
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          What admin sees when deciding job matches, and what (limited
          fields) the client sees on a recommended candidate. Payout
          status, verification, and ratings are administered separately.
        </p>
      </header>

      {qp.error && (
        <Banner tone="red" icon={<AlertCircle className="h-5 w-5" />}>
          {qp.error}
        </Banner>
      )}
      {qp.saved === '1' && (
        <Banner tone="cyan" icon={<CheckCircle2 className="h-5 w-5" />}>
          Profile saved.
        </Banner>
      )}

      <form action={updateInspectorSettings} className="space-y-6">
        {/* Identity */}
        <Section
          title="Identity"
          subtitle="Name + tagline that appear on your applications."
        >
          <Field
            label="Full name"
            name="fullName"
            required
            defaultValue={profile.fullName ?? ''}
            placeholder="Alex Doe"
          />
          <Field
            label="Headline"
            name="headline"
            defaultValue={profile.headline ?? ''}
            placeholder="Senior NDT Inspector · API 510 / 570 / 653"
            hint="One line. Shown above your bio when admin reviews an application."
          />
          <Field
            label="Professional title"
            name="professionalTitle"
            defaultValue={profile.professionalTitle ?? ''}
            placeholder="Lead Pipeline Inspector"
          />
          <Textarea
            label="Bio"
            name="bio"
            defaultValue={profile.bio ?? ''}
            rows={6}
            maxLength={2000}
            placeholder="Specialties, sectors, recent project highlights. Markdown not rendered; line breaks preserved."
          />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="Phone"
              name="phone"
              type="tel"
              defaultValue={profile.phone ?? ''}
              placeholder="+1 555 0100"
              hint="Used for urgent dispatch alerts only — never shared with clients."
            />
            <Field
              label="Email"
              name="email_readonly"
              type="email"
              defaultValue={profile.email}
              disabled
              hint="Email rotation goes through support — drop a note in /contact."
            />
          </div>
        </Section>

        {/* Rates + experience */}
        <Section
          title="Rates & experience"
          subtitle="Reference rate only. Per-job payout is set by admin during dispatch."
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Field
              label="Hourly rate (USD)"
              name="hourlyRateDollars"
              type="number"
              min={0}
              max={10000}
              defaultValue={
                profile.hourlyRateCents
                  ? String(Math.round(profile.hourlyRateCents / 100))
                  : ''
              }
              placeholder="125"
              hint="Reference only. NEVER visible to clients."
            />
            <Field
              label="Years of experience"
              name="yearsOfExperience"
              defaultValue={profile.yearsOfExperience ?? ''}
              placeholder="12"
            />
            <Field
              label="Response time (hours)"
              name="responseTimeHours"
              type="number"
              min={1}
              max={168}
              defaultValue={
                profile.responseTimeHours
                  ? String(profile.responseTimeHours)
                  : ''
              }
              placeholder="24"
              hint="Typical response window."
            />
          </div>
        </Section>

        {/* Specialties */}
        <Section
          title="Specialties"
          subtitle="Drives which jobs surface in your feed."
        >
          <fieldset>
            <legend className="sr-only">Specialty slugs</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {COMMON_SPECIALTIES.map((s) => (
                <ChipCheckbox
                  key={s.slug}
                  name="specialtySlugs"
                  value={s.slug}
                  label={s.label}
                  defaultChecked={specialtySet.has(s.slug)}
                />
              ))}
            </div>
          </fieldset>
        </Section>

        {/* NDT Methods */}
        <Section
          title="NDT methods"
          subtitle="Standardised method codes admin uses for matching."
        >
          <fieldset>
            <legend className="sr-only">NDT methods</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {NDT_METHOD_CHOICES.map((m) => (
                <ChipCheckbox
                  key={m.slug}
                  name="ndtMethods"
                  value={m.slug}
                  label={m.label}
                  defaultChecked={ndtSet.has(m.slug)}
                />
              ))}
            </div>
          </fieldset>
        </Section>

        {/* Certifications */}
        <Section
          title="Certifications"
          subtitle="Comma-separated list — e.g. API 510, ASNT Level II UT, CWI."
        >
          <Textarea
            name="certifications"
            defaultValue={profile.certifications.join(', ')}
            rows={3}
            maxLength={4000}
            placeholder="API 510, API 570, API 653, ASNT Level II UT"
            hint="Each comma-separated item becomes a tag on your profile. File uploads land in the next sprint."
          />
        </Section>

        {/* Geography */}
        <Section
          title="Geography"
          subtitle="Where you work + how far you'll travel."
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field
              label="City"
              name="locationCity"
              defaultValue={profile.locationCity ?? ''}
              placeholder="Edmonton"
            />
            <Field
              label="Province / State"
              name="locationProvince"
              defaultValue={profile.locationProvince ?? ''}
              placeholder="Alberta"
            />
          </div>
          <Field
            label="Travel radius (km)"
            name="travelRadiusKm"
            type="number"
            min={1}
            max={20000}
            defaultValue={
              profile.travelRadiusKm
                ? String(profile.travelRadiusKm)
                : ''
            }
            placeholder="250"
            hint="Used by the open-jobs feed to filter listings outside your range."
          />
        </Section>

        {/* Availability */}
        <Section
          title="Availability"
          subtitle="Pause your inspector feed without going inactive."
        >
          <div className="flex flex-col gap-3">
            <Select
              label="Status"
              name="availabilityStatus"
              defaultValue={profile.availabilityStatus}
            >
              <option value="available">Available — open for new work</option>
              <option value="busy">Busy — working but reachable</option>
              <option value="offline">Offline — hidden from match queue</option>
            </Select>
            <label className="group flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] has-[:checked]:border-violet/40 has-[:checked]:bg-violet/10 has-[:checked]:text-white">
              <input
                type="checkbox"
                name="isAvailable"
                defaultChecked={profile.isAvailable}
                className="h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40 focus:ring-offset-0"
              />
              <span className="flex-1">
                Allow new job recommendations from admin
              </span>
            </label>
          </div>
        </Section>

        {/* Submit */}
        <div className="flex flex-col items-stretch gap-3 border-t border-white/[0.06] pt-8 sm:flex-row sm:items-center sm:justify-end">
          <button
            type="submit"
            className="btn-primary inline-flex items-center justify-center gap-2"
          >
            Save changes
            <span aria-hidden>→</span>
          </button>
        </div>
      </form>

      {/* Read-only system facts */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-zinc-500" strokeWidth={1.75} />
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Administered by NEXPEC
          </h2>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Verification status, ratings, and payout fields are administered
          by ops. Contact us in /contact if anything looks off.
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <ReadOnlyRow
            label="Verification"
            value={
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck
                  className={`h-4 w-4 ${
                    profile.verificationStatus === 'verified'
                      ? 'text-accent-green'
                      : 'text-zinc-500'
                  }`}
                  strokeWidth={1.75}
                />
                {profile.verificationStatus}
              </span>
            }
          />
          <ReadOnlyRow
            label="Rating"
            value={
              profile.ratingCount > 0
                ? `${profile.ratingAverage.toFixed(1)} (${profile.ratingCount})`
                : 'No ratings yet'
            }
          />
          <ReadOnlyRow
            label="Completed jobs"
            value={String(profile.completedJobsCount)}
          />
          <ReadOnlyRow label="Account ID" value={profile.id} mono />
          <ReadOnlyRow
            label="Member since"
            value={
              profile.createdAt
                ? new Date(profile.createdAt).toLocaleDateString()
                : '—'
            }
          />
          <ReadOnlyRow
            label="Last active"
            value={
              profile.lastActive
                ? new Date(profile.lastActive).toLocaleString()
                : '—'
            }
          />
        </dl>
      </section>
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
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  name,
  type = 'text',
  required,
  min,
  max,
  defaultValue,
  placeholder,
  hint,
  disabled,
}: {
  label?: string;
  name: string;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      {label && (
        <label
          htmlFor={name}
          className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
        >
          {label}
          {required && <span className="ml-1 text-violet-glow">*</span>}
        </label>
      )}
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        min={min}
        max={max}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {hint && <p className="mt-1.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function Textarea({
  label,
  name,
  defaultValue,
  placeholder,
  rows = 4,
  maxLength,
  hint,
}: {
  label?: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  hint?: string;
}) {
  return (
    <div>
      {label && (
        <label
          htmlFor={name}
          className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
        >
          {label}
        </label>
      )}
      <textarea
        id={name}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
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

function ChipCheckbox({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="group flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] has-[:checked]:border-violet/40 has-[:checked]:bg-violet/10 has-[:checked]:text-white">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-violet focus:ring-violet/40 focus:ring-offset-0"
      />
      <span className="flex-1">{label}</span>
    </label>
  );
}

function Banner({
  tone,
  icon,
  children,
}: {
  tone: 'cyan' | 'red';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const classes =
    tone === 'cyan'
      ? 'border-cyan-glow/30 bg-cyan-glow/5 text-cyan-glow'
      : 'border-accent-red/30 bg-accent-red/10 text-accent-red';
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-4 ${classes}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="text-sm">{children}</p>
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm text-zinc-200 ${mono ? 'font-mono break-all' : ''}`}
      >
        {value || '—'}
      </dd>
    </div>
  );
}
