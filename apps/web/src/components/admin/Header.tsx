import { Suspense } from 'react';
import { SignOutButton } from './SignOutButton';
import { NotificationBellGate } from '@/components/notifications/NotificationBellGate';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { OrgSwitcher } from '@/components/orgs/OrgSwitcher';
import type { OrgMembershipEntry } from '@nexpec/shared-core';

interface HeaderProps {
  /** Display name from profiles.full_name or email fallback. */
  userLabel: string;
  /**
   * Legacy org-list shape (kept for back-compat with surfaces that haven't
   * been ported to the active-org switcher yet). Pass `memberships` +
   * `activeMembership` for the new, interactive switcher.
   */
  organizations?: ReadonlyArray<{ id: string; name: string }>;
  activeOrgId?: string;
  /**
   * Sprint 6 — multi-org context switcher. When provided, the Header
   * renders the interactive OrgSwitcher and ignores the legacy props.
   * Empty array (or undefined) → falls back to the static NEXPEC chip.
   */
  memberships?: ReadonlyArray<OrgMembershipEntry>;
  /** The currently-active membership (matches one of `memberships`). */
  activeMembership?: OrgMembershipEntry | null;
}

/**
 * Sticky shared header: organization workspace switcher, live build
 * indicator, locale toggle, notifications bell, user pill, sign-out.
 *
 * The workspace switcher is wired to the active-org primitives
 * (profiles.active_org_id + set_active_org RPC). When `memberships` is
 * non-empty the switcher is fully interactive; otherwise the Header
 * shows the inert NEXPEC platform chip — preserving the visual for
 * admin surfaces that don't pass org context.
 */
export function Header({
  userLabel,
  organizations = [],
  activeOrgId,
  memberships,
  activeMembership,
}: HeaderProps) {
  // Prefer the new, rich props. Legacy `organizations` only kicks in when
  // memberships isn't provided AT ALL — keeps the placeholder visible for
  // any caller that hasn't migrated yet.
  const useSwitcher = memberships !== undefined;
  const legacyActive =
    organizations.find((o) => o.id === activeOrgId) ?? organizations[0];

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between px-6">
        {/* Left: workspace switcher */}
        <div className="flex items-center gap-3">
          {useSwitcher ? (
            <OrgSwitcher
              memberships={memberships ?? []}
              active={activeMembership ?? null}
            />
          ) : (
            <button
              type="button"
              aria-label="Switch organisation"
              disabled
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-violet to-cyan-glow text-[9px] font-bold text-white">
                {(legacyActive?.name ?? 'NX').slice(0, 2).toUpperCase()}
              </span>
              <span>{legacyActive?.name ?? 'NEXPEC · Platform'}</span>
              <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-emerald-400">
                live
              </span>
            </button>
          )}
          <span className="hidden font-mono text-[10px] uppercase tracking-industrial text-zinc-600 md:inline">
            live ·{' '}
            <span className="text-cyan-glow">
              {process.env.NEXT_PUBLIC_ENV ?? 'development'}
            </span>
          </span>
        </div>

        {/* Right: locale + bell + user pill + sign-out */}
        <div className="flex items-center gap-3">
          {/* Language switcher (cookie-driven, no URL change) */}
          <Suspense fallback={null}>
            <LocaleSwitcher />
          </Suspense>
          {/* Notification bell — wraps in Suspense so a slow profiles read
              never blocks header render. Falls back to an inert bell shape. */}
          <Suspense
            fallback={
              <span
                aria-hidden
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] text-zinc-500"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M10 21a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            }
          >
            <NotificationBellGate />
          </Suspense>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-violet to-cyan-glow text-[11px] font-semibold text-white">
              {initials(userLabel)}
            </span>
            <span className="text-sm font-medium text-zinc-200">{userLabel}</span>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}
