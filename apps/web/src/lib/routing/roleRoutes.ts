// ════════════════════════════════════════════════════════════════════════════
//  roleRoutes — the ONE place that maps a role to a real web route.
//
//  WHY THIS EXISTS. Two separate incidents on 2026-09-07 had the same shape: a
//  role-to-path mapping written down a second time, in a second place, and
//  allowed to drift.
//
//    1. nx_role_profile_path() returned '/client/profile' and
//       '/inspector/profile'. Neither had ever existed. A second copy,
//       nx_profile_path(), was still returning them after the first was fixed.
//    2. notify_on_new_message() hard-coded '/client/messages/<id>' for every
//       recipient, so 16 inspectors and 1 supplier were sent to a route
//       middleware refuses them.
//
//  Both were "a constant that looked right". The fix is not a better constant
//  in more places — it is ONE table, used by every canonical redirect route,
//  resolved from the live session at click time rather than baked into a link
//  that outlives the role it was written for.
//
//  Every destination below is asserted against the real route table by
//  scripts/qa/check-notification-links.mjs on every run.
// ════════════════════════════════════════════════════════════════════════════

type RoleBucket = 'client' | 'inspector' | 'supplier' | 'admin';

/** src/middleware.ts gates CLIENT_PREFIX to client/agency/enterprise/admin/
 *  super_admin, so agency and enterprise belong in the client bucket — they
 *  share its routes and pass the same gate. */
export function roleBucket(role: string | null | undefined): RoleBucket {
  const r = (role ?? '').trim().toLowerCase();
  if (r === 'inspector' || r === 'senior') return 'inspector';
  if (r === 'supplier') return 'supplier';
  if (r === 'admin' || r === 'super_admin') return 'admin';
  return 'client'; // client, agency, enterprise, and anything unrecognised
}

/** `base` is the list/home page for that role. `item` says whether `base/<id>`
 *  is a real route — appending an id where it is not would just swap one 404
 *  for another, which is the failure this module exists to remove.
 *
 *  Every `item: true` below was checked against the production build's route
 *  table, not assumed. */
type Dest = { base: string; item: boolean };

const TABLE = {
  // Unified inbox. Mobile has one screen (app/messages, app/inbox); web splits
  // it per role, which is why a raw link can never be right for everyone.
  messages: {
    client: { base: '/client/messages', item: true },
    inspector: { base: '/inspector/messages', item: true },
    supplier: { base: '/suppliers/messages', item: true },
    admin: { base: '/admin/messages', item: true },
  },
  jobs: {
    client: { base: '/client/jobs', item: true },
    inspector: { base: '/inspector/jobs', item: true },
    // Suppliers don't own the inspection job — it is admin-brokered between the
    // assigned inspector and the buyer — so they go to where they track
    // outcomes. There is no per-job page for them; the id is dropped.
    // (Behaviour preserved from the original /jobs/[id] resolver.)
    supplier: { base: '/suppliers/bids', item: false },
    admin: { base: '/admin/jobs', item: true },
  },
  // Contract detail is nested and differs per role —
  // /client/contracts/job/[id], /admin/contracts/agreement/[id],
  // /suppliers/contracts/[id] — so no single id shape is correct for everyone.
  // Only the supplier route takes a bare id.
  contracts: {
    client: { base: '/client/contracts', item: false },
    inspector: { base: '/inspector/contracts', item: false },
    supplier: { base: '/suppliers/contracts', item: true },
    admin: { base: '/admin/contracts', item: false },
  },
  // No role has a dispute detail page on web. Suppliers have no dispute surface
  // at all, so they go to the support desk they do have.
  disputes: {
    client: { base: '/client/disputes', item: false },
    inspector: { base: '/inspector/disputes', item: false },
    supplier: { base: '/suppliers/support', item: false },
    admin: { base: '/admin/disputes', item: false },
  },
  // No role has a per-submission page; the submission is listed on the panel.
  talent: {
    client: { base: '/client/talent', item: false },
    inspector: { base: '/inspector/talent', item: false },
    supplier: { base: '/suppliers/opportunities', item: false },
    admin: { base: '/admin/talent', item: false },
  },
  // Profile "home" per role. Note these are settings pages, not /*/profile —
  // that mismatch was incident #1.
  profile: {
    client: { base: '/client/settings', item: false },
    inspector: { base: '/inspector/settings', item: false },
    supplier: { base: '/suppliers/profile', item: false },
    admin: { base: '/admin/dashboard', item: false },
  },
  // `satisfies` rather than a Record<string, …> annotation: it validates every
  // entry's shape while keeping the literal key set, so RouteFamily is the
  // exact union of families and TABLE[family][bucket] is known to exist.
} satisfies Record<string, Record<RoleBucket, Dest>>;

export type RouteFamily = keyof typeof TABLE;

function dest(family: RouteFamily, role: string | null | undefined): Dest {
  return TABLE[family][roleBucket(role)];
}

/** Base path for a family, for the bucket this role falls into. */
export function baseFor(family: RouteFamily, role: string | null | undefined): string {
  return dest(family, role).base;
}

/** Full path for a record, dropping the id when that role has no detail route. */
export function itemPathFor(
  family: RouteFamily,
  role: string | null | undefined,
  id: string,
): string {
  const d = dest(family, role);
  return d.item ? `${d.base}/${encodeURIComponent(id)}` : d.base;
}

/** Every destination this module can emit, for the link guard. */
export const ALL_DESTINATIONS: readonly string[] = Object.values(TABLE).flatMap((m) =>
  Object.values(m).map((d) => d.base),
);
