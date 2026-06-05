'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/admin/orgs/structure/StructureDialogs.tsx
//
//  All five dialogs in one file:
//    · CreateDepartmentDialog   — name + optional cost-center + parent crumb
//    · RenameDepartmentDialog   — edit name + cost-center
//    · MoveDepartmentDialog     — pick a new parent (or root); excludes
//                                  self + descendants from the picker so
//                                  the cycle guard never fires
//    · DeleteDepartmentDialog   — confirms; surfaces descendant + member
//                                  counts and the `force` checkbox when
//                                  required
//    · AssignMemberDialog       — searchable org-member picker; tags
//                                  already-assigned members
//
//  Plus a tiny <Modal> primitive shared by all five. Kept local — there
//  isn't a shared modal in the codebase yet, and feature-local primitives
//  match the patterns already in /admin/orgs/OrgMembersDrawer.
// ════════════════════════════════════════════════════════════════════════════

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import {
  X,
  AlertTriangle,
  Hash,
  Folder,
  FolderTree,
  Search,
  UserCheck,
  Check,
} from 'lucide-react';

import type {
  AssignableOrgMember,
  DepartmentNode,
  DepartmentTreeResult,
} from '@/lib/data/orgStructure.types';
import {
  assignMemberAction,
  createDepartmentAction,
  deleteDepartmentAction,
  moveDepartmentAction,
  renameDepartmentAction,
} from '@/lib/actions/orgStructure';
import { cn } from '@/lib/cn';

/* ─── DialogState (shared with workspace) ─────────────────────────────── */

export type DialogState =
  | { kind: 'none' }
  | { kind: 'create'; parentDepartmentId: string | null }
  | { kind: 'rename'; node: DepartmentNode }
  | { kind: 'move'; node: DepartmentNode }
  | { kind: 'delete'; node: DepartmentNode }
  | { kind: 'assign'; node: DepartmentNode };

/* ─── Modal primitive ─────────────────────────────────────────────────── */

function Modal({
  title,
  subtitle,
  onClose,
  children,
  size = 'md',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  // Close on Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Prevent body scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const sizeClass =
    size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"
      />
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/95 shadow-2xl',
          sizeClass,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate font-display text-base font-semibold text-white">
              {title}
            </h3>
            {subtitle && (
              <p className="mt-0.5 truncate text-xs text-zinc-400">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/* ─── Shared form primitives ──────────────────────────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[10px] text-zinc-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-violet/40 focus:outline-none';

function PrimaryButton({
  children,
  disabled,
  type = 'submit',
  tone = 'violet',
}: {
  children: ReactNode;
  disabled?: boolean;
  type?: 'submit' | 'button';
  tone?: 'violet' | 'danger';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold uppercase tracking-industrial transition-colors disabled:opacity-50',
        tone === 'danger'
          ? 'bg-rose-500/20 text-rose-200 ring-1 ring-inset ring-rose-400/40 hover:bg-rose-500/30'
          : 'bg-violet/25 text-violet-glow ring-1 ring-inset ring-violet/40 hover:bg-violet/35',
      )}
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-lg border border-white/[0.08] px-4 py-2 text-xs font-semibold uppercase tracking-industrial text-zinc-300 transition-colors hover:bg-white/[0.04] hover:text-white"
    >
      {children}
    </button>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <span>{message}</span>
    </p>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CreateDepartmentDialog
   ═══════════════════════════════════════════════════════════════════════ */

interface CreateProps {
  orgId: string;
  parentDepartmentId: string | null;
  parentName: string | null;
  onClose: () => void;
  onSuccess: (newId?: string) => void;
}

export function CreateDepartmentDialog({
  orgId,
  parentDepartmentId,
  parentName,
  onClose,
  onSuccess,
}: CreateProps) {
  const [name, setName] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await createDepartmentAction({
        orgId,
        parentDepartmentId,
        name,
        costCenter: costCenter || null,
      });
      if (!res.ok) {
        setError(res.error ?? 'Failed to create department.');
      } else {
        onSuccess(res.payload?.department_id);
      }
    });
  };

  return (
    <Modal
      title={parentName ? `Add child of "${parentName}"` : 'New root department'}
      subtitle="Departments form the org-chart for this enterprise."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Department name" hint="120 characters max.">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. North-East Region"
            className={inputCls}
          />
        </Field>
        <Field
          label="Cost center"
          hint="Optional. Free-form code; joins to the budget roll-up."
        >
          <div className="relative">
            <Hash className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              value={costCenter}
              onChange={(e) => setCostCenter(e.target.value)}
              maxLength={64}
              placeholder="e.g. CC-1042"
              className={`${inputCls} pl-8 font-mono`}
            />
          </div>
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton disabled={isPending || !name.trim()}>
            {isPending ? 'Creating…' : 'Create department'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   RenameDepartmentDialog
   ═══════════════════════════════════════════════════════════════════════ */

interface RenameProps {
  orgId: string;
  node: DepartmentNode;
  onClose: () => void;
  onSuccess: () => void;
}

export function RenameDepartmentDialog({
  orgId,
  node,
  onClose,
  onSuccess,
}: RenameProps) {
  const [name, setName] = useState(node.name);
  const [costCenter, setCostCenter] = useState(node.cost_center ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await renameDepartmentAction({
        orgId,
        departmentId: node.id,
        name,
        costCenter: costCenter || null,
      });
      if (!res.ok) setError(res.error ?? 'Failed to rename department.');
      else onSuccess();
    });
  };

  return (
    <Modal title={`Edit "${node.name}"`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Department name">
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            className={inputCls}
          />
        </Field>
        <Field label="Cost center" hint="Leave blank to clear.">
          <div className="relative">
            <Hash className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              value={costCenter}
              onChange={(e) => setCostCenter(e.target.value)}
              maxLength={64}
              className={`${inputCls} pl-8 font-mono`}
            />
          </div>
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton disabled={isPending || !name.trim()}>
            {isPending ? 'Saving…' : 'Save changes'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MoveDepartmentDialog
   ═══════════════════════════════════════════════════════════════════════ */

interface MoveProps {
  orgId: string;
  node: DepartmentNode;
  tree: DepartmentTreeResult;
  onClose: () => void;
  onSuccess: () => void;
}

export function MoveDepartmentDialog({
  orgId,
  node,
  tree,
  onClose,
  onSuccess,
}: MoveProps) {
  // Compute the set of forbidden ids = self + all descendants.
  const forbidden = useMemo(() => {
    const set = new Set<string>([node.id]);
    const walk = (n: DepartmentNode) => {
      set.add(n.id);
      n.children.forEach(walk);
    };
    const self = tree.byId[node.id];
    if (self) self.children.forEach(walk);
    return set;
  }, [node.id, tree.byId]);

  const [newParentId, setNewParentId] = useState<string | null>(
    node.parent_department_id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newParentId === (node.parent_department_id ?? null)) {
      setError('Pick a different parent, current location matches.');
      return;
    }
    startTransition(async () => {
      const res = await moveDepartmentAction({
        orgId,
        departmentId: node.id,
        newParentId,
      });
      if (!res.ok) setError(res.error ?? 'Failed to move department.');
      else onSuccess();
    });
  };

  return (
    <Modal
      title={`Move "${node.name}"`}
      subtitle="Pick the new parent. Descendants of this department are hidden, they'd create a cycle."
      onClose={onClose}
      size="md"
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="max-h-[40vh] overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.01] p-2">
          <ParentOption
            label="(Root level, no parent)"
            selected={newParentId === null}
            onSelect={() => setNewParentId(null)}
            isCurrent={node.parent_department_id === null}
            isRoot
          />
          {tree.roots.map((root) => (
            <ParentNode
              key={root.id}
              node={root}
              depth={0}
              forbidden={forbidden}
              selectedId={newParentId}
              currentParentId={node.parent_department_id}
              onSelect={setNewParentId}
            />
          ))}
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton disabled={isPending}>
            {isPending ? 'Moving…' : 'Move department'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ParentNode({
  node,
  depth,
  forbidden,
  selectedId,
  currentParentId,
  onSelect,
}: {
  node: DepartmentNode;
  depth: number;
  forbidden: Set<string>;
  selectedId: string | null;
  currentParentId: string | null;
  onSelect: (id: string) => void;
}) {
  const isForbidden = forbidden.has(node.id);
  return (
    <>
      <ParentOption
        label={node.name}
        depth={depth}
        selected={selectedId === node.id}
        onSelect={() => onSelect(node.id)}
        disabled={isForbidden}
        isCurrent={currentParentId === node.id}
      />
      {node.children.map((child) => (
        <ParentNode
          key={child.id}
          node={child}
          depth={depth + 1}
          forbidden={forbidden}
          selectedId={selectedId}
          currentParentId={currentParentId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

function ParentOption({
  label,
  depth = 0,
  selected,
  disabled = false,
  isCurrent = false,
  isRoot = false,
  onSelect,
}: {
  label: string;
  depth?: number;
  selected: boolean;
  disabled?: boolean;
  isCurrent?: boolean;
  isRoot?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
        selected
          ? 'bg-violet/20 text-violet-glow ring-1 ring-inset ring-violet/40'
          : 'text-zinc-200 hover:bg-white/[0.04]',
        disabled && 'cursor-not-allowed opacity-30 hover:bg-transparent',
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {isRoot ? (
        <FolderTree className="h-3.5 w-3.5 text-violet-glow" strokeWidth={1.75} />
      ) : (
        <Folder className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.75} />
      )}
      <span className="truncate">{label}</span>
      {isCurrent && (
        <span className="ml-auto rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-px text-[9px] uppercase tracking-industrial text-zinc-400">
          current
        </span>
      )}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   DeleteDepartmentDialog
   ═══════════════════════════════════════════════════════════════════════ */

interface DeleteProps {
  orgId: string;
  node: DepartmentNode;
  onClose: () => void;
  onSuccess: () => void;
}

export function DeleteDepartmentDialog({
  orgId,
  node,
  onClose,
  onSuccess,
}: DeleteProps) {
  // Walk the subtree to count descendants and total members.
  const counts = useMemo(() => {
    let descendants = 0;
    let members = node.member_count;
    const walk = (n: DepartmentNode) => {
      for (const c of n.children) {
        descendants += 1;
        members += c.member_count;
        walk(c);
      }
    };
    walk(node);
    return { descendants, members };
  }, [node]);

  const requiresForce = counts.descendants > 0 || counts.members > 0;
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (requiresForce && !confirmed) {
      setError(
        'Tick the confirmation box, this department has descendants or members.',
      );
      return;
    }
    startTransition(async () => {
      const res = await deleteDepartmentAction({
        orgId,
        departmentId: node.id,
        force: requiresForce,
      });
      if (!res.ok) setError(res.error ?? 'Failed to delete department.');
      else onSuccess();
    });
  };

  return (
    <Modal title={`Delete "${node.name}"?`} onClose={onClose} size="md">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-zinc-300">
          This action removes the department and{' '}
          {counts.descendants > 0 || counts.members > 0 ? (
            <>
              the data attached to it:{' '}
              <span className="font-mono text-rose-300">
                {counts.descendants} descendant
                {counts.descendants === 1 ? '' : 's'}
              </span>
              {' and '}
              <span className="font-mono text-rose-300">
                {counts.members} member assignment
                {counts.members === 1 ? '' : 's'}
              </span>
              {' will be deleted by cascade.'}
            </>
          ) : (
            <>nothing else, it has no descendants or assigned members.</>
          )}
        </p>

        {requiresForce && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-xs text-rose-100">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-rose-400"
            />
            <span>
              Yes, delete this department and cascade-remove all{' '}
              {counts.descendants} descendant
              {counts.descendants === 1 ? '' : 's'} and{' '}
              {counts.members} member assignment
              {counts.members === 1 ? '' : 's'}.
            </span>
          </label>
        )}

        {error && <ErrorBanner message={error} />}

        <div className="flex justify-end gap-2 border-t border-white/[0.06] pt-4">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton
            tone="danger"
            disabled={isPending || (requiresForce && !confirmed)}
          >
            {isPending ? 'Deleting…' : 'Delete department'}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   AssignMemberDialog
   ═══════════════════════════════════════════════════════════════════════ */

interface AssignProps {
  orgId: string;
  node: DepartmentNode;
  assignableMembers: AssignableOrgMember[];
  onClose: () => void;
  onSuccess: () => void;
}

export function AssignMemberDialog({
  orgId,
  node,
  assignableMembers,
  onClose,
  onSuccess,
}: AssignProps) {
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assignableMembers;
    return assignableMembers.filter((m) => {
      const hay = `${m.full_name ?? ''} ${m.email ?? ''} ${m.role ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [assignableMembers, query]);

  const onAssign = (userId: string) => {
    setError(null);
    setPendingUserId(userId);
    startTransition(async () => {
      const res = await assignMemberAction({
        orgId,
        departmentId: node.id,
        userId,
      });
      if (!res.ok) {
        setError(res.error ?? 'Failed to assign member.');
        setPendingUserId(null);
      } else {
        // Stay open in case the operator wants to assign multiples in a row;
        // tell the parent to refresh so already-assigned badges update.
        onSuccess();
      }
    });
  };

  return (
    <Modal
      title={`Assign to "${node.name}"`}
      subtitle="Pick any current org member. A user can belong to multiple departments."
      onClose={onClose}
      size="lg"
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or role…"
            autoFocus
            className={`${inputCls} pl-9`}
          />
        </div>

        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-white/[0.06] bg-white/[0.01]">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-zinc-500">
              {assignableMembers.length === 0
                ? 'This organization has no members yet. Invite members first from the org page.'
                : 'No members match.'}
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.04]">
              {filtered.map((m) => {
                const alreadyHere = m.assigned_department_ids.includes(node.id);
                const isThisRowPending = isPending && pendingUserId === m.user_id;
                return (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-white">
                        {m.full_name ?? m.email ?? 'Unknown'}
                      </p>
                      <p className="truncate text-[10px] text-zinc-500">
                        {m.email}
                        {', '}
                        <span className="font-mono">{m.role}</span>
                        {m.assigned_department_ids.length > 0 && (
                          <>
                            {', '}
                            <span>
                              {m.assigned_department_ids.length} other
                              {m.assigned_department_ids.length === 1 ? '' : 's'}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    {alreadyHere ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-industrial text-emerald-200">
                        <Check className="h-3 w-3" strokeWidth={2.5} />
                        Assigned
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAssign(m.user_id)}
                        disabled={isPending}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-violet/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow ring-1 ring-inset ring-violet/30 transition-colors hover:bg-violet/25 disabled:opacity-50"
                      >
                        <UserCheck className="h-3 w-3" strokeWidth={2} />
                        {isThisRowPending ? 'Assigning…' : 'Assign'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && <ErrorBanner message={error} />}

        <div className="flex justify-end border-t border-white/[0.06] pt-4">
          <SecondaryButton onClick={onClose}>Done</SecondaryButton>
        </div>
      </div>
    </Modal>
  );
}
