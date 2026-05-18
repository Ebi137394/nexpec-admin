// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/uploadCompanyLogo.ts — client company-logo upload
//
//  Bucket: 'branding_assets' (2MB cap, image MIME). Path scheme:
//  {userId}/logo-{ts}.{ext} — timestamped so cached CDN copies don't
//  serve stale logos after a re-upload.
//
//  Writes profiles.company_logo_url. Belongs in the client/agency/
//  enterprise UI only — not exposed on inspector surfaces.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // matches branding_assets bucket cap
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const LOGO_BUCKET = 'branding_assets';

function withQuery(path: string, params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  if (!qs) return path;
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

export async function uploadCompanyLogo(formData: FormData): Promise<void> {
  const returnTo = '/client/branding-settings';
  const file = formData.get('logo');

  if (!(file instanceof File) || file.size === 0) {
    redirect(withQuery(returnTo, { error: 'No logo file selected.' }));
  }
  if (file.size > MAX_LOGO_BYTES) {
    redirect(withQuery(returnTo, { error: 'Logo exceeds 2 MB.' }));
  }
  if (!ALLOWED_MIME.has(file.type)) {
    redirect(withQuery(returnTo, { error: 'Logo must be JPEG, PNG, or WebP.' }));
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?next=' + encodeURIComponent(returnTo));
  }

  const ext =
    (file.name.split('.').pop() ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${user.id}/logo-${Date.now()}.${ext}`;

  const buf = await file.arrayBuffer();
  const { data: uploaded, error: uploadErr } = await supabase.storage
    .from(LOGO_BUCKET)
    .upload(path, buf, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadErr || !uploaded) {
    if (typeof console !== 'undefined') {
      console.error('[uploadCompanyLogo] storage upload failed', {
        path,
        message: uploadErr?.message,
      });
    }
    redirect(withQuery(returnTo, { error: 'Logo upload failed. Try again.' }));
  }

  // branding_assets policy is unclear from the storage list; if the
  // bucket is private, getPublicUrl returns a URL that will only resolve
  // for callers with read access. The reports renderer is server-side
  // so it can use the path + signed-URL pattern if needed. For now we
  // persist the public URL form.
  const { data: pub } = supabase.storage
    .from(LOGO_BUCKET)
    .getPublicUrl(uploaded.path);

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({
      company_logo_url: pub.publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (updateErr) {
    if (typeof console !== 'undefined') {
      console.error('[uploadCompanyLogo] profile update failed', {
        code: updateErr.code,
        message: updateErr.message,
      });
    }
    redirect(
      withQuery(returnTo, {
        error: 'Logo uploaded but profile save failed.',
      }),
    );
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, { saved: '1' }));
}
