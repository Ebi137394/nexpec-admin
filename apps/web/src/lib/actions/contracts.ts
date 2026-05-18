// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/contracts.ts — sign + admin-create + assign
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { headers } from 'next/headers';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { CONTRACT_KINDS } from '@/lib/data/contracts.types';

const BUCKET = 'contracts';
const MAX_BYTES = 25 * 1024 * 1024;

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

/* ─── Sign — typed-name + IP + UA capture ─────────────────────────── */

const SignSchema = z.object({
  assignmentId: z.string().uuid(),
  typedName: z.string().trim().min(2).max(160),
  returnTo: z.string().min(1),
});

export async function signContractAssignment(formData: FormData): Promise<void> {
  const parsed = SignSchema.safeParse({
    assignmentId: formData.get('assignmentId'),
    typedName: formData.get('typedName'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/client/contracts';
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(fallback, { error: msg }));
  }
  const { assignmentId, typedName, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  // Read IP + UA from request headers
  const h = await headers();
  const ipHeader = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? null;
  const ip = ipHeader ? ipHeader.split(',')[0]?.trim() ?? null : null;
  const userAgent = h.get('user-agent') ?? null;

  const { error } = await supabase.rpc('sign_contract', {
    p_assignment_id: assignmentId,
    p_typed_name: typedName,
    p_ip: ip,
    p_user_agent: userAgent,
  });

  if (error) {
    const msg = error.message?.includes('already signed')
      ? 'You already signed this contract.'
      : error.message?.includes('not your assignment')
        ? 'This assignment is not yours.'
        : 'Could not sign. Try again.';
    redirect(withQuery(returnTo, { error: msg }));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { signed: '1' }));
}

/* ─── Admin: create a contract ─────────────────────────────────────── */

const CreateSchema = z.object({
  kind: z.enum(CONTRACT_KINDS),
  title: z.string().trim().min(1).max(200),
  bodyMd: z.string().trim().max(200000).optional().or(z.literal('')),
  source: z.enum(['inline', 'upload', 'external_url']),
  externalUrl: z
    .string()
    .trim()
    .url()
    .regex(/^https?:\/\//)
    .max(2000)
    .optional()
    .or(z.literal('')),
  effectiveFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnTo: z.string().min(1),
});

export async function createContract(formData: FormData): Promise<void> {
  const parsed = CreateSchema.safeParse({
    kind: formData.get('kind'),
    title: formData.get('title'),
    bodyMd: formData.get('bodyMd') ?? '',
    source: formData.get('source') ?? 'inline',
    externalUrl: formData.get('externalUrl') ?? '',
    effectiveFrom: formData.get('effectiveFrom'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/admin/contracts';
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid input.';
    redirect(withQuery(fallback, { error: msg }));
  }
  const { kind, title, bodyMd, source, externalUrl, effectiveFrom, returnTo } =
    parsed.data;

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));

  // Branch on source
  let pdfPath: string | null = null;
  let externalUrlValue: string | null = null;

  if (source === 'upload') {
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      redirect(withQuery(returnTo, { error: 'Attach a PDF.' }));
    }
    if (file.size > MAX_BYTES) {
      redirect(withQuery(returnTo, { error: 'PDF exceeds 25 MB. Use External Link.' }));
    }
    if (file.type !== 'application/pdf') {
      redirect(withQuery(returnTo, { error: 'Only PDF uploads.' }));
    }
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
    pdfPath = `admin/${Date.now()}-${safeName}`;
    const buf = await file.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(pdfPath, buf, { contentType: file.type, upsert: false });
    if (uploadErr) {
      redirect(withQuery(returnTo, { error: 'Upload failed.' }));
    }
  } else if (source === 'external_url') {
    if (!externalUrl || externalUrl.length === 0) {
      redirect(withQuery(returnTo, { error: 'Paste the external link.' }));
    }
    externalUrlValue = externalUrl;
  }
  // For 'inline' source: bodyMd is the canonical content; no upload/link.

  const { error: insertErr } = await supabase.from('contracts').insert({
    kind,
    title,
    body_md: bodyMd && bodyMd.length > 0 ? bodyMd : '',
    pdf_path: pdfPath,
    external_url: externalUrlValue,
    effective_from: effectiveFrom,
    is_active: true,
    created_by: user.id,
  });

  if (insertErr) {
    if (pdfPath) await supabase.storage.from(BUCKET).remove([pdfPath]);
    redirect(withQuery(returnTo, { error: 'Save failed. ' + insertErr.message }));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { created: '1' }));
}

/* ─── Admin: assign a contract to a party ──────────────────────────── */

const AssignSchema = z.object({
  contractId: z.string().uuid(),
  partyId: z.string().uuid(),
  required: z
    .preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())
    .default(true),
  returnTo: z.string().min(1),
});

export async function assignContract(formData: FormData): Promise<void> {
  const parsed = AssignSchema.safeParse({
    contractId: formData.get('contractId'),
    partyId: formData.get('partyId'),
    required: formData.get('required'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/admin/contracts';
  if (!parsed.success) redirect(withQuery(fallback, { error: 'Invalid input.' }));
  const { contractId, partyId, required, returnTo } = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('contract_assignments').insert({
    contract_id: contractId,
    party_id: partyId,
    required,
  });
  if (error) {
    const msg = error.code === '23505' ? 'Already assigned.' : 'Assign failed.';
    redirect(withQuery(returnTo, { error: msg }));
  }

  // Notify the party
  await supabase.rpc('notify', {
    p_recipient: partyId,
    p_kind: 'contract_assigned',
    p_title: 'New contract to sign',
    p_body: 'Open /client/contracts to review and sign.',
    p_link: '/client/contracts',
    p_job_id: null,
  });

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { assigned: '1' }));
}
