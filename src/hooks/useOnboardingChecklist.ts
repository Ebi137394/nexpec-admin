// ════════════════════════════════════════════════════════════════════════════
//  src/hooks/useOnboardingChecklist.ts
//
//  Sprint 13.M1 — mobile parity of the web onboarding-checklist hook.
//
//  Derives per-role step completion from existing profile / certificates /
//  jobs data so the only persisted state is profiles.onboarding_checklist_dismissed_at
//  (column shipped in 13.1's migration). Mirrors the web fetcher's step
//  definitions exactly so the two surfaces never disagree on whether a
//  step is done.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/src/contexts/AuthContext';

export interface ChecklistStep {
  key: string;
  title: string;
  description?: string;
  completed: boolean;
  /** Expo-Router href for the CTA. Optional. */
  href?: string;
  ctaLabel?: string;
}

export interface OnboardingChecklist {
  role: string;
  steps: ChecklistStep[];
  completed: number;
  total: number;
  percent: number;
  dismissed: boolean;
}

const CLIENT_LIKE = new Set(['client', 'agency', 'enterprise']);
const ADMIN_LIKE = new Set(['admin', 'super_admin', 'support']);

interface State {
  data: OnboardingChecklist | null;
  loading: boolean;
  error: string | null;
}

export function useOnboardingChecklist() {
  const { user, role: ctxRole } = useAuth();
  const [state, setState] = useState<State>({
    data: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    if (!user?.id) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      // Fetch the wide profile row (RLS allows self-read).
      const { data: pRaw, error: pErr } = await supabase
        .from('profiles')
        .select(
          'id, role, full_name, headline, location_city, travel_radius_km, ' +
            'specialty_slugs, avatar_url, country_of_residence, work_authorized_countries, ' +
            'company_name, contact_person_name, terms_accepted_at, ' +
            'onboarding_checklist_dismissed_at',
        )
        .eq('id', user.id)
        .maybeSingle();

      if (pErr || !pRaw) {
        setState({
          data: null,
          loading: false,
          error: pErr?.message ?? null,
        });
        return;
      }

      const p = pRaw as ProfileShape;
      const role = (p.role ?? ctxRole ?? 'client').toString().toLowerCase();

      // Admins do not see a checklist.
      if (ADMIN_LIKE.has(role)) {
        setState({ data: null, loading: false, error: null });
        return;
      }

      let steps: ChecklistStep[] = [];
      if (role === 'inspector') {
        steps = await buildInspectorSteps(user.id, p);
      } else if (CLIENT_LIKE.has(role)) {
        steps = await buildClientSteps(user.id, p, role);
      } else {
        steps = [];
      }

      const completed = steps.filter((s) => s.completed).length;
      const total = steps.length;
      const percent =
        total === 0 ? 0 : Math.round((completed / total) * 100);

      setState({
        data: {
          role,
          steps,
          completed,
          total,
          percent,
          dismissed: !!p.onboarding_checklist_dismissed_at,
        },
        loading: false,
        error: null,
      });
    } catch (err) {
      setState({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [user?.id, ctxRole]);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = useCallback(async () => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('profiles')
      .update({
        onboarding_checklist_dismissed_at: new Date().toISOString(),
      })
      .eq('id', user.id);
    if (!error) await load();
  }, [user?.id, load]);

  const restore = useCallback(async () => {
    if (!user?.id) return;
    const { error } = await supabase
      .from('profiles')
      .update({ onboarding_checklist_dismissed_at: null })
      .eq('id', user.id);
    if (!error) await load();
  }, [user?.id, load]);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    refresh: load,
    dismiss,
    restore,
  };
}

/* ─────────────────────────────────────────────────────────────────── */

interface ProfileShape {
  id: string;
  role: string | null;
  full_name: string | null;
  headline: string | null;
  location_city: string | null;
  travel_radius_km: number | null;
  specialty_slugs: string[] | null;
  avatar_url: string | null;
  country_of_residence: string | null;
  work_authorized_countries: string[] | null;
  company_name: string | null;
  contact_person_name: string | null;
  terms_accepted_at: string | null;
  onboarding_checklist_dismissed_at: string | null;
}

async function buildInspectorSteps(
  userId: string,
  p: ProfileShape,
): Promise<ChecklistStep[]> {
  const specialties = p.specialty_slugs ?? [];
  const workAuth = p.work_authorized_countries ?? [];

  let certCount = 0;
  try {
    const { count } = await supabase
      .from('inspector_certificates')
      .select('id', { count: 'exact', head: true })
      .eq('inspector_id', userId);
    certCount = count ?? 0;
  } catch {
    // ignore — step shows as incomplete
  }

  const basicsDone =
    Boolean(p.full_name?.trim()) &&
    Boolean(p.headline?.trim()) &&
    Boolean(p.location_city?.trim()) &&
    (p.travel_radius_km ?? 0) > 0;

  return [
    {
      key: 'profile_basics',
      title: 'Complete profile basics',
      description: 'Headline, city, travel radius.',
      completed: basicsDone,
      href: '/(inspector)/profile/edit',
      ctaLabel: basicsDone ? 'Review' : 'Add details',
    },
    {
      key: 'three_specialties',
      title: 'Pick at least 3 specialties',
      description: 'The match engine routes jobs by overlap.',
      completed: specialties.length >= 3,
      href: '/(inspector)/profile/specialties',
      ctaLabel: 'Choose',
    },
    {
      key: 'one_certification',
      title: 'Upload at least one certification',
      description: 'Verifies you for credential-gated scopes.',
      completed: certCount > 0,
      href: '/(inspector)/compliance',
      ctaLabel: 'Upload',
    },
    {
      key: 'work_eligibility',
      title: 'Set work eligibility',
      description: 'Country of residence + authorized countries.',
      completed:
        Boolean(p.country_of_residence?.trim()) && workAuth.length > 0,
      href: '/(inspector)/profile/edit',
      ctaLabel: 'Set',
    },
    {
      key: 'avatar',
      title: 'Add a profile photo',
      description: 'Profiles with photos get more acceptances.',
      completed: Boolean(p.avatar_url),
      href: '/(inspector)/profile/edit',
      ctaLabel: 'Upload',
    },
  ];
}

async function buildClientSteps(
  userId: string,
  p: ProfileShape,
  role: string,
): Promise<ChecklistStep[]> {
  const isOrg = role === 'agency' || role === 'enterprise';
  const basicsDone =
    Boolean(p.full_name?.trim()) &&
    Boolean(p.contact_person_name?.trim()) &&
    (!isOrg || Boolean(p.company_name?.trim()));

  let jobCount = 0;
  let hiredCount = 0;
  try {
    const j = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', userId)
      .is('deleted_at', null);
    jobCount = j.count ?? 0;
  } catch {
    // ignore
  }
  try {
    const h = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', userId)
      .not('assigned_inspector_id', 'is', null)
      .is('deleted_at', null);
    hiredCount = h.count ?? 0;
  } catch {
    // ignore
  }

  return [
    {
      key: 'profile_basics',
      title: isOrg
        ? 'Add contact + company details'
        : 'Complete contact profile',
      description: 'Shown on every job post.',
      completed: basicsDone,
      href: '/(tabs)/profile',
      ctaLabel: basicsDone ? 'Review' : 'Add',
    },
    {
      key: 'terms_accepted',
      title: 'Accept the latest terms',
      description: 'Required for posting jobs.',
      completed: Boolean(p.terms_accepted_at),
      href: '/legal/terms',
      ctaLabel: 'Read',
    },
    {
      key: 'avatar',
      title: 'Upload a logo or photo',
      description: 'Helps inspectors recognise your org.',
      completed: Boolean(p.avatar_url),
      href: '/(tabs)/profile',
      ctaLabel: 'Upload',
    },
    {
      key: 'first_job',
      title: 'Post your first job',
      description: '57 scope templates across 5 domains.',
      completed: jobCount > 0,
      href: '/post-new-job',
      ctaLabel: 'Post',
    },
    {
      key: 'first_hire',
      title: 'Accept your first inspector',
      description: 'Closes the trust loop on the marketplace.',
      completed: hiredCount > 0,
      href: '/(tabs)/jobs',
      ctaLabel: 'Review',
    },
  ];
}
