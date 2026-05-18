// ════════════════════════════════════════════════════════════════════════════
//  lib/data/clientDocuments.ts — fetchers
//
//  Three call-sites:
//    fetchMyClientDocuments()                — owner-scoped (employer view)
//    fetchClientDocumentsForJob(jobId)       — job-scoped (admin + inspector + owner)
//    fetchAdminAllClientDocuments()          — admin oversight queue
//
//  All paths mint short-lived signed URLs since the bucket is private.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { ClientDocKind, ClientDocument } from './clientDocuments.types';

export type { ClientDocument };

const BUCKET = 'client_documents';
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export interface FetchMyOptions {
  /** When set, scope to this job's docs only (otherwise: org + job docs the owner owns). */
  jobId?: string | null;
  limit?: number;
}

export async function fetchMyClientDocuments(
  opts: FetchMyOptions = {},
): Promise<ClientDocument[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    let q = supabase
      .from('client_documents')
      .select(
        'id, owner_id, job_id, kind, label, file_path, external_url, notes, created_at, updated_at, jobs(title)',
      )
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
      .limit(opts.limit ?? 100);

    if (opts.jobId !== undefined) {
      q = opts.jobId === null ? q.is('job_id', null) : q.eq('job_id', opts.jobId);
    }

    const { data, error } = await q;
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchMyClientDocuments] failed:', error.message);
      }
      return [];
    }
    return signRows(supabase, data as unknown as Array<Record<string, unknown>>);
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchMyClientDocuments] threw:', e);
    }
    return [];
  }
}

export async function fetchClientDocumentsForJob(
  jobId: string,
): Promise<ClientDocument[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('client_documents')
      .select(
        'id, owner_id, job_id, kind, label, file_path, external_url, notes, created_at, updated_at, jobs(title)',
      )
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchClientDocumentsForJob] failed:', error.message);
      }
      return [];
    }
    return signRows(supabase, data as unknown as Array<Record<string, unknown>>);
  } catch {
    return [];
  }
}

export async function fetchAdminAllClientDocuments(
  limit: number = 200,
): Promise<ClientDocument[]> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from('client_documents')
      .select(
        'id, owner_id, job_id, kind, label, file_path, external_url, notes, created_at, updated_at, jobs(title)',
      )
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchAdminAllClientDocuments] failed:', error.message);
      }
      return [];
    }
    return signRows(supabase, data as unknown as Array<Record<string, unknown>>);
  } catch {
    return [];
  }
}

/* ─── helpers ────────────────────────────────────────────────────────── */

async function signRows(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  rows: Array<Record<string, unknown>>,
): Promise<ClientDocument[]> {
  const out: ClientDocument[] = [];
  for (const r of rows) {
    const filePath = (r.file_path as string | null) ?? null;
    const externalUrl = (r.external_url as string | null) ?? null;

    // Only mint a signed URL for uploaded files. External links are passed
    // through verbatim — they belong to the client's own storage system.
    let fileUrl: string | null = null;
    if (filePath) {
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
      fileUrl = signed?.signedUrl ?? null;
    }

    const jobJoin = (r.jobs ?? null) as { title?: string | null } | null;
    out.push({
      id: String(r.id),
      ownerId: String(r.owner_id),
      jobId: (r.job_id as string | null) ?? null,
      jobTitle: jobJoin?.title ?? null,
      kind: ((r.kind as string | null) ?? 'other') as ClientDocKind,
      label: String(r.label ?? ''),
      source: externalUrl ? 'external_url' : 'upload',
      fileUrl,
      filePath,
      externalUrl,
      notes: (r.notes as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    });
  }
  return out;
}
