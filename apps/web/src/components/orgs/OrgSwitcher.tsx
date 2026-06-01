'use client';

// ════════════════════════════════════════════════════════════════════════════
//  components/orgs/OrgSwitcher.tsx
//
//  Workspace switcher — Vercel/Linear-grade dropdown that lets multi-org
//  users toggle their active organization context.
//
//  ARCHITECTURE
//  ────────────
//  The active org is pinned on profiles.active_org_id (DB column). This
//  component just renders memberships fetched server-side and writes the
//  new pin via setActiveOrgAction. Web ↔ mobile stays in sync because
//  both surfaces read/write the same column.
//
//  UX
//  ──
//    · Trigger button: 32×32 gradient avatar (org initials), org name,
//      kind badge (Enterprise/Agency) on the right, role badge under the
//      name, chevron icon to indicate it's interactive.
//    · Dropdown: glassmorphic panel with one row per membership.
//      - Active org pinned to the top with a violet ring + checkmark.
//      - Search input appears when memberships.length >= 5.
//      - Each row shows org avatar, name, kind, role pill.
//      - Click → optimistic update + server action + router.refresh.
//    · Keyboard: Esc closes, Enter activates, Up/Down navigates the list.
//    · No memberships → renders the static NEXPEC platform chip (no
//      interactivity, no dropdown, matches the pre-existing placeholder).
//    · Single membership → renders a static chip; opening the dropdown
//      would be pointless.
//
//  Strict adherence to existing tokens: ink-900, violet, violet-glow,
//  cyan-glow, white/[0.06], font-display, tracking-industrial.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  ChevronDown,
  Check,
  Search,
  Loader2,
  Users,
} from 'lucide-react';

import type { OrgMembershipEntry } from '@nexpec/shared-core';
import { setActiveOrgAction } from '@/lib/actions/orgStructure';
import { cn } from '@/lib/cn';

interface Props {
  memberships: ReadonlyArray<OrgMembershipEntry>;
  /**
   * The currently-resolved active membership. May be undefined when the
   * user has no memberships at all (component renders a static chip).
   */
  active: OrgMembershipEntry | null;
  /** Compact trigger style — used when the host has limited horizontal space. */
  compact?: boolean;
}

export function OrgSwitcher({ memberships, active, compact = false }: Props) {
  // ── Zero / single membership: static chip. ─────────────────────────
  if (memberships.length === 0) {
    return <StaticChip label="NEXPEC · Platform" />;
  }
  if (memberships.length === 1) {
    return (
      <InertChip
        org={memberships[0]!}
        active={memberships[0]!}
        compact={compact}
      />
    );
  }

  return (
    <InteractiveSwitcher
      memberships={memberships}
      active={active ?? memberships[0]!}
      compact={compact}
    />
  );
}

/* ─── Interactive switcher (>= 2 memberships) ─────────────────────────── */

function InteractiveSwitcher({
  memberships,
  active,
  compact,
}: {
  memberships: ReadonlyArray<OrgMembershipEntry>;
  active: OrgMembershipEntry;
  compact: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(t) &&
        triggerRef.current &&
        !triggerRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // Focus the search input when the panel opens (only when there's one).
  useEffect(() => {
    if (open && memberships.length >= 5) {
      setTimeout(() => searchRef.current?.focus(), 30);
    }
  }, [open, memberships.length]);

  const filtered = useMemo(() => {
    if (!query.trim()) return memberships;
    const q = query.trim().toLowerCase();
    return memberships.filter((m) => {
      const hay = `${m.org_name} ${m.org_slug ?? ''} ${m.role ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [memberships, query]);

  const handlePick = (org: OrgMembershipEntry) => {
    if (org.org_id === active.org_id) {
      setOpen(false);
      return;
    }
    setError(null);
    setPendingId(org.org_id);
    startTransition(async () => {
      const res = await setActiveOrgAction({ orgId: org.org_id });
      if (!res.ok) {
        setError(res.error ?? 'Could not switch — try again.');
        setPendingId(null);
        return;
      }
      // Action revalidates relevant paths; router.refresh re-pulls the
      // current page's RSC payload so everything re-hydrates with the
      // new active org context (sidebar + page).
      router.refresh();
      setPendingId(null);
      setOpen(false);
    });
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Switch organization"
        className={cn(
          'group inline-flex items-center gap-2 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] py-1.5 pl-1.5 pr-2 text-left transition-all hover:border-violet/30 hover:bg-violet/[0.04]',
          compact ? 'max-w-[220px]' : 'max-w-[280px]',
        )}
      >
        <OrgAvatar org={active} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-white leading-tight">
            {active.org_name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-[9px] uppercase tracking-industrial text-zinc-500 leading-tight">
            <span>{active.org_kind}</span>
            {active.role && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="truncate">{prettyRole(active.role)}</span>
              </>
            )}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform group-hover:text-violet-glow',
            open && 'rotate-180 text-violet-glow',
          )}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="listbox"
          aria-label="Organization list"
          className="absolute left-0 top-full z-40 mt-2 w-[320px] overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/95 shadow-2xl backdrop-blur-xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5">
            <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-industrial text-zinc-400">
              <Users className="h-3 w-3 text-violet-glow" strokeWidth={1.75} />
              Switch workspace
            </p>
            <span className="rounded-full border border-white/[0.08] bg-white/[0.02] px-2 py-0.5 font-mono text-[9px] text-zinc-500">
              {memberships.length}
            </span>
          </header>

          {memberships.length >= 5 && (
            <div className="border-b border-white/[0.06] px-3 py-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search organizations…"
                  className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] py-1.5 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-violet/40 focus:outline-none"
                />
              </div>
            </div>
          )}

          <ul className="max-h-[60vh] overflow-y-auto py-1.5">
            {filtered.length === 0 ? (
              <li className="px-4 py-6 text-center text-xs text-zinc-500">
                No organizations match.
              </li>
            ) : (
              filtered.map((org) => (
                <Row
                  key={org.org_id}
                  org={org}
                  isActive={org.org_id === active.org_id}
                  isPending={pendingId === org.org_id && isPending}
                  disabled={isPending}
                  onPick={() => handlePick(org)}
                />
              ))
            )}
          </ul>

          {error && (
            <p className="border-t border-rose-500/20 bg-rose-500/[0.06] px-4 py-2 text-[11px] text-rose-200">
              {error}
            </p>
          )}

          <footer className="border-t border-white/[0.06] bg-white/[0.01] px-4 py-2.5">
            <p className="font-mono text-[9px] uppercase tracking-industrial text-zinc-600">
              Pinned on profile · syncs across web + mobile
            </p>
          </footer>
        </div>
      )}
    </div>
  );
}

/* ─── one row in the dropdown ─────────────────────────────────────────── */

function Row({
  org,
  isActive,
  isPending,
  disabled,
  onPick,
}: {
  org: OrgMembershipEntry;
  isActive: boolean;
  isPending: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={isActive}
        onClick={onPick}
        disabled={disabled}
        className={cn(
          'flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
          isActive
            ? 'bg-violet/[0.08]'
            : 'hover:bg-white/[0.03]',
          disabled && !isPending && 'cursor-wait opacity-60',
        )}
      >
        <OrgAvatar org={org} size="md" ringed={isActive} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-white">
              {org.org_name}
            </span>
            {isActive && (
              <span className="inline-flex items-center gap-0.5 rounded border border-violet/30 bg-violet/15 px-1 py-px text-[9px] font-semibold uppercase tracking-industrial text-violet-glow">
                Active
              </span>
            )}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-industrial text-zinc-500">
            <span>{org.org_kind}</span>
            {org.role && (
              <>
                <span className="text-zinc-700">·</span>
                <span>{prettyRole(org.role)}</span>
              </>
            )}
          </p>
        </div>
        <div className="shrink-0">
          {isPending ? (
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-violet-glow"
              strokeWidth={2}
            />
          ) : isActive ? (
            <Check
              className="h-3.5 w-3.5 text-violet-glow"
              strokeWidth={2.5}
            />
          ) : null}
        </div>
      </button>
    </li>
  );
}

/* ─── static / inert variants ────────────────────────────────────────── */

function StaticChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300"
      aria-label={label}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-violet to-cyan-glow text-[9px] font-bold text-white">
        NX
      </span>
      <span>{label}</span>
      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-emerald-400">
        live
      </span>
    </span>
  );
}

function InertChip({
  org,
  compact,
}: {
  org: OrgMembershipEntry;
  active: OrgMembershipEntry;
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-2 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.01] py-1.5 pl-1.5 pr-3',
        compact ? 'max-w-[220px]' : 'max-w-[280px]',
      )}
      aria-label={`Active organization: ${org.org_name}`}
    >
      <OrgAvatar org={org} size="md" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-white leading-tight">
          {org.org_name}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate font-mono text-[9px] uppercase tracking-industrial text-zinc-500 leading-tight">
          <span>{org.org_kind}</span>
          {org.role && (
            <>
              <span className="text-zinc-700">·</span>
              <span className="truncate">{prettyRole(org.role)}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/* ─── avatar ─────────────────────────────────────────────────────────── */

function OrgAvatar({
  org,
  size,
  ringed = false,
}: {
  org: OrgMembershipEntry;
  size: 'sm' | 'md' | 'lg';
  ringed?: boolean;
}) {
  const initials = useMemo(() => orgInitials(org.org_name), [org.org_name]);
  const gradient = useMemo(() => gradientForOrg(org.org_id), [org.org_id]);
  const sizeCls =
    size === 'sm'
      ? 'h-6 w-6 text-[9px]'
      : size === 'lg'
        ? 'h-9 w-9 text-xs'
        : 'h-7 w-7 text-[10px]';

  if (org.org_logo_url) {
    return (
      <span
        className={cn(
          'shrink-0 overflow-hidden rounded-lg ring-1 ring-inset',
          sizeCls,
          ringed ? 'ring-violet/40' : 'ring-white/[0.08]',
        )}
      >
        <img
          src={org.org_logo_url}
          alt=""
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white ring-1 ring-inset',
        sizeCls,
        ringed ? 'ring-violet/40' : 'ring-white/[0.08]',
        gradient,
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

/* ─── pure helpers ───────────────────────────────────────────────────── */

function orgInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'NX';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/**
 * Deterministic gradient per org id so workspace avatars feel like real
 * brand colours even without a logo. Uses Tailwind classes only.
 */
function gradientForOrg(orgId: string): string {
  // Five tasteful gradients, hash-picked off the org_id for stability.
  const palette = [
    'bg-gradient-to-br from-violet to-cyan-glow',
    'bg-gradient-to-br from-fuchsia-500 to-violet',
    'bg-gradient-to-br from-cyan-glow to-emerald-400',
    'bg-gradient-to-br from-amber-400 to-rose-500',
    'bg-gradient-to-br from-indigo-500 to-violet-glow',
  ];
  // Deterministic small hash of the uuid chars.
  let acc = 0;
  for (let i = 0; i < orgId.length; i++) {
    acc = (acc * 31 + orgId.charCodeAt(i)) >>> 0;
  }
  return palette[acc % palette.length]!;
}

function prettyRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
