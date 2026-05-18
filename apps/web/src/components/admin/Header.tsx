import { Suspense } from 'react';
import { SignOutButton } from './SignOutButton';
import { NotificationBellGate } from '@/components/notifications/NotificationBellGate';

interface HeaderProps {
  /** Display name from profiles.full_name or email fallback. */
  userLabel: string;
  /** Organisation switcher data — placeholder until org seat model lands. */
  organizations?: ReadonlyArray<{ id: string; name: string }>;
  activeOrgId?: string;
}

/**
 * Sticky admin header: organisation switcher (placeholder), live build
 * indicator, user avatar + sign-out.
 *
 * The org switcher is a UI placeholder for Sprint 2 — it renders the
 * organisations the user belongs to via the `org_members` table once that
 * table exists. For now it's an inert chip that signals the upcoming
 * capability without lying about current state.
 */
export function Header({
  userLabel,
  organizations = [],
  activeOrgId,
}: HeaderProps) {
  const activeOrg =
    organizations.find((o) => o.id === activeOrgId) ?? organizations[0];

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between px-6">
        {/* Left: org switcher placeholder */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Switch organisation"
            disabled
            className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-zinc-300 disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-violet to-cyan-glow text-[9px] font-bold text-white">
              {(activeOrg?.name ?? 'NX').slice(0, 2).toUpperCase()}
            </span>
            <span>{activeOrg?.name ?? 'NEXPEC · Platform'}</span>
            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-industrial text-emerald-400">
              live
            </span>
          </button>
          <span className="hidden font-mono text-[10px] uppercase tracking-industrial text-zinc-600 md:inline">
            live ·{' '}
            <span className="text-cyan-glow">
              {process.env.NEXT_PUBLIC_ENV ?? 'development'}
            </span>
          </span>
        </div>

        {/* Right: bell + user pill + sign-out */}
        <div className="flex items-center gap-3">
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
