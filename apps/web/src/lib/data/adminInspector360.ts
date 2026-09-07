// ════════════════════════════════════════════════════════════════════════════
//  lib/data/adminInspector360.ts — the inspector dossier behind Admin 360
//
//  WHY THIS EXISTS
//  ───────────────
//  fetchAdminUserDetail() reads `profiles` and nothing else. Every piece of
//  professional evidence an inspector actually submits lives somewhere else:
//
//    • the CV file          → storage bucket `resumes`, path in
//                             profiles.resume_path (NOT resume_url — that is a
//                             legacy public-URL column and the bucket is
//                             private, so a value there would be a dead link)
//    • certificates         → table `certifications`  (+ bucket `certifications`)
//    • compliance documents → table `inspector_documents` (+ bucket `inspector-docs`)
//    • work history         → tables `work_experience` / `inspector_work_experience`
//    • equipment            → tables `equipment` / `inspector_equipment`
//    • declared capability  → table `inspector_skills`
//    • CCI application      → table `inspector_credentials`
//
//  Because the admin page queried none of them, a real inspector who had
//  uploaded a CV showed as an empty profile. This module closes that gap.
//
//  AUTHORIZATION
//  ─────────────
//  Everything runs through the caller's own server session. Each table carries
//  an `nx_is_admin()` policy and each bucket an owner-or-admin SELECT policy,
//  so RLS — not this file — is what grants access. No service-role key is used
//  and no bucket is made public: file links are short-lived signed URLs minted
//  at render time. Call this only from a page that has already checked
//  nx_is_admin(); the RLS layer is the real boundary, this is defence in depth.
//
//  DUPLICATE TABLE FAMILIES
//  ────────────────────────
//  Production carries both a legacy and an `inspector_`-prefixed variant of
//  several tables (certifications/inspector_certifications,
//  work_experience/inspector_work_experience, equipment/inspector_equipment).
//  The legacy ones are the live system of record — they hold the rows; the
//  prefixed ones are empty. We read BOTH and merge, so the dossier stays
//  correct whichever side a write lands on, and keeps working if the
//  canonical side is ever backfilled.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Signed links are short-lived; the admin re-renders to get a fresh one. */
const SIGNED_URL_TTL_SECONDS = 300;

const RESUME_BUCKET = 'resumes';
const CERT_BUCKET = 'certifications';
const DOC_BUCKET = 'inspector-docs';

export interface DossierCertification {
  id: string;
  title: string | null;
  issuingOrganization: string | null;
  credentialId: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  /** Raw review state from the row. Never inferred from the file existing. */
  status: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  rejectionReason: string | null;
  createdAt: string | null;
  /** Short-lived signed URL, or null when there is no file / signing failed. */
  fileUrl: string | null;
  filePath: string | null;
}

export interface DossierDocument {
  id: string;
  name: string | null;
  kind: string | null;
  status: string | null;
  expiryDate: string | null;
  notes: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string | null;
  fileUrl: string | null;
  filePath: string | null;
}

export interface DossierExperience {
  id: string;
  companyName: string | null;
  jobTitle: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string | null;
  source: 'work_experience' | 'inspector_work_experience';
}

export interface DossierSkill {
  id: string;
  category: string | null;
  brandName: string | null;
  model: string | null;
  yearsExperience: number | null;
}

export interface DossierEquipment {
  id: string;
  name: string | null;
  serialNumber: string | null;
  calibrationExpiry: string | null;
  status: string | null;
}

export interface DossierCredential {
  id: string;
  tier: string | null;
  status: string | null;
  govIdVerified: boolean | null;
  govIdIssuingCountry: string | null;
  experienceYearsDocumented: number | null;
  appliedAt: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  expiresAt: string | null;
}

/**
 * Four independent verification facts. They are deliberately NOT collapsed
 * into one badge: `profiles.verification_status` is set by an admin acting on
 * the account and says nothing about whether any professional credential was
 * ever reviewed.
 */
export interface VerificationBreakdown {
  /** Account lifecycle: active / suspended / deleted. */
  accountStatus: string | null;
  /** profiles.verification_status — an ADMIN account decision. */
  accountVerification: string | null;
  accountVerifiedAt: string | null;
  /** Government-ID check, from the CCI credential application only. */
  identityVerified: boolean;
  identitySource: string | null;
  /** Credentials that passed review, out of those submitted. */
  credentialsVerified: number;
  credentialsTotal: number;
  /** profiles.marketplace_activated — the commercial gate. */
  marketplaceActivated: boolean;
}

export interface InspectorDossier {
  resume: { path: string | null; signedUrl: string | null; legacyUrl: string | null };
  certifications: DossierCertification[];
  documents: DossierDocument[];
  experience: DossierExperience[];
  skills: DossierSkill[];
  equipment: DossierEquipment[];
  credential: DossierCredential | null;
  verification: VerificationBreakdown;
  /**
   * Tables that could not be read (missing on this deployment, or RLS said
   * no). Surfaced in the UI so an empty section is never silently confused
   * with "the user submitted nothing".
   */
  unreadable: string[];
}

/**
 * Canonical profile completeness. Deliberately a thin wrapper over the SAME
 * SQL functions onboarding, the reminder sweep and Telegram /pending use —
 * `nx_role_missing_fields` and `nx_missing_fields_label`. Re-deriving
 * completeness in TypeScript would let Admin and onboarding disagree, which
 * is exactly the failure mode this page is supposed to end.
 *
 * Both are SECURITY DEFINER and take the subject's id, so an admin gets the
 * subject's answer, not their own.
 */
export async function fetchCanonicalCompleteness(userId: string): Promise<{
  missingFields: string[];
  humanLabel: string | null;
  complete: boolean;
  available: boolean;
}> {
  try {
    const supabase = await createSupabaseServerClient();
    const [fieldsRes, labelRes] = await Promise.all([
      supabase.rpc('nx_role_missing_fields', { p_user_id: userId }),
      supabase.rpc('nx_missing_fields_label', { p_user_id: userId }),
    ]);
    if (fieldsRes.error) {
      if (typeof console !== 'undefined') {
        console.warn(
          '[fetchCanonicalCompleteness] unavailable:',
          fieldsRes.error.message,
        );
      }
      return { missingFields: [], humanLabel: null, complete: false, available: false };
    }
    const missing = Array.isArray(fieldsRes.data) ? (fieldsRes.data as string[]) : [];
    return {
      missingFields: missing,
      humanLabel: typeof labelRes.data === 'string' ? labelRes.data : null,
      complete: missing.length === 0,
      available: true,
    };
  } catch {
    return { missingFields: [], humanLabel: null, complete: false, available: false };
  }
}

/** Row shape we get back from PostgREST before narrowing. */
type Row = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Read a table, returning [] plus a note when it cannot be read. A missing
 * table or an RLS refusal must never take the whole page down — but it must
 * also never look like an empty result.
 */
async function safeSelect(
  supabase: Supa,
  table: string,
  columns: string,
  filter: Record<string, string>,
  unreadable: string[],
): Promise<Row[]> {
  try {
    let q = supabase.from(table).select(columns);
    for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) {
      unreadable.push(table);
      if (typeof console !== 'undefined') {
        console.warn(`[adminInspector360] ${table} unreadable:`, error.message);
      }
      return [];
    }
    return (data ?? []) as unknown as Row[];
  } catch (e) {
    unreadable.push(table);
    if (typeof console !== 'undefined') {
      console.warn(`[adminInspector360] ${table} threw:`, e);
    }
    return [];
  }
}

/**
 * Mint a short-lived signed URL. Returns null rather than throwing so one
 * unreadable object cannot blank the rest of the dossier.
 */
async function sign(
  supabase: Supa,
  bucket: string,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  // Legacy rows store a full URL rather than an object path — some are
  // long-lived signed URLs that still resolve. Hand those back untouched:
  // createSignedUrl would reject them, and reporting "could not be signed"
  // for a link that actually opens is worse than just offering the link.
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Build the full professional dossier for one inspector.
 *
 * `profileRow` carries the handful of `profiles` columns the verification
 * breakdown needs, so we do not re-query a row the caller already holds.
 */
export async function fetchInspectorDossier(
  userId: string,
  profileRow: {
    resume_path?: string | null;
    resume_url?: string | null;
    cv_url?: string | null;
    verification_status?: string | null;
    verified_at?: string | null;
    status?: string | null;
    marketplace_activated?: boolean | null;
  },
): Promise<InspectorDossier> {
  const supabase = await createSupabaseServerClient();
  const unreadable: string[] = [];

  const [
    certRows,
    docRows,
    weLegacy,
    weCanonical,
    skillRows,
    eqLegacy,
    eqCanonical,
    credRows,
  ] = await Promise.all([
    safeSelect(
      supabase,
      'certifications',
      'id, title, name, issuing_organization, issuing_org, issued_by, credential_id, issue_date, expiry_date, status, is_verified, verified, verified_at, verified_by, rejection_reason, created_at, file_url',
      { user_id: userId },
      unreadable,
    ),
    safeSelect(
      supabase,
      'inspector_documents',
      'id, doc_name, kind, status, expiry_date, notes, reviewed_at, reviewed_by, created_at, file_url, file_path',
      { inspector_id: userId },
      unreadable,
    ),
    safeSelect(
      supabase,
      'work_experience',
      'id, company_name, job_title, start_date, end_date, description',
      { user_id: userId },
      unreadable,
    ),
    // NOTE the different shape: the canonical table is keyed by inspector_id
    // and names its columns `company` / `title`, not user_id / company_name /
    // job_title like the legacy one. Selecting the legacy names here returns
    // a 400, not an empty list.
    safeSelect(
      supabase,
      'inspector_work_experience',
      'id, company, title, start_date, end_date, description',
      { inspector_id: userId },
      unreadable,
    ),
    safeSelect(
      supabase,
      'inspector_skills',
      'id, category, brand_name, model, years_experience',
      { user_id: userId },
      unreadable,
    ),
    safeSelect(
      supabase,
      'equipment',
      'id, name, serial_number, calibration_expiry, status',
      { inspector_id: userId },
      unreadable,
    ),
    // Again a different shape: calibration expiry is `next_calibration_due`
    // and there is no `status` column on the canonical table.
    safeSelect(
      supabase,
      'inspector_equipment',
      'id, name, serial_number, next_calibration_due',
      { inspector_id: userId },
      unreadable,
    ),
    safeSelect(
      supabase,
      'inspector_credentials',
      'id, tier, status, gov_id_verified, gov_id_issuing_country, experience_years_documented, applied_at, decided_at, decision_notes, expires_at',
      { inspector_id: userId },
      unreadable,
    ),
  ]);

  // ── CV ────────────────────────────────────────────────────────────────
  // resume_path is the live column (private bucket, signed at read time).
  // resume_url / cv_url are legacy public-URL columns kept only so an old
  // row still shows something.
  const resumePath = str(profileRow.resume_path);
  const resumeSigned = await sign(supabase, RESUME_BUCKET, resumePath);

  // ── Certifications ────────────────────────────────────────────────────
  const certifications: DossierCertification[] = await Promise.all(
    certRows.map(async (c) => {
      const filePath = str(c.file_url);
      return {
        id: String(c.id),
        // The table carries both `title` and the NOT NULL `name`; mobile
        // writes both, older rows only `name`.
        title: str(c.title) ?? str(c.name),
        issuingOrganization:
          str(c.issuing_organization) ?? str(c.issuing_org) ?? str(c.issued_by),
        credentialId: str(c.credential_id),
        issueDate: str(c.issue_date),
        expiryDate: str(c.expiry_date),
        status: str(c.status),
        // Verified only when the review columns say so. A file being present
        // is evidence, never a verdict.
        isVerified: bool(c.is_verified) || bool(c.verified),
        verifiedAt: str(c.verified_at),
        verifiedBy: str(c.verified_by),
        rejectionReason: str(c.rejection_reason),
        createdAt: str(c.created_at),
        fileUrl: await sign(supabase, CERT_BUCKET, filePath),
        filePath,
      };
    }),
  );

  // ── Documents ─────────────────────────────────────────────────────────
  const documents: DossierDocument[] = await Promise.all(
    docRows.map(async (d) => {
      // Mobile stores the object path in file_url; file_path is the newer
      // column. Prefer whichever is populated.
      const filePath = str(d.file_path) ?? str(d.file_url);
      return {
        id: String(d.id),
        name: str(d.doc_name),
        kind: str(d.kind),
        status: str(d.status),
        expiryDate: str(d.expiry_date),
        notes: str(d.notes),
        reviewedAt: str(d.reviewed_at),
        reviewedBy: str(d.reviewed_by),
        createdAt: str(d.created_at),
        fileUrl: await sign(supabase, DOC_BUCKET, filePath),
        filePath,
      };
    }),
  );

  // ── Work history (merge both families, legacy first) ───────────────────
  const experience: DossierExperience[] = [
    ...weLegacy.map((w) => ({
      id: String(w.id),
      companyName: str(w.company_name),
      jobTitle: str(w.job_title),
      startDate: str(w.start_date),
      endDate: str(w.end_date),
      description: str(w.description),
      source: 'work_experience' as const,
    })),
    // `company` / `title` here, not company_name / job_title.
    ...weCanonical.map((w) => ({
      id: String(w.id),
      companyName: str(w.company),
      jobTitle: str(w.title),
      startDate: str(w.start_date),
      endDate: str(w.end_date),
      description: str(w.description),
      source: 'inspector_work_experience' as const,
    })),
  ].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));

  const skills: DossierSkill[] = skillRows.map((s) => ({
    id: String(s.id),
    category: str(s.category),
    brandName: str(s.brand_name),
    model: str(s.model),
    yearsExperience: num(s.years_experience),
  }));

  const equipment: DossierEquipment[] = [...eqLegacy, ...eqCanonical].map((e) => ({
    id: String(e.id),
    name: str(e.name),
    serialNumber: str(e.serial_number),
    // legacy: calibration_expiry — canonical: next_calibration_due
    calibrationExpiry: str(e.calibration_expiry) ?? str(e.next_calibration_due),
    // Only the legacy table has a status column.
    status: str(e.status),
  }));

  // Most recent application wins; there is normally at most one.
  const credRow = credRows
    .slice()
    .sort((a, b) => (str(b.applied_at) ?? '').localeCompare(str(a.applied_at) ?? ''))[0];
  const credential: DossierCredential | null = credRow
    ? {
        id: String(credRow.id),
        tier: str(credRow.tier),
        status: str(credRow.status),
        govIdVerified: credRow.gov_id_verified === null ? null : bool(credRow.gov_id_verified),
        govIdIssuingCountry: str(credRow.gov_id_issuing_country),
        experienceYearsDocumented: num(credRow.experience_years_documented),
        appliedAt: str(credRow.applied_at),
        decidedAt: str(credRow.decided_at),
        decisionNotes: str(credRow.decision_notes),
        expiresAt: str(credRow.expires_at),
      }
    : null;

  const verification: VerificationBreakdown = {
    accountStatus: str(profileRow.status),
    accountVerification: str(profileRow.verification_status),
    accountVerifiedAt: str(profileRow.verified_at),
    // Identity means a reviewed government ID, which only the CCI credential
    // flow captures. An admin flipping the account to "verified" is not it.
    identityVerified: credential?.govIdVerified === true,
    identitySource: credential ? 'CCI credential application' : null,
    credentialsVerified: certifications.filter((c) => c.isVerified).length,
    credentialsTotal: certifications.length,
    marketplaceActivated: profileRow.marketplace_activated === true,
  };

  return {
    resume: {
      path: resumePath,
      signedUrl: resumeSigned,
      legacyUrl: str(profileRow.resume_url) ?? str(profileRow.cv_url),
    },
    certifications,
    documents,
    experience,
    skills,
    equipment,
    credential,
    verification,
    unreadable: Array.from(new Set(unreadable)),
  };
}
