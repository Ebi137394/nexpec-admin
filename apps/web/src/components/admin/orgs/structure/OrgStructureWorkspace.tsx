'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/admin/orgs/structure/OrgStructureWorkspace.tsx
//
//  The full interactive surface for an organization's department tree.
//  Server page loads the data once; this component owns the split-pane
//  shell, selection state, and dialog coordination.
//
//  Layout:
//    ┌─ split pane ──────────────────────────────────────────────────────┐
//    │  [Tree column]                       [Detail column]              │
//    │   • search input                      • selected dept summary     │
//    │   • "+ Root department" button        • cost-center field         │
//    │   • DepartmentTree (recursive)        • members list w/ unassign  │
//    │                                       • Assign member button       │
//    └───────────────────────────────────────────────────────────────────┘
//
//  All five dialogs (Create / Rename / Move / Delete / AssignMember) are
//  rendered here and toggled by local state. Each calls a server action
//  via useTransition and refreshes the page via router.refresh() — the
//  server action also revalidatePath()s, so the next render gets fresh
//  data.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Building2, FolderTree } from 'lucide-react';

import type {
  AssignableOrgMember,
  DepartmentNode,
  DepartmentTreeResult,
} from '@/lib/data/orgStructure.types';
import { DepartmentTree } from './DepartmentTree';
import { DepartmentDetailPanel } from './DepartmentDetailPanel';
import {
  CreateDepartmentDialog,
  RenameDepartmentDialog,
  MoveDepartmentDialog,
  DeleteDepartmentDialog,
  AssignMemberDialog,
  type DialogState,
} from './StructureDialogs';

interface Props {
  orgId: string;
  orgName: string;
  initialTree: DepartmentTreeResult;
  assignableMembers: AssignableOrgMember[];
  /**
   * When true: hide every mutation entry-point (create / rename / move /
   * delete / assign / unassign). Selection + browsing remain. Used by the
   * /client/structure page when the viewer's org role is not elevated.
   */
  readOnly?: boolean;
}

export function OrgStructureWorkspace({
  orgId,
  orgName,
  initialTree,
  assignableMembers,
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Selection state — id of the focused department, or null.
  const [selectedId, setSelectedId] = useState<string | null>(
    initialTree.roots[0]?.id ?? null,
  );

  // Search filter — narrows the tree to matching nodes + their ancestors.
  const [search, setSearch] = useState('');

  // Dialog state — at most one dialog open at a time.
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  const refresh = () => startTransition(() => router.refresh());

  // Build a filtered view of the tree based on search.
  const visibleTree = useMemo(() => {
    if (!search.trim()) return initialTree;
    const q = search.trim().toLowerCase();

    // Walk tree, marking nodes that match or contain a matching descendant.
    const markRec = (node: DepartmentNode): DepartmentNode | null => {
      const filteredChildren = node.children
        .map(markRec)
        .filter((c): c is DepartmentNode => !!c);
      const selfMatch =
        node.name.toLowerCase().includes(q) ||
        (node.cost_center ?? '').toLowerCase().includes(q);
      if (selfMatch || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren };
      }
      return null;
    };

    const roots = initialTree.roots
      .map(markRec)
      .filter((n): n is DepartmentNode => !!n);
    return { ...initialTree, roots };
  }, [initialTree, search]);

  const selectedNode = selectedId ? initialTree.byId[selectedId] ?? null : null;

  return (
    <>
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* ── Tree column ─────────────────────────────────────────── */}
        <aside className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-ink-800/60 to-ink-900/30 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-sm font-semibold tracking-tight text-white">
              <FolderTree className="h-4 w-4 text-violet-glow" strokeWidth={1.75} />
              Structure
              {readOnly && (
                <span className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-zinc-400">
                  view only
                </span>
              )}
            </h2>
            {!readOnly && (
              <button
                type="button"
                onClick={() =>
                  setDialog({ kind: 'create', parentDepartmentId: null })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow ring-1 ring-inset ring-violet/30 transition-colors hover:bg-violet/25"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                Root
              </button>
            )}
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or cost center…"
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-violet/40 focus:outline-none"
            />
          </div>

          <div className="mt-4 max-h-[60vh] overflow-y-auto pr-1">
            {visibleTree.roots.length === 0 ? (
              <EmptyTreeState
                hasSearch={!!search.trim()}
                onCreate={() =>
                  setDialog({ kind: 'create', parentDepartmentId: null })
                }
                readOnly={readOnly}
              />
            ) : (
              <DepartmentTree
                nodes={visibleTree.roots}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAddChild={(parentId) =>
                  setDialog({ kind: 'create', parentDepartmentId: parentId })
                }
                onRename={(node) => setDialog({ kind: 'rename', node })}
                onMove={(node) => setDialog({ kind: 'move', node })}
                onDelete={(node) => setDialog({ kind: 'delete', node })}
                isPending={isPending}
                readOnly={readOnly}
              />
            )}
          </div>
        </aside>

        {/* ── Detail column ───────────────────────────────────────── */}
        <DepartmentDetailPanel
          orgId={orgId}
          orgName={orgName}
          node={selectedNode}
          assignableMembers={assignableMembers}
          onRename={(node) => setDialog({ kind: 'rename', node })}
          onAddChild={(node) =>
            setDialog({ kind: 'create', parentDepartmentId: node.id })
          }
          onMove={(node) => setDialog({ kind: 'move', node })}
          onDelete={(node) => setDialog({ kind: 'delete', node })}
          onAssign={(node) => setDialog({ kind: 'assign', node })}
          onUnassigned={refresh}
          isPending={isPending}
          readOnly={readOnly}
        />
      </section>

      {/* ── Dialogs ──────────────────────────────────────────────── */}
      {/* Belt-and-braces: even with the buttons hidden in read-only mode,
          a server action would still reject because the RPC enforces
          can_manage_org_structure(). We bail at the component level here
          so curious users can't open a dialog that would always fail. */}
      {!readOnly && dialog.kind === 'create' && (
        <CreateDepartmentDialog
          orgId={orgId}
          parentDepartmentId={dialog.parentDepartmentId}
          parentName={
            dialog.parentDepartmentId
              ? initialTree.byId[dialog.parentDepartmentId]?.name ?? null
              : null
          }
          onClose={() => setDialog({ kind: 'none' })}
          onSuccess={(newId) => {
            setDialog({ kind: 'none' });
            setSelectedId(newId ?? selectedId);
            refresh();
          }}
        />
      )}
      {!readOnly && dialog.kind === 'rename' && (
        <RenameDepartmentDialog
          orgId={orgId}
          node={dialog.node}
          onClose={() => setDialog({ kind: 'none' })}
          onSuccess={() => {
            setDialog({ kind: 'none' });
            refresh();
          }}
        />
      )}
      {!readOnly && dialog.kind === 'move' && (
        <MoveDepartmentDialog
          orgId={orgId}
          node={dialog.node}
          tree={initialTree}
          onClose={() => setDialog({ kind: 'none' })}
          onSuccess={() => {
            setDialog({ kind: 'none' });
            refresh();
          }}
        />
      )}
      {!readOnly && dialog.kind === 'delete' && (
        <DeleteDepartmentDialog
          orgId={orgId}
          node={dialog.node}
          onClose={() => setDialog({ kind: 'none' })}
          onSuccess={() => {
            setDialog({ kind: 'none' });
            // If the deleted node was selected, clear selection.
            if (selectedId === dialog.node.id) setSelectedId(null);
            refresh();
          }}
        />
      )}
      {!readOnly && dialog.kind === 'assign' && (
        <AssignMemberDialog
          orgId={orgId}
          node={dialog.node}
          assignableMembers={assignableMembers}
          onClose={() => setDialog({ kind: 'none' })}
          onSuccess={() => {
            setDialog({ kind: 'none' });
            refresh();
          }}
        />
      )}
    </>
  );
}

function EmptyTreeState({
  hasSearch,
  onCreate,
  readOnly,
}: {
  hasSearch: boolean;
  onCreate: () => void;
  readOnly: boolean;
}) {
  if (hasSearch) {
    return (
      <p className="px-2 py-6 text-center text-xs text-zinc-500">
        No departments match your search.
      </p>
    );
  }
  return (
    <div className="px-2 py-6 text-center">
      <Building2
        className="mx-auto h-6 w-6 text-zinc-600"
        strokeWidth={1.5}
      />
      <p className="mt-3 text-xs text-zinc-400">
        {readOnly
          ? 'Your organization has no departments yet.'
          : 'No departments yet. Start with a root division.'}
      </p>
      {readOnly ? (
        <p className="mt-2 text-[10px] text-zinc-500">
          Ask your org owner or procurement admin to set them up.
        </p>
      ) : (
        <button
          type="button"
          onClick={onCreate}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-violet/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-industrial text-violet-glow ring-1 ring-inset ring-violet/30 transition-colors hover:bg-violet/25"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Create root department
        </button>
      )}
    </div>
  );
}
