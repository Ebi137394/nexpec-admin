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
import { uploadAvatar } from '@/lib/actions/uploadAvatar';
import { uploadResume, deleteResume } from '@/lib/actions/uploadResume';
import {
  createInspectorCertificate,
  deleteInspectorCertificate,
} from '@/lib/actions/inspectorCertificates';
import { fetchMyInspectorCertificates } from '@/lib/data/inspectorCertificates';
import { SPECIALTY_GROUPS } from '@/lib/data/specialtyTaxonomy';
import { fetchCountries } from '@/lib/data/countries';
import { CountryMultiSelect } from '@/components/forms/CountryMultiSelect';
import Image from 'next/image';
import Link from 'next/link';
import {
  Camera,
  Globe2,
  FileText,
  Trash2,
  Briefcase,
  ExternalLink,
  Check,
  Radio,
  BookOpen,
  Flame,
  Paintbrush,
  Container,
  Wind,
  Database,
  Cog,
  Zap,
  Building2,
  Fuel,
  FlaskConical,
  Sun,
  Anchor,
  ArrowUp,
  Plane,
  ShieldCheck as ShieldCheck2,
  Layers,
} from 'lucide-react';
import { TagInput } from '@/components/forms/TagInput';
import {
  CURRENCY_CHOICES,
  PAYMENT_TERMS,
  PAYMENT_TERM_LABELS,
} from '@/lib/data/inspectorProfile.types';

export const metadata: Metadata = {
  title: 'Inspector settings',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ saved?: string; error?: string }>;
}

export default async function InspectorSettingsPage({ searchParams }: PageProps) {
  const qp = await searchParams;
  const [profile, countries, certificates] = await Promise.all([
    fetchInspectorProfile(),
    fetchCountries(),
    fetchMyInspectorCertificates(),
  ]);
  // If the profile fetch failed (RLS, missing column, etc), do NOT redirect
  // silently — that's the "click does nothing" UX we keep getting bitten by.
  // Show an in-page error with the migration to run.
  if (!profile) {
    return (
      <div className="rounded-3xl border border-accent-red/30 bg-accent-red/5 p-8 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-accent-red" strokeWidth={1.5} />
        <h1 className="mt-4 font-display text-xl font-semibold text-white">
          Couldn&rsquo;t load your profile
        </h1>
        <p className="mt-2 max-w-md mx-auto text-sm text-zinc-400">
          Your account exists but the profile query failed — usually because the
          inspector-profile safety-net migration hasn&rsquo;t been applied yet.
          Ask an admin to run{' '}
          <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px]">
            20260518290000_inspector_profile_safety_net.sql
          </code>{' '}
          in Supabase.
        </p>
        <div className="mt-5">
          <Link
            href="/inspector/dashboard"
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-semibold text-zinc-200 hover:border-violet/40 hover:text-white"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const specialtySet = new Set(profile.specialtySlugs);
  const ndtSet = new Set(profile.ndtMethods);

  return (
    <div className="space-y-8">
      <header className="relative overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-violet/[0.10] via-ink-900/40 to-ink-900/20 p-6 sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-violet/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-cyan-glow/10 blur-3xl"
        />
        <div className="relative">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-glow shadow-[0_0_8px_rgba(124,58,237,0.7)]" />
            Inspector Portal · Settings
          </p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Your profile
          </h1>
          <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
            What admin sees when deciding job matches, and what (limited
            fields) the client sees on a recommended candidate. Payout
            status, verification, and ratings are administered separately.
          </p>
        </div>
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

      {/* Avatar upload — separate <form> because file uploads + standard
          form submits can't share the same multipart request without
          colliding on submit-button targets. */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Avatar
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Profile picture admin sees when vetting your applications.
            Stored in the public <span className="font-mono">avatars</span> bucket.
          </p>
        </header>
        <form
          action={uploadAvatar}
          encType="multipart/form-data"
          className="flex flex-col items-start gap-4 sm:flex-row sm:items-center"
        >
          <input type="hidden" name="returnTo" value="/inspector/settings" />
          <div
            className="relative inline-flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet to-cyan-glow ring-2 ring-white/[0.06]"
            aria-hidden
          >
            {profile.avatarUrl ? (
              <Image
                src={profile.avatarUrl}
                alt={profile.fullName ?? 'Avatar'}
                width={80}
                height={80}
                className="h-full w-full object-cover"
                unoptimized
              />
            ) : (
              <span className="font-display text-2xl font-semibold text-white">
                {(profile.fullName || profile.email || '?')
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <label
              htmlFor="avatar"
              className="group inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
            >
              <Camera className="h-4 w-4" strokeWidth={1.75} />
              Choose new avatar
            </label>
            <input
              id="avatar"
              name="avatar"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
            />
            <p className="text-[11px] text-zinc-500">
              JPEG, PNG, WebP, or GIF · max 5 MB · square crops look best.
            </p>
            <button
              type="submit"
              className="btn-primary mt-2 inline-flex w-fit items-center gap-2"
            >
              Upload avatar
              <span aria-hidden>→</span>
            </button>
          </div>
        </form>
      </section>

      {/* Resume / CV — private bucket. Separate <form> because it's a file upload. */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight text-white">
              Resume / CV
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Stored privately in <span className="font-mono">resumes</span>.
              Only you and our ops team can read it; we sign a temporary URL
              when you view.
            </p>
          </div>
          <Link
            href="/inspector/experience"
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
          >
            <Briefcase className="h-3 w-3" strokeWidth={1.75} />
            Manage work history
          </Link>
        </header>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet/10 text-violet-glow ring-1 ring-inset ring-violet/30">
              <FileText className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0">
              {profile.resumeUrl ? (
                <a
                  href={profile.resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-white hover:text-violet-glow"
                >
                  View current resume
                  <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                </a>
              ) : (
                <p className="text-sm font-medium text-zinc-300">
                  No resume uploaded yet.
                </p>
              )}
              <p className="text-[11px] text-zinc-500">
                PDF or Word doc · max 10 MB.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form
              action={uploadResume}
              encType="multipart/form-data"
              className="flex items-center gap-2"
            >
              <label
                htmlFor="resume"
                className="group inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
              >
                <FileText className="h-4 w-4" strokeWidth={1.75} />
                Choose file
              </label>
              <input
                id="resume"
                name="resume"
                type="file"
                accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="sr-only"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-full bg-violet px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-violet/90"
              >
                Upload
              </button>
            </form>
            {profile.resumePath && (
              <form action={deleteResume}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
                >
                  <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                  Remove
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

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
          subtitle="Reference rates only. Per-job payout is set by admin during dispatch; clients NEVER see these."
        >
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div>
              <label
                htmlFor="currency"
                className="block text-[11px] font-semibold uppercase tracking-industrial text-zinc-500"
              >
                Currency
              </label>
              <select
                id="currency"
                name="currency"
                defaultValue={profile.currency || 'USD'}
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
              >
                {CURRENCY_CHOICES.map((c) => (
                  <option key={c} value={c} className="bg-ink-900">
                    {c}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-zinc-500">
                Reference currency for rates below.
              </p>
            </div>
            <Field
              label="Hourly rate (in selected currency)"
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
              label="Travel rate per hour"
              name="travelRateDollars"
              type="number"
              min={0}
              max={10000}
              defaultValue={
                profile.travelRateCents
                  ? String(Math.round(profile.travelRateCents / 100))
                  : ''
              }
              placeholder="75"
              hint="Charged while travelling outside your radius."
            />
            <Field
              label="Overtime multiplier"
              name="overtimeMultiplier"
              type="number"
              min={1}
              max={5}
              defaultValue={
                profile.overtimeMultiplier !== null
                  ? String(profile.overtimeMultiplier)
                  : '1.5'
              }
              placeholder="1.5"
              hint="× hourly rate beyond standard day."
            />
            <Field
              label="Weekend multiplier"
              name="weekendMultiplier"
              type="number"
              min={1}
              max={5}
              defaultValue={
                profile.weekendMultiplier !== null
                  ? String(profile.weekendMultiplier)
                  : '1.5'
              }
              placeholder="1.5"
            />
            <Field
              label="Holiday multiplier"
              name="holidayMultiplier"
              type="number"
              min={1}
              max={5}
              defaultValue={
                profile.holidayMultiplier !== null
                  ? String(profile.holidayMultiplier)
                  : '2.0'
              }
              placeholder="2.0"
            />
            <div>
              <label
                htmlFor="paymentTerms"
                className="block text-[11px] font-semibold uppercase tracking-industrial text-zinc-500"
              >
                Payment terms
              </label>
              <select
                id="paymentTerms"
                name="paymentTerms"
                defaultValue={profile.paymentTerms ?? 'net30'}
                className="mt-1 w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
              >
                {PAYMENT_TERMS.map((t) => (
                  <option key={t} value={t} className="bg-ink-900">
                    {PAYMENT_TERM_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-zinc-500">
                When you expect to be paid after invoice.
              </p>
            </div>
            <Field
              label="Minimum engagement (hours)"
              name="minimumEngagementHours"
              type="number"
              min={1}
              max={240}
              defaultValue={
                profile.minimumEngagementHours
                  ? String(profile.minimumEngagementHours)
                  : ''
              }
              placeholder="4"
              hint="Minimum bookable engagement."
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

        {/* Specialties — premium grouped taxonomy (200+) + tag input */}
        <Section
          title="Specialties"
          subtitle="Drives which jobs surface in your feed. Pick everything you cover — admin uses these for matching."
        >
          {/* Selected-total chip — quick at-a-glance counter for the entire section */}
          {(() => {
            const totalSelected = SPECIALTY_GROUPS.reduce(
              (acc, g) => acc + g.items.filter((i) => specialtySet.has(i.slug)).length,
              0,
            );
            return (
              <div className="flex items-center justify-between rounded-2xl border border-violet/20 bg-gradient-to-r from-violet/10 to-transparent px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-violet/20 text-violet-glow ring-1 ring-inset ring-violet/40">
                    <Layers className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {totalSelected} {totalSelected === 1 ? 'specialty' : 'specialties'} selected
                    </p>
                    <p className="text-[11px] text-zinc-500">
                      Across {SPECIALTY_GROUPS.length} disciplines · {SPECIALTY_GROUPS.reduce((a, g) => a + g.items.length, 0)}+ options
                    </p>
                  </div>
                </div>
                <span className="hidden rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-industrial text-violet-glow sm:inline">
                  Live preview
                </span>
              </div>
            );
          })()}

          {SPECIALTY_GROUPS.map((group) => {
            const Icon = specialtyGroupIcon(group.title);
            const selectedInGroup = group.items.filter((i) =>
              specialtySet.has(i.slug),
            ).length;
            return (
              <fieldset
                key={group.title}
                className="space-y-3 rounded-2xl border border-white/[0.05] bg-white/[0.01] p-4 sm:p-5"
              >
                <legend className="flex items-center gap-2 px-2">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-violet/10 text-violet-glow ring-1 ring-inset ring-violet/25">
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-200">
                    {group.title}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                    {group.items.length}
                  </span>
                  {selectedInGroup > 0 && (
                    <span className="rounded-full border border-violet/30 bg-violet/15 px-2 py-0.5 text-[10px] font-semibold text-violet-glow">
                      {selectedInGroup} selected
                    </span>
                  )}
                </legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {group.items.map((s) => (
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
            );
          })}

          {/* Custom specialties — premium TagInput */}
          <div className="rounded-2xl border border-dashed border-violet/25 bg-gradient-to-br from-violet/[0.04] to-transparent p-5">
            <TagInput
              name="customSpecialties"
              title="Don't see your specialty? Add your own"
              hint="Type your specialty and press Enter (or comma). Each tag is saved on your profile and is searchable by admin."
              placeholder="e.g. Subsea robotic inspection"
              maxItems={50}
              defaultValue={(profile.specialtySlugs ?? [])
                .filter((s) => !SPECIALTY_GROUPS.some((g) => g.items.some((i) => i.slug === s)))
                .map((s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
                .join(', ')}
            />
          </div>
        </Section>

        {/* NDT Methods — same polish, smaller scale */}
        <Section
          title="NDT methods"
          subtitle="Standardised method codes admin uses for matching."
        >
          <fieldset className="space-y-3 rounded-2xl border border-white/[0.05] bg-white/[0.01] p-4 sm:p-5">
            <legend className="flex items-center gap-2 px-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/25">
                <Radio className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-200">
                Method codes
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
                {NDT_METHOD_CHOICES.length}
              </span>
              {ndtSet.size > 0 && (
                <span className="rounded-full border border-cyan-glow/30 bg-cyan-glow/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-glow">
                  {[...ndtSet].filter((s) => NDT_METHOD_CHOICES.some((m) => m.slug === s)).length} selected
                </span>
              )}
            </legend>
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

          <div className="rounded-2xl border border-dashed border-cyan-glow/25 bg-gradient-to-br from-cyan-glow/[0.04] to-transparent p-5">
            <TagInput
              name="customNdtMethods"
              title="Add custom NDT methods"
              hint="Type a method name and press Enter. Use for niche or proprietary methods not in the standard list."
              placeholder="e.g. Shearography"
              maxItems={30}
              defaultValue={(profile.ndtMethods ?? [])
                .filter((s) => !NDT_METHOD_CHOICES.some((m) => m.slug === s))
                .map((s) => s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
                .join(', ')}
            />
          </div>
        </Section>

        {/* Certifications — keep the legacy text list for back-compat */}
        <Section
          title="Certification tags (text-only)"
          subtitle="Optional quick-tag list. For documents and expiry tracking, use the Certificates section below."
        >
          <Textarea
            name="certifications"
            defaultValue={profile.certifications.join(', ')}
            rows={3}
            maxLength={4000}
            placeholder="API 510, API 570, API 653, ASNT Level II UT"
            hint="Comma-separated. Saved as profile tags. Per-cert files live in the next section."
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

        {/* Jurisdiction — Sprint 8A parity with mobile profile/edit */}
        <Section
          title="Jurisdiction"
          subtitle="Where you're legally authorised to work. Used by the job-feed matcher to filter listings to inspections you can actually accept."
        >
          <CountryMultiSelect
            name="countryOfResidence"
            label="Country of residence"
            countries={countries}
            defaultSelected={
              profile.countryOfResidence ? [profile.countryOfResidence] : []
            }
            single
            placeholder="Pick your country of residence"
            hint="Used for tax + KYC purposes. References country_codes(code)."
          />
          <CountryMultiSelect
            name="workAuthorizedCountries"
            label="Work-authorised countries"
            countries={countries}
            defaultSelected={profile.workAuthorizedCountries}
            placeholder="Add countries you can legally work in"
            hint="Up to 60. Only jobs in these countries appear in your feed (unless you opt into sponsored work below)."
          />

          <label className="group flex cursor-pointer items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm font-medium text-zinc-300 transition-colors hover:border-accent-amber/40 hover:bg-white/[0.04] has-[:checked]:border-accent-amber/40 has-[:checked]:bg-accent-amber/10 has-[:checked]:text-accent-amber">
            <input
              type="checkbox"
              name="openToSponsoredWork"
              defaultChecked={profile.openToSponsoredWork}
              className="h-4 w-4 shrink-0 rounded border-white/20 bg-transparent text-accent-amber focus:ring-accent-amber/40 focus:ring-offset-0"
            />
            <span className="flex-1 inline-flex items-center gap-2">
              <Globe2 className="h-4 w-4" strokeWidth={1.75} />
              Open to sponsored work (visa assist / relocation)
            </span>
          </label>

          <CountryMultiSelect
            name="sponsoredCountries"
            label="Sponsored-work destinations"
            countries={countries}
            defaultSelected={profile.sponsoredCountries}
            placeholder="Countries you'd consider with sponsorship"
            hint="Only relevant when sponsored-work is enabled above. Cleared automatically when the toggle is off."
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

      {/* ─── Certificates manager (separate from the main profile form) ── */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Certificates ({certificates.length})
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Upload individual certificate files (PDF / Word / image) with
            issuing body, certificate number and expiry. Stored privately in{' '}
            <span className="font-mono">inspector_certificates</span>. Admins
            can view; clients never see the file itself.
          </p>
        </header>

        {/* Existing certs list */}
        {certificates.length > 0 && (
          <ul className="mb-6 divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06]">
            {certificates.map((c) => {
              const expired =
                c.expiryDate && new Date(c.expiryDate) < new Date();
              const expiringSoon =
                c.expiryDate &&
                !expired &&
                new Date(c.expiryDate).getTime() - Date.now() <
                  60 * 24 * 60 * 60 * 1000;
              return (
                <li key={c.id} className="flex items-start gap-3 p-4 sm:p-5">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-violet-glow" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="truncate text-sm font-semibold text-white">
                        {c.name}
                      </p>
                      {c.certificateNo && (
                        <span className="font-mono text-[10px] text-zinc-500">
                          #{c.certificateNo}
                        </span>
                      )}
                      {expired && (
                        <span className="rounded-full border border-accent-red/30 bg-accent-red/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-red">
                          Expired
                        </span>
                      )}
                      {!expired && expiringSoon && (
                        <span className="rounded-full border border-accent-amber/30 bg-accent-amber/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-amber">
                          Expiring soon
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {c.issuingBody ?? 'Unknown issuer'}
                      {c.issueDate ? ` · issued ${c.issueDate}` : ''}
                      {c.expiryDate ? ` · expires ${c.expiryDate}` : ''}
                    </p>
                    {c.notes && (
                      <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">
                        {c.notes}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      {c.fileSignedUrl && (
                        <a
                          href={c.fileSignedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-[11px] font-semibold text-violet-glow hover:bg-violet/20"
                        >
                          View file
                          <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                        </a>
                      )}
                      <form action={deleteInspectorCertificate}>
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold text-zinc-400 hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
                        >
                          <Trash2 className="h-3 w-3" strokeWidth={1.75} />
                          Remove
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Create-new form */}
        <form
          action={createInspectorCertificate}
          encType="multipart/form-data"
          className="space-y-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5"
        >
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-violet-glow/80">
            Add a certificate
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" name="name" required placeholder="API 510" />
            <Field label="Issuing body" name="issuingBody" placeholder="American Petroleum Institute" />
            <Field label="Certificate number" name="certificateNo" placeholder="510-12345" />
            <Field label="Issue date" name="issueDate" type="date" />
            <Field label="Expiry date" name="expiryDate" type="date" />
            <div>
              <label
                htmlFor="certFile"
                className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-500"
              >
                File (PDF / Word / image)
              </label>
              <input
                id="certFile"
                name="file"
                type="file"
                accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp"
                className="mt-2 block w-full text-xs text-zinc-300 file:mr-3 file:rounded-full file:border-0 file:bg-violet file:px-4 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-violet/90"
              />
              <p className="mt-1 text-[10px] text-zinc-500">Optional. Max 15 MB.</p>
            </div>
          </div>
          <Textarea name="notes" rows={2} maxLength={1000} placeholder="Notes (optional)" />
          <div className="flex justify-end">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm hover:bg-violet/90"
            >
              Add certificate
            </button>
          </div>
        </form>
      </section>

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
    <label className="group relative flex cursor-pointer items-center gap-2.5 overflow-hidden rounded-xl border border-white/[0.06] bg-gradient-to-br from-white/[0.025] to-white/[0.005] px-3 py-2.5 text-sm text-zinc-300 transition-all duration-200 hover:-translate-y-px hover:border-violet/30 hover:from-white/[0.06] hover:to-white/[0.02] hover:text-white hover:shadow-[0_4px_12px_-4px_rgba(124,58,237,0.25)] has-[:checked]:border-violet/50 has-[:checked]:from-violet/15 has-[:checked]:to-violet/5 has-[:checked]:text-white has-[:checked]:shadow-[0_0_0_1px_rgba(124,58,237,0.30)] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-violet/40">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      {/* Custom checkbox box with animated check icon */}
      <span
        aria-hidden
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-white/15 bg-white/[0.04] transition-all duration-200 peer-checked:border-violet-glow peer-checked:bg-gradient-to-br peer-checked:from-violet peer-checked:to-violet-glow peer-checked:shadow-[0_0_8px_rgba(124,58,237,0.5)]"
      >
        <Check
          className="h-3 w-3 text-white opacity-0 transition-all duration-200 peer-checked:opacity-100"
          strokeWidth={3}
        />
      </span>
      <span className="flex-1 leading-tight">{label}</span>
      {/* Subtle violet ring overlay when hovered (purely decorative) */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl opacity-0 ring-1 ring-inset ring-violet/0 transition-opacity duration-200 group-hover:opacity-100 group-hover:ring-violet/10"
      />
    </label>
  );
}

/** Match a SPECIALTY_GROUPS title to a Lucide icon. */
function specialtyGroupIcon(title: string) {
  switch (title) {
    case 'NDT methods':                          return Radio;
    case 'API standards':                        return BookOpen;
    case 'Welding & joining':                    return Flame;
    case 'Coatings & corrosion':                 return Paintbrush;
    case 'Pressure equipment & boilers':         return Container;
    case 'Piping & pipelines':                   return Wind;
    case 'Storage tanks':                        return Database;
    case 'Mechanical & rotating':                return Cog;
    case 'Electrical & instrumentation':         return Zap;
    case 'Civil & structural':                   return Building2;
    case 'Oil & gas — upstream':                 return Fuel;
    case 'Oil & gas — downstream / process':     return FlaskConical;
    case 'Power & renewables':                   return Sun;
    case 'Marine & offshore':                    return Anchor;
    case 'Lifting & rigging':                    return ArrowUp;
    case 'Aerospace & defense':                  return Plane;
    case 'Quality, safety & systems':            return ShieldCheck2;
    case 'Special domains':
    default:                                     return Layers;
  }
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
