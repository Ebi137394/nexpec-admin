// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/jobClauses.ts — clauses CRUD (client + admin) + acceptances
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CLAUSE_KINDS } from '@/lib/data/jobClauses.types';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

const CreateSchema = z.object({
  jobId: z.string().uuid(),
  kind: z.enum(CLAUSE_KINDS),
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(20000),
  isRequired: z
    .preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())
    .default(true),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  returnTo: z.string().min(1),
});

export async function createJobClause(formData: FormData): Promise<void> {
  const parsed = CreateSchema.safeParse({
    jobId: formData.get('jobId'),
    kind: formData.get('kind'),
    title: formData.get('title'),
    body: formData.get('body'),
    isRequired: formData.get('isRequired'),
    sortOrder: formData.get('sortOrder') ?? 0,
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/';
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(fallback, { error: msg }));
  }
  const { jobId, kind, title, body, isRequired, sortOrder, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  const { error } = await supabase.from('job_clauses').insert({
    job_id: jobId,
    kind,
    title,
    body,
    is_required: isRequired,
    sort_order: sortOrder,
  });
  if (error) {
    redirect(withQuery(returnTo, { error: 'Save failed. Make sure you own this job.' }));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { saved: '1' }));
}

const DeleteSchema = z.object({
  id: z.string().uuid(),
  returnTo: z.string().min(1),
});

export async function deleteJobClause(formData: FormData): Promise<void> {
  const parsed = DeleteSchema.safeParse({
    id: formData.get('id'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/';
  if (!parsed.success) redirect(withQuery(fallback, { error: 'Bad request.' }));
  const { id, returnTo } = parsed.data;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('job_clauses').delete().eq('id', id);
  if (error) redirect(withQuery(returnTo, { error: 'Delete failed.' }));
  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { deleted: '1' }));
}

const AcceptSchema = z.object({
  clauseIds: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * Record acceptances for an array of clause ids. Called from the inspector
 * apply page right before the application INSERT. Returns void on success;
 * the page then proceeds to call the existing apply action which the
 * BEFORE INSERT trigger (`_enforce_clause_acceptance`) gates on.
 */
export async function acceptClauses(formData: FormData): Promise<void> {
  const ids = formData
    .getAll('clauseIds')
    .map(String)
    .filter((s) => s.length > 0);
  const parsed = AcceptSchema.safeParse({ clauseIds: ids });
  if (!parsed.success) {
    const returnTo = (formData.get('returnTo') as string) || '/';
    redirect(withQuery(returnTo, { error: 'No clauses to accept.' }));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  // Upsert one acceptance per clause id. RLS limits acceptor_id = auth.uid().
  const rows = parsed.data.clauseIds.map((cid) => ({
    clause_id: cid,
    acceptor_id: user.id,
  }));
  const { error } = await supabase
    .from('clause_acceptances')
    .upsert(rows, { onConflict: 'clause_id,acceptor_id', ignoreDuplicates: true });

  if (error && typeof console !== 'undefined') {
    console.warn('[acceptClauses] upsert failed', error.message);
  }

  // Return the caller to wherever they came from
  const returnTo = (formData.get('returnTo') as string) || '/';
  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { accepted: '1' }));
}
