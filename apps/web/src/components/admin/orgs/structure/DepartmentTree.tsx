'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/admin/orgs/structure/DepartmentTree.tsx
//
//  Recursive tree renderer. Each row:
//    · chevron to expand/collapse children (when there are any)
//    · folder icon + department name + member-count badge
//    · cost-center pill (right-aligned, dim) if set
//    · row-level action menu: Add child, Rename, Move, Delete
//
//  Keeps state minimal — only the `expandedIds` set lives here. The parent
//  owns `selectedId` so detail-panel selection survives across refreshes.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Pencil,
  Move,
  Trash2,
  Hash,
  Users,
} from 'lucide-react';
import type { DepartmentNode } from '@/lib/data/orgStructure.types';
import { cn } from '@/lib/cn';

interface Props {
  nodes: DepartmentNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onRename: (node: DepartmentNode) => void;
  onMove: (node: DepartmentNode) => void;
  onDelete: (node: DepartmentNode) => void;
  isPending: boolean;
  /** Hide the per-row action menu when the viewer can't mutate. */
  readOnly?: boolean;
}

export function DepartmentTree(props: Props) {
  // Default-expanded: roots only. Memoised so it doesn't reset on rerender.
  const initialExpanded = useMemo(
    () => new Set(props.nodes.map((n) => n.id)),
    // We intentionally only seed from the initial root list — subsequent
    // tree mutations re-render but don't auto-expand new branches.
    [],
  );
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ul role="tree" className="space-y-px">
      {props.nodes.map((node) => (
        <Row
          key={node.id}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          openMenu={openMenu}
          onOpenMenu={setOpenMenu}
          {...props}
        />
      ))}
    </ul>
  );
}

interface RowProps extends Props {
  node: DepartmentNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  openMenu: string | null;
  onOpenMenu: (id: string | null) => void;
}

function Row({
  node,
  depth,
  expanded,
  onToggle,
  openMenu,
  onOpenMenu,
  selectedId,
  onSelect,
  onAddChild,
  onRename,
  onMove,
  onDelete,
  isPending,
  readOnly = false,
  ...rest
}: RowProps) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const isMenuOpen = openMenu === node.id;

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={isSelected}>
      <div
        className={cn(
          'group relative flex items-center gap-1.5 rounded-lg py-1 pr-1 transition-colors',
          isSelected
            ? 'bg-violet/15 text-white ring-1 ring-inset ring-violet/30'
            : 'hover:bg-white/[0.03] text-zinc-200',
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {/* Expand toggle */}
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              className={cn(
                'h-3 w-3 transition-transform',
                isOpen && 'rotate-90',
              )}
              strokeWidth={2}
            />
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" aria-hidden />
        )}

        {/* Folder icon + name (selectable target) */}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left"
        >
          {hasChildren && isOpen ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-violet-glow" strokeWidth={1.75} />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-zinc-500" strokeWidth={1.75} />
          )}
          <span className="truncate text-xs">{node.name}</span>

          {node.cost_center && (
            <span className="ml-1 inline-flex items-center gap-0.5 rounded border border-white/[0.08] bg-white/[0.03] px-1 py-px font-mono text-[9px] text-zinc-400">
              <Hash className="h-2.5 w-2.5" strokeWidth={2} />
              {node.cost_center}
            </span>
          )}
        </button>

        {/* Member-count badge */}
        {node.member_count_total > 0 && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
            title={`${node.member_count} direct, ${node.member_count_total} total`}
          >
            <Users className="h-2.5 w-2.5" strokeWidth={2} />
            {node.member_count_total}
          </span>
        )}

        {/* Row actions */}
        {!readOnly && (
        <div className="relative ml-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenMenu(isMenuOpen ? null : node.id);
            }}
            disabled={isPending}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200',
              isMenuOpen && 'bg-white/[0.06] text-zinc-200',
            )}
            aria-label="Actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
          </button>

          {isMenuOpen && (
            <div
              className="absolute right-0 top-6 z-10 w-44 overflow-hidden rounded-lg border border-white/[0.08] bg-ink-900/95 shadow-2xl backdrop-blur"
              onMouseLeave={() => onOpenMenu(null)}
            >
              <MenuItem
                icon={<Plus className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label="Add child"
                onClick={() => {
                  onOpenMenu(null);
                  onAddChild(node.id);
                }}
              />
              <MenuItem
                icon={<Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label="Rename"
                onClick={() => {
                  onOpenMenu(null);
                  onRename(node);
                }}
              />
              <MenuItem
                icon={<Move className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label="Move…"
                onClick={() => {
                  onOpenMenu(null);
                  onMove(node);
                }}
              />
              <div className="my-1 h-px bg-white/[0.06]" />
              <MenuItem
                icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />}
                label="Delete"
                tone="danger"
                onClick={() => {
                  onOpenMenu(null);
                  onDelete(node);
                }}
              />
            </div>
          )}
        </div>
        )}
      </div>

      {/* Children */}
      {hasChildren && isOpen && (
        <ul role="group" className="space-y-px">
          {node.children.map((child) => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              openMenu={openMenu}
              onOpenMenu={onOpenMenu}
              selectedId={selectedId}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onRename={onRename}
              onMove={onMove}
              onDelete={onDelete}
              isPending={isPending}
              readOnly={readOnly}
              {...rest}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
        tone === 'danger'
          ? 'text-rose-300 hover:bg-rose-500/10 hover:text-rose-200'
          : 'text-zinc-200 hover:bg-white/[0.04] hover:text-white',
      )}
    >
      <span className="text-zinc-500">{icon}</span>
      {label}
    </button>
  );
}
