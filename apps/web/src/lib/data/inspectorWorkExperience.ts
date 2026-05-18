// ════════════════════════════════════════════════════════════════════════════
//  lib/data/inspectorWorkExperience.ts — current inspector's work history
//
//  RLS allows public SELECT (so admin/client review surfaces can pick it
//  up later), but this fetcher is intentionally scoped to the current
//  inspector. Other-user views should use a different fetcher with an
//  explicit inspectorId argument.
// ════════════════════════════════════════════════════════════════════════════

import { createSupabaseServerClient } from '@/lib/supabase/server';
import type { InspectorWorkExperience } from './inspectorWorkExperience.types';

export type { InspectorWorkExperience };

export async function fetchInspectorWorkExperience(): Promise<
  InspectorWorkExperience[]
> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from('inspector_work_experience')
      .select(
        'id, company, title, location, start_date, end_date, is_current, description, achievements, created_at, updated_at',
      )
      .eq('inspector_id', user.id)
      .order('is_current', { ascending: false })
      .order('start_date', { ascending: false });

    if (error || !data) {
      if (error && typeof console !== 'undefined') {
        console.warn('[fetchInspectorWorkExperience] failed:', error.message);
      }
      return [];
    }

    const rows = data as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: String(r.id),
      company: String(r.company ?? ''),
      title: String(r.title ?? ''),
      location: (r.location as string | null) ?? null,
      startDate: String(r.start_date ?? ''),
      endDate: (r.end_date as string | null) ?? null,
      isCurrent: Boolean(r.is_current),
      description: (r.description as string | null) ?? null,
      achievements: Array.isArray(r.achievements)
        ? (r.achievements as string[])
        : [],
      createdAt: String(r.created_at ?? ''),
      updatedAt: String(r.updated_at ?? ''),
    }));
  } catch (e) {
    if (typeof console !== 'undefined') {
      console.warn('[fetchInspectorWorkExperience] threw:', e);
    }
    return [];
  }
}
