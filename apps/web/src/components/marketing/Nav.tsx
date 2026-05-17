'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, LogOut } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { signOut } from '@/lib/auth/actions';
import { cn } from '@/lib/cn';

/**
 * Viewer descriptor passed from the parent Server Component. `null` means
 * the request has no session — show the public Sign in / Get started CTAs.
 * Anything else means the visitor is authenticated; render a contextual
 * "Console" affordance instead of bounce-prone auth links.
 *
 * Role intentionally not on this type. Role detection straddles the
 * marketing/admin context boundary unreliably (the marketing route doesn't
 * always see the freshest auth cookie state), so we link every authenticated
 * viewer to /admin/dashboard and let middleware do the actual access check.
 * For super_admin that's a direct route; for any other role middleware
 * redirects to / cleanly. Either way the click does *something*.
 */
export interface NavViewer {
  /** Display label (full_name or email handle). Used for the avatar pill. */
  label: string;
}

interface NavProps {
  viewer?: NavViewer | null;
}

export function Nav({ viewer = null }: NavProps) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled
          ? 'border-b border-white/5 bg-ink-950/75 backdrop-blur-xl'
          : 'border-b border-transparent bg-transparent',
      )}
    >
      <div className="container-narrow flex h-16 items-center justify-between">
        <Logo variant="wordmark" size="md" />

        <nav className="hidden items-center gap-8 md:flex" aria-label="Primary">
          <NavLink href="#how">How it works</NavLink>
          <NavLink href="#trust">Trust</NavLink>
          <NavLink href="#industries">Industries</NavLink>
          <NavLink href="/contact">Contact</NavLink>
        </nav>

        <div className="flex items-center gap-3">
          {viewer ? (
            <>
              <ViewerPill viewer={viewer} />
              <form action={signOut} className="contents">
                <button
                  type="submit"
                  title="Sign out"
                  aria-label="Sign out"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.02] text-zinc-400 transition-colors hover:border-accent-red/40 hover:bg-accent-red/10 hover:text-accent-red"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="hidden text-sm font-medium text-zinc-300 transition-colors hover:text-white sm:inline-block"
              >
                Sign in
              </Link>
              <Link href="/sign-up" className="btn-primary !py-2 !px-5 !text-sm">
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Signed-in affordance. Avatar circle with initials + a "Console" link
 * that always routes to /admin/dashboard. Middleware enforces access:
 * super_admin lands on the dashboard, every other role gets redirected
 * back to / (no client/inspector web surfaces yet).
 */
function ViewerPill({ viewer }: { viewer: NavViewer }) {
  return (
    <Link
      href="/admin/dashboard"
      prefetch={false}
      className="group inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1.5 pl-1.5 pr-3 text-sm font-medium text-zinc-200 transition-colors hover:border-violet/40 hover:text-white"
    >
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-violet to-cyan-glow text-[11px] font-semibold text-white"
        aria-hidden
      >
        {initials(viewer.label)}
      </span>
      <span className="hidden sm:inline">Open console</span>
      <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-white" />
    </Link>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative text-sm font-medium text-zinc-300 transition-colors hover:text-white"
    >
      {children}
      <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-gradient-to-r from-violet to-cyan-glow transition-transform duration-300 group-hover:scale-x-100" />
    </Link>
  );
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return (
    (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')
  ).toUpperCase();
}
