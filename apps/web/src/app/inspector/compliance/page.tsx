// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/compliance/page.tsx — Verification + certifications view
//
//  Read-only display. Editing the underlying arrays happens in /settings;
//  verification status is administered by ops and never inspector-editable.
// ════════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import {
  ShieldCheck,
  ShieldAlert,
  Award,
  ScanLine,
  Globe2,
  Pencil,
  Clock,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { fetchInspectorProfile } from '@/lib/data/inspectorProfile';
import type { VerificationStatus } from '@/lib/data/inspectorProfile.types';

export const metadata: Metadata = {
  title: 'Compliance',
};

export const dynamic = 'force-dynamic';

export default async function InspectorCompliancePage() {
  const profile = await fetchInspectorProfile();
  if (!profile) redirect('/inspector/dashboard');

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
            Inspector Portal · Compliance
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Credentials & verification
          </h1>
          <p className="mt-2 max-w-xl text-pretty text-sm text-zinc-400">
            Your verification status, certifications, NDT methods, and
            work-authorization geography. Verification is administered by
            our ops team; arrays below are editable in settings.
          </p>
        </div>
        <Link
          href="/inspector/settings"
          className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 bg-white/[0.03] px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white sm:self-auto"
        >
          <Pencil className="h-4 w-4" strokeWidth={1.75} />
          Edit profile
        </Link>
      </header>

      {/* Verification banner */}
      <VerificationCard
        status={profile.verificationStatus}
        verifiedAt={profile.verifiedAt}
        rejectionReason={profile.rejectionReason}
      />

      {/* Certifications */}
      <Section
        title="Certifications"
        icon={<Award className="h-4 w-4" strokeWidth={1.75} />}
        emptyCopy="No certifications listed yet. Add them from settings — comma-separated."
        items={profile.certifications}
      />

      {/* NDT methods */}
      <Section
        title="NDT methods"
        icon={<ScanLine className="h-4 w-4" strokeWidth={1.75} />}
        emptyCopy="No NDT method codes set. Pick from the chip grid in settings."
        items={profile.ndtMethods.map((m) => m.toUpperCase())}
      />

      {/* Specialties */}
      <Section
        title="Specialties"
        icon={<ShieldCheck className="h-4 w-4" strokeWidth={1.75} />}
        emptyCopy="No specialties selected. Tag what you cover so the right jobs surface."
        items={profile.specialtySlugs.map((s) => s.replace(/-/g, ' '))}
      />

      {/* Work authorization */}
      <Section
        title="Work authorization"
        icon={<Globe2 className="h-4 w-4" strokeWidth={1.75} />}
        emptyCopy="No country codes set. Inspections in jurisdictions outside your list won't appear in your feed."
        items={profile.workAuthorizedCountries.map((c) => c.toUpperCase())}
        footer={
          profile.openToSponsoredWork ? (
            <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-accent-amber/30 bg-accent-amber/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-industrial text-accent-amber">
              <Globe2 className="h-3 w-3" strokeWidth={1.75} />
              Open to sponsored work · {profile.sponsoredCountries.length}{' '}
              sponsored countries
            </p>
          ) : null
        }
      />
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

function VerificationCard({
  status,
  verifiedAt,
  rejectionReason,
}: {
  status: VerificationStatus;
  verifiedAt: string | null;
  rejectionReason: string | null;
}) {
  if (status === 'verified') {
    return (
      <section className="rounded-3xl border border-accent-green/30 bg-gradient-to-b from-accent-green/[0.08] to-accent-green/[0.02] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-green/10 text-accent-green ring-1 ring-inset ring-accent-green/30">
            <CheckCircle2 className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-white">
              Verified
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {verifiedAt
                ? `Approved by ops on ${new Date(verifiedAt).toLocaleDateString()}.`
                : 'Your credentials are on file with our ops team.'}{' '}
              You&apos;re eligible to apply to any job that matches your
              specialties.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (status === 'pending') {
    return (
      <section className="rounded-3xl border border-cyan-glow/30 bg-gradient-to-b from-cyan-glow/[0.08] to-cyan-glow/[0.02] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-cyan-glow/10 text-cyan-glow ring-1 ring-inset ring-cyan-glow/30">
            <Clock className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-white">
              Pending verification
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Our ops team is reviewing your credentials. You can browse
              jobs and apply during this window, but assignments are held
              until verification clears.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (status === 'rejected') {
    return (
      <section className="rounded-3xl border border-accent-red/30 bg-gradient-to-b from-accent-red/[0.08] to-accent-red/[0.02] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent-red/10 text-accent-red ring-1 ring-inset ring-accent-red/30">
            <AlertTriangle className="h-6 w-6" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-white">
              Verification did not pass
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {rejectionReason ||
                'Our ops team flagged a credential issue. Contact support to resolve.'}
            </p>
            <Link
              href="/contact?channel=support"
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-accent-red/40 bg-accent-red/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-accent-red hover:bg-accent-red/20"
            >
              Talk to support
            </Link>
          </div>
        </div>
      </section>
    );
  }

  // Unverified or unknown.
  return (
    <section className="rounded-3xl border border-white/[0.08] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-violet/10 text-violet-glow ring-1 ring-inset ring-violet/30">
          <ShieldAlert className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-white">
            Not yet verified
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Reach out to ops to start verification. You can complete your
            profile in the meantime — verification reviews go faster on a
            fully-filled profile.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/inspector/settings"
              className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/20"
            >
              Complete profile
            </Link>
            <Link
              href="/contact?channel=support"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-300 hover:border-white/25 hover:text-white"
            >
              Request verification
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Section({
  title,
  icon,
  items,
  emptyCopy,
  footer,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[];
  emptyCopy: string;
  footer?: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <span className="text-violet-glow">{icon}</span>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          {title}
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{emptyCopy}</p>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-2">
          {items.map((label, i) => (
            <li
              key={`${label}-${i}`}
              className="inline-flex rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs font-medium text-violet-glow"
            >
              {label}
            </li>
          ))}
        </ul>
      )}
      {footer}
    </section>
  );
}
