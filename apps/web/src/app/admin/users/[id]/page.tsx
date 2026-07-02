// ════════════════════════════════════════════════════════════════════════════
//  app/admin/users/[id]/page.tsx — Admin user detail (read-only v1)
//
//  Comprehensive view of one profile. Admin is the only role that sees
//  the union of client-side AND inspector-side fields on a single user.
//  RLS allows this via nx_is_admin(); page double-checks at render time.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Star,
  Briefcase,
  FileText,
  AlertTriangle,
  Building2,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { fetchAdminUserDetail } from '@/lib/data/adminUserDetail';
import { UserRoleBadge } from '@/components/admin/users/UserRoleBadge';
import { UserModerationPanel } from '@/components/admin/users/UserModerationPanel';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `User, ${id.slice(0, 8)}, Admin` };
}

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; saved?: string }>;
}

export default async function AdminUserDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(`/admin/users/${id}`));

  const { data: isAdminData } = await supabase.rpc('nx_is_admin');
  if (!isAdminData) redirect('/');

  const profile = await fetchAdminUserDetail(id);
  if (!profile) {
    return (
      <div className="space-y-6">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to users
        </Link>
        <div className="rounded-3xl border border-dashed border-white/[0.08] bg-white/[0.01] p-12 text-center">
          <p className="text-sm text-zinc-300">User not found.</p>
          <p className="mt-1 text-xs text-zinc-500">
            The profile may have been deleted, or the ID is wrong.
          </p>
        </div>
      </div>
    );
  }

  const role = (profile.role ?? '').toLowerCase();
  const isInspector = role === 'inspector' || role === 'contractor';
  const isClientSide =
    role === 'client' || role === 'agency' || role === 'enterprise';

  // Build display name in two steps so we don't mix ?? and || in one
  // expression (JS spec forbids it without parens).
  const composedFromParts = `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim();
  const displayName =
    profile.full_name || composedFromParts || profile.email || 'Anonymous';

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <div>
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to users
        </Link>
      </div>

      {/* Identity header */}
      <header className="flex flex-col gap-6 rounded-3xl border border-white/[0.08] bg-gradient-to-b from-ink-800/60 to-ink-900/40 p-6 sm:flex-row sm:p-8">
        <div className="relative inline-flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet to-cyan-glow ring-2 ring-white/[0.06]">
          {profile.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt={displayName}
              width={96}
              height={96}
              className="h-full w-full object-cover"
              unoptimized
            />
          ) : (
            <span className="font-display text-3xl font-semibold text-white">
              {displayName.slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {displayName}
            </h1>
            <UserRoleBadge role={profile.role} />
            <VerificationChip status={profile.verification_status} />
          </div>
          {profile.headline && (
            <p className="mt-1 text-sm text-zinc-300">{profile.headline}</p>
          )}
          <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
            <Meta icon={<Mail className="h-3 w-3" />} label="Email" value={profile.email} mono />
            <Meta icon={<Phone className="h-3 w-3" />} label="Phone" value={profile.phone} mono />
            <Meta
              icon={<MapPin className="h-3 w-3" />}
              label="Location"
              value={
                profile.location_city || profile.location_province
                  ? [profile.location_city, profile.location_province]
                      .filter(Boolean)
                      .join(', ')
                  : profile.location
              }
            />
            <Meta
              icon={<Building2 className="h-3 w-3" />}
              label="Company"
              value={profile.company_name}
            />
            <Meta
              icon={<Calendar className="h-3 w-3" />}
              label="Joined"
              value={formatDate(profile.created_at)}
            />
            <Meta
              icon={<Clock className="h-3 w-3" />}
              label="Last active"
              value={formatDateTime(profile.last_active)}
            />
          </dl>
          <p className="mt-4 font-mono text-[10px] text-zinc-600">
            user.id  {profile.id}
          </p>
        </div>
      </header>

      {/* Activity tiles */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile
          label="Jobs, client"
          value={String(profile.counts.jobsAsClient)}
          icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
        />
        <Tile
          label="Jobs, inspector"
          value={String(profile.counts.jobsAsInspector)}
          icon={<Briefcase className="h-4 w-4" strokeWidth={1.75} />}
        />
        <Tile
          label="Applications"
          value={String(profile.counts.applications)}
          icon={<FileText className="h-4 w-4" strokeWidth={1.75} />}
        />
        <Tile
          label="Reviews received"
          value={String(profile.counts.reviewsReceived)}
          icon={<Star className="h-4 w-4" strokeWidth={1.75} />}
        />
        <Tile
          label="Disputes opened"
          value={String(profile.counts.disputesOpened)}
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />}
        />
      </section>

      {sp.error && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-red/30 bg-accent-red/10 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-accent-red" />
          <p className="text-sm text-accent-red">{sp.error}</p>
        </div>
      )}
      {sp.saved && (
        <div className="flex items-start gap-3 rounded-2xl border border-accent-green/30 bg-accent-green/10 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent-green" />
          <p className="text-sm text-accent-green">
            Action applied: <span className="font-mono">{sp.saved}</span>. The
            user has been notified.
          </p>
        </div>
      )}

      {/* Admin moderation actions */}
      <UserModerationPanel
        userId={profile.id}
        email={profile.email}
        role={profile.role}
        verificationStatus={profile.verification_status}
        currentStatus={profile.status ?? 'active'}
        suspensionReason={profile.suspension_reason}
        returnTo={`/admin/users/${profile.id}`}
      />

      {/* Bio */}
      {profile.bio && (
        <Section title="Bio">
          <p className="whitespace-pre-wrap text-sm text-zinc-300">{profile.bio}</p>
        </Section>
      )}

      {/* Verification + audit */}
      <Section title="Verification & audit">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KV label="Status" value={profile.verification_status} />
          <KV label="Verified at" value={formatDateTime(profile.verified_at)} />
          <KV label="Terms accepted" value={profile.terms_accepted ? 'Yes' : 'No'} />
          {profile.rejection_reason && (
            <KV
              label="Rejection reason"
              value={profile.rejection_reason}
              colSpan
            />
          )}
        </dl>
      </Section>

      {/* Aggregate stats */}
      <Section title="Marketplace stats">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KV
            label="Average rating"
            value={
              profile.rating_average !== null
                ? `${profile.rating_average.toFixed(2)} ★`
                : null
            }
          />
          <KV label="Rating count" value={profile.rating_count?.toString()} />
          <KV
            label="Recommend %"
            value={
              profile.recommend_percent !== null
                ? `${profile.recommend_percent}%`
                : null
            }
          />
          <KV
            label="Completed jobs"
            value={profile.completed_jobs_count?.toString()}
          />
        </dl>
      </Section>

      {/* Inspector-specific */}
      {isInspector && (
        <>
          <Section title="Inspector, rates & rules">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <KV
                label="Hourly rate"
                value={formatMoney(profile.hourly_rate_cents, profile.currency)}
              />
              <KV
                label="Travel rate / h"
                value={formatMoney(profile.travel_rate_cents, profile.currency)}
              />
              <KV label="Currency" value={profile.currency} />
              <KV
                label="Years experience"
                value={profile.years_of_experience}
              />
              <KV
                label="Overtime mult."
                value={profile.overtime_multiplier?.toString()}
              />
              <KV
                label="Weekend mult."
                value={profile.weekend_multiplier?.toString()}
              />
              <KV
                label="Holiday mult."
                value={profile.holiday_multiplier?.toString()}
              />
              <KV label="Payment terms" value={profile.payment_terms} />
              <KV
                label="Min engagement (h)"
                value={profile.minimum_engagement_hours?.toString()}
              />
              <KV
                label="Response (h)"
                value={profile.response_time_hours?.toString()}
              />
              <KV
                label="Travel radius (km)"
                value={profile.travel_radius_km?.toString()}
              />
              <KV label="Home base" value={profile.home_base_label} />
            </dl>
          </Section>

          <Section title="Inspector, skills">
            <ChipGroup label="Specialties" items={profile.specialty_slugs} />
            <ChipGroup label="NDT methods" items={profile.ndt_methods} upper />
            <ChipGroup
              label="Certifications (legacy text[])"
              items={profile.certifications}
            />
          </Section>

          <Section title="Inspector, jurisdiction">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KV
                label="Country of residence"
                value={profile.country_of_residence}
              />
              <KV
                label="Open to sponsored work"
                value={profile.open_to_sponsored_work ? 'Yes' : 'No'}
              />
              <KV
                label="Work-auth countries"
                value={
                  profile.work_authorized_countries.length > 0
                    ? profile.work_authorized_countries.join(', ')
                    : null
                }
                colSpan
              />
              <KV
                label="Sponsored countries"
                value={
                  profile.sponsored_countries.length > 0
                    ? profile.sponsored_countries.join(', ')
                    : null
                }
                colSpan
              />
            </dl>
          </Section>

          <Section title="Inspector, payouts (GR2, admin view)">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KV
                label="Balance"
                value={formatMoney(profile.balance_cents, profile.currency)}
              />
              <KV
                label="Stripe Connect status"
                value={profile.stripe_connect_status}
              />
              <KV
                label="Payouts enabled"
                value={profile.stripe_connect_payouts_enabled ? 'Yes' : 'No'}
              />
              <KV
                label="Stripe Connect ID"
                value={profile.stripe_connect_id}
                mono
                colSpan
              />
              <KV
                label="Onboarded at"
                value={formatDateTime(profile.stripe_connect_onboarded_at)}
              />
            </dl>
          </Section>

          {(profile.resume_url || profile.cv_url) && (
            <Section title="Inspector, resume / CV">
              <ul className="flex flex-wrap gap-2">
                {profile.resume_url && (
                  <LinkChip href={profile.resume_url} label="Resume (legacy URL)" />
                )}
                {profile.cv_url && profile.cv_url !== profile.resume_url && (
                  <LinkChip href={profile.cv_url} label="CV" />
                )}
              </ul>
              <p className="mt-2 text-[11px] text-zinc-500">
                Newer uploads land in the private <code>resumes</code> bucket
                via <code>resume_path</code>. This view shows the legacy public
                URLs only, open the user&apos;s settings page on their portal
                to see the signed-URL version.
              </p>
            </Section>
          )}
        </>
      )}

      {/* Client-specific */}
      {isClientSide && (
        <Section title="Client, branding">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KV
              label="Custom branding"
              value={profile.use_custom_branding ? 'Enabled' : 'Disabled'}
            />
            <KV
              label="Company logo"
              value={
                profile.company_logo_url ? 'Uploaded' : 'Default NEXPEC mark'
              }
            />
            <KV label="Organization" value={profile.organization_id} mono />
            <KV
              label="Report header text"
              value={profile.report_header_text}
              colSpan
            />
            <KV
              label="Report footer text"
              value={profile.report_footer_text}
              colSpan
            />
          </dl>
          {profile.company_logo_url && (
            <div className="mt-4">
              <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
                Logo preview
              </p>
              <Image
                src={profile.company_logo_url}
                alt="logo"
                width={120}
                height={60}
                className="mt-2 rounded-lg border border-white/10 bg-white/[0.04] p-2"
                unoptimized
              />
            </div>
          )}
        </Section>
      )}

      {/* Cross-links */}
      <Section title="Drill in">
        <div className="flex flex-wrap gap-2">
          <LinkChip
            href={`/admin/jobs?client_id=${profile.id}`}
            label="Jobs they posted"
          />
          <LinkChip
            href={`/admin/jobs?inspect=${profile.id}`}
            label="Jobs they're assigned to"
          />
          <LinkChip
            href={`/admin/disputes?opener_id=${profile.id}`}
            label="Disputes they opened"
          />
          <LinkChip
            href={`/admin/messages?user_id=${profile.id}`}
            label="Their conversations"
          />
          <LinkChip
            href={`/p/${profile.id}`}
            label="Public profile (/p/[userId])"
            external
          />
          <LinkChip
            href={`/admin/audit?subject_id=${profile.id}`}
            label="Audit events"
          />
        </div>
      </Section>
    </div>
  );
}

/* ─── presentational pieces ─────────────────────────────────────────── */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
      <h2 className="mb-4 font-display text-lg font-semibold tracking-tight text-white">
        {title}
      </h2>
      {children}
    </section>
  );
}

function KV({
  label,
  value,
  mono,
  colSpan,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  colSpan?: boolean;
}) {
  return (
    <div className={colSpan ? 'sm:col-span-full' : ''}>
      <dt className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm text-zinc-200 ${mono ? 'font-mono break-all' : ''}`}
      >
        {value === null || value === undefined || value === '' ? (
          <span className="text-zinc-600">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function Meta({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        <span className="text-violet-glow">{icon}</span>
        {label}
      </dt>
      <dd
        className={`mt-1 text-[12px] text-zinc-300 ${mono ? 'font-mono break-all' : ''}`}
      >
        {value || <span className="text-zinc-600">—</span>}
      </dd>
    </div>
  );
}

function Tile({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        <span className="text-violet-glow">{icon}</span>
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function VerificationChip({ status }: { status: string | null }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
        <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
        Verified
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-cyan-glow">
        <Clock className="h-3 w-3" strokeWidth={1.75} />
        Pending
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-accent-red/30 bg-accent-red/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-red">
        <ShieldAlert className="h-3 w-3" strokeWidth={1.75} />
        Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
      Unverified
    </span>
  );
}

function ChipGroup({
  label,
  items,
  upper,
}: {
  label: string;
  items: string[];
  upper?: boolean;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-zinc-600">—</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <li
              key={`${item}-${i}`}
              className="inline-flex rounded-full border border-violet/30 bg-violet/10 px-2 py-0.5 text-[11px] text-violet-glow"
            >
              {upper ? item.toUpperCase() : item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LinkChip({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  const className =
    'inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white';
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={className}>
        {label}
        <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}

/* ─── format helpers ─────────────────────────────────────────────────── */

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatMoney(
  cents: number | null,
  currency: string | null,
): string | null {
  if (cents === null || cents === undefined) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: (currency || 'USD').toUpperCase(),
      maximumFractionDigits: 0,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? 'USD'}`;
  }
}
