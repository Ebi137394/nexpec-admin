// ════════════════════════════════════════════════════════════════════════════
//  lib/identityDisclosure.ts — buyer-side, JOB-SCOPED identity disclosure
//
//  The disclosure decision belongs to the DATABASE, not to this file. The
//  server view `job_applicant_identity_view` (20260801322000) resolves the
//  per-job identity_mode and NULLs out every field the mode does not permit.
//  This module only *reads* that projection and answers a presentation
//  question: "what name do I put on this card?"
//
//  Consequences that matter:
//    • Nothing here can widen disclosure. If the DB returns NULL for
//      inspector_display_name, no client-side branch can invent one.
//    • Disclosure is per (job, applicant). Fetching for job A tells you
//      nothing about the same inspector on job B — the view has no row.
//    • The projection carries NO bid / payout / price / spread (GR2), so
//      identity disclosure can never become a margin-derivation channel.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from '@/lib/supabase';
import { nxHandle } from '@/src/core/utils/handle';

export type IdentityMode = 'protected' | 'professional' | 'full';

export interface ApplicantDisclosure {
  applicantId: string;
  identityMode: IdentityMode;
  displayName: string | null;
  headline: string | null;
  resumeSummary: string | null;
  resumeUrl: string | null;
  certifications: string[] | null;
  qualifications: string[] | null;
  /** Full mode only. Never populated in professional mode. */
  email: string | null;
  /** Full mode only. Never populated in professional mode. */
  phone: string | null;
  /** Professional + Full. */
  avatarUrl: string | null;
  /** Professional + Full. Second résumé column that exists alongside resumeUrl. */
  cvUrl: string | null;
  /** Pseudonym-safe in EVERY mode — reputation and discipline are not identity. */
  reputation: {
    rating_average: number | null;
    reviews_count: number | null;
    completed_jobs_count: number | null;
    rating: number | null;
    total_jobs: number | null;
    professional_title: string | null;
    title: string | null;
    experience_years: number | null;
    specialty_slugs: string[] | null;
    ndt_methods: string[] | null;
    location_city: string | null;
    location_province: string | null;
  };
}

/** Columns of public.job_applicant_identity_view. Never add a money column. */
const DISCLOSURE_COLS =
  'applicant_id, identity_mode, inspector_display_name, inspector_headline, ' +
  'inspector_resume_summary, inspector_resume_url, inspector_certifications, ' +
  'inspector_qualifications, inspector_email, inspector_phone, ' +
  'inspector_avatar_url, inspector_first_name, inspector_last_name, inspector_cv_url, ' +
  'rating, total_jobs, professional_title, title, experience_years, ' +
  'specialty_slugs, ndt_methods, location_city, location_province';

function toStringArray(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return null;
}

function normalizeMode(v: unknown): IdentityMode {
  return v === 'professional' || v === 'full' ? v : 'protected'; // fail closed
}

/**
 * Fetch the disclosure row for every applicant on ONE job.
 * Returns a map keyed by applicant id. Never throws — on any error the caller
 * simply gets an empty map and every card stays protected (fail closed).
 */
export async function fetchJobApplicantDisclosure(
  jobId: string,
): Promise<Map<string, ApplicantDisclosure>> {
  const out = new Map<string, ApplicantDisclosure>();
  if (!jobId) return out;

  const { data, error } = await supabase
    .from('job_applicant_identity_view')
    .select(DISCLOSURE_COLS)
    .eq('job_id', jobId);

  if (error || !data) {
    if (error) console.warn('[identityDisclosure] read failed:', error.message);
    return out;
  }

  // ★ TS NOTE — DISCLOSURE_COLS is assembled by string concatenation, so
  //   supabase-js cannot type the projection and infers
  //   `GenericStringError[] | null`, where GenericStringError is
  //   `{ error: true } & "Received a generic string"`. That intersection
  //   contains a string primitive, so it does not overlap Record<string,
  //   unknown> and a direct cast is rejected (TS2352). Narrow at RUNTIME
  //   instead, bridging through `unknown` — this also hardens the loop against
  //   a malformed row rather than merely silencing the compiler.
  if (!Array.isArray(data)) return out;

  for (const raw of data as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.applicant_id ?? '');
    if (!id) continue;
    out.set(id, {
      applicantId: id,
      identityMode: normalizeMode(r.identity_mode),
      displayName: (r.inspector_display_name as string | null) ?? null,
      headline: (r.inspector_headline as string | null) ?? null,
      resumeSummary: (r.inspector_resume_summary as string | null) ?? null,
      resumeUrl: (r.inspector_resume_url as string | null) ?? null,
      certifications: toStringArray(r.inspector_certifications),
      qualifications: toStringArray(r.inspector_qualifications),
      email: (r.inspector_email as string | null) ?? null,
      phone: (r.inspector_phone as string | null) ?? null,
      avatarUrl: (r.inspector_avatar_url as string | null) ?? null,
      cvUrl: (r.inspector_cv_url as string | null) ?? null,
      reputation: {
        rating_average: (r.rating_average as number | null) ?? null,
        reviews_count: (r.reviews_count as number | null) ?? null,
        completed_jobs_count: (r.completed_jobs_count as number | null) ?? null,
        rating: (r.rating as number | null) ?? null,
        total_jobs: (r.total_jobs as number | null) ?? null,
        professional_title: (r.professional_title as string | null) ?? null,
        title: (r.title as string | null) ?? null,
        experience_years: (r.experience_years as number | null) ?? null,
        specialty_slugs: toStringArray(r.specialty_slugs),
        ndt_methods: toStringArray(r.ndt_methods),
        location_city: (r.location_city as string | null) ?? null,
        location_province: (r.location_province as string | null) ?? null,
      },
    });
  }

  return out;
}

/** Disclosure for ONE applicant on ONE job. */
export async function fetchApplicantDisclosure(
  jobId: string,
  applicantId: string,
): Promise<ApplicantDisclosure | null> {
  if (!jobId || !applicantId) return null;
  const map = await fetchJobApplicantDisclosure(jobId);
  return map.get(applicantId) ?? null;
}

/**
 * THE presentation rule. Protected → stable NX- pseudonym. Professional/Full →
 * the real professional name, but ONLY if the server actually released it;
 * a NULL name falls back to the pseudonym rather than to a blank or a
 * placeholder like "Unknown User".
 */
export function displayNameFor(
  applicantId: string,
  disclosure?: ApplicantDisclosure | null,
): string {
  const released = disclosure?.displayName?.trim();
  if (released) return released;
  return nxHandle(applicantId);
}

/** True when the buyer is authorized to see professional credentials. */
export function isProfessionallyDisclosed(d?: ApplicantDisclosure | null): boolean {
  return d?.identityMode === 'professional' || d?.identityMode === 'full';
}

/**
 * Compatibility shim for buyer screens that used to join `applicant:profiles`.
 *
 * After migration 20260801324000 that join returns NOTHING to a buyer unless
 * the job is in Full mode — which is the entire point: RLS, not the client's
 * choice of columns, now enforces the mode. This merges the lawful projection
 * over whatever the raw join produced, so those screens keep their reputation
 * and discipline data under Protected instead of rendering blank.
 *
 * Precedence is deliberate: the DISCLOSURE row wins for every identity field.
 * A raw row can only ever appear in Full mode, where it agrees anyway.
 */
export function mergeApplicantProfile<T extends Record<string, unknown>>(
  applicantId: string,
  rawProfile: T | null | undefined,
  d?: ApplicantDisclosure | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...(rawProfile ?? {}) };
  base.id = applicantId;

  // Reputation + discipline: always lawful, so always prefer the projection.
  if (d) {
    if (d.reputation) Object.assign(base, d.reputation);
    // Identity fields: present only when the server released them.
    base.full_name = d.displayName ?? null;
    base.headline = d.headline ?? null;
    base.avatar_url = d.avatarUrl ?? null;
    base.bio = d.resumeSummary ?? null;
    base.resume_url = d.resumeUrl ?? null;
    base.cv_url = d.cvUrl ?? null;
    base.certifications = d.certifications ?? null;
    base.email = d.email ?? null;
    base.phone = d.phone ?? null;
  }
  return base;
}
