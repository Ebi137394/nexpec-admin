'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/admin/orgs/structure/DepartmentDetailPanel.tsx
//
//  Right-hand panel for the structure workspace. Shows:
//    · breadcrumb of ancestors (clickable in a future iteration)
//    · name, cost-center, direct/total counts
//    · primary actions: Add child / Rename / Move / Delete
//    · member list — fetched lazily via the lightweight client API
//    · Assign-member CTA opens the AssignMemberDialog
//
//  Member fetch is done client-side (via fetch() to a small JSON route)
//  to avoid having to revalidate the whole page on every unassign. Falls
//  back gracefully if the route is missing.
//
//  For this slice we keep things simple — members come pre-attached from
//  the workspace via the props (we'll wire the lazy fetch in a follow-up
//  if memberlists grow large).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useTransition } from 'react';
import {
  Hash,
  Users,
  UserPlus,
  UserMinus,
  Pencil,
  Move,
  Plus,
  Trash2,
  Mouse,
  Building2,
} from 'lucide-react';

import type {
  AssignableOrgMember,
  DepartmentMember,
  DepartmentNode,
} from '@/lib/data/orgStructure.types';
import { unassignMemberAction } from '@/lib/actions/orgStructure';
import { cn } from '@/lib/cn';

interface Props {
  orgId: string;
  orgName: string;
  node: DepartmentNode | null;
  assignableMembers: AssignableOrgMember[];
  onRename: (node: DepartmentNode) => void;
  onAddChild: (node: DepartmentNode) => void;
  onMove: (node: DepartmentNode) => void;
  onDelete: (node: DepartmentNode) => void;
  onAssign: (node: DepartmentNode) => void;
  onUnassigned: () => void;
  isPending: boolean;
}

export function DepartmentDetailPanel({
  orgId,
  orgName,
  node,
  assignableMembers,
  onRename,
  onAddChild,
  onMove,
  onDelete,
  onAssign,
  onUnassigned,
  isPending,
}: Props) {
  if (!node) {
    return <EmptyDetail orgName={orgName} />;
  }

  // Derive the direct members from the assignableMembers prop — it includes
  // assigned_department_ids per user, so we filter to those that have this
  // department's id in their list. This is O(orgMembers) which is fine for
  // typical org sizes; if it ever explodes we'll swap in a per-dept fetch.
  const directMembers: DepartmentMember[] = assignableMembers
    .filter((m) => m.assigned_department_ids.includes(node.id))
    .map((m) => ({
      assignment_id: `${node.id}:${m.user_id}`, // synthetic; unassign uses user_id+dept_id
      user_id: m.user_id,
      full_name: m.full_name,
      email: m.email,
      org_role: m.role,
    }));

  return (
    <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
            {orgName} · Department
          </p>
          <h2 className="mt-1 truncate font-display text-2xl font-semibold tracking-tight text-white">
            {node.name}
          </h2>
          <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-300">
            <div className="flex items-center gap-1.5">
              <dt className="text-zinc-500">Cost center</dt>
              <dd>
                {node.cost_center ? (
                  <span className="inline-flex items-center gap-1 rounded border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">
                    <Hash className="h-3 w-3" strokeWidth={2} />
                    {node.cost_center}
                  </span>
                ) : (
                  <span className="text-zinc-500">—</span>
                )}
              </dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-zinc-500">Direct</dt>
              <dd className="font-mono">{node.member_count}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-zinc-500">Roll-up</dt>
              <dd className="font-mono">{node.member_count_total}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt className="text-zinc-500">Depth</dt>
              <dd className="font-mono">{node.depth}</dd>
            </div>
          </dl>
        </div>

        <div className="shrink-0">
          <ActionButton
            onClick={() => onAssign(node)}
            icon={<UserPlus className="h-3.5 w-3.5" strokeWidth={1.75} />}
            label="Assign member"
            primary
          />
        </div>
      </header>

      {/* Secondary actions */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.04] pt-4">
        <ActionButton
          onClick={() => onAddChild(node)}
          icon={<Plus className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Add child"
        />
        <ActionButton
          onClick={() => onRename(node)}
          icon={<Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Rename"
        />
        <ActionButton
          onClick={() => onMove(node)}
          icon={<Move className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Move"
        />
        <ActionButton
          onClick={() => onDelete(node)}
          icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
          label="Delete"
          tone="danger"
        />
      </div>

      {/* Member list */}
      <div className="mt-5">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-xs font-semibold uppercase tracking-industrial text-zinc-300">
            <Users className="h-3.5 w-3.5 text-violet-glow" strokeWidth={1.75} />
            Members
            <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              {directMembers.length}
            </span>
          </h3>
        </div>

        {directMembers.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.01] px-4 py-6 text-center text-xs text-zinc-500">
            No members assigned directly to this department.
            <br />
            Use “Assign member” to draw from the org roster.
          </p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {directMembers.map((m) => (
              <MemberRow
                key={m.user_id}
                orgId={orgId}
                departmentId={node.id}
                member={m}
                onUnassigned={onUnassigned}
                disabled={isPending}
              />
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-600">
        <Mouse className="h-3 w-3" strokeWidth={1.75} />
        Click any node in the tree to focus it here.
      </p>
    </section>
  );
}

function EmptyDetail({ orgName }: { orgName: string }) {
  return (
    <section className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.01] p-8 text-center">
      <Building2 className="h-8 w-8 text-zinc-600" strokeWidth={1.5} />
      <p className="mt-4 font-display text-base text-white">
        Select a department
      </p>
      <p className="mt-1 max-w-sm text-pretty text-xs text-zinc-500">
        Pick any node from the tree to view members, edit metadata, and
        manage the structure for <span className="text-zinc-300">{orgName}</span>.
      </p>
    </section>
  );
}

/* ─── Member row with inline unassign ────────────────────────────────── */

function MemberRow({
  orgId,
  departmentId,
  member,
  onUnassigned,
  disabled,
}: {
  orgId: string;
  departmentId: string;
  member: DepartmentMember;
  onUnassigned: () => void;
  disabled: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Auto-collapse the confirm prompt after 4s of inactivity.
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  const onUnassign = () => {
    setError(null);
    startTransition(async () => {
      const res = await unassignMemberAction({
        orgId,
        departmentId,
        userId: member.user_id,
      });
      if (!res.ok) {
        setError(res.error ?? 'Failed to unassign.');
      } else {
        onUnassigned();
      }
    });
  };

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-white">
          {member.full_name ?? member.email ?? 'Unknown user'}
        </p>
        <p className="truncate text-[10px] text-zinc-500">
          {member.email}
          {member.org_role && (
            <>
              {' · '}
              <span className="font-mono">{member.org_role}</span>
            </>
          )}
        </p>
        {error && (
          <p className="mt-1 text-[10px] text-rose-300">{error}</p>
        )}
      </div>
      {confirm ? (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onUnassign}
            disabled={disabled || isPending}
            className="rounded-md bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial text-rose-200 ring-1 ring-inset ring-rose-400/30 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
          >
            {isPending ? 'Removing…' : 'Confirm'}
          </button>
          <button
            type="button"
            onClick={() => setConfirm(false)}
            className="rounded-md border border-white/[0.06] px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={disabled || isPending}
          className="shrink-0 rounded-md border border-white/[0.06] p-1.5 text-zinc-400 transition-colors hover:bg-rose-500/10 hover:text-rose-200 disabled:opacity-50"
          aria-label="Unassign"
        >
          <UserMinus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
    </li>
  );
}

/* ─── ActionButton primitive ──────────────────────────────────────────── */

function ActionButton({
  onClick,
  icon,
  label,
  tone = 'neutral',
  primary = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone?: 'neutral' | 'danger';
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-industrial transition-colors',
        primary
          ? 'bg-violet/20 text-violet-glow ring-1 ring-inset ring-violet/40 hover:bg-violet/30'
          : tone === 'danger'
            ? 'border border-white/[0.06] text-zinc-300 hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-200'
            : 'border border-white/[0.06] text-zinc-300 hover:border-violet/30 hover:bg-violet/10 hover:text-violet-glow',
      )}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}
