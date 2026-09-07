// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/adminUploadUserDocument.ts — Admin-assisted document upload
//
//  An inspector who emails a certificate, or posts it into Help & Support,
//  had no route into the system: only the owner's own device could upload.
//  This lets an Admin file it for them.
//
//  SAME SYSTEM, NOT A PARALLEL ONE
//  ───────────────────────────────
//  Files land in the canonical `inspector-docs` bucket under the OWNER's
//  folder, and metadata lands in the canonical public.inspector_documents
//  table. The only difference from a self-upload is provenance:
//    uploaded_by    = the acting admin
//    upload_source  = 'admin_assisted'
//    upload_reason  = why, in the admin's words
//  inspector_id stays the owner, so ownership, RLS and every existing reader
//  behave exactly as they do for a self-upload.
//
//  The document is created with status 'pending'. Filing a document is NOT
//  reviewing it — an admin-uploaded certificate is unverified evidence until
//  the credential-review path says otherwise.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BUCKET = 'inspector-docs';
const MAX_BYTES = 20 * 1024 * 1024;

/** Mirrors the bucket's allowed_mime_types in Production. */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const DOC_KINDS = new Set([
  'cv',
  'certificate',
  'compliance',
  'evidence',
  'other',
]);

function back(userId: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `/admin/users/${userId}${qs ? `?${qs}` : ''}`;
}

export async function adminUploadUserDocument(formData: FormData): Promise<void> {
  const userId = String(formData.get('userId') ?? '');
  const docName = String(formData.get('docName') ?? '').trim();
  const kindRaw = String(formData.get('kind') ?? 'other').trim().toLowerCase();
  const reason = String(formData.get('reason') ?? '').trim();
  const expiry = String(formData.get('expiryDate') ?? '').trim();
  const file = formData.get('document');

  if (!/^[0-9a-f-]{36}$/i.test(userId)) redirect('/admin/users');

  const kind = DOC_KINDS.has(kindRaw) ? kindRaw : 'other';

  if (!(file instanceof File) || file.size === 0) {
    redirect(back(userId, { error: 'No document selected.' }));
  }
  if (file.size > MAX_BYTES) {
    redirect(back(userId, { error: 'Document exceeds 20 MB.' }));
  }
  if (!ALLOWED_MIME.has(file.type)) {
    redirect(
      back(userId, {
        error: 'Document must be a PDF, Word/Excel file, or an image.',
      }),
    );
  }
  if (docName.length === 0 || docName.length > 200) {
    redirect(back(userId, { error: 'Give the document a name (1–200 chars).' }));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: isAdmin } = await supabase.rpc('nx_is_admin');
  if (!isAdmin) redirect('/');

  // Confirm the subject exists before writing anything into their folder.
  const { data: subject } = await supabase
    .from('profiles')
    .select('id, email')
    .eq('id', userId)
    .maybeSingle();
  if (!subject) redirect(back(userId, { error: 'That user does not exist.' }));

  const ext =
    (file.name.split('.').pop() ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') ||
    'pdf';
  // Owner's folder, exactly as a self-upload would be.
  const path = `${userId}/${kind}-${Date.now()}.${ext}`;

  const buf = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: false });

  if (uploadErr) {
    if (typeof console !== 'undefined') {
      console.error('[adminUploadUserDocument] storage failed', {
        path,
        message: uploadErr.message,
      });
    }
    redirect(back(userId, { error: `Upload failed: ${uploadErr.message}` }));
  }

  // `.select()` makes the metadata write authoritative. If it does not land,
  // the object is removed rather than left orphaned in the bucket — an
  // orphaned file is invisible to every reader and looks like data loss.
  const { data: inserted, error: insertErr } = await supabase
    .from('inspector_documents')
    .insert({
      inspector_id: userId,
      doc_name: docName,
      kind,
      file_url: path,
      file_path: path,
      expiry_date: expiry.length > 0 ? expiry : null,
      status: 'pending',
      uploaded_by: user.id,
      upload_source: 'admin_assisted',
      upload_reason: reason.length > 0 ? reason : null,
    })
    .select('id')
    .maybeSingle();

  if (insertErr || !inserted) {
    await supabase.storage.from(BUCKET).remove([path]);
    if (typeof console !== 'undefined') {
      console.error('[adminUploadUserDocument] metadata failed, rolled back', {
        path,
        message: insertErr?.message,
      });
    }
    redirect(
      back(userId, {
        error: `Document could not be filed${
          insertErr ? `: ${insertErr.message}` : ''
        }. Nothing was stored.`,
      }),
    );
  }

  await supabase.from('audit_events').insert({
    event_type: 'admin_user.document_uploaded',
    severity: 'warning',
    actor_id: user.id,
    subject_table: 'inspector_documents',
    subject_id: userId,
    summary: `Admin filed a ${kind} document on behalf of the user: ${docName}`,
    delta: { document_id: inserted.id, storage_path: path },
    metadata: {
      source: 'admin_assisted',
      kind,
      doc_name: docName,
      reason: reason.length > 0 ? reason : null,
      // Filed, not reviewed. Recorded so nobody later reads this as a
      // verification event.
      review_status: 'pending',
    },
  });

  await supabase.rpc('nx_admin_notify_profile_edit', {
    p_user_id: userId,
    p_summary: `we filed a document you sent us (${docName}). It is awaiting review.`,
  });

  revalidatePath(`/admin/users/${userId}`);
  redirect(back(userId, { saved: '1' }));
}
