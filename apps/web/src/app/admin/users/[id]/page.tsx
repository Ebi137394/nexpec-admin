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
import {
  fetchInspectorDossier,
  fetchCanonicalCompleteness,
  type InspectorDossier,
} from '@/lib/data/adminInspector360';
import { UserRoleBadge } from '@/components/admin/users/UserRoleBadge';
import { UserModerationPanel } from '@/components/admin/users/UserModerationPanel';
import { UserRoleMessagePanel } from '@/components/admin/users/UserRoleMessagePanel';
import { AdminProfileEditor } from '@/components/admin/users/AdminProfileEditor';

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
  const isInspector =
    role === 'inspector' || role === 'contractor' || role === 'senior';

  // Inspector 360 — the professional evidence lives in tables and private
  // buckets outside `profiles`. Without this the page renders an empty
  // profile for an inspector who has actually submitted a CV and documents.
  const dossier: InspectorDossier | null = isInspector
    ? await fetchInspectorDossier(id, profile)
    : null;

  // Completeness comes from the SAME SQL rule onboarding and Telegram
  // /pending use, so the three can never disagree.
  const completeness = await fetchCanonicalCompleteness(id);
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

      {/* Profile readiness — the canonical rule, shared with onboarding,
          the reminder sweep and Telegram /pending. */}
      <Section title="Profile readiness">
        {!completeness.available ? (
          <p className="text-sm text-accent-red">
            Completeness could not be evaluated — the canonical rule
            (<code className="font-mono">nx_role_missing_fields</code>) did not
            respond. This is not the same as &ldquo;nothing is missing&rdquo;.
          </p>
        ) : completeness.complete ? (
          <p className="flex items-center gap-2 text-sm text-accent-green">
            <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
            Profile complete for the {profile.role ?? 'user'} role.
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm text-zinc-300">
              <AlertTriangle className="h-4 w-4 text-accent-amber" strokeWidth={1.75} />
              Missing: {completeness.humanLabel ?? completeness.missingFields.join(', ')}
            </p>
            <p className="mt-2 text-[11px] text-zinc-500">
              Filling any of these below removes it here, from onboarding
              reminders and from the Telegram incomplete-profiles queue at the
              same time — all three read this one rule.
            </p>
          </>
        )}
      </Section>

      {/* Admin-assisted profile completion (details sent by email / phone /
          Help & Support) + document filing. Cannot verify, suspend or
          re-role anyone — those stay in the moderation card above. */}
      <AdminProfileEditor profile={profile} isInspector={isInspector} />

      {/* Role correction + admin→user message (Command Console additions) */}
      <UserRoleMessagePanel
        userId={profile.id}
        email={profile.email}
        fullName={profile.full_name}
        role={profile.role}
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

          <Section title="Inspector, professional profile">
            <dl className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KV
                label="Professional title"
                value={profile.professional_title_effective}
              />
              <KV
                label="Years of experience"
                value={
                  profile.years_of_experience ??
                  (profile.experience_years ? `${profile.experience_years}` : null)
                }
              />
              <KV label="Specialties (free text)" value={profile.specialties} />
            </dl>
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

          {dossier && (
            <>
              {/* ── Verification, split into the four facts it actually is ── */}
              <Section title="Inspector, verification">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <KV
                    label="Account status"
                    value={dossier.verification.accountStatus ?? 'unknown'}
                  />
                  <KV
                    label="Account verification (admin decision)"
                    value={
                      dossier.verification.accountVerification
                        ? `${dossier.verification.accountVerification}${
                            dossier.verification.accountVerifiedAt
                              ? ` — ${formatDateTime(dossier.verification.accountVerifiedAt)}`
                              : ''
                          }`
                        : 'Not provided'
                    }
                  />
                  <KV
                    label="Identity verification (government ID)"
                    value={
                      dossier.verification.identityVerified
                        ? `Verified via ${dossier.verification.identitySource}`
                        : dossier.credential
                          ? 'Not verified — CCI application on file'
                          : 'Not submitted'
                    }
                  />
                  <KV
                    label="Professional credential verification"
                    value={
                      dossier.verification.credentialsTotal === 0
                        ? 'No credentials submitted'
                        : `${dossier.verification.credentialsVerified} of ${dossier.verification.credentialsTotal} reviewed and verified`
                    }
                  />
                  <KV
                    label="Marketplace readiness"
                    value={
                      dossier.verification.marketplaceActivated
                        ? 'Activated'
                        : 'Not activated'
                    }
                  />
                  <KV
                    label="Onboarding completed"
                    value={formatDateTime(profile.onboarding_completed_at)}
                  />
                </dl>
                <p className="mt-3 text-[11px] text-zinc-500">
                  These are independent. An admin marking the account verified
                  does not review any certificate, and a submitted certificate
                  is not verified until someone reviews it.
                </p>
              </Section>

              {/* ── CV ─────────────────────────────────────────────────── */}
              <Section title="Inspector, CV / resume">
                {dossier.resume.signedUrl ? (
                  <>
                    <ul className="flex flex-wrap gap-2">
                      <LinkChip
                        href={dossier.resume.signedUrl}
                        label="Open CV (signed, 5 min)"
                        external
                      />
                    </ul>
                    <p className="mt-2 font-mono text-[11px] break-all text-zinc-500">
                      {dossier.resume.path}
                    </p>
                  </>
                ) : dossier.resume.path ? (
                  <p className="text-sm text-accent-red">
                    A CV is recorded at{' '}
                    <code className="font-mono">{dossier.resume.path}</code> but
                    the signed URL could not be minted. The object may have been
                    removed from the <code>resumes</code> bucket.
                  </p>
                ) : dossier.resume.legacyUrl ? (
                  <>
                    <ul className="flex flex-wrap gap-2">
                      <LinkChip
                        href={dossier.resume.legacyUrl}
                        label="CV (legacy public URL)"
                        external
                      />
                    </ul>
                    <p className="mt-2 text-[11px] text-zinc-500">
                      Legacy column. The <code>resumes</code> bucket is private,
                      so this link is likely dead.
                    </p>
                  </>
                ) : (
                  <EmptyNote>Not provided — no CV has been uploaded.</EmptyNote>
                )}
              </Section>

              {/* ── Certifications ─────────────────────────────────────── */}
              <Section title={`Inspector, certifications (${dossier.certifications.length})`}>
                {dossier.certifications.length === 0 ? (
                  <EmptyNote>
                    Not provided — no certification records exist for this user.
                  </EmptyNote>
                ) : (
                  <ul className="space-y-3">
                    {dossier.certifications.map((c) => (
                      <li
                        key={c.id}
                        className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">
                            {c.title ?? 'Untitled certification'}
                          </span>
                          <CredentialStateChip
                            verified={c.isVerified}
                            status={c.status}
                          />
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <KV label="Issuing body" value={c.issuingOrganization} />
                          <KV label="Certificate no." value={c.credentialId} mono />
                          <KV label="Issued" value={formatDate(c.issueDate)} />
                          <KV label="Expires" value={formatDate(c.expiryDate)} />
                          {c.isVerified && (
                            <>
                              <KV label="Reviewed by" value={c.verifiedBy} mono />
                              <KV
                                label="Reviewed at"
                                value={formatDateTime(c.verifiedAt)}
                              />
                            </>
                          )}
                          {c.rejectionReason && (
                            <KV
                              label="Rejection reason"
                              value={c.rejectionReason}
                              colSpan
                            />
                          )}
                        </dl>
                        {c.fileUrl ? (
                          <ul className="mt-3 flex flex-wrap gap-2">
                            <LinkChip
                              href={c.fileUrl}
                              label="Open evidence (signed, 5 min)"
                              external
                            />
                          </ul>
                        ) : c.filePath ? (
                          <p className="mt-3 text-[11px] text-accent-red">
                            Evidence recorded at{' '}
                            <code className="font-mono">{c.filePath}</code> but
                            it could not be signed.
                          </p>
                        ) : (
                          <p className="mt-3 text-[11px] text-zinc-500">
                            No evidence file attached.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── Documents ──────────────────────────────────────────── */}
              <Section title={`Inspector, documents (${dossier.documents.length})`}>
                {dossier.documents.length === 0 ? (
                  <EmptyNote>
                    Not provided — no document records exist for this user.
                  </EmptyNote>
                ) : (
                  <ul className="space-y-3">
                    {dossier.documents.map((d) => (
                      <li
                        key={d.id}
                        className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-white">
                            {d.name ?? 'Untitled document'}
                          </span>
                          <CredentialStateChip
                            verified={d.status === 'approved' || d.status === 'verified'}
                            status={d.status}
                          />
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <KV label="Kind" value={d.kind} />
                          <KV label="Expires" value={formatDate(d.expiryDate)} />
                          <KV label="Uploaded" value={formatDateTime(d.createdAt)} />
                          <KV label="Reviewed" value={formatDateTime(d.reviewedAt)} />
                          {d.notes && <KV label="Notes" value={d.notes} colSpan />}
                        </dl>
                        {d.fileUrl ? (
                          <ul className="mt-3 flex flex-wrap gap-2">
                            <LinkChip
                              href={d.fileUrl}
                              label="Open document (signed, 5 min)"
                              external
                            />
                          </ul>
                        ) : (
                          <p className="mt-3 text-[11px] text-accent-red">
                            File could not be signed
                            {d.filePath ? (
                              <>
                                {' '}
                                (<code className="font-mono">{d.filePath}</code>)
                              </>
                            ) : null}
                            .
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── Work history ───────────────────────────────────────── */}
              <Section title={`Inspector, work history (${dossier.experience.length})`}>
                {dossier.experience.length === 0 ? (
                  <EmptyNote>
                    Not provided — no structured work-experience rows exist.
                    Employment history may still be described in the CV above.
                  </EmptyNote>
                ) : (
                  <ul className="space-y-3">
                    {dossier.experience.map((w) => (
                      <li
                        key={`${w.source}:${w.id}`}
                        className="rounded-2xl border border-white/[0.06] bg-white/[0.01] p-4"
                      >
                        <p className="text-sm font-semibold text-white">
                          {w.jobTitle ?? 'Role not stated'}
                          {w.companyName ? ` — ${w.companyName}` : ''}
                        </p>
                        <p className="mt-1 text-xs text-zinc-400">
                          {formatDate(w.startDate) ?? '?'} →{' '}
                          {formatDate(w.endDate) ?? 'present'}
                        </p>
                        {w.description && (
                          <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-300">
                            {w.description}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              {/* ── Declared capability + equipment ────────────────────── */}
              <Section title="Inspector, declared capability">
                <ChipGroup label="Skills (profile)" items={profile.skills} />
                <ChipGroup
                  label="Custom specialties"
                  items={profile.custom_specialties}
                />
                <ChipGroup
                  label="Custom NDT methods"
                  items={profile.custom_ndt_methods}
                  upper
                />
                {dossier.skills.length > 0 && (
                  <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {dossier.skills.map((s) => (
                      <KV
                        key={s.id}
                        label={s.category ?? 'Skill'}
                        value={[s.brandName, s.model, s.yearsExperience ? `${s.yearsExperience} yr` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      />
                    ))}
                  </dl>
                )}
                {dossier.equipment.length > 0 && (
                  <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {dossier.equipment.map((e) => (
                      <KV
                        key={e.id}
                        label={e.name ?? 'Equipment'}
                        value={[
                          e.serialNumber ? `S/N ${e.serialNumber}` : null,
                          e.calibrationExpiry
                            ? `cal. expires ${formatDate(e.calibrationExpiry)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      />
                    ))}
                  </dl>
                )}
                {profile.skills.length === 0 &&
                  profile.custom_specialties.length === 0 &&
                  profile.custom_ndt_methods.length === 0 &&
                  dossier.skills.length === 0 &&
                  dossier.equipment.length === 0 && (
                    <EmptyNote>Not provided.</EmptyNote>
                  )}
              </Section>

              {/* ── CCI credential application ─────────────────────────── */}
              {dossier.credential && (
                <Section title="Inspector, CCI credential application">
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <KV label="Tier" value={dossier.credential.tier} />
                    <KV label="Status" value={dossier.credential.status} />
                    <KV
                      label="Government ID verified"
                      value={dossier.credential.govIdVerified ? 'Yes' : 'No'}
                    />
                    <KV
                      label="ID issuing country"
                      value={dossier.credential.govIdIssuingCountry}
                    />
                    <KV
                      label="Documented experience"
                      value={
                        dossier.credential.experienceYearsDocumented !== null
                          ? `${dossier.credential.experienceYearsDocumented} yr`
                          : null
                      }
                    />
                    <KV
                      label="Applied"
                      value={formatDateTime(dossier.credential.appliedAt)}
                    />
                    <KV
                      label="Decided"
                      value={formatDateTime(dossier.credential.decidedAt)}
                    />
                    <KV
                      label="Expires"
                      value={formatDateTime(dossier.credential.expiresAt)}
                    />
                    {dossier.credential.decisionNotes && (
                      <KV
                        label="Decision notes"
                        value={dossier.credential.decisionNotes}
                        colSpan
                      />
                    )}
                  </dl>
                </Section>
              )}

              {/* An unreadable source must never look like an empty one. */}
              {dossier.unreadable.length > 0 && (
                <Section title="Inspector, unreadable sources">
                  <p className="text-sm text-accent-red">
                    These tables could not be read, so the sections above may be
                    incomplete:{' '}
                    <code className="font-mono">
                      {dossier.unreadable.join(', ')}
                    </code>
                    .
                  </p>
                </Section>
              )}
            </>
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
            href={`/admin/disputes?raisedBy=${profile.id}`}
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

/**
 * "Not provided" is a claim about the data, so say it only where the canonical
 * source really is empty. Anything we failed to READ is reported separately.
 */
function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-500">{children}</p>;
}

/**
 * Review state for one credential or document. Verified is rendered ONLY from
 * the row's own review columns — never inferred from a file being attached.
 */
function CredentialStateChip({
  verified,
  status,
}: {
  verified: boolean;
  status: string | null;
}) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-green">
        <CheckCircle2 className="h-3 w-3" strokeWidth={1.75} />
        Verified
      </span>
    );
  }
  const label = status && status.length > 0 ? status : 'unreviewed';
  const rejected = label === 'rejected';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial ${
        rejected
          ? 'border border-accent-red/30 bg-accent-red/10 text-accent-red'
          : 'bg-white/[0.04] text-zinc-400'
      }`}
    >
      {rejected ? (
        <AlertCircle className="h-3 w-3" strokeWidth={1.75} />
      ) : (
        <Clock className="h-3 w-3" strokeWidth={1.75} />
      )}
      {label}
    </span>
  );
}

/**
 * `profiles.verification_status` is an ADMIN decision about the ACCOUNT. It
 * carries no claim about professional credentials — an admin can set it in
 * one click without a single certificate having been reviewed. The chip
 * therefore says "Account verified", never a bare "Verified", which reads as
 * "this inspector's qualifications are confirmed". The credential facts live
 * in the "Inspector, verification" section.
 */
function VerificationChip({ status }: { status: string | null }) {
  if (status === 'verified') {
    return (
      <span
        title="Account verified by an admin. This says nothing about professional credentials."
        className="inline-flex items-center gap-1 rounded-full border border-accent-green/30 bg-accent-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-green"
      >
        <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
        Account verified
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
