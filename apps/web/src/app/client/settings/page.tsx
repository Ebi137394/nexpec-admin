// ════════════════════════════════════════════════════════════════════════════
//  app/client/settings/page.tsx — Client profile settings
//
//  GOLDEN_RULE_2 — Renders only client-eligible fields. No payout,
//  Stripe Connect, hourly rate, balance, or role controls anywhere on
//  this page.
// ════════════════════════════════════════════════════════════════════════════

import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { AlertCircle, CheckCircle2, Lock, Camera } from 'lucide-react';
import Image from 'next/image';
import { fetchClientSettings } from '@/lib/data/clientSettings';
import { updateClientSettings } from '@/lib/actions/clientSettings';
import { uploadAvatar } from '@/lib/actions/uploadAvatar';
import { fetchMfaStatus } from '@/lib/data/mfa';
import { MfaSection } from '@/components/account/MfaSection';

export const metadata: Metadata = {
  title: 'Settings',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
}

export default async function ClientSettingsPage({ searchParams }: PageProps) {
  const qp = await searchParams;
  const [profile, mfaStatus] = await Promise.all([
    fetchClientSettings(),
    fetchMfaStatus(),
  ]);
  if (!profile) {
    // Profile row missing — bounce to home so middleware can re-resolve.
    redirect('/client/dashboard');
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal · Settings
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Your profile
        </h1>
        <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
          What inspectors see when they consider applying to your jobs.
          Billing details, payouts, and roles are administered separately.
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

      {/* Avatar upload — separate <form> from the profile form so the
          multipart file submit doesn't collide with text-field submission. */}
      <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
        <header className="mb-6">
          <h2 className="font-display text-lg font-semibold tracking-tight text-white">
            Avatar
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Profile picture that appears on your jobs and on the admin
            queue. Stored in the public{' '}
            <span className="font-mono">avatars</span> bucket.
          </p>
        </header>
        <form
          action={uploadAvatar}
          encType="multipart/form-data"
          className="flex flex-col items-start gap-4 sm:flex-row sm:items-center"
        >
          <input type="hidden" name="returnTo" value="/client/settings" />
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
                {(profile.companyName || profile.fullName || profile.email || '?')
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

      {/* Editable section */}
      <form
        action={updateClientSettings}
        className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8"
      >
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          Identity
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          The name + company we show on every job you post.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Full name"
            name="fullName"
            required
            defaultValue={profile.fullName ?? ''}
            placeholder="Alex Doe"
          />
          <Field
            label="Company"
            name="companyName"
            defaultValue={profile.companyName ?? ''}
            placeholder="Acme Industrial"
            hint="Optional. Shown on the job listing if set."
          />
        </div>

        <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Phone"
            name="phone"
            type="tel"
            defaultValue={profile.phone ?? ''}
            placeholder="+1 555 0100"
            hint="Used for urgent dispatch alerts only — never shown to inspectors."
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

        <div className="mt-8 flex justify-end">
          <button
            type="submit"
            className="btn-primary inline-flex items-center gap-2"
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
            Account
          </h2>
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Read-only metadata. Role and verification status are administered
          by NEXPEC ops; contact us if anything looks off.
        </p>
        <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ReadOnlyRow label="Account ID" value={profile.id} mono />
          <ReadOnlyRow label="Email" value={profile.email} mono />
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

      {/* Sprint 13.3 — Two-factor authentication. Strictly additive at
          the tail of the existing layout. */}
      <MfaSection initial={mfaStatus} />
    </div>
  );
}

/* ─── form + view primitives ─────────────────────────────────────────── */

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

function Field({
  label,
  name,
  type = 'text',
  required,
  defaultValue,
  placeholder,
  hint,
  disabled,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
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
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:border-violet/60 focus:bg-white/[0.05] focus:outline-none focus:ring-2 focus:ring-violet/30 disabled:cursor-not-allowed disabled:opacity-60"
      />
      {hint && <p className="mt-1.5 text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}

function ReadOnlyRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm text-zinc-200 ${mono ? 'font-mono' : ''} break-all`}
      >
        {value || '—'}
      </dd>
    </div>
  );
}
