// ════════════════════════════════════════════════════════════════════════════
//  lib/actions/diagnostics.ts — one-click admin-only test helpers
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/**
 * Sends a "Diagnostics ping" notification to every admin + super_admin.
 * If the bell badge ticks up after this fires, your notifications pipeline
 * is healthy. If not, the pipeline (table, RLS, bell render) is broken.
 */
export async function pingAllAdmins(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/admin/diagnostics');

  try {
    // First try the dedicated helper if it exists
    const { error } = await supabase.rpc('notify_admins', {
      p_kind: 'system',
      p_title: '🔧 Diagnostics ping',
      p_body: `Sent from /admin/diagnostics at ${new Date().toISOString()} by ${user.email}.`,
      p_link: '/admin/diagnostics',
      p_job_id: null,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    redirect('/admin/diagnostics?error=' + encodeURIComponent(msg));
  }

  revalidatePath('/admin/diagnostics');
  revalidatePath('/notifications');
  redirect('/admin/diagnostics?ok=ping');
}

/**
 * Retro-notify every inspector about every currently-open approved job.
 * Useful after fixing RLS so the inspector feed isn't empty.
 */
export async function pingAllInspectors(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/admin/diagnostics');

  try {
    const { data: openJobs, error: jerr } = await supabase
      .from('jobs')
      .select('id, title')
      .eq('status', 'open')
      .eq('moderation_status', 'approved')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    if (jerr) throw new Error(jerr.message);

    for (const j of openJobs ?? []) {
      const id = String((j as { id?: unknown }).id ?? '');
      if (!id) continue;
      try {
        await supabase.rpc('notify_inspectors_about_existing_job', {
          p_job_id: id,
        });
      } catch {
        /* keep going */
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    redirect('/admin/diagnostics?error=' + encodeURIComponent(msg));
  }

  revalidatePath('/admin/diagnostics');
  revalidatePath('/notifications');
  redirect('/admin/diagnostics?ok=ping-inspectors');
}
