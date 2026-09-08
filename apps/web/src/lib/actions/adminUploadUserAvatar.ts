'use server';

// ════════════════════════════════════════════════════════════════════════════
//  adminUploadUserAvatar.ts — an admin replaces a USER's profile photo.
//
//  This exists because uploadAvatar.ts is self-service: it resolves its target
//  with auth.getUser() and writes `.eq('id', user.id)`. An admin using it would
//  have replaced their OWN photo. Actor and subject are kept strictly separate
//  here: `userId` is the subject, auth.getUser() is only ever the actor.
//
//  Ordering is deliberate — the previous photo is never at risk:
//    1. validate type and size
//    2. upload the NEW object under a fresh timestamped key
//    3. only if that succeeds, point profiles.avatar_url at it
//    4. if the pointer write fails, remove the new object and keep the old one
//  The old object is not deleted at all, so a stale CDN copy can never leave
//  the user with no picture. The timestamped key also defeats CDN caching, so
//  a successful save cannot look like a failure.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const BUCKET = 'avatars';
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

export interface AdminAvatarState {
  ok?: boolean;
  error?: string;
  url?: string;
}

export async function adminUploadUserAvatar(
  _prev: AdminAvatarState,
  formData: FormData,
): Promise<AdminAvatarState> {
  const userId = String(formData.get('userId') ?? '');
  const file = formData.get('avatar');

  if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: 'Invalid user id.' };
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Choose an image first.' };
  }
  if (file.size > MAX_BYTES) {
    return {
      error: `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`,
    };
  }
  const ext = ALLOWED.get(file.type);
  if (!ext) {
    return { error: 'Use a JPG, PNG, WebP or GIF image.' };
  }

  const supabase = await createSupabaseServerClient();

  // Server-side admin re-check. Hiding the control proves nothing.
  const { data: isAdmin } = await supabase.rpc('nx_is_admin');
  if (isAdmin !== true) return { error: 'Not authorised.' };

  const { data: actorRes } = await supabase.auth.getUser();
  const actorId = actorRes?.user?.id ?? null;
  if (!actorId) return { error: 'Your session has expired. Sign in again.' };

  // The SUBJECT must exist, and its current photo is captured for the audit.
  const { data: before } = await supabase
    .from('profiles')
    .select('id, avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (!before) return { error: 'That user no longer exists.' };

  // Fresh timestamped key under the SUBJECT's folder — never the actor's.
  const path = `${userId}/avatar-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (upErr) {
    return { error: 'The image could not be uploaded. The previous photo is unchanged.' };
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) {
    await supabase.storage.from(BUCKET).remove([path]);
    return { error: 'Could not resolve the image URL. The previous photo is unchanged.' };
  }

  // .select() so an RLS-denied write is a visible failure, not a false success.
  const { data: rows, error: dbErr } = await supabase
    .from('profiles')
    .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id');

  if (dbErr || !rows || rows.length === 0) {
    // Roll the object back so a failed save leaves no orphan, and the user
    // keeps the photo they had.
    await supabase.storage.from(BUCKET).remove([path]);
    return {
      error: dbErr
        ? 'Could not save the new photo. The previous one is unchanged.'
        : 'No record was updated — permission denied. The previous photo is unchanged.',
    };
  }

  await supabase.from('audit_events').insert({
    event_type: 'admin_user.avatar_replaced',
    severity: 'warning',
    actor_id: actorId,
    subject_id: userId,
    subject_table: 'profiles',
    summary: "Admin replaced the user's profile photo.",
    metadata: {
      source: 'admin_assisted',
      // Both identities recorded, so actor is never mistaken for subject.
      actor_id: actorId,
      subject_id: userId,
      before: { avatar_url: before.avatar_url ?? null },
      after: { avatar_url: publicUrl },
      // A photo is not identity verification.
      note: 'Profile photo only. This is not identity or credential verification.',
    },
  });

  revalidatePath(`/admin/users/${userId}`);
  return { ok: true, url: publicUrl };
}
