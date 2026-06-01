// ════════════════════════════════════════════════════════════════════════════
//  apps/web/src/lib/data/onboardingChecklist.ts
//
//  Server-side computation of the post-signup onboarding checklist for
//  the current viewer. Every step's completion is DERIVED from existing
//  profile / related-table data at request time — no per-step schema
//  bloat, no manual maintenance, no drift between "actually done" and
//  "checklist shows done".
//
//  Persists only one bit: profiles.onboarding_checklist_dismissed_at
//  (whether the user has dismissed the whole widget). Per-step state
//  is purely derived.
//
//  Roles supported: 'inspector', 'client', 'agency', 'enterprise',
//  'super_admin' / 'admin' (returns null — admins don't onboard).
// ════════════════════════════════════════════════════════════════════════════

import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/* ─────────────────────────────────────────────────────────────────── */

export interface ChecklistStep {
  /** Stable key — never rename. */
  readonly key: string;
  /** Short title (one line). */
  readonly title: string;
  /** Optional one-line hint about why it matters. */
  readonly description?: string;
  /** True when the step is satisfied by current DB state. */
  readonly completed: boolean;
  /** When set, renders a CTA button linking to this href. */
  readonly actionHref?: string;
  /** CTA label (e.g. "Add now"). */
  readonly actionLabel?: string;
}

export interface OnboardingChecklist {
  readonly role: string;
  readonly steps: readonly ChecklistStep[];
  readonly completed: number;
  readonly total: number;
  readonly dismissed: boolean;
  /** Percentage complete (0-100, integer). */
  readonly percent: number;
}

/* ─────────────────────────────────────────────────────────────────── */

const CLIENT_LIKE_ROLES = new Set(['client', 'agency', 'enterprise']);
const ADMIN_LIKE_ROLES = new Set(['admin', 'super_admin', 'support']);

/**
 * Compute the checklist for the currently-signed-in user. Returns null
 * for admins (no onboarding flow) and for unauthenticated requests.
 *
 * Never throws — returns a shape with empty steps on partial failure so
 * the dashboard renders gracefully.
 */
export async function fetchOnboardingChecklist(): Promise<OnboardingChecklist | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return null;

  const { data: profileRaw, error: profileErr } = await supabase
    .from('profiles')
    .select(
      'id, role, full_name, headline, location_city, travel_radius_km, ' +
        'specialty_slugs, certifications, avatar_url, ' +
        'country_of_residence, work_authorized_countries, ' +
        'company_name, contact_person_name, ' +
        'terms_accepted_at, onboarding_completed_at, ' +
        'onboarding_checklist_dismissed_at',
    )
    .eq('id', user.id)
    .maybeSingle();

  if (profileErr || !profileRaw) {
    if (profileErr) {
      console.error('[onboardingChecklist] profile fetch error', profileErr);
    }
    return null;
  }

  // profileRaw is non-null here (guarded above); cast via unknown to cross
  // supabase's row | GenericStringError union without an overlap error.
  const profile = profileRaw as unknown as ProfileShape;
  const role = (profile.role ?? 'client').toString().toLowerCase();

  // Admins don't get a checklist.
  if (ADMIN_LIKE_ROLES.has(role)) return null;

  const dismissed = !!profile.onboarding_checklist_dismissed_at;

  let steps: ChecklistStep[] = [];
  if (role === 'inspector') {
    steps = await buildInspectorSteps(supabase, profile);
  } else if (CLIENT_LIKE_ROLES.has(role)) {
    steps = await buildClientSteps(supabase, profile, role);
  } else {
    // Unknown role — render empty rather than throw.
    return {
      role,
      steps: [],
      completed: 0,
      total: 0,
      dismissed,
      percent: 0,
    };
  }

  const completed = steps.filter((s) => s.completed).length;
  const total = steps.length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return {
    role,
    steps,
    completed,
    total,
    dismissed,
    percent,
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
  certifications: string[] | null;
  avatar_url: string | null;
  country_of_residence: string | null;
  work_authorized_countries: string[] | null;
  company_name: string | null;
  contact_person_name: string | null;
  terms_accepted_at: string | null;
  onboarding_completed_at: string | null;
  onboarding_checklist_dismissed_at: string | null;
}

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/* ─────────────────────────────────────────────────────────────────── */

async function buildInspectorSteps(
  supabase: ServerClient,
  p: ProfileShape,
): Promise<ChecklistStep[]> {
  const specialties = p.specialty_slugs ?? [];
  const workAuth = p.work_authorized_countries ?? [];

  // Inspector certificates — separate table; count via head:exact.
  let certCount = 0;
  try {
    const { count } = await supabase
      .from('inspector_certificates')
      .select('id', { count: 'exact', head: true })
      .eq('inspector_id', p.id);
    certCount = count ?? 0;
  } catch (err) {
    console.error('[onboardingChecklist] cert count error', err);
  }

  const basicsDone =
    Boolean(p.full_name?.trim()) &&
    Boolean(p.headline?.trim()) &&
    Boolean(p.location_city?.trim()) &&
    (p.travel_radius_km ?? 0) > 0;

  return [
    {
      key: 'profile_basics',
      title: 'Complete your inspector profile basics',
      description:
        'Headline, location, and travel radius — required for clients to find you in the directory.',
      completed: basicsDone,
      actionHref: '/inspector/settings',
      actionLabel: basicsDone ? 'Review' : 'Add details',
    },
    {
      key: 'three_specialties',
      title: 'Pick at least 3 specialties',
      description:
        'The match engine routes jobs based on the overlap with your specialty slugs.',
      completed: specialties.length >= 3,
      actionHref: '/inspector/experience',
      actionLabel: 'Choose specialties',
    },
    {
      key: 'one_certification',
      title: 'Upload at least one certification',
      description:
        'A scanned cert (CWI, API 510, NACE CIP, etc.) verifies you for credential-gated scopes.',
      completed: certCount > 0,
      actionHref: '/inspector/compliance',
      actionLabel: 'Upload',
    },
    {
      key: 'work_eligibility',
      title: 'Set your work eligibility',
      description:
        'Country of residence + the countries you are authorised to work in.',
      completed:
        Boolean(p.country_of_residence?.trim()) && workAuth.length > 0,
      actionHref: '/inspector/settings',
      actionLabel: 'Set eligibility',
    },
    {
      key: 'avatar',
      title: 'Add a profile photo',
      description:
        'Profiles with photos get noticeably more application acceptances from clients.',
      completed: Boolean(p.avatar_url),
      actionHref: '/inspector/settings',
      actionLabel: 'Upload photo',
    },
  ];
}

/* ─────────────────────────────────────────────────────────────────── */

async function buildClientSteps(
  supabase: ServerClient,
  p: ProfileShape,
  role: string,
): Promise<ChecklistStep[]> {
  const isOrgRole = role === 'agency' || role === 'enterprise';

  const profileBasicsDone =
    Boolean(p.full_name?.trim()) &&
    Boolean(p.contact_person_name?.trim()) &&
    (!isOrgRole || Boolean(p.company_name?.trim()));

  // Job count — clients only see their own jobs by RLS.
  let jobCount = 0;
  try {
    const { count } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', p.id)
      .is('deleted_at', null);
    jobCount = count ?? 0;
  } catch (err) {
    console.error('[onboardingChecklist] job count error', err);
  }

  // Hired (assigned) job — proxy for "you accepted at least one application".
  let hiredCount = 0;
  try {
    const { count } = await supabase
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', p.id)
      .not('contractor_id', 'is', null)
      .is('deleted_at', null);
    hiredCount = count ?? 0;
  } catch (err) {
    console.error('[onboardingChecklist] hired count error', err);
  }

  const baseSteps: ChecklistStep[] = [
    {
      key: 'profile_basics',
      title: isOrgRole
        ? 'Complete your contact + company details'
        : 'Complete your contact profile',
      description: isOrgRole
        ? 'Contact name and company name appear on every job post.'
        : 'Contact name appears on every job post.',
      completed: profileBasicsDone,
      actionHref: '/client/settings',
      actionLabel: profileBasicsDone ? 'Review' : 'Add details',
    },
    {
      key: 'terms_accepted',
      title: 'Accept the latest terms',
      description: 'Required for every job post and every contract sign.',
      completed: Boolean(p.terms_accepted_at),
      actionHref: '/legal/terms',
      actionLabel: 'Read terms',
    },
    {
      key: 'avatar',
      title: 'Upload a logo or photo',
      description:
        'Helps inspectors recognise your organisation in their job feed.',
      completed: Boolean(p.avatar_url),
      actionHref: '/client/settings',
      actionLabel: 'Upload',
    },
    {
      key: 'first_job',
      title: 'Post your first job',
      description:
        'Pick a domain and a scope template — the catalogue covers 57 templates across all 5 domains.',
      completed: jobCount > 0,
      actionHref: '/client/jobs/new',
      actionLabel: 'Post a job',
    },
    {
      key: 'first_hire',
      title: 'Accept your first inspector',
      description:
        'Reviewing applications and accepting one closes the trust loop and turns the job into a contract.',
      completed: hiredCount > 0,
      actionHref: '/client/jobs',
      actionLabel: 'See applications',
    },
  ];

  if (!isOrgRole) return baseSteps;

  // Agency / enterprise — additional org-setup steps.
  let orgCount = 0;
  let orgMemberCount = 0;
  try {
    const { count } = await supabase
      .from('organizations')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', p.id);
    orgCount = count ?? 0;
  } catch (err) {
    console.error('[onboardingChecklist] org count error', err);
  }
  if (orgCount > 0) {
    try {
      const { data: orgs } = await supabase
        .from('organizations')
        .select('id')
        .eq('owner_id', p.id);
      const ids = (orgs ?? []).map((o) => (o as { id: string }).id);
      if (ids.length > 0) {
        const { count } = await supabase
          .from('org_members')
          .select('id', { count: 'exact', head: true })
          .in('organization_id', ids);
        orgMemberCount = count ?? 0;
      }
    } catch (err) {
      console.error('[onboardingChecklist] org member count error', err);
    }
  }

  return [
    ...baseSteps,
    {
      key: 'organization_setup',
      title: 'Set up your organisation',
      description:
        'Required for agency / enterprise billing and team-member invites.',
      completed: orgCount > 0,
      actionHref: '/client/team',
      actionLabel: 'Create organisation',
    },
    {
      key: 'invite_team_member',
      title: 'Invite at least one team member',
      description:
        'Add a colleague so the inbox + job posts are not bottlenecked on one account.',
      completed: orgMemberCount >= 2,
      actionHref: '/client/team',
      actionLabel: 'Invite',
    },
  ];
}
