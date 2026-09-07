'use server';

// ════════════════════════════════════════════════════════════════════════════
//  applyCvSuggestions.ts — write ONLY the fields an admin explicitly ticked.
//
//  Why this is not a call to adminUpdateUserProfile: that action rebuilds an
//  ENTIRE section from its form and redirects. Handing it one field would blank
//  the rest of that section, and its redirect() would abort this action. So the
//  write is narrow here, while every security property of the admin editor is
//  reproduced exactly:
//
//   • server-side nx_is_admin() re-check
//   • a hard column allowlist — anything not in CV_COLUMN is unreachable
//   • before/after captured into audit_events
//   • the same nx_admin_notify_profile_edit notification to the user
//   • provenance recorded as CV extraction, so the origin of every value is
//     auditable later
//
//  Fields this action CANNOT reach, by construction: role, verification_status,
//  is_verified, suspension, balances, payouts, credentials. A certification
//  read out of a CV is never applyable, so this path cannot verify anything.
// ════════════════════════════════════════════════════════════════════════════

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** The ONLY columns a CV suggestion may ever write. */
const CV_COLUMN = {
  professional_title: 'professional_title',
  phone: 'phone',
  location: 'location',
  years_of_experience: 'years_of_experience',
  ndt_methods: 'ndt_methods',
  specialty_slugs: 'specialty_slugs',
} as const;

type CvColumnKey = keyof typeof CV_COLUMN;
const ARRAY_COLUMNS = new Set<CvColumnKey>(['ndt_methods', 'specialty_slugs']);

const MAX_LEN = 200;

export interface ApplyResult {
  ok: boolean;
  applied: number;
  error?: string;
}

export async function applyCvSuggestions(
  userId: string,
  picks: { field: string; value: string }[],
): Promise<ApplyResult> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return { ok: false, applied: 0, error: 'Invalid user id.' };
  }
  if (!Array.isArray(picks) || picks.length === 0) {
    return { ok: false, applied: 0, error: 'Nothing selected.' };
  }

  const supabase = await createSupabaseServerClient();

  const { data: isAdmin } = await supabase.rpc('nx_is_admin');
  if (isAdmin !== true) return { ok: false, applied: 0, error: 'Not authorised.' };

  const { data: actor } = await supabase.auth.getUser();
  const actorId = actor?.user?.id ?? null;

  // Build the update from the allowlist ONLY. An unknown field is dropped
  // rather than passed through.
  const update: Record<string, unknown> = {};
  const changed: string[] = [];
  for (const p of picks) {
    const key = p.field as CvColumnKey;
    if (!(key in CV_COLUMN)) continue;
    const raw = typeof p.value === 'string' ? p.value.trim() : '';
    if (!raw || raw.length > MAX_LEN) continue;

    if (ARRAY_COLUMNS.has(key)) {
      const arr = raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 40);
      if (!arr.length) continue;
      update[CV_COLUMN[key]] = arr;
    } else {
      update[CV_COLUMN[key]] = raw;
    }
    changed.push(CV_COLUMN[key]);
  }

  if (!changed.length) {
    return { ok: false, applied: 0, error: 'No supported fields were selected.' };
  }

  // Capture BEFORE, so the audit row records what the value actually was.
  const { data: before } = await supabase
    .from('profiles')
    .select(changed.join(', '))
    .eq('id', userId)
    .maybeSingle();

  update.updated_at = new Date().toISOString();

  // .select() so a zero-row (RLS-denied) update is a visible failure rather
  // than a success message over nothing.
  const { data: after, error } = await supabase
    .from('profiles')
    .update(update)
    .eq('id', userId)
    .select(changed.join(', '));

  if (error) return { ok: false, applied: 0, error: 'Could not save. Try again.' };
  if (!after || after.length === 0) {
    return { ok: false, applied: 0, error: 'Nothing was saved — permission denied.' };
  }

  await supabase.from('audit_events').insert({
    event_type: 'admin_user.cv_assisted_update',
    severity: 'warning',
    actor_id: actorId,
    subject_id: userId,
    subject_table: 'profiles',
    summary: `Admin applied ${changed.length} field(s) from the user's CV.`,
    metadata: {
      source: 'cv_extraction',
      reason: 'Applied from the CV on file after admin review',
      fields: changed,
      before: before ?? null,
      after: after[0] ?? null,
    },
  });

  // Same user-facing notification the manual editor sends.
  await supabase.rpc('nx_admin_notify_profile_edit', {
    p_user_id: userId,
    p_summary:
      'we updated your profile using details from the CV you provided. ' +
      'Please check them and let us know if anything is wrong',
  });

  revalidatePath(`/admin/users/${userId}`);
  revalidatePath('/inspector/settings');

  return { ok: true, applied: changed.length };
}
