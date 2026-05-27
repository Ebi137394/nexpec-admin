// ════════════════════════════════════════════════════════════════════════════
//  app/client/structure/page.tsx
//  Enterprise-client self-service department tree.
//
//  Mirrors /admin/orgs/[id]/structure but scoped to the caller's own org:
//
//    1. Resolves the caller's org membership(s) via org_members.
//    2. If they belong to multiple orgs, picks the one where they hold an
//       "elevated" role (owner / procurement_admin) first, then the first
//       enterprise, then anything.
//    3. Decides `readOnly` from that membership's role: only owners and
//       procurement_admins can mutate — this matches the can_manage_org_structure
//       helper enforced server-side in 20260527120000.
//    4. Hands the same OrgStructureWorkspace component the tree + assignable
//       member roster. Mutations call the same server actions; the RPCs
//       authorise via the elevated-role check, so client + admin share the
//       exact same code path.
//
//  Super-admin oversight is preserved: every mutation still writes an
//  audit_events row tagged with org_id, so `/admin/orgs/[id]/structure`
//  sees the entire history regardless of which surface drove the change.
// ════════════════════════════════════════════════════════════════════════════

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2, FolderTree, ShieldCheck } from 'lucide-react';

import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  fetchOrgStructure,
  fetchAssignableOrgMembers,
  fetchMyOrgMemberships,
  resolveActiveOrgId,
} from '@/lib/data/orgStructure';
import { OrgStructureWorkspace } from '@/components/admin/orgs/structure/OrgStructureWorkspace';

export const metadata: Metadata = { title: 'Organization Structure' };
export const dynamic = 'force-dynamic';

const ELEVATED_ORG_ROLES = new Set(['owner', 'procurement_admin']);

interface MembershipRow {
  org_id: string;
  role: string;
  org_name: string;
  org_kind: string | null;
}

export default async function ClientStructurePage() {
  const supabase = await createSupabaseServerClient();

  // ── 1. Resolve the user ─────────────────────────────────────────────
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      '/sign-in?next=' + encodeURIComponent('/client/structure'),
    );
  }

  // ── 2. Find the user's org memberships ──────────────────────────────
  // Some setups have profiles.role = 'super_admin' for the platform owner.
  // They may not be in org_members for any specific org but should still
  // be able to use this page — they go to /admin/orgs anyway, but we
  // don't want to 500 if they wander here.
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  const isSuperAdmin =
    (profile?.role ?? '').toString().trim().toLowerCase() === 'super_admin';

  // Sprint 6 — replace the local election with the central resolver.
  // The resolver honours profiles.active_org_id (set via the workspace
  // switcher) before falling back to the elected default.
  const richMemberships = await fetchMyOrgMemberships();
  const memberships: MembershipRow[] = richMemberships.map((m) => ({
    org_id: m.org_id,
    role: m.role ?? 'viewer',
    org_name: m.org_name,
    org_kind: m.org_kind,
  }));

  // ── 3. No memberships? Render an empty-state instead of crashing. ─
  if (!isSuperAdmin && memberships.length === 0) {
    return <NoMembershipState />;
  }

  // ── 4. Resolve the active membership — pinned first, then elected. ─
  const activeOrgId = await resolveActiveOrgId();
  const active =
    memberships.find((m) => m.org_id === activeOrgId) ??
    memberships[0] ??
    null;

  // Super admin without memberships gets a soft landing pointing to the
  // admin surface — they shouldn't be managing client surfaces here.
  if (!active) {
    return <SuperAdminLandingState />;
  }

  const isReadOnly = !ELEVATED_ORG_ROLES.has(active.role) && !isSuperAdmin;

  // ── 5. Load the tree + assignable members (parallel) ────────────────
  const [tree, assignable] = await Promise.all([
    fetchOrgStructure(active.org_id),
    fetchAssignableOrgMembers(active.org_id),
  ]);

  // ── 6. Render ──────────────────────────────────────────────────────
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal · Org Structure
        </p>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mt-2 flex items-center gap-3 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet/15 text-violet-glow ring-1 ring-inset ring-violet/30">
                <Building2 className="h-5 w-5" strokeWidth={1.75} />
              </span>
              {active.org_name}
            </h1>
            <p className="mt-2 max-w-2xl text-pretty text-sm text-zinc-400">
              Map out your divisions, regions, sites, and teams. Assign
              members so spend and approvals can roll up by cost center.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-right">
            <Stat
              label="Departments"
              value={String(Object.keys(tree.byId).length)}
            />
            <Stat
              label="Org members"
              value={String(assignable.members.length)}
            />
            <Stat
              label="Your role"
              value={prettyRole(active.role)}
              tone={
                ELEVATED_ORG_ROLES.has(active.role) ? 'violet' : 'neutral'
              }
            />
          </dl>
        </div>

        {isReadOnly && (
          <p className="flex items-start gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-xs text-zinc-300">
            <ShieldCheck
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-glow"
              strokeWidth={1.75}
            />
            <span>
              You can browse the org chart. Structural changes are reserved
              for org{' '}
              <span className="font-mono text-zinc-200">owner</span> and{' '}
              <span className="font-mono text-zinc-200">procurement_admin</span>{' '}
              roles. Talk to your team owner if you need an update.
            </span>
          </p>
        )}

        {isSuperAdmin && !isReadOnly && (
          <p className="flex items-start gap-2 rounded-xl border border-cyan-glow/20 bg-cyan-glow/[0.04] px-4 py-2 text-xs text-zinc-200">
            <ShieldCheck
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-glow"
              strokeWidth={1.75}
            />
            <span>
              You&apos;re viewing the client surface as the{' '}
              <span className="font-medium text-cyan-glow">NEXPEC Platform Owner</span>.
              Any change you make is logged with your identity in the audit
              trail. The canonical platform-owner surface for cross-org work is{' '}
              <Link
                href={`/admin/orgs/${active.org_id}/structure`}
                className="text-violet-glow hover:text-white"
              >
                /admin/orgs/{active.org_id.slice(0, 8)}…/structure
              </Link>
              .
            </span>
          </p>
        )}
      </header>

      {tree.tableMissing ? (
        <TableMissingState />
      ) : (
        <OrgStructureWorkspace
          orgId={active.org_id}
          orgName={active.org_name}
          initialTree={tree}
          assignableMembers={assignable.members}
          readOnly={isReadOnly}
          surface="client"
        />
      )}

      {memberships.length > 1 && (
        <OrgSwitcherHint memberships={memberships} activeId={active.org_id} />
      )}
    </div>
  );
}

/* ─── empty + landing states ────────────────────────────────────────── */

function NoMembershipState() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-violet-glow/80">
          Client Portal · Org Structure
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          No organization linked to your account
        </h1>
      </header>
      <div className="rounded-2xl border border-dashed border-violet/30 bg-violet/[0.04] p-12 text-center">
        <FolderTree className="mx-auto h-8 w-8 text-violet-glow" strokeWidth={1.5} />
        <p className="mt-4 font-display text-lg font-semibold text-white">
          Department structure is an enterprise-org feature.
        </p>
        <p className="mt-2 mx-auto max-w-md text-pretty text-sm text-zinc-400">
          You don&apos;t belong to any organization yet. Once an enterprise
          owner invites you (or you create an org), the structure workspace
          appears here.
        </p>
      </div>
    </div>
  );
}

function SuperAdminLandingState() {
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-industrial text-cyan-glow/80">
          Platform Owner notice
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          You manage every org from the admin console.
        </h1>
      </header>
      <p className="text-sm text-zinc-400">
        This is the client surface — designed for org members managing their
        own structure. As the NEXPEC Platform Owner you have a richer view at:
      </p>
      <Link
        href="/admin/orgs"
        className="inline-flex items-center gap-2 rounded-lg bg-violet/20 px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-violet-glow ring-1 ring-inset ring-violet/40 transition-colors hover:bg-violet/30"
      >
        <Building2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        Open /admin/orgs
      </Link>
    </div>
  );
}

function TableMissingState() {
  return (
    <div className="rounded-2xl border border-dashed border-violet/30 bg-violet/[0.04] p-12 text-center">
      <p className="font-display text-lg font-semibold text-white">
        The departments schema isn&apos;t live yet.
      </p>
      <p className="mt-2 mx-auto max-w-md text-pretty text-sm text-zinc-400">
        Your platform admin needs to run the latest migrations. Reach out
        if you see this for more than a few minutes.
      </p>
    </div>
  );
}

function OrgSwitcherHint({
  memberships,
  activeId,
}: {
  memberships: MembershipRow[];
  activeId: string;
}) {
  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        Other organizations you belong to
      </p>
      <p className="mt-1 text-[11px] text-zinc-500">
        Showing the highest-privilege org for now. Multi-org switching ships
        in a later sprint.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {memberships
          .filter((m) => m.org_id !== activeId)
          .map((m) => (
            <li
              key={m.org_id}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[11px] text-zinc-400"
            >
              <Building2 className="h-3 w-3" strokeWidth={1.75} />
              <span>{m.org_name}</span>
              <span className="font-mono text-[10px] text-zinc-500">
                {m.role}
              </span>
            </li>
          ))}
      </ul>
    </section>
  );
}

function prettyRole(role: string): string {
  if (!role) return '—';
  return role
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ─── stat tile (matches the admin variant) ──────────────────────────── */

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'violet';
}) {
  const toneRing =
    tone === 'violet'
      ? 'ring-violet/30 text-violet-glow'
      : 'ring-white/[0.08] text-white';
  return (
    <div
      className={`rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 ring-1 ring-inset ${toneRing}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm">{value}</p>
    </div>
  );
}
