// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/actions/onboardingChecklist.ts
//
//  Server actions for the onboarding-checklist widget. Two operations:
//    1. dismiss — hide the checklist from the dashboard
//    2. restore — show it again (used by the small "Show checklist" link
//                 that renders when dismissed)
//
//  Both write to profiles.onboarding_checklist_dismissed_at. RLS on
//  profiles already restricts UPDATE to the row owner (id = auth.uid())
//  + admins, so the action is purely an authenticated wrapper around
//  the write.
// ════════════════════════════════════════════════════════════════════════════

'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export interface ChecklistActionResult {
  ok: boolean;
  error?: string;
}

async function getAuthedUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** Hide the onboarding checklist from the dashboard for the current user. */
export async function dismissOnboardingChecklist(): Promise<ChecklistActionResult> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_checklist_dismissed_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/client/dashboard');
  revalidatePath('/inspector/dashboard');
  return { ok: true };
}

/** Restore (un-dismiss) the onboarding checklist for the current user. */
export async function restoreOnboardingChecklist(): Promise<ChecklistActionResult> {
  const userId = await getAuthedUserId();
  if (!userId) return { ok: false, error: 'Not authenticated.' };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from('profiles')
    .update({ onboarding_checklist_dismissed_at: null })
    .eq('id', userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/client/dashboard');
  revalidatePath('/inspector/dashboard');
  return { ok: true };
}
