// ════════════════════════════════════════════════════════════════════════════
//  lib/data/jobsModeration.ts — bird's-eye job queue for super_admin
//
//  Pure types live in `./jobsModeration.types.ts` so client components can
//  type-import without dragging next/headers into the client bundle.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  ALL_JOB_STATUSES,
  type JobStatus,
} from '@nexpec/shared-core';
import type {
  ModerationJob,
  ModerationPageResult,
  ModerationQuery,
  ModerationJobDetail,
  ModerationTimelineEvent,
} from './jobsModeration.types';

// Re-export types for any consumer that still uses the legacy import path.
export type {
  ModerationJob,
  ModerationPageResult,
  ModerationQuery,
  ModerationJobDetail,
  ModerationTimelineEvent,
};

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function isJobStatus(v: string | undefined): v is JobStatus {
  if (!v) return false;
  return (ALL_JOB_STATUSES as readonly string[]).includes(v);
}

export async function fetchJobsModerationPage(
  query: ModerationQuery = {},
): Promise<ModerationPageResult> {
  try {
    const pageSize = Math.min(
      Math.max(query.pageSize ?? DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const page = Math.max(query.page ?? 1, 1);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const supabase = await createSupabaseServerClient();

    // Cascading SELECT — your tenant uses `location_city`, `inspector_id`,
    // `hired_inspector_id` (not the legacy `location` / `contractor_id`),
    // so try the canonical projection first and fall through if columns
    // don't exist.
    const WIDE =
      'id, title, location, location_city, status, created_at, updated_at, client_id, inspector_id, hired_inspector_id, client_price_cents, budget_cents, budget_min_cents, budget_max_cents, inspector_payout_cents, payout_amount_cents, payout_status, moderation_status, domain';
    const MID =
      'id, title, location, location_city, status, created_at, updated_at, client_id, hired_inspector_id, client_price_cents, budget_cents, payout_amount_cents, moderation_status';
    const NARROW =
      'id, title, status, created_at, updated_at, client_id';

    const projections = [WIDE, MID, NARROW];
    let rawJobs: Array<Record<string, unknown>> | null = null;
    let count: number | null = null;

      // ★ 2026-08-05 ROOT CAUSE of "Client price $0 / Payout $0 / Payment hold $0".
      //   Migration 20260801312000 revoked the buyer-pricing columns from the
      //   `authenticated` role on public.jobs (inspectors must not read them).
      //   Admins are ALSO `authenticated`, so WIDE and MID — which name
      //   client_price_cents — began failing with insufficient_privilege, and
      //   this cascade silently fell through to NARROW, which carries no money
      //   columns at all. The row mapper then formatted `undefined` as $0:
      //   a permission error rendered as a real financial figure.
      //
      //   Fix: read from public.jobs_secure_view — the postgres-owned view whose
      //   row filter is (client_id = auth.uid() OR agency_id = auth.uid() OR
      //   nx_is_admin()). An admin sees every job WITH pricing; an inspector
      //   gets zero rows, so price-blindness is untouched.
    for (const proj of projections) {
      let q = supabase
        .from('jobs_secure_view')
        .select(proj, { count: 'exact' })
        .order('updated_at', { ascending: false })
        .range(from, to);
      if (query.status) q = q.eq('status', query.status);
      const { data, count: c, error } = await q;
      if (!error && data) {
        rawJobs = data as unknown as Array<Record<string, unknown>>;
        count = c ?? null;
        break;
      }
      if (error) {
        // A projection carrying pricing must NEVER fail quietly — that is
          // precisely how the $0 bug hid.
          if (proj.includes('client_price_cents')) {
            console.error(
              '[jobsModeration] PRICING projection failed; money columns will be missing:',
              error.code, error.message,
            );
          } else {
            console.warn('[jobsModeration] page projection failed:', error.message);
          }
      }
    }

    if (!rawJobs) {
      return { jobs: [], total: 0, page, pageSize, totalPages: 1 };
    }

    const profileIds = new Set<string>();
    for (const j of rawJobs) {
      if (j.client_id) profileIds.add(String(j.client_id));
      const inspectorAny = j.hired_inspector_id ?? j.inspector_id ?? j.contractor_id;
      if (inspectorAny) profileIds.add(String(inspectorAny));
    }

  const profileMap = new Map<string, string | null>();
  if (profileIds.size > 0) {
    const { data: profs, error: profsErr } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', Array.from(profileIds));
    if (!profsErr && profs) {
      for (const p of profs) {
        profileMap.set(p.id as string, (p.full_name as string | null) ?? null);
      }
    }
  }

    const jobs: ModerationJob[] = rawJobs.map((j) => {
      const inspectorId =
        (j.hired_inspector_id as string | null) ??
        (j.inspector_id as string | null) ??
        (j.contractor_id as string | null) ??
        null;
      return {
        id: String(j.id),
        title: (j.title as string | null) ?? null,
        location: ((j.location_city as string | null) ?? (j.location as string | null)) ?? null,
        status: j.status as JobStatus,
        created_at: (j.created_at as string | null) ?? null,
        updated_at: (j.updated_at as string | null) ?? null,
        client_id: (j.client_id as string | null) ?? null,
        client_name: j.client_id
          ? (profileMap.get(String(j.client_id)) ?? null)
          : null,
        contractor_id: inspectorId,
        contractor_name: inspectorId ? (profileMap.get(inspectorId) ?? null) : null,
        client_price_cents: (j.client_price_cents as number | null) ?? null,
      client_budget_cents:
        ((j.budget_cents as number | null) ??
          (j.budget_max_cents as number | null) ??
          (j.budget_min_cents as number | null)) ?? null,
        payout_amount_cents:
          ((j.inspector_payout_cents as number | null) ?? (j.payout_amount_cents as number | null)) ?? null,
        payout_status: (j.payout_status as string | null) ?? null,
        domain: (j.domain as string | null) ?? null,
      };
    });

    const total = count ?? jobs.length;
    return {
      jobs,
      total,
      page,
      pageSize,
      totalPages: Math.max(Math.ceil(total / pageSize), 1),
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[jobsModeration] threw:', e);
    }
    return {
      jobs: [],
      total: 0,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
      totalPages: 1,
    };
  }
}

export interface ModerationApplicant {
  id: string;
  applicant_id: string | null;
  applicant_name: string | null;
  applicant_email: string | null;
  status: string;
  bid_amount_cents: number | null;
  payout_amount_cents: number | null;
  cover_note: string | null;
  // Negotiation loop (sprint 14)
  admin_counter_cents: number | null;
  admin_comment: string | null;
  negotiation_status: string | null;
  inspector_decision: string | null;
  inspector_decision_note: string | null;
  inspector_decision_at: string | null;
  created_at: string | null;
  // Anti-bypass gate (migration 272000): set when an admin has released this
  // application to the client. Drives the "Forward to client" button state.
  forwarded_to_client_at: string | null;
}

/**
 * Fetch every application tied to a job, with the inspector's bid + cover
 * note + identity. Used by the Job Moderation panel so admin can see what
 * each inspector proposed — without leaving the page.
 */
export async function fetchModerationApplicants(
  jobId: string,
): Promise<ModerationApplicant[]> {
  if (!jobId) return [];
  try {
    const supabase = await createSupabaseServerClient();

    // Cascading SELECT — try wide projection first, then narrower if any
    // of the negotiation columns don't exist yet.
    //
    // BUGFIX: `applications` has NO `payout_amount_cents` column (that lives on
    // `jobs`). Selecting it here made BOTH WIDE and MID error, so the loop
    // silently fell through to NARROW — which omits `bid_amount_cents`. That's
    // why the admin moderation panel showed every inspector bid as
    // "no counter" even when the inspector had proposed a figure.
    const WIDE =
      'id, applicant_id, status, bid_amount_cents, cover_note, admin_counter_cents, admin_comment, negotiation_status, inspector_decision, inspector_decision_note, inspector_decision_at, created_at, forwarded_to_client_at';
    const MID =
      'id, applicant_id, status, bid_amount_cents, cover_note, created_at, forwarded_to_client_at';
    const NARROW = 'id, applicant_id, status, created_at';

    let data: Array<Record<string, unknown>> | null = null;
    for (const proj of [WIDE, MID, NARROW]) {
      const res = await supabase
        .from('applications')
        .select(proj)
        .eq('job_id', jobId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (!res.error && res.data) {
        data = res.data as unknown as Array<Record<string, unknown>>;
        break;
      }
      if (res.error && typeof console !== 'undefined') {
        console.warn(
          '[fetchModerationApplicants] projection failed:',
          res.error.message,
        );
      }
    }
    if (!data) return [];
    const rows = data;
    // Hydrate inspector names
    const ids = Array.from(
      new Set(
        rows
          .map((r) => (r.applicant_id as string | null) ?? null)
          .filter((v): v is string => !!v),
      ),
    );
    const profileMap = new Map<
      string,
      { name: string | null; email: string | null }
    >();
    if (ids.length > 0) {
      try {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', ids);
        for (const p of (profs ?? []) as Array<Record<string, unknown>>) {
          profileMap.set(String(p.id), {
            name: (p.full_name as string | null) ?? null,
            email: (p.email as string | null) ?? null,
          });
        }
      } catch {
        /* ignore — show ids only */
      }
    }
    return rows.map((r) => {
      const aid = (r.applicant_id as string | null) ?? null;
      const prof = aid ? profileMap.get(aid) ?? null : null;
      return {
        id: String(r.id),
        applicant_id: aid,
        applicant_name: prof?.name ?? null,
        applicant_email: prof?.email ?? null,
        status: String(r.status ?? 'pending'),
        bid_amount_cents: (r.bid_amount_cents as number | null) ?? null,
        // `applications` has no payout_amount_cents column — the admin-set
        // payout lives on the job. Kept on the type for the panel; always null.
        payout_amount_cents: null,
        cover_note: (r.cover_note as string | null) ?? null,
        admin_counter_cents: (r.admin_counter_cents as number | null) ?? null,
        admin_comment: (r.admin_comment as string | null) ?? null,
        negotiation_status: (r.negotiation_status as string | null) ?? null,
        inspector_decision: (r.inspector_decision as string | null) ?? null,
        inspector_decision_note: (r.inspector_decision_note as string | null) ?? null,
        inspector_decision_at: (r.inspector_decision_at as string | null) ?? null,
        created_at: (r.created_at as string | null) ?? null,
        forwarded_to_client_at: (r.forwarded_to_client_at as string | null) ?? null,
      };
    });
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchModerationApplicants] threw:', e);
    }
    return [];
  }
}

export async function fetchModerationJob(
  jobId: string,
): Promise<ModerationJobDetail | null> {
  if (!jobId) return null;
  try {
    const supabase = await createSupabaseServerClient();

    const WIDE =
      'id, title, location, location_city, description, status, created_at, updated_at, client_id, inspector_id, hired_inspector_id, client_price_cents, budget_cents, budget_min_cents, budget_max_cents, inspector_payout_cents, payout_amount_cents, payout_status, moderation_status, moderation_reviewed_at, moderation_reviewed_by, moderation_notes, inspection_type, job_type, domain, specialty_slugs, scope_template_id, urgency, requires_cci, scheduled_date, estimated_duration, claimed_address_text, job_country, currency, budget_type, required_certifications, identity_mode, payment_mode, applications_count, accepts_remote_inspectors, sponsorship_offered, is_senior_review, source_rfq_id, latitude, longitude';
    const MID =
      'id, title, location, location_city, description, status, created_at, updated_at, client_id, hired_inspector_id, client_price_cents, budget_cents, payout_amount_cents, moderation_status, moderation_notes';
    const NARROW =
      'id, title, description, status, created_at, updated_at, client_id, moderation_status';

    let j: Record<string, unknown> | null = null;
    for (const proj of [WIDE, MID, NARROW]) {
      const { data, error } = await supabase
        // Same root cause and fix as the list query above: the drawer must read
        // pricing through jobs_secure_view or an admin sees $0.
        .from('jobs_secure_view')
        .select(proj)
        .eq('id', jobId)
        .maybeSingle();
      if (!error && data) {
        j = data as unknown as Record<string, unknown>;
        break;
      }
      if (error) {
        if (proj.includes('client_price_cents')) {
            console.error(
              '[fetchModerationJob] PRICING projection failed; money columns will be missing:',
              error.code, error.message,
            );
          } else {
            console.warn('[fetchModerationJob projection]', error.message);
          }
      }
    }
    if (!j) return null;

    const ids: string[] = [];
    if (j.client_id) ids.push(String(j.client_id));
    const inspectorAny =
      j.hired_inspector_id ?? j.inspector_id ?? j.contractor_id ?? null;
    if (inspectorAny) ids.push(String(inspectorAny));

    const profileMap = new Map<
      string,
      { name: string | null; email: string | null }
    >();
    if (ids.length > 0) {
      try {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .in('id', ids);
        for (const p of (profs ?? []) as Array<Record<string, unknown>>) {
          profileMap.set(String(p.id), {
            name: (p.full_name as string | null) ?? null,
            email: (p.email as string | null) ?? null,
          });
        }
      } catch {
        /* ignore */
      }
    }

    const client = j.client_id ? profileMap.get(String(j.client_id)) ?? null : null;
    const contractor = inspectorAny
      ? profileMap.get(String(inspectorAny)) ?? null
      : null;

    // ── Scope of work ────────────────────────────────────────────────────────
    //  jobs stores only scope_template_id; the discipline, standards and
    //  narrative live on inspection_scope_templates. Best-effort: a missing
    //  template must not blank out the rest of the drawer.
    type ScopeRow = {
      name: string | null; category: string | null; description_md: string | null;
      domain: string | null; requires_credential_tier: string | null;
    };
    let scope: ScopeRow | null = null;
    if (j.scope_template_id) {
      try {
        const { data } = await supabase
          .from('inspection_scope_templates')
          .select('name, category, description_md, domain, requires_credential_tier')
          .eq('id', String(j.scope_template_id))
          .maybeSingle();
        if (data) scope = data as unknown as ScopeRow;
      } catch { /* leave scope null; the drawer renders "Not provided" */ }
    }

    // ── Client context ───────────────────────────────────────────────────────
    //  So an admin can judge the submitter without leaving moderation.
    let clientCompany: string | null = null;
    let clientPhone: string | null = null;
    let clientLocation: string | null = null;
    let clientVerification: string | null = null;
    let clientJoined: string | null = null;
    let clientJobCount: number | null = null;
    let clientMissing: string[] = [];
    if (j.client_id) {
      const cid = String(j.client_id);
      try {
        const { data } = await supabase
          .from('profiles')
          .select('company_name, phone, location, verification_status, created_at')
          .eq('id', cid)
          .maybeSingle();
        if (data) {
          clientCompany = (data.company_name as string | null) ?? null;
          clientPhone = (data.phone as string | null) ?? null;
          clientLocation = (data.location as string | null) ?? null;
          clientVerification = (data.verification_status as string | null) ?? null;
          clientJoined = (data.created_at as string | null) ?? null;
        }
      } catch { /* non-fatal */ }
      try {
        const { count } = await supabase
          .from('jobs_secure_view')
          .select('id', { count: 'exact', head: true })
          .eq('client_id', cid);
        clientJobCount = count ?? null;
      } catch { /* non-fatal */ }
      try {
        // Single source of truth for completeness — the same RPC the automatic
        // nudge and the Incomplete Profiles view use, so they can never disagree.
        const { data } = await supabase.rpc('nx_profile_missing_fields', { p_user_id: cid });
        if (Array.isArray(data)) clientMissing = data as string[];
      } catch { /* non-fatal */ }
    }

    // ── Standards & required evidence ───────────────────────────────────────
    //  jobs has NO column for codes/standards or deliverables. For compliance
    //  work the real scope is structured one level down: itp_points carries
    //  reference_document (the applicable code/standard) and acceptance
    //  criteria, and inspection_evidence_requirements lists the deliverables.
    //  Surfacing them here is the only way an admin can judge the job.
    let standards: string[] = [];
    let evidenceCount: number | null = null;
    let itpCount: number | null = null;
    if (j.scope_template_id) {
      const tid = String(j.scope_template_id);
      try {
        const { data, count } = await supabase
          .from('itp_points')
          .select('reference_document', { count: 'exact' })
          .eq('template_id', tid)
          .limit(200);
        itpCount = count ?? null;
        standards = Array.from(
          new Set(
            (data ?? [])
              .map((r) => (r as { reference_document: string | null }).reference_document)
              .filter((v): v is string => !!v && v.trim() !== ''),
          ),
        );
      } catch { /* non-fatal */ }
      try {
        const { count } = await supabase
          .from('inspection_evidence_requirements')
          .select('id', { count: 'exact', head: true })
          .eq('template_id', tid);
        evidenceCount = count ?? null;
      } catch { /* non-fatal */ }
    }

    // ── Attachments ─────────────────────────────────────────────────────────
    //  Job-linked documents live in separate tables; count what is attached so
    //  the admin knows whether supporting paperwork exists.
    let documentCount = 0;
    for (const t of ['project_documents', 'client_documents', 'compliance_documents'] as const) {
      try {
        const { count } = await supabase
          .from(t)
          .select('id', { count: 'exact', head: true })
          .eq('job_id', String(j.id));
        documentCount += count ?? 0;
      } catch { /* table may not carry job_id; skip */ }
    }

    const asStrArray = (v: unknown): string[] | null =>
      Array.isArray(v) ? (v as string[]) : null;

    return {
      inspection_type: (j.inspection_type as string | null) ?? null,
      job_type: (j.job_type as string | null) ?? null,
      domain: (j.domain as string | null) ?? null,
      specialty_slugs: asStrArray(j.specialty_slugs),
      scope_template_id: (j.scope_template_id as string | null) ?? null,
      urgency: (j.urgency as string | null) ?? null,
      requires_cci: (j.requires_cci as boolean | null) ?? null,
      scheduled_date: (j.scheduled_date as string | null) ?? null,
      estimated_duration: (j.estimated_duration as string | null) ?? null,
      claimed_address_text: (j.claimed_address_text as string | null) ?? null,
      job_country: (j.job_country as string | null) ?? null,
      currency: (j.currency as string | null) ?? null,
      budget_type: (j.budget_type as string | null) ?? null,
      required_certifications: asStrArray(j.required_certifications),
      identity_mode: (j.identity_mode as string | null) ?? null,
      payment_mode: (j.payment_mode as string | null) ?? null,
      applications_count: (j.applications_count as number | null) ?? null,
      accepts_remote_inspectors: (j.accepts_remote_inspectors as boolean | null) ?? null,
      sponsorship_offered: (j.sponsorship_offered as boolean | null) ?? null,
      is_senior_review: (j.is_senior_review as boolean | null) ?? null,
      source_rfq_id: (j.source_rfq_id as string | null) ?? null,
      latitude: (j.latitude as number | null) ?? null,
      longitude: (j.longitude as number | null) ?? null,
      scope_name: scope?.name ?? null,
      scope_category: scope?.category ?? null,
      scope_description_md: scope?.description_md ?? null,
      scope_domain: scope?.domain ?? null,
      scope_required_tier: scope?.requires_credential_tier ?? null,
      scope_standards: standards,
      scope_evidence_count: evidenceCount,
      scope_itp_count: itpCount,
      document_count: documentCount,
      client_company: clientCompany,
      client_phone: clientPhone,
      client_location: clientLocation,
      client_verification_status: clientVerification,
      client_joined_at: clientJoined,
      client_job_count: clientJobCount,
      client_missing_fields: clientMissing,
      id: String(j.id),
      title: (j.title as string | null) ?? null,
      location: ((j.location_city as string | null) ?? (j.location as string | null)) ?? null,
      description: (j.description as string | null) ?? null,
      status: j.status as JobStatus,
      created_at: (j.created_at as string | null) ?? null,
      updated_at: (j.updated_at as string | null) ?? null,
      client_id: (j.client_id as string | null) ?? null,
      client_name: client?.name ?? null,
      client_email: client?.email ?? null,
      contractor_id: inspectorAny ? String(inspectorAny) : null,
      contractor_name: contractor?.name ?? null,
      contractor_email: contractor?.email ?? null,
      client_price_cents: (j.client_price_cents as number | null) ?? null,
      client_budget_cents:
        ((j.budget_cents as number | null) ??
          (j.budget_max_cents as number | null) ??
          (j.budget_min_cents as number | null)) ?? null,
      payout_amount_cents:
        ((j.inspector_payout_cents as number | null) ??
          (j.payout_amount_cents as number | null)) ?? null,
      payout_status: (j.payout_status as string | null) ?? null,
      moderation_status: (j.moderation_status as string | null) ?? null,
      moderation_reviewed_at: (j.moderation_reviewed_at as string | null) ?? null,
      moderation_reviewed_by: (j.moderation_reviewed_by as string | null) ?? null,
      moderation_notes: (j.moderation_notes as string | null) ?? null,
    };
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchModerationJob] threw:', e);
    }
    return null;
  }
}

export async function fetchModerationTimeline(
  jobId: string,
  limit = 20,
): Promise<ModerationTimelineEvent[]> {
  if (!jobId) return [];
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('audit_events')
      .select('id, created_at, event_type, severity, summary, actor_label')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data as ModerationTimelineEvent[];
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchModerationTimeline] threw:', e);
    }
    return [];
  }
}
