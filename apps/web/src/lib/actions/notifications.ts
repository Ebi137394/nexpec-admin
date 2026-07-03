// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/notifications.ts — mark-read actions (RPC-backed)
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const ReadOneSchema = z.object({
  id: z.string().uuid(),
  returnTo: z.string().min(1),
});

export async function markNotificationRead(formData: FormData): Promise<void> {
  const parsed = ReadOneSchema.safeParse({
    id: formData.get('id'),
    returnTo: formData.get('returnTo'),
  });
  const fallback = (formData.get('returnTo') as string) || '/notifications';
  if (!parsed.success) redirect(fallback);

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(parsed.data.returnTo));

  const { error } = await supabase.rpc('nx_mark_notification_read', { p_id: parsed.data.id });
  if (error) console.error('[notifications] nx_mark_notification_read failed:', error.message);
  revalidatePath(parsed.data.returnTo);
  redirect(parsed.data.returnTo);
}

export async function markAllNotificationsRead(formData: FormData): Promise<void> {
  const returnTo = (formData.get('returnTo') as string) || '/notifications';
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=' + encodeURIComponent(returnTo));
  const { error } = await supabase.rpc('nx_mark_all_notifications_read');
  if (error) console.error('[notifications] nx_mark_all_notifications_read failed:', error.message);
  revalidatePath(returnTo);
  redirect(returnTo);
}
