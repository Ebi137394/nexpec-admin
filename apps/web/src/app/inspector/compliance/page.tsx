// ════════════════════════════════════════════════════════════════════════════
//  app/inspector/compliance/page.tsx — Inspector compliance dossier
//
//  Three CRUD-capable sections stacked on top of the existing read-only
//  verification banner & chip clouds:
//
//    1. Personal documents (ID, work permit, insurance, safety tickets…)
//       with file upload + expiry tracking.
//    2. Equipment + calibration (gauges, UT thickness probes, RT cameras…)
//       with last/next calibration dates + optional cert file.
//    3. Certifications (CSWIP, CWI, PCN…) with issuer, expiry, cert file.
//
//  Each list shows expiry badges (expired / 30-day warn / ok). Forms are
//  inline below each list and POST to server actions in lib/actions/*.
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
  FileText,
  Wrench,
  BadgeCheck,
  Upload,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import { fetchInspectorProfile } from '@/lib/data/inspectorProfile';
import type { VerificationStatus } from '@/lib/data/inspectorProfile.types';
import { fetchInspectorDocuments } from '@/lib/data/inspectorDocuments';
import { fetchInspectorEquipment } from '@/lib/data/inspectorEquipment';
import { fetchInspectorCertifications } from '@/lib/data/inspectorCertifications';
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABELS,
} from '@/lib/data/inspectorDocuments.types';
import {
  createInspectorDocument,
  deleteInspectorDocument,
} from '@/lib/actions/inspectorDocuments';
import {
  createInspectorEquipment,
  deleteInspectorEquipment,
} from '@/lib/actions/inspectorEquipment';
import {
  createInspectorCertification,
  deleteInspectorCertification,
} from '@/lib/actions/inspectorCertifications';

export const metadata: Metadata = {
  title: 'Compliance',
};

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams?: Promise<{
    error?: string;
    saved?: string;
    deleted?: string;
    section?: string;
  }>;
}

export default async function InspectorCompliancePage({
  searchParams,
}: PageProps) {
  const sp = (await searchParams) ?? {};
  const [profile, documents, equipment, certifications] = await Promise.all([
    fetchInspectorProfile(),
    fetchInspectorDocuments(),
    fetchInspectorEquipment(),
    fetchInspectorCertifications(),
  ]);
  if (!profile) redirect('/inspector/dashboard');

  const flash = sp.error
    ? { kind: 'error' as const, msg: sp.error, section: sp.section }
    : sp.saved
      ? { kind: 'saved' as const, msg: 'Saved.', section: sp.section }
      : sp.deleted
        ? { kind: 'deleted' as const, msg: 'Deleted.', section: sp.section }
        : null;

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
            Your verification status plus a live dossier of personal
            documents, owned equipment with calibration tracking, and
            third-party certifications. Files are private — only you and
            our ops team can access them.
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

      {flash && <FlashBanner kind={flash.kind} msg={flash.msg} />}

      <VerificationCard
        status={profile.verificationStatus}
        verifiedAt={profile.verifiedAt}
        rejectionReason={profile.rejectionReason}
      />

      {/* ─── Personal documents ─────────────────────────────────────────── */}
      <DossierSection
        title="Personal documents"
        icon={<FileText className="h-4 w-4" strokeWidth={1.75} />}
        helper="Government ID, work permits, insurance, safety tickets, medical fit-for-duty, background checks."
      >
        {documents.length === 0 ? (
          <EmptyHint>No documents on file yet. Add one below.</EmptyHint>
        ) : (
          <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {doc.label}
                    </span>
                    <span className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
                      {DOCUMENT_KIND_LABELS[doc.kind]}
                    </span>
                    <ExpiryBadge dateIso={doc.expiresAt} />
                  </div>
                  {doc.notes && (
                    <p className="mt-1 text-xs text-zinc-500">{doc.notes}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {doc.fileUrl && (
                    <a
                      href={doc.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
                    >
                      View
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  )}
                  <DeleteForm
                    action={deleteInspectorDocument}
                    id={doc.id}
                    label="Delete document"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="mt-6 group">
          <summary className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/20">
            <Upload className="h-3 w-3" strokeWidth={1.75} />
            Add document
          </summary>
          <form
            action={createInspectorDocument}
            encType="multipart/form-data"
            className="mt-4 grid gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5 sm:grid-cols-2"
          >
            <Field label="Kind">
              <select
                name="kind"
                defaultValue="id_card"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none transition-colors focus:border-violet/40"
              >
                {DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k} className="bg-ink-900">
                    {DOCUMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Label">
              <input
                name="label"
                required
                maxLength={120}
                placeholder="e.g. Ontario driver's licence"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <Field label="Expires (optional)">
              <input
                name="expiresAt"
                type="date"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
              />
            </Field>
            <Field label="File (PDF / JPG / PNG)">
              <input
                name="file"
                type="file"
                required
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-violet/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-violet-glow hover:file:bg-violet/25"
              />
            </Field>
            <Field label="Notes (optional)" className="sm:col-span-2">
              <input
                name="notes"
                maxLength={500}
                placeholder="Issuer, reference number, anything our ops team should know"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton label="Upload document" />
            </div>
          </form>
        </details>
      </DossierSection>

      {/* ─── Equipment + calibration ───────────────────────────────────── */}
      <DossierSection
        title="Equipment & calibration"
        icon={<Wrench className="h-4 w-4" strokeWidth={1.75} />}
        helper="Owned or operated gear with calibration tracking. We surface next-due dates to ops so jobs aren't dispatched on expired equipment."
      >
        {equipment.length === 0 ? (
          <EmptyHint>No equipment listed yet.</EmptyHint>
        ) : (
          <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
            {equipment.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {e.name}
                    </span>
                    {e.manufacturer && (
                      <span className="text-xs text-zinc-500">
                        · {e.manufacturer}
                        {e.modelNumber ? ` ${e.modelNumber}` : ''}
                      </span>
                    )}
                    <ExpiryBadge
                      dateIso={e.nextCalibrationDue}
                      verb="calibration due"
                    />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {e.serialNumber && (
                      <span className="font-mono">S/N {e.serialNumber}</span>
                    )}
                    {e.lastCalibrationAt && (
                      <span>
                        {e.serialNumber ? ' · ' : ''}
                        Last calibrated{' '}
                        {new Date(e.lastCalibrationAt).toLocaleDateString()}
                      </span>
                    )}
                    {e.notes && <span> · {e.notes}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {e.calibrationCertificateUrl && (
                    <a
                      href={e.calibrationCertificateUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
                    >
                      Cert
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  )}
                  <DeleteForm
                    action={deleteInspectorEquipment}
                    id={e.id}
                    label="Delete equipment"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="mt-6 group">
          <summary className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/20">
            <Upload className="h-3 w-3" strokeWidth={1.75} />
            Add equipment
          </summary>
          <form
            action={createInspectorEquipment}
            encType="multipart/form-data"
            className="mt-4 grid gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5 sm:grid-cols-2"
          >
            <Field label="Name" className="sm:col-span-2">
              <input
                name="name"
                required
                maxLength={120}
                placeholder="e.g. Olympus EPOCH 650 UT flaw detector"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <Field label="Manufacturer">
              <input
                name="manufacturer"
                maxLength={80}
                placeholder="Olympus"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <Field label="Model number">
              <input
                name="modelNumber"
                maxLength={80}
                placeholder="EPOCH 650"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <Field label="Serial number">
              <input
                name="serialNumber"
                maxLength={80}
                placeholder="123A-4567"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <Field label="Last calibration">
              <input
                name="lastCalibrationAt"
                type="date"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
              />
            </Field>
            <Field label="Next calibration due">
              <input
                name="nextCalibrationDue"
                type="date"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
              />
            </Field>
            <Field label="Calibration certificate (optional)" className="sm:col-span-2">
              <input
                name="certificate"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-violet/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-violet-glow hover:file:bg-violet/25"
              />
            </Field>
            <Field label="Notes (optional)" className="sm:col-span-2">
              <input
                name="notes"
                maxLength={500}
                placeholder="Calibration body, traceability reference, etc."
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton label="Save equipment" />
            </div>
          </form>
        </details>
      </DossierSection>

      {/* ─── Certifications (proper table) ─────────────────────────────── */}
      <DossierSection
        title="Certifications"
        icon={<BadgeCheck className="h-4 w-4" strokeWidth={1.75} />}
        helper="Third-party certifications with issuer, cert number, and expiry. Upload the certificate file so ops can verify without back-and-forth."
      >
        {certifications.length === 0 ? (
          <EmptyHint>No certifications listed yet.</EmptyHint>
        ) : (
          <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.01]">
            {certifications.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-white">
                      {c.name}
                    </span>
                    {c.issuingBody && (
                      <span className="text-xs text-zinc-500">
                        · {c.issuingBody}
                      </span>
                    )}
                    <ExpiryBadge dateIso={c.expiresAt} />
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">
                    {c.certificateNumber && (
                      <span className="font-mono">#{c.certificateNumber}</span>
                    )}
                    {c.issuedAt && (
                      <span>
                        {c.certificateNumber ? ' · ' : ''}
                        Issued {new Date(c.issuedAt).toLocaleDateString()}
                      </span>
                    )}
                    {c.notes && <span> · {c.notes}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.certificateUrl && (
                    <a
                      href={c.certificateUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-200 transition-colors hover:border-violet/40 hover:bg-white/[0.04] hover:text-white"
                    >
                      Cert
                      <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
                    </a>
                  )}
                  <DeleteForm
                    action={deleteInspectorCertification}
                    id={c.id}
                    label="Delete certification"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <details className="mt-6 group">
          <summary className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/20">
            <Upload className="h-3 w-3" strokeWidth={1.75} />
            Add certification
          </summary>
          <form
            action={createInspectorCertification}
            encType="multipart/form-data"
            className="mt-4 grid gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.01] p-5 sm:grid-cols-2"
          >
            <Field label="Name" className="sm:col-span-2">
              <input
                name="name"
                required
                maxLength={160}
                placeholder="e.g. CSWIP 3.1 Welding Inspector"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <Field label="Issuing body">
              <input
                name="issuingBody"
                maxLength={120}
                placeholder="TWI / BINDT / API / CGSB"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <Field label="Certificate number">
              <input
                name="certificateNumber"
                maxLength={120}
                placeholder="98765-XYZ"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <Field label="Issued">
              <input
                name="issuedAt"
                type="date"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
              />
            </Field>
            <Field label="Expires">
              <input
                name="expiresAt"
                type="date"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none focus:border-violet/40"
              />
            </Field>
            <Field label="Certificate file (optional)" className="sm:col-span-2">
              <input
                name="certificate"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                className="w-full text-xs text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-violet/15 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-violet-glow hover:file:bg-violet/25"
              />
            </Field>
            <Field label="Notes (optional)" className="sm:col-span-2">
              <input
                name="notes"
                maxLength={500}
                placeholder="Endorsements, level, scope of certification"
                className="w-full rounded-lg border border-white/[0.08] bg-ink-900/60 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-violet/40"
              />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton label="Save certification" />
            </div>
          </form>
        </details>
      </DossierSection>

      {/* ─── Existing read-only chip clouds (back-compat) ─────────────── */}

      <DossierSection
        title="Legacy certification tags"
        icon={<Award className="h-4 w-4" strokeWidth={1.75} />}
        helper="Free-form chips from your existing profile. Edit in settings — comma-separated."
      >
        {profile.certifications.length === 0 ? (
          <EmptyHint>No tags yet — add detailed certs above for verification.</EmptyHint>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {profile.certifications.map((label, i) => (
              <li
                key={`${label}-${i}`}
                className="inline-flex rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs font-medium text-violet-glow"
              >
                {label}
              </li>
            ))}
          </ul>
        )}
      </DossierSection>

      <DossierSection
        title="NDT methods"
        icon={<ScanLine className="h-4 w-4" strokeWidth={1.75} />}
        helper="The NDT methods you're qualified to perform. Edit in settings."
      >
        {profile.ndtMethods.length === 0 ? (
          <EmptyHint>No NDT methods set. Pick from the chip grid in settings.</EmptyHint>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {profile.ndtMethods.map((m) => m.toUpperCase()).map((label) => (
              <li
                key={label}
                className="inline-flex rounded-full border border-cyan-glow/30 bg-cyan-glow/10 px-3 py-1 text-xs font-medium text-cyan-glow"
              >
                {label}
              </li>
            ))}
          </ul>
        )}
      </DossierSection>

      <DossierSection
        title="Work authorization"
        icon={<Globe2 className="h-4 w-4" strokeWidth={1.75} />}
        helper="Inspections in jurisdictions outside your list won't appear in your feed. Edit in settings."
      >
        {profile.workAuthorizedCountries.length === 0 ? (
          <EmptyHint>No country codes set.</EmptyHint>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {profile.workAuthorizedCountries.map((c) => c.toUpperCase()).map((label) => (
              <li
                key={label}
                className="inline-flex rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs font-medium text-violet-glow"
              >
                {label}
              </li>
            ))}
          </ul>
        )}
        {profile.openToSponsoredWork && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-accent-amber/30 bg-accent-amber/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-industrial text-accent-amber">
            <Globe2 className="h-3 w-3" strokeWidth={1.75} />
            Open to sponsored work · {profile.sponsoredCountries.length}{' '}
            sponsored countries
          </p>
        )}
      </DossierSection>
    </div>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────── */

function FlashBanner({
  kind,
  msg,
}: {
  kind: 'error' | 'saved' | 'deleted';
  msg: string;
}) {
  const tone =
    kind === 'error'
      ? 'border-accent-red/40 bg-accent-red/10 text-accent-red'
      : 'border-accent-green/40 bg-accent-green/10 text-accent-green';
  return (
    <div
      role="status"
      className={`rounded-xl border px-4 py-3 text-sm ${tone}`}
    >
      {msg}
    </div>
  );
}

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
            Upload your documents, equipment, and certifications below.
            Verification reviews go faster on a fully-filled dossier.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/contact?channel=support"
              className="inline-flex items-center gap-2 rounded-full border border-violet/30 bg-violet/10 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow hover:bg-violet/20"
            >
              <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
              Request verification
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function DossierSection({
  title,
  icon,
  helper,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  helper: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-3xl border border-white/[0.06] bg-white/[0.01] p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <span className="text-violet-glow">{icon}</span>
        <h2 className="font-display text-lg font-semibold tracking-tight text-white">
          {title}
        </h2>
      </div>
      <p className="mt-1.5 max-w-2xl text-xs text-zinc-500">{helper}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-6 text-sm text-zinc-500">
      {children}
    </p>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ''}`}>
      <span className="text-[11px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function SubmitButton({ label }: { label: string }) {
  return (
    <button
      type="submit"
      className="inline-flex items-center gap-2 rounded-full bg-violet px-5 py-2.5 text-xs font-semibold uppercase tracking-industrial text-white shadow-sm transition-colors hover:bg-violet/90"
    >
      <Upload className="h-3 w-3" strokeWidth={1.75} />
      {label}
    </button>
  );
}

function DeleteForm({
  action,
  id,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  label: string;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={label}
        className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
      >
        <Trash2 className="h-3 w-3" strokeWidth={1.75} />
        Delete
      </button>
    </form>
  );
}

function ExpiryBadge({
  dateIso,
  verb = 'expires',
}: {
  dateIso: string | null;
  verb?: 'expires' | 'calibration due';
}) {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const days = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) {
    return (
      <span className="rounded-full border border-accent-red/40 bg-accent-red/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-red">
        {verb === 'expires' ? 'Expired' : 'Calibration overdue'}
      </span>
    );
  }
  if (days <= 30) {
    return (
      <span className="rounded-full border border-accent-amber/40 bg-accent-amber/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-accent-amber">
        {verb} in {days}d
      </span>
    );
  }
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
      {verb} {d.toLocaleDateString()}
    </span>
  );
}
