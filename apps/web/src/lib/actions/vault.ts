// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/vault.ts — Compliance Vault Server Actions
//
//  Five mutations:
//    • uploadVaultDocumentAction (any role) — uploads file to client_documents
//      storage bucket + inserts row into public.client_documents
//    • updateVaultMetadataAction (owner)    — edit label/category/validity/notes
//    • archiveVaultDocumentAction (owner)   — soft-archive (hidden from default view)
//    • restoreVaultDocumentAction (owner)   — unarchive
//    • verifyVaultDocumentAction (admin)    — toggle is_verified + audit stamp
//
//  RLS on public.client_documents already restricts mutations to owner +
//  admin. These actions are convenience layers with friendly error messages.
//
//  Storage: files land in the private `client_documents` bucket at the
//  path  {owner_id}/{uuid}-{originalFilename}. Per the bucket's
//  existing folder-RLS, owners can read their own folder; admin can read all.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { VaultActionState } from './vault.types';

const VAULT_CATEGORIES = ['insurance', 'license', 'nda', 'msa', 'regulatory', 'audit', 'other'] as const;

const UploadSchema = z.object({
  label: z.string().trim().min(2, { message: 'Label must be at least 2 characters.' }).max(120),
  category: z.enum(VAULT_CATEGORIES, { message: 'Pick a valid category.' }),
  validFrom: z.string().trim().optional().or(z.literal('')),
  validUntil: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  jobId: z.string().uuid().optional().or(z.literal('')),
});

const UpdateSchema = z.object({
  documentId: z.string().uuid(),
  label: z.string().trim().min(2).max(120),
  category: z.enum(VAULT_CATEGORIES),
  validFrom: z.string().trim().optional().or(z.literal('')),
  validUntil: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

const ToggleSchema = z.object({
  documentId: z.string().uuid(),
});

const VerifySchema = z.object({
  documentId: z.string().uuid(),
  verified: z.enum(['true', 'false']),
});

async function getAuthedUser() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

async function isAdmin(): Promise<boolean> {
  const { supabase, user } = await getAuthedUser();
  if (!user) return false;
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = (data as { role?: string | null } | null)?.role ?? '';
  return role === 'admin' || role === 'super_admin';
}

function revalidateVaultPaths(documentId?: string) {
  revalidatePath('/client/vault');
  revalidatePath('/admin/vault');
  if (documentId) {
    revalidatePath(`/client/vault/${documentId}`);
    revalidatePath(`/admin/vault/${documentId}`);
  }
}

// ─── 1. Upload ─────────────────────────────────────────────────────────
export async function uploadVaultDocumentAction(
  _prev: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  const parsed = UploadSchema.safeParse({
    label: formData.get('label'),
    category: formData.get('category'),
    validFrom: formData.get('validFrom') ?? '',
    validUntil: formData.get('validUntil') ?? '',
    notes: formData.get('notes') ?? '',
    jobId: formData.get('jobId') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'A file is required.' };
  }
  if (file.size > 25 * 1024 * 1024) {
    return { ok: false, error: 'File exceeds the 25 MB limit.' };
  }

  const { supabase, user } = await getAuthedUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  // Upload to storage
  const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;
  const { error: uploadErr } = await supabase.storage
    .from('client_documents')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadErr) {
    console.error('[uploadVaultDocumentAction] storage failed:', uploadErr.message);
    return { ok: false, error: `Upload failed: ${uploadErr.message}` };
  }

  // Insert row
  const { data, error: insertErr } = await supabase
    .from('client_documents')
    .insert({
      owner_id: user.id,
      label: parsed.data.label,
      category: parsed.data.category,
      kind: 'document',
      file_path: path,
      notes: parsed.data.notes && parsed.data.notes.length > 0 ? parsed.data.notes : null,
      valid_from: parsed.data.validFrom && parsed.data.validFrom.length > 0 ? parsed.data.validFrom : null,
      valid_until: parsed.data.validUntil && parsed.data.validUntil.length > 0 ? parsed.data.validUntil : null,
      job_id: parsed.data.jobId && parsed.data.jobId.length > 0 ? parsed.data.jobId : null,
    })
    .select('id')
    .single();

  if (insertErr || !data) {
    console.error('[uploadVaultDocumentAction] insert failed:', insertErr?.message);
    // Best-effort cleanup of orphaned storage object
    await supabase.storage.from('client_documents').remove([path]);
    return { ok: false, error: `Could not save document: ${insertErr?.message ?? 'unknown'}` };
  }

  revalidateVaultPaths(data.id);
  return { ok: true, error: null, message: 'Document uploaded.', documentId: data.id };
}

// ─── 2. Update metadata ────────────────────────────────────────────────
export async function updateVaultMetadataAction(
  _prev: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  const parsed = UpdateSchema.safeParse({
    documentId: formData.get('documentId'),
    label: formData.get('label'),
    category: formData.get('category'),
    validFrom: formData.get('validFrom') ?? '',
    validUntil: formData.get('validUntil') ?? '',
    notes: formData.get('notes') ?? '',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { supabase, user } = await getAuthedUser();
  if (!user) return { ok: false, error: 'You must be signed in.' };

  const { error } = await supabase
    .from('client_documents')
    .update({
      label: parsed.data.label,
      category: parsed.data.category,
      notes: parsed.data.notes && parsed.data.notes.length > 0 ? parsed.data.notes : null,
      valid_from: parsed.data.validFrom && parsed.data.validFrom.length > 0 ? parsed.data.validFrom : null,
      valid_until: parsed.data.validUntil && parsed.data.validUntil.length > 0 ? parsed.data.validUntil : null,
    })
    .eq('id', parsed.data.documentId);

  if (error) {
    return { ok: false, error: friendly(error.message) };
  }
  revalidateVaultPaths(parsed.data.documentId);
  return { ok: true, error: null, message: 'Document updated.' };
}

// ─── 3. Archive / 4. Restore ───────────────────────────────────────────
export async function archiveVaultDocumentAction(
  _prev: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  const parsed = ToggleSchema.safeParse({ documentId: formData.get('documentId') });
  if (!parsed.success) return { ok: false, error: 'Invalid id.' };
  const { supabase } = await getAuthedUser();
  const { error } = await supabase
    .from('client_documents')
    .update({ is_archived: true })
    .eq('id', parsed.data.documentId);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateVaultPaths(parsed.data.documentId);
  return { ok: true, error: null, message: 'Document archived.' };
}

export async function restoreVaultDocumentAction(
  _prev: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  const parsed = ToggleSchema.safeParse({ documentId: formData.get('documentId') });
  if (!parsed.success) return { ok: false, error: 'Invalid id.' };
  const { supabase } = await getAuthedUser();
  const { error } = await supabase
    .from('client_documents')
    .update({ is_archived: false })
    .eq('id', parsed.data.documentId);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateVaultPaths(parsed.data.documentId);
  return { ok: true, error: null, message: 'Document restored.' };
}

// ─── 5. Admin verify ───────────────────────────────────────────────────
export async function verifyVaultDocumentAction(
  _prev: VaultActionState,
  formData: FormData,
): Promise<VaultActionState> {
  const parsed = VerifySchema.safeParse({
    documentId: formData.get('documentId'),
    verified: formData.get('verified'),
  });
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  if (!(await isAdmin())) {
    return { ok: false, error: 'Only admins can verify compliance documents.' };
  }
  const { supabase, user } = await getAuthedUser();
  const isVerified = parsed.data.verified === 'true';
  const { error } = await supabase
    .from('client_documents')
    .update({
      is_verified: isVerified,
      verified_by: isVerified ? user?.id ?? null : null,
      verified_at: isVerified ? new Date().toISOString() : null,
    })
    .eq('id', parsed.data.documentId);
  if (error) return { ok: false, error: friendly(error.message) };
  revalidateVaultPaths(parsed.data.documentId);
  return {
    ok: true,
    error: null,
    message: isVerified ? 'Document verified.' : 'Verification revoked.',
  };
}

function friendly(msg: string): string {
  if (msg.includes('row-level security')) return 'You do not have permission for this action.';
  return `Could not update document: ${msg}`;
}
